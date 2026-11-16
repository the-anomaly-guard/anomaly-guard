# T3 - Valutazione e incertezza

> **Bozza** del capitolo T3 della relazione finale (E-05). Autore: Nicholas Arcari.
>
> - **Origine dei numeri:** un'esecuzione di `npm run experiments` al commit `{{commit}}`, seed
>   {{seeds}}, albero di lavoro pulito<!-- claim: cleanTree -->, {{date}}. Nessun numero qui è
>   scritto a mano: `npm run report` riempie [il modello di questo capitolo](templates/t3-evaluation-and-uncertainty.it.md)
>   da [`numbers.json`](numbers.json), e un test fallisce quando il codice non dà più questi
>   risultati ([README](README.md), ADR-014).
> - **Il punteggio statistico è ancora il solo segnale sulla lunghezza**, in scala logaritmica da
>   C-04 (ADR-012).<!-- claim: lengthOnly --> Il chi-quadro (C-03) e i segnali di outlier (C-05)
>   sono implementati, ma entrano nel punteggio solo con C-06.
> - La prima bozza usava le regole di base (commit `c4ef25c`), e il §5 spiega che cosa è cambiato.
>
> La versione inglese è [`t3-evaluation-and-uncertainty.en.md`](t3-evaluation-and-uncertainty.en.md).

## 1. La domanda

Il progetto chiede quanto la statistica riesca a individuare senza firme predefinite, e quanto
spesso sbagli. Questo capitolo misura gli errori e quanto possiamo fidarci di quelle misure.
Confronta tre rilevatori sulle stesse richieste:

- **regole** (`rules`): solo firme. Una richiesta viene segnalata quando un'espressione regolare
  corrisponde.
- **statistica** (`stats`): solo statistica. Una richiesta viene segnalata quando il suo punteggio
  di anomalia `s = −log10 p`, appreso dal traffico legittimo, raggiunge una soglia.
- **combinato** (`combined`): una richiesta viene segnalata se una regola corrisponde, oppure se
  il punteggio raggiunge la soglia.

## 2. Disegno sperimentale

Ogni **seed** estrae un dataset completo dal generatore di traffico (T4, ADR-006), diviso in tre
insiemi:

| Insieme               | Richieste             | Contenuto                                                                                          | Serve a                        |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| addestramento (train) | {{split.train}}       | solo legittime                                                                                     | stimare il modello statistico  |
| calibrazione          | {{split.calibration}} | solo legittime                                                                                     | scegliere la soglia            |
| test                  | {{split.test}}        | {{split.testLegit}} legittime ({{split.testHard}} casi difficili) e {{split.testAttacks}} attacchi | misurare gli errori, una volta |

- **Le etichette non arrivano mai al modello né alla soglia.** Il modello è stimato solo su
  richieste legittime (ADR-004), e la soglia è scelta solo su richieste legittime (ADR-009). Le
  etichette degli attacchi servono una volta sola, per valutare l'insieme di test. Scegliere la
  soglia che sembra migliore sul test gonfierebbe ogni numero.
- **Gli attacchi** sono richieste legittime con un valore sostituito da un payload. Hanno tre
  varianti:
  - canonici: firme note;
  - offuscati: camuffati per eludere le firme;
  - nuovi (novel): famiglie per cui le regole non hanno alcuna firma.

  {{families.novel:Words}} famiglie su {{families.all:words}} sono nuove, quindi gli attacchi
  nuovi sono più della metà<!-- claim: novelMajority -->: {{perSeed.novel}} su
  {{split.testAttacks}} per seed.

- **I casi difficili** sono richieste legittime dall'aspetto insolito: un apostrofo, un testo
  libero lungo, un testo non latino. Sono solo nell'insieme di test, quindi mostrano come si
  comporta il rilevatore con traffico che la calibrazione non ha mai visto.
- **{{seedCount}} seed** danno {{seedCount}} repliche indipendenti dell'intera procedura: dati
  nuovi, modello nuovo, soglie nuove.

## 3. Metodi

### 3.1 Tassi d'errore, non accuratezza

Dalla matrice di confusione (TP, FN, FP, TN) il capitolo riporta:

