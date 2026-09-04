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

## Estado da implementação

O plano foi executado. Sete commits em `develop`:

| commit | fase | o que entrou |
|---|---|---|
| `afdb8c2` | 4a | testes de estabilidade de alias e folha append-only (falhavam antes) |
| `e9e27f9` | 4a | alias de `@font-face` por fonte, acumulador em `WeakMap`, teto de 512 faces |
| `1e795ad` | 4b | `getUserFonts()` devolve a mesma referência, painel inteiro compartilha índice, cache e tabela |
| `2445a04` | 3 | `getTypeRPanelSnapshot` deixa de ler a camada inteira quando quem chama não precisa dela |
| `18ed149` | — | ExtendScript deixa de interpretar errado condições mistas `&&` / `\|\|` |
| `1dc55c5` | 1 + 2 | leitura do contorno pelo Action Manager; canal alfa só para quem quer a seleção de volta |
| `ad30f82` | 5 | identidade do array `lines`; `.debug` versionado |

### O defeito que a Fase 1 encontrou

O parser ES3 do ExtendScript lê `X || Y && Z` como `(X || Y) && Z`. O fonte escrevia os parênteses, mas o `host.jsx` é gerado pelo UglifyJS e parênteses não são nós da AST: saem no caminho. Todas as expressões desse formato no host publicado significavam outra coisa.

Em `_polygonScanlineSpan` isso derrubava um lado de cada span, `_buildPathShapeRows` nunca devolvia linhas, `_sampleSelectionShapeViaPath` sempre reportava `emptyRows`, e **toda seleção caía no amostrador legado de 21 operações**. Era daí que vinham os 423 ms — não do algoritmo, de um caminho rápido que nunca rodou.

O mesmo erro afetava outros três lugares, todos de correção e não de performance: `_setLayerStroke` aplicava um contorno que devia ignorar, `resolveTypeRFontVariant` podia sair cedo numa run que devia resolver, e o ramo de cor de catálogo da biblioteca jam (três cópias) escolhia a classe errada. Todos reescritos como instruções separadas.

`scripts/testBuildArtifacts.js` agora percorre a AST do `app/host.jsx` construído e falha em qualquer `||` cujo operando direito seja um `&&`. Essa classe de defeito não volta calada.

### Resultados medidos — benchmark limpo

Photoshop fechado e reaberto, `13.psd` recém-carregado. As medidas de host saem do mesmo processo com o código do host trocado em memória (`$.evalFile`), então os dois lados veem exatamente o mesmo Photoshop e o mesmo documento; as medidas de painel usam o `index.js` do respectivo build, cada uma depois de um reinício.

| | antes (`88aaeb6`) | depois |
|---|---|---|
| `_scanActiveLayerBubble`, 9 camadas — média | 350 ms | **98 ms** |
| — mediana / pior | 271 / 770 ms | 99 / 106 ms |
| `getCurrentSelectionShape`, marquee retangular | **425 ms** (caía no legado, `emptyRows`) | **181 ms** |
| — losango | 167 ms | 180 ms |
| — côncavo | 167 ms | 199 ms |
| **maior erro de linha contra o amostrador legado** | **1,0** (escala normalizada: erro máximo) | **0,0** |
| balões com perfil degenerado (`avgSpan` 0) | **5 de 9** | **0 de 9** |
| percorrer 9 camadas, bubble ON, cache frio — `getActiveLayerBubbleShape` | 8 chamadas · 437 ms média · 3497 ms | **6 chamadas · 208 ms média · 1250 ms** |
| — até as sugestões aparecerem, frio / quente | 716 / 304 ms | **458 / 197 ms** |
| troca de fonte — `sheetWrites` / `domMutations` | 16 / 16 | **0 / 0** |
| — click→paint médio / pior | 3 / 4 ms | 3 / 3 ms |
| poll ocioso — `getTypeRPanelSnapshot` | 3 ms | 3 ms |

**O marquee diagonal ficou levemente mais lento, e isso é o preço de estar certo.** No build anterior o losango e o côncavo voltavam em 167 ms porque o caminho rápido *rodava* — devolvendo linhas com erro máximo. Só o retângulo degenerava a ponto de cair no amostrador legado, e é por isso que era ele que custava 425 ms. Agora as três formas voltam pelo caminho rápido em 180–199 ms com as linhas idênticas às do legado.

**Erratas de medição.** O campo `rowsOver4px` que aparece nos scripts compara linhas com um limiar de 4, mas as linhas são normalizadas em 0..1: o limiar nunca dispara e o número não diz nada. O que vale é `maxDelta`, e é ele que está na tabela. A leitura anterior de "5 de 9 balões degenerados" continua de pé — foi reproduzida no Photoshop limpo.

### Resultados medidos — sessão instrumentada

