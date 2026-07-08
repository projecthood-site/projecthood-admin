import { createClient } from '@supabase/supabase-js';

// Client-side Supabase client. Uses the browser-safe VITE_ env vars.
// Row-Level Security (see Phase2_supabase_schema.sql) protects the data.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Non-fatal at build time; surfaces clearly during local dev if unset.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
    'Copy .env.example to .env and fill them in.'
  );
}

export const supabase = createClient(url || '', anonKey || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
