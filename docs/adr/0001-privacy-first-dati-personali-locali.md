# ADR-0001 · Privacy first: i dati personali restano sul dispositivo

- **Stato**: accettata
- **Data**: 2026-11-21
- **Decisore**: architect

## Contesto

GitHub Pages gratuito richiede un repository **pubblico** (vedi `docs/01-ricerca.md` §1). Una dashboard sulle finanze personali contiene dati sensibili: posizioni, quantità, minusvalenze, patrimonio.

## Decisione

1. Il repository contiene solo codice, dati di mercato pubblici e contenuti normativi.
2. Il portafoglio dell'utente è salvato **solo** nel browser (`localStorage`) e può essere esportato/importato come file JSON locale.
3. Tutti i calcoli che usano il portafoglio (valorizzazione, osservazioni, imposte stimate) avvengono nel browser.
4. Il sito carica risorse **solo dal proprio dominio**, con Content-Security-Policy `default-src 'self'`. Nessun CDN, font esterno o analytics.
5. `tools/privacy_guard.py` gira in CI e fallisce se trova file o pattern che sembrano dati personali (file `*.portfolio.json`, cartella `private/`, IBAN, campi `quantity` nei dati pubblicati).
6. I report dell'auditor non contengono mai dati del portafoglio.

## Alternative scartate

- **Repo privato + Pages**: richiede un piano a pagamento. Resta un'opzione futura se si vorranno dati personali sul server.
- **Portafoglio cifrato nel repo pubblico**: rischio di fuga se la chiave è debole o il file viene copiato per sempre nella storia di git.
- **Backend con database**: costo e superficie di attacco superiori, contro il principio di costo zero.

## Conseguenze

- Il portafoglio non si sincronizza tra dispositivi: serve export/import manuale. In roadmap: export cifrato (Web Crypto) da salvare dove si vuole.
- Cancellare i dati del browser cancella il portafoglio: la dashboard ricorda di esportare un backup.
- Nessuna funzione "server-side" può usare il portafoglio (es. avvisi via email).
