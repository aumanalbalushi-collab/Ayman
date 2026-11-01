import { useEffect, useState } from 'react';
import type { ClassCtx } from '../pages/ClassPage';
import { attendanceLabels, errText, fmtDate, supabase, today, type Attendance, type AttendanceStatus } from '../lib';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

export default function AttendanceTab(ctx: ClassCtx) {
  return ctx.isTeacher ? <TeacherAttendance {...ctx} /> : <StudentAttendance {...ctx} />;
}

function TeacherAttendance({ cls, students }: ClassCtx) {
  const [day, setDay] = useState(today());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setMsg('');
    supabase.from('attendance').select('*').eq('class_id', cls.id).eq('day', day).then(({ data }) => {
      setMarks(Object.fromEntries(((data as Attendance[]) ?? []).map((r) => [r.student_id, r.status])));
    });
  }, [cls.id, day]);

  async function save() {
    setSaving(true); setMsg('');
    const rows = students.map((s) => ({ class_id: cls.id, student_id: s.id, day, status: marks[s.id] ?? 'present' }));
    const { error } = await supabase.from('attendance').upsert(rows);
    setSaving(false);
    if (error) return setMsg(errText(error));
    setMarks(Object.fromEntries(rows.map((r) => [r.student_id, r.status])));
    setMsg('تم حفظ الحضور');
  }

  if (students.length === 0) return <div className="empty">لا يوجد طلاب في الفصل بعد</div>;

  return (
    <div className="stack">
      <div className="row wrap">
        <label className="inline-label">التاريخ<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <button className="btn ghost sm" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, 'present'])))}>الكل حاضر</button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.full_name}</td>
                <td>
                  <div className="att-buttons">
                    {STATUSES.map((st) => (
                      <button key={st} className={'att ' + st + ((marks[s.id] ?? 'present') === st ? ' on' : '')}
                        onClick={() => setMarks((p) => ({ ...p, [s.id]: st }))}>{attendanceLabels[st]}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? '...' : 'حفظ الحضور'}</button>
        {msg && <span className={msg.startsWith('تم') ? 'success' : 'error'}>{msg}</span>}
      </div>
    </div>
  );
}

function StudentAttendance({ cls, me }: ClassCtx) {
  const [rows, setRows] = useState<Attendance[] | null>(null);
  useEffect(() => {
    supabase.from('attendance').select('*').eq('class_id', cls.id).eq('student_id', me.id).order('day', { ascending: false })
      .then(({ data }) => setRows((data as Attendance[]) ?? []));
  }, [cls.id]);

  if (rows === null) return <div className="spinner" />;
  if (rows.length === 0) return <div className="empty">لم يُسجَّل حضور بعد</div>;
  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;

  return (
    <div className="stack">
      <div className="stats">
        <div><span>نسبة الحضور</span><strong>{Math.round((present / rows.length) * 100)}%</strong></div>
        <div><span>الأيام المسجلة</span><strong>{rows.length}</strong></div>
        <div><span>الغياب</span><strong>{rows.filter((r) => r.status === 'absent').length}</strong></div>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}><td>{fmtDate(r.day + 'T12:00:00', false)}</td><td><span className={'att on ' + r.status}>{attendanceLabels[r.status]}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
