import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { fmtDate, supabase, type Notification } from '../lib';

export default function Layout({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile) return;
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setItems((data as Notification[]) ?? []));
    const ch = supabase.channel('notif-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (p) => {
          const n = p.new as Notification;
          setItems((prev) => [n, ...prev]);
          if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification(n.title, { body: n.body, icon: '/icon-192.png' });
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }

  async function markAll() {
    await supabase.from('notifications').update({ read: true }).eq('read', false);
    setItems((p) => p.map((n) => ({ ...n, read: true })));
  }

  async function go(n: Notification) {
    setOpen(false);
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id);
      setItems((p) => p.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    if (n.link) nav(n.link);
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><img src="/icon.svg" alt="" width={30} height={30} />مدرستي</Link>
        <div className="topbar-actions">
          <div className="notif" ref={boxRef}>
            <button className="icon-btn" onClick={toggle} aria-label="الإشعارات">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
            </button>
            {open && (
              <div className="notif-panel">
                <div className="notif-head">
                  <strong>الإشعارات</strong>
                  {unread > 0 && <button className="link" onClick={markAll}>تعليم الكل كمقروء</button>}
                </div>
                {items.length === 0 && <p className="muted pad">لا توجد إشعارات</p>}
                {items.map((n) => (
                  <button key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => go(n)}>
                    <span className="notif-title">{n.title}</span>
                    <span className="notif-body">{n.body}</span>
                    <span className="muted small">{fmtDate(n.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="who">
            {profile?.full_name}
            <span className="role-chip">{profile?.role === 'teacher' ? 'معلم' : 'طالب'}</span>
          </span>
          <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>خروج</button>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
