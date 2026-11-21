import test from 'node:test';
import assert from 'node:assert/strict';
import { sellTax, annualWealthTax, transactionTax, expiringLosses, usableLosses } from './tax.js';

// Golden cases: the arithmetic is written out so that a reviewer can redo it by hand.

test('azione, plusvalenza semplice: 1500 - 1000 - 5 = 495, 26% = 128,70', () => {
  const r = sellTax({ taxClass: 'azione', proceeds: 1500, cost: 1000, fees: 5, year: 2026 });
  assert.equal(r.gain, 495);
  assert.equal(r.tax, 128.7);
  assert.equal(r.rate, 0.26);
});

test('ETF: le minusvalenze NON compensano il guadagno (reddito di capitale): 500 * 26% = 130', () => {
  const r = sellTax({ taxClass: 'etf_ucits', proceeds: 1500, cost: 1000, year: 2026, carryforward: [{ year: 2025, amount: 300 }] });
  assert.equal(r.tax, 130);
  assert.deepEqual(r.offsetUsed, []);
  assert.deepEqual(r.carryforwardAfter, [{ year: 2025, amount: 300 }]);
});

test('azione: compensazione FIFO. 500 di guadagno, perdite 300 (2022) e 100 (2025) nel 2026 -> base 100, imposta 26', () => {
  const r = sellTax({
    taxClass: 'azione', proceeds: 1500, cost: 1000, year: 2026,
    carryforward: [{ year: 2025, amount: 100 }, { year: 2022, amount: 300 }],
  });
  assert.deepEqual(r.offsetUsed, [{ year: 2022, used: 300 }, { year: 2025, used: 100 }]);
  assert.equal(r.taxableBase, 100);
  assert.equal(r.tax, 26);
  assert.deepEqual(r.carryforwardAfter, []);
});

test('le perdite del 2022 sono utilizzabili nel 2026 ma non nel 2027', () => {
  const pool = [{ year: 2022, amount: 300 }];
  assert.equal(usableLosses(pool, 2026).length, 1);
  assert.equal(usableLosses(pool, 2027).length, 0);
  assert.deepEqual(expiringLosses([{ year: 2022, amount: 300 }, { year: 2023, amount: 200 }], 2026), [{ year: 2022, amount: 300 }]);
  const r = sellTax({ taxClass: 'azione', proceeds: 1500, cost: 1000, year: 2027, carryforward: pool });
  assert.equal(r.tax, 130, 'perdita scaduta: nessuna compensazione');
  assert.deepEqual(r.carryforwardAfter, []);
});

test('compensazione parziale: perdita 200, guadagno 500 -> base 300, imposta 78; resta 0', () => {
  const r = sellTax({ taxClass: 'etc_etn', proceeds: 1500, cost: 1000, year: 2026, carryforward: [{ year: 2024, amount: 200 }] });
  assert.equal(r.taxableBase, 300);
  assert.equal(r.tax, 78);
});

test('titolo di Stato: 1000 * 12,5% = 125, con avviso sulla compensazione', () => {
  const r = sellTax({ taxClass: 'titolo_stato', proceeds: 11000, cost: 10000, year: 2026 });
  assert.equal(r.tax, 125);
  assert.ok(r.warnings.length > 0);
});

test('minusvalenza su azione: imposta 0 e perdita riportata nel pool con l’anno corrente', () => {
  const r = sellTax({ taxClass: 'azione', proceeds: 700, cost: 1000, year: 2026, carryforward: [{ year: 2024, amount: 50 }] });
  assert.equal(r.tax, 0);
  assert.equal(r.newLoss, 300);
  assert.deepEqual(r.carryforwardAfter, [{ year: 2024, amount: 50 }, { year: 2026, amount: 300 }]);
});

test('minusvalenza su ETF: entra nel pool (si userà contro redditi diversi)', () => {
  const r = sellTax({ taxClass: 'etf_ucits', proceeds: 900, cost: 1000, year: 2026 });
  assert.equal(r.newLoss, 100);
  assert.deepEqual(r.carryforwardAfter, [{ year: 2026, amount: 100 }]);
});

test('cripto: 1000 * 33% = 330, euro-token 26% = 260', () => {
  assert.equal(sellTax({ taxClass: 'cripto', proceeds: 2000, cost: 1000, year: 2026 }).tax, 330);
  assert.equal(sellTax({ taxClass: 'cripto', proceeds: 2000, cost: 1000, year: 2026, euroToken: true }).tax, 260);
});

test('bollo 0,2% su 50.000 = 100; custodia estera: IVAFE 100 e Quadro RW', () => {
  const it = annualWealthTax({ value: 50000, custody: 'italia' });
  assert.deepEqual([it.kind, it.amount, it.needsRW], ['bollo', 100, false]);
  const ex = annualWealthTax({ value: 50000, custody: 'estero' });
  assert.deepEqual([ex.kind, ex.amount, ex.needsRW], ['IVAFE', 100, true]);
});

test('imposta sulle transazioni: 0,1% su 10.000 = 10 solo per azioni italiane grandi', () => {
  assert.equal(transactionTax({ taxClass: 'azione', value: 10000, italianLargeCap: true }).amount, 10);
  assert.equal(transactionTax({ taxClass: 'azione', value: 10000, italianLargeCap: true, venue: 'fuoriMercato' }).amount, 20);
  assert.equal(transactionTax({ taxClass: 'azione', value: 10000, italianLargeCap: false }).amount, 0);
  assert.equal(transactionTax({ taxClass: 'etf_ucits', value: 10000, italianLargeCap: true }).amount, 0);
});

test('input non validi vengono rifiutati', () => {
  assert.throws(() => sellTax({ taxClass: 'boh', proceeds: 1, cost: 1, year: 2026 }), /sconosciuta/);
  assert.throws(() => sellTax({ taxClass: 'azione', proceeds: -1, cost: 1, year: 2026 }), /proceeds/);
  assert.throws(() => sellTax({ taxClass: 'azione', proceeds: 1, cost: 1, year: 26.5 }), /anno/);
  assert.throws(() => annualWealthTax({ value: NaN, custody: 'italia' }), /value/);
});

test('il pool passato in ingresso non viene modificato', () => {
  const pool = [{ year: 2024, amount: 200 }];
  sellTax({ taxClass: 'azione', proceeds: 1500, cost: 1000, year: 2026, carryforward: pool });
  assert.deepEqual(pool, [{ year: 2024, amount: 200 }]);
});
