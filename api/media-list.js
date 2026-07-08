// Vercel serverless function — list media in the site repo's img/ folder.
//   GET /api/media-list
//
// Any signed-in staff member may view the library. Lists the `img/` folder on
// the STAGING branch via the GitHub Contents API, filters to image files, and
// returns [{ name, path, size }] sorted by name. No img/ folder -> [].
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH (default "staging").
import { getAuthedUser } from '../server/auth.js';

const GH_API = 'https://api.github.com';
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { repo, staging } = cfg();
  if (!process.env.GITHUB_TOKEN || !repo) {
    return res.status(500).json({ error: 'Media library is not configured (missing GITHUB_TOKEN / GITHUB_REPO).' });
  }

  try {
    // AUTH GATE — any signed-in staff member may view (all roles, incl. viewer).
    const authed = await getAuthedUser(req);
    if (authed.error) {
      if (authed.error === 'unauthenticated') {
        return res.status(401).json({ error: 'Not signed in. Please sign in and try again.' });
      }
      if (authed.error === 'invalid') {
        return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
      }
      return res.status(500).json({ error: 'Media library is not configured (auth).' });
    }

    // List the img/ folder on staging.
    const url = `${GH_API}/repos/${repo}/contents/img?ref=${encodeURIComponent(staging)}`;
    const ghRes = await fetch(url, { headers: ghHeaders() });

    // No img/ folder yet — treat as empty.
    if (ghRes.status === 404) {
      return res.status(200).json([]);
    }
    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => '');
      return res.status(502).json({ error: `Couldn't list media from GitHub (${ghRes.status}). ${text.slice(0, 200)}` });
    }

    const data = await ghRes.json();
    const items = (Array.isArray(data) ? data : [])
      .filter((it) => it.type === 'file' && IMAGE_RE.test(it.name || ''))
      .map((it) => ({ name: it.name, path: it.path, size: it.size }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json(items);
  } catch (err) {
    console.error('[media-list] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
