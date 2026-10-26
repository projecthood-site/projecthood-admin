// Vercel serverless function — public RSVP intake.
//   POST /api/rsvp  { event_id, name, email, party_size, note?, hp? }
//
// PUBLIC endpoint (no login). Inserts via the Supabase SERVICE ROLE client
// (bypasses RLS) after validating the request and confirming the event is
// published. This replaces Eventbrite for on-site RSVPs. Server-only env:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// WHAT CHANGED (26 Oct 2026) and why:
//
//   This endpoint accepts unauthenticated writes by design — the public RSVP
//   page needs it. It had a honeypot and good field validation, but nothing
//   stopped repetition. One script could RSVP the same address hundreds of
//   times, and on an event with a capacity set it could exhaust every seat
//   and lock out real attendees. Three guards now sit in front of the insert:
//
//     1. Duplicate guard — one RSVP per email per event. A repeat returns
//        success without inserting, so it is idempotent and a scanner cannot
//        use the response to learn whether an address is registered.
//     2. Per-email velocity cap — at most MAX_PER_EMAIL RSVPs in the window,
//        counted in the database, so it holds across serverless instances.
//     3. Per-IP burst throttle — best effort, in memory. It only sees traffic
//        that lands on the same warm instance, which is why it is the third
//        line rather than the first, but it is free and stops naive floods.
//
//   Supabase insert errors are no longer echoed to the caller. The raw message
//   could name columns and constraints; it now goes to the log and the caller
//   gets a generic failure.

import { createClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose UUID-ish check: reject obviously bad ids before hitting the DB.
const UUID_RE = /^[0-9a-fA-F-]{20,40}$/;

// ---- Abuse guards -------------------------------------------------------
const VELOCITY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_EMAIL = 5;                   // per email, per window, all events
const IP_WINDOW_MS = 60 * 1000;            // 1 minute
const MAX_PER_IP = 10;                     // per IP, per window, best effort

// Module scope: survives for the life of a warm instance.
const ipHits = new Map(); // ip -> number[] (timestamps)

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Returns true when this IP is over its burst allowance.
function ipThrottled(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits) {
      if (!v.some((t) => now - t < IP_WINDOW_MS)) ipHits.delete(k);
    }
  }
  return hits.length > MAX_PER_IP;
}

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

  // Guard 3, cheapest, so it runs before any parsing or database work.
  if (ipThrottled(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
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
    const email = (body.email || '').toString().trim().toLowerCase();
    const note = body.note ? body.note.toString().trim() : null;
    const party_size = Number(body.party_size ?? 1);

    // ---- Validation ----
    if (!event_id || !UUID_RE.test(event_id)) {
      return res.status(400).json({ error: 'A valid event is required.' });
    }
    if (!name || name.length > 120) {
      return res.status(400).json({ error: 'Please enter your name (under 120 characters).' });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
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

    // ---- Guard 1: one RSVP per email per event ----
    // Returns success without inserting. Idempotent for the person who
    // double-submits, and it tells a scanner nothing either way.
    const { data: already, error: dupErr } = await admin
      .from('rsvps')
      .select('id')
      .eq('event_id', event_id)
      .eq('email', email)
      .maybeSingle();

    if (dupErr) {
      console.error('[rsvp] duplicate check failed:', dupErr);
      return res.status(500).json({ error: 'Could not complete your RSVP. Please try again.' });
    }
    if (already) {
      return res.status(200).json({ ok: true });
    }

    // ---- Guard 2: per-email velocity across all events ----
    const since = new Date(Date.now() - VELOCITY_WINDOW_MS).toISOString();
    const { count: recent, error: velErr } = await admin
      .from('rsvps')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', since);

    if (velErr) {
      console.error('[rsvp] velocity check failed:', velErr);
      return res.status(500).json({ error: 'Could not complete your RSVP. Please try again.' });
    }
    if ((recent || 0) >= MAX_PER_EMAIL) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many RSVPs from this address. Please try again later.' });
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
      // Do not echo the database's own message — it can name columns and
      // constraints. Log it; hand the caller something generic.
      console.error('[rsvp] insert failed:', error);
      return res.status(400).json({ error: 'Could not save your RSVP. Please check your details and try again.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[rsvp] error:', err);
    return res.status(500).json({ error: 'Unexpected error. Please try again.' });
  }
}
