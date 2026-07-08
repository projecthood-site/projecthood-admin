// Vercel serverless function — change a member's role.
//   POST /api/set-role   body: { targetUserId, role }
//
// Owner-only. Enforces a last-owner guard so the org can never be left
// without an owner. Updates public.profiles with a service-role client
// (bypasses RLS) and best-effort logs the change to activity_log.
//
// Server-only env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';
import { getAuthedUser } from '../server/auth.js';

const VALID_ROLES = new Set(['owner', 'editor', 'author', 'viewer']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Service-role client is required to update roles (RLS restricts UPDATE to owners).
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Role service is not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' });
  }

  try {
    // AUTH GATE — must be a valid signed-in user…
    const authed = await getAuthedUser(req);
    if (authed.error) {
      if (authed.error === 'not-configured') {
        return res.status(500).json({ error: 'Role service is not configured (auth).' });
      }
      return res.status(401).json({ error: 'Please sign in.' });
    }
    // …and an owner.
    if (authed.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can change roles.' });
    }

    // Validate input.
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { targetUserId, role } = body;
    if (typeof targetUserId !== 'string' || !targetUserId.trim()) {
      return res.status(400).json({ error: 'targetUserId is required.' });
    }
    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be owner, editor, author, or viewer.' });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Look up the target row (need current role + email for the guard and log).
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, email, role')
      .eq('id', targetUserId)
      .single();

    if (targetErr || !target) {
      return res.status(404).json({ error: 'That team member could not be found.' });
    }

    // LAST-OWNER GUARD — don't let the only owner be demoted.
    if (target.role === 'owner' && role !== 'owner') {
      const { count, error: countErr } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'owner');
      if (countErr) {
        return res.status(500).json({ error: 'Could not verify owner count. Please try again.' });
      }
      if ((count || 0) <= 1) {
        return res.status(409).json({ error: "You can't remove the last owner. Promote someone else to owner first." });
      }
    }

    // Apply the change.
    const { error: updErr } = await admin
      .from('profiles')
      .update({ role })
      .eq('id', targetUserId);

    if (updErr) {
      return res.status(500).json({ error: `Could not update role: ${updErr.message}` });
    }

    // Best-effort activity log — never fail the request over logging.
    try {
      await admin.from('activity_log').insert({
        kind: 'role',
        summary: `Changed ${target.email || targetUserId} to ${role}`,
        actor: authed.userId,
      });
    } catch (logErr) {
      console.error('[set-role] activity_log insert failed:', logErr);
    }

    return res.status(200).json({ ok: true, role });
  } catch (err) {
    console.error('[set-role] error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
