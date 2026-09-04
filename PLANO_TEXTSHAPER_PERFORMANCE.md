# Plano — travadas do TypeR com o TextShapeR ligado

Branch: `develop`.

## Contexto

Usuários relatam travadas no TypeR com o TextShapeR ligado. Três gatilhos foram reportados: (a) trocar de style/preset que muda a fonte, (b) selecionar uma caixa de texto, (c) fazer a seleção para colar a fala (varinha, retângulo, laço).

Investiguei na branch `develop` com três instrumentos: leitura do código, bancada Node sobre o reducer e o `fontPreview.js` reais, e — o decisivo — **medição ao vivo dentro do painel CEP em execução**, via CDP na porta 8001, com Photoshop 27.9.1 / CEP 12 / Chromium 99, documento real de 1760×2560 e 1527 fontes instaladas.

**O resultado inverteu a prioridade da hipótese inicial.** A troca de fonte custa 3–6 ms e é real, mas é ruído. As travadas de verdade estão nas chamadas ExtendScript, que rodam na **main thread do Photoshop** — a mesma que entrega mouse e teclado ao painel e desenha o canvas. Medido:

| Gatilho | custo por ação, dentro do ExtendScript |
|---|---|
| **(c) fazer uma seleção** (varinha/retângulo/laço) | **~1036 ms**, dos quais 423 ms são `getCurrentSelectionShape` |
| **(b) selecionar camada de texto**, bubble-aware ON | **~744 ms**, dos quais 413 ms são `getActiveLayerBubbleShape` |
| (b) selecionar camada de texto, bubble-aware OFF | ~56 ms |
| **(a) trocar style/fonte** | **0 ms de host**; 3–6 ms de CPU no painel |

Sob essa carga, um `evalScript` **vazio** leva **151 ms de mediana** (mínimo 13 ms). É a fila do ExtendScript congestionada — e é isso que o usuário sente como "trava".

O painel em si nunca teve frame acima de 120 ms em nenhum cenário. **Não é o painel que trava, é o Photoshop.**

Escopo: só essas travadas. Nada de UXP, React 18, Redux, Worker, ou reescrever o gerador do TextShapeR.

---

## Medições

### Ambiente

| Item | Valor |
|---|---|
| Photoshop 27.9.1 · CEP 12 · Chromium 99.0.4844.84 | painel roda **sem GPU** (`gpu_init.cc(440): GL is disabled`) |
| Documento | `13.psd`, 1760×2560, 9 camadas de texto |
| Fontes instaladas | 1527 |
| Painel | 600×901, 16 styles visíveis, DOM 798–1276 |
| DevTools remoto | estava quebrado: `.debug` instalado dizia `Extension Id="typertools"`, manifesto diz `typer`. Corrigido nesta sessão (arquivo fora do repositório) |

### (c) Fazer uma seleção — 6 marquees, bubble-aware OFF

```
getCurrentSelectionShape    calls= 6  total= 2685ms  avg= 447ms  max= 556ms
getTypeRPanelSnapshot       calls=19  total= 2205ms  avg= 116ms  max= 322ms
getSelectionChanged         calls=26  total= 1279ms  avg=  49ms  max= 219ms
TOTAL dentro do ExtendScript: 6218 ms / 6 seleções = 1036 ms cada
painel: longFrames(>120ms) = 0
```

### (b) Selecionar camada de texto — 18 seleções, 2 passadas

| | bubble-aware ON | bubble-aware OFF |
|---|---|---|
| `getActiveLayerBubbleShape` | **8 calls, avg 413 ms, max 781 ms** | 0 |
| `getTypeRPanelSnapshot` | 22 calls, avg **159 ms**, max 855 ms | 18 calls, avg **37 ms**, max 60 ms |
| `getSelectionChanged` | 25 calls, avg **141 ms**, max 756 ms | 22 calls, avg **10,5 ms** |
| `selectLayerById` (comando trivial) | 18 calls, avg **171 ms** | 18 calls, avg **5,8 ms** |
| **total no ExtendScript** | **13,4 s** ≈ 744 ms/seleção | **1,0 s** ≈ 56 ms/seleção |
| até as sugestões aparecerem | frio 451 ms · quente 352 ms | 330 ms · 331 ms |
| painel `longFrames(>120ms)` | 0 | 0 |

