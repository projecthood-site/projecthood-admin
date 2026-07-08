import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the profile row (name + role) whenever the user changes.
  useEffect(() => {
    let active = true;
    const uid = session?.user?.id;
    if (!uid) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', uid)
      .single()
      .then(({ data }) => {
        if (active) setProfile(data || null);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const value = {
    session,
    user: session?.user || null,
    profile,
    loading,
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
