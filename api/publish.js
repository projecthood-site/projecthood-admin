// Vercel serverless function — publish flow (staging -> main).
//   GET  /api/publish?action=status  -> commits on staging ahead of main
//   POST /api/publish                -> merge staging into main, log it
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH,
// GITHUB_MAIN_BRANCH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';
import { getAuthedUser } from '../server/auth.js';

const GH_API = 'https://api.github.com';

// Roles allowed to publish (merge staging -> live main).
const PUBLISH_ROLES = new Set(['owner', 'editor']);

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ph-website-admin',
  };
}

// Retry transient GitHub upstream errors (502/503/504) and secondary rate
// limits (429) with backoff. Used for the read-only compare below.
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

// Turn the raw commits between main...staging into a human-readable list of what
// will actually go live. Filters out build-system noise (auto-rebuild commits,
// merge/publish commits) and parses AI edits ("AI edit (page): summary") into a
// page + plain-English summary. De-duplicates repeated summaries.
function buildChanges(commits) {
  const IGNORE = /^(chore:\s*auto-rebuild|Merge (branch|pull request|remote)|Publish:\s*merge)/i;
  const seen = new Set();
  const changes = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    const firstLine = (c?.commit?.message || '').split('\n')[0].trim();
    if (!firstLine || IGNORE.test(firstLine)) continue;
    const m = firstLine.match(/^AI edit \(([^)]+)\):\s*(.+)$/i);
    const entry = m ? { page: m[1], text: m[2].trim() } : { page: null, text: firstLine };
    const key = `${entry.page || ''}|${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push(entry);
  }
  changes.reverse(); // most recent first
  return changes;
}

function cfg() {
  return {
    repo: process.env.GITHUB_REPO,
    main: process.env.GITHUB_MAIN_BRANCH || 'main',
    staging: process.env.GITHUB_STAGING_BRANCH || 'staging',
  };
}

export default async function handler(req, res) {
  const { repo, main, staging } = cfg();

  if (!process.env.GITHUB_TOKEN || !repo) {
    return res.status(500).json({ error: 'Publish service is not configured (missing GITHUB_TOKEN / GITHUB_REPO).' });
  }

  try {
    // AUTH GATE — every request must be a valid signed-in user.
    const authed = await getAuthedUser(req);
    if (authed.error) {
      if (authed.error === 'not-configured') {
        return res.status(500).json({ error: 'Publish service is not configured (auth).' });
      }
      return res.status(401).json({ error: 'Please sign in.' });
    }

    if (req.method === 'GET') {
      // Compare main...staging to count commits ahead.
      const url = `${GH_API}/repos/${repo}/compare/${encodeURIComponent(main)}...${encodeURIComponent(staging)}`;
      const r = await ghFetch(url, { headers: ghHeaders() });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        const status = r.status;
        const msg = status >= 500 || status === 429
          ? 'GitHub is temporarily unavailable. Please try again in a moment.'
          : `GitHub compare failed (${status}).`;
        console.error('[publish] compare failed:', status, text.slice(0, 200));
        return res.status(status === 429 ? 503 : status).json({ error: msg });
      }
      const data = await r.json();
      const commits = data.commits && data.commits.length ? data.commits : [];
      const last = commits.length ? commits[commits.length - 1] : null;
      const changes = buildChanges(commits);
      return res.status(200).json({
        ahead_by: data.ahead_by || 0,
        behind_by: data.behind_by || 0,
        last_commit_date: last?.commit?.committer?.date || null,
        last_commit_message: last?.commit?.message || null,
        changes,
        change_count: changes.length,
      });
    }

    if (req.method === 'POST') {
      // Publishing to live requires Editor or Owner.
      if (!PUBLISH_ROLES.has(authed.role)) {
        return res.status(403).json({ error: 'You need Editor or Owner access to publish changes.' });
      }
      const commit_message = `Publish: merge ${staging} into ${main} via admin`;
      const r = await fetch(`${GH_API}/repos/${repo}/merges`, {
        method: 'POST',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: main, head: staging, commit_message }),
      });

      // 204 = nothing to merge (already up to date); 409 = merge conflict.
      if (r.status === 204) {
        return res.status(200).json({ ok: true, nothing: true, message: 'Already up to date.' });
      }
      if (r.status === 409) {
        return res.status(409).json({ ok: false, error: 'Merge conflict — staging and main have diverged.' });
      }
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ ok: false, error: `GitHub merge failed: ${text}` });
      }

      const merge = await r.json();
      const sha = merge.sha || null;

      // Best-effort publish_log entry (service role bypasses RLS).
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
          await admin.from('publish_log').insert({ merged_sha: sha, summary: commit_message, actor: authed.userId });
        } catch (logErr) {
          console.error('[publish] publish_log insert failed:', logErr);
        }
      }

      return res.status(200).json({ ok: true, sha });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[publish] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