- il tasso di veri positivi, `TPR = TP / (TP + FN)` (recall), e il suo complemento, il tasso di
  falsi negativi `FNR = 1 − TPR`;
- il tasso di falsi positivi, `FPR = FP / (FP + TN)`;
- la precisione, `TP / (TP + FP)`.

L'accuratezza non è riportata. Con {{legitShare:il}} di richieste legittime, un rilevatore che non
segnala mai nulla otterrebbe {{legitShare:il}}.

### 3.2 Una soglia per un tasso di falsi positivi obiettivo

Si prendono i punteggi di `n` richieste legittime di calibrazione e un obiettivo `α`. Al più
`k = ⌊α·n⌋` di esse possono raggiungere la soglia. La soglia `t` è il più piccolo numero
strettamente maggiore del `(k+1)`-esimo punteggio più alto: un quantile empirico dei punteggi
legittimi (`thresholdAtFpr`).

- **I pari merito** si muovono insieme, quindi l'FPR di calibrazione può scendere sotto `α`.
- **Dimensione:** il quantile si regge sui `k` punteggi più alti, e con meno di una decina di essi
  è rumoroso. Per questo l'insieme di calibrazione ha {{split.calibration}} richieste: `n ≥ 10/α`
  anche con `α = {{lo.target}}`.<!-- claim: calibrationSize -->
- **Un obiettivo irraggiungibile:** in modalità combinata una corrispondenza con una regola vale
  `+∞` ed è segnalata a qualsiasi soglia. Se più di `k` richieste legittime di calibrazione
  corrispondono a una regola, nessuna soglia rispetta l'obiettivo. La soglia allora si colloca
  sopra ogni punteggio finito di calibrazione, e sulla calibrazione scattano solo le regole. È
  successo con le regole di base (§5).

Anche Kruegel e Vigna (2003) fissano le soglie su traffico privo di attacchi.

### 3.3 Curva ROC e AUC

La curva ROC fa scendere la soglia attraverso ogni punteggio distinto e traccia il TPR contro
l'FPR. L'area sotto la curva è la statistica di Mann-Whitney:

```
AUC = P(punteggio di un attacco a caso > punteggio di una richiesta legittima a caso), pari merito ½
```

0,5 è il caso, 1 la separazione perfetta. L'AUC usa solo l'ordinamento dei punteggi, quindi non
dipende da alcuna soglia. Le regole hanno un punteggio binario: la loro curva ha un solo punto
interno, e `AUC = (1 + TPR − FPR) / 2`.

### 3.4 Incertezza dentro una singola esecuzione

Ogni tasso è una proporzione `x/n` stimata su un insieme di test finito. Riceve un intervallo di
**Wilson** al 95%, con `p̂ = x/n` e `z = 1,96`:

```
centro      = (p̂ + z²/(2n)) / (1 + z²/n)
semiampiezza = z / (1 + z²/n) · √( p̂(1 − p̂)/n + z²/(4n²) )
```

L'intervallo di Wald dei manuali, `p̂ ± z·√(p̂(1 − p̂)/n)`, collassa in [0, 0] quando non ci sono
errori. Wilson no: 0 falsi positivi su 900 danno un FPR in {{wilsonZero}}, non "zero".

L'AUC non è una semplice proporzione, quindi riceve un **bootstrap percentile stratificato**:

1. si ricampionano separatamente, con reinserimento, gli attacchi e le richieste legittime,
   {{resamples}} volte;
2. si calcola l'AUC di ogni ricampionamento;
3. si prendono il 2,5° e il 97,5° percentile.

I numeri casuali vengono da un generatore con seme pari al seed del dataset + 2³¹.<!-- claim: bootstrapOffset -->
Quella sequenza non si sovrappone mai a quella del dataset, quindi gli intervalli sono
riproducibili.

### 3.5 Incertezza tra un'esecuzione e l'altra

Gli intervalli del §3.4 descrivono un solo insieme di test. Da un seed all'altro cambia tutto
insieme: dati di addestramento, modello, soglia e insieme di test. Perciò ogni metrica è riassunta
con la media, la deviazione standard, l'intervallo di variazione e un intervallo t di Student al
95% per la media:

```
media ± t(0,975; {{df}}) · DS / √{{seedCount}},     t(0,975; {{df}}) = {{tQuantile}}
```

