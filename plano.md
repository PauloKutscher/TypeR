# Plano — centralização de texto em balões (TypeR)

Documento de trabalho. Atualizado a cada etapa concluída.

Última atualização: 2026-08-18, após explicar o centroide ausente e fechar os cinco cenários (runs `031` a `035`).

## Objetivo

A centralização atual destrói posições que já estavam corretas. Os 10 PSDs em `psd/` (cópias byte a byte de `true/`) já estão corretamente centralizados e servem de ground truth. A meta é descobrir a regra geométrica que explica por que o estado original está correto e implementá-la de forma generalizável, medindo o erro real produzido pelo plugin.

Escopo desta etapa: balões normais fechados, balões cortados pelo quadro e balões irregulares/gritos.
Fora do escopo agora: balões duplos/triplos, aninhados, quadrados múltiplos, texto fora de balão, regiões sem delimitação clara.

## Regras invioláveis

- `psd/` e `true/` são somente leitura. Todo trabalho acontece em `.centering-lab/` (já no `.gitignore`). Hash SHA-1 verificado antes e depois de cada run.
- Nunca fechar PSD de trabalho salvando; sempre `DONOTSAVECHANGES`.
- Sem offset fixo por página, sem correção para um balão específico, sem hardcode de posição ou tamanho, sem copiar coordenadas do ground truth.
- O ground truth só entra no cálculo de pontuação, nunca como entrada do algoritmo. As funções candidatas têm assinatura `fn(mask, textInkSize) -> {cx, cy}`: não recebem nome de arquivo, índice de página nem acesso ao gabarito, então hardcode é impossível por construção.
- Não mergear o PR #2 e não alterar arquivos dele. O PR é referência, não fundação.
- Preservar a modificação local do usuário no `.gitignore` (linhas `.serena`).

## Diagnóstico do código atual (develop @ 24c8c64)

Três entradas convergem no mesmo ponto de posicionamento, `_positionLayerWithinSelection` (`app_src/host.js:803`):

| Caminho | Função | Região do balão usada |
| --- | --- | --- |
| Paste | `_createTextLayerInSelection` (:1619, posiciona em :1640) | `_checkSelection({adaptiveOpen:true})` sobre a marquee viva |
| Align / Center | `_alignCurrentTextLayerToSelection` (:1644, posiciona em :1682) | marquee viva; sem marquee, shape layer abaixo; senão varinha em um ponto |
| Multi-bolhas | `_createTextLayersInStoredSelections` (:3302, posiciona em :3355) | bbox cru da marquee armazenada, **sem** `adaptiveOpen`, **sem** varinha, **sem** offset geométrico |

O posicionamento é sempre `offsetX = selection.xMid - bounds.xMid (+ phantomOffsetX)` e `offsetY = selection.yMid - bounds.yMid`.

Detecção de região, em ordem de tentativa no Align:

1. marquee viva → `_checkSelection({adaptiveOpen:true})` (:1179);
2. sem marquee → `_findShapeLayerBoundsBelowTextLayer()` (:1715), só para `layerKind 4` (shape layer), varrendo até 12 camadas abaixo e exigindo que os bounds contenham o texto;
3. senão → `_createMagicWandSelection(20)` (:810), que sonda um único ponto em `(textBounds.left - 5, textBounds.yMid)` com `contiguous: true`, `merged: true`, `antiAlias: true`, seguido de novo `_checkSelection({adaptiveOpen:true})`.

`adaptiveOpen` é uma abertura morfológica: contrai `r`, expande `r`, com `r = clamp(round(menorLado * _SELECTION_OPEN_RATIO), _MIN_SELECTION_OPEN_RADIUS, floor(menorLado/2 - 1))`, aceitando o resultado só se `width * height >= 200`, senão tentando `r/2` (`_getAdaptiveOpenedSelectionBounds`, :716). O que sai dela é consumido como bounding box.

O texto é medido por `_getCurrentTextLayerBounds()` (:590), que lê a propriedade AM `bounds` da camada via `_getBoundsFromDescriptor` (:565) usando `getInteger` — truncamento que impõe piso de erro de ±1 px.

Fato relevante: o projeto **já calcula** o contorno real do balão (`getActiveLayerBubbleShape` :2837 → `_scanActiveLayerBubble` :2795 → `_sampleSelectionShapeViaPath` :2690, produzindo 17/21 scanlines), mas essa geometria alimenta o TextShapeR (quebra de linha) e é descartada na centralização. O atalho de teclado chama `alignTextLayerToSelection(resizeTextBoxOnCenter, internalPadding)` sem nenhum dado geométrico; o botão Align só passa `phantomOffsetX`, e apenas quando o TextShapeR inline em modo bubble-aware já tinha perfil — nunca em Y.

### Hipóteses de causa raiz (a discriminar por medição)

- **H1 — caixa métrica ≠ tinta.** O AM `bounds` de camada de texto é a caixa métrica da fonte (ascender/descender, caixa do parágrafo) e inclui layer effects. Previsão: viés assinado consistente em Y, variando com o conteúdo da linha.
- **H2 — bbox de região não convexa ≠ centro visual.** Cauda, espinho e ponta entram no bbox; o raio da abertura vem do bbox, não da forma. Previsão: erro que escala com a irregularidade do balão.
- **H3 — região vinda de sondagem em um único ponto.** `(left - 5, yMid)` com `merged: true` e tolerância 20 pode capturar arte, retícula, contorno ou balão vizinho. Previsão: erro grande e errático.

## Arquitetura da bancada

