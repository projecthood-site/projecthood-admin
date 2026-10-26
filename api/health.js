// Vercel serverless function — dependency health check.
//   GET /api/health                    → minimal public status
//   GET /api/health  x-health-key: …   → full diagnostic detail
//
// Reports whether the app's GitHub credential still works, so an expired token
// is caught on a schedule instead of discovered by staff mid-edit. It never
// returns the token, any secret, or any site content.
//
// Why /api/preview needs this: preview degrades gracefully when the token dies
// (it falls back to an anonymous read), which is good for staff and bad for
// visibility — the outage stops being obvious while publishing stays broken.
// This endpoint is the thing that stays honest.
//
// WHAT CHANGED (26 Oct 2026) and why:
//
//   1. The public response no longer names the repository, the token's expiry
//      date, or the remediation steps. Those were free reconnaissance for
//      anyone who found the URL: they revealed the hosting arrangement, the
//      exact repo path, and a date on which the credential would lapse.
//      Monitors only ever needed "is it healthy", so that is all the public
//      response carries now. Full detail requires HEALTH_TOKEN.
//
//   2. The GitHub write probe no longer runs for anonymous callers. It created
//      a real (unreferenced) git blob on every hit, so an unauthenticated
//      visitor could drive writes against the GitHub API and burn the token's
//      rate limit by refreshing a page. The probe is now authorized-only, and
//      its result is cached, so polling cannot hammer GitHub.
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, HEALTH_TOKEN (optional).

const GH_API = 'https://api.github.com';

// Cache the upstream result briefly so repeated polling — by a monitor, a
// dashboard, or a bot — costs one GitHub call per window rather than one per
// request. Module scope persists for the life of a warm instance.
const CACHE_MS = 60_000;
let cached = null; // { at: number, full: object }

function daysUntil(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.now()) / 86400000);
}

// Constant-time-ish comparison so the key cannot be guessed byte by byte.
function keyMatches(supplied, expected) {
  if (!expected || !supplied) return false;
  const a = String(supplied);
  const b = String(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The only thing an anonymous caller gets: is it working, and is publishing
// available. No repo, no dates, no instructions, no upstream status codes.
function publicView(full) {
  return {
    checkedAt: full.checkedAt,
    ok: full.ok === true,
    publishing: full.publishing === 'ok' ? 'ok' : 'degraded',
  };
}

async function buildFull({ authorized }) {
  const repo = process.env.GITHUB_REPO || null;
  const out = {
    checkedAt: new Date().toISOString(),
    repo,
    github: { status: 'unknown', expiresAt: null, daysRemaining: null },
    publishing: 'unknown',
  };

  if (!process.env.GITHUB_TOKEN) {
    out.github.status = 'missing';
    out.publishing = 'broken';
    out.ok = false;
    out.detail =
      'GITHUB_TOKEN is not set. Preview still works (anonymous read); saving and publishing do not.';
    return out;
  }

  try {
    const ghRes = await fetch(`${GH_API}/user`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ph-website-admin',
      },
    });

    // GitHub returns this header for PATs that carry an expiry date.
    const expiresAt = ghRes.headers.get('github-authentication-token-expiration');
    out.github.expiresAt = expiresAt || null;
    out.github.daysRemaining = daysUntil(expiresAt);

    if (ghRes.status === 401 || ghRes.status === 403) {
      out.github.status = 'unauthorized';
      out.publishing = 'broken';
      out.ok = false;
      out.detail =
        'GitHub rejected the token (expired or revoked). Preview still works via an anonymous read; ' +
        'saving edits and publishing are broken until GITHUB_TOKEN is rotated in Vercel.';
      return out;
    }

    if (!ghRes.ok) {
      out.github.status = `error_${ghRes.status}`;
      out.publishing = 'unknown';
      out.ok = false;
      out.detail = `GitHub returned ${ghRes.status}. This may be transient — re-check before acting.`;
      return out;
    }

    out.github.status = 'ok';

    // Authenticating is not the same as being allowed to write, and the repo
    // object's permissions.push is NOT a reliable proxy: for a fine-grained
    // token it can report the signing user's own access to the repo rather
    // than the permissions actually granted to the token. It said "true" while
    // every save failed with 403.
    //
    // So probe with a real write that changes nothing observable: create a
    // git blob. Writing a blob requires Contents: write, but it touches no
    // file, no branch and no history — an unreferenced blob is garbage
    // collected. If this succeeds, saving and publishing will too.
    //
    // Authorized callers only — see note 2 at the top of this file.
    if (repo && authorized) {
      try {
        const probe = await fetch(`${GH_API}/repos/${repo}/git/blobs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'ph-website-admin',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: 'ph-admin write probe', encoding: 'utf-8' }),
        });
        if (probe.ok) {
          out.github.canWrite = true;
        } else if (probe.status === 403 || probe.status === 404) {
          out.github.canWrite = false;
          out.publishing = 'read_only';
          out.ok = false;
          out.detail =
            'The token authenticates but cannot write to the repository — saving edits and ' +
            'publishing fail with 403. Preview still works. Fix: GitHub → Settings → Developer ' +
            'settings → Personal access tokens → Fine-grained tokens → open this token → ' +
            'Repository permissions → set Contents to "Read and write" → Update. The token ' +
            'value does not change, so nothing in Vercel needs touching.';
          return out;
        } else {
          out.github.canWrite = null;
        }
      } catch {
        out.github.canWrite = null;
      }
    } else if (repo) {
      // Not probed this time. Say so rather than implying it passed.
      out.github.canWrite = null;
    }

    out.publishing = 'ok';
    out.ok = true;

    const d = out.github.daysRemaining;
    if (d !== null && d <= 30) {
      out.ok = false;
      out.detail = `The GitHub token still works but expires in ${d} day(s). Rotate it before it lapses.`;
    }
    return out;
  } catch (err) {
    console.error('[health] check failed:', err);
    out.github.status = 'check_failed';
    out.ok = false;
    out.detail = 'Could not reach GitHub to check the credential.';
    return out;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authorized = keyMatches(
    req.headers['x-health-key'],
    process.env.HEALTH_TOKEN,
  );

  // Serve from cache when it is fresh. An authorized caller skips the cache if
  // the cached entry was built without the write probe, since that is the half
  // they are asking for.
  const fresh = cached && Date.now() - cached.at < CACHE_MS;
  const usable = fresh && !(authorized && cached.full.github?.canWrite == null);

  let full;
  if (usable) {
    full = cached.full;
  } else {
    full = await buildFull({ authorized });
    cached = { at: Date.now(), full };
  }

  return res.status(200).json(authorized ? full : publicView(full));
}
