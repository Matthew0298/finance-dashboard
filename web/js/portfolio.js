// Local portfolio: validation, storage in the browser, import/export, valuation.
// The portfolio never leaves the device (ADR-0001).

export const STORAGE_KEY = 'fd.portfolio.v1';
export const CUSTODY = ['italia', 'estero'];

export function emptyPortfolio() {
  return { version: 1, positions: [], lossCarryforward: [], targets: {}, updatedAt: null };
}

export function validatePortfolio(input, knownIds) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Il contenuto non è un portafoglio valido.'], value: null };
  }
  const errors = [];
  if (input.version !== 1) errors.push(`Versione del file non supportata: ${input.version}`);
  const value = emptyPortfolio();

  const seen = new Set();
  const positions = Array.isArray(input.positions) ? input.positions : [];
  positions.forEach((p, i) => {
    const label = `Posizione ${i + 1}`;
    if (!p || typeof p.id !== 'string' || !knownIds.includes(p.id)) return errors.push(`${label}: strumento sconosciuto`);
    if (seen.has(p.id)) return errors.push(`${label}: ${p.id} è duplicato`);
    if (!Number.isFinite(p.quantity) || p.quantity <= 0) return errors.push(`${label} (${p.id}): quantità non valida`);
    if (!Number.isFinite(p.avgCost) || p.avgCost < 0) return errors.push(`${label} (${p.id}): costo medio non valido`);
    seen.add(p.id);
    value.positions.push({ id: p.id, quantity: p.quantity, avgCost: p.avgCost, custody: CUSTODY.includes(p.custody) ? p.custody : 'italia' });
  });

  (Array.isArray(input.lossCarryforward) ? input.lossCarryforward : []).forEach((e, i) => {
    if (!e || !Number.isInteger(e.year) || e.year < 2000 || e.year > 2100 || !Number.isFinite(e.amount) || e.amount <= 0) {
      return errors.push(`Minusvalenza ${i + 1}: anno o importo non validi`);
    }
    value.lossCarryforward.push({ year: e.year, amount: e.amount });
  });

  const targets = input.targets && typeof input.targets === 'object' && !Array.isArray(input.targets) ? input.targets : {};
  let total = 0;
  for (const [cls, weight] of Object.entries(targets)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      errors.push(`Peso obiettivo di ${cls} non valido`);
      continue;
    }
    total += weight;
    value.targets[cls] = weight;
  }
  if (total > 1.0001) errors.push('I pesi obiettivo sommano più del 100%');

  value.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : null;
  return { ok: errors.length === 0, errors, value };
}

export function loadPortfolio(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : emptyPortfolio();
  } catch {
    return emptyPortfolio();
  }
}

export function savePortfolio(portfolio, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ ...portfolio, updatedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false; // private mode or storage disabled: the app keeps working in memory
  }
}

export function clearPortfolio(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export const exportJson = (portfolio) => JSON.stringify({ ...portfolio, updatedAt: new Date().toISOString() }, null, 2);

export function importJson(text, knownIds) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Il file non è un JSON valido.'], value: null };
  }
  return validatePortfolio(parsed, knownIds);
}

export function fxRate(fx, currency) {
  if (currency === 'EUR') return 1;
  const rate = fx?.rates?.[currency];
  return Number.isFinite(rate) && rate > 0 ? rate : null; // units of currency per 1 EUR
}

/** Value positions in EUR. Foreign-currency cost is converted at today's rate (an approximation). */
export function valuePortfolio({ portfolio, universe, signals, fx }) {
  const byId = new Map(universe.map((i) => [i.id, i]));
  const rows = [];
  const missing = [];
  for (const pos of portfolio.positions) {
    const inst = byId.get(pos.id);
    const sig = signals?.instruments?.[pos.id];
    const rate = inst ? fxRate(fx, inst.currency) : null;
    if (!inst || !sig || sig.status !== 'ok' || rate === null) {
      missing.push(pos.id);
      continue;
    }
    const valueEur = (pos.quantity * sig.last_price) / rate;
    const costEur = (pos.quantity * pos.avgCost) / rate;
    rows.push({
      ...pos,
      name: inst.name,
      assetClass: inst.asset_class,
      taxClass: inst.tax_class,
      currency: inst.currency,
      ter: inst.ter,
      price: sig.last_price,
      valueEur,
      costEur,
      pnlEur: valueEur - costEur,
      pnlPct: costEur > 0 ? valueEur / costEur - 1 : null,
    });
  }
  const totalValueEur = rows.reduce((s, r) => s + r.valueEur, 0);
  const totalCostEur = rows.reduce((s, r) => s + r.costEur, 0);
  const byAssetClass = {};
  const byCurrency = {};
  for (const r of rows) {
    r.weight = totalValueEur > 0 ? r.valueEur / totalValueEur : 0;
    byAssetClass[r.assetClass] = (byAssetClass[r.assetClass] ?? 0) + r.weight;
    byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + r.weight;
  }
  return { rows, missing, totalValueEur, totalCostEur, pnlEur: totalValueEur - totalCostEur, byAssetClass, byCurrency };
}

/**
 * Fictional example portfolio. Each position is defined by a target value in EUR, so the example
 * stays sensible whatever the prices are; the cost basis is today's price times a fixed factor.
 */
export function demoPortfolio(signals, fx, year) {
  // id: [value in EUR, cost basis factor against today's price, custody]
  const spec = {
    SWDA: [12000, 0.92, 'italia'],
    VWCE: [8000, 1.04, 'italia'],
    SEGA: [6000, 1.02, 'italia'],
    ENEL: [1500, 0.88, 'italia'],
    AAPL: [2000, 0.8, 'estero'],
    BTC: [500, 1.3, 'estero'],
  };
  const round4 = (x) => Math.round(x * 10000) / 10000;
  const positions = [];
  for (const [id, [valueEur, factor, custody]] of Object.entries(spec)) {
    const sig = signals?.instruments?.[id];
    const rate = sig ? fxRate(fx, sig.currency) : null;
    if (sig?.status !== 'ok' || rate === null) continue;
    positions.push({ id, quantity: round4((valueEur * rate) / sig.last_price), avgCost: round4(sig.last_price * factor), custody });
  }
  return {
    version: 1,
    positions,
    lossCarryforward: [{ year: year - 4, amount: 450 }, { year: year - 2, amount: 200 }],
    targets: { azionario: 0.6, obbligazionario: 0.3, materie_prime: 0.05, crypto: 0.05 },
    updatedAt: null,
  };
}
