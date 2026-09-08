# Plano — centralização de texto em balões (TypeR)

Documento de trabalho. Atualizado a cada etapa concluída.

Última atualização: 2026-09-08, depois de a região deixar de desistir no primeiro par recusado, de o prefixo de cortes válidos parar de ser jogado fora, e de o corte parar de perguntar em que balão a fala está a uma caixa que o `resizeTextBox` já tinha movido.

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
| 15 | Regressão do multi-bolhas: a leitura do centroide roubava a marquee do usuário | concluída |
| 16 | Guardas de área dependiam da unidade da régua do usuário | concluída |
| 17 | Travamento e perda da seleção no multi-bolhas: o custo estava na abertura, não no traçado | concluída |
| 18 | Multi-bolhas morto fora de 72 dpi: unidade das âncoras e `undefined` no payload | concluída |
| 19 | Balões duplos: partir a região entre os textos que a compartilham | substituída pela Tarefa 20 |
| 20 | Balões duplos, múltiplos e quadros duplos: fechar cada balão de forma imaginária | concluída, com duas pendências medidas |
| 21 | Balão quádruplo e o balanço causado pela tinta das vizinhas | concluída, com uma pendência medida |
| 22 | A fala vizinha jogada por cima: a mordida que a tinta dela tira da região | concluída |
| 23 | Nível `overlap` na bancada: a página com uma fala em cima da outra | concluída |
| 24 | Impedir que a limpeza invente um corte que a página não sustenta | rejeitada, medida |
| 25 | Baseline e dataset exato com a geometria que o Align usou | concluída |
| 26 | H25-A/F: concavidade multi-escala | concluída, rejeitada |
| 27 | H25-B: busca global sobre conjuntos de cordas | concluída, rejeitada |
| 28 | H25-C/E: transformada de distância e concordância clean/dirty | concluída, rejeitada |
| 29 | H25-D: fixed-point e seleção final | concluída, resultado negativo (0/32) |
| 30 | Porte mínimo e gate real | encerrada sem porte |
| 31 | Balões redondos encadeados: a junção com uma cúspide só | concluída |
| 32 | O par atrás do mais curto, o prefixo válido, a caixa que o resize moveu e o teste de lado que não era pertencimento | concluída; aprovada nos seis cenários |

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

### Tarefa 15 — a leitura do centroide roubava a marquee do usuário (concluída)

O usuário reportou que, com o modo multi-bolhas ligado, uma seleção grande era desfeita pelo próprio plugin logo depois de ser desenhada. Isso é uma regressão introduzida pelo centroide: antes da Task 8 a captura em `getSelectionChanged` só abria a seleção (contrair/expandir sobre um canal temporário, sempre restaurado); agora ela também traça o contorno, e `Make Work Path` **consome a seleção**.

O `finally` de `_getAdaptiveOpenedSelectionBounds` restaurava a seleção do canal **antes** da segunda tentativa da Task 14 e removia o canal **depois** dela. Quando a primeira passagem não devolvia centroide, a segunda traçava outra vez — sobre a marquee do usuário — e ninguém a recolocava. Duas consequências: a marquee desaparecia e o poll seguinte lia o documento vazio como "o usuário desselecionou", o que também apagava o lote inteiro de bolhas guardadas.

Duas correções em `app_src/host.js`, ambas no ponto compartilhado:

1. **Restauração verificada antes de remover o canal.** Se não há seleção viva no fim, ela volta do canal. Conferir em vez de assumir cobre também a falha da primeira restauração, e vale para Paste, Align e multi-bolhas de uma vez.
2. **`_centroidRetryWorthIt`**: a segunda tentativa deixa de rodar quando a recusa não pode melhorar sem a abertura — região que cobre demais a página, work path do usuário e contorno acima do orçamento de âncoras (o traçado sem abertura tem no mínimo as mesmas âncoras). O caso da Task 14 (`anchors:0`, traçado vazio depois da abertura) continua repetindo, que é a razão de a segunda tentativa existir. Uma seleção grande estourava o orçamento nas duas passagens, então a repetição pagava dois traçados pela mesma recusa.

Medição no motor real, `scripts/lab/diagCapture.jsx` + `scripts/lab/runCapture.ps1` (novos): 20 formas e tamanhos de seleção por página — retângulos de 2% a 60% da página, retângulo com feather, laço serrilhado, faixa diagonal fina e moldura fina com bbox grande, varinha no fundo da página, varinha no balão, e os mesmos casos numa página redimensionada para o dobro. Cada caso roda a sequência real do painel: captura, captura repetida, `getCurrentSelectionShape` do TextShapeR inline e captura outra vez.

| caso | motor publicado (`35bcbbe`) | corrigido |
| --- | --- | --- |
| centroide aceito (todas as formas normais) | marquee viva, centroide devolvido | igual |
| região > 25% da página (`coversPage`) | marquee viva, sem centroide | igual, sem o traçado extra |
| centroide recusado **depois** de traçar (`anchors:` acima do orçamento) | **marquee destruída**, e as capturas seguintes devolvem `cleared` | marquee viva em todos os passos |

A recusa depois do traçado foi exercitada baixando `_MAX_BALLOON_PATH_ANCHORS` para 3 em runtime, porque nas 10 páginas de referência nenhuma seleção sintética chega às 30 000 âncoras: o que importa é que a marquee sobreviva a uma recusa, não o que causou a recusa. Sem isso o defeito não aparece — foi por isso que as cinco matrizes anteriores passaram.

Gate de centralização, cenário mais próximo do uso real (seleção viva, offset fantasma de 15% da largura), run `036-nosteal-live-phantom` contra o motor original `000L-live-phantom`:

| categoria | n | PASS base → novo | \|dX\| med/p95 | \|dY\| med/p95 | recusas |
| --- | --- | --- | --- | --- | --- |
| normal | 26 | 0/26 → 12/26 | 72/100 → 2/4 | 4/38 → 4/17 | 0 |
| cut | 15 | 0/15 → 5/15 | 46/177 → 3/16 | 11/113 → 5/62 | 0 |
| leak | 24 | 0/24 → 4/24 | 101/389 → 92/219 | 130/1370 → 61/349 | 0 |

**GATE APROVADO**, e os números são idênticos aos do run `035-final-live-phantom` documentado na Tarefa 14 (normal 4/17, cut 16/62, leak mediana 92/61, PASS leak 4). Era o resultado esperado por construção: a correção não toca no cálculo do centroide, apenas devolve a seleção e deixa de pagar um traçado que já ia ser recusado. 65 camadas, 0 erros de script, ground truth intacto.

Teste: `scripts/testBalloonCentroid.js` ganhou um teste de comportamento de `_getAdaptiveOpenedSelectionBounds` com um documento falso que modela o que o Photoshop faz (o canal guarda uma cópia, contrair/expandir movem as bordas, um traçado consome a seleção). Ele afirma que a marquee sobrevive a um centroide recusado, que o caso `anchors:0` ainda repete na seleção não aberta e que um contorno acima do orçamento não é traçado duas vezes. A checagem por regex sobre o texto-fonte que existia antes foi substituída por ele. Verificado que o teste **falha** no código anterior (`a refused centroid must not cost the user their selection`) e passa no corrigido.

### Tarefa 16 — as guardas de área dependiam da régua do usuário (concluída)

`doc.width` e `doc.height` do DOM vêm nas **unidades de régua ativas**, e dois pontos os comparavam com bounds em pixels:

- `_regionCoversTooMuchPage`: `docArea = parseFloat(doc.width) * parseFloat(doc.height)`. Com a régua em centímetros, uma página de 2700x3840 px reporta ~21x30, então a área da página vale ~650 em vez de 10,4 milhões e **qualquer** balão fica acima de 25% dela. Efeito medido: o contorno nunca era traçado, o centroide nunca existia e a centralização caía silenciosamente no centro do bbox — ou seja, todo o ganho das tarefas 8 a 14 ficava desligado para esses usuários.
- `_narrowSelectionToTextNeighbourhood`: `right = Math.min(Math.round(parseFloat(doc.width)), ...)`. Com a régua em centímetros o teto virava ~21, a caixa de estreitamento colapsava para os primeiros pixels da página e a função devolvia `null` (`right - left < 2`).

Correção: um helper único, `_getDocumentPixelSize(doc)`, que fixa `Units.PIXELS`, lê as dimensões e devolve a régua do usuário como estava (mesmo padrão que `_getMeasureBoxSpanPoints` já usava). Os dois pontos passam por ele, e o estreitamento só aplica o teto quando o tamanho é conhecido. `doc.resolution` não entra nisso: é sempre em pixels por polegada, independente da régua.

Medição no motor real (`runCapture.ps1`, caso `cm rulers: wand on balloon`, com `Units.CM` ativo durante a captura):

| motor | região do balão | resultado |
| --- | --- | --- |
| publicado (`35bcbbe`) | varinha no balão real, ~5% da página | `coversPage` — centroide recusado |
| corrigido | mesma região | centroide calculado |

Nesse cenário só a varinha é informativa: `_wandAt` endereça o documento em pixels explícitos, enquanto `doc.selection.select` recebe unidades de régua, então um retângulo sintético sairia microscópico e não acionaria guarda nenhuma.

Gate de centralização revalidado depois da mudança, run `037-units-live-phantom` contra `000L-live-phantom` (seleção viva, offset de 15%): normal 12/26 PASS, p95 4/17; cut 5/15, p95 16/62; leak 4/24, mediana 92/61; 0 recusas — **idêntico** aos runs `035` e `036`, como esperado, porque com a régua em pixels o helper devolve exatamente os mesmos números. 65 camadas, 0 erros.

Teste: `scripts/testBalloonCentroid.js` cobre `_getDocumentPixelSize` com um documento falso cuja largura muda conforme a régua ativa (deve devolver pixels com a régua em cm, restaurar a unidade do usuário e devolver `null` sem vazar a unidade quando a leitura falha) e `_regionCoversTooMuchPage` (um balão de 900x1200 numa página de 2700x3840 nunca é recusado; uma região de 2000x2000 continua sendo). Verificado que o teste falha quando a fixação da régua é removida.

### Tarefa 17 — o travamento e a perda da seleção: o custo estava na abertura, não no traçado (concluída)

O usuário reportou que o multi-bolhas trava o Photoshop por vários segundos ao capturar uma seleção, que a marquee some depois disso, e que um usuário chegou a ter crash. Repro: `crash/MUP_育成スキルはもういらない74話-1_2023~0005.psd`, dentro do objeto inteligente, varinha na calça preta do personagem do último quadro.

**A primeira medição mediu a coisa errada.** O contorno é o que as tarefas anteriores mediram, então foi por ele que comecei: `scripts/lab/diagLiveCost.jsx` traçava a seleção viva e contava as âncoras. Deu 4 âncoras e 0 ms — porque a região cobre a página inteira, `_regionCoversTooMuchPage` recusa, e o traçado **nunca roda**. O custo estava antes da guarda.

**Onde os segundos iam.** A abertura da seleção (contrair e expandir sobre um canal temporário) roda **antes** de qualquer guarda de custo, e o raio é 10% do menor lado da região, sem teto. A varinha que escapou pegou 6294x8716 de uma página de 6331x8882 — o interior do objeto inteligente tem 56 megapixels, contra 2700x3840 das 10 páginas de referência. Medido no motor publicado, nessa seleção:

| etapa | publicado | corrigido |
| --- | --- | --- |
| criar o canal temporário | 423 ms | não roda |
| Contract de 629 px | 2 708 ms, e **aniquila a seleção** | não roda |
| Expand de 629 px | falha: "o comando Expansão não está disponível" | não roda |
| `getSelectionChanged()` (o poll inteiro) | **5 982 ms** | **81 ms** |
| `getCurrentSelectionShape()` (TextShapeR inline) | **2 698 ms** | **62 ms** |

O Contract aniquilar a seleção é o que multiplica a conta: o laço tenta de novo com metade do raio (629, 314, 157, 78, 39, 19, 9, 4), recarregando o canal a cada volta. E o painel chama isso a cada evento de seleção mais um poll de segurança a cada 1,5 s: seis segundos de trabalho a cada segundo e meio é o Photoshop inutilizável que o usuário descreveu. O crash e a desseleção saem do mesmo lugar — o Photoshop mostra barra de progresso cancelável no Contract, e um Esc no meio aborta o script com a marquee já consumida e só guardada no canal temporário.

Correções, todas no ponto compartilhado:

