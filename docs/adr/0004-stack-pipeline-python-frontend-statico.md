# ADR-0004 · Stack: pipeline Python minimale e front-end statico senza dipendenze

- **Stato**: accettata
- **Data**: 2026-11-21
- **Decisore**: architect

## Contesto

Servono: scaricare dati, validarli, calcolare scenari (lato server) e mostrare un sito che gestisca il portafoglio in locale (lato browser). Sulla macchina di sviluppo ci sono Python 3.11, Node 22, numpy e pandas; `requests` e `pytest` non sono installati.

## Decisione

**Pipeline (`pipeline/fd_pipeline`)**
- Python 3.11+, unica dipendenza esterna **numpy**. Download con `urllib` della libreria standard.
- Provider dietro l'interfaccia `PriceProvider`: `yahoo` (endpoint chart, uso personale), `synthetic` (serie deterministiche per test e sviluppo offline). Cambi BCE con CSV SDMX.
- Test con `unittest` della libreria standard (nessun pytest).

**Front-end (`web/`)**
- Moduli ES nativi, nessun bundler, nessun framework, nessuna libreria di terze parti caricata a runtime. Grafici in SVG scritti a mano.
- Logica fiscale e osservazioni come funzioni pure, testate con `node --test`.
- CSP `default-src 'self'` (vedi ADR-0001).

**Dati**
- `data/universe.json` e `data/compliance/rules.json` sono versionati in `main` e rivisti via pull request.

## Alternative scartate

- **React/Vite/TypeScript**: più comodo per interfacce grandi, ma introduce catena di build e dipendenze npm da tenere aggiornate in un progetto personale. Si rivaluta quando la UI supera le 2.000 righe.
- **pandas**: comodo, ma pesante in CI; numpy basta per i calcoli necessari.
- **yfinance**: aggiunge dipendenza e comportamenti non documentati; l'endpoint JSON è sufficiente e più facile da validare.

## Conseguenze

- Pochi aggiornamenti di dipendenze da gestire; CI veloce.
- I grafici sono semplici: se servono interazioni ricche si potrà vendorizzare una libreria nel repo (mai da CDN).
- L'endpoint Yahoo è non ufficiale: l'auditor e la seconda fonte in roadmap sono la contromisura.
