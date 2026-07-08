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
        )}
      </div>
    </div>
  );
}