O Photoshop é a parte lenta, então a geometria é extraída uma vez e as hipóteses são testadas offline.

```text
psd/ (read-only)
  -> cópia em .centering-lab/runs/<N>/in
  -> Photoshop 2026 via COM + app/host.jsx (motor real)
       -> align REAL camada por camada  -> report.json (antes, depois, dX, dY)
       -> dump da máscara do balão (PNG) + JSON (bbox, ink bounds, centro de tinta, categoria)
  -> laboratório Node: regras candidatas -> ranking por categoria contra o ground truth
  -> porta a regra vencedora para host.js (um único lugar) -> revalida no Photoshop
```

## Critério de aprovação

Por eixo: `|Δ| ≤ max(1 px, 1% × min(larguraBalão, alturaBalão))`. O relatório traz também o erro em pixels absolutos e o erro relativo.

Baseline da medição: `resizeTextBoxOnCenter` desligado e `internalPadding = 0`, para isolar o deslocamento. A matriz com resize ligado entra na regressão final.

## Estado das tarefas

| # | Tarefa | Estado |
| --- | --- | --- |
| 1 | Confirmar ambiente e montar a bancada isolada | concluída |
| 2 | Harness de medição em uma página | concluída |
| 3 | Fase 2: erro medido nos 10 PSDs e veredito de causa raiz | concluída |
| 4 | Dump de máscaras para iteração offline | concluída |
| 5 | Busca da regra geométrica em Node | concluída |
| 6 | Balões cortados pelo quadro | concluída (sem tratamento especial: a regra escolhida já resolve) |
| 7 | Gritos e formatos irregulares | bloqueada: a amostra não contém nenhum |
| 8 | Portar a regra vencedora para o plugin | concluída |
| 9 | Regressão e gate | concluída: gate aprovado nos cinco cenários (resize, padding, seleção viva e offset) |
| 10 | Paridade do modo multi-bolhas | concluída |
| 11 | Fechar o gate: três defeitos na leitura do centroide | concluída |
| 12 | Fluxo real: seleção viva e offset do painel | concluída |
| 13 | Recusa removida e vazamento da varinha contornado | concluída |
| 14 | Centroide ausente no estreitamento: orçamento obsoleto e traçado vazio | concluída |

## Registro do que já foi feito

### Task 1 — ambiente e bancada (concluída)

- Photoshop 2026 instalado em `C:\Program Files\Adobe\Adobe Photoshop 2026`, versão **27.9.1**, chave de registro `HKLM\SOFTWARE\Adobe\Photoshop\200.0`.
- Automação por COM validada: `New-Object -ComObject Photoshop.Application` e `DoJavaScript` retornaram `version=27.9.1 | docs=0 | scriptingVersion=27.9 | displayDialogs=DialogModes.NO`. Nenhum documento do usuário aberto, então não há trabalho em risco.
- `.centering-lab/` criado e adicionado ao `.gitignore` (as duas linhas `.serena` do usuário foram preservadas).
- Hashes SHA-1 de `psd/**` e `true/**` gravados em `.centering-lab/meta/ground-truth-hashes.json`. Confirmado que as duas pastas são idênticas byte a byte nos 10 arquivos.
- 10 PSDs copiados para `.centering-lab/runs/000-baseline/in/`.
- `npm run build` na `develop` em 30,7 s. Baseline registrado em `.centering-lab/meta/baseline-host.json`: `app/host.jsx` com 165 049 bytes, SHA-1 `32d3c3f1aeae5d13f99a66a84cd2c5eca75b0772`.
- Ground truth reverificado no fim da task: intacto.
- Verificado que o `host.jsx` empacotado preserva os nomes de todas as funções necessárias (`alignTextLayerToSelection`, `_alignCurrentTextLayerToSelection`, `_positionLayerWithinSelection`, `_createMagicWandSelection`, `_getAdaptiveOpenedSelectionBounds`, `_getCurrentTextLayerBounds`, `_findShapeLayerBoundsBelowTextLayer`, `_deselect`, `_hostState`, `jamJSON` e outras). O UglifyJS renomeia apenas variáveis locais, então o harness pode chamar o motor real e as internas de diagnóstico sem modificar o plugin.

### Task 2 — harness de medição (concluída)

Arquivos: `scripts/lab/measureCentering.jsx` (roda dentro do Photoshop) e `scripts/lab/runMeasure.ps1` (driver COM).

O harness, para cada camada de texto de cada PSD copiado:

1. torna a camada a única ativa e desfaz qualquer marquee;
2. tira um snapshot de `activeHistoryState`;
3. mede a caixa métrica (`_getCurrentTextLayerBounds`), a caixa sem efeitos (`boundsNoEffects`) e a caixa de tinta (duplicata rasterizada com `RasterizeType.TEXTCONTENTS`, medida e descartada);
4. reproduz as sondas do próprio plugin — `_findShapeLayerBoundsBelowTextLayer`, `_createMagicWandSelection(20)`, `_getAdaptiveSelectionOpenRadius`, `_getAdaptiveOpenedSelectionBounds` — sem alterar o plugin;
5. sonda a **região de referência**: esconde a camada de texto e aplica a mesma varinha no centro da tinta, o que dá o balão em que o texto realmente está;
6. restaura o histórico, roda o `alignTextLayerToSelection` real, mede de novo e calcula o deslocamento;
7. restaura o histórico outra vez e confirma que a camada voltou ao ground truth.

