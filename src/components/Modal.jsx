import { useEffect } from 'react';

export default function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-root" role="dialog" aria-modal="true">
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal-card">
        <div className="ak" style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 24, color: 'var(--ink)' }}>{title}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