L'unità indipendente è il seed. Le richieste di uno stesso seed condividono un modello e una
soglia, quindi non sono prove indipendenti. Un intervallo di Wilson sui conteggi sommati su tutti
i seed ignorerebbe quanto si sposta la soglia da un'esecuzione all'altra, e risulterebbe troppo
stretto.

A volte un valore è identico in ogni seed, per esempio il 100% degli attacchi di command injection
individuati dalle regole.<!-- claim: rulesCmdiAll --> L'intervallo allora ha ampiezza zero, e le
tabelle riportano "in ogni seed".

### 3.6 Confrontare due rilevatori sulle stesse richieste

I tre rilevatori valutano le stesse richieste, quindi i loro risultati sono appaiati. Il **test di
McNemar** usa solo le richieste su cui due rilevatori non sono d'accordo: `b` segnalate solo da A,
`c` segnalate solo da B. Se i due fossero ugualmente buoni, ogni disaccordo sarebbe un lancio di
moneta: `b ~ Binomiale(b + c, ½)`.

- Il p-value esatto bilaterale è `2·P(X ≤ min(b, c))`. Il χ² dei manuali con correzione di
  continuità, `(|b − c| − 1)² / (b + c)`, coincide con esso per conteggi grandi.
- Attacchi, attacchi nuovi e richieste legittime sono testati separatamente. Sugli attacchi
  segnalare di più è meglio; sulle richieste legittime significa più falsi allarmi. Un test unico
  su tutte le richieste confronterebbe l'accuratezza.
- Sui seed i conteggi si sommano: sotto l'ipotesi nulla il `b` di ogni seed è binomiale, e lo è
  anche la somma.
- I test sono {{tests}} ({{pairs}} coppie × {{groups}} gruppi × {{targetCount}} obiettivi). Con la
  correzione di Bonferroni, una differenza conta se p < 0,05/{{tests}} ≈ {{bonferroni}}.

## 4. Risultati

Ogni valore è la media sui {{seedCount}} seed, con l'intervallo t al 95% della media tra parentesi
quadre.

### 4.1 Senza soglia: AUC

**Tabella 1 - AUC sull'insieme di test.**

| Rilevatore | AUC              | DS tra i seed      | Intervallo di variazione | Ampiezza media dell'intervallo bootstrap di un seed |
| ---------- | ---------------- | ------------------ | ------------------------ | --------------------------------------------------- |
| regole     | {{auc.rules}}    | {{aucSd.rules}}    | {{aucRange.rules}}       | {{aucBoot.rules}}                                   |
| statistica | {{auc.stats}}    | {{aucSd.stats}}    | {{aucRange.stats}}       | {{aucBoot.stats}}                                   |
| combinato  | {{auc.combined}} | {{aucSd.combined}} | {{aucRange.combined}}    | {{aucBoot.combined}}                                |

Guardando solo all'ordinamento, il combinato separa meglio gli attacchi dalle richieste legittime,
e la statistica batte nettamente le regole.<!-- claim: aucOrder -->

### 4.2 Con un obiettivo {{hi.target:del}} di falsi positivi

**Tabella 2 - Punto operativo con obiettivo {{hi.target}}.**

| Rilevatore | Soglia                    | FPR di calibrazione    | FPR test, tipiche               | FPR test, tutte le legittime | TPR                 | Precisione                | Obiettivo rispettato  |
| ---------- | ------------------------- | ---------------------- | ------------------------------- | ---------------------------- | ------------------- | ------------------------- | --------------------- |
| regole     | - (una regola)            | {{hi.calFpr.rules}}    | {{hi.variant.rules.typical}}    | {{hi.fpr.rules}}             | {{hi.tpr.rules}}    | {{hi.precision.rules}}    | {{hi.met.rules}} seed |
| statistica | {{hi.threshold.stats}}    | {{hi.calFpr.stats}}    | {{hi.variant.stats.typical}}    | {{hi.fpr.stats}}             | {{hi.tpr.stats}}    | {{hi.precision.stats}}    | {{hi.met.stats}}      |
| combinato  | {{hi.threshold.combined}} | {{hi.calFpr.combined}} | {{hi.variant.combined.typical}} | {{hi.fpr.combined}}          | {{hi.tpr.combined}} | {{hi.precision.combined}} | {{hi.met.combined}}   |