1. **A guarda de área passou para antes da abertura** (`_getAdaptiveOpenedSelectionBounds`). `_openedSelectionCentroid` já ia recusar essa região; recusar depois significava pagar a abertura à toa. Devolve o bbox cru, que é o que o multi-bolhas guarda para essas regiões de qualquer jeito, e o Align estreita logo em seguida.
2. **Teto de raio de abertura**, `_MAX_SELECTION_OPEN_RADIUS = 96`. Conferido nos 65 casos de referência: toda região abaixo de um quarto da página abre com 85 px ou menos (mediana 52), e o único caso de 270 px é justamente o vazamento de 100% da página. O teto é no-op no que já foi calibrado e só impede o raio de seguir uma região que escapou numa página de alta resolução.
3. **O shape scan do TextShapeR também desiste de região que cobre a página**, caindo direto no perfil do bbox que `getCurrentSelectionShape` já usa como último recurso. Não há forma a amostrar ali, e amostrar custava 2 698 ms porque o traçado recusa e o amostrador legado então roda 21 operações de seleção em 56 megapixels.
4. **O orçamento de âncoras passou a ser gasto antes das âncoras** (`_readPathAnchorPolygons`). O tamanho de cada subcaminho é um tamanho de lista, então o contorno inteiro é medido sem materializar uma âncora sequer. Antes o orçamento era conferido pelo chamador **depois** da leitura que ele existe para proteger.
5. **Sem segundo traçado depois de uma recusa que já custou um traçado** (`_centroidRetryWorthIt`). Só o traçado vazio (`anchors:0`) ainda repete — é o caso da Tarefa 14, e a razão de a segunda tentativa existir. Todo o resto já pagou um traçado completo para ser recusado, e a seleção não aberta é a maior, não a menor.
6. **Canal órfão devolve a marquee** (`_recoverSelectionFromTempChannel`, chamado por `getSelectionChanged` antes de reportar `cleared`). O canal temporário só existe enquanto um leitor nosso está rodando, então encontrá-lo é prova de que o usuário não desselecionou: uma captura interrompida (Esc, erro de engine, crash) deixa de virar "o usuário apertou Ctrl+D" e o lote inteiro deixa de ser apagado. Um Ctrl+D de verdade não deixa canal, então limpar o lote continua funcionando.
7. **Painel:** o shape scan (`previewBlock.jsx`) passou a ir por `trackHostAction`, como todas as outras chamadas ao host, para o poll de multi-bolhas recuar enquanto ele roda em vez de enfileirar atrás dele.

Ferramentas novas do laboratório, fora do git: `scripts/lab/diagLiveCost.jsx` e `scripts/lab/runLive.ps1`, que medem etapa por etapa a seleção que o usuário está segurando no documento aberto, sem abrir nem fechar nada. Foi o que mostrou que o contorno não era o problema.

Gate de centralização revalidado no cenário mais próximo do uso real (seleção viva, offset fantasma de 15% da largura), run `038-cost-live-phantom` contra `000L-live-phantom`:

| categoria | n | PASS base → novo | \|dX\| med/p95 | \|dY\| med/p95 | recusas |
| --- | --- | --- | --- | --- | --- |
| normal | 26 | 0/26 → 12/26 | 72/100 → 2/4 | 4/38 → 4/17 | 0 |
| cut | 15 | 0/15 → 5/15 | 46/177 → 3/16 | 11/113 → 5/62 | 0 |
| leak | 24 | 0/24 → 4/24 | 101/389 → 92/219 | 130/1370 → 61/349 | 0 |

**GATE APROVADO**, com os números **idênticos** aos runs `035`, `036` e `037`. Era o resultado esperado por construção: nenhuma dessas correções toca no cálculo do centroide, elas apenas deixam de pagar por trabalho que ia ser descartado. 65 camadas, 0 erros de script, ground truth intacto.

Testes: `scripts/testBalloonCentroid.js` ganhou o teto de raio, o caso "região que cobre a página não custa canal, nem contração, nem traçado", a recusa do orçamento sem ler âncora nenhuma, a inversão do retry, e o comportamento do canal órfão (devolve a marquee e remove o canal; sem canal, continua reportando `cleared`). `scripts/testSelectionOpening.js` ganhou o teto. Verificado que falham no código anterior.

### Tarefa 18 — multi-bolhas morto em página fora de 72 dpi (concluída)

O usuário reportou que, num PSD cuja resolução não é 72 dpi, o multi-bolhas não guarda nada: o contador **nem chega a 1**, "como se estivesse desligado", e a colagem cria só a primeira fala — consequência, não causa, já que `_createTextLayersInStoredSelections` cola `min(texts, selections)`.

Repro do usuário: `bug/月の子_02_009-010.psd`, 1680x1280, grayscale, **300 dpi**, varinha mágica, TextShapeR inline desligado. As 5 matrizes das Tarefas 8 a 17 nunca pegaram isso porque as 10 páginas de referência são todas 72 dpi: a resolução do documento jamais variou no harness.

Medição (`scripts/lab/diagMultiBubble.jsx` + `runMultiBubble.ps1`, novos: caçam balões por varinha numa grade, capturam quatro em sequência **sem** resetar o monitor entre eles — como o painel faz — e imprimem a string crua que o host devolve, mais o veredito da régua do painel). Controle: o mesmo arquivo com a resolução trocada para 72 dpi no bloco de recursos do PSD, byte a byte igual no resto, então o diferencial isola a resolução e nada mais.

| página | balões capturados | armazenados pelo painel | `centroidSkip` |
| --- | --- | --- | --- |
| 300 dpi (motor `3bd1543`) | 4 | **0** | `unitMismatch` nos 4 |
| 72 dpi (mesmo motor, mesmos pixels) | 4 | 4 | vazio nos 4 |

A resposta crua do host a 300 dpi, nas quatro capturas:

```
{ "error": true, "message": "getSelectionChanged inner error: [jamJSON.stringify] Invalid JSON on line 1", "shiftKey": false }
```

Dois defeitos em série, os dois medidos:

1. **A unidade das âncoras era suposta, não lida.** `_readPathAnchorPolygons` multiplicava toda âncora por `resolution / 72` porque o Action Manager "reporta pontos". Medido em Photoshop 27.9 (`scripts/lab/diagAnchorUnits.jsx`, novo): a mesma âncora vale `1082,24` no DOM e `1082,24` no Action Manager, com `unitDoubleType = pixelsUnit` — **já são pixels de documento**. A 300 dpi a escala suposta era 4,17, `_pathAnchorsMatchDom` recusava o contorno (`unitMismatch`) e nenhum balão fora de 72 dpi jamais produzia centroide. Correção: ler o tipo de unidade do descritor uma vez por contorno e só aplicar a escala de resolução quando ela não for `pixelsUnit` — um host que realmente reporte pontos continua funcionando.

2. **`undefined` no payload derruba a captura inteira.** `jamJSON.stringify` **não** é `JSON.stringify`: valor `undefined` cai no `default:` do `str()` e lança `[jamJSON.stringify] Invalid JSON`, em vez de omitir a chave. A captura escrevia `centroidX: undefined` sempre que não havia centroide, então **qualquer** recusa de centroide transformava a resposta inteira em `{error: true}` — e o painel (`utils.js:831`) descarta erro em silêncio. É por isso que o sintoma foi "o multi-bolhas está desligado" e não "o texto centralizou torto". Correção: a chave só é escrita quando existe centroide. Isso vale para todas as recusas (`coversPage`, work path do usuário, orçamento de âncoras), não só para a de unidade.

3. **Painel:** `checkForSelectionChange` era a única chamada ao host sem rede de segurança — um callback CEP perdido deixava `selectionCheckPending` levantado para sempre e o modo morria em silêncio até remontar o painel. Agora a pendência expira nos mesmos 15 s que `trackHostAction` já usa, e um erro do host vai ao console em vez de sumir.

Resultado no motor corrigido, mesmas duas variantes: **4 de 4 balões armazenados nas duas**, `centroidSkip` vazio, marquee viva em todas as capturas, e os centroides a 300 dpi **idênticos** aos de 72 dpi ao pixel (1123,103 / 1421,173 / 1516,123 / 553,226).

Gate de centralização revalidado nas 10 páginas de referência, cenário mais próximo do uso real (seleção viva, offset fantasma de 15% da largura), run `041-dpi-live-phantom` contra `000L-live-phantom`:

| categoria | n | PASS base → novo | \|dX\| med/p95 | \|dY\| med/p95 | recusas |
| --- | --- | --- | --- | --- | --- |
| normal | 26 | 0/26 → 12/26 | 72/100 → 2/4 | 4/38 → 4/17 | 0 |
| cut | 15 | 0/15 → 5/15 | 46/177 → 3/16 | 11/113 → 5/62 | 0 |
| leak | 24 | 0/24 → 4/24 | 101/389 → 92/219 | 130/1370 → 61/349 | 0 |

**GATE APROVADO**, números **idênticos** aos runs `035`, `036`, `037` e `038` — esperado por construção: as páginas de referência são 72 dpi, onde a escala suposta valia 1 e o centroide sempre existia, então nenhuma delas passa pelos dois caminhos corrigidos. 65 camadas, 0 erros de script, `psd/` e `true/` intactos por SHA-1.

Testes: `scripts/testBalloonCentroid.js` ganhou (a) âncoras em `pixelsUnit` num documento a 300 dpi, que não podem ser reescaladas, e (b) o comportamento de `getSelectionChanged` com um serializador que rejeita `undefined` como o do host: sem centroide a captura tem de chegar ao painel sem a chave e sem erro; com centroide as duas coordenadas viajam. Verificado que os dois falham no motor anterior — o (b) devolve exatamente o `{"error":true,...}` que o usuário via.

### Tarefa 19 — a região partida entre os textos que a compartilham (substituída)

A primeira tentativa contra o balão duplo semeava a partição com as caixas de tinta **das outras camadas de texto**: cada texto recebia sua célula da região por BFS multi-origem, e a camada ativa era centralizada na dela. Medida nas 14 páginas de referência, ela melhorava `texts:2` e `texts:3+` e não mexia em `texts:1`.

O usuário instalou e reprovou. O sintoma decisivo: **o alvo mudava a cada vez que ele apertava Align**. Muda porque a regra lê a posição atual das vizinhas, e as vizinhas se movem conforme vão sendo alinhadas.

E o laboratório nunca teria visto isso. Nas 14 páginas de referência as outras camadas estão **exatamente no ground truth** — a página já foi diagramada por um profissional —, e só a camada ativa era deslocada pelo offset fantasma. A Tarefa 19 foi medida com as vizinhas perfeitamente posicionadas, que é o oposto do fluxo real: o tipógrafo joga todas as falas de qualquer jeito dentro dos balões e só depois manda alinhar uma a uma.

Três coisas boas ficaram dela e continuam valendo: o contorno traçado guardado em `_hostState.lastOutline` com a chave da seleção; o eixo de topologia (`texts:1|2|3+`) no laboratório; e o conserto do harness que deixava cada camada medida escondida (visíveis iam 9, 8, 7 … 1 ao longo da página). O resto do código foi removido.

### Tarefa 20 — fechar cada balão de forma imaginária (concluída, com duas pendências medidas)

**A regra.** Dois convexos sobrepostos se encontram em exatamente **duas cúspides** — os pontos onde um contorno mergulha para dentro do outro — e a corda entre elas é a linha que fecharia cada balão sozinho. O motor reamostra o contorno já traçado em 400 pontos igualmente espaçados, mede o ângulo de virada num vão de 1/24 do contorno, junta os cantos côncavos fortes e corta pela **corda mais curta** entre dois deles. O texto fica com o lado em que está.

Mais curta, não mais funda. Numa região de quatro balões as duas cúspides mais fundas podem pertencer a junções diferentes, e a corda entre elas atravessa um balão em vez de passar entre dois: medido, trocar "mais funda" por "mais curta" derruba o erro vertical das regiões de quatro balões de 14/91 px para 6/22 px e para de disparar em balão simples.

**Nada disso lê onde estão as outras camadas.** É o ponto: o alvo passa a depender só da forma da região e da camada que está sendo centralizada, então apertar Align duas vezes cai no mesmo pixel.

**O laboratório teve que ser consertado antes.** `measureCentering.jsx` ganhou `-Scatter none|mid|full`, que joga cada fala para um lugar pseudoaleatório determinístico dentro do próprio balão antes do Align, e uma segunda passada do Align para medir idempotência. Três defeitos apareceram no caminho:

1. **A cerca errada.** Bagunçar dentro do bounding box da região joga a fala dentro do balão vizinho quando a região funde dois — e aí nenhuma regra pode acertar, porque o ground truth diz um balão e a página diz outro. O limite passou a ser um quarto da distância até a fala mais próxima.
2. **A semente do sorteio vinha do caminho do arquivo**, que muda de pasta a cada run, então a mesma página era bagunçada de um jeito na base e de outro no candidato. Passou a vir do nome do arquivo.
3. **ExtendScript fecha um literal de regex na primeira barra sem escape, mesmo dentro de uma classe de caracteres**, então `/^.*[\\/]/` matou quatro runs inteiras. O basename é extraído na mão.

**Resultado medido.** Base: o motor publicado (`develop`), mesmo sorteio de bagunça, seleção viva e offset fantasma de 15%.

