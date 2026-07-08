// Vercel serverless function — upload an image to the site repo's img/ folder.
//   POST /api/upload-media  { filename, contentBase64 }
//
// Owner/editor/author only (viewers 403). Validates type, sanitizes the name,
// enforces a 5 MB cap, rejects duplicates (409), and PUTs the file to the
// STAGING branch only — never main. Best-effort activity_log entry.
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for the activity log).
import { createClient } from '@supabase/supabase-js';
import { getAuthedUser } from '../server/auth.js';

const GH_API = 'https://api.github.com';
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (GitHub Contents API base64 limit).

// Roles allowed to upload (uploads land on staging only). Viewers are read-only.
const UPLOAD_ROLES = new Set(['owner', 'editor', 'author']);

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
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Turn an arbitrary filename into a safe repo-relative slug: lowercase, spaces
// to dashes, strip everything but [a-z0-9._-]. Returns '' if nothing usable.
function sanitizeFilename(raw) {
  const base = String(raw || '')
    .split(/[\\/]/).pop()      // drop any path components (traversal defense)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '');    // no leading dots/dashes
  return base;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { repo, staging, supabaseUrl, serviceKey } = cfg();
  if (!process.env.GITHUB_TOKEN || !repo) {
    return res.status(500).json({ error: 'Media upload is not configured (missing GITHUB_TOKEN / GITHUB_REPO).' });
  }

  try {
    // 1) AUTH GATE — require a valid session, then an upload-capable role.
    const authed = await getAuthedUser(req);
    if (authed.error) {
      if (authed.error === 'unauthenticated') {
        return res.status(401).json({ error: 'Not signed in. Please sign in and try again.' });
      }
      if (authed.error === 'invalid') {
        return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
      }
      return res.status(500).json({ error: 'Media upload is not configured (auth).' });
    }
    if (!UPLOAD_ROLES.has(authed.role)) {
      return res.status(403).json({ error: 'Your account is read-only. Ask an owner for upload access.' });
    }
    const actor = authed.userId;

    // 2) Validate + sanitize input.
    const body = await readBody(req);
    const filename = sanitizeFilename(body.filename);
    if (!filename) {
      return res.status(400).json({ error: 'A valid filename is required.' });
    }
    if (!IMAGE_RE.test(filename)) {
      return res.status(400).json({ error: 'Only image files are allowed (.png, .jpg, .jpeg, .webp, .gif).' });
    }

    // Accept either a raw base64 string or a data URL; strip any prefix.
    let contentBase64 = String(body.contentBase64 || '');
    const comma = contentBase64.indexOf(',');
    if (contentBase64.startsWith('data:') && comma !== -1) {
      contentBase64 = contentBase64.slice(comma + 1);
    }
    contentBase64 = contentBase64.trim();
    if (!contentBase64) {
      return res.status(400).json({ error: 'No file data received.' });
    }

    // Decode + enforce the size cap.
    let buf;
    try {
      buf = Buffer.from(contentBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'The file data could not be decoded.' });
    }
    if (buf.length === 0) {
      return res.status(400).json({ error: 'The file appears to be empty.' });
    }
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'That file is larger than 5 MB. Please choose a smaller image.' });
    }

    const path = `img/${filename}`;

    // 3) Reject duplicates — if the file already exists on staging, 409.
    const getUrl = `${GH_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(staging)}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders() });
    if (getRes.ok) {
      return res.status(409).json({ error: 'A file with that name already exists — rename it.' });
    }
    if (getRes.status !== 404) {
      const text = await getRes.text().catch(() => '');
      return res.status(502).json({ error: `Couldn't check for an existing file (${getRes.status}). ${text.slice(0, 200)}` });
    }

    // 4) PUT the file to img/{filename} on STAGING (never main).
    const putRes = await fetch(`${GH_API}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Add media: ${filename}`,
        content: buf.toString('base64'),
        branch: staging,
      }),
    });

    if (!putRes.ok) {
      const text = await putRes.text().catch(() => '');
      console.error('[upload-media] GitHub PUT failed:', putRes.status, text);
      return res.status(putRes.status).json({ error: `Couldn't save the file to GitHub: ${text.slice(0, 200)}` });
    }

    // 5) Best-effort activity_log entry (service role bypasses RLS).
    if (supabaseUrl && serviceKey) {
      try {
        const admin = createClient(supabaseUrl, serviceKey);
        await admin.from('activity_log').insert({
          kind: 'media',
          summary: `Uploaded ${path}`,
          actor,
        });
      } catch (logErr) {
        console.error('[upload-media] activity_log insert failed:', logErr);
      }
    }

    return res.status(200).json({ ok: true, path });
  } catch (err) {
    console.error('[upload-media] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