Le regole non segnalano alcuna richiesta legittima<!-- claim: rulesNoFalseAlarms -->, quindi il
combinato mantiene la soglia della statistica: i due danno gli stessi falsi allarmi, e il
combinato aggiunge le corrispondenze delle regole.<!-- claim: hiSameFalseAlarms -->

**Tabella 3 - Quota segnalata per variante con obiettivo {{hi.target}}.** Per gli attacchi è il
tasso di rilevamento; per le richieste legittime, il tasso di falsi positivi.

| Variante              | Richieste per seed     | regole                          | statistica                      | combinato                          |
| --------------------- | ---------------------- | ------------------------------- | ------------------------------- | ---------------------------------- |
| attacco · canonico    | {{perSeed.canonical}}  | {{hi.variant.rules.canonical}}  | {{hi.variant.stats.canonical}}  | {{hi.variant.combined.canonical}}  |
| attacco · offuscato   | {{perSeed.obfuscated}} | {{hi.variant.rules.obfuscated}} | {{hi.variant.stats.obfuscated}} | {{hi.variant.combined.obfuscated}} |
| attacco · nuovo       | {{perSeed.novel}}      | {{hi.variant.rules.novel}}      | {{hi.variant.stats.novel}}      | {{hi.variant.combined.novel}}      |
| legittima · tipica    | {{perSeed.typical}}    | {{hi.variant.rules.typical}}    | {{hi.variant.stats.typical}}    | {{hi.variant.combined.typical}}    |
| legittima · difficile | {{perSeed.hard}}       | {{hi.variant.rules.hard}}       | {{hi.variant.stats.hard}}       | {{hi.variant.combined.hard}}       |

Per famiglia:

- **Le regole** individuano tutti gli attacchi di command injection ({{hi.kind.rules.cmdi:mean}}
  in ogni seed)<!-- claim: rulesCmdiAll -->, e gran parte delle SQL injection
  ({{hi.kind.rules.sqli:mean}}), degli XSS ({{hi.kind.rules.xss:mean}}) e dei path traversal
  ({{hi.kind.rules.traversal:mean}}).<!-- claim: rulesMostTargeted --> Non individuano nessun
  attacco nuovo.<!-- claim: rulesNoNovel --> Sono state scritte solo per i payload canonici, senza
  guardare quelli offuscati e nuovi (ADR-006, B-01): prendono ogni attacco canonico, ma solo
  {{hi.variant.rules.obfuscated:0:il}} degli offuscati.<!-- claim: rulesAllCanonical -->
- **La statistica** individua fra {{hi.statsKindMin:0:il}} ({{hi.statsKindMinName}}) e
  {{hi.statsKindMax:0:il}} ({{hi.statsKindMaxName}}) di ogni famiglia.
- **Richieste legittime:** le regole non danno alcun falso allarme, {{hi.pooledFp.rules}} su
  {{legitTested}} richieste legittime di test nei {{seedCount}} seed.<!-- claim: rulesNoFalseAlarms -->
  La maggior parte dei falsi allarmi della statistica ({{hi.topFp.share}}) viene dalle richieste a
  {{hi.topFp.name}}, che ne danno uno {{hi.topFp.rate:nel}} dei casi<!-- claim: hiFpMostlyTop -->;
  le richieste a {{hi.zeroFp.names}} non ne danno mai.<!-- claim: hiFpSomeZero -->

### 4.3 Con un obiettivo {{lo.target:del}} di falsi positivi

Tutti e tre i rilevatori rispettano questo obiettivo.<!-- claim: loAllMet -->

- **Statistica:** soglia {{lo.threshold.stats}}; FPR di calibrazione {{lo.calFpr.stats}}, FPR di
  test {{lo.fpr.stats}}; TPR in calo {{lo.tpr.stats:al}}, precisione in salita
  {{lo.precision.stats:al}}<!-- claim: loTradeOff -->; {{lo.variant.stats.novel:il}} degli
  attacchi nuovi individuato, e nessun caso difficile segnalato.<!-- claim: loNoHard -->