O wand scan rodou 8 vezes em 18 seleções — o cache por layer funciona. Mas quando roda, contamina tudo: até um `selectLayerById` trivial passa de 5,8 ms para 171 ms.

### Onde vai o tempo dentro do host

Marquee de 600×500 num documento de 1760×2560:

| operação | mediana |
|---|---|
| round-trip vazio de `evalScript` | **151 ms** (min 13, max 444) |
| `_getCurrentSelectionBounds()` | 2 ms |
| `_withSuspendedHistory` (no-op) | 5 ms |
| `_withDialogsSuppressed` (no-op) | 2 ms |
| **canal temporário de seleção (create + remove)** | **71 ms** |
| **`getCurrentSelectionShape(21)` completo** | **423 ms** |
| `getTypeRPanelSnapshot` | 79 ms |
| `getActiveTextLayerGeometry` | 2 ms |
| `getCurrentSelection` | 1 ms |

**O custo não escala com `samples`:**

| samples | 5 | 9 | 13 | 17 | 21 | 31 |
|---|---|---|---|---|---|---|
| `getCurrentSelectionShape` | 416 ms | 521 ms | 320 ms | 351 ms | 401 ms | 492 ms |
| `getActiveLayerBubbleShape` | 367 ms | 317 ms | 369 ms | — | 422 ms | — |

Isso **refuta** a otimização óbvia de baixar 21 para 9. O custo é overhead fixo: canal temporário + conversão para work path + o round-trip.

### O poll de 1,2 s

`getTypeRPanelSnapshot` = duas metades:

| metade | mediana | bytes |
|---|---|---|
| `getActiveLayerTextIfChanged` (sem signature casada) | **89 ms** | **8499** |
| `getTypeRSelectionSnapshot` | 3 ms | 49 |
| combinado | 95 ms | 8565 |

O guard de `signature` existe (`host.js:getActiveLayerTextIfChanged`) e funciona — na medição ao vivo a média caiu para 37 ms, então parte das chamadas curto-circuita. Mas quando não casa, o poll custa 89 ms de main thread do Photoshop e transfere 8,5 KB, a cada 1,2 s.

### (a) Trocar style/fonte — 16 cliques por cenário

| Cenário | `sheetWrites` | `aliasChanges` | `cardStyleWrites` | click→paint avg/pior | frames>50 ms | `Layout` | `EventDispatch` |
|---|---|---|---|---|---|---|---|
| mesma fonte (Ventura ↔ Ventura) | **1** | 0 | 0 | **3 / 5 ms** | 0 | 24,3 ms | 20,4 ms |
| fontes diferentes | **16** | 0 | 0 | 6 / 9 ms | 1 (59 ms) | 56,4 ms | 24,2 ms |
| sem os cards do TextShapeR | **16** | 0 | 0 | 6 / 18 ms | 1 (70 ms) | 55,5 ms | — |
| **style com a fonte da camada** (colapso do dedup) | **16** | **16** | **48** | 6 / 7 ms | 0 | 59,4 ms | **89,5 ms** |

`typerPerf` nos mesmos 16 cliques: `setCurrentStyleId` 16 dispatches / **2 ms totais**; `PreviewBlock` 17 renders, `StylesBlock` 16, **`TextBlock` nenhum**; **host calls: 2 em 16 cliques**, ambas de poller de fundo; `longFrames(>120ms)`: 0.

A causa é real — o alias de `@font-face` é nomeado por posição (`fontPreview.js:133`), então a folha é reescrita a cada troca de fonte e o alias da camada é renomeado quando o dedup colapsa. Mas custa 3 ms, não centenas.

### Hipóteses

