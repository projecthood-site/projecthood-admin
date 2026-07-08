export default function TopBar({ kicker, title }) {
  return (
    <header
      style={{
        flex: 'none', background: 'rgba(246,246,244,.85)', backdropFilter: 'blur(6px)',
        borderBottom: '1px solid var(--line)', padding: '0 32px', height: 72,
        display: 'flex', alignItems: 'center', gap: 20,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="kicker">{kicker}</div>
        <h1 className="ak" style={{ fontSize: 30, lineHeight: '.9', color: 'var(--ink)', margin: '3px 0 0' }}>
          {title}
        </h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        <div
          className="ms"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, background: '#fff',
            border: '1px solid var(--line)', borderRadius: 9, padding: '9px 13px',
            width: 210, color: 'var(--faint)', fontSize: 13,
          }}
        >
          <span style={{ width: 11, height: 11, border: '2px solid #c3bfc1', borderRadius: 999 }} />
          Search…
        </div>
        <a
          href="https://projecthood.org"
          target="_blank"
          rel="noopener"
          className="ms"
          style={{
            fontWeight: 800, fontSize: 12, letterSpacing: '.03em', textTransform: 'uppercase',
            color: 'var(--ink)', background: 'var(--yellow)', borderRadius: 9, padding: '11px 16px',
          }}
        >
          View live site ↗
        </a>
      </div>
    </header>
  );
}
