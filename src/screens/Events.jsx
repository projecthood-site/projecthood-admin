import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { dateBlock, eventMeta, tint, statusTint, relativeTime } from '../lib/format';
import Modal from '../components/Modal';
import Pill from '../components/StatusPill';

const TINT_OPTIONS = ['green', 'amber', 'purple', 'blue', 'red'];
const EMPTY_FORM = { title: '', description: '', starts_at: '', location: '', color_tint: 'green', capacity: '' };

// Roles: viewer = read-only; author/editor/owner can create/edit/set status;
// editor/owner can delete. (Server RLS is the real guard — this only shapes UI.)
const WRITE_ROLES = ['author', 'editor', 'owner'];
const DELETE_ROLES = ['editor', 'owner'];

// ISO -> value for <input type="datetime-local"> (local time, no seconds).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EventCard({ ev, rsvpCount, canWrite, canDelete, onCycleStatus, onEdit, onDelete, onViewRsvps, onCopyLink, busy }) {
  const [bg, fg] = tint(ev.color_tint || 'green');
  const { mon, day } = dateBlock(ev.starts_at);
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: 12, overflow: 'hidden', flexWrap: 'wrap' }}>
      <div
        style={{
          width: 78, flex: 'none', background: bg, color: fg, textAlign: 'center',
          padding: '14px 8px', alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}
      >
        <div className="ms" style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.06em' }}>{mon}</div>
        <div className="ak" style={{ fontSize: 36, lineHeight: '.9' }}>{day}</div>
      </div>
      <div style={{ flex: 1, padding: '14px 18px', minWidth: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span className="ak" style={{ fontSize: 22, lineHeight: '.9', color: 'var(--ink)' }}>{ev.title}</span>
          <Pill label={ev.status} tintName={statusTint(ev.status)} />
        </div>
        <div className="ms" style={{ fontWeight: 500, fontSize: 12, color: 'var(--muted)' }}>
          {eventMeta(ev.starts_at, ev.location) || 'No date set'}
          {ev.capacity != null && <span> · cap {ev.capacity}</span>}
        </div>
      </div>

      <button
        onClick={() => onViewRsvps(ev)}
        title="View RSVPs"
        style={{
          padding: '14px 20px', textAlign: 'right', flex: 'none', background: 'none',
          border: 'none', cursor: 'pointer', borderRadius: 8,
        }}
      >
        <div className="ak" style={{ fontSize: 26, color: 'var(--green)' }}>{rsvpCount}</div>
        <div className="label" style={{ fontSize: 9 }}>RSVPs</div>
      </button>

      <div style={{ padding: '12px 18px 12px 0', flex: 'none', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={() => onViewRsvps(ev)} style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
          View RSVPs
        </button>

        {ev.status === 'published' && (
          <button className="btn btn-ghost" onClick={() => onCopyLink(ev)} style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
            Copy RSVP link
          </button>
        )}

        {canWrite && (
          <>
            <button className="btn btn-ghost" onClick={() => onEdit(ev)} disabled={busy} style={{ padding: '8px 12px' }}>
              Edit
            </button>
            <button
              className={'btn ' + (busy ? 'btn-disabled' : 'btn-ghost')}
              disabled={busy}
              onClick={() => onCycleStatus(ev)}
              style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
              title="Cycle draft → scheduled → published"
            >
              {ev.status === 'published' ? 'Unpublish' : ev.status === 'draft' ? 'Schedule' : 'Publish'}
            </button>
          </>
        )}

        {canDelete && (
          <button
            className="link"
            onClick={() => onDelete(ev)}
            disabled={busy}
            style={{ padding: '8px 6px' }}
            title="Delete event"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function Events() {
  const toast = useToast();
  const { user, profile } = useAuth();
  const role = profile?.role || 'viewer';
  const canWrite = WRITE_ROLES.includes(role);
  const canDelete = DELETE_ROLES.includes(role);

  const [state, setState] = useState({ loading: true, error: null });
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Create/Edit form modal. editing = null for create, event object for edit.
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Delete confirm + RSVP viewer modals.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [rsvpModal, setRsvpModal] = useState(null); // { event, loading, error, rows }

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

    // RSVP headcounts: one query, tally client-side (sum of party_size).
    const { data: rsvps } = await supabase.from('rsvps').select('event_id, party_size');
    const tally = {};
    (rsvps || []).forEach((r) => {
      tally[r.event_id] = (tally[r.event_id] || 0) + (r.party_size || 1);
    });
    setCounts(tally);
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(ev) {
    setEditing(ev);
    setForm({
      title: ev.title || '',
      description: ev.description || '',
      starts_at: toLocalInput(ev.starts_at),
      location: ev.location || '',
      color_tint: ev.color_tint || 'green',
      capacity: ev.capacity != null ? String(ev.capacity) : '',
    });
    setShowForm(true);
  }

  async function saveEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.starts_at) {
      toast('Title and start date are required.');
      return;
    }
    setSaving(true);
    const fields = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      starts_at: new Date(form.starts_at).toISOString(),
      location: form.location.trim() || null,
      color_tint: form.color_tint,
      capacity: form.capacity ? Number(form.capacity) : null,
    };

    let error;
    if (editing) {
      ({ error } = await supabase
        .from('events')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', editing.id));
    } else {
      ({ error } = await supabase
        .from('events')
        .insert({ ...fields, status: 'draft', created_by: user?.id || null }));
    }
    setSaving(false);

    if (error) {
      toast(errMsg(error, editing ? "Couldn't save changes" : "Couldn't create event"));
      return;
    }
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    toast(editing ? 'Event updated.' : 'Event created as a draft.');
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
      toast(errMsg(error, 'Update failed'));
      return;
    }
    setEvents((list) => list.map((x) => (x.id === ev.id ? { ...x, status: next } : x)));
    toast(`Event ${next === 'draft' ? 'unpublished' : next}.`);
  }

  async function doDelete(ev) {
    setBusyId(ev.id);
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (error) {
      toast(errMsg(error, "Couldn't delete event"));
      return;
    }
    setEvents((list) => list.filter((x) => x.id !== ev.id));
    toast('Event deleted.');
  }

  async function copyLink(ev) {
    const url = `${window.location.origin}/rsvp/${ev.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('RSVP link copied to clipboard.');
    } catch {
      toast(`RSVP link: ${url}`);
    }
  }

  async function viewRsvps(ev) {
    setRsvpModal({ event: ev, loading: true, error: null, rows: [] });
    const { data, error } = await supabase
      .from('rsvps')
      .select('id, name, email, party_size, note, created_at')
      .eq('event_id', ev.id)
      .order('created_at', { ascending: false });
    if (error) {
      setRsvpModal({ event: ev, loading: false, error: error.message, rows: [] });
      return;
    }
    setRsvpModal({ event: ev, loading: false, error: null, rows: data || [] });
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <div className="note">
          {state.loading ? 'Loading events…' : `${events.length} event${events.length === 1 ? '' : 's'} · ordered by date`}
        </div>
        {canWrite && <button className="btn btn-primary" onClick={openCreate}>+ New event</button>}
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
            {canWrite
              ? "Create your first event. It'll start as a draft — publish it when you're ready for it to appear on the site."
              : 'Events your team creates will appear here.'}
          </p>
          {canWrite && <button className="btn btn-primary" onClick={openCreate}>+ New event</button>}
        </div>
      ) : (
        events.map((ev) => (
          <EventCard
            key={ev.id}
            ev={ev}
            rsvpCount={counts[ev.id] || 0}
            canWrite={canWrite}
            canDelete={canDelete}
            onCycleStatus={cycleStatus}
            onEdit={openEdit}
            onDelete={setConfirmDelete}
            onViewRsvps={viewRsvps}
            onCopyLink={copyLink}
            busy={busyId === ev.id}
          />
        ))
      )}

      {/* Create / Edit form */}
      {showForm && (
        <Modal title={editing ? 'Edit event' : 'New event'} onClose={() => (saving ? null : setShowForm(false))}>
          <form onSubmit={saveEvent}>
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
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Modal title="Delete event?" onClose={() => (busyId ? null : setConfirmDelete(null))}>
          <div style={{ padding: '20px 22px' }}>
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: 'var(--body)' }}>
              Delete <strong>{confirmDelete.title}</strong>? This can't be undone. Any RSVPs for this
              event will be removed too.
            </p>
          </div>
          <div style={{ padding: '0 22px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)} disabled={busyId === confirmDelete.id}>Cancel</button>
            <button
              className={'btn ' + (busyId === confirmDelete.id ? 'btn-disabled' : 'btn-primary')}
              disabled={busyId === confirmDelete.id}
              onClick={() => doDelete(confirmDelete)}
            >
              {busyId === confirmDelete.id ? 'Deleting…' : 'Delete event'}
            </button>
          </div>
        </Modal>
      )}

      {/* RSVP list */}
      {rsvpModal && (
        <Modal
          title={`RSVPs · ${rsvpModal.event.title}`}
          onClose={() => setRsvpModal(null)}
        >
          <div style={{ padding: '18px 22px', maxHeight: '64vh', overflowY: 'auto' }} className="scroll">
            {rsvpModal.loading ? (
              <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
            ) : rsvpModal.error ? (
              <div className="ms" style={{ color: 'var(--red-ink)', fontWeight: 600, fontSize: 13 }}>
                Couldn't load RSVPs: {rsvpModal.error}
              </div>
            ) : rsvpModal.rows.length === 0 ? (
              <p className="note" style={{ margin: 0, lineHeight: 1.6 }}>No RSVPs yet.</p>
            ) : (
              <>
                <div className="note" style={{ marginBottom: 14 }}>
                  {rsvpModal.rows.length} registration{rsvpModal.rows.length === 1 ? '' : 's'} ·{' '}
                  <strong>{rsvpModal.rows.reduce((s, r) => s + (r.party_size || 1), 0)}</strong> total headcount
                </div>
                {rsvpModal.rows.map((r) => (
                  <div key={r.id} className="row-div" style={{ padding: '10px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
                      <span className="ms" style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{r.name}</span>
                      <span className="ms" style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--green)' }}>
                        party of {r.party_size || 1}
                      </span>
                    </div>
                    <div className="ms" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {r.email} · {relativeTime(r.created_at)}
                    </div>
                    {r.note && (
                      <div style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 4, lineHeight: 1.5 }}>
                        "{r.note}"
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          <div style={{ padding: '0 22px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setRsvpModal(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Friendly message for RLS/permission failures vs. other errors.
function errMsg(error, fallback) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('row-level security') || m.includes('permission') || m.includes('policy')) {
    return "You don't have permission to make that change.";
  }
  return `${fallback}: ${error?.message || 'unknown error'}`;
}