| # | Hipótese | Status | Evidência |
|---|---|---|---|
| A1 | `getCurrentSelectionShape` é a maior travada | **CONFIRMADA** | 423 ms med, 447 ms avg ao vivo; 1036 ms por seleção somando tudo |
| A2 | O wand scan de bubble-aware é a segunda | **CONFIRMADA** | 413 ms avg, 13× o custo total com bubble-aware OFF |
| A3 | Reduzir `samples` de 21 para 9 ajudaria | **REFUTADA** | custo plano de 5 a 31 samples |
| A4 | A fila do ExtendScript congestiona e atrasa tudo | **CONFIRMADA** | round-trip vazio 151 ms med; `selectLayerById` 5,8 → 171 ms |
| A5 | O painel (React/CSS/layout) trava | **REFUTADA** | 0 frames > 120 ms em todos os cenários |
| B1 | Alias de `@font-face` é posicional e muda sozinho | **CONFIRMADA** | `aliasChanges: 16/16` |
| B2 | A folha é reescrita a cada troca de fonte | **CONFIRMADA** | `sheetWrites: 16/16` vs `1/16` com a mesma fonte |
| B3 | Os cards do TextShapeR amplificam isso | **REFUTADA** | sem cards o custo é o mesmo |
| C1 | `generateTextShapeRVariants` roda ao trocar de style | **REFUTADA** | deps do `useMemo` (`previewBlock.jsx:289`) |
| C2 | Reducer / reparse de linhas pesam | **REFUTADA** | 0,1 ms/clique ao vivo; 1,18 ms com 8000 linhas no Node |
| C3 | Size preset reprocessa linhas | **CONFIRMADA como comportamento, REFUTADA como causa** | 1,13 ms com 8000 linhas |
| C4 | Habilitar GPU no CEP ajudaria | **REFUTADA** | delta em `Layout`/`EventDispatch` (CPU main thread); `GPUTask` ~300 ms igual em todos os cenários |

---

## Plano, na ordem do custo medido

### Fase 1 — `getCurrentSelectionShape`: ~423 ms por seleção

**Arquivos:** `app_src/host.js` (`getCurrentSelectionShape`, `_sampleSelectionShapeViaPath`), `app_src/components/previewBlock/previewBlock.jsx:395-528`.

Investigar, nesta ordem, medindo cada passo com a bancada já pronta (`benchHostParts.js`):

1. **Canal temporário — 71 ms.** Existe só para restaurar a seleção que `_makeWorkPathFromSelection` consome. Testar restaurar a partir do próprio work path (antes de apagá-lo) em vez de criar/remover um canal alpha. Se funcionar, corta ~17% do custo sem mudar o resultado.
2. **Onde vão os ~350 ms restantes.** Instrumentar `_makeWorkPathFromSelection`, `_readPathPolygons` e `_deleteWorkPath` separadamente, e verificar se o caminho `path` está mesmo vencendo ou se o legado de 21 operações está rodando (o campo `scan` da resposta diz qual).
3. **Não escanear quando o resultado não vai ser usado.** O shape só alimenta `generateTextShapeRVariants`. Enquanto o usuário está empilhando seleções em multi-bubble para colar falas, ele não está olhando as sugestões. Candidato: pular o scan enquanto `multiBubbleMode` estiver ligado com seleções empilhadas, e disparar sob demanda (hover/interação no widget), como já se faz em `handleTextShapeRMouseEnter`.
4. **Settle.** Hoje 350 ms (`previewBlock.jsx:428-437`). Verificar se subir para ~600 ms reduz scans em uso real sem prejudicar a resposta percebida.

**Critério de aceitação:** custo por seleção manual abaixo de 300 ms no mesmo documento, sem perder o shape correto (comparar `rows` antes/depois no mesmo marquee).

**Não fazer:** baixar `samples` — medido como inútil (A3).

### Fase 2 — `getActiveLayerBubbleShape`: ~413 ms por camada nova

**Arquivos:** `app_src/host.js` (`_scanActiveLayerBubble`, `getActiveLayerBubbleShape`), `previewBlock.jsx:465-527`.

O cache por layer já funciona (8 scans em 18 seleções). O que resta é a **primeira visita a cada camada**, que é exatamente o fluxo de trabalho: percorrer os balões da página um a um.

Candidatos, a medir antes de escolher:

