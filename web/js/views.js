// HTML renderers. Pure functions from state to strings; every dynamic value goes through esc().

import { esc, eur, pct, spct, num, dateIt } from './format.js';
import { TAX_CLASSES } from './tax.js';
import { coneChart, sparkline, allocBar } from './charts.js';
import { THRESHOLDS } from './insights.js';

export const TABS = [
  ['panoramica', 'Panoramica'],
  ['mercati', 'Mercati e scenari'],
  ['fisco', 'Fisco e burocrazia'],
  ['dati', 'Stato dei dati'],
];

const ASSET_CLASSES = ['azionario', 'obbligazionario', 'materie_prime', 'crypto'];
const SEVERITY_LABEL = { importante: 'Importante', attenzione: 'Attenzione', info: 'Informazione' };
const VERIFICATION_LABEL = { primaria: 'Fonte ufficiale', secondaria: 'Fonti secondarie', da_verificare: 'Da verificare' };
const AREA_LABEL = { fisco: 'Fisco', dichiarazione: 'Dichiarazione', regolamentazione: 'Regolamentazione' };

const badge = (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`;

// ------------------------------------------------------------------ banner

export function renderBanner(state) {
  if (state.error) {
    return `<div class="banner error" role="alert"><strong>Dati non disponibili.</strong> ${esc(state.error)}.
      Esegui la pipeline (vedi README) oppure attendi la prossima pubblicazione.</div>`;
  }
  const { manifest, audit } = state.data;
  const parts = [];
  if (manifest.data_source === 'synthetic') {
    parts.push(`<div class="banner error" role="alert"><strong>Dati sintetici di prova.</strong> I prezzi sono generati al computer e non sono reali: non usarli per decidere.</div>`);
  }
  const ageDays = Math.floor((Date.now() - new Date(manifest.generated_at).getTime()) / 86400000);
  if (ageDays > 5) {
    parts.push(`<div class="banner warn" role="status"><strong>Dati vecchi di ${ageDays} giorni.</strong> L’ultima pubblicazione risale al ${esc(dateIt(manifest.generated_at))}.</div>`);
  }
  if (audit.status === 'fail') {
    parts.push(`<div class="banner error" role="alert"><strong>L’ultimo controllo dei dati è fallito.</strong> Vedi la scheda “Stato dei dati”.</div>`);
  } else if (audit.status === 'warn') {
    const n = Object.values(audit.stages).reduce((s, st) => s + st.counts.failed_warnings, 0);
    parts.push(`<div class="banner warn" role="status"><strong>Controllo dati con ${n} avvisi.</strong> I dati sono pubblicati ma alcuni controlli non sono pienamente superati: vedi “Stato dei dati”.</div>`);
  }
  return parts.join('');
}

export function renderStatusPill(state) {
  if (state.error) return badge('bad', 'Dati assenti');
  const { audit, manifest } = state.data;
  const label = { pass: 'Dati controllati', warn: 'Dati con avvisi', fail: 'Controllo fallito' }[audit.status];
  const kind = { pass: 'ok', warn: 'warn', fail: 'bad' }[audit.status];
  return `${badge(kind, label)} <span class="muted">aggiornati al ${esc(dateIt(state.data.signals.asof))}</span>`;
}

// -------------------------------------------------------------- panoramica

function renderNotice(notice) {
  if (!notice) return '';
  const items = notice.items?.length ? `<ul>${notice.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  return `<div class="banner ${notice.kind === 'ok' ? 'ok' : 'warn'}" role="status">${esc(notice.text)}${items}</div>`;
}

function renderSummary(v) {
  const pnlClass = v.pnlEur >= 0 ? 'pos' : 'neg';
  return `<div class="cards">
    <div class="card stat"><span class="label">Valore</span><span class="value">${eur(v.totalValueEur)}</span></div>
    <div class="card stat"><span class="label">Costo</span><span class="value">${eur(v.totalCostEur)}</span></div>
    <div class="card stat"><span class="label">Risultato non realizzato</span><span class="value ${pnlClass}">${eur(v.pnlEur)} <small>${v.totalCostEur > 0 ? spct(v.pnlEur / v.totalCostEur) : ''}</small></span></div>
    <div class="card stat"><span class="label">Posizioni</span><span class="value">${v.rows.length}</span></div>
  </div>`;
}

function renderAllocation(v, targets) {
  const classes = [...new Set([...Object.keys(v.byAssetClass), ...Object.keys(targets)])];
  if (classes.length === 0) return '';
  return `<section class="card"><h3>Allocazione per classe</h3>
    <p class="muted small">La barra mostra il peso attuale; il segno verticale è l’obiettivo che hai impostato.</p>
    ${classes.map((c) => {
      const share = v.byAssetClass[c] ?? 0;
      const target = targets[c] ?? null;
      return `<div class="alloc-row"><span>${esc(c.replace('_', ' '))}</span>${allocBar(share, target)}<span class="num">${pct(share, 0)}${target === null ? '' : ` <span class="muted">/ ${pct(target, 0)}</span>`}</span></div>`;
    }).join('')}
  </section>`;
}

function renderPositions(v) {
  if (v.rows.length === 0) return '';
  return `<section class="card"><h3>Posizioni</h3><div class="table-wrap"><table>
    <thead><tr><th>Strumento</th><th class="num">Quantità</th><th class="num">Valore</th><th class="num">Peso</th><th class="num">Risultato</th><th>Custodia</th><th><span class="sr-only">Azioni</span></th></tr></thead>
    <tbody>${v.rows.map((r) => `<tr>
      <td><strong>${esc(r.id)}</strong><br><span class="muted small">${esc(r.name)}</span></td>
      <td class="num">${num(r.quantity, 4)}</td>
      <td class="num">${eur(r.valueEur)}</td>
      <td class="num">${pct(r.weight, 1)}</td>
      <td class="num ${r.pnlEur >= 0 ? 'pos' : 'neg'}">${eur(r.pnlEur)}<br><span class="small">${spct(r.pnlPct)}</span></td>
      <td>${esc(r.custody)}</td>
      <td><button class="link" data-action="remove-position" data-id="${esc(r.id)}">Rimuovi</button></td>
    </tr>`).join('')}</tbody></table></div></section>`;
}

function renderInsights(insights) {
  if (insights.length === 0) return '';
  return `<section><h3>Osservazioni</h3>
    <p class="muted small">Osservazioni generali su rischio, costi, fisco e scenari, calcolate sul tuo dispositivo. Non sono consulenza né indicazioni di acquisto o vendita.</p>
    <div class="insights">${insights.map((i) => `<article class="insight ${esc(i.severity)}">
      <header>${badge(i.severity, SEVERITY_LABEL[i.severity])} <span class="muted small">${esc(i.category)}</span></header>
      <h4>${esc(i.title)}</h4>
      <p>${esc(i.detail)}</p>
      <details><summary>Perché lo dico</summary><ul>${i.because.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></details>
    </article>`).join('')}</div></section>`;
}

function renderEditors(state) {
  const { universe } = state.data;
  const p = state.portfolio;
  return `<section class="grid-2">
    <form id="form-position" class="card" autocomplete="off">
      <h3>Aggiungi o aggiorna una posizione</h3>
      <label>Strumento <select name="id" required>${universe.map((i) => `<option value="${esc(i.id)}">${esc(i.id)} · ${esc(i.name)}</option>`).join('')}</select></label>
      <label>Quantità <input name="quantity" type="number" step="any" min="0" required></label>
      <label>Prezzo medio di carico (nella valuta dello strumento) <input name="avgCost" type="number" step="any" min="0" required></label>
      <label>Dove sono custoditi <select name="custody"><option value="italia">Intermediario italiano</option><option value="estero">Broker estero</option></select></label>
      <button type="submit" class="primary">Salva posizione</button>
    </form>
    <div class="stack">
      <form id="form-loss" class="card" autocomplete="off">
        <h3>Minusvalenze da riportare</h3>
        <p class="muted small">Valgono fino al 31/12 del quarto anno successivo a quello di realizzo.</p>
        ${p.lossCarryforward.length ? `<ul class="plain">${p.lossCarryforward.map((e, i) => `<li>${e.year}: ${eur(e.amount)} <button type="button" class="link" data-action="remove-loss" data-index="${i}">Rimuovi</button></li>`).join('')}</ul>` : ''}
        <label>Anno di realizzo <input name="year" type="number" min="2000" max="2100" step="1" required></label>
        <label>Importo (euro) <input name="amount" type="number" step="any" min="0" required></label>
        <button type="submit">Aggiungi</button>
      </form>
      <form id="form-targets" class="card" autocomplete="off">
        <h3>Pesi obiettivo</h3>
        <p class="muted small">In percentuale. Lascia vuoto ciò che non vuoi monitorare.</p>
        <div class="targets">${ASSET_CLASSES.map((c) => `<label>${esc(c.replace('_', ' '))} <input name="t_${esc(c)}" type="number" min="0" max="100" step="1" value="${p.targets[c] === undefined ? '' : Math.round(p.targets[c] * 100)}"></label>`).join('')}</div>
        <button type="submit">Salva obiettivi</button>
      </form>
    </div>
  </section>`;
}

export function renderPanoramica(state) {
  const { valuation, insights } = state.derived;
  const empty = state.portfolio.positions.length === 0 && state.portfolio.lossCarryforward.length === 0;
  const welcome = empty
    ? `<section class="card welcome"><h2>Il tuo portafoglio resta sul tuo dispositivo</h2>
        <p>Posizioni, quantità e minusvalenze si salvano solo in questo browser e non vengono mai inviate né pubblicate. Il sito non carica nulla da servizi esterni.</p>
        <p>Puoi aggiungere le posizioni qui sotto, importare un file esportato in precedenza, oppure provare un portafoglio di esempio con dati fittizi.</p></section>`
    : '';
  return `${renderNotice(state.notice)}
    <div class="toolbar">
      <button data-action="demo">Carica portafoglio di esempio</button>
      <button data-action="import">Importa da file</button>
      <button data-action="export" ${empty ? 'disabled' : ''}>Esporta backup</button>
      <button data-action="clear" class="danger" ${empty ? 'disabled' : ''}>Cancella tutto</button>
      <input id="file-import" type="file" accept="application/json,.json" hidden>
    </div>
    ${welcome}
    ${valuation.rows.length ? renderSummary(valuation) : ''}
    ${renderInsights(insights)}
    <div class="grid-2">${valuation.rows.length ? renderAllocation(valuation, state.portfolio.targets) : ''}</div>
    ${renderPositions(valuation)}
    ${renderEditors(state)}
    <p class="muted small">Il costo in valuta estera è convertito al cambio attuale: è un’approssimazione. Ricorda di esportare un backup: cancellare i dati del browser cancella il portafoglio.</p>`;
}

// ----------------------------------------------------------------- mercati

function calibrationBadge(cal) {
  if (!cal) return badge('neutral', 'n.d.');
  const [lo, hi] = THRESHOLDS.calibrationOk;
  const ok = cal.observed >= lo && cal.observed <= hi;
  return badge(ok ? 'ok' : 'warn', `${pct(cal.observed, 0)} su ${cal.n_windows}`);
}

export function renderMercati(state) {
  const { universe, signals } = state.data;
  const selected = state.selectedInstrument;
  const rows = universe.map((inst) => {
    const s = signals.instruments[inst.id];
    if (!s || s.status !== 'ok') {
      return `<tr><td><strong>${esc(inst.id)}</strong><br><span class="muted small">${esc(inst.name)}</span></td><td colspan="8" class="muted">Storico insufficiente per gli scenari</td></tr>`;
    }
    const q = s.scenario.quantiles;
    const end = q.p10.length - 1;
    const sg = s.signals;
    return `<tr class="${selected === inst.id ? 'selected' : ''}">
      <td><button class="link strong" data-action="select-instrument" data-id="${esc(inst.id)}">${esc(inst.id)}</button><br><span class="muted small">${esc(inst.name)}</span></td>
      <td>${sparkline(s.spark)}</td>
      <td class="num">${num(s.last_price, 2)} <span class="muted small">${esc(s.currency)}</span></td>
      <td class="num ${sg.ret_12m >= 0 ? 'pos' : 'neg'}">${spct(sg.ret_12m)}</td>
      <td class="num">${pct(sg.vol_ann, 0)}</td>
      <td class="num">${spct(sg.max_drawdown_1y, 0)}</td>
      <td>${sg.above_sma200 === null ? '–' : sg.above_sma200 ? 'sopra' : 'sotto'}</td>
      <td class="num">${spct(q.p10[end] - 1, 0)} / ${spct(q.p90[end] - 1, 0)}<br><span class="muted small">perdita ${pct(s.scenario.prob_loss, 0)}</span></td>
      <td>${calibrationBadge(s.calibration)}</td>
    </tr>`;
  });

  let detail = '';
  const inst = universe.find((i) => i.id === selected);
  const s = inst && signals.instruments[inst.id];
  if (s?.status === 'ok') {
    const q = s.scenario.quantiles;
    const end = q.p10.length - 1;
    const sg = s.signals;
    detail = `<section class="card" id="detail"><h3>${esc(inst.name)} <span class="muted small">${esc(inst.ticker)}${inst.isin ? ` · ${esc(inst.isin)}` : ''}</span></h3>
      ${coneChart({ spark: s.spark, scenario: s.scenario, label: `${inst.name}: andamento degli ultimi due anni e fascia di scenario a 12 mesi dal ${spct(q.p10[end] - 1, 0)} al ${spct(q.p90[end] - 1, 0)}` })}
      <p class="legend"><span class="key history"></span>storico <span class="key median"></span>mediana <span class="key inner"></span>fascia 25°–75° <span class="key outer"></span>fascia 10°–90°</p>
      <div class="grid-2">
        <dl class="facts">
          <dt>Rendimento 1 / 3 / 6 / 12 mesi</dt><dd>${[sg.ret_1m, sg.ret_3m, sg.ret_6m, sg.ret_12m].map((v) => spct(v)).join(' · ')}</dd>
          <dt>Volatilità annua</dt><dd>${pct(sg.vol_ann, 1)}</dd>
          <dt>Calo massimo nell’ultimo anno</dt><dd>${spct(sg.max_drawdown_1y)}</dd>
          <dt>Momentum 12-1 mesi</dt><dd>${spct(sg.momentum_12_1)}</dd>
          <dt>Distanza dalla media a 200 giorni</dt><dd>${spct(sg.dist_sma200)}</dd>
          <dt>Costo annuo (TER)</dt><dd>${inst.ter ? `${num(inst.ter, 2)}%` : '–'}</dd>
          <dt>Trattamento fiscale</dt><dd>${esc(TAX_CLASSES[inst.tax_class]?.label ?? inst.tax_class)} <button class="link" data-action="goto-checklist" data-id="${esc(inst.tax_class)}">vedi checklist</button></dd>
        </dl>
        <div>
          <h4>Come leggere lo scenario</h4>
          <p>A 12 mesi il valore, se oggi è 100, ha il 50% di probabilità di finire sopra <strong>${num(q.p50[end] * 100, 0)}</strong>, l’80% di restare tra <strong>${num(q.p10[end] * 100, 0)}</strong> e <strong>${num(q.p90[end] * 100, 0)}</strong>, e una probabilità stimata di perdita del <strong>${pct(s.scenario.prob_loss, 0)}</strong>.</p>
          <p>${s.calibration ? `<strong>Affidabilità storica:</strong> in ${s.calibration.n_windows} verifiche passate a ${s.calibration.horizon_days} giorni la fascia 10°–90° ha contenuto il risultato reale ${pct(s.calibration.observed, 0)} delle volte, contro l’${pct(s.calibration.nominal, 0)} atteso. Le finestre si sovrappongono: il numero effettivo di prove indipendenti è molto più basso.` : 'Storico troppo corto per misurare l’affidabilità del modello.'}</p>
          <p class="muted small">Lo scenario ricampiona blocchi dei rendimenti degli ultimi due anni: porta con sé il rendimento medio recente e reagisce lentamente ai cambi di regime. È una descrizione di ciò che il passato recente rende plausibile, non una previsione.</p>
        </div>
      </div></section>`;
  }

  return `<section><h2>Mercati e scenari</h2>
    <p class="muted">Dati al ${esc(dateIt(signals.asof))}. Clicca su uno strumento per vedere il grafico di scenario.</p>
    <div class="card table-wrap"><table>
      <thead><tr><th>Strumento</th><th>Ultimi 2 anni</th><th class="num">Prezzo</th><th class="num">12 mesi</th><th class="num">Volatilità</th><th class="num">Calo max</th><th>Media 200 gg</th><th class="num">Scenario 12 mesi (10° / 90°)</th><th>Copertura storica</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
    ${detail}
    <details class="card"><summary>Metodo e limiti</summary>
      <p>Bootstrap a blocchi di ${signals.method.block_days} giorni sui rendimenti logaritmici degli ultimi ${signals.method.lookback_days} giorni, ${signals.method.paths} percorsi simulati. Prezzi rettificati per i dividendi (rendimento totale).</p>
      <p>La “copertura storica” è la quota di volte in cui la fascia 10°–90° costruita solo con i dati precedenti ha contenuto ciò che poi è successo, a ${signals.method.calibration_horizon_days} giorni. Il valore ideale è ${pct(signals.method.nominal_coverage, 0)}; fuori da 60%–95% il modello è etichettato come poco affidabile.</p>
    </details></section>`;
}

// ------------------------------------------------------------------- fisco

function ruleCard(rule) {
  const v = { primaria: 'ok', secondaria: 'neutral', da_verificare: 'warn' }[rule.verification];
  return `<details class="rule"><summary><span>${esc(rule.title)}</span> ${badge(v, VERIFICATION_LABEL[rule.verification])}</summary>
    <p>${esc(rule.summary)}</p>
    <p class="muted small">${esc(AREA_LABEL[rule.area] ?? rule.area)} · verificata il ${esc(dateIt(rule.last_verified))} · fonte: <a href="${esc(rule.source.url)}" target="_blank" rel="noopener noreferrer">${esc(rule.source.label)}</a></p>
  </details>`;
}

export function renderChecklist(state) {
  const { rules } = state.data;
  const byId = new Map(rules.rules.map((r) => [r.id, r]));
  const checklist = rules.checklists.find((c) => c.id === state.checklist) ?? rules.checklists[0];
  return `<ol class="steps">${checklist.steps.map((step) => `<li><p>${esc(step.text)}</p>${step.rules.map((id) => (byId.has(id) ? ruleCard(byId.get(id)) : '')).join('')}</li>`).join('')}</ol>`;
}

export function renderFisco(state) {
  const { rules } = state.data;
  const year = new Date().getFullYear();
  const areaRules = rules.rules.filter((r) => state.rulesArea === 'tutte' || r.area === state.rulesArea);
  const unverified = rules.rules.filter((r) => r.verification !== 'primaria').length;
  return `<section><h2>Fisco e burocrazia in Italia</h2>
    <div class="banner warn" role="note"><strong>Leggi prima di fidarti.</strong> ${unverified} regole su ${rules.rules.length} non sono state lette su fonte ufficiale (le fonti ufficiali sono linkate per verificare). Le regole cambiano ogni anno. Per importi rilevanti confronta con l’Agenzia delle Entrate o un commercialista.</div>

    <h3>Prima di investire: cosa devi sapere</h3>
    <label class="inline">Tipo di strumento <select id="select-checklist">${rules.checklists.map((c) => `<option value="${esc(c.id)}" ${c.id === state.checklist ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
    <div id="checklist">${renderChecklist(state)}</div>

    <h3>Calcolatori</h3>
    <div class="grid-2">
      <form id="form-tax" class="card" autocomplete="off">
        <h4>Imposta su una vendita</h4>
        <label>Tipo di strumento <select name="taxClass">${Object.entries(TAX_CLASSES).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('')}</select></label>
        <label>Incasso (euro) <input name="proceeds" type="number" step="any" min="0" required></label>
        <label>Costo di acquisto (euro) <input name="cost" type="number" step="any" min="0" required></label>
        <label>Commissioni e spese (euro) <input name="fees" type="number" step="any" min="0" value="0"></label>
        <label>Anno della vendita <input name="year" type="number" step="1" min="2000" max="2100" value="${year}" required></label>
        <label class="check"><input name="useLosses" type="checkbox" ${state.portfolio.lossCarryforward.length ? 'checked' : ''}> Usa le minusvalenze registrate nel mio portafoglio (${state.portfolio.lossCarryforward.length})</label>
        <label class="check"><input name="euroToken" type="checkbox"> Token di moneta elettronica in euro conforme a MiCAR (solo cripto)</label>
        <button type="submit" class="primary">Calcola</button>
        <div id="tax-result" class="result" aria-live="polite"></div>
      </form>
      <form id="form-wealth" class="card" autocomplete="off">
        <h4>Bollo o IVAFE annuale</h4>
        <label>Valore dei titoli al 31/12 (euro) <input name="value" type="number" step="any" min="0" required></label>
        <label>Custodia <select name="custody"><option value="italia">Intermediario italiano (bollo)</option><option value="estero">Broker estero (IVAFE + Quadro RW)</option></select></label>
        <button type="submit" class="primary">Calcola</button>
        <div id="wealth-result" class="result" aria-live="polite"></div>
      </form>
    </div>

    <h3>Tutte le regole</h3>
    <label class="inline">Area <select id="select-rules-area">${['tutte', ...Object.keys(AREA_LABEL)].map((a) => `<option value="${a}" ${a === state.rulesArea ? 'selected' : ''}>${a === 'tutte' ? 'Tutte' : AREA_LABEL[a]}</option>`).join('')}</select></label>
    <div class="card">${areaRules.map(ruleCard).join('')}</div>
    <p class="muted small">Livelli di verifica: <em>fonte ufficiale</em> = letta su una pagina ufficiale; <em>fonti secondarie</em> = concordano più siti di settore; <em>da verificare</em> = fonte singola, discordante o conoscenza generale non controllata.</p>
  </section>`;
}

export function renderTaxResult(r) {
  const offset = r.offsetUsed.length ? `<li>Minusvalenze usate: ${r.offsetUsed.map((o) => `${eur(o.used)} del ${o.year}`).join(', ')}</li>` : '';
  const left = r.carryforwardAfter.length ? `<li>Minusvalenze residue: ${r.carryforwardAfter.map((e) => `${eur(e.amount)} (${e.year}, utilizzabili fino al ${e.year + 4})`).join('; ')}</li>` : '';
  return `<dl class="facts">
      <dt>Plusvalenza / minusvalenza</dt><dd>${eur(r.gain)}</dd>
      <dt>Base imponibile</dt><dd>${eur(r.taxableBase)}</dd>
      <dt>Aliquota</dt><dd>${pct(r.rate, 1)}</dd>
      <dt>Imposta</dt><dd><strong>${eur(r.tax)}</strong></dd>
    </dl>
    <ul class="plain">${offset}${left}${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    ${r.warnings.map((w) => `<p class="banner warn">${esc(w)}</p>`).join('')}`;
}

export function renderWealthResult(r) {
  return `<dl class="facts"><dt>${esc(r.kind)} annuale</dt><dd><strong>${eur(r.amount)}</strong></dd><dt>Quadro RW</dt><dd>${r.needsRW ? 'Sì, da compilare' : 'Non necessario per questa custodia'}</dd></dl>
    <ul class="plain">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

// -------------------------------------------------------------------- dati

export function renderDati(state) {
  const { audit, manifest, signals } = state.data;
  const stageNames = { raw: 'Dati grezzi (prezzi, cambi, regole)', output: 'Risultati pubblicati (scenari, manifest, privacy)' };
  const kind = { pass: 'ok', warn: 'warn', fail: 'bad' };
  const problems = Object.entries(audit.stages).flatMap(([stage, st]) => st.checks.filter((c) => !c.ok && c.severity !== 'info').map((c) => ({ stage, ...c })));
  return `<section><h2>Stato dei dati</h2>
    <p>Ogni pubblicazione passa da un controllo automatico (l’“auditor”). Se trova errori, il sito non viene aggiornato e resta l’ultima versione valida.</p>
    <div class="cards">
      <div class="card stat"><span class="label">Esito complessivo</span><span class="value">${badge(kind[audit.status], audit.status.toUpperCase())}</span></div>
      <div class="card stat"><span class="label">Generato il</span><span class="value small">${esc(dateIt(manifest.generated_at))}</span></div>
      <div class="card stat"><span class="label">Fonte dei prezzi</span><span class="value small">${esc(manifest.data_source ?? 'n.d.')}</span></div>
      <div class="card stat"><span class="label">Dati di mercato al</span><span class="value small">${esc(dateIt(signals.asof))}</span></div>
    </div>
    <div class="card"><h3>Controlli per fase</h3><table>
      <thead><tr><th>Fase</th><th>Esito</th><th class="num">Controlli</th><th class="num">Errori</th><th class="num">Avvisi</th></tr></thead>
      <tbody>${Object.entries(audit.stages).map(([k, st]) => `<tr><td>${esc(stageNames[k] ?? k)}</td><td>${badge(kind[st.status], st.status.toUpperCase())}</td><td class="num">${st.counts.checks}</td><td class="num">${st.counts.failed_errors}</td><td class="num">${st.counts.failed_warnings}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h3>Problemi aperti</h3>${problems.length === 0 ? '<p>Nessun problema segnalato.</p>' : `<ul class="plain">${problems.map((p) => `<li>${badge(p.severity === 'error' ? 'bad' : 'warn', p.severity === 'error' ? 'Errore' : 'Avviso')} <code>${esc(p.id)}</code>${p.subject ? ` · ${esc(p.subject)}` : ''}: ${esc(p.detail)}</li>`).join('')}</ul>`}</div>
    <details class="card"><summary>Che cosa viene controllato</summary><ul>
      <li>Prezzi: date crescenti, valori positivi, freschezza, buchi, salti anomali, serie ferme.</li>
      <li>Strumenti: ISIN con checksum valido, identificativi univoci, classe fiscale nota.</li>
      <li>Cambi: presenti, positivi, aggiornati.</li>
      <li>Regole fiscali: campi completi, fonte https, data di verifica non scaduta (avviso a 180 giorni, errore a 365).</li>
      <li>Scenari: quantili ordinati e finiti, copertura storica nella fascia accettabile, manifest coerente con gli hash dei file.</li>
      <li>Privacy: nessun dato personale nei file pubblicati.</li></ul></details>
    <details class="card"><summary>Tutti i controlli (${Object.values(audit.stages).reduce((s, st) => s + st.counts.checks, 0)})</summary>
      <div class="table-wrap"><table><thead><tr><th>Fase</th><th>Controllo</th><th>Oggetto</th><th>Esito</th><th>Dettaglio</th></tr></thead><tbody>
      ${Object.entries(audit.stages).flatMap(([stage, st]) => st.checks.map((c) => `<tr><td>${esc(stage)}</td><td><code>${esc(c.id)}</code></td><td>${esc(c.subject ?? '')}</td><td>${c.ok ? badge('ok', 'ok') : badge(c.severity === 'error' ? 'bad' : 'warn', c.severity)}</td><td>${esc(c.detail)}</td></tr>`)).join('')}
      </tbody></table></div></details>
  </section>`;
}

export function renderTab(state) {
  if (state.error) return '';
  switch (state.tab) {
    case 'mercati': return renderMercati(state);
    case 'fisco': return renderFisco(state);
    case 'dati': return renderDati(state);
    default: return renderPanoramica(state);
  }
}
