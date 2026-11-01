import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ClassCtx } from '../pages/ClassPage';
import { errText, fmtDate, supabase, type Assignment, type Submission } from '../lib';

interface DraftQ { prompt: string; options: string[]; correct: number }
const blankQ = (): DraftQ => ({ prompt: '', options: ['', ''], correct: 0 });

export default function AssignmentsTab({ cls, isTeacher, me, students }: ClassCtx) {
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const { data } = await supabase.from('assignments').select('*').eq('class_id', cls.id).order('created_at', { ascending: false });
    const list = (data as Assignment[]) ?? [];
    setItems(list);
    if (list.length) {
      const q = supabase.from('submissions').select('*').in('assignment_id', list.map((a) => a.id));
      const { data: s } = isTeacher ? await q : await q.eq('student_id', me.id);
      setSubs((s as Submission[]) ?? []);
    }
  }
  useEffect(() => { load(); }, [cls.id]);

  return (
    <div className="stack">
      {isTeacher && !showForm && <button className="btn primary self-start" onClick={() => setShowForm(true)}>+ واجب أو اختبار جديد</button>}
      {isTeacher && showForm && <NewAssignment classId={cls.id} onDone={() => { setShowForm(false); load(); }} />}
      {items === null && <div className="spinner" />}
      {items?.length === 0 && <div className="empty">لا توجد واجبات أو اختبارات بعد</div>}
      {items?.map((a) => {
        const mine = subs.filter((s) => s.assignment_id === a.id);
        const late = a.due_at && new Date(a.due_at) < new Date();
        return (
          <Link key={a.id} to={`/class/${cls.id}/assignment/${a.id}`} className="card item-link">
            <div className="row-between">
              <div>
                <span className={'kind ' + a.kind}>{a.kind === 'quiz' ? 'اختبار' : 'واجب'}</span>
                <strong>{a.title}</strong>
              </div>
              {isTeacher ? (
                <span className="muted small">{mine.length} / {students.length} سلّموا</span>
              ) : mine[0] ? (
                mine[0].score !== null
                  ? <span className="pill ok">{mine[0].score} / {a.max_score}</span>
                  : <span className="pill">تم التسليم</span>
              ) : (
                <span className={'pill ' + (late ? 'bad' : 'warn')}>{late ? 'فات الموعد' : 'لم يُسلَّم'}</span>
              )}
            </div>
            {a.due_at && <span className="muted small">الموعد النهائي: {fmtDate(a.due_at)}</span>}
          </Link>
        );
      })}
    </div>
  );
}

function NewAssignment({ classId, onDone }: { classId: string; onDone: () => void }) {
  const [kind, setKind] = useState<'assignment' | 'quiz'>('assignment');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [maxScore, setMaxScore] = useState(100);
  const [due, setDue] = useState('');
  const [qs, setQs] = useState<DraftQ[]>([blankQ()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setQ = (i: number, patch: Partial<DraftQ>) => setQs((p) => p.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    if (kind === 'quiz') {
      const bad = qs.findIndex((q) => !q.prompt.trim() || q.options.some((o) => !o.trim()));
      if (bad >= 0) return setError(`أكمل نص السؤال ${bad + 1} وكل خياراته`);
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.from('assignments').insert({
        class_id: classId, kind, title: title.trim(), description: desc, max_score: maxScore,
        due_at: due ? new Date(due).toISOString() : null,
      }).select().single();
      if (error) throw error;
      if (kind === 'quiz') {
        const { data: inserted, error: qe } = await supabase.from('quiz_questions')
          .insert(qs.map((q, i) => ({ assignment_id: data.id, position: i, prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()) })))
          .select('id, position');
        if (qe) throw qe;
        const { error: ke } = await supabase.from('quiz_answer_keys')
          .insert(inserted!.map((r) => ({ question_id: r.id, correct_index: qs[r.position].correct })));
        if (ke) throw ke;
      }
      onDone();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="seg">
        <button type="button" className={kind === 'assignment' ? 'on' : ''} onClick={() => setKind('assignment')}>واجب</button>
        <button type="button" className={kind === 'quiz' ? 'on' : ''} onClick={() => setKind('quiz')}>اختبار (تصحيح تلقائي)</button>
      </div>
      <label>العنوان<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>التعليمات<textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <div className="row wrap">
        <label className="grow">الدرجة الكاملة<input type="number" min={1} required value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} /></label>
        <label className="grow">الموعد النهائي (اختياري)<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      {kind === 'quiz' && (
        <div className="stack">
          {qs.map((q, i) => (
            <fieldset key={i} className="question-edit">
              <legend>السؤال {i + 1}</legend>
              <input placeholder="نص السؤال" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
              {q.options.map((o, j) => (
                <div key={j} className="option-edit">
                  <input type="radio" name={'c' + i} checked={q.correct === j} onChange={() => setQ(i, { correct: j })} title="الإجابة الصحيحة" />
                  <input placeholder={'الخيار ' + (j + 1)} value={o}
                    onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} />
                  {q.options.length > 2 && (
                    <button type="button" className="link danger" onClick={() => setQ(i, {
                      options: q.options.filter((_, k) => k !== j),
                      correct: q.correct === j ? 0 : q.correct > j ? q.correct - 1 : q.correct,
                    })}>×</button>
                  )}
                </div>
              ))}
              <div className="row">
                {q.options.length < 6 && <button type="button" className="link" onClick={() => setQ(i, { options: [...q.options, ''] })}>+ خيار</button>}
                {qs.length > 1 && <button type="button" className="link danger" onClick={() => setQs((p) => p.filter((_, k) => k !== i))}>حذف السؤال</button>}
              </div>
            </fieldset>
          ))}
          <p className="muted small">حدّد الإجابة الصحيحة بالدائرة بجانب الخيار.</p>
          <button type="button" className="btn ghost self-start" onClick={() => setQs((p) => [...p, blankQ()])}>+ سؤال</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'نشر'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>إلغاء</button>
      </div>
    </form>
  );
}