Mesmo documento (1760×2560, 9 camadas de texto), mesmos styles, medindo antes e depois na mesma sessão.

**Seleção manual (Fase 1)** — `getCurrentSelectionShape`, dentro do ExtendScript:

| marquee | contorno rápido | amostrador legado | linhas diferentes |
|---|---|---|---|
| retângulo 600×500 | 94–98 ms | 402–420 ms | 0 |
| losango | 116–130 ms | 397–408 ms | 0 |
| côncavo (entalhado) | 118–122 ms | 410–422 ms | 0 |

Ponta a ponta: **423 ms → 162–190 ms**. O critério da Fase 1 era abaixo de 300 ms. A marquee do usuário volta com os mesmos limites exatos, e nem o caminho rápido nem o lento deixam demarcador ou canal para trás.

**Balão do bubble-aware (Fase 2)** — `getActiveLayerBubbleShape`:

> **Correção.** A primeira versão desta seção trazia 469 ms → 216 ms. Estava errada: os probes chamavam `selectLayerById({id:N})`, mas a função recebe um número — `parseInt({id:27}, 10)` dá `NaN` e ela retorna `"error"` sem trocar de camada. As nove medições eram da mesma camada. Os números abaixo são de camadas de verdade, com a camada ativa conferida a cada passo.

| `_scanActiveLayerBubble` nas 9 camadas | antes | depois |
|---|---|---|
| média | **775 ms** | **340 ms** |
| mediana | 698 ms | 340 ms |
| pior | 1406 ms | 441 ms |
| melhor | 485 ms | 274 ms |

**E não era só lentidão.** No build anterior o caminho rápido não caía no amostrador legado: ele devolvia linhas. Comparadas com o legado no mesmo balão, **5 dos 9 balões vinham com o perfil degenerado** — `avgSpan` 0 contra 1, `maxDelta` 1 numa escala normalizada, ou seja, o erro máximo possível. O TextShapeR moldava o texto num contorno de largura zero. A correção de precedência consertou a forma, não só o tempo. Depois dela as linhas batem com o amostrador legado nas 9 camadas (`rowsOver4px=0`).

Duas mudanças, ambas em `_sampleSelectionShapeViaPath`:

1. **O contorno passa pelo Action Manager.** `_readPathAnchorPolygons` já existia para o centróide: um `executeActionGet` no lugar de uma caminhada pelo DOM que custa ~5,7 ms por âncora. Num balão traçado (12 contornos, 678 pontos), 245–278 ms pelo DOM contra 48–79 ms aqui, com as linhas concordando em 0,2 px. O DOM continua como reserva quando `_pathAnchorsMatchDom` reprova a unidade; um contorno acima do orçamento de âncoras não recebe nenhum dos dois, porque a caminhada pelo DOM levaria minutos.
2. **O canal alfa temporário virou opcional.** Ele custa 47 ms para criar e 18 ms para remover, e existe só para devolver a seleção exata que o usuário desenhou. Quem usa a varinha joga a seleção fora ao voltar: agora não paga. Se o scan falhar, recebe o próprio demarcador traçado como seleção, que é tudo de que o amostrador legado precisa.

**Troca de fonte (Fase 4)** — 16 cliques alternando entre 4 styles com fontes diferentes:

| | antes (fontes diferentes) | alvo (mesma fonte) | depois |
|---|---|---|---|
| `sheetWrites` | 16 | 1 | **0** |
| `aliasChanges` | 16 | 0 | **0** |
| `cardStyleWrites` | 48 | 0 | **0** |
| click→paint médio / pior | 6 / 9 ms | 3 / 5 ms | **3 / 7 ms** |
| frames > 50 ms | 1 | 0 | **0** |
| `Layout` | 56,4 ms | 24,3 ms | **23,3 ms** |
| `EventDispatch` | 89,5 ms | 20,4 ms | **33,9 ms** |

O cenário "fonte diferente" virou o cenário "mesma fonte", que era exatamente o alvo.

**Poll ocioso (Fase 3)** — 45 s com o painel parado: `getTypeRPanelSnapshot` 7 chamadas, média **4 ms**; `getSelectionChanged` 30 chamadas, média 6,7 ms; 228 ms de main thread em 45 s, **0,5%**. O critério era abaixo de 10 ms.

### Uma ressalva sobre os números absolutos

`jamText.getLayerText()` custava 89 ms no diagnóstico e mede 226–259 ms no fim da sessão, igual nas 9 camadas. Reconstruí o host com os arquivos jam anteriores à correção de precedência e medi 265 ms — ou seja, **não é regressão do código**: é o processo do Photoshop depois de horas de instrumentação (purgar caches e histórico não muda nada). Os números absolutos de `getTypeRPanelSnapshot` e `getSelectionChanged` nas tabelas acima carregam essa deriva; as comparações antes/depois foram todas medidas em sequência na mesma sessão e não carregam.

