-- مدرستي: مخطط قاعدة البيانات لـ Supabase
-- شغّل هذا الملف مرة واحدة في Supabase: SQL Editor ثم Run.

create extension if not exists pgcrypto;

-- ============ الجداول ============

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null check (role in ('teacher','student')),
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  content text not null default '',
  video_url text,
  file_path text,
  created_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  description text not null default '',
  kind text not null check (kind in ('assignment','quiz')),
  max_score numeric not null default 100,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

-- أسئلة الاختبار يراها الطالب، أما الإجابات الصحيحة ففي جدول منفصل لا يراه إلا المعلم
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  position int not null default 0,
  prompt text not null,
  options text[] not null check (array_length(options, 1) >= 2)
);

create table public.quiz_answer_keys (
  question_id uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_index int not null check (correct_index >= 0)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  text_answer text not null default '',
  file_path text,
  answers jsonb,
  score numeric,
  feedback text not null default '',
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  unique (assignment_id, student_id)
);

create table public.attendance (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  status text not null check (status in ('present','absent','late','excused')),
  primary key (class_id, student_id, day)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.class_members (student_id);
create index on public.lessons (class_id);
create index on public.assignments (class_id);
create index on public.quiz_questions (assignment_id);
create index on public.submissions (student_id);
create index on public.messages (class_id, created_at);
create index on public.notifications (user_id, created_at desc);

-- ============ دوال مساعدة ============

create or replace function public.is_class_teacher(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = cid and teacher_id = auth.uid());
$$;

create or replace function public.is_class_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members where class_id = cid and student_id = auth.uid())
      or exists (select 1 from classes where id = cid and teacher_id = auth.uid());
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- إنشاء الملف الشخصي تلقائياً عند التسجيل
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when new.raw_user_meta_data->>'role' = 'teacher' then 'teacher' else 'student' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- انضمام الطالب إلى فصل برمز
create or replace function public.join_class(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if my_role() is distinct from 'student' then
    raise exception 'فقط الطلاب يمكنهم الانضمام إلى الفصول';
  end if;
  select id into cid from classes where join_code = upper(trim(code));
  if cid is null then
    raise exception 'رمز الفصل غير صحيح';
  end if;
  insert into class_members (class_id, student_id) values (cid, auth.uid())
  on conflict do nothing;
  return cid;
end $$;

-- تسليم اختبار وتصحيحه في الخادم (الطالب لا يرى الإجابات الصحيحة)
create or replace function public.submit_quiz(aid uuid, picked jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  a assignments;
  total int;
  correct int;
  result numeric;
begin
  select * into a from assignments where id = aid and kind = 'quiz';
  if a.id is null then raise exception 'الاختبار غير موجود'; end if;
  if not exists (select 1 from class_members where class_id = a.class_id and student_id = auth.uid()) then
    raise exception 'لست عضواً في هذا الفصل';
  end if;
  if exists (select 1 from submissions where assignment_id = aid and student_id = auth.uid()) then
    raise exception 'سبق أن سلّمت هذا الاختبار';
  end if;
  if a.due_at is not null and now() > a.due_at then
    raise exception 'انتهى موعد الاختبار';
  end if;

  select count(*) into total from quiz_questions where assignment_id = aid;
  select count(*) into correct
    from quiz_questions q join quiz_answer_keys k on k.question_id = q.id
   where q.assignment_id = aid
     and (picked ->> q.id::text) ~ '^\d+$'
     and (picked ->> q.id::text)::int = k.correct_index;

  result := case when total = 0 then 0 else round(a.max_score * correct / total, 2) end;

  insert into submissions (assignment_id, student_id, answers, score, graded_at)
  values (aid, auth.uid(), picked, result, now());
  return result;
end $$;

-- عرض الإجابات الصحيحة للطالب بعد تسليمه فقط
create or replace function public.quiz_review(aid uuid)
returns table (question_id uuid, correct_index int)
language sql stable security definer set search_path = public as $$
  select q.id, k.correct_index
    from quiz_questions q join quiz_answer_keys k on k.question_id = q.id
   where q.assignment_id = aid
     and (exists (select 1 from submissions s where s.assignment_id = aid and s.student_id = auth.uid())
          or exists (select 1 from assignments x join classes c on c.id = x.class_id
                      where x.id = aid and c.teacher_id = auth.uid()));
$$;

-- ============ الإشعارات التلقائية ============

create or replace function public.notify_class(cid uuid, t text, b text, l text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, title, body, link)
  select student_id, t, b, l from class_members where class_id = cid;
$$;

create or replace function public.on_lesson_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_class(new.class_id, 'درس جديد', new.title, '/class/' || new.class_id || '?tab=lessons');
  return new;
end $$;
create trigger lesson_notify after insert on public.lessons
  for each row execute function public.on_lesson_created();

create or replace function public.on_assignment_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_class(new.class_id,
    case when new.kind = 'quiz' then 'اختبار جديد' else 'واجب جديد' end,
    new.title, '/class/' || new.class_id || '/assignment/' || new.id);
  return new;
end $$;
create trigger assignment_notify after insert on public.assignments
  for each row execute function public.on_assignment_created();

create or replace function public.on_announcement_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_class(new.class_id, 'إعلان جديد', left(new.body, 140), '/class/' || new.class_id || '?tab=announcements');
  return new;
end $$;
create trigger announcement_notify after insert on public.announcements
  for each row execute function public.on_announcement_created();

create or replace function public.on_submission_graded() returns trigger
language plpgsql security definer set search_path = public as $$
declare a assignments;
begin
  if new.score is not null and (old.score is distinct from new.score or old.feedback is distinct from new.feedback) then
    select * into a from assignments where id = new.assignment_id;
    insert into notifications (user_id, title, body, link)
    values (new.student_id, 'تم تصحيح: ' || a.title, 'الدرجة: ' || new.score || ' من ' || a.max_score,
            '/class/' || a.class_id || '/assignment/' || a.id);
  end if;
  return new;
end $$;
create trigger submission_graded after update on public.submissions
  for each row execute function public.on_submission_graded();

-- يمنع الطالب من تعديل درجته بنفسه
create or replace function public.guard_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select class_id into cid from assignments where id = new.assignment_id;
  if is_class_teacher(cid) then
    -- المعلم يعدّل الدرجة والملاحظات فقط
    new.text_answer := old.text_answer; new.file_path := old.file_path; new.answers := old.answers;
    new.student_id := old.student_id; new.assignment_id := old.assignment_id; new.submitted_at := old.submitted_at;
    if new.score is distinct from old.score then new.graded_at := now(); end if;
  else
    -- الطالب يعدّل إجابته فقط قبل التصحيح
    if old.score is not null then raise exception 'لا يمكن تعديل تسليم تم تصحيحه'; end if;
    new.score := old.score; new.feedback := old.feedback; new.graded_at := old.graded_at;
    new.answers := old.answers; new.student_id := old.student_id; new.assignment_id := old.assignment_id;
    new.submitted_at := now();
  end if;
  return new;
end $$;
create trigger submission_guard before update on public.submissions
  for each row execute function public.guard_submission();

-- ============ صلاحيات الوصول (RLS) ============

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.lessons enable row level security;
alter table public.assignments enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_answer_keys enable row level security;
alter table public.submissions enable row level security;
alter table public.attendance enable row level security;
alter table public.announcements enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

-- الملفات الشخصية: كل شخص يرى نفسه ومن يشاركه فصلاً
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or exists (
    select 1 from class_members m
     where m.student_id = profiles.id and is_class_member(m.class_id))
  or exists (select 1 from classes c where c.teacher_id = profiles.id and is_class_member(c.id))
);
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = my_role());

