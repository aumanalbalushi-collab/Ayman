import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || 'http://localhost', key || 'missing');

export type Role = 'teacher' | 'student';
export interface Profile { id: string; full_name: string; role: Role }
export interface ClassRow { id: string; name: string; description: string; teacher_id: string; join_code: string; created_at: string }
export interface Lesson { id: string; class_id: string; title: string; content: string; video_url: string | null; file_path: string | null; created_at: string }
export interface Assignment { id: string; class_id: string; title: string; description: string; kind: 'assignment' | 'quiz'; max_score: number; due_at: string | null; created_at: string }
export interface Question { id: string; assignment_id: string; position: number; prompt: string; options: string[] }
export interface Submission { id: string; assignment_id: string; student_id: string; text_answer: string; file_path: string | null; answers: Record<string, number> | null; score: number | null; feedback: string; submitted_at: string; graded_at: string | null }
export interface Attendance { class_id: string; student_id: string; day: string; status: AttendanceStatus }
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export interface Announcement { id: string; class_id: string; author_id: string; body: string; created_at: string }
export interface Message { id: string; class_id: string; sender_id: string; body: string; created_at: string }
export interface Notification { id: string; user_id: string; title: string; body: string; link: string | null; read: boolean; created_at: string }

export const BUCKET = 'class-files';

export const attendanceLabels: Record<AttendanceStatus, string> = {
  present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر',
};

export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ar', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Arabic text for a Supabase/Postgres error. */
export function errText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('Invalid login credentials')) return 'البريد أو كلمة المرور غير صحيحة';
  if (msg.includes('User already registered')) return 'هذا البريد مسجّل مسبقاً';
  if (msg.includes('Password should be')) return 'كلمة المرور قصيرة (6 أحرف على الأقل)';
  if (msg.includes('Email not confirmed')) return 'أكّد بريدك الإلكتروني أولاً من الرسالة المرسلة إليك';
  if (msg.includes('row-level security')) return 'ليست لديك صلاحية لهذا الإجراء';
  if (msg.includes('Failed to fetch')) return 'تعذّر الاتصال بالخادم. تحقق من الإنترنت';
  return msg;
}

export async function uploadFile(path: string, file: File) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const full = `${path}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(full, file);
  if (error) throw error;
  return full;
}

export async function openFile(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

export function fileName(path: string) {
  return path.split('/').pop()!.replace(/^\d+_/, '');
}

/** Converts YouTube/Vimeo links into embeddable URLs; returns null for others. */
export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v') || u.pathname.split('/').pop();
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`;
    if (u.hostname.includes('vimeo.com')) return `https://player.vimeo.com/video${u.pathname}`;
  } catch { /* invalid url */ }
  return null;
}