Além disso exporta, por página, dois composites 8-bit em cinza sem cabeçalho (`.withtext.raw` e `.notext.raw`, 2700×3840 = 10 368 000 bytes cada) para o laboratório Node ler sem depender de decodificador de imagem.

Resultado: 10 páginas, 65 camadas de texto, 0 erros de script, 65/65 restauradas ao estado original. `psd/` e `true/` intactos por hash.

### Task 3 — Fase 2, erro medido (concluída)

`scripts/lab/buildCases.js` consolida tudo em `cases.json`; `scripts/lab/report.js` gera `report.md`. Classificação derivada só da geometria medida: `leak` (região contém mais de um texto ou fatia implausível da página), `cut` (lado reto colado numa borda), `scream` (baixa solidez), `normal`.

Critério: `|Δ| ≤ max(1 px, 1% × menor lado da região)` por eixo.

| Categoria | Casos | viés X | \|X\| med | \|X\| p95 | \|X\| max | viés Y | \|Y\| med | \|Y\| p95 | \|Y\| max | PASS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal | 26 | 0,2 | 2 | 9 | 14 | 0,8 | 4 | 38 | 77 | 12/26 |
| cut | 15 | 0,0 | 3 | 66 | 66 | 16,5 | 11 | 212 | 212 | 3/15 |
| leak | 24 | −29,5 | 159 | 302 | 311 | 111,6 | 178 | 399 | 1452 | 1/24 |
| TOTAL | 65 | −10,8 | 5 | 224 | 311 | 45,3 | 11 | 335 | 1452 | **16/65** |

Veredito:

- **H1 descartada.** Nos 65 casos o `bounds` que o plugin lê é idêntico ao bbox da tinta rasterizada. A propriedade AM `bounds` de camada de texto já é a caixa da tinta — não existe erro de métrica de fonte a corrigir. Isso também derruba a justificativa do `_getCurrentRenderedTextBounds` proposto no PR #2, que paga duplicação e rasterização por página para medir algo que já estava correto.
- **H3 é dominante.** 24 de 65 casos (37%) caem em regiões que o flood fill contíguo funde: dois balões ligados por um corredor branco, ou vazamento para o fundo da página. Um caso chegou a região de 2700×3840 (página inteira) com dY = 1452 px, e outro retornou `smallSelection`. Nesses casos o texto é jogado para o centro de outro balão, e dois textos da mesma região vão para o mesmo ponto.
- **H2 é o residual relevante.** Nos 41 casos de região isolada, o bbox da região aberta acerta apenas 16/41 dentro de 1%. O rabicho infla o bbox (visto com clareza em duas máscaras: a abertura morfológica corrigiu X de −62 px para +0,5 px num caso) e a assimetria vertical do balão desloca o centro (77 px em outro).

Nenhum caso desta amostra foi classificado como `scream`: a solidez ficou ≥ 0,85 em todos os balões não vazados. A Task 7 vai precisar confirmar visualmente se a amostra realmente não tem balão de grito.

### Task 4 — bancada offline fiel (concluída)

`scripts/lab/labImage.js` implementa leitura do raw, flood fill contíguo 4-vizinhos com a mesma tolerância do plugin, erosão/dilatação/abertura por imagem integral, transformada de distância chamfer e visualização ASCII.

Teste crítico do plano: o flood fill em Node, partindo do mesmo ponto de sonda, reproduz o centro da região do Photoshop com desvio **máximo de 0,5 px** nos 65 casos (o meio pixel vem do arredondamento inteiro dos bounds do Photoshop). A bancada offline é fiel, então a busca de regra pode iterar sem abrir o Photoshop.

### Task 5 — busca da regra geométrica (concluída)

`scripts/lab/scoreRules.js` cruza estágios de isolamento (`raw`, `pluginOpen`, `isolate35`, `trim40/50/60`, `openThenTrim50`) com regras de centro (`bbox`, `centroid`, `inscribedRect`, `fitMargins`), pontuando os 65 casos por categoria. Todas as candidatas recebem apenas região, semente e tamanho da tinta do texto; o gabarito entra só na pontuação. As regras também são pontuadas com a semente deslocada ±40 px em oito direções, para expor regra que só funciona com semente perfeita.

Resultado nos 41 casos do escopo (normal + cut):

| regra | PASS 1% | PASS 2% | medX | medY | p95X | p95Y |
| --- | --- | --- | --- | --- | --- | --- |
| `raw+centroid` | 17/41 | 71% | 2,0 | 4,6 | 11,0 | 39,5 |
| `pluginOpen+centroid` | 16/41 | **73%** | 2,0 | 4,9 | **11,2** | **19,2** |
| `pluginOpen+bbox` (plugin atual) | 16/41 | 63% | 2,0 | 4,5 | 30,0 | 37,0 |
| `openThenTrim50+centroid` | 12/41 | 63% | 2,5 | 5,0 | 8,5 | 15,2 |
| `raw+bbox` | 9/41 | 34% | 5,5 | 7,5 | 61,5 | 46,0 |

Três conclusões que mudam o critério de sucesso:

1. **A mediana do erro é praticamente idêntica em todas as regras** (2,0–2,7 px em X, 4,5–6,0 px em Y). Como a tolerância de 1% vale 3 a 7 px nesses balões, o critério de 1% está medindo o ruído de posicionamento do próprio tipógrafo, não a qualidade da regra. O que separa as regras é a cauda (p95) e o comportamento nos casos catastróficos.
2. **Trocar o centro do bbox pelo centroide de área corta a cauda pela metade** sem mexer na mediana: p95 vai de 30,0/37,0 px para 11,2/19,2 px. É a mudança de maior efeito por menor diff, porque reaproveita a abertura morfológica que o plugin já faz.
3. `inscribedRect` e `dtMax` foram mal (p95 de 158 px em Y): o ponto mais "folgado" do balão não é onde o tipógrafo põe o texto.

