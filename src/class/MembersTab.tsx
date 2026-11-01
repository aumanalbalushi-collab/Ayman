import { useNavigate } from 'react-router-dom';
import type { ClassCtx } from '../pages/ClassPage';
import { supabase } from '../lib';

export default function MembersTab({ cls, isTeacher, me, students, teacher, reloadMembers }: ClassCtx) {
  const nav = useNavigate();

  async function removeStudent(id: string, name: string) {
    if (!confirm(`إزالة ${name} من الفصل؟`)) return;
    await supabase.from('class_members').delete().eq('class_id', cls.id).eq('student_id', id);
    reloadMembers();
  }

  async function leave() {
    if (!confirm('مغادرة الفصل؟')) return;
    await supabase.from('class_members').delete().eq('class_id', cls.id).eq('student_id', me.id);
    nav('/');
  }

  return (
    <div className="stack">
      <div className="card">
        <span className="muted small">المعلم</span>
        <strong>{teacher?.full_name}</strong>
      </div>
      <div className="card">
        <div className="row-between"><span className="muted small">الطلاب ({students.length})</span></div>
        {students.length === 0 && (
          <p className="muted">لا يوجد طلاب بعد.{isTeacher && <> شارك الرمز <strong dir="ltr">{cls.join_code}</strong> مع طلابك.</>}</p>
        )}
        <ul className="member-list">
          {students.map((s) => (
            <li key={s.id}>
              <span>{s.full_name}{s.id === me.id && ' (أنت)'}</span>
              {isTeacher && <button className="link danger" onClick={() => removeStudent(s.id, s.full_name)}>إزالة</button>}
            </li>
          ))}
        </ul>
      </div>
      {!isTeacher && <button className="link danger self-start" onClick={leave}>مغادرة الفصل</button>}
    </div>
  );
}
