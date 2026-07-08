import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// PUBLIC, no-login RSVP page. Rendered OUTSIDE the auth Gate in App.jsx so a
// visitor with no session can reach /rsvp/:eventId. It reads the event with the
// ANON client (RLS returns the row only when status = 'published') and submits
// to the public /api/rsvp serverless endpoint.

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const EMPTY = { name: '', email: '', party_size: '1', note: '', hp: '' };

export default function RsvpPage() {
  const { eventId } = useParams();

  const [state, setState] = useState({ loading: true, error: null });
  const [event, setEvent] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    const { data, error } = await supabase
      .from('events')
      .select('id, title, description, starts_at, location, status')
      .eq('id', eventId)
      .maybeSingle();

    // RLS only returns published events to anon. Anything else => "not open".
    if (error || !data || data.status !== 'published') {
      setState({ loading: false, error: 'closed' });
      return;
    }
    setEvent(data);
    setState({ loading: false, error: null });
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim() || !form.email.trim()) {
      setFormError('Please add your name and email.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          name: form.name.trim(),
          email: form.email.trim(),
          party_size: Number(form.party_size) || 1,
          note: form.note.trim() || null,
          hp: form.hp,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || 'Something went wrong. Please try again.');
      }
      setDone(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh', background: 'var(--bg)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 18px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img
            src="/assets/logo/PH_Logo_Green.png"
            alt="Project H.O.O.D."
            style={{ width: 150, display: 'inline-block' }}
          />
        </div>

        {state.loading ? (
          <div className="card" style={{ padding: 44, display: 'flex', justifyContent: 'center' }}>
            <span className="spinner" />
          </div>
        ) : state.error ? (
          <div className="card" style={{ padding: '44px 34px', textAlign: 'center' }}>
            <div className="ak" style={{ fontSize: 34, color: 'var(--ink)', marginBottom: 10 }}>
              Not open for RSVPs
            </div>
            <p className="note" style={{ maxWidth: '38ch', margin: '0 auto', lineHeight: 1.6 }}>
              This event isn't open for RSVPs right now. If you think this is a mistake, please
              reach out to the Project H.O.O.D. team.
            </p>
          </div>
        ) : done ? (
          <div className="card" style={{ padding: '48px 34px', textAlign: 'center' }}>
            <div
              className="ms"
              style={{
                width: 64, height: 64, margin: '0 auto 18px', borderRadius: '50%',
                background: 'var(--green-t)', color: 'var(--green)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800,
              }}
            >
              ✓
            </div>
            <div className="ak" style={{ fontSize: 32, color: 'var(--green)', marginBottom: 10 }}>
              You're on the list!
            </div>
            <p className="note" style={{ maxWidth: '36ch', margin: '0 auto', lineHeight: 1.6 }}>
              We'll see you there. Thanks for RSVPing to <strong>{event.title}</strong>.
            </p>
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            {/* Event header */}
            <div style={{ background: 'var(--green)', color: '#fff', padding: '26px 30px' }}>
              <div
                className="ms"
                style={{ fontWeight: 700, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 8 }}
              >
                You're invited
              </div>
              <div className="ak" style={{ fontSize: 34, lineHeight: 0.95 }}>{event.title}</div>
              <div className="ms" style={{ fontWeight: 600, fontSize: 13.5, marginTop: 14, opacity: 0.95 }}>
                {formatWhen(event.starts_at)}
              </div>
              {event.location && (
                <div className="ms" style={{ fontWeight: 500, fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                  {event.location}
                </div>
              )}
            </div>

            {event.description && (
              <div style={{ padding: '18px 30px 0' }}>
                <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: 'var(--body)' }}>
                  {event.description}
                </p>
              </div>
            )}

            {/* RSVP form */}
            <form onSubmit={submit}>
              <div style={{ padding: '20px 30px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label style={{ display: 'block' }}>
                  <span className="label">Name</span>
                  <input
                    className="field" style={{ marginTop: 6 }} value={form.name}
                    onChange={set('name')} maxLength={120} required autoComplete="name"
                  />
                </label>
                <label style={{ display: 'block' }}>
                  <span className="label">Email</span>
                  <input
                    className="field" style={{ marginTop: 6 }} type="email" value={form.email}
                    onChange={set('email')} required autoComplete="email"
                  />
                </label>
                <label style={{ display: 'block' }}>
                  <span className="label">Party size</span>
                  <input
                    className="field" style={{ marginTop: 6 }} type="number" min="1" max="20"
                    value={form.party_size} onChange={set('party_size')}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  <span className="label">Note (optional)</span>
                  <textarea
                    className="field" style={{ marginTop: 6, minHeight: 64, resize: 'vertical' }}
                    value={form.note} onChange={set('note')} maxLength={500}
                    placeholder="Anything we should know?"
                  />
                </label>

                {/* Honeypot: hidden from humans, tempting to bots. */}
                <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                  <label>
                    Leave this field empty
                    <input
                      type="text" name="hp" tabIndex={-1} autoComplete="off"
                      value={form.hp} onChange={set('hp')}
                    />
                  </label>
                </div>

                {formError && (
                  <div
                    className="ms"
                    style={{ color: 'var(--red-ink)', fontWeight: 600, fontSize: 13, lineHeight: 1.5 }}
                  >
                    {formError}
                  </div>
                )}
              </div>

              <div style={{ padding: '0 30px 26px' }}>
                <button
                  type="submit"
                  className={'btn ' + (submitting ? 'btn-disabled' : 'btn-green')}
                  disabled={submitting}
                  style={{ width: '100%', padding: '14px 18px', fontSize: 13 }}
                >
                  {submitting ? 'Sending…' : "Count me in"}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="note" style={{ textAlign: 'center', marginTop: 18, fontSize: 11.5 }}>
          Project H.O.O.D. · Restoring hope, opportunity &amp; ownership
        </div>
      </div>
    </div>
  );
}
