import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { configured } from './lib';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import ClassPage from './pages/ClassPage';
import AssignmentPage from './pages/AssignmentPage';
import './styles.css';

function Gate() {
  const { session, profile, loading } = useAuth();
  if (!configured) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h1>مدرستي</h1>
          <p>التطبيق غير مربوط بقاعدة البيانات بعد.</p>
          <p className="muted">أنشئ ملف <code>.env</code> وضع فيه <code>VITE_SUPABASE_URL</code> و<code>VITE_SUPABASE_ANON_KEY</code> كما في ملف README.</p>
        </div>
      </div>
    );
  }
  if (loading) return <div className="center-page"><div className="spinner" /></div>;
  if (!session) return <AuthPage />;
  if (!profile) return <div className="center-page"><div className="spinner" /></div>;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/class/:id" element={<ClassPage />} />
        <Route path="/class/:id/assignment/:aid" element={<AssignmentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