1. **Adiar até o usuário olhar.** Trocar o disparo automático na seleção da camada por disparo sob demanda: manter as sugestões sem shape (já funcionam) e rodar o wand quando o usuário passar o mouse no widget ou pedir. Preserva bubble-aware inteiro; muda só *quando* paga.
2. **Reaproveitar entre camadas do mesmo balão.** A chave é `(layerId, bounds, sourceKey)`. Duas camadas dentro do mesmo balão pagam dois scans.
3. Confirmar que o `_regionCoversTooMuchPage` e o `areaRatio > 60` já barram os casos patológicos (parecem cobrir).

**Critério de aceitação:** percorrer 9 camadas com bubble-aware ON custando perto dos 56 ms/camada do modo OFF, mantendo o shape correto quando ele é usado.

**Não fazer:** desligar bubble-aware, reduzir samples, ou remover o cache.

### Fase 3 — carga contínua do poll

**Arquivos:** `app_src/host.js` (`getActiveLayerTextIfChanged`, `getTypeRPanelSnapshot`), `previewBlock.jsx:727-739`.

Medir a **taxa real de acerto** do guard de `signature` em uso normal. Cada falha custa 89 ms e 8,5 KB, a cada 1,2 s. Se a taxa for baixa, descobrir por quê (a signature é `layerId:historyIndex` — qualquer ação do usuário no Photoshop muda o history index e invalida).

Candidato: separar "a camada mudou?" (barato — `getActiveTextLayerGeometry` custa **2 ms**) de "me dá o texto todo" (caro — 89 ms), e só pedir o caro quando o barato disser que mudou.

**Critério de aceitação:** custo médio do poll abaixo de 10 ms com o painel ocioso.

**Não fazer:** voltar com refresh no foco, ou acelerar o polling.

### Fase 4 — alias de `@font-face` estável e folha compartilhada (a troca de fonte)

Menor em milissegundos, mas é a travada que os usuários nomeiam, e é a correção mais segura e mais barata do plano. Vai inteira.

**Arquivos:** `app_src/fontPreview.js` (`createFontPreviewRegistry`), `app_src/utils.js:569` (`getUserFonts`).

Hoje o alias é `TypeRPreview[_ns]_${revision}_${rules.length}` — **posição**. Duas mudanças, que se completam:

**4a — um alias por fonte, folha append-only.**

1. Acumulador guardado num `WeakMap` chaveado pelo array de fontes — mesmo padrão já usado por `fontIndexCache`/`lookupCache` (`fontPreview.js:27-28`) — contendo `Map<fontKey, { alias, rule }>` e a ordem de inserção.
2. Chave de fonte já vista → reusa alias e regra. Nova → aloca `TypeRPreview[_ns]_<revision>_<n>` com `n` = contador do acumulador.
3. `css` = concatenação de todas as regras já vistas. A folha só cresce, nunca reordena.
4. Teto de 512 faces; ao estourar, não aloca mais — `getFontPreviewFamily` já cai para `fontName` → `fontPostScriptName` → `Tahoma`.

**4b — um só acumulador para o painel inteiro.** `getUserFonts()` (`utils.js:569`) devolve `userFonts.concat([])`, um array novo por chamada, então `StylesBlock` e `PreviewBlock` acabam com identidades diferentes: dois índices completos das 1527 fontes e, com 4a, dois acumuladores separados. Devolvendo a **mesma referência** (e passando-a também aos callbacks de `refreshUserFonts`), os dois passam a compartilhar índice, cache de lookup e tabela de aliases.

Isso é o que torna o ganho **completo em vez de parcial**: o `StylesBlock` já registra, no startup, uma regra para cada fonte distinta usada pelos styles **daquele** usuário. Compartilhando a tabela, **toda fonte de style já nasce registrada**, e a folha do `PreviewBlock` deixa de mudar mesmo na *primeira* troca para aquela fonte. Sobra, no máximo, uma regra para a fonte da camada ativa do Photoshop quando ela não é usada por nenhum style — e essa só muda quando o usuário troca de camada, não ao clicar num style.

