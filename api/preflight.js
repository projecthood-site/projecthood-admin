// Vercel serverless function — pre-publish preflight checks.
//   GET /api/preflight  -> { ok, checked, findings[], summary, skipped }
//
// Runs BEFORE a staging -> main publish and reports likely mistakes in the
// changes that are about to go live. Advisory, not a hard block: the publish
// dialog surfaces findings and makes the operator confirm past errors.
//
// DESIGN NOTE (important): every check is scoped to what is CHANGING, never the
// whole site. The live pages already contain ~100 legitimate hex colors and 50
// extensionless internal links, so whole-site checks are pure noise. We look at
// added diff lines, and for structural checks we compare the staged file against
// its main version so only NEWLY introduced problems are reported.
//
// Server-only env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_STAGING_BRANCH,
// GITHUB_MAIN_BRANCH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
import { getAuthedUser } from '../server/auth.js';

const GH_API = 'https://api.github.com';

// Cap on how many changed pages get the expensive whole-file structural check.
// A _build.py edit regenerates all 29 pages; we don't need 58 more API calls.
const MAX_STRUCTURAL_FILES = 10;

// Block-level tags where a missing closing tag actually breaks layout. Kept
// deliberately narrow — <p>, <li>, <td> etc. are legally self-closing in HTML
// and would produce false positives.
const BALANCED_TAGS = ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'ul', 'ol', 'table', 'figure'];

const PLACEHOLDER_PATTERNS = [
  { re: /\bTODO\b/, label: 'TODO' },
  { re: /\bFIXME\b/, label: 'FIXME' },
  { re: /\bTKTK\b/, label: 'TKTK' },
  { re: /lorem ipsum/i, label: 'Lorem ipsum' },
  { re: /\bTBD\b/, label: 'TBD' },
  { re: /\[(?:Brian|insert|add|your)\b[^\]]*\]/i, label: 'bracketed placeholder' },
  { re: /\bXXX+\b/, label: 'XXX' },
  { re: /\{\{[^}]*\}\}/, label: 'unfilled {{token}}' },
  { re: /\bplaceholder\b/i, label: 'the word "placeholder"' },
];

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ph-website-admin',
  };
}

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

