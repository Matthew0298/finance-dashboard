# ADR-0003 · Previsioni come scenari probabilistici, non come consulenza

- **Stato**: accettata
- **Data**: 2026-11-21
- **Decisore**: architect

## Contesto

Si desiderano "raccomandazioni predittive". Due vincoli: (1) prevedere i prezzi è intrinsecamente incerto, (2) la consulenza in materia di investimenti è un'attività riservata se personalizzata e rivolta a un cliente (vedi `docs/01-ricerca.md` §4).

## Decisione

1. Le previsioni sono **fasce di scenario** (10°, 25°, 50°, 75°, 90° percentile) a 12 mesi per ogni strumento, con probabilità di perdita stimata.
2. Ogni previsione porta la sua **calibrazione**: copertura storica osservata della fascia 10°–90° con test walk-forward a 63 giorni, da confrontare con l'80% nominale. Se la copertura è fuori da 60%–95%, l'auditor emette un avviso e la dashboard etichetta il modello come "poco affidabile".
3. Il metodo del primo rilascio è un **bootstrap a blocchi** (21 giorni) dei rendimenti logaritmici giornalieri degli ultimi 504 giorni, con seme deterministico (id strumento + data), così i risultati sono riproducibili.
4. Le "raccomandazioni" sono **osservazioni** su rischio, concentrazione, costi, fisco e obblighi, ciascuna con *severità*, *motivo* e *dati usati*. Non ci sono messaggi del tipo "compra" o "vendi" su singoli titoli.
5. Il portafoglio dell'utente non lascia il browser (ADR-0001): le osservazioni personalizzate sono calcolate localmente.
6. Disclaimer fisso in ogni pagina: strumento personale e informativo, non consulenza finanziaria né fiscale.

## Alternative scartate

- **Previsioni puntuali con modelli di machine learning**: risultati poco difendibili e difficili da calibrare con la storia disponibile; potranno essere confrontati in futuro contro il bootstrap come *baseline*.
- **Segnali "compra/vendi"**: rischio di essere letti come consulenza e promessa di performance.

## Conseguenze

- I modelli futuri dovranno battere la baseline bootstrap in termini di calibrazione e perdita *pinball* prima di entrare in dashboard.
- Aprire il progetto ad altre persone richiede una verifica professionale sul perimetro della consulenza.