Página arrumada (`070-tidy` × `078-tidy`):

| topologia | n | \|dX\| med/p95 | \|dY\| med/p95 | PASS |
| --- | --- | --- | --- | --- |
| texts:1 | 56 | 2/11 → 2/11 | 4/33 → 4/33 | 24 → 24 |
| texts:2 | 30 | 22/136 → **11/81** | 12/159 → **7/61** | 4 → 6 |
| texts:3+ | 12 | 96/152 → **44/74** | 22/59 → **19/49** | 0 → 0 |

Bagunça moderada (`075-mid` × `078-mid`):

| topologia | n | \|dX\| med/p95 | \|dY\| med/p95 | PASS |
| --- | --- | --- | --- | --- |
| texts:1 | 56 | 2/11 → 2/11 | 4/34 → 4/34 | 24 → 24 |
| texts:2 | 30 | 38/189 → **19,5/161** | 42/158 → **15,5/79** | 3 → 5 |
| texts:3+ | 12 | 101/226 → **67/194** | 18/60 → 17,5/**106** | 0 → 0 |

Bagunça total, o fluxo real (`075-full` × `078-full`):

| topologia | n | \|dX\| med/p95 | \|dY\| med/p95 | PASS |
| --- | --- | --- | --- | --- |
| texts:1 | 56 | 2/11 → 2/11 | 4/33 → 4/33 | 22 → 22 |
| texts:2 | 30 | 48/138 → **16,5/120** | 38/174 → **14**/174 | 5 → 6 |
| texts:3+ | 12 | 94/220 → **59,5/121** | 16/52 → **13,5/45** | 0 → 0 |

Por forma, `normal`, `cut` e `scream` ficam **idênticos** nos três níveis; toda a diferença cai em `leak`, que é onde o balão duplo é classificado. 0 recusas novas. O corte dispara em 16 a 19 das 98 camadas e em **nenhuma** das 56 de um texto só.

**Duas pendências, medidas e não escondidas:**

- Com bagunça moderada, o p95 de `dY` em `texts:3+` vai de 60 para 106 px, por causa de dois casos da página `11` e `13` em que o corte devolve metade de uma região de quatro balões e o centro dessa metade não é o centro de balão nenhum.
- Com bagunça total, `11#2` passa a se mover 60/151 px quando o Align é apertado de novo: o primeiro Align o leva para o outro lado da corda e o segundo corta diferente. Nas outras 97 camadas a segunda passada não move nada — e as 4 camadas que já se mexiam (`0010#6/#7`, `育成…0007#3/#4`) se mexiam igual no motor publicado, porque a região em si muda depois do primeiro movimento.

**Alternativas medidas e rejeitadas:**

| alternativa | veredito |
| --- | --- |
| semear com as caixas das outras camadas (Tarefa 19) | rejeitada: depende de a página já estar diagramada e move o alvo a cada Align |
| watershed na transformada de distância, com a célula da camada ativa | rejeitada: parte 23 a 31 dos 56 balões simples e piora `texts:1` |
| fundir lobos pelo colo (saddle) | rejeitada: em balões sobrepostos o corredor é tão largo quanto o menor dos dois, e a partir de 0,75 funde tudo num lobo só |
| dois cortes por região | rejeitada: sobre as 24 camadas de quatro balões, todo caso em que o segundo corte mordeu de verdade saiu pior; `texts:2` também piora (p95 de `dX` 105 → 161) |
| corda entre as duas cúspides mais fundas | rejeitada: p95 de `dY` em `texts:3+` 45 contra 121 px a favor da corda mais curta |
| um corte, cúspides mais fundas, sem guarda cumulativa | rejeitada: dois cortes legais de um sexto cada deixam um quadragésimo da região, e foi exatamente o que quebrou `13#1` e `14#2` |

**Guardas.** Sem corte, cai no centroide de hoje e nunca recusa: menos de dois cantos côncavos fortes em lados opostos; o pedaço fica abaixo de 15% ou acima de 85% da região; o centro cai fora do contorno; ou não há contorno. `Paste` e multi-bolhas não mudaram.

### Tarefa 21 — três cordas por região, e a tinta das vizinhas medida (concluída, com uma pendência medida)

O usuário instalou a Tarefa 20 e apontou duas coisas: o balão quádruplo da `11.psd` continuava ruim, e **o alvo ainda se movia conforme a fala vizinha mudava de lugar**, menos que antes. A hipótese dele — *"talvez se o texto do balão vizinho invadir o que ele considera parte do outro balão ele usa o texto em conta"* — estava certa, por um caminho que não é o das coordenadas.

**O motor não lê mais onde as vizinhas estão, mas lê a tinta delas.** O Align esconde só a camada que centraliza, então os glifos de todas as outras estão pintados quando a varinha amostra a página: a tinta delas não faz parte da região, e a abertura erode em volta desses buracos. Medido com a camada ativa parada e só as vizinhas mudando de lugar, sobre as 38 camadas que dividem região: **a resposta anda 81 px de mediana e 228 px no p95 em X** (66/297 em Y), e o corte liga e desliga — em vários casos ele dispara em 2 de 7 posicionamentos das vizinhas e não nos outros 5.

**A cura foi medida e rejeitada pelo custo.** Amostrar o balão com todas as camadas de texto escondidas (um `Hide` em lote, uma varinha, um `Show` em lote, sem segundo `Make Work Path`) custou **861,5 s contra ~250 s nas mesmas 14 páginas, 3,4×** — muito acima do teto de 15% combinado com o usuário — e, medido na página arrumada, **não mudou os números**: `texts:2` ficou em 11/81 px e `texts:3+` em 45/74 px, iguais aos do motor sem ela. Alternar a visibilidade força o Photoshop a recompor a imagem mesclada da página inteira duas vezes por Align. Revertida.

**O que entrou é barato e resolveu boa parte:** a região passa a aceitar **até três cordas** em vez de uma. Uma região de quatro balões precisa de três cortes para deixar um balão sozinho, e o segundo e o terceiro só são seguros porque a corda é a **mais curta** entre duas cúspides fortes, não a mais funda — com a corda mais funda, medido antes, o segundo corte atravessava um balão em vez de passar entre dois.

O número saiu de uma varredura sobre a região que o motor realmente vê — vizinhas pintadas, ativa escondida, abertura aplicada —, com 275 amostras de região de um texto e 60 de quatro: de uma corda para três, a mediana de `|dX|` das regiões de quatro balões cai de 34 px para 14 px, o balão simples continua em 2/11 px e **continua sendo cortado zero vezes**, e a região de dois textos não se mexe. Uma quarta e uma quinta corda não mudam nada.

**Resultado medido** (base: o motor publicado do `develop`, mesmo sorteio de bagunça, seleção viva e offset fantasma de 15%):

| nível | topologia | n | \|dX\| med/p95 | \|dY\| med/p95 | PASS |
| --- | --- | --- | --- | --- | --- |
| arrumada | texts:1 | 56 | 2/11 → 2/11 | 4/33 → 4/33 | 24 → 24 |
| arrumada | texts:2 | 30 | 22/136 → **11/70** | 12/159 → **8/61** | 4 → 6 |
| arrumada | texts:3+ | 12 | 96/152 → **19/61** | 22/59 → **8**/71 | 0 → 1 |
| moderada | texts:2 | 30 | 38/189 → **16/161** | 42/158 → **15,5/79** | 3 → 5 |
| moderada | texts:3+ | 12 | 101/226 → **28/194** | 18/60 → **16,5**/90 | 0 → 0 |
| total | texts:2 | 30 | 48/138 → **13/120** | 38/174 → **14**/174 | 5 → 7 |
| total | texts:3+ | 12 | 94/220 → **52/121** | 16/52 → **7,5**/105 | 0 → 0 |

`texts:1` fica idêntico nos três níveis. `normal`, `cut` e `scream` idênticos. 0 recusas.

A `11.psd`, que era a queixa: `#2` sai de 74/−49 px para **10/7 px** na página arrumada.

**Custo: nenhum.** Medido na mesma sessão, alternando as duas builds na mesma página: três cordas 79,8 s e 71,9 s, uma corda 83,1 s. As cordas extras são aritmética sobre 400 pontos reamostrados.

**Pendência: o p95 de `dY` em `texts:3+` piora** — 59 → 71 px na arrumada, 60 → 90 na moderada, 51,5 → 104,5 na total. Sempre um caso por nível, sempre a mesma região: os quatro balões da `11.psd` se sobrepõem tanto que a união é quase convexa (solidez 0,92), e lá as cordas são chute. Uma guarda exigindo que o pedaço ainda comporte a caixa de tinta foi medida e não separa os casos bons dos ruins.

**Segurança do multi-bolhas.** A amostragem sem texto foi revertida, então nada do caminho do monitor mudou; o corte continua sendo aritmética sobre o contorno já traçado, e `getSelectionChanged`, o `Paste` e o `Paste` em seleções guardadas não chamam nada dele. O `_hostState.lastOutline` continua sendo um contorno só, com a chave da seleção de que veio.

### Tarefa 22 — a mordida que a tinta da vizinha tira da região (concluída)

O usuário mandou um print: moveu o "if you" da `0029` para bem em cima da fala de baixo, apertou Align nela, e o texto foi parar fora do balão. A leitura dele — *"claramente ainda está sendo usado as outras falas para centralizar o balão"* — está certa, e o caminho é o da tinta, não o das coordenadas.

**Correção da Tarefa 21.** Lá ficou escrito que amostrar sem texto custa 3,4× e não muda nada. As duas metades estão erradas para o que se mede aqui: os 3,4× eram de uma versão que escondia **todas** as camadas da página em **toda** chamada e ainda fazia uma varinha e um traçado a mais; e o "não muda nada" foi medido na página arrumada, que é exatamente a página onde nenhuma fala está por cima de outra. Nas 14 páginas de referência com uma vizinha jogada em cima de cada fala, o motor da Tarefa 21 erra assim:

| página | erro somado das falas | pior caso |
| --- | --- | --- |
| `0029` (6 falas) | 1218 px | 411 px |
| `11.psd` (11 falas) | 1755 px | 501 px |

As mesmas páginas, sem nada por cima, centralizam **tudo dentro de 25 px**. O defeito é inteiramente causado pela vizinha.

**O mecanismo é a mordida, não a sondagem.** A varinha amostra a imagem mesclada com só a camada ativa escondida. Onde a tinta da vizinha cruza a borda do balão, ela arranca um pedaço da região, e o centro do que sobra não é o centro do balão. Medido na `0029` com a região do motor gravada em telemetria: as falas 3, 4 e 5 recebem uma região com **a mesma caixa** de antes (429×681 contra 433×681) e um alvo 174 px e 188 px deslocado. Não é a varinha caindo no glifo — isso também acontece, e é o que leva a fala 1 a 411 px, mas é o caso menor.

**Cinco mecanismos foram medidos:**

| tentativa | invasora (`0029`/`11`) | laboratório |
| --- | --- | --- |
| motor da Tarefa 21 | 1218 / 1755 px | referência |
| sondar em cinco pontos da caixa do texto | 1218 / 1755 px | sem regressão, ganho marginal |
| esconder todas as falas da página | — | funde balões: p95 de `\|dX\|` de 70 para 207 px |
| devolver a tinta da vizinha à seleção | 658 / 472 px | mediana das regiões compartilhadas de 13 para 29 px |
| devolver só a tinta dentro da caixa do texto | 831 / 1082 px | conserta pouco |
| esconder só as sobrepostas, com trava por tamanho | 77 / 100 px | trava nunca dispara; uma fala vai 913 px para o balão errado |
| esconder só as sobrepostas, com trava por centroide | **77 / 101 px** | um caso pior em 98, página arrumada idêntica |

**O que ficou.** Antes da varinha, o motor lista as camadas de texto **cuja tinta se sobrepõe à caixa desta fala** — só essas, nunca a página inteira. Esconde essas, inunda o balão de novo, e compara as duas regiões. A região limpa só é aceita se **o centro dela ficar mais perto da fala** do que o centro da região suja: devolver uma mordida sempre puxa o centro na direção do texto, porque a mordida está onde o texto está, enquanto atravessar para o balão vizinho empurra o centro para dentro de um balão em que esta fala não está.

**A trava precisou de três tentativas, e as duas primeiras falharam por motivo medido.** Comparar a área crua não funciona: onde dois balões se tocam, a inundação suja **já pega os dois**, e é a abertura morfológica que os separa depois, porque a tinta da vizinha estreita a passagem entre eles. As duas regiões têm a mesma caixa até o pixel — a telemetria leu 788544 contra 788544 enquanto a fala ia 913 px para o balão errado. Comparar a área **depois da abertura** também não funciona, pelo mesmo motivo: 664×1183 nas duas. Só o centro se move, e por isso é o centro que é comparado.

