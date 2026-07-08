import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { dateBlock, eventMeta, tint, statusTint } from '../lib/format';
import Modal from '../components/Modal';
import Pill from '../components/StatusPill';

const TINT_OPTIONS = ['green', 'red', 'purple', 'blue', 'amber'];
const EMPTY_FORM = { title: '', description: '', starts_at: '', location: '', color_tint: 'green', capacity: '' };

function EventCard({ ev, rsvpCount, onCycleStatus, busy }) {
  const [bg, fg] = tint(ev.color_tint || 'green');
  const { mon, day } = dateBlock(ev.starts_at);
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: 12, overflow: 'hidden' }}>
      <div
        style={{
          width: 78, flex: 'none', background: bg, color: fg, textAlign: 'center',
          padding: '14px 8px', alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}
      >
        <div className="ms" style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.06em' }}>{mon}</div>
        <div className="ak" style={{ fontSize: 36, lineHeight: '.9' }}>{day}</div>
      </div>
      <div style={{ flex: 1, padding: '14px 18px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span className="ak" style={{ fontSize: 22, lineHeight: '.9', color: 'var(--ink)' }}>{ev.title}</span>
          <Pill label={ev.status} tintName={statusTint(ev.status)} />
        </div>
        <div className="ms" style={{ fontWeight: 500, fontSize: 12, color: 'var(--muted)' }}>
          {eventMeta(ev.starts_at, ev.location) || 'No date set'}
        </div>
      </div>
      <div style={{ padding: '14px 20px', textAlign: 'right', flex: 'none' }}>
        <div className="ak" style={{ fontSize: 26, color: 'var(--green)' }}>{rsvpCount}</div>
        <div className="label" style={{ fontSize: 9 }}>RSVPs</div>
      </div>
      <div style={{ padding: '14px 20px 14px 0', flex: 'none' }}>
        <button
          className={'btn ' + (busy ? 'btn-disabled' : 'btn-ghost')}
          disabled={busy}
          onClick={() => onCycleStatus(ev)}
          style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
          title="Cycle draft → scheduled → published"
        >
          {ev.status === 'published' ? 'Unpublish' : ev.status === 'draft' ? 'Schedule' : 'Publish'}
        </button>
      </div>
    </div>
  );
}

export default function Events() {
  const toast = useToast();
  const { user } = useAuth();

  const [state, setState] = useState({ loading: true, error: null });
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    const { data, error } = await supabase
      .from('events')
      .select('id, title, description, starts_at, location, color_tint, status, capacity')
      .order('starts_at', { ascending: true });

    if (error) {
      setState({ loading: false, error: error.message });
      return;
    }
    setEvents(data || []);
    setState({ loading: false, error: null });

    // RSVP counts: one query, tally client-side.
    const { data: rsvps } = await supabase.from('rsvps').select('event_id, party_size');
    const tally = {};
    (rsvps || []).forEach((r) => {
      tally[r.event_id] = (tally[r.event_id] || 0) + (r.party_size || 1);
    });
    setCounts(tally);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.starts_at) {
      toast('Title and start date are required.');
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      starts_at: new Date(form.starts_at).toISOString(),
      location: form.location.trim() || null,
      color_tint: form.color_tint,
      capacity: form.capacity ? Number(form.capacity) : null,
      status: 'draft',
      created_by: user?.id || null,
    };
    const { error } = await supabase.from('events').insert(payload);
    setSaving(false);
    if (error) {
      toast(`Couldn't create event: ${error.message}`);
      return;
    }
    setShowForm(false);
    setForm(EMPTY_FORM);
    toast('Event created as a draft.');
    load();
  }

  // draft -> scheduled -> published -> (unpublish) draft
  async function cycleStatus(ev) {
    const next = ev.status === 'draft' ? 'scheduled' : ev.status === 'scheduled' ? 'published' : 'draft';
    setBusyId(ev.id);
    const { error } = await supabase
      .from('events')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', ev.id);
    setBusyId(null);
    if (error) {
      toast(`Update failed: ${error.message}`);
      return;
    }
    setEvents((list) => list.map((x) => (x.id === ev.id ? { ...x, status: next } : x)));
    toast(`Event ${next === 'draft' ? 'unpublished' : next}.`);
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="note">
          {state.loading ? 'Loading events…' : `${events.length} event${events.length === 1 ? '' : 's'} · ordered by date`}
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ New event</button>
      </div>

      {state.error ? (
        <div className="card" style={{ padding: 24 }}>
          <div className="ms" style={{ color: 'var(--red-ink)', fontWeight: 600, fontSize: 13 }}>
            Couldn't load events: {state.error}
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={load}>Try again</button>
        </div>
      ) : state.loading ? (
        <div className="card" style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <span className="spinner" /> <span className="note">Loading…</span>
        </div>
      ) : events.length === 0 ? (
        <div className="card" style={{ padding: '44px 36px', textAlign: 'center' }}>
          <div className="ak" style={{ fontSize: 40, color: 'var(--line)', marginBottom: 8 }}>No events yet</div>
          <p className="note" style={{ maxWidth: '40ch', margin: '0 auto 18px', lineHeight: 1.6 }}>
            Create your first event. It'll start as a draft — publish it when you're ready for it to
            appear on the site.
          </p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ New event</button>
        </div>
      ) : (
        events.map((ev) => (
          <EventCard
            key={ev.id}
            ev={ev}
            rsvpCount={counts[ev.id] || 0}
            onCycleStatus={cycleStatus}
            busy={busyId === ev.id}
          />
        ))
      )}

      {showForm && (
        <Modal title="New event" onClose={() => (saving ? null : setShowForm(false))}>
          <form onSubmit={createEvent}>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}>
              <label style={{ display: 'block' }}>
                <span className="label">Title</span>
                <input className="field" style={{ marginTop: 6 }} value={form.title} onChange={set('title')} required />
              </label>
              <label style={{ display: 'block' }}>
                <span className="label">Description</span>
                <textarea className="field" style={{ marginTop: 6, minHeight: 72, resize: 'vertical' }} value={form.description} onChange={set('description')} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <label style={{ display: 'block' }}>
                  <span className="label">Starts at</span>
                  <input type="datetime-local" className="field" style={{ marginTop: 6 }} value={form.starts_at} onChange={set('starts_at')} required />
                </label>
                <label style={{ display: 'block' }}>
                  <span className="label">Capacity</span>
                  <input type="number" min="1" className="field" style={{ marginTop: 6 }} placeholder="Unlimited" value={form.capacity} onChange={set('capacity')} />
                </label>
              </div>
              <label style={{ display: 'block' }}>
                <span className="label">Location</span>
                <input className="field" style={{ marginTop: 6 }} value={form.location} onChange={set('location')} />
              </label>
              <label style={{ display: 'block' }}>
                <span className="label">Color tint</span>
                <select className="field" style={{ marginTop: 6 }} value={form.color_tint} onChange={set('color_tint')}>
                  {TINT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <div style={{ padding: '0 22px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button type="submit" className={'btn ' + (saving ? 'btn-disabled' : 'btn-primary')} disabled={saving}>
                {saving ? 'Creating…' : 'Create event'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
