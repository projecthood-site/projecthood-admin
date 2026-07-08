// Small display helpers shared across screens.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function dateBlock(iso) {
  if (!iso) return { mon: '', day: '' };
  const d = new Date(iso);
  if (isNaN(d)) return { mon: '', day: '' };
  return { mon: MONTHS[d.getMonth()], day: String(d.getDate()).padStart(2, '0') };
}

export function eventMeta(iso, location) {
  const parts = [];
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d)) {
      parts.push(
        d.toLocaleString(undefined, {
          weekday: 'short', hour: 'numeric', minute: '2-digit',
        })
      );
    }
  }
  if (location) parts.push(location);
  return parts.join(' · ');
}

export function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// tint name -> [background, foreground] using CSS vars from tokens.css
export function tint(name) {
  const map = {
    green: ['var(--green-t)', 'var(--green-d)'],
    amber: ['var(--amber-t)', 'var(--amber-d)'],
    neutral: ['var(--neutral-t)', 'var(--muted)'],
    purple: ['var(--purple-t)', 'var(--purple-d)'],
    blue: ['var(--blue-t)', 'var(--blue-d)'],
    red: ['#f7ded9', 'var(--red-ink)'],
  };
  return map[name] || map.neutral;
}

// status -> tint name for the status pill
export function statusTint(status) {
  return ({ draft: 'amber', scheduled: 'blue', published: 'green' })[status] || 'neutral';
}
