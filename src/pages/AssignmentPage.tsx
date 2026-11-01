import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  errText, fileName, fmtDate, openFile, supabase, uploadFile,
  type Assignment, type ClassRow, type Profile, type Question, type Submission,
} from '../lib';

export default function AssignmentPage() {
  const { id, aid } = useParams();
  const { profile } = useAuth();
  const [a, setA] = useState<Assignment | null | undefined>(undefined);
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [keys, setKeys] = useState<Record<string, number>>({});
  const [subs, setSubs] = useState<Submission[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);

  async function load() {
    const { data } = await supabase.from('assignments').select('*').eq('id', aid!).maybeSingle();
    setA(data as Assignment | null);
    if (!data) return;
    const { data: c } = await supabase.from('classes').select('*').eq('id', id!).single();
    setCls(c as ClassRow);
    const teacher = c?.teacher_id === profile!.id;
    if (data.kind === 'quiz') {
      const { data: q } = await supabase.from('quiz_questions').select('*').eq('assignment_id', aid!).order('position');
      setQuestions((q as Question[]) ?? []);
      const { data: k } = await supabase.rpc('quiz_review', { aid });
      setKeys(Object.fromEntries(((k ?? []) as { question_id: string; correct_index: number }[]).map((r) => [r.question_id, r.correct_index])));
    }
    const { data: s } = await supabase.from('submissions').select('*').eq('assignment_id', aid!);
    setSubs((s as Submission[]) ?? []);
    if (teacher) {
      const { data: m } = await supabase.from('class_members').select('profiles(id, full_name, role)').eq('class_id', id!);
      setStudents(((m ?? []) as unknown as { profiles: Profile }[]).map((r) => r.profiles)
        .sort((x, y) => x.full_name.localeCompare(y.full_name, 'ar')));
    }
  }
  useEffect(() => { load(); }, [aid]);

  if (a === undefined) return <div className="spinner" />;
  if (a === null || !cls) return <div className="empty">غير موجود. <Link to={'/class/' + id}>العودة</Link></div>;
  const isTeacher = cls.teacher_id === profile!.id;
  const closed = !!a.due_at && new Date(a.due_at) < new Date();

  return (
    <div className="stack">
      <Link to={`/class/${id}?tab=assignments`} className="muted small">← {cls.name}</Link>
      <div>
        <span className={'kind ' + a.kind}>{a.kind === 'quiz' ? 'اختبار' : 'واجب'}</span>
        <h1 className="page-title inline">{a.title}</h1>
      </div>
      <div className="muted small">
        الدرجة الكاملة: {a.max_score}
        {a.due_at && <> · الموعد النهائي: {fmtDate(a.due_at)} {closed && '(انتهى)'}</>}
      </div>
      {a.description && <p className="card pre">{a.description}</p>}

      {isTeacher ? (
        <TeacherView a={a} questions={questions} keys={keys} subs={subs} students={students} reload={load} />
      ) : a.kind === 'quiz' ? (
        <QuizTaker a={a} questions={questions} keys={keys} sub={subs[0]} closed={closed} reload={load} />
      ) : (
        <AssignmentSubmit a={a} classId={cls.id} me={profile!} sub={subs[0]} closed={closed} reload={load} />
      )}
    </div>
  );
}

function QuizTaker({ a, questions, keys, sub, closed, reload }: {
  a: Assignment; questions: Question[]; keys: Record<string, number>; sub?: Submission; closed: boolean; reload: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = !!sub;
  const answers = sub?.answers ?? picked;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(picked).length < questions.length && !confirm('لم تجب على كل الأسئلة. هل تريد التسليم؟')) return;
    setBusy(true); setError('');
    const { error } = await supabase.rpc('submit_quiz', { aid: a.id, picked });
    setBusy(false);
    if (error) return setError(errText(error));
    reload();
  }

  if (!done && closed) return <div className="empty">انتهى موعد هذا الاختبار ولم تقم بتسليمه.</div>;

  return (
    <form className="stack" onSubmit={submit}>
      {done && <div className="result">نتيجتك: <strong>{sub!.score} / {a.max_score}</strong></div>}
      {questions.map((q, i) => (
        <fieldset key={q.id} className="card question">
          <legend>{i + 1}. {q.prompt}</legend>
          {q.options.map((o, j) => {
            const chosen = answers[q.id] === j;
            const correct = done && keys[q.id] === j;
            const wrong = done && chosen && keys[q.id] !== j;
            return (
              <label key={j} className={'option' + (chosen ? ' chosen' : '') + (correct ? ' correct' : '') + (wrong ? ' wrong' : '')}>
                <input type="radio" name={q.id} disabled={done} checked={chosen}
                  onChange={() => setPicked((p) => ({ ...p, [q.id]: j }))} />
                {o}
              </label>
            );
          })}
        </fieldset>
      ))}
      {error && <p className="error">{error}</p>}
      {!done && <button className="btn primary self-start" disabled={busy}>{busy ? '...' : 'تسليم الاختبار'}</button>}
    </form>
  );
}