Sobre os balões duplos (24 casos fora de escopo): os detectores puramente geométricos são fracos — perfil bimodal pega 2/24, contagem de lobos por erosão pega 6/24, ambos sem falso alarme. O sinal forte está em informação que o plugin tem em runtime: **as outras camadas de texto do documento**. Particionando a região pela camada de texto mais próxima (célula de Voronoi) e centralizando na célula, o erro mediano dos casos de balão duplo cai de 159/178 px para 12/26 px. A cauda continua ruim (p95 de centenas de px) no caso em que a região vaza para a página inteira, que precisa de recusa explícita.

**Regra escolhida:** manter a abertura morfológica que já existe e trocar o centro do bbox pelo **centroide de área da região aberta**. Justificativa: melhor PASS a 2% (73% contra 63%), menor cauda (p95 11,2/19,2 contra 30,0/37,0), mais robusta a deslocamento da semente (41,5% contra 22,0% em `raw`), e é a menor mudança possível no ponto compartilhado pelos três caminhos. `trim` melhora mais a cauda em Y mas piora a mediana e o PASS, então fica de fora: um estágio a mais sem evidência clara não entra.

Além da regra de centro, duas correções de região entram no porte porque respondem pela maior parte do erro:

- **Ponto de sonda.** Sondar o centro da tinta do texto com a camada de texto oculta, em vez de `(bounds.left − 5, bounds.yMid)`. Nos dados, a sonda atual às vezes cai fora do balão.
- **Recusa em região ambígua.** Se a região contiver outra camada de texto ou cobrir fatia implausível da página, não mover: hoje esses casos deslocam o texto em centenas de pixels, e um caso jogou o texto 1452 px para fora do balão.

### Task 6 e 7 — cortados e gritos (parcial)

Cortados (15 casos): a regra escolhida já responde por eles sem tratamento especial. Com abertura + centroide, o p95 do erro cai de 66 px para 14 px em X e de 212 px para 64 px em Y, e o PASS a 1% sobe de 3/15 para 5/15. Não foi necessário nada sobre interseção com o canvas ou reconstrução do lado cortado: centralizar na área visível é o que o gabarito faz.

Gritos: **a amostra não tem nenhum**. A solidez ficou ≥ 0,85 em todos os 41 balões de escopo, e o caso de menor solidez (0,850) é um balão redondo cuja detecção vazou para a arte, não um grito. A regra escolhida é agnóstica de forma e a abertura morfológica remove espinhos por construção, mas isso é argumento, não medição. Para fechar a Task 7 é preciso pelo menos uma página com balão de grito, serrilhado ou explosivo.

### Task 8 e 10 — porte para o plugin (concluído, com uma ressalva medida)

Mudanças em `app_src/host.js`:

1. `_positionLayerWithinSelection(selection, bounds, phantomOffsetX, target)` ganhou um alvo explícito. Sem alvo, mantém o comportamento histórico (centro do bbox). É o único ponto por onde os três caminhos passam.
2. `_polygonCentroid` + `_pointInPolygon`: centroide de área do contorno traçado. O maior contorno é o balão; contornos cujo centro cai dentro dele são subtraídos como buracos; ilhas e partículas do antialias são ignoradas.
3. `_getSelectionAreaCentroid(bounds)`: aplica a mesma abertura morfológica que os bounds já usavam, traça o contorno com `Make Work Path` (tolerância 1,0), calcula o centroide e devolve em pixels, mapeando pelo bbox da própria seleção aberta. Restaura a seleção do canal temporário e nunca destrói work path do usuário.
4. `_createBalloonWandSelection`: sonda o balão **no centro da tinta do texto, com a camada oculta**, em vez de `(bounds.left − 5, bounds.yMid)`.
5. `_regionIsImplausibleBalloon` + `_regionHoldsOtherTextLayer`: se a região cobre mais de 25% da página ou contém outra camada de texto, o Align devolve `noSelection` em vez de mover. A mensagem que o painel já mostra nesse caso ("desenhe uma seleção") é a ação certa, então nenhuma chave de locale nova foi necessária.
6. Multi-bolhas: o centroide é capturado junto da marquee em `getSelectionChanged` (é o único momento em que o contorno existe) e viaja no payload como `centroidX`/`centroidY`; `_createTextLayersInStoredSelections` posiciona nele. Sem isso o modo continuaria centralizando no centro do retângulo armazenado.
7. Duas guardas de custo: região acima de 25% da página não é traçada, e o contorno é recusado acima de 4000 âncoras. Sem elas o Photoshop **congelou** ao traçar a região que vazou para a página inteira — o `Make Work Path` gera um path que segue toda a arte engolida e a leitura das âncoras pelo DOM não termina.

Teste: `scripts/testBalloonCentroid.js`, registrado no `npm test`. Testa comportamento com entradas reais (quadrado, rabicho, afunilamento, buraco em winding nos dois sentidos, partícula distante, contorno degenerado) e o helper de posicionamento (alvo, fallback, offset fantasma). Não é teste de regex sobre o texto-fonte.

Resultado medido pelo motor real nos 10 PSDs (`node scripts/lab/compareRuns.js 000-baseline 008-shared`):

