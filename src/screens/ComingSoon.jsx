export default function ComingSoon({ title }) {
  return (
    <div style={{ maxWidth: 640, margin: '40px auto' }}>
      <div className="card" style={{ padding: '40px 36px', textAlign: 'center' }}>
        <div
          className="ak"
          style={{ fontSize: 52, lineHeight: 1, color: 'var(--line)', marginBottom: 8 }}
        >
          {title || 'Coming soon'}
        </div>
        <div className="kicker" style={{ marginBottom: 12 }}>Phase 2</div>
        <p className="note" style={{ fontSize: 14, lineHeight: 1.6, margin: '0 auto', maxWidth: '42ch' }}>
          This section is on the Phase 2 roadmap. The Dashboard and Events screens are wired to the
          live database today — the rest are coming online next.
        </p>
      </div>
    </div>
  );
}
