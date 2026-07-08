import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import Events from './screens/Events';
import PageEditor from './screens/PageEditor';
import ComingSoon from './screens/ComingSoon';

// Stub routes: nav works, but the screen is a Phase 2 placeholder.
const STUBS = [
  ['programs', 'Programs'],
  ['impact', 'Impact Stats'],
  ['donations', 'Donations'],
  ['stories', 'News & Stories'],
  ['media', 'Media'],
  ['volunteers', 'Volunteers'],
  ['team', 'Team & Roles'],
  ['settings', 'Settings'],
];

function Gate() {
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
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/events" element={<Events />} />
          <Route path="/pages" element={<PageEditor />} />
          {STUBS.map(([path, title]) => (
            <Route key={path} path={`/${path}`} element={<ComingSoon title={title} />} />
          ))}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