// Strip <script>/<style> bodies and HTML comments so checks don't read code or
// commented-out markup as page content.
function stripNonContent(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

// Added lines from a unified diff patch (the "+" side, minus the header).
function addedLines(patch) {
  if (!patch) return [];
  const out = [];
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+') && !raw.startsWith('+++')) out.push(raw.slice(1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks on added lines
// ---------------------------------------------------------------------------

// The site links internally WITHOUT the .html extension (href="about"), which
// GitHub Pages resolves. So a link is fine if any of these exist in the tree.
function linkCandidates(path) {
  const clean = path.replace(/^\.\//, '').replace(/^\//, '');
  if (!clean) return [];
  return [clean, `${clean}.html`, `${clean}/index.html`, clean.replace(/\/$/, '/index.html')];
}

function checkLinks(lines, tree, file) {
  const findings = [];
  const seen = new Set();
  for (const line of lines) {
    for (const m of line.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/gi)) {
      const url = m[1].trim();
      // Skip anything not a repo-relative path.
      if (!url || /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(url)) continue;
      const target = url.split('#')[0].split('?')[0];
      if (!target || seen.has(target)) continue;
      seen.add(target);
      const hit = linkCandidates(target).some((c) => tree.has(c));
      if (!hit) {
        findings.push({
          severity: 'error',
          check: 'broken-link',
          file,
          detail: target,
          message: `Link to "${target}" doesn't point at anything in the site.`,
        });
      }
    }
  }
  return findings;
}

function checkImages(lines, file) {
  const findings = [];
  for (const line of lines) {
    for (const m of line.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/\balt\s*=/i.test(tag)) {
        findings.push({
          severity: 'warning',
          check: 'missing-alt',
          file,
          detail: tag.slice(0, 90),
          message: 'New image has no alt text — screen readers will skip it.',
        });
      }
    }
  }
  return findings;
}

function checkPlaceholders(lines, file) {
  const findings = [];
  const seen = new Set();
  for (const line of lines) {
    const text = stripNonContent(line);
    for (const { re, label } of PLACEHOLDER_PATTERNS) {
      if (re.test(text) && !seen.has(label)) {
        seen.add(label);
        findings.push({
          severity: 'warning',
          check: 'placeholder',
          file,
          detail: label,
          message: `Looks like leftover placeholder text (${label}).`,
        });
      }
    }
  }
  return findings;
}

function checkHex(lines, file) {
  const findings = [];
  const seen = new Set();
  for (const line of lines) {
    // Ignore numeric HTML entities (&#9733; = star) — not colors.
    const text = line.replace(/&#\d+;?/g, ' ');
    for (const m of text.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
      const hex = m[0].toLowerCase();
      if (seen.has(hex)) continue;
      seen.add(hex);
      findings.push({
        severity: 'warning',
        check: 'raw-hex',
        file,
        detail: hex,
        message: `New hard-coded color ${hex} — brand colors should use a CSS token like var(--red).`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Structural check (whole file, compared against main)
// ---------------------------------------------------------------------------

// Net open/close balance per tag. Returns e.g. { div: 2 } meaning 2 unclosed.
function tagBalance(html) {
  const body = stripNonContent(html);
  const counts = {};
  for (const tag of BALANCED_TAGS) {
    const open = (body.match(new RegExp(`<${tag}\\b[^>]*?(?<!/)>`, 'gi')) || []).length;
    const close = (body.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
    const diff = open - close;
    if (diff !== 0) counts[tag] = diff;
  }
  return counts;
}

async function fetchFile(repo, path, ref) {
  const url = `${GH_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const r = await ghFetch(url, { headers: ghHeaders() });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.content) return null;
  return Buffer.from(j.content, 'base64').toString('utf8');
}

// Only report imbalance that the pending changes INTRODUCED. If main is already
// imbalanced by the same amount, it's pre-existing and not this publish's fault.
function checkStructure(stagedHtml, mainHtml, file) {
  const findings = [];
  const staged = tagBalance(stagedHtml);
  const base = mainHtml ? tagBalance(mainHtml) : {};
  for (const tag of Object.keys(staged)) {
    const introduced = staged[tag] - (base[tag] || 0);
    if (introduced === 0) continue;
    findings.push({
      severity: 'error',
      check: 'unbalanced-tags',
      file,
      detail: `${tag}: ${introduced > 0 ? `${introduced} unclosed` : `${-introduced} extra closing`}`,
      message: introduced > 0
        ? `${introduced} <${tag}> tag${introduced === 1 ? '' : 's'} never closed — this can break the page layout.`
        : `${-introduced} extra </${tag}> tag${introduced === -1 ? '' : 's'} — this can break the page layout.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  const repo = process.env.GITHUB_REPO;
  const main = process.env.GITHUB_MAIN_BRANCH || 'main';
  const staging = process.env.GITHUB_STAGING_BRANCH || 'staging';

  if (!process.env.GITHUB_TOKEN || !repo) {
    return res.status(500).json({ error: 'Preflight is not configured (missing GITHUB_TOKEN / GITHUB_REPO).' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // AUTH GATE — any signed-in user may run preflight (it's read-only).
    const authed = await getAuthedUser(req);
    if (authed.error) {
      if (authed.error === 'not-configured') {
        return res.status(500).json({ error: 'Preflight is not configured (auth).' });
      }
      return res.status(401).json({ error: 'Please sign in.' });
    }

    // 1) What's changing?
    const cmpUrl = `${GH_API}/repos/${repo}/compare/${encodeURIComponent(main)}...${encodeURIComponent(staging)}`;
    const cmpRes = await ghFetch(cmpUrl, { headers: ghHeaders() });
    if (!cmpRes.ok) {
      const msg = cmpRes.status >= 500 || cmpRes.status === 429
        ? 'GitHub is temporarily unavailable, so the checks could not run.'
        : `Could not compare staging with live (${cmpRes.status}).`;
      return res.status(cmpRes.status === 429 ? 503 : cmpRes.status).json({ error: msg });
    }
    const cmp = await cmpRes.json();
    const changedHtml = (cmp.files || []).filter(
      (f) => f.filename.endsWith('.html') && f.status !== 'removed'
    );

    if (!changedHtml.length) {
      return res.status(200).json({
        ok: true, checked: 0, findings: [], skipped: [],
        summary: { error: 0, warning: 0 },
        note: 'No page changes to check.',
      });
    }

    // 2) Staging file tree, for resolving internal links.
    const tree = new Set();
    const treeRes = await ghFetch(
      `${GH_API}/repos/${repo}/git/trees/${encodeURIComponent(staging)}?recursive=1`,
      { headers: ghHeaders() }
    );
    if (treeRes.ok) {
      const t = await treeRes.json();
      for (const node of t.tree || []) tree.add(node.path);
    }
    const canCheckLinks = tree.size > 0;

    // 3) Cheap checks on added diff lines (patches come free with the compare).
    let findings = [];
    for (const f of changedHtml) {
      const lines = addedLines(f.patch);
      if (!lines.length) continue;
      if (canCheckLinks) findings.push(...checkLinks(lines, tree, f.filename));
      findings.push(...checkImages(lines, f.filename));
      findings.push(...checkPlaceholders(lines, f.filename));
      findings.push(...checkHex(lines, f.filename));
    }

    // 4) Structural check on the most-changed pages (needs full file fetches).
    const ranked = [...changedHtml].sort((a, b) => (b.changes || 0) - (a.changes || 0));
    const structural = ranked.slice(0, MAX_STRUCTURAL_FILES);
    const skipped = ranked.slice(MAX_STRUCTURAL_FILES).map((f) => f.filename);

    const structuralResults = await Promise.all(
      structural.map(async (f) => {
        try {
          const [stagedHtml, mainHtml] = await Promise.all([
            fetchFile(repo, f.filename, staging),
            f.status === 'added' ? Promise.resolve(null) : fetchFile(repo, f.filename, main),
          ]);
          if (!stagedHtml) return [];
          return checkStructure(stagedHtml, mainHtml, f.filename);
        } catch (err) {
          console.error('[preflight] structural check failed for', f.filename, err);
          return [];
        }
      })
    );
    findings.push(...structuralResults.flat());

    // 5) Sort errors first, cap the payload.
    const rank = { error: 0, warning: 1 };
    findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.file.localeCompare(b.file));
    const total = { error: 0, warning: 0 };
    for (const f of findings) total[f.severity] = (total[f.severity] || 0) + 1;

    return res.status(200).json({
      ok: total.error === 0,
      checked: changedHtml.length,
      findings: findings.slice(0, 40),
      truncated: findings.length > 40 ? findings.length - 40 : 0,
      skipped,
      linksChecked: canCheckLinks,
      summary: total,
    });
  } catch (err) {
    console.error('[preflight] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