**Cinco pontos de sondagem** entraram junto e continuam: se o ponto do meio da caixa cair num glifo alheio, a varinha pega o traço e o preenchimento foge pela arte; os outros quatro ficam nos quartos da caixa. Uma região que não contenha o próprio texto, ou que cubra página demais, é descartada. Quando o ponto do meio funciona — a página normal — o laço para ali, e o custo continua sendo **uma** varinha.

**Ferramenta nova.** `scripts/lab/diagInvader.jsx` e `runInvader.ps1`: para cada fala da página, movem a vizinha mais próxima até o centro dela, apertam Align, e comparam com um passe de controle na página intacta. Sem esse controle não dá para saber se o erro veio da invasora ou se a página já o tinha — foi ele que mostrou que a `0029` erra 411 px com invasora e 7 px sem.

O laboratório também ganhou `_hostState.lastAlignRegion` e `_hostState.probe` em telemetria: a região que o motor de fato usou e por que a sondagem parou onde parou. Sem elas, uma fala que caiu no balão errado é indistinguível de uma que pegou o balão certo e errou o centro — foi o que travou o diagnóstico por três rodadas.

**Resultado medido** (base: o motor da Tarefa 21, sem marquee — que é como o usuário aperta o botão; as duas builds medidas na mesma sessão, uma atrás da outra):

Nível `overlap`, que é o defeito relatado — a vizinha mais próxima em cima de cada fala:

