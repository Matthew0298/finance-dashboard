# 01 · Ricerca preliminare

> Ricerca del **21 novembre 2026**. Ogni affermazione ha un livello di verifica:
>
> - **P** = verificata su pagina ufficiale (GitHub, Agenzia delle Entrate, BCE)
> - **S** = concordano più fonti secondarie (siti di settore, studi professionali), nessuna ufficiale letta
> - **D** = da verificare prima di usarla (conoscenza generale, fonte singola o fonti discordi)
>
> Questo documento è materiale di lavoro del progetto, **non consulenza fiscale o finanziaria**. Le regole fiscali cambiano ogni anno: vedi `data/compliance/rules.json`, dove ogni regola porta data di verifica e fonte, e viene controllata dall'agente `data-auditor`.

## 1. Che cosa permette GitHub gratuito

| Tema | Esito | Verifica |
|---|---|---|
| GitHub Pages su piano Free personale | Disponibile **solo per repository pubblici**. Pages "privato" richiede un'organizzazione con GitHub Enterprise Cloud | P |
| GitHub Actions su repo pubblici | Runner standard ospitati da GitHub: **gratuiti** | P |
| GitHub Actions su repo privati (Free) | 12 USD/mese di calcolo incluso (non più "2.000 minuti"). A 0,006 USD/min Linux sono circa 2.000 min: è un mio calcolo, la pagina non lo dichiara | P (cifra), calcolo mio |
| Spazio | Artifact 500 MB (condivisi con Packages), cache 10 GB per repo | P |
| Prezzi 2026 | Dal 1/1/2026 prezzi dei runner ridotti fino al 39%. L'addebito per i runner self-hosted è stato annunciato e poi **rinviato** senza nuova data | P |
| Limiti di Pages (sito ≤ 1 GB, banda ≈ 100 GB/mese "soft", ≈ 10 build/ora) | Non confermati dalle pagine lette | D |
| Workflow `schedule` | Esecuzione "best effort" con ritardi possibili. Nei repo pubblici vengono disattivati dopo 60 giorni senza attività nel repo | D |

**Conseguenze per il progetto**

1. Per avere Pages gratis il repo deve essere **pubblico**. Quindi nel repo non può mai finire nulla di personale (vedi ADR-0001).
2. Con repo pubblico Actions non costa nulla: la pipeline dati può girare ogni giorno lavorativo senza spese.
3. Il rischio dei 60 giorni di inattività è coperto dal commit giornaliero sul branch `data`. Da verificare dopo qualche settimana di esercizio (vedi roadmap).

## 2. Fonti dati di mercato gratuite

| Fonte | Cosa offre | Limiti e rischi | Verifica |
|---|---|---|---|
| **BCE Data Portal** (SDMX REST, `data-api.ecb.europa.eu`) | Cambi di riferimento, tassi, serie macro. CSV via `format=csvdata` | Nessuna chiave richiesta nelle docs; chiamata di prova riuscita il 21/11/2026 (HTTP 200). Le curve dei rendimenti stanno in un dataflow separato da individuare | P |
| **Yahoo Finance** (endpoint `chart`, non ufficiale) | Storico giornaliero di ETF, azioni, cripto. Ticker Borsa Italiana con suffisso `.MI` | Nessun API ufficiale, nessun SLA. Termini: uso **personale**. Chiamata di prova riuscita il 21/11/2026 | S |
| **Stooq** (download CSV) | Storico giornaliero, copertura ampia | Termini su stooq.com/terms.html non letti; quota giornaliera bassa segnalata da utenti | D |
| **ISTAT** (indici FOI/NIC/IPCA) | Inflazione per calcolare il rendimento reale | Dal gennaio 2026 base FOI = 2025 e serie ricostruite con ECOICOP v2: **rottura di serie** da gestire. Endpoint SDMX da individuare | S |
| API commerciali con piano gratuito | Marketstack ≈ 100 richieste/mese, EODHD ≈ 20 chiamate/giorno e 1 anno di storico, Finnhub ≈ 50 chiamate/minuto, FMP ≈ 800 richieste/giorno | Cifre da blog e test non ufficiali; un test 2026 segnala dati vecchi serviti senza avviso | D |

**Decisione** (ADR-0004): fonte primaria Yahoo per i prezzi e BCE per i cambi, dietro un'interfaccia `PriceProvider` sostituibile. Poiché nessuna fonte gratuita ha garanzie, l'agente auditor controlla freschezza, buchi, outlier e prezzi "congelati" prima di ogni pubblicazione. In roadmap: seconda fonte (Stooq) per la riconciliazione incrociata.

