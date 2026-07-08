import { tint } from '../lib/format';

// Generic pill. Pass either an explicit tint name or a label + tint.
export default function Pill({ label, tintName = 'neutral' }) {
  const [bg, fg] = tint(tintName);
  return (
    <span className="pill" style={{ background: bg, color: fg }}>
      {label}
    </span>
  );
}
