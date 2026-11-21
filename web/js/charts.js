// Hand-written SVG charts: no third-party code in the page (ADR-0001, ADR-0004).
// Colours and strokes come from CSS classes (strict CSP forbids inline style attributes).

import { esc, spct } from './format.js';

const f = (x) => Number(x.toFixed(2));

/** Linear interpolation in sqrt(time) between the horizons: cones widen roughly with sqrt(t). */
function interpolate(horizons, values, day) {
  for (let i = 1; i < horizons.length; i += 1) {
    if (day <= horizons[i]) {
      const a = Math.sqrt(horizons[i - 1]);
      const b = Math.sqrt(horizons[i]);
      const t = b === a ? 0 : (Math.sqrt(day) - a) / (b - a);
      return values[i - 1] + (values[i] - values[i - 1]) * t;
    }
  }
  return values[values.length - 1];
}

/** Price history (weekly points, indexed to today = 1) followed by the scenario cone. */
export function coneChart({ spark, scenario, label, width = 680, height = 300 }) {
  const pad = { l: 52, r: 14, t: 14, b: 30 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const last = spark[spark.length - 1];
  const history = spark.map((v) => v / last);
  const weeksBack = history.length - 1;
  const horizons = scenario.horizons;
  const weeksAhead = horizons[horizons.length - 1] / 5;
  const x = (week) => pad.l + (week / (weeksBack + weeksAhead)) * w;
  const q = scenario.quantiles;

  const days = [];
  for (let d = 0; d <= horizons[horizons.length - 1]; d += 3) days.push(d);
  if (days[days.length - 1] !== horizons[horizons.length - 1]) days.push(horizons[horizons.length - 1]);
  const series = (key) => days.map((d) => ({ week: weeksBack + d / 5, v: interpolate(horizons, q[key], d) }));
  const [p10, p25, p50, p75, p90] = ['p10', 'p25', 'p50', 'p75', 'p90'].map(series);

  const all = [...history, ...q.p10, ...q.p90];
  const yMin = Math.min(...all) * 0.97;
  const yMax = Math.max(...all) * 1.03;
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * h;

  const band = (lo, hi) => {
    const top = hi.map((p) => `${f(x(p.week))},${f(y(p.v))}`);
    const bottom = [...lo].reverse().map((p) => `${f(x(p.week))},${f(y(p.v))}`);
    return [...top, ...bottom].join(' ');
  };
  const line = (pts) => pts.map((p) => `${f(x(p.week))},${f(y(p.v))}`).join(' ');
  const histPts = history.map((v, i) => ({ week: i, v }));

  const ticks = [yMin, 1, yMax].map((v) => ({ v, label: spct(v - 1, 0) }));
  const yearsBack = Math.max(1, Math.round(weeksBack / 52));

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
    ${ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${width - pad.r}" y1="${f(y(t.v))}" y2="${f(y(t.v))}"/><text class="axis-label" x="${pad.l - 6}" y="${f(y(t.v)) + 4}" text-anchor="end">${esc(t.label)}</text>`).join('')}
    <line class="today" x1="${f(x(weeksBack))}" x2="${f(x(weeksBack))}" y1="${pad.t}" y2="${pad.t + h}"/>
    <polygon class="band-outer" points="${band(p10, p90)}"/>
    <polygon class="band-inner" points="${band(p25, p75)}"/>
    <polyline class="history" points="${line(histPts)}"/>
    <polyline class="median" points="${line(p50)}"/>
    <text class="axis-label" x="${pad.l}" y="${height - 8}">−${yearsBack} ${yearsBack === 1 ? 'anno' : 'anni'}</text>
    <text class="axis-label" x="${f(x(weeksBack))}" y="${height - 8}" text-anchor="middle">oggi</text>
    <text class="axis-label" x="${width - pad.r}" y="${height - 8}" text-anchor="end">+1 anno</text>
  </svg>`;
}

/** Tiny trend line for tables. */
export function sparkline(values, { width = 96, height = 28 } = {}) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${f((i / (values.length - 1)) * width)},${f(height - 2 - ((v - min) / span) * (height - 4))}`).join(' ');
  const cls = values[values.length - 1] >= values[0] ? 'spark up' : 'spark down';
  return `<svg class="${cls}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

/** Horizontal bar 0-100% with an optional target marker. */
export function allocBar(share, target = null) {
  const w = f(Math.max(0, Math.min(1, share)) * 100);
  const marker = target === null ? '' : `<line class="alloc-target" x1="${f(target * 100)}" x2="${f(target * 100)}" y1="0" y2="10"/>`;
  return `<svg class="alloc" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="alloc-bg" width="100" height="10"/><rect class="alloc-fill" width="${w}" height="10"/>${marker}</svg>`;
}
