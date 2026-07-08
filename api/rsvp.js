// Vercel serverless function — public RSVP intake.
//   POST /api/rsvp  { event_id, name, email, party_size, note?, hp? }
//
// PUBLIC endpoint (no login). Inserts via the Supabase SERVICE ROLE client
// (bypasses RLS) after validating the request and confirming the event is
// published. This replaces Eventbrite for on-site RSVPs. Server-only env:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose UUID-ish check: reject obviously bad ids before hitting the DB.
const UUID_RE = /^[0-9a-fA-F-]{20,40}$/;

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

    // Honeypot: real people leave `hp` empty; bots fill every field.
    // Silently accept (200) without inserting so bots get no signal.
    if (body.hp != null && String(body.hp).trim() !== '') {
      return res.status(200).json({ ok: true });
    }

    const event_id = (body.event_id || '').toString().trim();
    const name = (body.name || '').toString().trim();
    const email = (body.email || '').toString().trim();
    const note = body.note ? body.note.toString().trim() : null;
    const party_size = Number(body.party_size ?? 1);

    // ---- Validation ----
    if (!event_id || !UUID_RE.test(event_id)) {
      return res.status(400).json({ error: 'A valid event is required.' });
    }
    if (!name || name.length > 120) {
      return res.status(400).json({ error: 'Please enter your name (under 120 characters).' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (!Number.isInteger(party_size) || party_size < 1 || party_size > 20) {
      return res.status(400).json({ error: 'Party size must be a whole number between 1 and 20.' });
    }
    if (note && note.length > 500) {
      return res.status(400).json({ error: 'Please keep your note under 500 characters.' });
    }

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // ---- Require the event exists AND is published ----
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('id, status, capacity')
      .eq('id', event_id)
      .maybeSingle();

    if (evErr) {
      console.error('[rsvp] event lookup failed:', evErr);
      return res.status(500).json({ error: 'Could not verify the event. Please try again.' });
    }
    if (!event || event.status !== 'published') {
      return res.status(400).json({ error: "This event isn't open for RSVPs." });
    }

    // ---- Optional capacity check ----
    if (event.capacity != null) {
      const { data: existing, error: sumErr } = await admin
        .from('rsvps')
        .select('party_size')
        .eq('event_id', event_id);

      if (sumErr) {
        console.error('[rsvp] capacity lookup failed:', sumErr);
        return res.status(500).json({ error: 'Could not check availability. Please try again.' });
      }

      const taken = (existing || []).reduce((sum, r) => sum + (r.party_size || 1), 0);
      if (taken + party_size > event.capacity) {
        return res.status(409).json({ error: 'This event is full.' });
      }
    }

    // ---- Insert ----
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
