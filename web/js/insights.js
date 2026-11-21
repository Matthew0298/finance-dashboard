// Observations about the user's portfolio. Pure functions: everything runs in the browser (ADR-0001).
//
// These are general observations on risk, cost, tax and scenarios, each with its reasons and data.
// They never say "buy" or "sell" a specific security (ADR-0003).

import { annualWealthTax, expiringLosses, CARRY_YEARS } from './tax.js';
import { eur, pct, spct } from './format.js';

export const THRESHOLDS = {
  singleNameAttention: 0.15, // share of portfolio in one single stock/bond/crypto
  singleNameImportant: 0.30,
  fundAttention: 0.70, // share of portfolio in one single fund
  driftAttention: 0.05, // distance from target weight
  driftImportant: 0.10,
  terHighPct: 0.40, // weighted TER, in % per year
  foreignCurrency: 0.25,
  deepDrawdown: -0.30,
  calibrationOk: [0.6, 0.95],
};

const SINGLE_NAME = new Set(['azione', 'obbl_corporate', 'cripto']);
const SEVERITY_ORDER = { importante: 0, attenzione: 1, info: 2 };

const daysUntilYearEnd = (today, year) => Math.max(0, Math.ceil((Date.UTC(year, 11, 31, 23, 59, 59) - today.getTime()) / 86400000));