- **Combinato:** la stessa soglia e gli stessi falsi allarmi<!-- claim: loSameFalseAlarms -->; TPR
  {{lo.tpr.combined}}, precisione {{lo.precision.combined}}.
- **Regole:** nessuna soglia, quindi la stessa riga {{hi.target:del}}: nessun falso allarme, TPR
  {{hi.tpr.rules:mean}}.<!-- claim: rulesNoFalseAlarms -->

### 4.4 Confronti appaiati

**Tabella 4 - McNemar con obiettivo {{hi.target}}**, disaccordi sommati sui {{seedCount}} seed.

| A contro B              | Richieste      | Segnalate solo da A               | Segnalate solo da B               | p esatto                          | Seed con p < 0,05                     |
| ----------------------- | -------------- | --------------------------------- | --------------------------------- | --------------------------------- | ------------------------------------- |
| statistica vs combinato | attacchi       | {{hi.cmp.statsCombined.attack.a}} | {{hi.cmp.statsCombined.attack.b}} | {{hi.cmp.statsCombined.attack.p}} | {{hi.cmp.statsCombined.attack.seeds}} |
| statistica vs combinato | attacchi nuovi | {{hi.cmp.statsCombined.novel.a}}  | {{hi.cmp.statsCombined.novel.b}}  | {{hi.cmp.statsCombined.novel.p}}  | {{hi.cmp.statsCombined.novel.seeds}}  |
| statistica vs combinato | legittime      | {{hi.cmp.statsCombined.legit.a}}  | {{hi.cmp.statsCombined.legit.b}}  | {{hi.cmp.statsCombined.legit.p}}  | {{hi.cmp.statsCombined.legit.seeds}}  |
| regole vs statistica    | attacchi       | {{hi.cmp.rulesStats.attack.a}}    | {{hi.cmp.rulesStats.attack.b}}    | {{hi.cmp.rulesStats.attack.p}}    | {{hi.cmp.rulesStats.attack.seeds}}    |
| regole vs statistica    | attacchi nuovi | {{hi.cmp.rulesStats.novel.a}}     | {{hi.cmp.rulesStats.novel.b}}     | {{hi.cmp.rulesStats.novel.p}}     | {{hi.cmp.rulesStats.novel.seeds}}     |
| regole vs statistica    | legittime      | {{hi.cmp.rulesStats.legit.a}}     | {{hi.cmp.rulesStats.legit.b}}     | {{hi.cmp.rulesStats.legit.p}}     | {{hi.cmp.rulesStats.legit.seeds}}     |

La statistica e il combinato danno esattamente gli stessi {{hi.pooledFp.stats}} falsi allarmi e
individuano gli stessi attacchi nuovi: lì non sono mai in disaccordo.<!-- claim: hiSameFalseAlarms --><!-- claim: hiSameNovel -->
Il combinato aggiunge {{hi.cmp.statsCombined.attack.b}} attacchi che la statistica perde, tutti
canonici o offuscati, quelli per cui le regole sono scritte.<!-- claim: hiSameNovel --> Regole e
statistica perdono attacchi diversi ({{hi.cmp.rulesStats.attack.a}} contro
{{hi.cmp.rulesStats.attack.b}}): per questo combinarle conviene.<!-- claim: hiBothMiss -->

Con {{lo.target:il}} il quadro è lo stesso: il combinato aggiunge
{{lo.cmp.statsCombined.attack.b}} attacchi alla statistica, con gli stessi {{lo.pooledFp.stats}}
falsi allarmi.<!-- claim: loSameFalseAlarms --><!-- claim: loSameNovel -->

### 4.5 Quanto si muovono i numeri?

- **Regole:** la DS dell'AUC tra i seed ({{aucSd.rules}}) coincide con l'errore standard dato dal
  bootstrap di un singolo seed (≈ {{aucBoot.rules}} / 3,92 = {{aucSe.rules}}).<!-- claim: rulesSdMatchesSe -->
  Le regole non imparano nulla dai dati, quindi l'unico rumore è l'insieme di test.
