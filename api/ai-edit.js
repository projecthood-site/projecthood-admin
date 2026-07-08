// Vercel serverless function — "Edit with Claude" AI page editor.
//   POST /api/ai-edit  { page, instruction, history? }
//
// Flow: verify the caller's Supabase session -> read the target page from the
// STAGING branch on GitHub -> ask Claude for the minimal body edit as a
// forced tool call -> apply the find/replace edits -> commit to STAGING only
// -> best-effort activity_log entry. NEVER writes to main.
//
// Server-only env (never exposed to the browser):
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default "claude-sonnet-5"),
//   GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH (default "staging"),
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Reuses the browser anon key (SUPABASE_ANON_KEY | VITE_SUPABASE_ANON_KEY)
// purely to verify the caller's access token.
import { createClient } from '@supabase/supabase-js';

const GH_API = 'https://api.github.com';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

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
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    supabaseUrl: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
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

// Guardrails embedded from the site's CLAUDE.md operating rules.
const SYSTEM_PROMPT = `You are the "Edit with Claude" assistant for the Project H.O.O.D. website admin.
You help non-technical staff edit ONE page of a static HTML site (projecthood.org) using plain English.

HARD RULES (from the site's CLAUDE.md — never break these):
- You edit ONE page's BODY content only (headlines, paragraphs, sections, images, links on that page).
- Make the MINIMAL change that satisfies the request. Do not rewrite or reformat unrelated markup.
- NEVER modify the site header/nav, the footer, the <head>, the PREVIEW BUILD banner, or any region managed by _build.py — those are templated and regenerated. If a request is only about nav/footer/head, explain in your reply that those are managed centrally and make no edits.
- Use existing brand CSS classes and CSS variables (e.g. var(--green), var(--red), var(--yellow), .bg-green, .bg-red, .bg-offwhite, .video-frame). NEVER introduce raw hex color values.
- Keep section backgrounds alternating; don't put two identical backgrounds adjacent.
- Preserve valid, balanced HTML.
- All work lands on the "staging" branch and stays there until a human publishes — nothing you do goes live.
- Do NOT swap external destinations (Donate->NetworkForGood, WAA->Tiltify, Volunteer/Contact->Google Forms) for on-site alternatives.

You MUST respond by calling the "stage_edits" tool. Every edit's "find" string must be an EXACT substring copied verbatim from the current page HTML and must be UNIQUE in the file (include enough surrounding context to make it unique). If you cannot safely make the change, return an empty edits array and explain why in "reply".`;

