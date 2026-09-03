// Vercel serverless function — live "staging" preview.
//   GET /api/preview?page=<repo-relative path>
//
// Public, read-only. Fetches the requested page FRESH from the STAGING branch
// via the GitHub Contents API (so the preview always reflects the latest
// staged commit — no CDN lag), then injects a <base> tag so relative assets
// (css/, js/, img/, fonts) resolve from staging via jsDelivr. Returns HTML.
//
// The site repo is PUBLIC, so staged HTML is not sensitive.
//
// Server-only env: GITHUB_REPO, GITHUB_STAGING_BRANCH (default "staging"), and
// optionally GITHUB_TOKEN. The token is NOT required here — see ghHeaders().
const GH_API = 'https://api.github.com';

// Only these exact repo-relative paths may be previewed. Prevents arbitrary
// path traversal / SSRF via the `page` query param.
// IMPORTANT: this set MUST stay in sync with the PAGES array in
// src/screens/PageEditor.jsx (they define the same editable-page set).
const ALLOWED_PAGES = new Set([
  'index.html',
  'programs.html',
  'impact.html',
  'donate.html',
  'ways-to-give.html',
  'get-involved.html',
  'get-help.html',
  'about.html',
  'exec-director.html',
  'leo-center.html',
  'workforce-development.html',
  'reentry-services.html',
  'violence-prevention.html',
  'youth-programming.html',
  'health-wellness.html',
  'news.html',
  'partner.html',
  'contact.html',
]);

// The site repo is PUBLIC, so preview reads work with or without a credential.
// We send the token when we have one (it raises the API rate limit), but the
// preview must never *depend* on it: GitHub rejects a bad credential with 401
// before it ever considers the public-read path, so an expired token would
// otherwise take the whole preview down. See the 401 fallback in the handler.
function ghHeaders({ authenticated = true } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ph-website-admin',
  };
  if (authenticated && process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

// The GitHub Contents API intermittently returns transient upstream errors
// (502/503/504) or secondary rate limits (429), which previously broke the
// preview outright. Retry a few times with exponential backoff before failing.
async function ghFetch(url, options = {}, { retries = 3 } = {}) {
  let res;
  for (let attempt = 0; attempt <= retries; attempt++) {
    res = await fetch(url, options);
    const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!transient || attempt === retries) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 4000)
      : Math.min(400 * 2 ** attempt, 4000);
    await new Promise((r) => setTimeout(r, delay));
  }
  return res;
}

function cfg() {
  return {
    repo: process.env.GITHUB_REPO,
    staging: process.env.GITHUB_STAGING_BRANCH || 'staging',
  };
}

