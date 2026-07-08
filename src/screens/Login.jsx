import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus('error');
      setError(error.message);
    } else {
      setStatus('sent');
    }
  }

  async function onGoogle() {
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        // Hint Google to prefer the org's Workspace accounts
        queryParams: { hd: 'projecthood.org', prompt: 'select_account' },
      },
    });
    if (error) {
      setStatus('error');
      setError(error.message);
    }
  }

  const googleG = (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none' }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg)', padding: 24,
      }}
    >
      <div className="card" style={{ width: 'min(420px, 100%)', padding: '34px 32px', textAlign: 'center' }}>
        <img
          src="/assets/logo/PH_Logo_Green.png"
          alt="Project H.O.O.D."
          style={{ width: 150, display: 'block', margin: '0 auto 18px' }}
        />
        <div className="kicker" style={{ marginBottom: 4 }}>Website Admin</div>
        <h1 className="ak" style={{ fontSize: 34, lineHeight: '.9', color: 'var(--ink)', margin: '0 0 8px' }}>
          Sign in
        </h1>
        <p className="note" style={{ margin: '0 0 22px', lineHeight: 1.5 }}>
          Enter your staff email and we'll send you a secure sign-in link — no password needed.
        </p>

        {status === 'sent' ? (
          <div
            className="ms"
            style={{
              background: 'var(--green-t)', color: 'var(--green-d)', borderRadius: 9,
              padding: '16px 18px', fontWeight: 600, fontSize: 13.5, lineHeight: 1.5,
            }}
          >
            Check your inbox — we sent a magic link to <strong>{email}</strong>. Open it on this
            device to finish signing in.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onGoogle}
              className="ms"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, background: '#fff', border: '1.5px solid var(--ink)', borderRadius: 9,
                padding: '11px 16px', fontWeight: 700, fontSize: 13.5, color: 'var(--ink)',
                cursor: 'pointer', marginBottom: 18,
              }}
            >
              {googleG} Continue with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 18px' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              <span className="ms" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>or</span>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>

          <form onSubmit={onSubmit} style={{ textAlign: 'left' }}>
            <label style={{ display: 'block' }}>
              <span className="label">Email address</span>
              <input
                type="email"
                required
                autoFocus
                className="field"
                style={{ marginTop: 6 }}
                placeholder="you@projecthood.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            {status === 'error' && (
              <div
                className="ms"
                style={{
                  marginTop: 12, background: '#f7ded9', color: 'var(--red-ink)',
                  borderRadius: 9, padding: '10px 12px', fontWeight: 600, fontSize: 12.5,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              className={'btn ' + (status === 'sending' ? 'btn-disabled' : 'btn-primary')}
              disabled={status === 'sending'}
              style={{ width: '100%', marginTop: 18 }}
            >
              {status === 'sending' ? 'Sending link…' : 'Send magic link'}
            </button>
          </form>
          </>
        )}
      </div>
    </div>
  );
}