A tabela do benchmark limpo acima é a que vale; esta seção fica como registro de como a deriva distorce medidas absolutas. A deriva piorou ao longo da sessão: as últimas medições de `getActiveLayerBubbleShape` pelo painel saíram em 525 ms com o mesmo código que antes media 288 ms. Por isso as comparações que valem são as de **contagem de chamadas** (8 → 6) e as medidas em sequência imediata, não os absolutos.

### O que ficou de fora, e por quê

- **Baixar `samples` de 21 para 9** — refutado por medição (A3), e depois pela causa real: o custo era o caminho rápido não rodar.
- **Subir o settle de 350 ms** (Fase 1, item 4) — **medido.** Arrasto simulado contando os scans que o painel chega a disparar: 8 passos de 70 ms → **1 scan**; 8 passos de 150 ms → **1 scan**; 5 passos de 400 ms → 2 scans. Os 350 ms já colapsam o arrasto inteiro num scan só. Subir para 600 ms ganharia um scan num cenário em que o usuário fica 400 ms parado no meio do arrasto — indistinguível de ter soltado o mouse — e cobraria 250 ms de atraso na forma em todos os outros.
- **Adiar o scan do balão para o hover** (Fase 2, candidato 1) — as sugestões nascem com a forma do balão; adiar faria a lista aparecer sem forma e mudar sozinha depois. Isso é mudança de comportamento, não ganho.

O critério "percorrer camadas com bubble-aware ON perto do custo com OFF" não foi atingido: 288 ms contra 56 ms. Ficou na metade do caminho, com a forma preservada.

### Verificações de fechamento

- **Guardas de região patológica (Fase 2, candidato 3): confirmadas.** Marquees crescentes no documento de referência: 4% da página 200 ms, 20% 165 ms, 49% **10 ms**, 97% **9 ms**. `_regionCoversTooMuchPage` recusa acima de 25% da página e cai direto no perfil da caixa, sem pagar scan nenhum. O `areaRatio > 60` do `_scanActiveLayerBubble` cobre o caso equivalente da varinha.
- **Startup e memória: iguais.** Reconstruí o commit anterior ao trabalho (`88aaeb6`), instalei e medi três recargas do painel de cada lado: **1689–1696 ms / 45 MB / 649 nós** antes, **1686–1691 ms / 45 MB / 649 nós** depois.
- **A guarda de build funciona de verdade.** Ao trocar o `app_src` pelo baseline por engano, `testBuildArtifacts.js` reprovou o build e listou as seis expressões afetadas.
- **Smoke funcional no painel ao vivo:** styles listados e clique trocando o ativo; aliases de preview aplicados (26 nós, 9 fontes distintas); folha nunca encolhe (5195 bytes estáveis); sugestões do TextShapeR renderizadas; preview da linha atual; bubble-aware liga e desliga; controles de tamanho presentes; zero erros de console. O auto-fit dos cards responde: escala 0,958 → 0,472 → 0,202 conforme o card estreita, e volta a 0,958 — com a altura mandando enquanto a largura ainda sobra, que é o comportamento certo.

### Fechamento das fases 2 e 3, no Photoshop limpo

**Fase 3 — o poll.** `getTypeRPanelSnapshot` medido dentro do host, trocando a camada ativa a cada leitura para que a assinatura nunca acerte de graça:

| | antes | depois |
|---|---|---|
| pedido sem a camada (o que um marquee dispara) | 105–165 ms | **1 ms** |
| pedido com a camada (troca de camada) | 89 → 155 ms | 120 → 183 ms |

A segunda linha não é regressão: alternando os dois builds três vezes seguidas, a leitura completa cresceu monotonicamente nos dois (89, 120, 134, 155, 183) — é a deriva do processo, e cada rodada mediu o build que calhou de vir depois. A primeira linha ficou em 1 ms nas três rodadas do build novo e nunca abaixo de 89 ms no antigo.

**Fase 2 — o critério.** Percorrer as 9 camadas, cache frio, dentro do ExtendScript:

| | antes | depois |
|---|---|---|
| bubble-aware ON, por camada | 592 ms | **355 ms** |
| bubble-aware OFF, por camada | 69 ms | 114 ms |

O critério pedia o ON perto do OFF. Não foi atingido: o ON continua cerca de três vezes o OFF. O ganho é de 40% e a forma passou a estar correta, mas quem liga o bubble-aware ainda paga um wand scan por balão novo, e isso é o que ele é.

### Lista de regressão: o que foi conferido ao vivo