**Nada é embutido no código.** O acumulador é construído em tempo de execução, na sessão de cada usuário, a partir de `context.state.styles` e da lista de fontes instaladas daquela máquina — exatamente como `createFontPreviewRegistry` já funciona hoje (`stylesBlock.jsx:121`). A mudança só altera *como o alias é nomeado* (por fonte, não por posição) e faz a folha crescer em vez de ser reescrita. Quem tem 5 styles terá 5 regras; quem tem 300, 300. O perfil medido aqui (42 fontes distintas, folha de 5187 bytes) é referência de medição, não um valor do código. O teto de 512 é rede de segurança por sessão.

Verificado que 4b é seguro: nenhum consumidor muta o array (`editStyle.jsx:388`, `fontScanR.jsx:35`, `fontViewer.jsx:408`, `stylesBlock.jsx:42`, `previewBlock.jsx:225` só fazem `map`/`forEach`/`find`/`filter`/`Set`; nenhum `sort`/`push`/`splice` in-place).

**Efeito medido esperado:** o alias da camada para de mudar quando só o style muda → `contentKey` estável → sem re-fit dos cards, sem churn de `ResizeObserver`; e `registryRef.current.css === next.css` passa a valer sempre → o `<style>` não é tocado. O cenário "fonte diferente" vira o cenário "mesma fonte", que já medi: `sheetWrites` 16 → 0, `aliasChanges` 16 → 0, `cardStyleWrites` 48 → 0, click→paint 6 → 3 ms, `Layout` 56,4 → 24,3 ms, `EventDispatch` 89,5 → 20,4 ms.

**Testes:** `scripts/testFontPreview.js` passa **sem alteração** — o contador é por acumulador e cada assert usa uma combinação `(fontes, namespace, revision)` distinta. Novos asserts: mesmo alias para a mesma fonte em chamadas sucessivas; alias da segunda fonte não muda quando a primeira entra ou sai da lista (o colapso do dedup medido em `aliasChanges: 16/16`); `next.css.startsWith(prev.css)`; duas chamadas a `getUserFonts()` devolvem a mesma referência.

**Riscos:** a folha cresce durante a sessão — limitada pelo teto de 512 e pelo número de fontes distintas dos styles (42 neste perfil). Fonte instalada no meio da sessão gera array novo → acumulador novo → folha reconstruída uma vez, que é o comportamento correto.

**Complemento opcional (só se a medição pós-4a/4b ainda mostrar custo):** `ResizeObserver` do fit (`textShapeRFitPreview.jsx`) — separar o observer (montagem) do re-fit (`contentKey`), para o caso legítimo em que a fonte da camada realmente muda.

### Fase 5 — itens pequenos

- **`lines` não muda de referência quando nada mudou** (`context.jsx:1567`). Poupa um render por clique entre pastas.
- **`.debug` versionado** com `Extension Id="typer"`. Nada no repositório gera esse arquivo hoje: `install.ps1` só substitui `app`, `CSXS`, `icons`, `locale`, e `build_release.cmd` usa allow-list que não o inclui — então versioná-lo dá debug remoto funcionando para dev sem vazar no zip do usuário final.

---

## Alternativas rejeitadas, com evidência

| Alternativa | Por quê |
|---|---|
| Reduzir `samples` de 21 para 9 | custo plano de 5 a 31 samples |
| Forçar GPU no CEP via `CEFCommandLine` | delta está em `Layout`/`EventDispatch`, CPU main thread; `GPUTask` ~300 ms igual em todos os cenários; e é fonte conhecida de painel preto por driver |
| Otimizar `generateTextShapeRVariants` | não roda no clique de style; nos outros cenários o custo é host, não JS |
| Web Worker | não há gargalo de CPU em JS; DOM e ExtendScript não vão para worker |
| Separar `PreviewBlock` em dois componentes | 1 render por clique, reducer 0,1 ms |
| Evitar reparse de linhas em size preset | 1,13 ms com 8000 linhas; risco de quebrar prefixes/pastas |
| Remover o adiamento de 75 ms | proteção correta, reparse custa 1,18 ms |
| Desligar bubble-aware, esconder widget, spinner, fonte falsa no preview | "fake performance" — não reduz trabalho real |
| **Subir `RequiredRuntime` do CSXS para pegar Chromium mais novo** | não funciona: o motor vem do Photoshop, não do manifesto. O manifesto declara `CSXS 6.0` e o painel roda **AdobeCEP/12.0.0 + Chromium 99** (lido no `navigator.userAgent` ao vivo; log `CEPHtmlEngine12`, `PlugPlug 12.0.0.14`). `RequiredRuntime` é um **mínimo**: subi-lo só derrubaria suporte a Photoshop antigo (`[16.0,99.9]` hoje), com zero ganho. Motor mais novo só via UXP, que é reescrita |
| UXP, React 18, Redux | fora de escopo |