export function buildInsights({ portfolio, valuation, signals, today = new Date() }) {
  const out = [];
  const add = (insight) => out.push(insight);
  const { rows, missing, totalValueEur } = valuation;
  const year = today.getFullYear();

  if (missing.length > 0) {
    add({
      id: 'dati.missing', category: 'dati', severity: 'attenzione',
      title: `${missing.length} posizioni senza prezzo aggiornato`,
      detail: `Non sono incluse nei totali: ${missing.join(', ')}.`,
      because: ['Prezzo o cambio non disponibile nei dati pubblicati.'],
    });
  }

  // ---- expiring losses: relevant at year end, independent from prices
  for (const loss of expiringLosses(portfolio.lossCarryforward, year)) {
    const days = daysUntilYearEnd(today, year);
    add({
      id: `fisco.loss_expiring.${loss.year}`, category: 'fisco', severity: days <= 90 ? 'importante' : 'attenzione',
      title: `${eur(loss.amount)} di minusvalenze del ${loss.year} scadono il 31/12/${year}`,
      detail: `Mancano ${days} giorni. Possono compensare solo plusvalenze realizzate che siano redditi diversi (azioni, obbligazioni, ETC/ETN): non i guadagni su ETF. Se prevedi di realizzare plusvalenze di quel tipo, vale la pena parlarne con il tuo commercialista prima di fine anno.`,
      because: [`Riporto massimo: ${CARRY_YEARS} periodi d’imposta successivi a quello di realizzo.`, 'Regola: fisco.minusvalenze (verifica: secondaria).'],
    });
  }

  if (rows.length === 0) return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // ---- concentration
  for (const r of rows) {
    if (SINGLE_NAME.has(r.taxClass)) {
      if (r.weight >= THRESHOLDS.singleNameAttention) {
        add({
          id: `rischio.concentrazione.${r.id}`, category: 'rischio',
          severity: r.weight >= THRESHOLDS.singleNameImportant ? 'importante' : 'attenzione',
          title: `${r.name} pesa il ${pct(r.weight, 0)} del portafoglio`,
          detail: 'Un singolo titolo concentra il rischio specifico di un emittente: il suo andamento pesa molto sul risultato complessivo.',
          because: [`Peso ${pct(r.weight, 1)} contro soglia di attenzione ${pct(THRESHOLDS.singleNameAttention, 0)}.`],
        });
      }
    } else if (r.weight >= THRESHOLDS.fundAttention && rows.length > 1) {
      add({
        id: `rischio.concentrazione.${r.id}`, category: 'rischio', severity: 'info',
        title: `${r.name} pesa il ${pct(r.weight, 0)} del portafoglio`,
        detail: 'Un solo fondo domina il portafoglio. Se è molto diversificato il rischio specifico è basso, ma dipendi da un solo prodotto e da un solo emittente.',
        because: [`Peso ${pct(r.weight, 1)} contro soglia ${pct(THRESHOLDS.fundAttention, 0)}.`],
      });
    }
  }
  const hhi = rows.reduce((s, r) => s + r.weight ** 2, 0);
  if (rows.length >= 2 && 1 / hhi < 3) {
    add({
      id: 'rischio.posizioni_effettive', category: 'rischio', severity: 'info',
      title: `Equivalgono a circa ${(1 / hhi).toFixed(1).replace('.', ',')} posizioni di pari peso`,
      detail: 'Pesi molto sbilanciati riducono la diversificazione reale rispetto al numero di strumenti posseduti.',
      because: [`Indice di concentrazione (HHI) ${hhi.toFixed(2).replace('.', ',')}.`],
    });
  }

  // ---- target weights
  for (const [cls, target] of Object.entries(portfolio.targets ?? {})) {
    const actual = valuation.byAssetClass[cls] ?? 0;
    const drift = actual - target;
    if (Math.abs(drift) >= THRESHOLDS.driftAttention) {
      add({
        id: `rischio.scostamento.${cls}`, category: 'rischio',
        severity: Math.abs(drift) >= THRESHOLDS.driftImportant ? 'importante' : 'attenzione',
        title: `${cls.replace('_', ' ')}: ${pct(actual, 0)} contro un obiettivo del ${pct(target, 0)}`,
        detail: `Scostamento di ${drift >= 0 ? '+' : '−'}${Math.abs(drift * 100).toFixed(1).replace('.', ',')} punti percentuali. Il riequilibrio ha un costo fiscale se si vende in plusvalenza: confrontalo con la possibilità di indirizzare i nuovi versamenti.`,
        because: ['Pesi obiettivo impostati da te in questa pagina.'],
      });
    }
  }

  // ---- costs
  const fundRows = rows.filter((r) => r.ter > 0);
  if (fundRows.length > 0) {
    const weightedTer = rows.reduce((s, r) => s + r.weight * r.ter, 0);
    add({
      id: 'costi.ter', category: 'costi', severity: weightedTer > THRESHOLDS.terHighPct ? 'attenzione' : 'info',
      title: `Costo annuo medio dei fondi (TER ponderato): ${weightedTer.toFixed(2).replace('.', ',')}%`,
      detail: `Circa ${eur((weightedTer / 100) * totalValueEur)} l’anno sul valore attuale, oltre a spread, commissioni del broker e imposte.`,
      because: ['Media dei TER pesata sul valore delle posizioni.'],
    });
  }
  const wealth = rows.reduce((s, r) => (r.taxClass === 'cripto' ? s : s + annualWealthTax({ value: r.valueEur, custody: r.custody }).amount), 0);
  add({
    id: 'costi.bollo', category: 'costi', severity: 'info',
    title: `Bollo e IVAFE stimati: ${eur(wealth)} l’anno`,
    detail: '0,2% annuo sul valore dei prodotti finanziari (escluse le cripto in questa stima), per l’anno intero.',
    because: ['Regola: fisco.bollo (verifica: secondaria).'],
  });

  // ---- declarations
  const foreign = rows.filter((r) => r.custody === 'estero');
  if (foreign.length > 0) {
    const value = foreign.reduce((s, r) => s + r.valueEur, 0);
    add({
      id: 'dichiarazione.rw', category: 'dichiarazione', severity: 'attenzione',
      title: `${foreign.length} posizioni presso un broker estero: Quadro RW e IVAFE`,
      detail: `Valore ${eur(value)}. Vanno indicate nel Quadro RW anche senza operazioni nell’anno; le sanzioni segnalate per l’omissione vanno dal 3% al 15% dell’importo non dichiarato.`,
      because: ['Regola: dichiarazione.rw_ivafe (verifica: secondaria).', `Strumenti: ${foreign.map((r) => r.id).join(', ')}.`],
    });
  }

  // ---- ETF gains vs losses
  const etfGains = rows.some((r) => r.taxClass === 'etf_ucits' && r.pnlEur > 0);
  const offsettableGains = rows.some((r) => ['azione', 'etc_etn', 'obbl_corporate'].includes(r.taxClass) && r.pnlEur > 0);
  if (portfolio.lossCarryforward.length > 0 && etfGains && !offsettableGains) {
    add({
      id: 'fisco.minusvalenze_etf', category: 'fisco', severity: 'info',
      title: 'Le tue minusvalenze non compensano le plusvalenze latenti sugli ETF',
      detail: 'Il guadagno su ETF armonizzati è reddito di capitale e non si compensa con le minusvalenze. Le tue plusvalenze latenti sono solo su ETF.',
      because: ['Regola: fisco.etf_redditi_capitale (verifica: secondaria).'],
    });
  }

  // ---- currency
  const foreignWeight = Object.entries(valuation.byCurrency).filter(([c]) => c !== 'EUR').reduce((s, [, w]) => s + w, 0);
  if (foreignWeight >= THRESHOLDS.foreignCurrency) {
    add({
      id: 'rischio.valuta', category: 'rischio', severity: 'info',
      title: `${pct(foreignWeight, 0)} del portafoglio è in valute diverse dall’euro`,
      detail: 'Le variazioni del cambio si sommano al rendimento dello strumento.',
      because: [`Valute: ${Object.keys(valuation.byCurrency).join(', ')}.`],
    });
  }

  // ---- drawdown and scenarios (from public signals)
  for (const r of rows) {
    const dd = signals.instruments[r.id]?.signals?.max_drawdown_1y;
    if (Number.isFinite(dd) && dd <= THRESHOLDS.deepDrawdown) {
      add({
        id: `rischio.drawdown.${r.id}`, category: 'rischio', severity: 'info',
        title: `${r.name}: calo massimo di ${pct(dd, 0)} nell’ultimo anno`,
        detail: 'Un calo di questa ampiezza è già avvenuto di recente: chiediti se reggeresti emotivamente e finanziariamente una discesa simile.',
        because: ['Massimo drawdown a 252 giorni dalla serie dei prezzi.'],
      });
    }
  }

  const withScenario = rows.filter((r) => signals.instruments[r.id]?.scenario);
  if (withScenario.length > 0) {
    const at = (r, key) => {
      const q = signals.instruments[r.id].scenario.quantiles[key];
      return q[q.length - 1];
    };
    const wsum = withScenario.reduce((s, r) => s + r.weight, 0);
    const mix = (key) => withScenario.reduce((s, r) => s + (r.weight / wsum) * at(r, key), 0) - 1;
    const losses = withScenario.map((r) => signals.instruments[r.id].scenario.prob_loss);
    const calibrated = withScenario.filter((r) => signals.instruments[r.id].calibration);
    const [lo, hi] = THRESHOLDS.calibrationOk;
    const reliable = calibrated.filter((r) => {
      const o = signals.instruments[r.id].calibration.observed;
      return o >= lo && o <= hi;
    }).length;
    add({
      id: 'scenario.portafoglio', category: 'scenario', severity: 'info',
      title: `Scenario a 12 mesi, fascia prudenziale: da ${spct(mix('p10'))} a ${spct(mix('p90'))} (mediana ${spct(mix('p50'))})`,
      detail: `Somma pesata delle fasce dei singoli strumenti: ignora la diversificazione tra strumenti, quindi la fascia reale del portafoglio è più stretta. Probabilità di perdita a 12 mesi dei singoli strumenti tra ${pct(Math.min(...losses), 0)} e ${pct(Math.max(...losses), 0)}.`,
      because: [
        'Metodo: bootstrap a blocchi sugli ultimi 504 giorni di ciascuno strumento (ADR-0003).',
        calibrated.length > 0
          ? `Affidabilità storica: la fascia 10°–90° è stata in linea con l’80% atteso per ${reliable} strumenti su ${calibrated.length}.`
          : 'Affidabilità storica non misurabile: storico troppo corto.',
        'Sono scenari, non previsioni: un regime di mercato diverso dal recente può cadere fuori dalla fascia.',
      ],
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
