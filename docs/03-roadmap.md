# 03 · Roadmap

## M0 · Fondazioni (questo rilascio)

- Ricerca, architettura, ADR, agenti.
- Pipeline: ingest (Yahoo, BCE, sintetico), auditor a due stadi, segnali e coni di scenario con calibrazione.
- Dashboard: panoramica del portafoglio locale con osservazioni, mercati e scenari, fisco e burocrazia (checklist per tipo di strumento, calcolatori), stato dei dati.
- CI e pipeline giornaliera su GitHub Actions, privacy guard.

## M1 · Portafoglio e scenari

- Scenari a livello di **portafoglio** nel browser (matrice di correlazione pubblicata dalla pipeline, simulazione con Cholesky) e probabilità di raggiungere un obiettivo.
- Inflazione ISTAT e rendimento **reale**; gestione della rottura di serie FOI 2026.
- Seconda fonte di prezzi (Stooq) e **riconciliazione incrociata** nell'auditor.
- Export cifrato del portafoglio (Web Crypto) per backup e sincronizzazione manuale.

## M2 · Obbligazioni e adempimenti

- Titoli di Stato e obbligazioni: rendimento a scadenza, duration, calendario cedole, curva BCE.
- Minusvalenze avanzate: titoli pubblici con ragguaglio 48,08% e cripto.
- Prospetto per la dichiarazione (RT/RM/RW) da stampare con i dati locali.
- Scadenzario fiscale con promemoria nel browser.

## M3 · Esercizio e qualità

- Agente `compliance-curator` mensile con pull request automatica sulle regole fiscali.
- Verifica dopo qualche settimana di `schedule`, banda e build di Pages; piano B (altro hosting) se serve.
- PWA con funzionamento offline.
- Confronto con baseline: ogni nuovo modello deve battere il bootstrap su calibrazione e perdita pinball (ADR-0003).

## Backlog di decisioni aperte

1. Perimetro "consulenza" se il progetto venisse condiviso con altri (serve parere professionale).
2. Cosa fare se Yahoo cambia l'endpoint (fonte alternativa prioritaria).
3. Repo privato con Pages a pagamento vs repo pubblico con dati solo locali.
