import { useEffect, useState, type FormEvent } from 'react';
import type { ClassCtx } from '../pages/ClassPage';
import { errText, fmtDate, supabase, type Announcement } from '../lib';

export default function AnnouncementsTab({ cls, isTeacher, me, people }: ClassCtx) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const { data } = await supabase.from('announcements').select('*').eq('class_id', cls.id).order('created_at', { ascending: false });
    setItems((data as Announcement[]) ?? []);
  }
  useEffect(() => { load(); }, [cls.id]);

  async function post(e: FormEvent) {
    e.preventDefault(); setError('');
    const { error } = await supabase.from('announcements').insert({ class_id: cls.id, author_id: me.id, body: body.trim() });
    if (error) return setError(errText(error));
    setBody(''); load();
  }

  async function remove(id: string) {
    if (!confirm('حذف الإعلان؟')) return;
    await supabase.from('announcements').delete().eq('id', id);
    load();
  }

  return (
    <div className="stack">
      {isTeacher && (
        <form className="card" onSubmit={post}>
          <label>إعلان جديد للفصل<textarea required rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="اكتب إعلاناً يصل لكل الطلاب..." /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary">نشر</button>
        </form>
      )}
      {items === null && <div className="spinner" />}
      {items?.length === 0 && <div className="empty">لا توجد إعلانات بعد</div>}
      {items?.map((a) => (
        <article key={a.id} className="card">
          <div className="row-between">
            <strong>{people.get(a.author_id)?.full_name ?? 'المعلم'}</strong>
            <span className="muted small">{fmtDate(a.created_at)}</span>
          </div>
          <p className="pre">{a.body}</p>
          {isTeacher && <button className="link danger" onClick={() => remove(a.id)}>حذف</button>}
        </article>
      ))}
    </div>
  );
}