- **Statistica:** anche qui la DS tra i seed ({{aucSd.stats}}) è vicina all'errore standard del
  bootstrap (≈ {{aucSe.stats}})<!-- claim: statsSdMatchesSe -->: la dispersione viene soprattutto
  dall'insieme di test, e i dati di addestramento vi aggiungono poco. Nella prima bozza non era
  così. Sulla lunghezza grezza (commit `0ca4847`) la DS era 0,028 contro 0,013, e i dati di
  addestramento spiegavano circa quattro quinti della varianza. La scala logaritmica di C-04 ha
  reso il modello molto più stabile da un insieme di addestramento all'altro.
- **L'FPR di test su tutte le richieste legittime** si muove molto: DS {{hi.fprSd.stats}}, da
  {{hi.fprMin.stats}} a {{hi.fprMax.stats}}.<!-- claim: fprMoves --> Quante delle
  {{hardCases:words}} fixture dei casi difficili superano la soglia cambia da un seed all'altro.

Per questo l'esperimento usa {{seedCount}} seed e non uno.

## 5. Discussione

1. **La calibrazione funziona dove ha visto dati.** Sul traffico legittimo tipico, la statistica
   rispetta gli obiettivi fuori campione: {{hi.variant.stats.typical}} contro {{hi.target:il}},
   e {{lo.variant.stats.typical:mean}} contro {{lo.target:il}}.<!-- claim: typicalWithinTarget -->
2. **Non copre ciò che non ha visto.** Circa un caso difficile su {{hi.hardOneIn:words}}
   ({{hi.variant.stats.hard:0}}) dà un falso allarme con l'obiettivo {{hi.target:del}}.<!-- claim: hiHardFlagged -->
   Né l'insieme di calibrazione né quello di addestramento contengono richieste simili: un modello
   del "normale" è largo quanto il traffico normale che ha ricevuto.
3. **La statistica individua ciò che le firme non vedono.** Con l'obiettivo {{hi.target:del}}
   individua {{hi.variant.stats.novel:0:il}} degli attacchi nuovi, contro
   {{hi.variant.rules.novel:0:il}} delle regole: è la risposta centrale alla domanda di
   ricerca.<!-- claim: rulesNoNovel --> Però perde anche {{hi.statsMissCanonical:0:il}} degli
   attacchi canonici che le regole individuano ({{hi.variant.stats.canonical:0}} contro
   {{hi.variant.rules.canonical:0}}).<!-- claim: hiStatsMissCanonical --> Quindi affianca le
   regole, non le sostituisce.
4. **Combinare è gratis, finché le regole non danno falsi allarmi.** Le firme di B-01 non segnalano
   alcuna richiesta legittima, quindi il combinato mantiene la soglia e i falsi allarmi della
   statistica, e aggiunge le corrispondenze delle regole: con l'obiettivo {{hi.target:del}} il suo
   TPR sale {{hi.tpr.stats:0:dal}} {{hi.tpr.combined:0:al}} con lo stesso {{hi.fpr.stats:mean}} di
   falsi positivi (McNemar: {{hi.cmp.statsCombined.attack.b}} attacchi contro
   {{hi.cmp.statsCombined.attack.a}}, {{hi.cmp.statsCombined.attack.inSeeds}}).<!-- claim: rulesNoFalseAlarms --><!-- claim: hiSameFalseAlarms -->
   - Le regole di base della prima bozza (commit `c4ef25c`, con il segnale sulla lunghezza grezza
     di allora) mostravano il contrario. Corrispondevano al 20,6% delle richieste di login, le cui
     password generate contengono `#` e `--`, quindi le regole da sole segnalavano il 3,1% del
     traffico legittimo. Il combinato non poteva più rispettare un obiettivo dell'1%: la sua
     soglia saliva da 1,38, quella della statistica, a 2,30, e individuava meno attacchi nuovi
     della sola statistica (42% contro 59%, McNemar p < 0,001).
   - La lezione: con un budget fisso di falsi positivi, ogni falso allarme di una regola lo paga la
     statistica. Una firma va verificata sul traffico legittimo prima di entrare nella
     combinazione.