function AssignmentSubmit({ a, classId, me, sub, closed, reload }: {
  a: Assignment; classId: string; me: Profile; sub?: Submission; closed: boolean; reload: () => void;
}) {
  const [text, setText] = useState(sub?.text_answer ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const graded = sub?.score !== null && sub?.score !== undefined;
  const editable = !graded && !closed;

  useEffect(() => { setText(sub?.text_answer ?? ''); }, [sub?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const file_path = file ? await uploadFile(`${classId}/submissions/${me.id}`, file) : sub?.file_path ?? null;
      const { error } = sub
        ? await supabase.from('submissions').update({ text_answer: text, file_path }).eq('id', sub.id)
        : await supabase.from('submissions').insert({ assignment_id: a.id, student_id: me.id, text_answer: text, file_path });
      if (error) throw error;
      setFile(null); reload();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {graded && (
        <div className="result">
          الدرجة: <strong>{sub!.score} / {a.max_score}</strong>
          {sub!.feedback && <p className="pre">ملاحظات المعلم: {sub!.feedback}</p>}
        </div>
      )}
      {sub && !graded && <div className="success">تم التسليم في {fmtDate(sub.submitted_at)}. يمكنك التعديل حتى يصحّح المعلم.</div>}
      {!sub && closed && <div className="empty">انتهى موعد التسليم.</div>}
      {(sub || !closed) && (
        <form className="card" onSubmit={submit}>
          <label>إجابتك<textarea rows={6} value={text} disabled={!editable} onChange={(e) => setText(e.target.value)} /></label>
          {sub?.file_path && <button type="button" className="btn ghost sm self-start" onClick={() => openFile(sub.file_path!)}>الملف المرفق: {fileName(sub.file_path)}</button>}
          {editable && <label>{sub?.file_path ? 'استبدال الملف' : 'إرفاق ملف (اختياري)'}<input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
          {error && <p className="error">{error}</p>}
          {editable && <button className="btn primary self-start" disabled={busy || (!text.trim() && !file && !sub?.file_path)}>{busy ? '...' : sub ? 'تحديث التسليم' : 'تسليم'}</button>}
        </form>
      )}
    </div>
  );
}

function TeacherView({ a, questions, keys, subs, students, reload }: {
  a: Assignment; questions: Question[]; keys: Record<string, number>; subs: Submission[]; students: Profile[]; reload: () => void;
}) {
  const byStudent = new Map(subs.map((s) => [s.student_id, s]));
  const graded = subs.filter((s) => s.score !== null);
  const avg = graded.length ? graded.reduce((t, s) => t + Number(s.score), 0) / graded.length : null;

  async function remove() {
    if (!confirm('حذف هذا العنصر وكل التسليمات؟')) return;
    await supabase.from('assignments').delete().eq('id', a.id);
    history.back();
  }

  return (
    <div className="stack">
      <div className="stats">
        <div><span>سلّموا</span><strong>{subs.length} / {students.length}</strong></div>
        <div><span>تم تصحيحها</span><strong>{graded.length}</strong></div>
        <div><span>المتوسط</span><strong>{avg === null ? '—' : avg.toFixed(1)}</strong></div>
      </div>
      {a.kind === 'quiz' && (
        <details className="card">
          <summary>الأسئلة والإجابات الصحيحة ({questions.length})</summary>
          <ol>{questions.map((q) => <li key={q.id}>{q.prompt} — <strong>{q.options[keys[q.id]]}</strong></li>)}</ol>
        </details>
      )}
      <h3>الطلاب</h3>
      {students.length === 0 && <div className="empty">لا يوجد طلاب في الفصل بعد</div>}
      {students.map((st) => <GradeRow key={st.id} a={a} student={st} sub={byStudent.get(st.id)} reload={reload} />)}
      <button className="link danger self-start" onClick={remove}>حذف {a.kind === 'quiz' ? 'الاختبار' : 'الواجب'}</button>
    </div>
  );
}

function GradeRow({ a, student, sub, reload }: { a: Assignment; student: Profile; sub?: Submission; reload: () => void }) {
  const [score, setScore] = useState(sub?.score?.toString() ?? '');
  const [feedback, setFeedback] = useState(sub?.feedback ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    const n = Number(score);
    if (score === '' || isNaN(n) || n < 0 || n > a.max_score) return setError(`أدخل درجة بين 0 و${a.max_score}`);
    const { error } = await supabase.from('submissions').update({ score: n, feedback }).eq('id', sub!.id);
    if (error) return setError(errText(error));
    setSaved(true); setTimeout(() => setSaved(false), 2000); reload();
  }

  return (
    <div className="card grade-row">
      <div className="row-between">
        <strong>{student.full_name}</strong>
        {sub ? <span className="muted small">سُلّم {fmtDate(sub.submitted_at)}</span> : <span className="pill warn">لم يُسلِّم</span>}
      </div>
      {sub && a.kind === 'assignment' && (
        <>
          {sub.text_answer && <p className="pre answer">{sub.text_answer}</p>}
          {sub.file_path && <button className="btn ghost sm self-start" onClick={() => openFile(sub.file_path!)}>الملف: {fileName(sub.file_path)}</button>}
          <form className="row wrap" onSubmit={save}>
            <input className="score-input" type="number" step="0.5" min={0} max={a.max_score} value={score}
              onChange={(e) => setScore(e.target.value)} placeholder="الدرجة" />
            <input className="grow" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="ملاحظات للطالب (اختياري)" />
            <button className="btn primary sm">{saved ? 'تم ✓' : 'حفظ'}</button>
          </form>
          {error && <p className="error">{error}</p>}
        </>
      )}
      {sub && a.kind === 'quiz' && <div>الدرجة: <strong>{sub.score} / {a.max_score}</strong></div>}
    </div>
  );
}
