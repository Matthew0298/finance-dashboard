# finance-dashboard · istruzioni per gli agenti

Dashboard personale sulle finanze: mercati e scenari, portafoglio locale, sezione fisco e burocrazia per investire in Italia. Hosting gratuito su GitHub Pages + Actions.

Leggi prima: `docs/02-architettura.md`, le ADR in `docs/adr/`, `docs/04-agenti.md`.

## Regole non negoziabili

1. **Nessun dato personale nel repo** (repo pubblico). Il portafoglio vive solo nel browser. Per esempi e test usa dati sintetici. `tools/privacy_guard.py` lo verifica.
2. **Nessuna risorsa di terze parti nel sito** (CSP `default-src 'self'`): niente CDN, font esterni, analytics.
3. **Nessuna regola fiscale senza fonte, livello di verifica e data** (`data/compliance/rules.json`).
4. **Le previsioni sono scenari con calibrazione**, non ordini. Nessun messaggio "compra/vendi" su singoli titoli (ADR-0003).
5. **Nessun dato pubblicato senza audit**. Un audit `fail` blocca la pubblicazione.
6. Il progetto non è consulenza finanziaria né fiscale: lo ricorda il disclaimer fisso nel sito.

## Convenzioni

- Documentazione e testi per l'utente: **italiano**. Codice, identificatori, messaggi di commit: **inglese**.
- Dipendenze: pipeline solo `numpy` + libreria standard; web senza dipendenze. Una dipendenza nuova richiede un'ADR.
- Ruoli: `architect` decide, `developer` implementa, `data-auditor` controlla, `release-manager` rilascia (vedi `.claude/agents/`).

## Comandi (dalla radice del repo)

```bash
# Test della pipeline
PYTHONPATH=pipeline python -m unittest discover -s pipeline/tests -t pipeline -v

# Test del front-end
node --test "web/js/*.test.mjs"

# Pipeline completa su dati sintetici (offline) e costruzione del sito in build/site
PYTHONPATH=pipeline python -m fd_pipeline run --provider synthetic --store build/store --out build/site
python tools/build_site.py

# Pipeline con dati reali (Yahoo + BCE)
PYTHONPATH=pipeline python -m fd_pipeline run --provider yahoo --store store --out build/site

# Anteprima locale: http://localhost:8080
python -m http.server 8080 -d build/site

# Guardia privacy
python tools/privacy_guard.py
```

Su PowerShell: `$env:PYTHONPATH = "pipeline"` prima dei comandi Python.
