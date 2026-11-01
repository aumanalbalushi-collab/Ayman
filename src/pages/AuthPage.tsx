import { useState, type FormEvent } from 'react';
import { errText, supabase, type Role } from '../lib';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { data: { full_name: name.trim(), role } },
        });
        if (error) throw error;
        if (!data.session) setInfo('تم إنشاء الحساب. افتح بريدك وأكّد التسجيل ثم سجّل الدخول.');
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card narrow" onSubmit={submit}>
        <div className="auth-brand"><img src="/icon.svg" alt="" width={56} height={56} /><h1>مدرستي</h1></div>
        <div className="seg">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>تسجيل الدخول</button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>حساب جديد</button>
        </div>
        {mode === 'register' && (
          <>
            <label>الاسم الكامل<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="role-pick">
              <button type="button" className={role === 'student' ? 'on' : ''} onClick={() => setRole('student')}>أنا طالب</button>
              <button type="button" className={role === 'teacher' ? 'on' : ''} onClick={() => setRole('teacher')}>أنا معلم</button>
            </div>
          </>
        )}
        <label>البريد الإلكتروني<input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>كلمة المرور<input type="password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        {info && <p className="success">{info}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? '...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}</button>
      </form>
    </div>
  );
}