| categoria | n | PASS 1% antes → depois | \|dX\| med/p95 antes → depois | \|dY\| med/p95 antes → depois | recusas |
| --- | --- | --- | --- | --- | --- |
| normal | 26 | 12/26 → 8/26 | 2/9 → 3/9 | 4/38 → 4/**43** | 0 |
| cut | 15 | 3/15 → 5/15 | 3/**66** → 3/**14** | 11/**212** → 10/**64** | 0 |
| leak | 24 | 0/24 → 0/24 | 159/302 → **76**/136 | 178/399 → **55**/239 | **14** |

Leitura honesta desses números:

- O ganho grande está onde o plugin destruía a página: 14 dos 24 casos de balão duplo agora **recusam** em vez de arremessar o texto (um deles ia 1452 px para fora do balão), e os 10 restantes tiveram o erro mediano cortado de 159/178 px para 76/55 px. Nos balões cortados, a cauda caiu de 66/212 px para 14/64 px.
- Nos balões normais a mediana é a mesma (3 px em X, 4 px em Y) e os piores casos melhoraram bastante (77 → 43 px, 38 → 21 px, 30 → 5 px), mas o p95 de Y subiu 5 px e o PASS a 1% caiu de 12 para 8. A soma dos erros absolutos nos 26 normais ficou praticamente igual: 314 px contra 320 px.
- A queda no PASS a 1% não significa piora real: a tolerância vale 3 a 7 px nesses balões e o erro mediano é 3 a 4 px, então o contador de PASS oscila com o ruído de posicionamento do gabarito. É por isso que o relatório traz p95 e soma de erros junto.
- **O gate continua reprovando** por causa do p95 de Y nos normais. A causa é um único caso (`0018-0019 #1`, solidez 0,850, 11% da área perdida na abertura): a detecção vazou para a arte embaixo do balão, o centroide seguiu o vazamento e errou 46 px onde o centro do bbox acertava por sorte. É o mesmo problema de qualidade de região dos casos `leak`, em escala menor.

Tentativa descartada, registrada para não ser repetida: calcular o centroide por **varredura de scanlines** do contorno em vez de área assinada. Parecia mais fiel ao centroide de pixels e é imune a winding, mas na medição real deslocou o centro vertical dos normais de 4 px para 34 px de mediana (p95 151 px). Área assinada com contorno principal é a versão correta.

### Task 11 — fechar o gate: o problema não era a região, eram três defeitos na leitura do centroide (concluída)

A hipótese anterior era que o caso remanescente (`0018-0019 #1`, erro de 46 px em Y) tinha a região vazada e precisaria de partição por Voronoi. **Medição derrubou isso.** `scripts/lab/diagCentroid.jsx` (novo, com driver `scripts/lab/runDiag.ps1`) reproduz o caminho do centroide dentro do Photoshop passo a passo e imprime cada valor intermediário. O contorno traçado dava centroide `y = 836,97` contra gabarito `837,5` — **certo por 0,5 px**. O erro nascia depois.

Três defeitos, cada um medido antes de ser corrigido:

1. **Remapeamento entre dois enquadramentos diferentes.** O centroide era convertido para `u,v` no bbox do contorno e remapeado no bbox da seleção. Os dois não são o mesmo objeto: `Make Work Path` traça o limiar de 50%, enquanto `_getCurrentSelectionBounds` conta também a franja antialias. Medido no caso: contorno 539x1069, seleção 575x1163. O remapeamento levava o centro de `y = 837` para `y = 883`. Correção: fixar a régua em pixels (`Units.PIXELS`) e usar as coordenadas do contorno como vêm, com o bbox da seleção servindo apenas de envelope de sanidade. O mapeamento existia porque as âncoras vêm em unidades de régua — pinar a régua resolve a mesma preocupação com menos código.

2. **Tolerância do traçado grosseira.** Com `Make Work Path` a 1,0 px o Photoshop descreve um balão de 434x681 com **22 âncoras**, e o contorno resultante não é simétrico: o centroide saía 13 px para o lado. Varredura medida (mesmo balão, mesma seleção):

| tolerância | âncoras | dX | dY |
| --- | --- | --- | --- |
| 0,5 | 487 | −3,9 | +7,9 |
| 1,0 | 22 | −13,1 | +2,8 |
| 2,0 | 11 | −16,1 | −5,6 |

   A 0,5 px o centroide traçado converge para o centroide da própria máscara medido offline (−4,5 / +7,5). A densidade do achatamento de curva **não importa**: 6 passos e 24 passos concordam em 0,2 px, então o traçado, não o achatamento, era o limite. Correção: tolerância 0,5.

3. **Leitura de âncoras pelo DOM.** Com 592 âncoras, `subPathItems[i].pathPoints[j].anchor` custou **3 404 ms** (≈5,7 ms por âncora) e o centroide inteiro 4 475 ms — inaceitável num clique de centralização. As mesmas âncoras saem de um `executeActionGet` em **5 ms**. Correção: `_readPathAnchorPolygons` lê `pathContents` por Action Manager, converte de pontos para pixels pela resolução do documento, e `_pathAnchorsMatchDom` confere uma âncora contra o DOM antes de confiar na conversão (se não bater, o centroide é descartado em vez de mover a camada para um lugar inventado).

