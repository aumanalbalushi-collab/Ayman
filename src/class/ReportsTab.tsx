import { useEffect, useState } from 'react';
import type { ClassCtx } from '../pages/ClassPage';
import { supabase, type Assignment, type Attendance, type Submission } from '../lib';

interface Data { assignments: Assignment[]; subs: Submission[]; att: Attendance[] }

function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : null; }

export default function ReportsTab({ cls, isTeacher, me, students }: ClassCtx) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    (async () => {
      const { data: assignments } = await supabase.from('assignments').select('*').eq('class_id', cls.id).order('created_at');
      const ids = ((assignments as Assignment[]) ?? []).map((a) => a.id);
      const { data: subs } = ids.length ? await supabase.from('submissions').select('*').in('assignment_id', ids) : { data: [] };
      const { data: att } = await supabase.from('attendance').select('*').eq('class_id', cls.id);
      setData({ assignments: (assignments as Assignment[]) ?? [], subs: (subs as Submission[]) ?? [], att: (att as Attendance[]) ?? [] });
    })();
  }, [cls.id]);

  if (!data) return <div className="spinner" />;
  const list = isTeacher ? students : [me];

  const rows = list.map((s) => {
    const mySubs = data.subs.filter((x) => x.student_id === s.id);
    const graded = mySubs.filter((x) => x.score !== null);
    const gradePct = graded.length
      ? Math.round(graded.reduce((t, x) => {
          const a = data.assignments.find((y) => y.id === x.assignment_id)!;
          return t + (Number(x.score) / Number(a.max_score)) * 100;
        }, 0) / graded.length)
      : null;
    const att = data.att.filter((x) => x.student_id === s.id);
    const attPct = pct(att.filter((x) => x.status === 'present' || x.status === 'late').length, att.length);
    return { s, submitted: mySubs.length, gradePct, attPct, absences: att.filter((x) => x.status === 'absent').length };
  });

  const avg = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  function exportCsv() {
    const header = ['الطالب', 'التسليمات', 'متوسط الدرجات %', 'نسبة الحضور %', 'الغياب'];
    const lines = rows.map((r) => [r.s.full_name, `${r.submitted}/${data!.assignments.length}`, r.gradePct ?? '', r.attPct ?? '', r.absences]);
    const csv = '﻿' + [header, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `تقرير-${cls.name}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  if (isTeacher && students.length === 0) return <div className="empty">لا يوجد طلاب في الفصل بعد</div>;

  return (
    <div className="stack">
      <div className="stats">
        <div><span>{isTeacher ? 'متوسط درجات الفصل' : 'متوسط درجاتك'}</span><strong>{avg(rows.map((r) => r.gradePct)) ?? '—'}{avg(rows.map((r) => r.gradePct)) !== null && '%'}</strong></div>
        <div><span>{isTeacher ? 'متوسط الحضور' : 'نسبة حضورك'}</span><strong>{avg(rows.map((r) => r.attPct)) ?? '—'}{avg(rows.map((r) => r.attPct)) !== null && '%'}</strong></div>
        <div><span>الواجبات والاختبارات</span><strong>{data.assignments.length}</strong></div>
      </div>

      {isTeacher ? (
        <>
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>الطالب</th><th>التسليمات</th><th>متوسط الدرجات</th><th>الحضور</th><th>الغياب</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.id}>
                    <td>{r.s.full_name}</td>
                    <td>{r.submitted} / {data.assignments.length}</td>
                    <td><Bar value={r.gradePct} /></td>
                    <td><Bar value={r.attPct} /></td>
                    <td>{r.absences}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn ghost self-start" onClick={exportCsv}>تصدير إلى Excel (CSV)</button>
        </>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>العنوان</th><th>النوع</th><th>الدرجة</th></tr></thead>
            <tbody>
              {data.assignments.map((a) => {
                const s = data.subs.find((x) => x.assignment_id === a.id);
                return (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{a.kind === 'quiz' ? 'اختبار' : 'واجب'}</td>
                    <td>{s ? (s.score !== null ? `${s.score} / ${a.max_score}` : 'بانتظار التصحيح') : 'لم يُسلَّم'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Bar({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const tone = value >= 80 ? 'good' : value >= 50 ? 'mid' : 'low';
  return (
    <span className="bar">
      <span className={'bar-fill ' + tone} style={{ width: value + '%' }} />
      <span className="bar-label">{value}%</span>
    </span>
  );
}
