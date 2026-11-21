# Finance Dashboard

Dashboard personale sulle finanze: mercati e scenari probabilistici, portafoglio che resta sul tuo dispositivo e una sezione **Fisco e burocrazia** con tutto ciò che serve sapere in Italia prima di investire in azioni, ETF, obbligazioni, titoli di Stato, fondi o cripto. Costo zero: GitHub Pages + GitHub Actions.

**Sito online: <https://matthew0298.github.io/finance-dashboard/>** (aggiornato ogni giorno lavorativo dalla pipeline)

> **Non è consulenza finanziaria né fiscale.** Mostra scenari e osservazioni generali; non emette ordini di acquisto o vendita (vedi [ADR-0003](docs/adr/0003-previsioni-probabilistiche-non-consulenza.md)). Le regole fiscali sono marcate con livello di verifica e data: vanno controllate su fonti ufficiali.

## Cosa fa

| Scheda | Contenuto |
|---|---|
| **Panoramica** | Portafoglio salvato solo nel tuo browser (import/export JSON). Valorizzazione, allocazione contro pesi obiettivo, minusvalenze in scadenza, obblighi dichiarativi, costi, scenario a 12 mesi: ogni osservazione ha severità, motivo e dati usati |
| **Mercati e scenari** | Per ogni strumento: rendimenti, volatilità, calo massimo, trend, cono di scenario a 12 mesi con probabilità di perdita e **affidabilità storica misurata** (test walk-forward) |
| **Fisco e burocrazia** | Checklist "prima di investire" per tipo di strumento, regole con fonte e livello di verifica, calcolatori (imposta su vendita con riporto minusvalenze, bollo/IVAFE) |
| **Stato dei dati** | Esito dei controlli dell'auditor, problemi aperti, origine dei dati |

## Architettura multi-agente

| Ruolo | Sviluppo (Claude Code, `.claude/agents/`) | Pipeline (GitHub Actions) |
|---|---|---|
| Decide | `architect`: alternative, decisione, ADR, compiti | |
| Sviluppa | `developer`: codice + test | `ingest`, `forecast` |
| Controlla i dati | `data-auditor`: verifica indipendente, ricalcolo a campione | `audit-raw`, `audit-output` (bloccano la pubblicazione) |
| Porta in produzione | `release-manager`: CI/CD, privacy guard, rollback | `publish`, `deploy` |

Dettagli: [docs/04-agenti.md](docs/04-agenti.md) · [docs/02-architettura.md](docs/02-architettura.md) · [ricerca](docs/01-ricerca.md) · [roadmap](docs/03-roadmap.md).

## Privacy

Il repo è **pubblico** perché GitHub Pages gratuito lo richiede. Per questo il portafoglio non entra mai nel repo: si salva nel browser, il sito non carica nulla da servizi esterni (CSP `default-src 'self'`) e `tools/privacy_guard.py` blocca in CI file e pattern che sembrano dati personali. Vedi [ADR-0001](docs/adr/0001-privacy-first-dati-personali-locali.md).

## Avvio in locale

Servono Python 3.11+ (con `numpy`) e Node 22+.

```bash
pip install -r pipeline/requirements.txt

# pipeline con dati sintetici (offline) e costruzione del sito
PYTHONPATH=pipeline python -m fd_pipeline run --provider synthetic --store build/store --out build/site
python tools/build_site.py

# anteprima su http://localhost:8080
python -m http.server 8080 -d build/site
```

Con dati reali (Yahoo Finance + BCE): `--provider yahoo --store store`. Su PowerShell imposta prima `$env:PYTHONPATH = "pipeline"`.

I dati sintetici sono solo per sviluppo: il sito mostra un banner rosso e la pipeline di produzione rifiuta di pubblicarli.

```bash
PYTHONPATH=pipeline python -m unittest discover -s pipeline/tests -t pipeline   # test pipeline
node --test "web/js/*.test.mjs"                                                 # test front-end
python tools/privacy_guard.py                                                   # guardia privacy
```

## Pubblicazione su GitHub Pages (piano gratuito)

1. Repository **pubblico** (Pages sul piano Free non è disponibile per i repo privati).
2. *Settings → Pages → Build and deployment → Source: GitHub Actions*.
3. *Actions → Data pipeline and deploy → Run workflow*. Poi gira da solo ogni giorno lavorativo dopo la chiusura di Borsa Italiana.
4. Lo storico dei prezzi viene salvato nel branch `data`. Se la pipeline fallisce si apre una Issue `data-audit-failed` e il sito resta all'ultima versione valida.

Il workflow `ci.yml` esegue test, privacy guard e una prova completa su dati sintetici a ogni pull request. Se le regole fiscali non vengono riverificate per un anno, la CI fallisce: è voluto.

## Stato

Rilascio M0 (fondazioni). Verificato in locale il 21/11/2026: 56 test Python, 33 test JavaScript, pipeline completa sia su dati sintetici sia su **dati reali** (10 strumenti da Yahoo Finance + cambi BCE, audit `pass`), sito provato nel browser. I workflow hanno girato con successo su GitHub (CI e pipeline completa, con deploy su Pages e dati reali). **Non ancora osservato**: il comportamento dello `schedule` nel tempo (esecuzione automatica giornaliera, eventuale sospensione dopo 60 giorni di inattività). Vedi la [roadmap](docs/03-roadmap.md).