Além disso, **a abertura deixou de ser feita duas vezes**. Custo medido por etapa numa página 5400x3840: canal temporário 264 ms, contrair 79 ms, expandir 55 ms, traçar 64 ms, ler âncoras 5 ms, centroide 1 ms, apagar path 47 ms, recarregar canal 67 ms, remover canal 55 ms. O canal e o par contrair/expandir eram pagos uma vez para os bounds e outra para o centroide. Agora `_getAdaptiveOpenedSelectionBounds` calcula o centroide enquanto a seleção aberta está viva e o devolve no próprio objeto de bounds (`selection.centroid`), então `_getSelectionAreaCentroid` e `_centroidTargetForSelection` deixaram de existir e Paste, Align e multi-bolhas leem o mesmo campo. Tempo por página no harness: 494 s no run com tolerância 0,5 e leitura DOM, **294 s** depois — abaixo dos 313 s do run anterior, apesar de o contorno ser 25 vezes mais detalhado.

Resultado medido (`node scripts/lab/compareRuns.js 000-baseline 008-shared`):

| categoria | n | PASS 1% base → novo | \|dX\| med/p95 base → novo | \|dY\| med/p95 base → novo | recusas |
| --- | --- | --- | --- | --- | --- |
| normal | 26 | 12/26 → 12/26 | 2/9 → 2/**4** | 4/38 → 4/**17** | 0 |
| cut | 15 | 3/15 → **5**/15 | 3/66 → 3/**16** | 11/212 → **5**/**62** | 0 |
| leak | 24 | 0/24 → **2**/24 | 159/302 → **6**/**36** | 178/399 → **10**/**15** | 14 |

**GATE APROVADO**: nenhuma categoria regrediu na cauda e nenhum caso que já estava correto passou a ser recusado.

O ganho nos casos de balão duplo é o mais expressivo e não era esperado: dos 24, 14 são recusados e os 10 restantes agora erram 6 px em X e 10 px em Y na mediana, contra 159/178 px do motor original. Com o centroide lido corretamente, a região funde dois balões mas o centro de área da união ainda cai perto do balão onde o texto está, o que torna a partição por Voronoi desnecessária nesta amostra.

Runs: `006-nomap` (só o defeito 1 corrigido), `007-tol05` (defeitos 1 e 2), `008-shared` (os três, com a abertura compartilhada).

### Task 9 — regressão e gate (concluída)

`scripts/lab/compareRuns.js` compara dois runs usando as categorias e tolerâncias congeladas no `cases.json` do baseline, então mudar o motor não muda a régua. Reprova quando o p95 de qualquer categoria piora mais de 1 px ou quando um caso que estava correto passa a ser recusado.

Matriz medida, cada cenário com o motor original e o novo nas mesmas 10 páginas (65 camadas), sempre partindo do gabarito:

| cenário | base | novo | normal p95 dX/dY | cut p95 dX/dY | leak med dX/dY | gate |
| --- | --- | --- | --- | --- | --- | --- |
| resize OFF, padding 0 | `000-baseline` | `008-shared` | 9/38 → 4/17 | 66/212 → 16/62 | 159/178 → 6/10 | aprovado |
| resize ON, padding 0 | `000R-resize` | `009-resize` | 9/38 → 4/17 | 66/213 → 16/62 | 159/178 → 6/10,5 | aprovado |
| resize ON, padding 12 | `000R-pad12` | `010-resize-pad12` | 9/38 → 4/17 | 66/213 → 16/62 | 159/177,5 → 6/10,5 | aprovado |

Os runs `000R-*` foram medidos com o `host.js` do `HEAD` reinstalado temporariamente (cópia de segurança conferida por SHA-1 antes e depois; o working tree voltou idêntico) e usam a cópia do `cases.json` do baseline, porque a classificação vem da geometria da região e não muda com resize.

O padding praticamente não move o centro, e isso é esperado: ele altera o tamanho da caixa de texto, não o alvo. Conferido que chegou a ser aplicado — 4 das 65 caixas mudaram de largura entre `009-resize` e `010-resize-pad12` (por exemplo 911x259 para 761x259), e o resize mudou 43 caixas em relação ao run sem resize.

Teste: `scripts/testBalloonCentroid.js` (no `npm test`) cobre o centroide de polígono com entradas reais, o helper de posicionamento, e agora a leitura de âncoras por Action Manager: um documento a 144 dpi tem de devolver o dobro dos pontos e a conferência contra o DOM tem de recusar unidade divergente.

### Tarefas 12 e 13 — o fluxo real do painel: seleção viva, offset do TextShapeR e nenhuma recusa (concluídas)

O usuário reportou que, no painel, praticamente todos os balões iam **muito para a esquerda**, alguns saindo do balão, e que alguns respondiam "No selected area.". As três medições anteriores não pegaram nada disso porque o harness chamava `alignTextLayerToSelection({resizeTextBox, padding})` **sem seleção viva e com `phantomOffsetX = 0`**, enquanto o uso real tem seleção ativa e TextShapeR inline ligado.

**Causa do desvio: correção dupla.** O botão Align do painel envia `phantomOffsetX = geometry.offsetX * larguraDoBalão` (`previewBlock.jsx`, `handleAlignLayer`), com `offsetX = centerX - 0.5` (`textShapeR.js`, `getShapeProfileGeometry`). É a compensação horizontal para o lado escondido de um balão cortado, calibrada contra o centro do **bbox**. Com o alvo virando o centroide, que já carrega essa assimetria, as duas correções somavam. Medido nos 65 balões com offset de 15% da largura: o motor original erra **72 px de mediana em X** (0/26 acertos nos normais); o corrigido fica em **2 px** (12/26). A correção ficou no ponto compartilhado `_positionLayerWithinSelection`: o offset só se aplica quando não há alvo naquele eixo, então Paste, Align e multi-bolhas herdam a regra.

