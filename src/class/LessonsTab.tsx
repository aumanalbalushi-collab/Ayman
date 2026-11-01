import { useEffect, useState, type FormEvent } from 'react';
import type { ClassCtx } from '../pages/ClassPage';
import { embedUrl, errText, fileName, fmtDate, openFile, supabase, uploadFile, type Lesson } from '../lib';

export default function LessonsTab({ cls, isTeacher }: ClassCtx) {
  const [items, setItems] = useState<Lesson[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [video, setVideo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await supabase.from('lessons').select('*').eq('class_id', cls.id).order('created_at', { ascending: true });
    setItems((data as Lesson[]) ?? []);
  }
  useEffect(() => { load(); }, [cls.id]);

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const file_path = file ? await uploadFile(`${cls.id}/lessons`, file) : null;
      const { error } = await supabase.from('lessons').insert({
        class_id: cls.id, title: title.trim(), content, video_url: video.trim() || null, file_path,
      });
      if (error) throw error;
      setTitle(''); setContent(''); setVideo(''); setFile(null); setShowForm(false);
      load();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }

  async function remove(l: Lesson) {
    if (!confirm('حذف الدرس؟')) return;
    if (l.file_path) await supabase.storage.from('class-files').remove([l.file_path]);
    await supabase.from('lessons').delete().eq('id', l.id);
    load();
  }

  return (
    <div className="stack">
      {isTeacher && !showForm && <button className="btn primary self-start" onClick={() => setShowForm(true)}>+ درس جديد</button>}
      {isTeacher && showForm && (
        <form className="card" onSubmit={save}>
          <h3>درس جديد</h3>
          <label>العنوان<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>المحتوى<textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="شرح الدرس..." /></label>
          <label>رابط فيديو (يوتيوب أو غيره، اختياري)<input dir="ltr" type="url" value={video} onChange={(e) => setVideo(e.target.value)} /></label>
          <label>ملف مرفق (اختياري)<input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'حفظ الدرس'}</button>
            <button type="button" className="btn ghost" onClick={() => setShowForm(false)}>إلغاء</button>
          </div>
        </form>
      )}
      {items === null && <div className="spinner" />}
      {items?.length === 0 && <div className="empty">لا توجد دروس بعد</div>}
      {items?.map((l, i) => {
        const open = openId === l.id;
        const emb = l.video_url ? embedUrl(l.video_url) : null;
        return (
          <article key={l.id} className="card">
            <button className="lesson-head" onClick={() => setOpenId(open ? null : l.id)}>
              <span className="num">{i + 1}</span>
              <strong>{l.title}</strong>
              <span className="muted small">{fmtDate(l.created_at, false)}</span>
            </button>
            {open && (
              <div className="lesson-body">
                {l.content && <p className="pre">{l.content}</p>}
                {emb && <div className="video"><iframe src={emb} title={l.title} allowFullScreen /></div>}
                {l.video_url && !emb && <a href={l.video_url} target="_blank" rel="noopener">مشاهدة الفيديو</a>}
                {l.file_path && <button className="btn ghost sm" onClick={() => openFile(l.file_path!)}>الملف المرفق: {fileName(l.file_path)}</button>}
                {isTeacher && <button className="link danger" onClick={() => remove(l)}>حذف الدرس</button>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