-- الفصول
create policy classes_select on public.classes for select using (is_class_member(id));
create policy classes_insert on public.classes for insert
  with check (teacher_id = auth.uid() and my_role() = 'teacher');
create policy classes_update on public.classes for update
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy classes_delete on public.classes for delete using (teacher_id = auth.uid());

-- الأعضاء (الانضمام عبر join_class فقط)
create policy members_select on public.class_members for select using (is_class_member(class_id));
create policy members_delete on public.class_members for delete
  using (is_class_teacher(class_id) or student_id = auth.uid());

-- الدروس والواجبات والإعلانات: الأعضاء يقرؤون، والمعلم يدير
create policy lessons_select on public.lessons for select using (is_class_member(class_id));
create policy lessons_write on public.lessons for all
  using (is_class_teacher(class_id)) with check (is_class_teacher(class_id));

create policy assignments_select on public.assignments for select using (is_class_member(class_id));
create policy assignments_write on public.assignments for all
  using (is_class_teacher(class_id)) with check (is_class_teacher(class_id));

create policy questions_select on public.quiz_questions for select using (
  exists (select 1 from assignments a where a.id = assignment_id and is_class_member(a.class_id)));
create policy questions_write on public.quiz_questions for all
  using (exists (select 1 from assignments a where a.id = assignment_id and is_class_teacher(a.class_id)))
  with check (exists (select 1 from assignments a where a.id = assignment_id and is_class_teacher(a.class_id)));