## Invariantes que não podem ser revertidos

Fontes buscadas uma vez no startup sem refresh no foco (`stylesBlock.jsx:111-117`); reuso de registry quando o CSS é idêntico (`stylesBlock.jsx:125`, `previewBlock.jsx:239`); caches por identidade do array de fontes (`fontPreview.js:27-28`); ausência de refresh no `focus` (`previewBlock.jsx:719-723`); `isPanelInteracting()` nos pollers (`utils.js:136-142`); backoff por ociosidade (`utils.js:118-129`); cache de bubble por layer com limite de 120 (`previewBlock.jsx:80-85`); settle antes do sampling (`previewBlock.jsx:428-437`); refresh de prefixos adiado em 75 ms (`context.jsx:1415-1423`); reuso de identidade de linhas e styles (`context.jsx:1436-1443`, `1563-1585`).

## Ordem de commits

1. `test(font-preview): cover alias stability and append-only css` — testes que falham hoje.
2. `perf(font-preview): keep preview font aliases stable per font` — Fase 4a.
3. `perf(fonts): share one installed-font list across the panel` — Fase 4b.
4. `perf(host): stop paying for the full layer snapshot on every poll` — Fase 3.
5. `perf(host): cut the fixed cost of the selection outline scan` — Fase 1.
6. `perf(text-shaper): scan the bubble only when the suggestion is used` — Fase 2.
7. `perf(context): keep the lines array when no line changed` + `chore(debug): ship a working CEP remote-debugging descriptor`.

A troca de fonte (commits 1–3) vem primeiro apesar de ser o menor ganho em milissegundos: é a travada que os usuários nomeiam, está totalmente especificada, cai em dois arquivos e não depende de mais medição. As Fases 1 e 2 são o maior ganho mas exigem instrumentação dirigida dentro do host antes de escolher a correção, por isso vêm depois.

## Regressão funcional

Seleção de style; destaque do ativo; preview de fonte no nome do style; preview da linha atual; size preset e quick size; prefixos; isolamento por pasta; sugestões do TextShapeR; aplicar uma forma; aprendizado (estrela / Alt / Ctrl / Shift); bubble-aware on/off; batch multi-layer; multi-bubble; seleção manual; markdown; redimensionar o painel conferindo o auto-fit dos cards.

## Benchmark de aceitação

Repetir as tabelas acima com as bancadas prontas no scratchpad da sessão (`cdp.js`, `bench.js`, `benchSelect.js`, `benchMarquee.js`, `benchHostParts.js`, `benchSnapshot2.js`, `typerperf.js`), no mesmo documento e styles. Alvos: seleção manual < 300 ms; percorrer camadas com bubble-aware ON perto do custo com OFF; poll ocioso < 10 ms; troca de fonte já vista com os mesmos números da troca com a mesma fonte; zero frames > 120 ms; startup e memória não piores.

---

## Estado desta investigação

Este documento é o resultado da fase de diagnóstico. **Nenhuma alteração de código foi feita** — a implementação segue a ordem de commits acima.

As bancadas de medição usadas (cliente CDP para o painel CEP, benchmark de cliques de style, benchmark de seleção de camada, benchmark de marquee, breakdown das funções do host, sonda de `typerPerf`, e as bancadas Node do reducer e do `fontPreview.js`) ficaram fora do repositório. Para reproduzir as medições é preciso um `.debug` válido na extensão instalada — ver Fase 5.
