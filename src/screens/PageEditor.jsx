import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Curated list of editable pages: display name -> repo-relative path.
const PAGES = [
  { name: 'Home', path: 'index.html' },
  { name: 'Programs', path: 'programs.html' },
  { name: 'Our Impact', path: 'impact.html' },
  { name: 'Donate', path: 'donate.html' },
  { name: 'Get Involved', path: 'get-involved.html' },
  { name: 'About', path: 'about.html' },
];

const SUGGESTIONS = ['Change the hero headline', 'Add a paragraph to the intro'];

// A calm opening line from Claude, per page.
function greeting(pageName) {
  return `Hi — I'm editing the ${pageName} page. Tell me what to change in plain English, and I'll stage it for your review.`;
}

export default function PageEditor() {
  const [selected, setSelected] = useState(PAGES[0]);
  const [messages, setMessages] = useState([{ role: 'assistant', text: greeting(PAGES[0].name) }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // Reset the conversation when the page changes.
  useEffect(() => {
    setMessages([{ role: 'assistant', text: greeting(selected.name) }]);
    setInput('');
  }, [selected.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the chat scrolled to the latest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text) {
    const instruction = (text ?? input).trim();
    if (!instruction || sending) return;

    // Snapshot history (before this turn) for context, then optimistic append.
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: 'user', text: instruction }]);
    setInput('');
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again.');

      const res = await fetch('/api/ai-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ page: selected.path, instruction, history }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Something went wrong (status ${res.status}).`);

      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: body.reply || 'Done.',
          staged: body.editsApplied > 0
            ? { count: body.editsApplied, summary: body.summary }
            : null,
        },
      ]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', error: true, text: err.message || 'Something went wrong.' }]);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      {/* Helper line */}
      <p className="note" style={{ margin: '0 0 16px', lineHeight: 1.6, maxWidth: '70ch' }}>
        Describe a change in plain English. Claude edits the selected page and stages it for your
        review — nothing goes live until you Publish.
      </p>

      {/* Page selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <span className="label">Editing page</span>
        {PAGES.map((p) => {
          const active = p.path === selected.path;
          return (
            <button
              key={p.path}
              className="ms"
              onClick={() => setSelected(p)}
              disabled={sending}
              style={{
                fontWeight: 700, fontSize: 12, letterSpacing: '.02em',
                borderRadius: 999, padding: '7px 14px', cursor: sending ? 'not-allowed' : 'pointer',
                border: active ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                background: active ? 'var(--ink)' : '#fff',
                color: active ? '#fff' : 'var(--muted)',
              }}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Claude chat panel (dark), styled after the Phase 1 prototype */}
      <div
        style={{
          background: 'var(--ink)', borderRadius: 12, display: 'flex',
          flexDirection: 'column', height: 620, overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(226,228,225,.14)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="ms"
            style={{
              width: 28, height: 28, background: 'var(--red)', color: '#fff', borderRadius: 7,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, flex: 'none',
            }}
          >
            ✦
          </span>
          <div>
            <div className="ms" style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>Claude</div>
            <div className="ms" style={{ fontWeight: 500, fontSize: 10, color: 'rgba(226,228,225,.5)' }}>
              Editing {selected.name} · {selected.path}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="scroll"
          style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {messages.map((m, i) =>
            m.role === 'assistant' ? (
              <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    background: '#fff',
                    color: m.error ? 'var(--red-ink)' : 'var(--ink)',
                    border: '1px solid var(--line)',
                    borderLeft: `3px solid ${m.error ? 'var(--red-ink)' : 'var(--red)'}`,
                    borderRadius: 10, padding: '11px 13px', fontSize: 14, lineHeight: 1.45,
                  }}
                >
                  {m.text}
                </div>
                {m.staged && (
                  <div
                    className="ms"
                    style={{
                      background: 'var(--green-t)', color: 'var(--green-d)', borderRadius: 9,
                      padding: '9px 12px', fontWeight: 700, fontSize: 11.5, lineHeight: 1.45,
                    }}
                  >
                    ✓ Staged {m.staged.count} change{m.staged.count === 1 ? '' : 's'} on staging — review &amp; publish from the Dashboard.
                    {m.staged.summary && (
                      <div style={{ fontWeight: 500, marginTop: 3, color: 'var(--green-d)' }}>{m.staged.summary}</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                key={i}
                style={{
                  alignSelf: 'flex-end', maxWidth: '88%', background: 'var(--green)', color: '#fff',
                  borderRadius: 10, padding: '11px 13px', fontSize: 14, lineHeight: 1.45,
                }}
              >
                {m.text}
              </div>
            )
          )}

          {sending && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 9, color: 'rgba(226,228,225,.7)' }}>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              <span className="ms" style={{ fontWeight: 600, fontSize: 12 }}>Claude is editing…</span>
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: 12, borderTop: '1px solid rgba(226,228,225,.14)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {SUGGESTIONS.map((c) => (
              <button
                key={c}
                className="ms"
                onClick={() => send(c)}
                disabled={sending}
                style={{
                  fontWeight: 600, fontSize: 10.5, color: '#e2e4e1', background: 'transparent',
                  border: '1px solid rgba(226,228,225,.35)', borderRadius: 999, padding: '5px 10px',
                  cursor: sending ? 'not-allowed' : 'pointer',
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Tell Claude what to change…"
              rows={2}
              disabled={sending}
              style={{
                flex: 1, resize: 'none', background: '#fff', border: 'none', borderRadius: 8,
                padding: '9px 11px', fontSize: 14, color: 'var(--ink)',
                fontFamily: '"Freight Micro Pro", Georgia, serif',
              }}
            />
            <button
              className="ms"
              onClick={() => send()}
              disabled={sending || !input.trim()}
              style={{
                fontWeight: 800, fontSize: 12, color: '#fff',
                background: sending || !input.trim() ? '#7a2a22' : 'var(--red-ink)',
                border: 'none', borderRadius: 8, padding: '11px 16px',
                cursor: sending || !input.trim() ? 'not-allowed' : 'pointer', height: 44,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
