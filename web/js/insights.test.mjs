import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from './insights.js';
import { valuePortfolio } from './portfolio.js';

const universe = [
  { id: 'ETF', name: 'Fondo Mondo', currency: 'EUR', asset_class: 'azionario', tax_class: 'etf_ucits', ter: 0.2 },
  { id: 'STK', name: 'Azione Uno', currency: 'EUR', asset_class: 'azionario', tax_class: 'azione', ter: 0 },
  { id: 'USA', name: 'Azione USA', currency: 'USD', asset_class: 'azionario', tax_class: 'azione', ter: 0 },
  { id: 'BND', name: 'Fondo Bond', currency: 'EUR', asset_class: 'obbligazionario', tax_class: 'etf_ucits', ter: 0.1 },
];
const cone = (p10, p50, p90) => ({
  horizons: [0, 252],
  quantiles: { p10: [1, p10], p25: [1, p10], p50: [1, p50], p75: [1, p90], p90: [1, p90] },
  prob_loss: 0.3,
});
const entry = (price, extra = {}) => ({
  status: 'ok', last_price: price,
  signals: { max_drawdown_1y: -0.1 },
  scenario: cone(0.8, 1.05, 1.3),
  calibration: { observed: 0.78, n_windows: 40 },
  ...extra,
});
const signals = { instruments: { ETF: entry(100), STK: entry(100), USA: entry(100), BND: entry(100) } };
const fx = { rates: { USD: 1 } };
const today = new Date(2026, 10, 21); // 21 novembre 2026

function run(portfolio, sig = signals) {
  const full = { version: 1, positions: [], lossCarryforward: [], targets: {}, ...portfolio };
  const valuation = valuePortfolio({ portfolio: full, universe, signals: sig, fx });
  return buildInsights({ portfolio: full, valuation, signals: sig, today });
}
const ids = (list) => list.map((i) => i.id);

test('azione singola al 40%: concentrazione importante; fondo al 60%: nessun avviso', () => {
  const r = run({ positions: [{ id: 'STK', quantity: 40, avgCost: 90, custody: 'italia' }, { id: 'ETF', quantity: 60, avgCost: 90, custody: 'italia' }] });
  const c = r.find((i) => i.id === 'rischio.concentrazione.STK');
  assert.equal(c.severity, 'importante');
  assert.equal(r.find((i) => i.id === 'rischio.concentrazione.ETF'), undefined);
});

test('azione al 20%: attenzione (soglia 15%, importante dal 30%)', () => {
  const r = run({ positions: [{ id: 'STK', quantity: 20, avgCost: 90, custody: 'italia' }, { id: 'ETF', quantity: 80, avgCost: 90, custody: 'italia' }] });
  assert.equal(r.find((i) => i.id === 'rischio.concentrazione.STK').severity, 'attenzione');
});

test('scostamento dal peso obiettivo: 100% azionario contro 70% -> importante', () => {
  const r = run({
    positions: [{ id: 'ETF', quantity: 10, avgCost: 90, custody: 'italia' }],
    targets: { azionario: 0.7, obbligazionario: 0.3 },
  });
  assert.equal(r.find((i) => i.id === 'rischio.scostamento.azionario').severity, 'importante');
  assert.equal(r.find((i) => i.id === 'rischio.scostamento.obbligazionario').severity, 'importante');
});

test('minusvalenze del 2022 nel 2026: scadono a fine anno (mancano meno di 90 giorni -> importante)', () => {
  const r = run({ lossCarryforward: [{ year: 2022, amount: 450 }, { year: 2024, amount: 100 }] });
  const loss = r.filter((i) => i.id.startsWith('fisco.loss_expiring'));
  assert.equal(loss.length, 1);
  assert.equal(loss[0].id, 'fisco.loss_expiring.2022');
  assert.equal(loss[0].severity, 'importante');
});

test('broker estero: promemoria Quadro RW', () => {
  const r = run({ positions: [{ id: 'USA', quantity: 10, avgCost: 90, custody: 'estero' }, { id: 'ETF', quantity: 90, avgCost: 90, custody: 'italia' }] });
  const rw = r.find((i) => i.id === 'dichiarazione.rw');
  assert.ok(rw);
  assert.match(rw.title, /1 posizioni/);
});

test('minusvalenze e plusvalenze latenti solo su ETF: avviso informativo', () => {
  const r = run({
    positions: [{ id: 'ETF', quantity: 10, avgCost: 50, custody: 'italia' }],
    lossCarryforward: [{ year: 2025, amount: 300 }],
  });
  assert.ok(ids(r).includes('fisco.minusvalenze_etf'));
});

test('scenario di portafoglio: fascia prudenziale pesata e affidabilità storica', () => {
  const r = run({ positions: [{ id: 'ETF', quantity: 50, avgCost: 90, custody: 'italia' }, { id: 'BND', quantity: 50, avgCost: 90, custody: 'italia' }] });
  const s = r.find((i) => i.id === 'scenario.portafoglio');
  assert.ok(s);
  assert.ok(s.because.some((t) => t.includes('2 strumenti su 2')));
});

test('nessun consiglio operativo: nessun testo con "compra" o "vendi"', () => {
  const r = run({
    positions: [{ id: 'STK', quantity: 40, avgCost: 90, custody: 'estero' }, { id: 'ETF', quantity: 60, avgCost: 90, custody: 'italia' }],
    lossCarryforward: [{ year: 2022, amount: 100 }],
    targets: { azionario: 0.5 },
  });
  const text = r.map((i) => `${i.title} ${i.detail} ${i.because.join(' ')}`).join(' ').toLowerCase();
  assert.doesNotMatch(text, /\b(compra|comprare|acquista|vendi|vendere)\b/);
});

test('ordinamento per severità: importante prima di attenzione prima di info', () => {
  const r = run({
    positions: [{ id: 'STK', quantity: 40, avgCost: 90, custody: 'estero' }, { id: 'ETF', quantity: 60, avgCost: 90, custody: 'italia' }],
    lossCarryforward: [{ year: 2022, amount: 100 }],
  });
  const order = { importante: 0, attenzione: 1, info: 2 };
  const sev = r.map((i) => order[i.severity]);
  assert.deepEqual(sev, [...sev].sort((a, b) => a - b));
});

test('posizioni senza prezzo: avviso sui dati mancanti', () => {
  const sig = { instruments: { ETF: entry(100), STK: { status: 'insufficient_history', n_obs: 50 } } };
  const r = run({ positions: [{ id: 'ETF', quantity: 1, avgCost: 1, custody: 'italia' }, { id: 'STK', quantity: 1, avgCost: 1, custody: 'italia' }] }, sig);
  assert.ok(ids(r).includes('dati.missing'));
});

test('portafoglio vuoto: nessuna osservazione di rischio', () => {
  assert.deepEqual(run({}), []);
});
