# ADR-0002 · Hosting su GitHub Pages e pipeline su GitHub Actions

- **Stato**: accettata
- **Data**: 2026-11-21
- **Decisore**: architect

## Contesto

Obiettivo: costo zero e rilascio automatico. Dal piano Free abbiamo Pages (solo repo pubblici) e Actions gratuito sui repo pubblici.

## Decisione

1. Repository **pubblico**, sito pubblicato con `actions/deploy-pages`.
2. Due workflow:
   - `ci.yml`: su pull request e su `main` esegue privacy guard, test Python e JavaScript, e una prova end-to-end su dati sintetici con audit.
   - `pipeline.yml`: ogni giorno lavorativo dopo la chiusura di Borsa Italiana (17:30 UTC ≈ 18:30 in inverno), più avvio manuale e a ogni push che tocca codice o dati. Jobs: `ingest` → `audit-raw` → `forecast` → `audit-output` → `publish`, con `report-failure` in caso di errore.
3. Lo storico dei prezzi vive nel branch orfano **`data`** (CSV), non in `main`: la cronologia di `main` resta leggibile e lo storico cresce senza sporcarla.
4. Il sito pubblicato è un artifact costruito a ogni esecuzione (`web/` + dati generati). Un audit fallito **non** sostituisce il sito online.
5. Dependabot aggiorna le versioni delle azioni e delle dipendenze Python.

## Alternative scartate

- **Cron locale sul PC**: dipende da una macchina accesa.
- **Servizi esterni (Netlify, Vercel, Cloudflare)**: ottimi, ma aggiungono un account e un punto di fallimento; si potranno valutare se Pages diventa limitante.
- **Committare i dati generati in `main`**: rumore nella cronologia e conflitti con il lavoro di sviluppo.

## Conseguenze

- Il repo pubblico espone il codice e le scelte di progetto: nessun segreto nel repo.
- Da osservare dopo qualche settimana: affidabilità dello `schedule` (best effort), disattivazione dopo 60 giorni di inattività, limiti di banda e build di Pages.
- Per ripristinare una versione precedente basta rieseguire il deploy di un commit passato.
