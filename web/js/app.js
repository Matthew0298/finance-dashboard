// Wiring: state, events, persistence. The portfolio is read and written only in this browser.

import { loadData } from './data.js';
import { exportJson, importJson, loadPortfolio, savePortfolio, clearPortfolio, valuePortfolio, demoPortfolio, emptyPortfolio } from './portfolio.js';
import { buildInsights } from './insights.js';
import { sellTax, annualWealthTax } from './tax.js';
import { TABS, renderBanner, renderStatusPill, renderTab, renderChecklist, renderTaxResult, renderWealthResult } from './views.js';

const state = {
  data: null,
  error: null,
  portfolio: emptyPortfolio(),
  derived: { valuation: null, insights: [] },
  tab: 'panoramica',
  selectedInstrument: null,
  checklist: 'etf_ucits',
  rulesArea: 'tutte',
  notice: null,
};

const $ = (id) => document.getElementById(id);

function derive() {
  if (!state.data) return;
  const valuation = valuePortfolio({ portfolio: state.portfolio, universe: state.data.universe, signals: state.data.signals, fx: state.data.fx });
  const insights = buildInsights({ portfolio: state.portfolio, valuation, signals: state.data.signals, today: new Date() });
  state.derived = { valuation, insights };
}

function render() {
  derive();
  $('banner').innerHTML = renderBanner(state);
  $('status').innerHTML = renderStatusPill(state);
  $('nav').innerHTML = TABS.map(([id, label]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}</button>`).join('');
  $('view').innerHTML = renderTab(state);
}

function persist() {
  if (!savePortfolio(state.portfolio)) {
    state.notice = { kind: 'warn', text: 'Impossibile salvare nel browser (navigazione privata o archiviazione disattivata): i dati restano solo finché la pagina è aperta. Esporta un backup.' };
  }
}

const known = () => state.data.universe.map((i) => i.id);

function setPortfolio(portfolio, notice = null) {
  state.portfolio = portfolio;
  state.notice = notice;
  persist();
  render();
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ events

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-tab],[data-action]');
  if (!el || !state.data) return;
  if (el.dataset.tab) {
    state.tab = el.dataset.tab;
    state.notice = null;
    render();
    return;
  }
  const { action, id, index } = el.dataset;
  if (action === 'select-instrument') {
    state.selectedInstrument = id;
    render();
    $('detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (action === 'goto-checklist') {
    state.checklist = id;
    state.tab = 'fisco';
    render();
  } else if (action === 'demo') {
    setPortfolio(demoPortfolio(state.data.signals, state.data.fx, new Date().getFullYear()), { kind: 'ok', text: 'Caricato un portafoglio di esempio con dati fittizi. Modificalo o cancellalo quando vuoi.' });
  } else if (action === 'import') {
    $('file-import')?.click();
  } else if (action === 'export') {
    download('portafoglio.portfolio.json', exportJson(state.portfolio));
  } else if (action === 'clear') {
    if (window.confirm('Cancellare posizioni, minusvalenze e obiettivi da questo browser? L’operazione non si può annullare.')) {
      clearPortfolio();
      setPortfolio(emptyPortfolio(), { kind: 'ok', text: 'Portafoglio cancellato da questo browser.' });
    }
  } else if (action === 'remove-position') {
    setPortfolio({ ...state.portfolio, positions: state.portfolio.positions.filter((p) => p.id !== id) });
  } else if (action === 'remove-loss') {
    setPortfolio({ ...state.portfolio, lossCarryforward: state.portfolio.lossCarryforward.filter((_, i) => i !== Number(index)) });
  }
});

document.addEventListener('change', async (event) => {
  const el = event.target;
  if (el.id === 'select-checklist') {
    state.checklist = el.value;
    $('checklist').innerHTML = renderChecklist(state);
  } else if (el.id === 'select-rules-area') {
    state.rulesArea = el.value;
    render();
  } else if (el.id === 'file-import' && el.files?.length) {
    const result = importJson(await el.files[0].text(), known());
    if (result.ok) setPortfolio(result.value, { kind: 'ok', text: 'Portafoglio importato.' });
    else {
      state.notice = { kind: 'warn', text: 'Importazione non riuscita: il portafoglio attuale non è stato modificato.', items: result.errors };
      render();
    }
  }
});

const field = (form, name) => new FormData(form).get(name);

document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (!state.data) return;

  if (form.id === 'form-position') {
    const id = field(form, 'id');
    const quantity = Number(field(form, 'quantity'));
    const avgCost = Number(field(form, 'avgCost'));
    if (!(quantity > 0) || !(avgCost >= 0)) return;
    const rest = state.portfolio.positions.filter((p) => p.id !== id);
    setPortfolio({ ...state.portfolio, positions: [...rest, { id, quantity, avgCost, custody: field(form, 'custody') }] });
  } else if (form.id === 'form-loss') {
    const year = Number(field(form, 'year'));
    const amount = Number(field(form, 'amount'));
    if (!Number.isInteger(year) || !(amount > 0)) return;
    const next = [...state.portfolio.lossCarryforward, { year, amount }].sort((a, b) => a.year - b.year);
    setPortfolio({ ...state.portfolio, lossCarryforward: next });
  } else if (form.id === 'form-targets') {
    const targets = {};
    let total = 0;
    for (const [key, value] of new FormData(form)) {
      if (value === '') continue;
      const weight = Number(value) / 100;
      if (weight > 0) { targets[key.slice(2)] = weight; total += weight; }
    }
    if (total > 1.0001) {
      state.notice = { kind: 'warn', text: 'I pesi obiettivo sommano più del 100%: non salvati.' };
      render();
    } else setPortfolio({ ...state.portfolio, targets });
  } else if (form.id === 'form-tax') {
    try {
      const result = sellTax({
        taxClass: field(form, 'taxClass'),
        proceeds: Number(field(form, 'proceeds')),
        cost: Number(field(form, 'cost')),
        fees: Number(field(form, 'fees') || 0),
        year: Number(field(form, 'year')),
        carryforward: field(form, 'useLosses') ? state.portfolio.lossCarryforward : [],
        euroToken: Boolean(field(form, 'euroToken')),
      });
      $('tax-result').innerHTML = renderTaxResult(result);
    } catch (error) {
      $('tax-result').textContent = error.message;
    }
  } else if (form.id === 'form-wealth') {
    try {
      $('wealth-result').innerHTML = renderWealthResult(annualWealthTax({ value: Number(field(form, 'value')), custody: field(form, 'custody') }));
    } catch (error) {
      $('wealth-result').textContent = error.message;
    }
  }
});

// -------------------------------------------------------------------- boot

async function boot() {
  state.portfolio = loadPortfolio();
  try {
    state.data = await loadData();
    state.selectedInstrument = state.data.universe[0]?.id ?? null;
    const hash = location.hash.slice(1);
    if (TABS.some(([id]) => id === hash)) state.tab = hash;
  } catch (error) {
    state.error = error.message;
  }
  render();
}

boot();