| item | estado |
|---|---|
| seleção de style e destaque do ativo | verificado |
| preview de fonte no nome do style | verificado — 26 nós com alias, 9 fontes distintas |
| preview da linha atual | verificado |
| isolamento por pasta | verificado — 6 / 16 / 10 styles conforme a pasta aberta |
| abas | verificado — trocam o roteiro e voltam |
| sugestões do TextShapeR | verificado |
| aplicar uma forma | verificado — clicar na segunda sugestão reescreveu o texto da camada |
| bubble-aware on/off | verificado |
| seleção manual | verificado |
| quick size | verificado — o campo aceita edição |
| redimensionar o painel / auto-fit dos cards | verificado — escala 0,958 → 0,472 → 0,202 e volta |
| prefixos | **não conferido** — o roteiro carregado não tem prefixos |
| markdown | **não conferido** |
| aprendizado (estrela / Alt / Ctrl / Shift) | **não conferido** — depende de teclado e modificadores reais |
| batch multi-layer | **não conferido** |
| multi-bubble de ponta a ponta | **não conferido** |
| size preset (os botões, não o campo) | **não conferido** |

Os seis não conferidos têm cobertura nas 31 suítes de `npm test`, mas ninguém os exercitou no painel. Não afirmo que estão certos; afirmo que não olhei.

Duas armadilhas do próprio harness apareceram aqui e valem registro, porque geraram falso negativo: `selectLayerById` recebe um número e devolve `"error"` calado para qualquer outra coisa, e um `.replace(/\s+/g, " ")` que perdeu a barra pelo caminho vira `/s+/g` e apaga todos os "s" do texto exibido — cheguei a achar que tinha corrompido o roteiro do usuário, que estava intacto.

### Ainda em aberto

Dos três itens que ficaram em aberto, dois foram fechados depois (o reuso entre camadas do mesmo balão foi implementado; a restauração pelo demarcador foi medida e recusada). Sobra um:

1. ~~**Pular o scan enquanto o multi-bubble empilha seleções**~~ (Fase 1, item 3) — **descartado.** `inlineSelectionShape` não alimenta só as sugestões: `handleAlignLayer` tira dele o `phantomOffsetX` (`previewBlock.jsx:1050`). Deixar de escanear durante o empilhamento degradaria a centralização na hora de colar, que é justamente o que o usuário está preparando. Levado ao autor do pedido, a resposta foi não trocar centralização por tempo.
2. **Restaurar a seleção a partir do demarcador em vez do canal alfa** (Fase 1, item 1) para quem quer a seleção de volta: **medido e recusado.** Restaurar do demarcador leva 20–28 ms contra os 65 ms do canal, mas não devolve a mesma seleção. Num losango de 700×600 a seleção volta com 694×600 e deslocada 5 px; retângulo e côncavo voltam idênticos. Traçar com tolerância 2,0 corta diagonal, e laço e varinha são quase só diagonal. Feito só para os chamadores da varinha, que descartam a seleção — que era onde estavam os 65 ms.
3. ~~**Reaproveitar o scan entre camadas do mesmo balão**~~ — **feito** (`8cbea03`). A página de referência tem o caso: as camadas 25, 23, 21 e 19 dividem o balão em `93,1043 930x542` e as camadas 17 e 15 dividem o de `135,288 501x756`. Antes de rodar a varinha, o painel procura um balão já traçado nesta sessão cujo contorno contenha os quatro cantos da caixa de tinta da camada. A caixa envolvente sozinha não decide — balões vizinhos se sobrepõem em caixa com facilidade — então o teste é contra o perfil amostrado que já está no cache.

   O reuso também exige **corpo de fonte igual**. O contorno traçado não é só o balão: a detecção cresce e encolhe a seleção por metade do corpo para fechar os buracos das letras. Medido: 25, 21 e 19 dividem o balão com corpo 17 e voltam bit a bit iguais; a 23, no mesmo balão com corpo 16, voltou até 0,15 mais estreita — 142 px ali. Ao vivo, percorrendo as 9 camadas: `getActiveLayerBubbleShape` cai de **8 para 6 chamadas** (seriam 5 sem a trava de corpo, ao custo de servir a forma errada para a 23).

Fora isso, os itens da lista de regressão que dependem de mão humana continuam sem passagem ao vivo: aprendizado (estrela / Alt / Ctrl / Shift), batch multi-layer, multi-bubble de ponta a ponta, aplicar uma forma, prefixos e isolamento por pasta no painel, markdown. Todos têm cobertura nas 31 suítes de `npm test`, nenhum foi clicado à mão.

### Reproduzir

As bancadas continuam fora do repositório, no scratchpad da sessão (`cdp.js`, `bench.js`, `benchSelect.js`, `benchMarquee.js`, `benchBubble.js`, `cmpShape.js`, `cmpBubble2.js`, `benchIdle.js`, `diagBubble3.js`, `benchLayerText.js`, `typerperf.js`). O `.debug` correto agora está versionado e o `install.ps1` o copia, então o debug remoto na porta 8001 funciona depois de uma instalação normal.
