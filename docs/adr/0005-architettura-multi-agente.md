# ADR-0005 · Architettura multi-agente

- **Stato**: accettata
- **Data**: 2026-11-21
- **Decisore**: architect

## Contesto

Si vogliono quattro ruoli distinti: chi controlla tutti i dati della dashboard, chi architetta e decide, chi sviluppa, chi porta in produzione. Tutto con strumenti gratuiti.

## Decisione

Due livelli di agenti, con gli stessi ruoli ma strumenti diversi:

1. **Agenti di sviluppo** (Claude Code): sub-agenti definiti in `.claude/agents/`. Sono `architect`, `developer`, `data-auditor`, `release-manager`. Passano il lavoro con un protocollo scritto (ADR → implementazione → report audit → rilascio) descritto in `docs/04-agenti.md`.
2. **Agenti di runtime** (GitHub Actions, gratuiti): `ingest`, `audit` (la stessa logica del `data-auditor`, eseguita da codice), `forecast`, `publish`. Sono deterministici e non usano modelli linguistici: **nessun costo e nessuna chiave API**.

Regola di separazione: chi scrive il codice non approva i propri dati. Il `data-auditor` non modifica mai il codice né i dati per far "passare" un controllo: segnala e basta.

## Alternative scartate

- **Agenti LLM dentro le Actions** (per esempio revisioni automatiche delle PR): richiedono una chiave API a pagamento. Si può aggiungere in seguito come estensione opzionale.
- **Un solo agente generalista**: perde la separazione dei compiti e rende più difficile verificare il lavoro.

## Conseguenze

- Tutti i controlli sui dati sono codice testato e ripetibile, non giudizio di un modello.
- Il giudizio di un modello (architect, data-auditor di sviluppo) serve per decisioni, revisioni e analisi dei casi nuovi, e lascia traccia in ADR e report.
