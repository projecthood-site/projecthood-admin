import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

// Page kicker + title per route, mirroring the prototype's meta map.
const META = {
  '/dashboard': { k: 'Overview', t: 'Dashboard' },
  '/pages': { k: 'Content', t: 'Page Editor' },
  '/programs': { k: 'Content', t: 'Programs' },
  '/impact': { k: 'Content', t: 'Impact Stats' },
  '/donations': { k: 'Community', t: 'Donations' },
  '/events': { k: 'Community', t: 'Events' },
  '/stories': { k: 'Community', t: 'News & Stories' },
  '/media': { k: 'Library', t: 'Media' },
  '/volunteers': { k: 'People', t: 'Volunteers' },
  '/team': { k: 'People', t: 'Team & Roles' },
  '/settings': { k: 'System', t: 'Settings' },
};

export default function Layout() {
  const { pathname } = useLocation();
  const meta = META[pathname] || { k: '', t: '' };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        <TopBar kicker={meta.k} title={meta.t} />
        <main className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '30px 32px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