## 3. Fisco e burocrazia italiana prima di investire

Sintesi di ciò che il progetto codifica nella sezione "Fisco e burocrazia". Il dettaglio con fonti è in `data/compliance/rules.json`.

| Regola | Sintesi | Verifica |
|---|---|---|
| Aliquota ordinaria | 26% su redditi di capitale (dividendi, cedole, proventi di fondi/ETF) e su redditi diversi (plusvalenze) | S |
| Aliquota agevolata | 12,5% su titoli di Stato italiani, Paesi in white list, enti sovranazionali | S |
| ETF/OICR armonizzati (UCITS) | Proventi **e** plusvalenze sono *redditi di capitale*: tassati per intero, **le minusvalenze non compensano le plusvalenze di ETF**. Azioni, obbligazioni, certificati sono *redditi diversi* e compensabili | S |
| Quota di titoli pubblici negli ETF | Tassata al 12,5% pro quota. **Fonti discordi** per gli ETF UCITS esteri (una indica il 26% pieno) | D |
| Minusvalenze | Riportabili nei 4 periodi d'imposta successivi, solo contro redditi diversi. Le perdite 2022 scadono con il 2026 | S |
| Imposta di bollo | 0,2% annuo sul valore dei prodotti finanziari, anche senza vendere | S |
| IVAFE e Quadro RW | Per attività finanziarie detenute **all'estero** (broker non italiano) IVAFE 0,2% e dichiarazione nel Quadro RW, anche senza operazioni. Sanzioni segnalate: 3%–15% dell'importo non dichiarato. Con intermediario italiano (regime amministrato) l'RW non serve se l'intermediario ha già applicato le imposte. Lette solo nel riassunto di una ricerca che citava le pagine dell'Agenzia delle Entrate (scheda IVAFE, istruzioni Redditi PF 2026): da riverificare direttamente sulle pagine | S |
| Cripto-attività | **33%** dal 1/1/2026 (prima 26%), **franchigia di 2.000 € eliminata**. Resta **26%** per i token di moneta elettronica in euro conformi a MiCAR. Riferimenti: L. 207/2024 e L. 199/2025. Diverse guide online sono ferme alle bozze | S |
| Riforma della tassazione degli ETF | Ipotizzata da alcune fonti (equiparazione ai redditi diversi), **non in vigore**. Un solo articolo cita il D.Lgs. 148/2026 (GU 11/8/2026) che tocca solo ritenute su dividendi a fondi pensione UE | D |
| ISEE | Titoli di Stato e buoni postali esclusi fino a 50.000 € per nucleo, l'eccedenza conta. ETF, azioni e obbligazioni private restano nel patrimonio mobiliare. Riferimento normativo discordante tra le fonti | S, D sul riferimento |
| Imposta sulle transazioni finanziarie (Tobin tax) | 0,1% su mercati regolamentati, 0,2% fuori, sulle azioni di società italiane con capitalizzazione > 500 mln € | D |
| Dividendi esteri | Ritenuta alla fonte estera (es. USA 15% con modulo W-8BEN, 30% senza), con credito d'imposta limitato | D |
| PIR | Esenzione su rendimenti dopo 5 anni di detenzione, con limiti annui e complessivi che cambiano per PIR ordinari e alternativi | D |
| Prodotti UCITS e KID | I clienti al dettaglio UE ricevono di norma ETF UCITS con KID. Gli ETF domiciliati negli USA sono in pratica non acquistabili | D |
| Tutele | Fondo Nazionale di Garanzia (indennizzo per insolvenza dell'intermediario), FITD per i depositi, ACF per le controversie | D |

**Cosa NON abbiamo ancora verificato su fonte ufficiale**: la maggior parte delle aliquote e delle norme sopra poggia su fonti secondarie concordi. Prima di decisioni di importo rilevante serve un controllo con Agenzia delle Entrate o un commercialista. Per questo la dashboard mostra per ogni regola il livello di verifica e la data.

## 4. Regolamentazione sulle "raccomandazioni predittive"

- La **consulenza in materia di investimenti** è un'attività riservata: è una raccomandazione *personalizzata* a un cliente, su richiesta o di iniziativa del prestatore (TUF art. 1 c. 5-septies; MiFID II art. 4). Le raccomandazioni generiche rivolte al pubblico non rientrano nella definizione, ma una raccomandazione "implicita" abbastanza specifica può essere considerata consulenza.
- Il progetto è **personale**: i calcoli avvengono sul dispositivo di chi lo usa, sui propri dati, per proprio uso.
- Se in futuro lo si aprisse ad altri utenti, la questione andrebbe riesaminata con un professionista prima di pubblicare qualunque funzione che dica "compra/vendi X".
- Ricerca incompleta: non ho trovato indicazioni Consob specifiche su strumenti educativi o simili, né sul trattamento dei disclaimer. È un punto aperto (vedi §6).

**Scelta di design** (ADR-0003): la dashboard produce *scenari probabilistici e osservazioni su rischio, costi e fisco*, con spiegazione del perché e affidabilità storica del modello. Non emette ordini "compra" o "vendi" su singoli titoli.

## 5. Come si fa "predittivo" in modo onesto

- La previsione puntuale dei prezzi ha evidenza empirica debole. Ha senso stimare **distribuzioni** (fasce di scenario) e **misurarne la calibrazione** con un test walk-forward: "la fascia 10°–90° percentile ha contenuto il valore realizzato nel X% dei casi storici contro l'80% nominale".
- Metodi scelti per il primo rilascio: bootstrap a blocchi dei rendimenti giornalieri (conserva autocorrelazione di volatilità e code spesse) per i coni di scenario; segnali descrittivi (momentum 12-1 mesi, trend sulla media a 200 giorni, volatilità, drawdown) mostrati come tali.
- Il portafoglio dell'utente entra solo nel browser: osservazioni su concentrazione, scostamento dai pesi obiettivo, costi (TER), minusvalenze in scadenza, obblighi dichiarativi.
- Limite noto: il bootstrap sul passato recente tende a essere troppo fiducioso nei cambi di regime. La calibrazione mostrata in dashboard serve proprio a renderlo visibile.

## 6. Punti aperti

1. Verificare su fonti ufficiali le regole marcate **D** e **S** (agente `data-auditor` + commercialista).
2. Limiti di Pages e comportamento dei workflow `schedule` dopo 60 giorni: osservare dopo qualche settimana.
3. Termini d'uso Stooq e dati Borsa Italiana per la seconda fonte.
4. Endpoint SDMX ISTAT e dataflow BCE per curve dei rendimenti.
5. Parere professionale sul perimetro "consulenza" se il progetto venisse condiviso.

## Fonti

- GitHub, [Piani GitHub](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) e [fatturazione Actions](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- GitHub, [modifiche ai prezzi di Actions 2026](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) e [changelog del 16/12/2025](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)
- Agenzia delle Entrate, [IVAFE: che cos'è](https://www.agenziaentrate.gov.it/portale/schede/pagamenti/imposta-valore-att-estero-ivafe/cosa-ivafe) e [istruzioni Redditi PF 2026](https://infoprecompilata.agenziaentrate.gov.it/portale/documents/d/guest/pf2_istruzioni_2026.pdf)
- Tassazione investimenti (secondarie): [Fiscoinvestimenti](https://fiscoinvestimenti.it/investimenti-fiscalita-2026-guida-completa/), [Gestione del Denaro](https://www.gestionedeldenaro.it/tassazione-degli-investimenti-2026/), [Doppio Minimo](https://www.doppiominimo.com/tassazione-investimenti-italia-2026/), [Moneyviz](https://blog.moneyviz.it/tassazione-etf-2026-plusvalenze-minusvalenze-730-modello-redditi/)
- Cripto (secondarie): [Agenda Digitale](https://www.agendadigitale.eu/cultura-digitale/tassazione-criptovalute-cosa-cambia-con-la-legge-di-bilancio-2026/), [Waltio](https://www.waltio.com/it/tassazione-criptovalute-2026-guida/), [Trend Economy](https://www.trendeconomy.it/fiscalita-delle-cripto-attivita-nel-2026-aliquota-al-33-regime-delle-stablecoin-in-euro-isee-e-comunicazioni-dac8/)
- ISEE (secondarie): [Informazione Fiscale](https://www.informazionefiscale.it/isee-2026-dsu-buoni-postali-libretti-titoli-di-stato-non-dichiarati), [Altroconsumo](https://www.altroconsumo.it/soldi/imposte-e-tasse/news/btp-fuori-da-isee)
- Consulenza in materia di investimenti: [Diritto Bancario](https://www.dirittobancario.it/art/il-servizio-di-consulenza-materia-di-investimenti/)
- BCE, [Data Portal API](https://data.ecb.europa.eu/help/api/overview)
- ISTAT, [prezzi al consumo NIC, FOI, IPCA](https://www.istat.it/tavole-di-dati/prezzi-al-consumo-dati/)
- Fonti dati: [yfinance (README)](https://raw.githubusercontent.com/ranaroussi/yfinance/main/README.md), [Stooq con pandas-datareader](https://pandas-datareader.readthedocs.io/en/latest/readers/stooq.html)
