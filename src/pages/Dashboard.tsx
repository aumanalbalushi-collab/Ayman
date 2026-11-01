import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errText, supabase, type ClassRow } from '../lib';

export default function Dashboard() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const isTeacher = profile?.role === 'teacher';
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from('classes').select('*').order('created_at', { ascending: false });
    setClasses((data as ClassRow[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { data, error } = await supabase.from('classes')
      .insert({ name: name.trim(), description: desc.trim(), teacher_id: profile!.id }).select().single();
    setBusy(false);
    if (error) return setError(errText(error));
    nav('/class/' + (data as ClassRow).id);
  }

  async function join(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { data, error } = await supabase.rpc('join_class', { code });
    setBusy(false);
    if (error) return setError(errText(error));
    nav('/class/' + data);
  }

  return (
    <div>
      <h1 className="page-title">أهلاً {profile?.full_name}</h1>
      <div className="grid-2">
        <section>
          <h2>فصولي</h2>
          {classes === null && <div className="spinner" />}
          {classes?.length === 0 && (
            <div className="empty">{isTeacher ? 'لم تنشئ أي فصل بعد. ابدأ بإنشاء فصلك الأول.' : 'لم تنضم إلى أي فصل بعد. اطلب رمز الفصل من معلمك.'}</div>
          )}
          <div className="class-list">
            {classes?.map((c) => (
              <Link key={c.id} to={'/class/' + c.id} className="class-card">
                <strong>{c.name}</strong>
                {c.description && <span className="muted">{c.description}</span>}
                {isTeacher && <span className="code-chip">الرمز: {c.join_code}</span>}
              </Link>
            ))}
          </div>
        </section>
        <aside>
          {isTeacher ? (
            <form className="card" onSubmit={create}>
              <h3>إنشاء فصل جديد</h3>
              <label>اسم الفصل<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: رياضيات - الصف الثامن" /></label>
              <label>وصف (اختياري)<textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
              {error && <p className="error">{error}</p>}
              <button className="btn primary block" disabled={busy}>إنشاء</button>
            </form>
          ) : (
            <form className="card" onSubmit={join}>
              <h3>الانضمام إلى فصل</h3>
              <label>رمز الفصل<input required dir="ltr" className="code-input" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" /></label>
              {error && <p className="error">{error}</p>}
              <button className="btn primary block" disabled={busy}>انضمام</button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