create policy keys_teacher on public.quiz_answer_keys for all
  using (exists (select 1 from quiz_questions q join assignments a on a.id = q.assignment_id
                  where q.id = question_id and is_class_teacher(a.class_id)))
  with check (exists (select 1 from quiz_questions q join assignments a on a.id = q.assignment_id
                  where q.id = question_id and is_class_teacher(a.class_id)));

create policy announcements_select on public.announcements for select using (is_class_member(class_id));
create policy announcements_write on public.announcements for all
  using (is_class_teacher(class_id)) with check (is_class_teacher(class_id) and author_id = auth.uid());

-- التسليمات: الطالب يرى تسليمه، والمعلم يرى تسليمات فصله
create policy submissions_select on public.submissions for select using (
  student_id = auth.uid()
  or exists (select 1 from assignments a where a.id = assignment_id and is_class_teacher(a.class_id)));
create policy submissions_insert on public.submissions for insert with check (
  student_id = auth.uid() and score is null and answers is null
  and exists (select 1 from assignments a
               where a.id = assignment_id and a.kind = 'assignment'
                 and is_class_member(a.class_id) and not is_class_teacher(a.class_id)
                 and (a.due_at is null or now() <= a.due_at)));
create policy submissions_update on public.submissions for update using (
  student_id = auth.uid()
  or exists (select 1 from assignments a where a.id = assignment_id and is_class_teacher(a.class_id)));
create policy submissions_delete on public.submissions for delete using (
  exists (select 1 from assignments a where a.id = assignment_id and is_class_teacher(a.class_id)));

-- الحضور
create policy attendance_select on public.attendance for select
  using (student_id = auth.uid() or is_class_teacher(class_id));
create policy attendance_write on public.attendance for all
  using (is_class_teacher(class_id)) with check (is_class_teacher(class_id));

-- المحادثة
create policy messages_select on public.messages for select using (is_class_member(class_id));
create policy messages_insert on public.messages for insert
  with check (sender_id = auth.uid() and is_class_member(class_id));
create policy messages_delete on public.messages for delete
  using (sender_id = auth.uid() or is_class_teacher(class_id));

-- الإشعارات
create policy notifications_select on public.notifications for select using (user_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete using (user_id = auth.uid());

-- ============ التحديث الفوري ============
alter publication supabase_realtime add table public.messages, public.notifications;

-- ============ تخزين الملفات ============
-- المسار: <class_id>/lessons/... أو <class_id>/submissions/<student_id>/...
insert into storage.buckets (id, name, public) values ('class-files', 'class-files', false)
on conflict (id) do nothing;

create policy class_files_read on storage.objects for select using (
  bucket_id = 'class-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (
    is_class_teacher(((storage.foldername(name))[1])::uuid)
    or ((storage.foldername(name))[2] = 'lessons' and is_class_member(((storage.foldername(name))[1])::uuid))
    or ((storage.foldername(name))[2] = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text)
  ));

create policy class_files_upload on storage.objects for insert with check (
  bucket_id = 'class-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (
    ((storage.foldername(name))[2] = 'lessons' and is_class_teacher(((storage.foldername(name))[1])::uuid))
    or ((storage.foldername(name))[2] = 'submissions'
        and (storage.foldername(name))[3] = auth.uid()::text
        and is_class_member(((storage.foldername(name))[1])::uuid))
  ));

create policy class_files_delete on storage.objects for delete using (
  bucket_id = 'class-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and is_class_teacher(((storage.foldername(name))[1])::uuid));