5. **Il tasso di base cambia tutto** (capitolo T4). Con la prevalenza {{prevalence:del}}
   dell'insieme di test, circa {{hi.precision.stats:0:il}} degli allarmi della statistica sono
   attacchi, e {{hi.precision.combined:0:il}} di quelli del combinato. Con una prevalenza `π`
   {{basePi:del}}, Bayes dà:

   ```
   PPV = TPR·π / (TPR·π + FPR·(1 − π))
   ```

   - con l'obiettivo {{hi.target:del}}: {{hi.ppv.stats}} per la statistica e {{hi.ppv.combined}}
     per il combinato, cioè anche per il combinato circa {{hi.falsePer100}} allarmi su 100 sono
     falsi;
   - con l'obiettivo {{lo.target:del}}: {{lo.ppv.stats}} e {{lo.ppv.combined}}.

## 6. Limiti

- **Dati sintetici.** I numeri descrivono il generatore di T4, non traffico reale. Valgono le
  conclusioni comparative: regole contro statistica, che cosa aggiunge la combinazione e quanto le
  costano i falsi allarmi di una regola, la calibrazione di fronte a richieste mai viste.
- **Un modello di base.** Il punteggio è ancora il solo segnale sulla lunghezza, in scala
  logaritmica (C-04).<!-- claim: lengthOnly --> Il chi-quadro (C-03) e i segnali di outlier (C-05)
  sono implementati ma entrano nel punteggio solo con C-06: cambieranno ogni numero delle Tabelle
  1-4, e `npm run report -- --update` scriverà quelli nuovi.
- **{{hardCases:Words}} casi difficili, ripetuti.** Il loro tasso di falsi positivi dice
  soprattutto quali dei {{hardCases:words}} superano la soglia. Non è un tasso su una popolazione di
  richieste insolite.
- **L'intervallo t** presuppone valori per seed approssimativamente normali. Con {{seedCount}} seed
  è ragionevole, ma non vicino allo 0% o al 100%, dove l'intervallo viene troncato.
- **Molti test.** Solo i risultati di McNemar con p < {{bonferroni}} superano la correzione di
  Bonferroni. Nella Tabella 4 la superano tutte le righe con p < 0,001; {{table4EqualRows}},
  perché lì i due rilevatori decidono allo stesso modo su ogni richiesta.<!-- claim: table4Extremes -->

## 7. Riprodurre i numeri

```bash
git checkout {{commit}}
npm ci
npm run experiments          # circa 1,5 minuti; scrive results/<data>-<commit>/report.md
npm run report -- --update   # la stessa esecuzione, salvata in numbers.json, e questo capitolo riscritto
```

Lo stesso seed dà sempre gli stessi dati, lo stesso modello, le stesse soglie e gli stessi
ricampionamenti bootstrap. `results.json` contiene ogni seed, con i propri intervalli di Wilson e
bootstrap. La pagina _Detection quality_ della dashboard mostra un seed dal vivo: ROC, matrice di
confusione, varianti, McNemar.

## 8. Contributo individuale

Nicholas Arcari (T3) ha scritto:

- la calibrazione della soglia (D-06);
- la curva ROC e l'AUC (D-03);
- gli intervalli di Wilson e bootstrap (D-05);
- l'esperimento su più seed e gli intervalli tra i seed (D-04);
- la calibrazione del server (B-02);
- la pagina _Detection quality_ della dashboard (E-06, e la ROC di E-02);
- il test di McNemar (D-07);
- i numeri generati della relazione: i modelli, `npm run report` e il test che li tiene allineati
  al codice (D-08);
- questo capitolo.

Preparato con Claude Code (assistente AI), come chiede di dichiarare la guida del gruppo.

## Riferimenti

- C. Kruegel e G. Vigna, _Anomaly Detection of Web-based Attacks_, ACM CCS 2003.
- E. B. Wilson, _Probable inference, the law of succession, and statistical inference_, JASA 22,
  1927 (l'intervallo di Wilson).
- Q. McNemar, _Note on the sampling error of the difference between correlated proportions or
  percentages_, Psychometrika 12, 1947.
- J. A. Hanley e B. J. McNeil, _The meaning and use of the area under a receiver operating
  characteristic (ROC) curve_, Radiology 143, 1982 (l'AUC come statistica di Mann-Whitney).
- B. Efron e R. J. Tibshirani, _An Introduction to the Bootstrap_, Chapman & Hall, 1993.
