import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { supabase, type ClassRow, type Profile } from '../lib';
import LessonsTab from '../class/LessonsTab';
import AssignmentsTab from '../class/AssignmentsTab';
import AttendanceTab from '../class/AttendanceTab';
import ChatTab from '../class/ChatTab';
import AnnouncementsTab from '../class/AnnouncementsTab';
import ReportsTab from '../class/ReportsTab';
import MembersTab from '../class/MembersTab';

export interface ClassCtx {
  cls: ClassRow;
  isTeacher: boolean;
  me: Profile;
  students: Profile[];
  teacher: Profile | null;
  people: Map<string, Profile>;
  reloadMembers: () => Promise<void>;
}

const TABS = [
  ['announcements', 'الإعلانات'],
  ['lessons', 'الدروس'],
  ['assignments', 'الواجبات والاختبارات'],
  ['attendance', 'الحضور'],
  ['chat', 'المحادثة'],
  ['reports', 'التقارير'],
  ['members', 'الأعضاء'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function ClassPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'announcements';
  const [cls, setCls] = useState<ClassRow | null | undefined>(undefined);
  const [students, setStudents] = useState<Profile[]>([]);
  const [teacher, setTeacher] = useState<Profile | null>(null);

  async function reloadMembers() {
    const { data } = await supabase.from('class_members')
      .select('student_id, profiles(id, full_name, role)').eq('class_id', id!);
    const list = ((data ?? []) as unknown as { profiles: Profile | null }[])
      .map((r) => r.profiles).filter((p): p is Profile => !!p)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
    setStudents(list);
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('classes').select('*').eq('id', id!).maybeSingle();
      setCls(data as ClassRow | null);
      if (data) {
        const { data: t } = await supabase.from('profiles').select('id, full_name, role').eq('id', data.teacher_id).maybeSingle();
        setTeacher(t as Profile | null);
        await reloadMembers();
      }
    })();
  }, [id]);

  if (cls === undefined) return <div className="spinner" />;
  if (cls === null) return <div className="empty">الفصل غير موجود أو ليست لديك صلاحية. <Link to="/">العودة</Link></div>;

  const isTeacher = cls.teacher_id === profile!.id;
  const people = new Map<string, Profile>();
  students.forEach((s) => people.set(s.id, s));
  if (teacher) people.set(teacher.id, teacher);
  const ctx: ClassCtx = { cls, isTeacher, me: profile!, students, teacher, people, reloadMembers };

  async function deleteClass() {
    if (!confirm('حذف الفصل سيحذف كل الدروس والواجبات والدرجات والمحادثات. هل أنت متأكد؟')) return;
    await supabase.from('classes').delete().eq('id', cls!.id);
    nav('/');
  }

  return (
    <div>
      <div className="class-head">
        <div>
          <Link to="/" className="muted small">← فصولي</Link>
          <h1 className="page-title">{cls.name}</h1>
          {cls.description && <p className="muted">{cls.description}</p>}
        </div>
        {isTeacher && (
          <div className="class-head-side">
            <div className="join-code" title="شارك هذا الرمز مع طلابك">
              <span className="muted small">رمز الانضمام</span>
              <strong dir="ltr">{cls.join_code}</strong>
            </div>
            <button className="btn ghost sm danger" onClick={deleteClass}>حذف الفصل</button>
          </div>
        )}
      </div>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setParams({ tab: key })}>{label}</button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === 'announcements' && <AnnouncementsTab {...ctx} />}
        {tab === 'lessons' && <LessonsTab {...ctx} />}
        {tab === 'assignments' && <AssignmentsTab {...ctx} />}
        {tab === 'attendance' && <AttendanceTab {...ctx} />}
        {tab === 'chat' && <ChatTab {...ctx} />}
        {tab === 'reports' && <ReportsTab {...ctx} />}
        {tab === 'members' && <MembersTab {...ctx} />}
      </div>
    </div>
  );
}
