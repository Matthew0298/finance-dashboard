import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePortfolio, importJson, exportJson, valuePortfolio, demoPortfolio,
  loadPortfolio, savePortfolio, emptyPortfolio, fxRate,
} from './portfolio.js';

const IDS = ['SWDA', 'AAPL', 'BTC'];
const universe = [
  { id: 'SWDA', name: 'World', currency: 'EUR', asset_class: 'azionario', tax_class: 'etf_ucits', ter: 0.2 },
  { id: 'AAPL', name: 'Apple', currency: 'USD', asset_class: 'azionario', tax_class: 'azione', ter: 0 },
];
const signals = { instruments: { SWDA: { status: 'ok', last_price: 100 }, AAPL: { status: 'ok', last_price: 200 } } };
const fx = { rates: { USD: 1.25 } };

test('portafoglio valido: i campi vengono normalizzati', () => {
  const r = validatePortfolio(
    { version: 1, positions: [{ id: 'SWDA', quantity: 10, avgCost: 90 }], lossCarryforward: [{ year: 2024, amount: 100 }], targets: { azionario: 0.7 } },
    IDS,
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.positions[0].custody, 'italia');
});

test('errori: strumento sconosciuto, duplicati, quantità, pesi oltre il 100%', () => {
  const r = validatePortfolio(
    {
      version: 1,
      positions: [{ id: 'XXX', quantity: 1, avgCost: 1 }, { id: 'SWDA', quantity: 1, avgCost: 1 }, { id: 'SWDA', quantity: 1, avgCost: 1 }, { id: 'AAPL', quantity: -3, avgCost: 1 }],
      targets: { azionario: 0.8, obbligazionario: 0.4 },
    },
    IDS,
  );
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
  assert.equal(r.value.positions.length, 1);
});

test('import di JSON rotto e di versione sbagliata', () => {
  assert.equal(importJson('{non json', IDS).ok, false);
  assert.equal(importJson('{"version":2}', IDS).ok, false);
  assert.equal(importJson('[]', IDS).ok, false);
});

test('export e import fanno il giro completo', () => {
  const original = { version: 1, positions: [{ id: 'SWDA', quantity: 2, avgCost: 50, custody: 'estero' }], lossCarryforward: [], targets: {}, updatedAt: null };
  const back = importJson(exportJson(original), IDS);
  assert.equal(back.ok, true);
  assert.deepEqual(back.value.positions, original.positions);
});

test('valorizzazione: 10 x 100 = 1000 EUR; 5 x 200 USD / 1,25 = 800 EUR', () => {
  const portfolio = { version: 1, positions: [{ id: 'SWDA', quantity: 10, avgCost: 80, custody: 'italia' }, { id: 'AAPL', quantity: 5, avgCost: 125, custody: 'estero' }], lossCarryforward: [], targets: {} };
  const v = valuePortfolio({ portfolio, universe, signals, fx });
  assert.equal(v.totalValueEur, 1800);
  assert.equal(v.rows[1].valueEur, 800);
  assert.equal(v.rows[1].costEur, 500); // 5 * 125 / 1,25
  assert.equal(v.pnlEur, 1800 - (800 + 500));
  assert.ok(Math.abs(v.rows[0].weight - 1000 / 1800) < 1e-12);
  assert.ok(Math.abs(v.byAssetClass.azionario - 1) < 1e-12);
});

test('posizioni senza prezzo o senza cambio finiscono in missing, non nel totale', () => {
  const portfolio = { version: 1, positions: [{ id: 'SWDA', quantity: 1, avgCost: 1, custody: 'italia' }, { id: 'AAPL', quantity: 1, avgCost: 1, custody: 'italia' }], lossCarryforward: [], targets: {} };
  const v = valuePortfolio({ portfolio, universe, signals, fx: { rates: {} } });
  assert.deepEqual(v.missing, ['AAPL']);
  assert.equal(v.totalValueEur, 100);
  assert.equal(fxRate({ rates: {} }, 'USD'), null);
  assert.equal(fxRate(fx, 'EUR'), 1);
});

test('portafoglio demo: quantità dal valore in euro, solo strumenti con prezzo, minusvalenze relative all’anno', () => {
  const sig = {
    instruments: {
      SWDA: { status: 'ok', last_price: 100, currency: 'EUR' },
      AAPL: { status: 'ok', last_price: 250, currency: 'USD' },
      ENEL: { status: 'insufficient_history' },
    },
  };
  const demo = demoPortfolio(sig, { rates: { USD: 1.25 } }, 2026);
  assert.deepEqual(demo.positions.map((p) => p.id), ['SWDA', 'AAPL']);
  assert.equal(demo.positions[0].quantity, 120); // 12000 EUR / 100
  assert.equal(demo.positions[0].avgCost, 92);
  assert.equal(demo.positions[1].quantity, 10); // 2000 EUR * 1,25 USD/EUR / 250 USD
  assert.deepEqual(demo.lossCarryforward.map((e) => e.year), [2022, 2024]);
  assert.equal(demoPortfolio(sig, { rates: {} }, 2026).positions.length, 1, 'AAPL escluso senza cambio USD');
});

test('storage non disponibile: nessuna eccezione', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadPortfolio(broken), emptyPortfolio());
  assert.equal(savePortfolio(emptyPortfolio(), broken), false);
});

test('storage funzionante: salva e rilegge', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const p = { ...emptyPortfolio(), positions: [{ id: 'SWDA', quantity: 1, avgCost: 1, custody: 'italia' }] };
  assert.equal(savePortfolio(p, storage), true);
  assert.equal(loadPortfolio(storage).positions[0].id, 'SWDA');
});
