// Vercel serverless function — publish flow (staging -> main).
//   GET  /api/publish?action=status  -> commits on staging ahead of main
//   POST /api/publish                -> merge staging into main, log it
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH,
// GITHUB_MAIN_BRANCH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';

const GH_API = 'https://api.github.com';

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
    if (req.method === 'GET') {
      // Compare main...staging to count commits ahead.
      const url = `${GH_API}/repos/${repo}/compare/${encodeURIComponent(main)}...${encodeURIComponent(staging)}`;
      const r = await fetch(url, { headers: ghHeaders() });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ error: `GitHub compare failed: ${text}` });
      }
      const data = await r.json();
      const last = data.commits && data.commits.length ? data.commits[data.commits.length - 1] : null;
      return res.status(200).json({
        ahead_by: data.ahead_by || 0,
        behind_by: data.behind_by || 0,
        last_commit_date: last?.commit?.committer?.date || null,
        last_commit_message: last?.commit?.message || null,
      });
    }

    if (req.method === 'POST') {
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
          await admin.from('publish_log').insert({ merged_sha: sha, summary: commit_message });
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
