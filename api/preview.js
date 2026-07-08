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
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH (default "staging").
const GH_API = 'https://api.github.com';

// Only these exact repo-relative paths may be previewed. Prevents arbitrary
// path traversal / SSRF via the `page` query param.
const ALLOWED_PAGES = new Set([
  'index.html',
  'programs.html',
  'impact.html',
  'donate.html',
  'get-involved.html',
  'about.html',
]);

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ph-website-admin',
  };
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendHtml(res, 405, noticeHtml('Method not allowed', 'Use GET to load a preview.'));
  }

  const { repo, staging } = cfg();

  if (!process.env.GITHUB_TOKEN || !repo) {
    return sendHtml(
      res,
      500,
      noticeHtml('Preview unavailable', 'The preview service is not configured (missing GitHub credentials).')
    );
  }

  // 1) Validate the requested page against the allow-list.
  const page = (req.query?.page || '').toString().trim();
  if (!ALLOWED_PAGES.has(page)) {
    return sendHtml(res, 400, noticeHtml('Page not allowed', 'That page cannot be previewed.'));
  }

  try {
    // 2) Fetch the file FRESH from the staging branch via the Contents API.
    const getUrl = `${GH_API}/repos/${repo}/contents/${encodeURIComponent(page)}?ref=${encodeURIComponent(staging)}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders() });

    if (getRes.status === 404) {
      return sendHtml(
        res,
        404,
        noticeHtml('Not staged yet', `"${page}" was not found on the ${staging} branch.`)
      );
    }
    if (!getRes.ok) {
      const text = await getRes.text().catch(() => '');
      return sendHtml(
        res,
        502,
        noticeHtml('Could not load preview', `GitHub returned an error (${getRes.status}). ${text.slice(0, 200)}`)
      );
    }

    const fileData = await getRes.json();
    let html = Buffer.from(fileData.content || '', 'base64').toString('utf8');

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
