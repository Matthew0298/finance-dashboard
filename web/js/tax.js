// Italian tax calculators as pure functions. Rules and sources: data/compliance/rules.json.
//
// Deliberate simplifications (each one is returned to the user as a warning or note):
//  - titoli di Stato (12,5%): no offsetting with losses and no carry-forward (ragguaglio 48,08% not modelled)
//  - cripto: no offsetting and no carry-forward
//  - bollo/IVAFE: full year on the value at year end, no pro-rata for the holding period
//  - the carry-forward pool is passed in and returned: chain calls to process several sales

export const TAX_CLASSES = {
  azione:         { label: 'Azione',                   rate: 0.26,  kind: 'diversi',  offsettable: true,  lossToPool: true },
  etf_ucits:      { label: 'ETF / fondo armonizzato',  rate: 0.26,  kind: 'capitale', offsettable: false, lossToPool: true },
  etc_etn:        { label: 'ETC / ETN',                rate: 0.26,  kind: 'diversi',  offsettable: true,  lossToPool: true },
  obbl_corporate: { label: 'Obbligazione societaria',  rate: 0.26,  kind: 'diversi',  offsettable: true,  lossToPool: true },
  titolo_stato:   { label: 'Titolo di Stato',          rate: 0.125, kind: 'diversi',  offsettable: false, lossToPool: false },
  fondo:          { label: 'Fondo comune',             rate: 0.26,  kind: 'capitale', offsettable: false, lossToPool: true },
  cripto:         { label: 'Cripto-attività',          rate: 0.33,  kind: 'diversi',  offsettable: false, lossToPool: false },
};

export const CARRY_YEARS = 4; // losses of year Y are usable until the end of year Y + 4
export const WEALTH_TAX_RATE = 0.002; // bollo (Italian custody) or IVAFE (foreign custody)
export const FTT_RATES = { regolamentato: 0.001, fuoriMercato: 0.002 };

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export function usableLosses(carryforward, year) {
  return carryforward
    .filter((e) => e.amount > 0 && e.year <= year && year <= e.year + CARRY_YEARS)
    .sort((a, b) => a.year - b.year);
}

export function expiringLosses(carryforward, year) {
  return carryforward.filter((e) => e.amount > 0 && e.year + CARRY_YEARS === year);
}

/**
 * Tax due on a sale.
 * @returns {{gain, rate, taxableBase, tax, offsetUsed, newLoss, carryforwardAfter, warnings, notes}}
 */
export function sellTax({ taxClass, proceeds, cost, fees = 0, carryforward = [], year, euroToken = false }) {
  const cls = TAX_CLASSES[taxClass];
  if (!cls) throw new Error(`classe fiscale sconosciuta: ${taxClass}`);
  for (const [name, v] of Object.entries({ proceeds, cost, fees })) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`${name} deve essere un numero >= 0`);
  }
  if (!Number.isInteger(year)) throw new Error('year deve essere un anno intero');

  const rate = taxClass === 'cripto' && euroToken ? 0.26 : cls.rate;
  const gain = round2(proceeds - cost - fees);
  const warnings = [];
  const notes = [];
  const pool = carryforward.filter((e) => e.year + CARRY_YEARS >= year).map((e) => ({ ...e })); // drop expired
  const result = { gain, rate, taxableBase: 0, tax: 0, offsetUsed: [], newLoss: 0, carryforwardAfter: pool, warnings, notes };

  if (gain <= 0) {
    if (gain < 0) {
      if (cls.lossToPool) {
        result.newLoss = round2(-gain);
        pool.push({ year, amount: result.newLoss });
        notes.push(`Minusvalenza di ${result.newLoss} euro riportabile fino al 31/12/${year + CARRY_YEARS}, solo contro plusvalenze da redditi diversi.`);
      } else {
        warnings.push('Per questo tipo di strumento il calcolatore non riporta la minusvalenza: verifica la compensazione con il tuo intermediario o commercialista.');
      }
    }
    return result;
  }

  let base = gain;
  if (cls.offsettable) {
    for (const entry of usableLosses(pool, year)) {
      if (base <= 0) break;
      const used = Math.min(entry.amount, base);
      entry.amount = round2(entry.amount - used);
      base = round2(base - used);
      result.offsetUsed.push({ year: entry.year, used: round2(used) });
    }
    if (result.offsetUsed.length === 0 && carryforward.length > 0) {
      notes.push('Nessuna minusvalenza utilizzabile: quelle indicate sono scadute o di anni successivi.');
    }
  } else if (cls.kind === 'capitale') {
    notes.push('Il guadagno su ETF e fondi armonizzati è reddito di capitale: tassato per intero e non compensabile con le minusvalenze.');
    notes.push('La quota riferibile a titoli pubblici può avere un trattamento di favore (12,5% pro quota): le fonti sono discordi per gli ETF UCITS esteri, verifica con il broker.');
  } else if (taxClass === 'titolo_stato') {
    warnings.push('Titoli di Stato: compensazione con minusvalenze (ragguaglio al 48,08%) non gestita da questo calcolatore.');
  } else if (taxClass === 'cripto') {
    warnings.push('Cripto-attività: compensazione e riporto delle minusvalenze non gestiti da questo calcolatore.');
    notes.push(euroToken ? 'Token di moneta elettronica in euro conformi a MiCAR: aliquota 26%.' : 'Aliquota 33% dal 1/1/2026, senza franchigia.');
  }

  result.taxableBase = base;
  result.tax = round2(base * rate);
  result.carryforwardAfter = pool.filter((e) => e.amount > 0);
  return result;
}

/** Annual stamp duty (Italian custody) or IVAFE (foreign custody, also needs Quadro RW). */
export function annualWealthTax({ value, custody }) {
  if (!Number.isFinite(value) || value < 0) throw new Error('value deve essere un numero >= 0');
  const foreign = custody === 'estero';
  return {
    kind: foreign ? 'IVAFE' : 'bollo',
    amount: round2(value * WEALTH_TAX_RATE),
    needsRW: foreign,
    notes: [
      'Calcolo su un anno intero, sul valore al 31/12: nessun ragguaglio ai mesi di detenzione.',
      foreign
        ? 'Custodia estera: IVAFE 0,2% e indicazione nel Quadro RW anche senza operazioni.'
        : 'Custodia italiana: il bollo è trattenuto dall’intermediario.',
    ],
  };
}

/** Estimate of the financial transaction tax on a purchase of Italian shares (rates: da_verificare). */
export function transactionTax({ taxClass, value, venue = 'regolamentato', italianLargeCap = false }) {
  const applies = taxClass === 'azione' && italianLargeCap;
  const rate = venue === 'fuoriMercato' ? FTT_RATES.fuoriMercato : FTT_RATES.regolamentato;
  return { applies, rate: applies ? rate : 0, amount: applies ? round2(value * rate) : 0 };
}