**Recusa removida.** `_regionIsImplausibleBalloon` e `_regionHoldsOtherTextLayer` saíram: o Align nunca mais devolve `noSelection` depois de achar uma região. Ficaram apenas as guardas de custo, que desistem de traçar o contorno e caem no centro do bbox sem recusar a ação.

**Vazamento da varinha, sem recusar.** Sem a recusa, dois casos voltaram a ser catastróficos: `0010#6` (0 px no original, 1370 px com o novo motor) e `0010#7` (1452 px nos dois). Ambos têm região cobrindo **33% da página**, contra no máximo 6,2% em todos os outros 63 casos — o flood fill escapou do balão por uma falha no contorno. Em vez de recusar, a seleção é estreitada para a vizinhança do texto: a caixa da tinta crescida em 50% da própria largura e altura de cada lado, intersectada com o que já estava selecionado (`_narrowSelectionToTextNeighbourhood`). Medido offline nas máscaras, essa margem leva os dois casos de 1370 px e 1452 px para **12 px e 1 px**; margens maiores (100% e 150%) pioram de novo, porque a caixa volta a alcançar a arte engolida.

Resultado medido em cinco cenários, cada um contra o motor original no mesmo cenário:

| cenário | runs | normal p95 dX/dY | cut p95 dX/dY | leak mediana dX/dY | recusas | gate |
| --- | --- | --- | --- | --- | --- | --- |
| sem seleção viva, resize OFF, padding 0 | `000-baseline` × `016-narrow` | 9/38 → 4/17 | 66/212 → 16/62 | 159/178 → 20/12 | 0 | aprovado |
| sem seleção viva, resize ON, padding 0 | `000R-resize` × `017-narrow-resize` | 9/38 → 4/17 | 66/213 → 16/62 | 159/178 → 20/12 | 0 | aprovado |
| sem seleção viva, resize ON, padding 12 | `000R-pad12` × `018-narrow-pad12` | 9/38 → 4/17 | 66/213 → 16/62 | 159/177,5 → 20/12 | 0 | aprovado |
| seleção viva, offset 0 | `000L-live` × `019-narrow-live` | 7/38 → 4/17 | 66/113 → 16/62 | 130/130 → 133/73 | 0 | aprovado |
| seleção viva, offset 15% da largura | `000L-live-phantom` × `020-narrow-live-phantom` | 100/38 → 4/17 | 177/113 → 16/62 | 101/130 → 136/73 | 0 | aprovado |

Nos balões que o usuário citou, com seleção viva e offset de 15%, o erro do motor original contra o corrigido: "…came back from 17 years" 88/−2 → **−2/−4**; "Don't tell me…" 38/−3 → **−2/−1**; "…connected to the Eisenhood family?" 115/6 → **0/13**; "Let those kids die…!" 98/−77 → **2/−39**. O balão "That's…" da 0003 continua ruim (−243/396): é um caso de balão duplo, que o usuário decidiu deixar errado por ora.

**Modo novo do harness.** `runMeasure.ps1` ganhou `-LiveSelection` e `-PhantomRatio`: a seleção do balão é criada antes do Align (varinha no centro da tinta com a camada oculta) e o offset é expresso como fração da largura da região, do mesmo jeito que o painel expressa. Era o furo que deixou o defeito passar.

**Pendência medida.** Estreitar também a seleção que o usuário desenhou (guarda fora do braço da varinha) melhora muito o eixo Y nos casos de vazamento — p95 de dY de 1370 px para 349 px — mas deixa X no offset fantasma (410 px), porque a seleção estreitada volta **sem centroide**, e isso ainda não foi explicado. O gate reprovou por esses 21 px em X, então a mudança foi revertida e fica registrada aqui. Investigar exige um diagnóstico que **não** trace a região vazada: traçá-la com tolerância 0,5 e ler as âncoras pelo DOM travou o Photoshop por mais de uma hora (`diagCentroid.jsx` agora recusa esse caso, como o host já fazia).

### Tarefa 14 — por que o centroide desaparecia depois de estreitar a seleção (concluída)

A pendência da Tarefa 13 era esta: estreitar a região vazada acertava o eixo Y e deixava o X preso no offset fantasma, sinal de que a seleção estreitada voltava **sem centroide**. Depois de três rodadas de suposição, coloquei o host a **registrar o motivo** da desistência em `_hostState.centroidSkip` — barato, e foi o que resolveu. Duas causas, uma atrás da outra:

1. **Orçamento de âncoras obsoleto.** `_MAX_BALLOON_PATH_ANCHORS` valia 4 000, número calibrado para a leitura pelo DOM (5,7 ms por âncora, ou seja 23 s no limite). Com a leitura por Action Manager o custo medido é ~13 µs por âncora: 10 740 âncoras em 2 059 subcaminhos custam 111 ms de leitura mais 29 ms de integração. A seleção estreitada em volta de arte engolida traça exatamente nessa ordem de grandeza, então o centroide — que estava a 10 px do gabarito — era descartado por uma guarda que já não fazia sentido. Novo teto: 30 000 âncoras, o que mantém o pior caso perto de 400 ms.

