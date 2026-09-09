// Vercel serverless function — dependency health check.
//   GET /api/health
//
// Public and read-only. Reports the STATUS of the app's GitHub credential so
// an expired token can be caught on a schedule instead of discovered by staff
// mid-edit. It never returns the token, any secret, or any site content — only
// "does the credential still work, and when does it lapse".
//
// Why this exists: /api/preview now degrades gracefully when the token dies
// (it falls back to an anonymous read), which is good for staff and bad for
// visibility — the outage stops being obvious while publishing stays broken.
// This endpoint is the thing that stays honest.
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO.

const GH_API = 'https://api.github.com';

function daysUntil(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.now()) / 86400000);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    out.detail = 'GITHUB_TOKEN is not set. Preview still works (anonymous read); saving and publishing do not.';
    return res.status(200).json(out);
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
      return res.status(200).json(out);
    }

    if (!ghRes.ok) {
      out.github.status = `error_${ghRes.status}`;
      out.publishing = 'unknown';
      out.ok = false;
      out.detail = `GitHub returned ${ghRes.status}. This may be transient — re-check before acting.`;
      return res.status(200).json(out);
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
    if (repo) {
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
          return res.status(200).json(out);
        } else {
          out.github.canWrite = null;
        }
      } catch {
        out.github.canWrite = null;
      }
    }

    out.publishing = 'ok';
    out.ok = true;
    const d = out.github.daysRemaining;
    if (d !== null && d <= 30) {
      out.ok = false;
      out.detail = `The GitHub token still works but expires in ${d} day(s). Rotate it before it lapses.`;
    }
    return res.status(200).json(out);
  } catch (err) {
    console.error('[health] check failed:', err);
    out.github.status = 'check_failed';
    out.ok = false;
    out.detail = 'Could not reach GitHub to check the credential.';
    return res.status(200).json(out);
  }
}
