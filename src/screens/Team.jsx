import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { relativeTime } from '../lib/format';
import Pill from '../components/StatusPill';

// Role -> pill tint. Owner reads as "trusted" green, editor amber, the rest neutral.
const ROLE_TINT = { owner: 'green', editor: 'amber', author: 'neutral', viewer: 'neutral' };

const ROLE_OPTIONS = [
  ['owner', 'Owner'],
  ['editor', 'Editor'],
  ['author', 'Author'],
  ['viewer', 'Viewer'],
];

const ROLE_CARDS = [
  ['Owner', 'Full access: edit, publish, and manage team roles.'],
  ['Editor', 'Edit pages and publish changes to the live site.'],
  ['Author', 'Edit pages; an Editor or Owner publishes.'],
  ['Viewer', 'Read-only: can view but not edit or publish.'],
];

function initials(name, email) {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

// Attach the caller's Supabase access token (mirrors Dashboard/PageEditor).
async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function MemberRow({ member, isSelf, busy, onChangeRole }) {
  const name = member.full_name || member.email || 'Unknown';
  const meta = member.last_active
    ? `${member.email || ''}${member.email ? ' · ' : ''}active ${relativeTime(member.last_active)}`
    : `${member.email || ''}${member.email ? ' · ' : ''}${member.role}`;

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, padding: '14px 18px' }}>
      <div
        className="ms"
        style={{
          width: 40, height: 40, flex: 'none', background: 'var(--green)', color: '#fff',
          borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 14,
        }}
      >
        {initials(member.full_name, member.email)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="ms"
            style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {name}
          </span>
          {isSelf && <span className="ms" style={{ fontWeight: 600, fontSize: 10, color: 'var(--faint)' }}>(you)</span>}
          <Pill label={member.role} tintName={ROLE_TINT[member.role] || 'neutral'} />
        </div>
        <div className="ms" style={{ fontWeight: 500, fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {meta}
        </div>
      </div>

      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        {busy && <span className="spinner" />}
        <select
          className="field"
          style={{ width: 128, padding: '8px 10px' }}
          value={member.role}
          disabled={busy}
          onChange={(e) => onChangeRole(member, e.target.value)}
          aria-label={`Role for ${name}`}
        >
          {ROLE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function Team() {
  const toast = useToast();
  const { user, profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [state, setState] = useState({ loading: true, error: null });
  const [members, setMembers] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, created_at, last_active')
      .order('created_at', { ascending: true });

    if (error) {
      setState({ loading: false, error: error.message });
      return;
    }
    setMembers(data || []);
    setState({ loading: false, error: null });
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  async function changeRole(member, nextRole) {
    if (nextRole === member.role) return;
    const prevRole = member.role;
    setBusyId(member.id);
    try {
      const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
      const res = await fetch('/api/set-role', {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetUserId: member.id, role: nextRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || `Status ${res.status}`);
      // Optimistic update on success.
      setMembers((list) => list.map((m) => (m.id === member.id ? { ...m, role: nextRole } : m)));
      toast(`${member.full_name || member.email || 'Member'} is now ${nextRole}.`);
    } catch (err) {
      // Roll the select back to the previous role and surface the message.
      setMembers((list) => list.map((m) => (m.id === member.id ? { ...m, role: prevRole } : m)));
      toast(err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Non-owners: calm "Owners only" notice, nothing else.
  if (!isOwner) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="card" style={{ padding: '44px 36px', textAlign: 'center' }}>
          <div className="ak" style={{ fontSize: 32, color: 'var(--ink)', marginBottom: 10 }}>Owners only</div>
          <p className="note" style={{ maxWidth: '42ch', margin: '0 auto', lineHeight: 1.6 }}>
            Managing team roles is limited to owners. If you need a change, ask an owner on your team.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <p className="note" style={{ margin: '0 0 20px', lineHeight: 1.6, maxWidth: '64ch' }}>
        Manage who can access the admin and what they can do. New sign-ins start as Viewer.
      </p>

      {state.error ? (
        <div className="card" style={{ padding: 24 }}>
          <div className="ms" style={{ color: 'var(--red-ink)', fontWeight: 600, fontSize: 13 }}>
            Couldn't load the team: {state.error}
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={load}>Try again</button>
        </div>
      ) : state.loading ? (
        <div className="card" style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <span className="spinner" /> <span className="note">Loading team…</span>
        </div>
      ) : members.length === 0 ? (
        <div className="card" style={{ padding: '44px 36px', textAlign: 'center' }}>
          <div className="ak" style={{ fontSize: 36, color: 'var(--line)', marginBottom: 8 }}>No members yet</div>
          <p className="note" style={{ maxWidth: '40ch', margin: '0 auto', lineHeight: 1.6 }}>
            As people sign in they'll appear here and start as Viewer.
          </p>
        </div>
      ) : (
        members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isSelf={m.id === user?.id}
            busy={busyId === m.id}
            onChangeRole={changeRole}
          />
        ))
      )}

      {/* Roles & permissions reference */}
      <div className="navcap" style={{ marginTop: 28, marginBottom: 12 }}>Roles &amp; permissions</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {ROLE_CARDS.map(([title, desc]) => (
          <div key={title} className="card" style={{ padding: '16px 18px' }}>
            <div style={{ marginBottom: 8 }}>
              <Pill label={title.toLowerCase()} tintName={ROLE_TINT[title.toLowerCase()] || 'neutral'} />
            </div>
            <div className="ms" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--body)' }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