// Minimal HTML page for error/notice states.
function noticeHtml(title, message) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       background:#f6f6f4;color:#231f21;display:flex;align-items:center;
       justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}
  .box{max-width:420px;text-align:center;background:#fff;border:1px solid #ececea;
       border-radius:12px;padding:28px 24px}
  h1{font-size:16px;margin:0 0 8px}
  p{font-size:13.5px;line-height:1.5;color:#565157;margin:0}
</style></head><body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

function sendHtml(res, status, html, { noStore = true } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Always fresh — the HTML must reflect the latest staging commit. Only the
  // jsDelivr-served assets may cache, which is fine.
  res.setHeader('Cache-Control', noStore ? 'no-store' : 'public, max-age=60');
  res.end(html);
}

// Read one staged page, preferring the freshest source that actually works.
// Returns { ok, html, status?, body?, viaFallback? }.
async function fetchStagedHtml(repo, staging, page) {
  if (process.env.GITHUB_TOKEN) {
    const apiUrl =
      `${GH_API}/repos/${repo}/contents/${encodeURIComponent(page)}?ref=${encodeURIComponent(staging)}`;
    const apiRes = await ghFetch(apiUrl, { headers: ghHeaders() });
    if (apiRes.ok) {
      const data = await apiRes.json();
      return { ok: true, html: Buffer.from(data.content || '', 'base64').toString('utf8') };
    }
    // A missing file is a real answer, not a reason to fall back.
    if (apiRes.status === 404) return { ok: false, status: 404 };
    if (apiRes.status === 401 || apiRes.status === 403) {
      console.warn(
        '[preview] GitHub rejected GITHUB_TOKEN (%s). Serving preview from raw.githubusercontent instead. ' +
          'Rotate the token — publishing stays broken until you do.',
        apiRes.status
      );
    } else {
      console.warn('[preview] Contents API failed (%s); trying raw.githubusercontent.', apiRes.status);
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(staging)}/${page}`;
  const rawRes = await ghFetch(rawUrl, { headers: { 'User-Agent': 'ph-website-admin' } });
  if (rawRes.ok) return { ok: true, html: await rawRes.text(), viaFallback: true };
  if (rawRes.status === 404) return { ok: false, status: 404 };
  return { ok: false, status: rawRes.status, body: await rawRes.text().catch(() => '') };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendHtml(res, 405, noticeHtml('Method not allowed', 'Use GET to load a preview.'));
  }

  const { repo, staging } = cfg();

  if (!repo) {
    return sendHtml(
      res,
      500,
      noticeHtml('Preview unavailable', 'The preview service is not configured (missing GITHUB_REPO).')
    );
  }

  // 1) Validate the requested page against the allow-list.
  const page = (req.query?.page || '').toString().trim();
  if (!ALLOWED_PAGES.has(page)) {
    return sendHtml(res, 400, noticeHtml('Page not allowed', 'That page cannot be previewed.'));
  }

  try {
    // 2) Fetch the staged file. Two paths, in order of freshness:
    //
    //    a) Contents API with the token — always the newest commit, but a dead
    //       credential makes GitHub answer 401 *before* it considers the public
    //       -read path, so this alone is a single point of failure.
    //    b) raw.githubusercontent, anonymous — the repo is public, so no
    //       credential is needed, and unlike the API it carries no 60-req/hour
    //       anonymous cap (which Vercel's shared egress IPs would blow through
    //       immediately). It can trail the newest commit by a minute or two.
    //
    // Net effect: an expired token costs a little freshness, not the preview.
    const result = await fetchStagedHtml(repo, staging, page);

    if (result.status === 404) {
      return sendHtml(
        res,
        404,
        noticeHtml('Not staged yet', `"${page}" was not found on the ${staging} branch.`)
      );
    }
    if (!result.ok) {
      console.error('[preview] read failed:', result.status, (result.body || '').slice(0, 200));
      // Both paths failed — a real outage, or the repo stopped being public.
      // Refresh will not cure either, so don't tell staff to keep clicking it.
      const authFailure = result.status === 401 || result.status === 403;
      return sendHtml(
        res,
        502,
        noticeHtml(
          authFailure ? 'Preview needs attention' : 'Preview temporarily unavailable',
          authFailure
            ? `The site connection needs to be re-authorized (error ${result.status}). Refreshing won't clear this one — please let Brian know. Your saved changes are safe.`
            : `GitHub is having a hiccup (error ${result.status}). This is temporary — click Refresh in a moment. Your saved changes are safe.`
        )
      );
    }

    let html = result.html;

    // 3) Inject a <base> so RELATIVE asset URLs resolve from staging via jsDelivr,
    //    plus a tiny style so the page renders nicely inside an iframe.
    const baseTag =
      `<base href="https://cdn.jsdelivr.net/gh/${repo}@${staging}/">` +
      `<style>html,body{margin:0}</style>`;

    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      html = html.replace(headMatch[0], `${headMatch[0]}${baseTag}`);
    } else {
      html = baseTag + html;
    }

    // 4) Return the HTML, always fresh.
    return sendHtml(res, 200, html);
  } catch (err) {
    console.error('[preview] error:', err);
    return sendHtml(res, 500, noticeHtml('Preview error', err.message || 'Unexpected error.'));
  }
}
