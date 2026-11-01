import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClassCtx } from '../pages/ClassPage';
import { errText, fmtDate, supabase, type Message } from '../lib';

export default function ChatTab({ cls, me, people, isTeacher, teacher }: ClassCtx) {
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('messages').select('*').eq('class_id', cls.id).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setMsgs(((data as Message[]) ?? []).reverse()));
    const ch = supabase.channel('chat-' + cls.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `class_id=eq.${cls.id}` }, (p) => {
        if (p.eventType === 'INSERT') {
          const m = p.new as Message;
          setMsgs((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]));
        } else if (p.eventType === 'DELETE') {
          setMsgs((prev) => prev?.filter((x) => x.id !== (p.old as Message).id) ?? null);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cls.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody(''); setError('');
    const { data, error } = await supabase.from('messages').insert({ class_id: cls.id, sender_id: me.id, body: text }).select().single();
    if (error) { setBody(text); return setError(errText(error)); }
    setMsgs((prev) => (prev?.some((x) => x.id === data.id) ? prev : [...(prev ?? []), data as Message]));
  }

  async function remove(id: string) {
    await supabase.from('messages').delete().eq('id', id);
    setMsgs((prev) => prev?.filter((x) => x.id !== id) ?? null);
  }

  return (
    <div className="chat card">
      <div className="chat-log">
        {msgs === null && <div className="spinner" />}
        {msgs?.length === 0 && <p className="muted pad">ابدأ المحادثة مع الفصل</p>}
        {msgs?.map((m) => {
          const mine = m.sender_id === me.id;
          return (
            <div key={m.id} className={'bubble' + (mine ? ' mine' : '')}>
              {!mine && (
                <span className="sender">
                  {people.get(m.sender_id)?.full_name ?? 'عضو'}
                  {m.sender_id === teacher?.id && <span className="role-chip">المعلم</span>}
                </span>
              )}
              <span className="pre">{m.body}</span>
              <span className="time">
                {fmtDate(m.created_at)}
                {(mine || isTeacher) && <button className="link" onClick={() => remove(m.id)}>حذف</button>}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {error && <p className="error">{error}</p>}
      <form className="chat-input" onSubmit={send}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="اكتب رسالة..." maxLength={4000} />
        <button className="btn primary">إرسال</button>
      </form>
    </div>
  );
}