| topologia | n | \|dX\| med/p95 | \|dY\| med/p95 | PASS |
| --- | --- | --- | --- | --- |
| texts:1 | 56 | 5/116 → **2/11** | 14/250 → **4/17** | 9 → **24** |
| texts:2 | 30 | 55/325 → **5/106** | 80/581 → **6/70** | 5 → **11** |
| texts:3+ | 12 | 5/356 → 11/**128** | 0/96 → 5/**34** | 1 → 2 |
| scream | 2 | 501/501 → **8/8** | 111/111 → **6/6** | 0 → 1 |

A limpeza dispara em 73 das 98 camadas, a trava recusa em 21, e nenhuma chamada lança. `texts:3+` tem a mediana um pouco pior e a cauda muito melhor: 356 → 128 px em `dX` e 96 → 34 px em `dY`.

Nível `full`, onde nada fica em cima de nada: **sem regressão**. `texts:1` e `texts:3+` idênticos, `texts:2` de 13 para 11 px de mediana, `leak` de 17/13,5 para 16,5/12. Uma camada a mais se move na segunda apertada, 1 px. Só 2 das 98 camadas têm sobreposição suficiente para acionar a limpeza, e a trava recusa as duas — por isso a página arrumada e a bagunçada não mudam.

**Custo: +2,2%** — 668,7 s contra 654,1 s. Medir entre sessões nesta máquina não vale nada: a mesma build mediu de +2% a +24% conforme a sessão, e uma corrida chegou a medir **mais** tempo fazendo **menos** trabalho.

Três coisas trouxeram o custo para lá:

- **A decisão saiu da varinha e foi para o Align.** Abrir as duas regiões dentro da varinha custava duas aberturas por camada sobreposta, e a abertura é a metade cara do caminho. O Align já abre a região suja; a varinha entrega só o candidato limpo, já aberto, com a distância dele e com o contorno traçado junto.
- **A limpeza só roda quando duas falas se cobrem de verdade**, em pelo menos 25% da caixa **menor** das duas. Menor, não a própria: uma fala curta jogada sobre uma longa cobre 3% da caixa longa e quase toda a caixa dela mesma, e a mordida é igualmente ruim nos dois sentidos.
- **A varredura de camadas é por Action Manager**, um descritor por camada em vez de uma ida ao DOM por propriedade. Ela roda em toda chamada do Align.

### Tarefa 23 — o nível `overlap` na bancada (concluída)

`-Scatter overlap`, ao lado de `none|mid|full`. Os três primeiros cercam cada fala dentro do próprio balão de propósito: uma fala jogada no balão do lado não tem ground truth alcançável, e o número não significaria nada. Só que essa mesma cerca faz com que **nenhum deles jamais ponha uma fala em cima de outra**, que é o que o tipógrafo faz antes de apertar Align — e foi por isso que a mordida da Tarefa 22 passou despercebida por duas tarefas inteiras.

O `overlap` faz o inverso: a fala que está sendo centralizada **fica em casa**, onde o ground truth dela vale, e a vizinha mais próxima é movida para cima dela, uma de cada vez. É o `diagInvader.jsx` promovido a nível medido, então o defeito passa a reprovar o gate em vez de viver num diagnóstico solto.

Nada muda para as corridas antigas: o `compareRuns` sempre compara corrida contra corrida no mesmo nível, e `none`, `mid` e `full` continuam idênticos.

**E ele se pagou no primeiro uso.** Pegou um motor quebrado que `none` e `full` tinham dado como aprovado: a reescrita da varredura para Action Manager apagou `_distanceFromCentroid` junto com o bloco que ela substituiu, e **a limpeza vinha lançando exceção em toda chamada havia três corridas**. Como o `catch` só zerava o candidato, o resultado era indistinguível de um balão que não precisava de limpeza — `none` e `full` mediram "sem regressão" porque o motor tinha silenciosamente parado de trabalhar. Duas defesas novas nos testes: toda função que a sondagem chama tem que existir, e uma exceção na limpeza tem que ser **registrada**.

### Tarefa 24 — impedir que a limpeza invente um corte (rejeitada, medida)

No nível `overlap`, `texts:3+` ficou com a mediana pior que a do motor de base — 5 → 11 px em `dX` — enquanto a cauda melhorava muito. Olhando camada a camada, o padrão parecia claro: das 6 camadas de quatro balões que a limpeza tocou, **as 5 que pioraram pioraram do mesmo jeito**, com o contorno limpo produzindo um corte que a região da própria página não sustentava (`11#3` de nenhum corte para um, `14#3` com um corte que a região suja recusava por cair fora do contorno passando a ser aceito), e a única que melhorou muito melhorou no sentido oposto, com a limpeza **desligando** um corte ruim (`11#5`, 452 → 23 px).

A regra medida: aceitar o contorno limpo só quando o contorno sujo também produz um corte utilizável — mesmo teste que o Align aplica logo abaixo, `_centreInsideOutline` incluído. Nunca forçar um corte, só recusar um novo. A região limpa continua em uso de qualquer jeito.

**Rejeitada. A premissa está de cabeça para baixo.** Numa página com uma fala em cima da outra, a região suja é justamente a que **não consegue** cortar — o contorno dela está mordido —, então exigir concordância joga fora o corte exatamente onde ele é necessário. A regra descartou o corte em **59 das 98 camadas**, e as regiões de dois balões dependem dele:

| | com o corte limpo | exigindo concordância |
| --- | --- | --- |
| texts:2, `\|dX\|` med/p95 | 5/106 | 52/219 |
| texts:2, `\|dY\|` med/p95 | 6/70 | 58/349 |
| texts:3+, `\|dX\|` med/p95 | 11/128 | 15/152 |

Camadas individuais de `texts:2` pagaram de 280 a 630 px cada. Nível `full` não mudou, como esperado — só 2 camadas ali são limpas.

**O que fica sabido:** o corte sobre o contorno limpo não é um efeito colateral da Tarefa 22, é metade do ganho dela. As 5 camadas de `texts:3+` que pioraram continuam pendentes, e o caminho não é desligar o corte — é fazê-lo decidir melhor sobre a região de quatro balões, que é a pendência número 1.

### Task 25 — baseline e dataset exato (concluída)

**Hipótese.** A bancada precisava observar a geometria que o Align realmente usou, e não reconstruir depois um contorno parecido. A previsão era que wrappers só de laboratório conseguiriam capturar outline dirty/clean, candidatos, cordas, peça, centroide, fonte, fallback, exceções e segunda passada sem tocar no algoritmo de produção.

**Implementação.** `runMeasure.ps1` ganhou `-HostJsx`, `-TraceGeometry`, SHA-1 do bundle/harness, tempo por página/run e guarda SHA-1 dos 14 arquivos em `psd/` e dos 14 em `true/`. O manifesto antigo de 10 arquivos foi substituído pelo snapshot completo. `measureCentering.jsx` envolve as funções globais já carregadas pelo host somente quando `LAB.traceGeometry` está ligado; nenhuma decisão do solver muda. Um target de telemetria é limpo antes de cada Align para `smallSelection` não herdar o target da camada anterior.

**Runs.** `106-trace-smoke` foi inválido porque `-Root .` chegava relativo ao Photoshop; o driver passou a resolver a raiz uma vez. `107-trace-smoke` validou `11.psd` (12 camadas, zero erros). Os datasets finais são `110-none`, `111-mid`, `112-full` e `113-overlap`; os três primeiros usam seleção viva e `PhantomRatio=0.15`, e o último usa `Scatter=overlap` sem marquee/phantom. `114-trace-final` confirmou a telemetria final: o `smallSelection` de `0010#7` agora registra target nulo e fallback `notReached`, sem herdar estado.

**Métricas.** Cada cenário mede 98 falas e ignora a mesma camada oculta. Tempos: 367,6/639,8/690,1/739,3 s. Em `texts:3+`, X med/p95 foi 19/61, 28/194, 52/121 e 11/128 px; Y foi 8/71, 16,5/90, 7,5/104,5 e 5/34 px. Os quatro cenários somaram respectivamente 29/26/24/27 cordas, zero falsos cortes em `texts:1` e 4/4/4/8 segundas passadas de pelo menos 1 px. O cenário overlap registrou 94 outlines clean. A reprodução aritmética do corte/peça/centroide coincidiu em 0,000 px em 81 cortes comparáveis; target previsto versus movimento real ficou em no máximo 0,5 px.

**Conclusão e rejeições.** O dataset é fiel e completo. `psd/` e `true/` permaneceram idênticos ao snapshot após cada run. As tabelas por cenário/categoria/topologia e a tabela separada das 12 falas de `11`, `13` e `14` estão em `.centering-lab/partition-report.md`.

### Task 26 — H25-A/F, concavidade multi-escala (concluída)

**Hipótese e previsão.** Cúspides rasas mas persistentes entre escalas poderiam recuperar a região quase convexa de `11.psd` sem baixar globalmente o limiar que já produziu falsos cortes.

**Implementação.** `scripts/lab/scorePartitions.js` extrai máximos nos gaps 1/48, 1/32, 1/24, 1/16 e 1/12 dos 400 pontos, agrupa por distância circular e registra profundidade normalizada, ângulo, persistência, estabilidade, posição e distâncias. O fechamento barato mede tangentes e os quatro turnos corda-borda. O solver recebe somente contorno e caixa ativa; nomes, índices, outras caixas e ground truth não entram nele. O script contém um self-check executável para área/centroide, corte e rejeição de cordas cruzadas.

**Varredura e métricas.** Nas 13 páginas de treino, tolerâncias 4/8/12 produziram 2,25/2,05/1,97 candidatos de média, p95 8/7/7 e máximo 13/13/12. O menor ponto da faixa estável foi congelado: agrupamento 4 e limite 8. A escolha é geométrica e não usa o score isolado de `11.psd`.

**Conclusão e rejeições.** A persistência separa melhor os endpoints úteis (AUC 0,852 para profundidade e 0,745 para persistência), mas multi-escala isolada ainda piora gates de `texts:2`/`texts:3+` e cria dois falsos cortes na melhor configuração. Fechamento ficou apenas como feature experimental: AUC 0,314, sinal inverso ao esperado.

### Task 27 — H25-B, busca global (concluída)

**Hipótese e previsão.** Pontuar o conjunto inteiro de 0–3 cordas deveria evitar que uma segunda corda local cortasse uma lasca e permitir separar quatro lobos de uma vez.

**Implementação.** A busca enumera conjuntos não cruzados, rejeita corda fora da região, endpoint repetido, corte redundante, centroide externo e qualquer peça abaixo de 15% da área. O score combina ganhos médios de solidez, compacidade, aspecto e concavidade residual, features dos endpoints, comprimento total, quantidade de cortes, fechamento, DT e concordância clean/dirty quando habilitados. A solução de zero cordas mantém score 0 e toda variante exige margem positiva.

**Varredura e métricas.** Limites 12 e 18 deram a mesma fonte/conjunto/peça/target em 97,7% dos casos de treino, então 12 foi o menor valor na faixa estável. A melhor busca global reduziu o p95 X de `texts:3+` no treino de 121 para 94 px, mas elevou p95 Y de 28 para 36,4 px e criou um falso corte. Multi-escala + global chegou a p95 X 57,6 px, mas p95 Y 91 px e dois falsos cortes. Nenhuma margem 0,04/0,08/0,12/0,16 passou os gates.

**Conclusão e rejeições.** A busca global melhora uma cauda, mas troca o eixo/caso que falha. Foram rejeitadas as variantes multi-escala isolada, global isolada e combinada: todas violam ao menos `texts:2`, `texts:3+` ou `texts:1` em algum cenário.

### Task 28 — H25-C/E, DT e clean/dirty (concluída)

**Hipótese e previsão.** Máximos DT em lados opostos, raio dos lobos, largura relativa do pescoço e ridge ao longo da corda poderiam ordenar melhor cordas geometricamente plausíveis; concordância dirty/clean deveria ser no máximo uma penalidade leve.

**Métricas.** Grades 128 e 256 preservaram 99,14% da fonte/conjunto/peça/target no treino, portanto 128 seria a única grade portável. AUC por feature: DT 0,723; profundidade 0,852; persistência 0,745; clean/dirty 0,550; fechamento 0,314. A ausência no dirty nunca vetou uma corda e recebeu só peso leve.

**Conclusão e rejeições.** DT tem sinal útil isolado, mas nenhuma configuração DT passou os gates held-out de treino: a melhor `combined+dt256` ficou em X 10/57,6 e Y 4,3/91 px em `texts:3+`, com dois falsos cortes e uma rejeição fixed-point. Concordância clean/dirty foi praticamente neutra e fechamento pior que acaso. As três features foram descartadas para produção porque não melhoraram o resultado held-out sem regressões.

### Task 29 — H25-D, fixed-point e seleção final (concluída, resultado negativo)

**Implementação.** Toda solução candidata é resolvida novamente após transladar virtualmente a caixa ativa ao target. Mudança de fonte, conjunto, peça ou target acima de 0,5 px rejeita a solução e volta a zero cortes. `11.psd` foi excluído de toda escolha de tolerância, limite, margem e feature; a seleção lexicográfica usa o pior p95 de `texts:3+`, mediana, quantidade de cortes/features e custo nas outras 13 páginas.

**Métricas e conclusão.** Foram avaliadas 32 configurações (quatro margens em oito combinações de multi-escala/global/fechamento/DT/dirty). **0/32** passou todos os gates nas 13 páginas de treino, portanto nenhuma configuração foi congelada e o holdout de `11.psd` não foi usado para escolher ou salvar uma candidata. As falhas mais frequentes foram `texts:2`/`texts:3+` em none, `texts:3+` em mid/full, e `texts:1`/`texts:3+` em overlap. Os cinco casos registrados da Task 24 foram `13#4`, `14#3`, `11#5`, `14#4` e `11#3` no cenário overlap.

**Rejeição final.** Não existe vencedor robusto. `app_src/host.js` permanece exatamente com o solver anterior; nenhum estado, histerese ou regra calibrada para `11.psd` foi adicionado. Resultados completos e configuração de cada tentativa: `.centering-lab/partition-report.md` e `.centering-lab/partition-scores.json`.

### Task 30 — porte mínimo e gate real (encerrada sem porte)

Como a Task 29 não produziu vencedor, a condição de entrada da Task 30 não foi satisfeita. Não houve alteração no painel, payload público, Paste, Multi Bubble, solver de produção nem `_hostState.partition`; também não foram acrescentados testes de um algoritmo rejeitado. Os quatro cenários reais já medidos são o A/B suficiente para rejeitar as candidatas offline; rodar Paste/Multi Bubble/DPI e uma matriz candidata no Photoshop não poderia aprovar uma configuração que falhou antes do holdout.

`npm run verify` passou (testes, build de produção e teste do bundle). O SHA-1 do bundle medido nos quatro runs foi `48906BB37721887DB6CB72331F977EA71413F5E8`; os 28 PSDs permaneceram iguais ao manifesto completo. A decisão ponytail aqui foi não portar código sem vencedor: adicionar uma segunda implementação ao host só criaria regressão já demonstrada.


### Task 31 — balões redondos encadeados: a junção com uma cúspide só (concluída, 2026-09-06)

**O relato.** Um typesetter reportou balões redondos centralizando mal, e que
centralizar com marquee saía melhor do que apertar o atalho sem seleção. Página
`true/MUP_唯一無二の精霊鍛冶師が最強の武具を創るまで15話_2023~0026.psd`.

**O que a página tem.** Três balões redondos desenhados sobrepostos, que a
varinha traça como **uma região só** (`89,518 192x475`). Cada linha recebia o
centroide do blob inteiro. O corte por cúspides existe exatamente para isso e
não disparava.

**Por que não disparava.** `_findCuspPair` exigia **duas** esquinas acima de
`_CUSP_CONCAVITY = 0.6`. Medido no contorno real dessas junções: uma cúspide
funda e uma dobra rasa — **1.40 contra 0.34** na de cima, **1.48 contra 0.15** na
de baixo. O outro lado da junção ou é uma sobreposição funda demais para
mergulhar, ou sai fora do quadro. Achava uma esquina e desistia
(`skip=shallow:140`).

**As duas mudanças, ambas medidas antes de entrar** (`9595a62` e `e59dbae`):

1. **Par assistido.** Uma esquina precisa passar de `_CUSP_CONCAVITY`; a
   parceira só precisa ser esquina (`_CUSP_ASSIST_CONCAVITY = 0.12`). Sozinho
   isso corta balão único, então um par carregado por uma esquina só vale se a
   corda for cintura: `_CUSP_MAX_NECK = 0.55` do tamanho da peça (raiz da área).
   As cinturas reais do corpus medem 0.23 e 0.32; corda atravessando um balão
   único fica perto de 0.9.
2. **Exceção de cintura na janela de `share`.** A janela recusava qualquer corte
   que deixasse mais de 85% de um lado, por assumir que isso era raspar uma
   saliência. Em cadeia de balões redondos significa o contrário: o balão da
   linha é o grande e o corte tira os dois vizinhos pequenos. Agora um `share`
   acima da janela passa quando a corda é cintura, com limiar mais estrito que o
   do par assistido: `_CUSP_SHARE_WAIST = 0.45`. Em 0.55 uma região da
   `0018-0019` passa a ser cortada no lugar errado (13 px para 81 px); em 0.45
   ela é recusada e todos os balões que a exceção existe para separar continuam
   separando.

**Medição.** 107 camadas de texto das 15 páginas de `true/`, alinhando cada uma a
partir da posição que o typesetter tinha escolhido e medindo o quanto o align a
move. Contra a regra anterior a este trabalho:

| | antes | depois |
|---|---|---|
| melhoraram / pioraram | — | **11 / 0** |
| mediana | 8 px | 7 px |
| p75 | 18 px | 13 px |
| p95 | **62 px** | **35 px** |
| camadas acima de 25 px | 16 | 9 |
| cortes disparados | 18 | 24 |

As maiores: `13.psd#15` 78→7, `13.psd#23` 67→10, `3話~0003#25` 55→5,
`14.psd#13` 46→12, `13.psd#19` 38→7, `13.psd#17` 34→13, `13.psd#21` 28→4, e a
página reportada com o balão de baixo 17→1, o de cima 12→5 e o do meio 21→7.

**Uma regressão conhecida.** `11.psd#29` (região de quatro balões) passa a fazer
um terceiro corte e vai de 7 px para 26 px — ainda melhor que os 86 px de antes
do trabalho, mas pior que o commit intermediário.

**Tentativa rejeitada, medida.** Aceitar um corte a partir do segundo só quando
ele aproxima o centro da peça da linha. Conserta `11.psd#29` (26→7) e quebra
outros dois: `14.psd#17` 7→45 e `13.psd#21` 4→21. Em região de quatro balões a
sequência **piora antes de melhorar** — o centro sai de perto da linha num corte
intermediário e volta no seguinte (`skip=away:24` e `away:8`) — então exigir
monotonia mata as sequências longas que funcionam. Trocar uma camada errada por
duas não paga. Escolher a sequência por busca também foi descartado: "melhor"
ali seria a que move menos o texto, que é a métrica desta medição, e isso ajusta
o algoritmo a este corpus em vez de acertar a geometria.

**Testes.** `scripts/balloonOutlines.fixture.json` guarda os contornos que o host
realmente traçou nessa página, capturados do caminho do align, e o
`testBalloonCentroid.js` exige: a junção assimétrica é cortada e cai a ≤5 px do
centro escolhido pelo typesetter; o balão do meio da cadeia a ≤8 px (precisa dos
dois cortes); o balão de cima, que deixa 89%, também a ≤8 px; um balão único
nunca é cortado; a região da `0018-0019` continua recusada, que é o que fixa o
limiar em 0.45; e o par assistido mantém uma esquina funda e corda de cintura.
Conferido que os testes **falham** com os limiares antigos.

**Relação com as decisões das Tasks 25-30.** Isto não é o porte que foi
rejeitado lá: nada de multi-escala, busca global, DT, clean/dirty, fixed-point,
estado ou histerese, e nenhum parâmetro escolhido olhando `11.psd` — que aqui é
justamente a página que piora. São dois limiares no solver publicado, com
evidência nova (uma página de usuário onde a região merge não era cortada) e
regressão zero no corpus contra a regra anterior.

**Ressalva da métrica.** "Erro" aqui é a distância até onde o typesetter tinha
deixado a linha, que é proxy e não ground truth: parte dos 7 px de mediana é ele
tendo empurrado o texto de propósito. As comparações valem entre rodadas, na
mesma máquina e mesmo corpus.

**Como foi medido.** Photoshop dirigido pelo debug remoto do CEP (porta 8001),
com o painel instalado a partir do build local; as bancadas ficaram no scratchpad
da sessão: `sweep2.js` (percorre as 15 páginas, alinha cada camada e grava o
erro), `cmp.js` (compara duas rodadas camada a camada), `tune.js` (varre limiares
offline sobre os contornos capturados), `capture.js` e `capture2.js` (capturam
contorno + caixa + centro salvo), `centerdiag.js` e `cusps.js` (região, alvo e
perfil de concavidade por camada).


### Task 32 — o par atrás do mais curto, o prefixo válido, e a caixa que o resize já tinha movido (concluída, 2026-09-08)

**Baseline congelado.** `develop` em `012ef3438abf8c1dc83ccbdd449acdb3427e785b`,
working tree limpo, bundle `app/host.jsx` SHA-1
`4fdd163d7a3c73f8597c55877bbf3db437fb0f48`, Photoshop 27.9.1. Corridas de base
`120-none`, `121-mid`, `122-full`, `123-overlap`, `125-resize-pad12` e
`176-overlapmid`; da candidata `180-*`, bundle final
`d22925dbdd7b304378954e78fd490835a162028b`. Doze corridas no mesmo harness
congelado, mais duas de repetibilidade (`171-none`, `171-resize-pad12`, publicado
contra publicado) e uma de coleta do H9 (`190-rawoutline`). 15 páginas, 107
camadas, **106 elegíveis por cenário**, 0 erros de script.

O custo não é conclusivo e não é apresentado como se fosse: entre corridas do
mesmo bundle ele oscila de −18,5% a +44,9% conforme a sessão e a pressão de
memória da máquina — a corrida de `overlap` que mediu +44,9% rodou logo depois de
o sistema ficar com 0,49 GB livres. O trabalho extra que a mudança realmente
acrescenta é: o par seguinte só é procurado em 16 das 530 regiões medidas (3,0%),
a guarda cumulativa dentro do laço só muda algo em 5 (0,9%), o pertencimento é um
`_pointInPolygon` por peça, e em Node o solver inteiro sai de 0,014 ms para
0,015 ms por região.

**O manifesto do ground truth estava incompleto e o driver o reescrevia sozinho.**
Tinha 14 arquivos; `psd/` tem 15 desde a Task 31. `runMeasure.ps1` recongelava o
manifesto sempre que a contagem mudava — era assim que uma página nova, removida
ou renomeada passava sem ninguém ver. Agora só congela quando não existe
manifesto ou com `-RefreezeGroundTruth`, e qualquer outra diferença é nomeada
(`novo` / `ausente` / `mudou conteúdo`) e aborta a corrida. A guarda pegou um
defeito real na primeira tentativa: manifesto escrito por PowerShell 7 (UTF-8 sem
BOM) e lido por PowerShell 5.1 como ANSI, com os 30 nomes aparecendo como
renomeados.

**O avaliador imprimia `GATE APROVADO` sobre uma população que não conferia.**
Quatro furos em `compareRuns.js`: um caso ausente de qualquer das duas corridas
era pulado em silêncio; o p95 da candidata era calculado **só sobre os casos sem
erro**, então uma falha do motor *melhorava* a distribuição ao sair dela; uma
camada sem medição de segunda passada era pulada em vez de comparada; e nada
conferia `scatter`, `resize`, `padding`, `phantomRatio`, `liveSelection`,
`wandTolerance` nem o SHA-1 do harness entre as duas corridas. Corrigidos: os dois
percentis saem da mesma lista de casos comparáveis, qualquer caso sem medição
reprova, e chave duplicada, valor não finito e erro de script também.
`node scripts/lab/compareRuns.js --selfcheck` injeta os sete defeitos, um por vez,
em duas corridas sintéticas idênticas e exige que todos sejam detectados. A
convenção de quantil está escrita (índice `floor(p·n)`) e o `n` sai em toda linha
— em `texts:3+` (n=15) o "p95" é praticamente o máximo.

**Bancada offline fiel.** `scripts/lab/liftHost.js` levanta as funções puras de
qualquer revisão do host (working tree ou `git show <rev>:app_src/host.js`);
`scripts/lab/replayPartition.js` roda o solver sobre os contornos que o Align
realmente traçou e valida três coisas antes de qualquer número: o alvo gravado
explica o movimento medido (p95 0,6 px), o fallback gravado é o centroide da
região (p95 0,0 px) e o replay reproduz a decisão da corrida (p95 0,0 px,
1 divergência em 108, explicada — `_centreInsideOutline` roda sobre todos os
contornos e o rastro só guarda o maior). `overlayPartition.js` desenha região,
esquinas, cada corda com a guarda que a recusou, a peça mantida, a caixa ativa, o
alvo e o centro do typesetter.

Duas armadilhas que essa validação pegou, e que ficam registradas: **reamostrar o
contorno gravado não é no-op** (as amostras são uniformes ao longo do contorno
*original*, então uma segunda passagem mede um perímetro menor e desliza tudo —
até 25 px de arco, o bastante para trocar qual amostra é esquina); e **com
`resize` ligada a caixa ativa não é reconstruível** a partir do rastro, então
essas corridas são lidas pelas medições e não replayadas.

**Onde o erro recuperável está.** Sobre 424 regiões (106 camadas × 4 cenários),
com o gabarito autorizado a escolher a sequência de cortes — medição de teto, não
regra:

| oráculo | p50 | p95 | >25 | >50 | ganho somado |
| --- | --- | --- | --- | --- | --- |
| motor publicado | 7,1 | 61,7 | 53 | 28 | — |
| escolha entre pares **já admissíveis** | 6,1 | 47,5 | 38 | 21 | 885 px |
| admissibilidade solta (sem `gap`/`neck`) | 5,6 | 34,9 | 30 | 14 | 1801 px |
| sem guarda de share | 5,4 | 34,9 | 26 | 13 | 2086 px |

E afrouxar **um** limiar de cada vez é sempre negativo: `_CUSP_MIN_GAP` 0,10 leva
o p95 de 64,8 a 94,6 (23 melhoram, 20 pioram); `_CUSP_MAX_NECK` 0,65/0,80,
`_CUSP_CONCAVITY` 0,50/0,40, `_CUSP_SHARE_WAIST` 0,55, `_CUSP_MIN_PIECE_SHARE`
0,10 e `_CUSP_MAX_CUTS` 5/1 — todas com soma de ganho negativa. O erro
recuperável não está atrás de um limiar; está na decisão que **encerrava a
região** quando a peça do primeiro par era recusada.

**As quatro mudanças em `app_src/host.js`.**

1. **O par atrás do mais curto, enquanto não houver corte.**
   `_findCuspPair(points, skip)` ordena todos os pares admissíveis por
   comprimento de corda e depois por índice, e devolve o `skip`-ésimo. Enquanto a
   região não tem corte nenhum, uma peça recusada por `noPiece`, `noSide`,
   `share` ou `thinPiece` faz a passagem tentar o próximo par em vez de encerrar
   a região. Depois do primeiro corte o laço se comporta exatamente como antes, e
   essa metade é medida: deixar uma passagem posterior caçar outra corda levou
   três regiões do balão quádruplo de 16, 21 e 54 px para 106, 80 e 70 px.
   `_CUSP_MAX_PAIR_TRIES = 3` não é botão: 2, 3, 4, 6 e 10 dão resultados
   idênticos, porque o par que funciona é o primeiro ou o segundo.
2. **O corte que afina demais é recusado, o prefixo fica.** A guarda cumulativa
   saiu de depois do laço para dentro dele. Antes, uma sequência que terminava
   abaixo de um sexto da região era descartada **inteira**, inclusive os cortes
   que tinham passado todas as guardas sozinhos.
3. **A âncora de pertencimento é a caixa de antes do layout.** Com
   `resizeTextBox` ligado a caixa de texto é crescida até a **seleção inteira**
   antes de o corte rodar — medido, 181×233 vira 648×70 numa região de 930×542 —
   e o teste de lado passava a perguntar em que balão a fala está a um retângulo
   centrado entre os dois. A caixa redimensionada continua sendo a que posiciona
   a camada; só a pergunta "em que peça esta fala está" usa a caixa que ela tinha.
4. **O teste de lado não é um teste de pertencimento.** `_pieceOnSideOf` escolhia
   a peça cujo **centroide** cai do mesmo lado da corda que a caixa da fala. Uma
   corda não corta uma forma em dois semiplanos assim que uma peça é côncava:
   medido sobre 529 regiões traçadas, o teste de lado escolhe uma peça que **não
   contém** a fala em 8 de 151 cortes e não responde nada em 3 — uma dessas
   deixou a fala 108 px fora, outra 115 px. Agora pertencimento vem primeiro,
   quando exatamente uma das duas peças contém o ponto; o teste de lado fica como
   fallback, e não é sobra: a caixa de tinta pode estar inteiramente fora da
   região aberta, e uma fala sem lugar ainda tem de receber um lado.

A terceira entrou porque a matriz exigiu: na primeira tentativa o cenário com
resize **reprovou** com `13#1` 150 → 467 px, `13#2` 67 → 313 px e `14#2`
151 → 391 px. Ela é inerte quando `resize` está desligado, e isso foi medido, não
suposto: `133-overlap` (sem ela) contra `137-overlap` (com ela) dá **0 casos
diferentes** em 104.

**Matriz real, cada cenário contra o motor publicado no mesmo cenário:**

| cenário | corridas | veredito | por caso |
| --- | --- | --- | --- |
| seleção viva, offset 15%, `none` | `170` × `180` | aprovado | 0 IMPROVED · 106 UNCHANGED · 0 WORSENED |
| seleção viva, offset 15%, `mid` | `170` × `180` | aprovado | **1** · 105 · 0 |
| seleção viva, offset 15%, `full` | `170` × `180` | aprovado | **2** · 104 · 0 |
| sem marquee, `overlap` | `170` × `180` | aprovado | 0 · 104 · 0 |
| seleção viva, offset 15%, resize + padding 12 | `170` × `180` | aprovado | **10** · 95 · **1** |
| sem marquee, `overlapmid` (cenário novo, fora das séries históricas) | `170` × `180` | aprovado | 0 · 105 · 0 |
| **nulo**: publicado × publicado, `none` | `170-none` × `171-none` | aprovado | 0 · 106 · 0 |
| **nulo**: publicado × publicado, resize | `170-resize` × `171-resize` | aprovado | 0 · 106 · 0 |



No cenário com resize — o que o painel usa com `resizeTextBoxOnCenter` —
`texts:3+` vai de p95 190/150 px para **22/15**, o E do p95 de 242 para **26**, os
casos acima de 50 px de **6 para 0**, e `leak` de 148/73 para **36/20** com os
acima de 50 px de 10 para 2. `texts:1`, `normal`, `cut` e `scream` ficam
**idênticos** em todos os cenários e continuam com zero cortes: a regra nova só
muda a população em que o motor já queria cortar e foi impedido.

As camadas que mudaram, todas nomeadas: `mid` — `0029#1` 60,2 → 6,7. `full` —
`11#2` 108,0 → 11,2 e `0016#2` 114,7 → 26,1. Resize — `11#2` 241,8 → 11,4,
`13#1` 150,0 → 8,3, `14#2` 150,6 → 4,0, `0016#4` 154,4 → 27,6, `14#3` 98,3 → 7,1,
`13#3` 69,3 → 4,7, `13#2` 66,9 → 10,1, `0003#0` 54,8 → 5,4, `13#5` 33,9 → 13,7,
`14#4` 29,2 → 3,6, e **uma piora tolerada**: `11#4` 6,8 → 26,3 px.

**Um alerta de idempotência que não reproduziu, e como ficou provado.** A
primeira corrida de `overlap` reprovou por uma camada: `11#8` passou a mover 1 px
em X na segunda passada. Ela não corta (`skip=shallow:4`, `cortes=0`) e a primeira
passada é idêntica nas 11 camadas da página nos dois motores. Medido com a mesma
página e as mesmas opções, duas corridas por bundle: **o bundle publicado discorda
de si mesmo** — `140-noise-base-a` deu `7/-6 rep 1/0` e `141-noise-base-b` deu
`8/-6 rep 0/0`. As outras dez camadas são iguais nas sete corridas. O gate não foi
afrouxado: `137-overlap` passa como ele está escrito.

**O gate estava quebrado, e a prova é um experimento nulo.** Duas das seis
comparações reprovavam, e as duas em camadas onde o caminho alterado **não
executa** (`cortes=0`). Medido rodando o mesmo bundle duas vezes:

| corrida | bundle | `11#8` alvo (`none`) | `11#6` alvo da 2ª passada (`resize`) |
| --- | --- | --- | --- |
| `120-none` / `170-resize` | publicado | 498,006 | 1524,500 |
| `170-none` / `171-resize` | publicado | **497,950** | 1524,500 |
| `180-none` / `180-resize` | candidata | 498,006 | **1524,493** |
| — / `181-resize` | candidata | — | 1524,500 |

O motor publicado discorda de si mesmo em 0,074 px e a candidata em 0,007 px, e
isso basta para o centro rasterizado da tinta pular um pixel inteiro e cruzar
uma tolerância. `node scripts/lab/compareRuns.js 170-none 171-none 170-none` —
**publicado contra publicado** — reprovava exatamente como a candidata.

O conserto não foi subir limiar, que seria afrouxar depois de ver falhar. Foi
medir a coisa certa: idempotência e "estava correto" são propriedades da resposta
do **motor**, e o harness grava o alvo. Um caso que troca de lado de uma
tolerância enquanto o motor mirou no mesmo ponto dentro de 0,5 px não mudou de
comportamento — e os dois casos continuam **nomeados no relatório**, não
somem:

```
1 caso(s) trocaram de lado da tolerância sem o motor mudar de alvo:
  11#8: caiu do outro lado da tolerância com o alvo do motor a 0.074 px do anterior
idempotência: 5 de 106 ... (1 que o motor de base mantinha parada,
                            0 delas com o alvo da segunda passada realmente mudado)
```

O teste de aceitação é o experimento nulo passar a aprovar, e o `--selfcheck`
ganhou as duas metades: um caso que sai da tolerância **com o alvo mudado**
reprova; um que sai **com o alvo idêntico** é nomeado e não reprova. O mesmo para
oscilação.

**H9, o contorno antes da abertura: mecanismo confirmado, uso rejeitado.** O
harness ganhou `-CaptureRawOutline`, que grava no mesmo probe o contorno cru e o
aberto. Sobre 102 camadas com os dois:

| grupo | cortes no aberto | cortes no cru | cru melhor | cru pior |
| --- | --- | --- | --- | --- |
| `texts:1` | 0 | 3 | 3 | 10 |
| `texts:2` | 10 | 24 | 15 | 7 |
| `texts:3+` | 14 | 11 | 2 | 11 |

A abertura **realmente esconde pares de cúspide**: 14 das 26 regiões de duas
falas ganham corte no contorno cru, várias exatamente da família `shallow:132`,
`shallow:122`, `shallow:56`. Mas o cru também inventa corte em três balões
únicos — um deles `0018-0019#1`, a região em que a Task 31 fixou
`_CUSP_SHARE_WAIST = 0.45` justamente por não poder ser cortada (13,0 → 74,9 px)
— e arrasa a página de quatro balões (`11#2` 11,9 → 277,5 px), onde a peça vira a
região inteira (`share:100`).

Restringir o cru a recurso, só quando o aberto não corta, elimina o desastre de
`texts:3+` e mantém 10 ganhos reais em `texts:2` (30,1 → 9,2 · 35,9 → 15,0 ·
23,2 → 6,9 · 22,3 → 6,2 e mais seis), mas **continua rejeitado**: `texts:1` vai de
p95 19,5 para 39,5 px e de máximo 62 para 75, com os mesmos três cortes falsos.

O que isso muda para a próxima rodada: o alvo deixa de ser "achar sinal novo" e
passa a ser **limpar o contorno cru sem arredondar a cúspide**. A abertura existe
para tirar franja de antialias e retícula, e é isso que ela cobra. Um filtro que
remova ruído sem erodir-dilatar ficaria com os 10 ganhos sem os 3 falsos. É
mudança na aquisição, custa `Make Work Path` a mais, e precisa da própria matriz.

**O cenário novo, e o que ele custou.** `-Scatter
overlapmid` é o nível que faltava: a fala jogada dentro do próprio balão **e** a
vizinha em cima de onde ela foi parar. Os níveis `none/mid/full` cercam cada fala
no próprio balão e nunca põem uma sobre a outra; o `overlap` da Task 23 deixa a
ativa em casa. Como a candidata lê a caixa da camada ativa, os dois fatores
precisavam ser exercidos juntos. Numa versão intermediária da candidata — antes do pertencimento explícito — ele
reprovava por 2 px no p95 de `|dY|` em `texts:3+`, num caso só: `14#2` passava a
cortar onde o publicado recusava por `noSide`, errava 6,4 px a mais e parava de
oscilar 35/−41 px. Com o pertencimento, `14#2` volta a não cortar e o cenário
fecha em **0 IMPROVED, 105 UNCHANGED, 0 WORSENED**. Uma guarda tentada antes
disso — só tentar o próximo par enquanto o centro da caixa ativa estiver dentro
da região — é **inerte**: 0 casos mudam nos cinco cenários replayáveis, porque o
centro está dentro da região e o `noSide` vem de os dois centroides das peças
caírem do mesmo lado da corda, que é o que a quarta mudança conserta.

**A única piora da matriz inteira, investigada até o fim.** `11#4` no cenário com
resize sai de 6,8 px para 26,3 px. Não disparou regra nenhuma — nunca esteve
dentro da tolerância de 4,05 px (dy 5,50). Rastreada: veio da correção da âncora,
não do par seguinte nem do pertencimento. Os três cortes que ela agora faz são
todos legítimos — cúspides 0,79/1,52, 1,01/0,40 e 1,57/1,13, cinturas 0,18/0,36/
0,27, shares 0,76/0,82/0,87, acumulado 0,543, e a peça contém a fala nas três — e
o erro por passo é 53,9 → **7,3** → 26,4: o terceiro corte é válido e infeliz.
Limitar o orçamento conserta esse caso e quebra dezesseis: com `_CUSP_MAX_CUTS`
em 2, `14#3` vai de 7,0 a 69,0 px, `14#4` de 2,5 a 61,2 e `13#4` de 7,9 a 66,5
(5 melhoram, 16 pioram); em 4, 5 melhoram e 3 pioram. Ela pertence à região de
quatro balões da `11.psd` que é a pendência aberta desde a Task 21, e compra uma
oscilação de 33 px por Align indo a zero.

**Integração conferida no Photoshop real.** Multi Bubble: 20 formas de seleção no
bundle candidato, marquee **viva** em captura, captura repetida, shape scan e
captura de novo, inclusive em `coversPage`, recusa por orçamento e `noPolygons`.
Paste: caminho não tocado — `_splitOutlineAtCusps` tem um único chamador. DPI: a
mesma página a 72 e a 300 dpi sem reamostrar pixel dá **0,000 px** de diferença de
alvo e os mesmos cortes, nos dois motores. Fluxo sequencial (página inteira sem
repor entre as falas, ida e volta e duas varreduras): em `11.psd` a dependência de
ordem cai de máx 84,9 px para **49,2 px** e a segunda varredura fica igual; em
`13.psd` os dois motores são idênticos. `psd/` e `true/` conferidos por SHA-1
depois de todas as corridas: 30 arquivos, 0 divergências. `npm run verify` passa.

**Fronteira que sobra, caracterizada.** 36 das 424 regiões têm uma cúspide funda
(≥0,6 rad) e **nenhum parceiro admissível** — p95 191 px, máximo 354 px, 30 delas
com dois ou mais textos. Auditadas par a par, a rejeição é sempre `gap` (as duas
cúspides ficam perto demais ao longo do contorno) ou `neck` (o parceiro é uma
dobra rasa e a corda é longa demais para ser cintura). O caso mais caro é
`MUP_難攻不落の魔王城へようこそ64話_2023~0007`, uma cadeia de três lobos empilhados
cujo lado direito é reto: as junções só têm cúspide de um lado. E há ambiguidade
registrada em `0003#1`, com três cúspides fundas e três pares admissíveis cujos
erros são 188,6 px (a corda mais curta, escolhida), **7,2 px** e 462,5 px — o par
certo é o do meio em comprimento, o mais desequilibrado em fração e o de cúspide
mais rasa. Medido o **rank** da corda que o oráculo escolhe entre os pares
admissíveis nos 19 casos recuperáveis: 1, 2, 3, 4, 5, 10 e 12 de 2 a 21
candidatos — espalhado. "Pegar o k-ésimo mais curto" não é regra, e é por isso
que a busca por pontuação das Tasks 25–30 não achou vencedor.

**Tentativas medidas e rejeitadas nesta rodada:** preferir a corda que não
atravessa a caixa da fala (1 caso melhora 6 px, nada mais muda); preferir o par
cuja peça contém o centro da fala (**0** casos mudam — a peça escolhida pelo
teste de lado já contém o centro em todos); e a suspeita de que
`_centreInsideOutline` conferido contra a região inteira fosse permissivo demais
(**0** dos 101 casos com corte tem centro dentro do contorno e fora da peça).

**Testes.** `scripts/testBalloonCentroid.js` ganhou: os dois contornos reais em
que o par mais curto é recusado (`retryAfterNoSide`, `retryAfterShare`, no
`balloonOutlines.fixture.json`), com a exigência de que o corte caia a menos da
metade da distância que o centroide fundido erra; a ordem total e estável dos
pares e o `null` depois do último; uma cadeia sintética de quatro lobos em que
dois cortes legais sozinhos ficam abaixo do piso juntos, exigindo que o prefixo
seja mantido; e a ordem em que a âncora é tomada em relação ao resize. Conferido
que os três casos **não cortam** no motor anterior (`noSide`, `share:86` e
`thinPiece:10`).

**Ferramentas novas do laboratório**, todas no git: `liftHost.js`,
`replayPartition.js`, `overlayPartition.js`, `diagDpiSplit.jsx` +
`runDpiSplit.ps1`, `diagSequence.jsx` + `runSequence.ps1`, e o nível
`-Scatter overlapmid` no harness. Relatório completo com todas as tabelas:
`.centering-lab/task32-report.md`; um CSV por cenário com erro assinado por eixo,
E, erro relativo, repetição, corte, fallback e status em
`.centering-lab/gate-*.csv`.

### Distribuição do erro, antes e depois (regenerar com `node scripts/lab/errorTable.js`)

Erro = `hypot(delta.inkX, delta.inkY)`, a distância entre onde a camada parou e
onde o typesetter a tinha deixado. Corridas `170-*` (bundle publicado
`4fdd163d…`) contra `180-*` (candidata `d22925db…`), mesmo harness, 15 páginas,
106 camadas elegíveis por cenário. Três medições ficam de fora porque o motor
recusou de um dos lados — falha não vale erro zero.

**Os seis cenários somados**

| grupo | n | p50 | p75 | p95 | máx | >10 px | >25 px | >50 px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TOTAL | 633 | 7,3 → **7,2** | 16,0 → **14,9** | 78,7 → **65,0** | 354 → 354 | 254 → **248** | 99 → **88** | 57 → **46** |

**Cenário a cenário, só o total e os grupos que se movem**

| cenário | grupo | n | p50 | p75 | p95 | máx | >25 px | >50 px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | TOTAL | 106 | 7,1 → 7,1 | 13,0 → 13,0 | 34,8 → 34,8 | 354 → 354 | 9 → 9 | 3 → 3 |
| `mid` | TOTAL | 106 | 7,3 → 7,3 | 16,3 → **16,1** | 76,4 → 76,4 | 192 → 192 | 18 → **17** | 10 → **9** |
| `mid` | `texts:2` | 30 | 15,7 → **13,6** | 44,2 → **33,0** | 188,8 → 188,8 | 192 → 192 | 10 → **9** | 7 → **6** |
| `full` | TOTAL | 106 | 7,8 → 7,8 | 17,5 → **16,3** | 108,0 → **77,4** | 185 → 185 | 20 → **18** | 12 → **10** |
| `full` | `texts:2` | 30 | 15,4 → 15,4 | 42,5 → **34,7** | 181,2 → 181,2 | 185 → 185 | 11 → **10** | 6 → **5** |
| `full` | `texts:3+` | 15 | 16,3 → **16,0** | 65,0 → **54,7** | 179,8 → 179,8 | 180 → 180 | 6 → **5** | 5 → **4** |
| `overlap` | TOTAL | 104 | 6,0 → 6,0 | 13,0 → 13,0 | 45,7 → 45,7 | 336 → 336 | 7 → 7 | 5 → 5 |
| **`resize+pad12`** | **TOTAL** | 106 | 7,6 → **7,2** | 16,8 → **13,0** | 110,8 → **35,3** | 354 → 354 | 17 → **9** | 11 → **3** |
| `resize+pad12` | `texts:2` | 30 | 14,1 → **13,6** | 22,8 → **19,4** | 154,4 → **110,8** | 354 → 354 | 7 → **5** | 4 → **2** |
| `resize+pad12` | **`texts:3+`** | 15 | 20,8 → **7,4** | 98,3 → **12,2** | 241,8 → **26,3** | 242 → **26** | 7 → **1** | 6 → **0** |
| `resize+pad12` | `leak` | 45 | 15,2 → **11,1** | 33,9 → **18,7** | 154,4 → **36,0** | 354 → 354 | 14 → **6** | 10 → **2** |
| `overlapmid` | TOTAL | 105 | 9,5 → 9,5 | 35,3 → 35,3 | 93,6 → 93,6 | 336 → 336 | 28 → 28 | 16 → 16 |

`texts:1`, `normal`, `cut` e `scream` ficam **idênticos em todos os seis
cenários** — a regra nova só muda a população em que o motor já queria cortar e
não conseguia. O máximo de 354 px que não se move é
`MUP_難攻不落の魔王城へようこそ64話_2023~0007#2`, a cadeia de três lobos com cúspide
de um lado só, descrita na fronteira abaixo.

O ganho está concentrado no caminho com `resizeTextBox`, que é o que o painel usa
por padrão: `texts:3+` sai de p95 241,8 px para **26,3** e de seis camadas acima
de 50 px para **nenhuma**.

### Mapa do erro que sobra (medido, para não recomeçar do zero na próxima rodada)

Sobre 529 regiões — 106 camadas × 5 cenários, motor publicado — repartindo o erro
pela **primeira etapa em que ele aparece**:

| etapa | n | p50 | p95 | máx | soma do erro | % do total |
| --- | --- | --- | --- | --- | --- | --- |
| aquisição: a região não é o balão da fala | 3 | 62,4 | 79,4 | 79 | 145 px | **1,5%** |
| sem corte, alvo = centroide da região | 386 | 5,8 | 75,0 | 354 | 6724 px | **69,4%** |
| cortou e o alvo foi recusado | 1 | 5,0 | 5,0 | 5 | 5 px | 0,1% |
| cortou | 140 | 11,2 | 76,4 | 189 | 2811 px | **29,0%** |

**A aquisição não é o problema.** Em 3 de 529 a região que o motor usou não é o
balão em que a fala está (IoU contra a região de referência abaixo de 0,6), e
duas delas são a mesma página no cenário com vizinha em cima. Todo o resto do
erro nasce depois, com a região certa na mão.

A massa "sem corte" repartida por topologia e forma:

| grupo | n | p50 | p95 | máx | % da massa sem corte |
| --- | --- | --- | --- | --- | --- |
| `texts:2` / `leak` | 72 | 19,4 | 191,7 | 354 | **53,8%** |
| `texts:1` / `cut` | 139 | 5,7 | 50,2 | 95 | 19,6% |
| `texts:1` / `normal` | 153 | 4,5 | 35,3 | 114 | 19,2% |
| `texts:3+` / `leak` | 16 | 19,0 | 108,0 | 108 | 6,7% |
| `texts:1` / `scream` | 10 | 9,6 | 10,0 | 10 | 0,7% |

**Mais da metade do erro que sobra é região de duas falas que o corte não
separa.** É a mesma família descrita acima: cúspide funda sem parceiro
admissível, ou par recusado.

**E a cauda de uma fala só não é partição perdida.** Das 302 amostras de
`texts:1`, 285 não têm cúspide nenhuma (p50 5,0 px, p95 34,8) e só 9 têm cúspide
funda sem corte — dessas, as duas grandes (114 e 50 px) só aparecem nos cenários
com uma vizinha jogada em cima, isto é, região mordida, não balão fundido. Os 17
casos de `texts:1` acima de 25 px são **seis regiões distintas**, e o padrão
delas é outro:

| erro | dX/dY | balão | caixa da fala | texto |
| --- | --- | --- | --- | --- |
| 95 px | −52/−79 | 395×683 | 307×535 | "The Ducal House of Eisenhood" |
| 62 px | +5/+62 | 739×845 | 395×409 | "There's no doubt that Oz fel…" |
| 59 px | +56/−18 | 554×678 | 347×174 | "But, you know, Mr. Remme?" |
| 49 px | −48/−10 | 425×536 | 275×110 | "Hee hee, yes, he is." |
| 40 px | +1,5/−39,5 | 601×974 | 246×381 | "Let those kids die…!" |
| 35 px | −11/+33,5 | 439×681 | 249×187 | "Ichi vai caçar a magia Anti-…" |

Ou a fala ocupa quase todo o balão (78% da largura e da altura no pior caso), ou
é uma fala pequena num balão grande onde o typesetter escolheu um canto. Nenhuma
delas tem região errada nem cúspide perdida.

### Hipóteses medidas e rejeitadas nesta rodada

| hipótese | medida | veredito |
| --- | --- | --- |
| **caixa tipográfica em vez da caixa de tinta** — centrar pela tinta desloca o corpo das letras conforme haja descendente | pooled, `texts:1`: dY médio 4,44 px com descendente contra 0,05 sem. **Controlando por número de linhas o efeito some**: uma linha, 2,93 contra 0,86 px, quando metade do descendente medido valeria ~27 px | confundimento com tamanho e número de linhas; rejeitada |
| **deslocamento óptico constante** (typesetter põe o texto acima do centro) | `texts:1`, três cenários: dX mediana −1,0 px e média −0,9; dY mediana +1,0 e média +3,0, com histograma de −39 a +62 e moda em 0 | não existe viés constante que valha corrigir; o −1 px em X está no piso de ±1 px dos bounds inteiros |
| **contenção (H7)**: o alvo empurra a caixa para fora do balão | amostrando 49 pontos da caixa contra o contorno: o motor deixa a caixa parcialmente fora em 68 de 516, **o typesetter em 62**; só 34 casos perdem mais de 2 pontos percentuais de cobertura, quase todos 0,94–0,98 contra 1,00 | não é problema geral; o único caso grave (cobertura 0,24) já é resolvido pelo par seguinte |
| **offset fantasma em Y** para balão cortado | só 8 das 112 camadas de `texts:1`/`cut` tocam borda do canvas (4 à direita, 4 em cima); dY médio +5,0 px no grupo do topo, n=4 | amostra pequena demais e sem direção consistente |
| **H8: traço remanescente na junção** | amostrando o composto da página (texto escondido) ao longo do **meio** de cada corda candidata, excluindo 15% de cada ponta: cinza médio **255** e mínimo **255** nas cordas boas; 254/242 nas ruins, com 5% tendo algum pixel abaixo de 200 | **a informação não está na imagem**: o desenhista apaga a divisa interna por completo. Não é difícil de extrair, é inexistente |
| **H13: estreitar para a vizinhança da fala** quando há cúspide funda sem par (mecanismo que já existe para região vazada) | 40 regiões com esse gatilho (26 `texts:2`, 9 `texts:1`, 5 `texts:3+`). Estreitando 50%: p95 191,5 → 94,7 px, máximo 354 → 113, ganho somado 520 px, mas **13 melhoram e 8 pioram** — inclusive `育成74話~0007#0` de 0,1 px para 51,3 px | há erro recuperável ali, mas o gatilho pega 9 regiões de uma fala só e destrói casos perfeitos; separar por solidez seria ajustar em 40 amostras |

**O que isso fecha.** A separação de dois balões sobrepostos não tem sinal local:
não há tinta na junção, o teste de tangentes já foi medido pior que o acaso
(Task 26, AUC 0,314), o rank da corda certa entre as admissíveis é espalhado de 1
a 12, e reconstruir o lobo por ajuste de círculo não é identificável. O que resta
é a silhueta global, que é o que a regra de cúspides já usa.

**O que continua aberto.** Uma frente ainda não medida: o contorno **antes** da
abertura morfológica. Tudo que já foi medido roda sobre o contorno aberto, e a
abertura arredonda a esquina côncava num arco de raio `r` — nas regiões
problemáticas `r` mediano é 69 px contra 38 px nas saudáveis, porque o raio é 10%
do menor lado e essas regiões são grandes. Se for a abertura que transforma um
lado da junção numa dobra rasa demais para parear, o contorno cru tem o par que
falta. O harness sabe capturá-lo (`trueRegion.rawOutline`), o teste é
discriminatório — dá par nas 40 regiões travadas sem inventar corte nas 285 de
uma fala só? — e não custa mudança no motor até render.

## Decisões feitas

1. **Consolidar a decisão negativa das Tasks 25–30.** A bancada agora reproduz a geometria real, os artefatos estão em `.centering-lab/partition-report.md` e `.centering-lab/partition-scores.json`, e `npm run verify` passou. Das 32 configurações avaliadas com leave-one-page-out, nenhuma passou todos os gates (`0/32`); `11.psd` permaneceu holdout.
2. **Manter o motor publicado.** Não portar multi-escala, busca global, DT, clean/dirty ou fixed-point para `app_src/host.js`; não adicionar estado/histerese, mudanças no painel/payload ou alterações em Paste/Multi Bubble. O SHA-1 do host e os 28 PSDs devem continuar sendo conferidos antes/depois de novas medições.
3. **Só reabrir a investigação com evidência nova.** Se for necessário tentar novamente, acrescentar ground truth ou páginas held-out independentes e repetir os quatro cenários e os mesmos gates, congelando a configuração antes de revelar `11.psd`. Não ajustar parâmetros ao caso holdout nem selecionar o melhor valor isolado.
4. **O gate mede o motor, não o raster.** Idempotência e "estava correto" só
   reprovam quando o alvo que o motor calculou mudou mais de 0,5 px; abaixo
   disso o caso é **nomeado no relatório** e não conta. A justificativa é
   medida, não estética: com a regra anterior o bundle publicado reprovava
   contra ele mesmo (`170-none` × `171-none`), porque duas corridas do mesmo
   motor divergem 0,074 px no alvo e isso move o centro rasterizado um pixel
   inteiro. O teste de aceitação é o experimento nulo passar a aprovar, e o
   `--selfcheck` exige as duas metades: alvo mudado reprova, alvo idêntico é
   nomeado. Toda rodada futura deve rodar pelo menos um experimento nulo antes
   de ler um flag de um caso só.
5. **O avaliador é conferido antes de qualquer número.** `compareRuns.js` reprova população incompleta, falha do motor, repetição ausente, chave duplicada, valor não finito, erro de script e divergência de opções ou de harness; `--selfcheck` demonstra os sete. `runMeasure.ps1` não recongela o manifesto do ground truth sozinho. Nenhuma tabela desta ou de futuras rodadas vale se a linha `população: N elegíveis, N comparáveis, 0 sem medição` não estiver lá.
6. **A escolha entre pares admissíveis continua aberta e sem regra conhecida.** O teto medido é 885 px em 19 casos, mas o rank da corda certa entre os pares admissíveis é 1, 2, 3, 4, 5, 10 e 12 de 2 a 21 — não existe "pegar o k-ésimo". E a saída pelo "traço remanescente na junção" está **fechada com medição**: amostrando o composto da página no meio de cada corda candidata, o cinza médio é 255 e o mínimo é 255 nas cordas boas — o desenhista apaga a divisa interna por completo, então não é informação difícil de extrair, é informação que não existe.
7. **A frente que sobra é a aquisição, não o solver.** O contorno **antes** da abertura morfológica tem os pares que faltam (14 das 26 regiões de duas falas ganham corte nele) e também inventa três cortes em balão único, porque carrega a franja de antialias e a retícula que a abertura existe para remover. O próximo passo, se houver, é **limpar sem arredondar a cúspide** — filtro de ruído em vez de erodir-dilatar — e isso é mudança na aquisição, com `Make Work Path` a mais e matriz própria. `-CaptureRawOutline` no harness grava os dois contornos do mesmo probe para medir offline antes de pagar.
8. **As 15 páginas são todas de desenvolvimento.** Não há validação independente reservada nesta rodada: `psd/` e `true/` são o mesmo corpus usado para formular as hipóteses, e `11.psd` deixou de ser holdout na Task 31. Os números valem como não-regressão medida no corpus conhecido, não como previsão sobre páginas novas.

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

# 7. medir o custo da seleção que está viva agora, etapa por etapa
#    (não abre nem fecha documento: serve para casos que só existem na máquina
#     do usuário, como uma varinha dentro de um objeto inteligente)
powershell -NoProfile -File scripts/lab/runLive.ps1 -Root "<raiz>" -Label crash-pants

# 8. conferir que nenhuma seleção do usuário é destruída pela captura multi-bolhas
#    (-HostJsx compara com outro bundle, por exemplo o do commit anterior)
powershell -NoProfile -File scripts/lab/runCapture.ps1 -Root "<raiz>" -Run 000-baseline -Page "<nome do psd>" -Index 5 -Label atual

# 9. conferir que o multi-bolhas acumula vários balões numa página qualquer
#    (caça balões por varinha, captura quatro em sequência e diz o que o painel
#     faria com cada resposta; rodar nas duas variantes de dpi para o diferencial)
powershell -NoProfile -File scripts/lab/runMultiBubble.ps1 -Root "<raiz>" -Run 040-dpi -Page bug300 -Label dpi300

# 10. em que unidade o Action Manager devolve as âncoras deste Photoshop
powershell -NoProfile -File scripts/lab/runAnchor.ps1 -Root "<raiz>" -Run 040-dpi -Page bug300 -Label dpi300 -X 1120 -Y 98

# 11. auditar o próprio avaliador antes de acreditar em qualquer tabela
node scripts/lab/compareRuns.js --selfcheck
node scripts/lab/compareRuns.js 120-none 130-none 120-none --csv .centering-lab/gate.csv

# 11b. a distribuição do erro, antes e depois, por cenário e por grupo
#      (a tabela que fica no plano; regenerar sempre que houver corrida nova)
node scripts/lab/errorTable.js
node scripts/lab/errorTable.js none:170-none:180-none resize:170-resize-pad12:180-resize-pad12

# 11c. o experimento nulo: o mesmo bundle dos dois lados. Um flag de um caso só
#      não vale nada sem ele
node scripts/lab/compareRuns.js 170-none 171-none 170-none

# 12. rodar o solver publicado sobre os contornos que o Align realmente traçou,
#     sem abrir o Photoshop, e conferir que a bancada reproduz a corrida
node scripts/lab/replayPartition.js --runs 120-none,121-mid,122-full,123-overlap \
  --validate --engine HEAD --host HEAD --candidate .
node scripts/lab/replayPartition.js --runs 120-none --host . --json .centering-lab/replay.json
node scripts/lab/overlayPartition.js --dump .centering-lab/replay.json --worst 20

# 13. o nível que junta as duas metades: a fala jogada dentro do próprio balão
#     E a vizinha em cima de onde ela foi parar
powershell -NoProfile -File scripts/lab/runMeasure.ps1 -Root "<raiz>" -Run 136-overlapmid `
  -Scatter overlapmid -TraceGeometry

# 14. a mesma página alinhada na resolução dela e em 300 dpi, sem reamostrar pixel
powershell -NoProfile -File scripts/lab/runDpiSplit.ps1 -Root "<raiz>" -Page 13.psd -Dpi 300 -Label cand

# 15. a página inteira alinhada linha a linha sem ser reposta entre elas,
#     para a frente, para trás e duas vezes
powershell -NoProfile -File scripts/lab/runSequence.ps1 -Root "<raiz>" -Page 11.psd -Label cand

# 16. gravar o contorno antes e depois da abertura morfológica, no mesmo probe,
#     para medir offline o que a abertura esconde e o que ela evita
powershell -NoProfile -File scripts/lab/runMeasure.ps1 -Root "<raiz>" -Run 190-rawoutline `
  -Scatter none -LiveSelection -PhantomRatio 0.15 -TraceGeometry -CaptureRawOutline
```

Runs guardados em `.centering-lab/runs/`. Motor original: `000-baseline` (sem resize), `000R-resize`, `000R-pad12`, `000L-live`, `000L-live-phantom`. Motor atual: `041-dpi-live-phantom` (Tarefa 18), antes dele `038-cost-live-phantom` (Tarefa 17), antes dele `016-narrow`, `017-narrow-resize`, `018-narrow-pad12`, `019-narrow-live`, `020-narrow-live-phantom`. Os demais (`002` a `015`, `021`, `022`) são as etapas intermediárias descritas acima.

## Decisões e pendências

- O modo multi-bolhas entra na medição por uma via mais barata: como a marquee armazenada é desenhada pelo usuário e não existe no ground truth, o equivalente reproduzível é o bbox **cru** da região do balão (sem `adaptiveOpen`). Isso é calculado offline sobre as mesmas máscaras, comparando duas regras: `bboxCru` (multi-bolhas) e `bboxAposAbertura` (Align e Paste). A premissa fica registrada no relatório.
- A decisão de onde a regra final vai morar (host ou painel) depende do que ela exigir: regra que precisa da máscara vive no host; regra que precisa apenas do contorno pode viver no painel, com o host recebendo o centro. Definido após o ranking da Task 5, e em um único lugar — sem o gêmeo ES3/ES6 criado no PR #2.
