import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Team-test scope: website editing + community events. All routes are real
// and visible to every signed-in staff member.
const NAV = [
  { label: 'Website', items: [['/pages', 'Edit Pages'], ['/dashboard', 'Publish & Status']] },
  { label: 'Library', items: [['/media', 'Media']] },
  { label: 'Community', items: [['/events', 'Events']] },
];

// Owner-only navigation. Non-owners never see these.
const OWNER_NAV = [
  { label: 'Admin', items: [['/team', 'Team & Roles']] },
];

function initials(name, email) {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function Sidebar() {
  const { user, profile, signOut } = useAuth();
  const name = profile?.full_name || user?.email || 'Signed in';
  const role = profile?.role ? profile.role[0].toUpperCase() + profile.role.slice(1) : 'Loading role…';

  // Owners get the Admin group (Team & Roles) appended.
  const nav = profile?.role === 'owner' ? [...NAV, ...OWNER_NAV] : NAV;

  return (
    <aside
      style={{
        width: 248, flex: 'none', background: '#faf9f7',
        borderRight: '1px solid var(--line)', display: 'flex',
        flexDirection: 'column', height: '100%',
      }}
    >
      <div style={{ padding: '22px 20px 8px' }}>
        <img src="/assets/logo/PH_Logo_Green.png" alt="Project H.O.O.D." style={{ width: 132, display: 'block' }} />
        <div
          className="ms"
          style={{
            fontWeight: 700, fontSize: 9, letterSpacing: '.14em',
            textTransform: 'uppercase', color: 'var(--faint)', marginTop: 12,
          }}
        >
          Website Admin
        </div>
      </div>

      <nav className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 12px 20px' }}>
        {nav.map((group) => (
          <div key={group.label}>
            <div className="navcap">{group.label}</div>
            {group.items.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => 'navitem' + (isActive ? ' active' : '')}
              >
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div
        style={{
          padding: '14px 16px', borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 11,
        }}
      >
        <div
          className="ms"
          style={{
            width: 36, height: 36, flex: 'none', background: 'var(--green)',
            color: '#fff', borderRadius: 9, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: 800, fontSize: 13,
          }}
        >
          {initials(profile?.full_name, user?.email)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="ms"
            style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {name}
          </div>
          <div className="ms" style={{ fontWeight: 500, fontSize: 10.5, color: 'var(--muted)' }}>{role}</div>
        </div>
        <button
          className="ms"
          onClick={signOut}
          title="Sign out"
          style={{
            flex: 'none', background: '#fff', border: '1px solid var(--line)',
            borderRadius: 8, padding: '7px 9px', fontWeight: 700, fontSize: 10,
            letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