2. **Traçado vazio depois da abertura.** Com o teto corrigido, `centroidSkip` passou a acusar `anchors:0`. Medido com `scripts/lab/diagPathRef.jsx`, o motivo não era a referência do Action Manager: o work path saía **vazio no DOM também** (0 subcaminhos) quando traçado sobre a seleção aberta com raio 9, contra 2 059 subcaminhos e 10 740 âncoras na mesma seleção sem abrir. Uma malha de fiapos brancos em volta da arte, depois de contrair e expandir, deixa de fechar contorno no limiar de 50% que o `Make Work Path` usa. Correção: se a abertura não produzir centroide, tentar uma segunda vez sobre a seleção não aberta, que o canal temporário já tem guardada. O caso passou a devolver centroide em (396,4; 539,2) contra gabarito (406,5; 550,5) — 10 px.

Com isso o estreitamento vale para os dois caminhos, com seleção viva ou sem, como pedido. Resultado nos cinco cenários, cada um contra o motor original no mesmo cenário:

| cenário | runs | normal p95 dX/dY | cut p95 dX/dY | leak mediana dX/dY | PASS leak | recusas | gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sem seleção viva, resize OFF, padding 0 | `000-baseline` × `031-final` | 9/38 → 4/17 | 66/212 → 16/62 | 159/178 → 20/12 | 0 → 4 | 0 | aprovado |
| sem seleção viva, resize ON, padding 0 | `000R-resize` × `032-final-resize` | 9/38 → 4/17 | 66/213 → 16/62 | 159/178 → 20/12 | 0 → 4 | 0 | aprovado |
| sem seleção viva, resize ON, padding 12 | `000R-pad12` × `033-final-pad12` | 9/38 → 4/17 | 66/213 → 16/62 | 159/177,5 → 20/12 | 0 → 4 | 0 | aprovado |
| seleção viva, offset 0 | `000L-live` × `034-final-live` | 7/38 → 4/17 | 66/113 → 16/62 | 130/130 → 92/61 | 0 → 4 | 0 | aprovado |
| seleção viva, offset 15% da largura | `000L-live-phantom` × `035-final-live-phantom` | 100/38 → 4/17 | 177/113 → 16/62 | 101/130 → 92/61 | 0 → 4 | 0 | aprovado |

Os dois últimos cenários agora dão **os mesmos números**, o que é a evidência direta de que o offset fantasma é ignorado em todos os 65 casos quando existe alvo de centroide.

Ferramentas de diagnóstico do laboratório, todas fora do git: `diagCentroid.jsx` (passo a passo do centroide, hoje recusando região que cobre demais a página, porque traçá-la travou o Photoshop por mais de uma hora), `diagNarrow.jsx` (só o estreitamento), `diagNarrowCentroid.jsx` (o cálculo guarda por guarda) e `diagPathRef.jsx` (leitura do path por alvo contra por índice, contra o DOM).

## Próximos passos imediatos

1. **Task 7 precisa de amostra:** nenhuma das 10 páginas tem balão de grito (solidez ≥ 0,85 em todas). Sem pelo menos uma, a categoria fica sem medição.
2. **Balões duplos (fora do escopo atual):** não há mais recusa, então os 24 casos movem sempre. A mediana caiu de 159/178 px para 20/12 px, mas a cauda continua ruim (p95 136/159 px) e o balão "That's…" da 0003 erra 243/396 px. O caminho medido segue sendo a partição da região pela camada de texto mais próxima, que no laboratório derruba o erro mediano desses casos de 159/178 px para 12/26 px.

## Como reproduzir

```sh
# 1. medir o motor atual nos 10 PSDs (nunca escreve em psd/ ou true/)
npm run build
powershell -NoProfile -File scripts/lab/runMeasure.ps1 -Root "<raiz>" -Run 008-shared

# 2. consolidar e classificar
node scripts/lab/buildCases.js 008-shared
node scripts/lab/report.js 008-shared

# 3. comparar contra o baseline e aplicar o gate
node scripts/lab/compareRuns.js 000-baseline 016-narrow

# 4. procurar regra melhor sem abrir o Photoshop
node scripts/lab/scoreRules.js 000-baseline --jitter

# 5. medir o fluxo real do painel: seleção viva e offset do TextShapeR
powershell -NoProfile -File scripts/lab/runMeasure.ps1 -Root "<raiz>" -Run 020-narrow-live-phantom -LiveSelection -PhantomRatio 0.15

# 6. destrinchar um caso dentro do Photoshop, passo a passo
powershell -NoProfile -File scripts/lab/runDiag.ps1 -Root "<raiz>" -Run 000-baseline -Page "<nome do psd>" -Index 1
```

Runs guardados em `.centering-lab/runs/`. Motor original: `000-baseline` (sem resize), `000R-resize`, `000R-pad12`, `000L-live`, `000L-live-phantom`. Motor atual: `016-narrow`, `017-narrow-resize`, `018-narrow-pad12`, `019-narrow-live`, `020-narrow-live-phantom`. Os demais (`002` a `015`, `021`, `022`) são as etapas intermediárias descritas acima.

## Decisões e pendências

- O modo multi-bolhas entra na medição por uma via mais barata: como a marquee armazenada é desenhada pelo usuário e não existe no ground truth, o equivalente reproduzível é o bbox **cru** da região do balão (sem `adaptiveOpen`). Isso é calculado offline sobre as mesmas máscaras, comparando duas regras: `bboxCru` (multi-bolhas) e `bboxAposAbertura` (Align e Paste). A premissa fica registrada no relatório.
- A decisão de onde a regra final vai morar (host ou painel) depende do que ela exigir: regra que precisa da máscara vive no host; regra que precisa apenas do contorno pode viver no painel, com o host recebendo o centro. Definido após o ranking da Task 5, e em um único lugar — sem o gêmeo ES3/ES6 criado no PR #2.
