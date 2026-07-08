import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import PageEditor from './screens/PageEditor';
import Team from './screens/Team';

// Team-test scope: only website editing is exposed. Old screens are removed
// from the app; their routes redirect to /dashboard so stale links don't 404.
const RETIRED = ['programs', 'impact', 'donations', 'events', 'stories', 'media', 'volunteers', 'settings'];

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
          <Route path="/pages" element={<PageEditor />} />
          <Route path="/dashboard" element={<Dashboard />} />
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
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
