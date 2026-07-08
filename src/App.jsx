import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import PageEditor from './screens/PageEditor';
import Team from './screens/Team';
import Events from './screens/Events';
import Media from './screens/Media';
import RsvpPage from './screens/RsvpPage';

// Team-test scope: website editing + Media library + Community/Events. Other old
// screens are removed; their routes redirect to /dashboard so stale links don't 404.
const RETIRED = ['programs', 'impact', 'donations', 'stories', 'volunteers', 'settings'];

// Authenticated admin. Everything here requires a signed-in staff session.
function AdminGate() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (!session) return <Login />;

  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/pages" element={<PageEditor />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/events" element={<Events />} />
          <Route path="/media" element={<Media />} />
          <Route path="/team" element={<Team />} />
          {RETIRED.map((path) => (
            <Route key={path} path={`/${path}`} element={<Navigate to="/dashboard" replace />} />
          ))}
          <Route path="/" element={<Navigate to="/pages" replace />} />
          <Route path="*" element={<Navigate to="/pages" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* PUBLIC — no session required. Must sit OUTSIDE the auth gate so a
              visitor with no login can RSVP. */}
          <Route path="/rsvp/:eventId" element={<RsvpPage />} />
          {/* Everything else goes through the authenticated admin gate. */}
          <Route path="*" element={<AdminGate />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