const STAGE_EDITS_TOOL = {
  name: 'stage_edits',
  description: 'Stage minimal find/replace edits to the current page and return a friendly chat reply.',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'A short, friendly chat reply to the user describing what you did (or why you could not).',
      },
      summary: {
        type: 'string',
        description: 'One-line plain-English summary of the change (used as the commit message and activity log entry).',
      },
      edits: {
        type: 'array',
        description: 'The minimal set of find/replace edits. May be empty if no change should be made.',
        items: {
          type: 'object',
          properties: {
            find: {
              type: 'string',
              description: 'An exact substring currently in the file. Must be unique in the file.',
            },
            replace: {
              type: 'string',
              description: 'The replacement text.',
            },
          },
          required: ['find', 'replace'],
        },
      },
    },
    required: ['reply', 'summary', 'edits'],
  },
};

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { repo, staging, model, supabaseUrl, anonKey, serviceKey } = cfg();

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI editor is not configured (missing ANTHROPIC_API_KEY).' });
  }
  if (!process.env.GITHUB_TOKEN || !repo) {
    return res.status(500).json({ error: 'AI editor is not configured (missing GITHUB_TOKEN / GITHUB_REPO).' });
  }
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'AI editor is not configured (missing Supabase URL / anon key).' });
  }

  try {
    // 1) AUTH GATE — require a valid Supabase access token.
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ error: 'Not signed in. Please sign in and try again.' });
    }
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    }
    const actor = userData.user.id;

    // Validate body.
    const body = await readBody(req);
    const page = (body.page || '').toString().trim();
    const instruction = (body.instruction || '').toString().trim();
    const history = Array.isArray(body.history) ? body.history : [];

    if (!page) return res.status(400).json({ error: 'A page is required.' });
    if (!instruction) return res.status(400).json({ error: 'Please describe the change you want.' });
    // Only allow relative repo paths (no traversal, no leading slash).
    if (page.includes('..') || page.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid page path.' });
    }

    // 2) Read the target file from the STAGING branch.
    const getUrl = `${GH_API}/repos/${repo}/contents/${encodeURIComponent(page)}?ref=${encodeURIComponent(staging)}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders() });
    if (getRes.status === 404) {
      return res.status(404).json({ error: `Page "${page}" was not found on the ${staging} branch.` });
    }
    if (!getRes.ok) {
      const text = await getRes.text();
      return res.status(getRes.status).json({ error: `Couldn't read the page from GitHub: ${text}` });
    }
    const fileData = await getRes.json();
    const sha = fileData.sha;
    const originalHtml = Buffer.from(fileData.content || '', 'base64').toString('utf8');

    // 3) Ask Claude for the edits (forced tool call).
    const historyText = history.length
      ? '\n\nEarlier in this conversation:\n' +
        history
          .slice(-8)
          .map((m) => `${m.role === 'assistant' ? 'Claude' : 'User'}: ${(m.text || '').toString()}`)
          .join('\n')
      : '';

    const userMessage =
      `The page being edited is "${page}".\n\n` +
      `The user's request: ${instruction}${historyText}\n\n` +
      `Here is the current full HTML of the page. Produce the minimal edits to satisfy the request, ` +
      `following all the rules. Remember: each "find" must be an exact, unique substring of this HTML.\n\n` +
      `----- CURRENT PAGE HTML -----\n${originalHtml}\n----- END PAGE HTML -----`;

    const aiRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [STAGE_EDITS_TOOL],
        tool_choice: { type: 'tool', name: 'stage_edits' },
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error('[ai-edit] Anthropic error:', aiRes.status, text);
      return res.status(502).json({ error: `The AI service returned an error (${aiRes.status}). Please try again.` });
    }

    const aiData = await aiRes.json();
    const toolUse = (aiData.content || []).find((c) => c.type === 'tool_use' && c.name === 'stage_edits');
    if (!toolUse || !toolUse.input) {
      return res.status(502).json({ error: "The AI didn't return a usable edit. Please rephrase and try again." });
    }

    const { reply = '', summary = 'AI edit', edits = [] } = toolUse.input;

    // 4) Apply edits — each "find" must occur exactly once.
    let updatedHtml = originalHtml;
    const applied = [];
    const skipped = [];
    for (const edit of Array.isArray(edits) ? edits : []) {
      const find = (edit?.find ?? '').toString();
      const replace = (edit?.replace ?? '').toString();
      if (!find) {
        skipped.push({ reason: 'empty-find', find });
        continue;
      }
      const occ = countOccurrences(updatedHtml, find);
      if (occ === 0) {
        skipped.push({ reason: 'not-found', find });
        continue;
      }
      if (occ > 1) {
        skipped.push({ reason: 'not-unique', find });
        continue;
      }
      updatedHtml = updatedHtml.replace(find, replace);
      applied.push({ find, replace });
    }

    const editsApplied = applied.length;

    // No edits applied — return the reply, commit nothing.
    if (editsApplied === 0) {
      return res.status(200).json({
        reply: reply || "I wasn't able to make that change automatically. Could you rephrase it?",
        summary,
        editsApplied: 0,
        skipped,
        commitSha: null,
      });
    }

    // 5) Commit the updated file to STAGING (never main).
    const putRes = await fetch(`${GH_API}/repos/${repo}/contents/${encodeURIComponent(page)}`, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `AI edit: ${summary}`,
        content: Buffer.from(updatedHtml, 'utf8').toString('base64'),
        sha,
        branch: staging,
      }),
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      console.error('[ai-edit] GitHub commit failed:', putRes.status, text);
      return res.status(putRes.status).json({ error: `Couldn't save the change to GitHub: ${text}` });
    }

    const putData = await putRes.json();
    const commitSha = putData.commit?.sha || null;

    // 6) Best-effort activity_log entry (service role bypasses RLS).
    if (supabaseUrl && serviceKey) {
      try {
        const admin = createClient(supabaseUrl, serviceKey);
        await admin.from('activity_log').insert({
          kind: 'edit',
          summary: `${page}: ${summary}`,
          actor,
        });
      } catch (logErr) {
        console.error('[ai-edit] activity_log insert failed:', logErr);
      }
    }

    // 7) Respond.
    return res.status(200).json({
      reply: reply || 'Done — I staged that change for your review.',
      summary,
      editsApplied,
      skipped,
      commitSha,
    });
  } catch (err) {
    console.error('[ai-edit] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
