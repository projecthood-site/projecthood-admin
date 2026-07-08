// Shared server-side auth helper (NOT an API endpoint — lives outside /api).
//
// getAuthedUser(req) verifies the caller's Supabase access token and looks up
// their role, so serverless functions can enforce authentication + roles.
//
//   getAuthedUser(req) -> { userId, email, role }   on success
//                      -> { error: 'unauthenticated' | 'invalid' | ... }  on failure
//
// Server-only env (never exposed to the browser):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY (falls back to VITE_SUPABASE_ANON_KEY) — used only to
//   verify the caller's token via auth.getUser().
import { createClient } from '@supabase/supabase-js';

function env() {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

// Verify the request's bearer token and return the authenticated user + role.
export async function getAuthedUser(req) {
  const { supabaseUrl, anonKey, serviceKey } = env();

  if (!supabaseUrl || !anonKey) {
    return { error: 'not-configured' };
  }

  // 1) Read the bearer token.
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return { error: 'unauthenticated' };
  }

  // 2) Verify the token with a Supabase anon client.
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { error: 'invalid' };
  }

  const userId = userData.user.id;
  const email = userData.user.email || null;

  // 3) Look up the role from public.profiles with a service-role client.
  //    Default to 'viewer' if the profile row can't be read.
  let role = 'viewer';
  if (serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: prof } = await admin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      if (prof?.role) role = prof.role;
    } catch (err) {
      console.error('[auth] profile role lookup failed:', err);
    }
  }

  return { userId, email, role };
}
