// Vercel serverless function — public RSVP intake.
//   POST /api/rsvp  { event_id, name, email, party_size, note? }
//
// Inserts via the Supabase SERVICE ROLE client (bypasses RLS). This is the
// endpoint the public site's RSVP form will call. Server-only env:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // Fallback: read the raw stream.
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'RSVP service is not configured.' });
  }

  try {
    const body = await readBody(req);
    const event_id = (body.event_id || '').toString().trim();
    const name = (body.name || '').toString().trim();
    const email = (body.email || '').toString().trim();
    const note = body.note ? body.note.toString().trim() : null;
    const party_size = Number(body.party_size ?? 1);

    if (!event_id) return res.status(400).json({ error: 'event_id is required.' });
    if (!name) return res.status(400).json({ error: 'name is required.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!Number.isInteger(party_size) || party_size < 1 || party_size > 20) {
      return res.status(400).json({ error: 'party_size must be a whole number between 1 and 20.' });
    }

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await admin.from('rsvps').insert({
      event_id, name, email, party_size, note, source: 'website',
    });

    if (error) {
      console.error('[rsvp] insert failed:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[rsvp] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
