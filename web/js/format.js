// Formatting helpers (Italian locale) and HTML escaping. No DOM access: usable in Node tests.

const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const numFmt = (digits) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pctFmt = (digits, sign) =>
  new Intl.NumberFormat('it-IT', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: sign,
  });

const finite = Number.isFinite;

export const eur = (x) => (finite(x) ? eurFmt.format(x) : '–');
export const num = (x, digits = 2) => (finite(x) ? numFmt(digits).format(x) : '–');
export const pct = (x, digits = 1) => (finite(x) ? pctFmt(digits, 'never').format(Math.abs(x)) : '–');
export const spct = (x, digits = 1) => (finite(x) ? pctFmt(digits, 'exceptZero').format(x) : '–');

export function dateIt(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
