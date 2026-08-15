# Handoff da centralização de balões

Este documento registra o estado atual da centralização de texto para que outra IA possa continuar o trabalho sem repetir a investigação.

## Contexto

O projeto centraliza texto sobre balões de mangá no Photoshop. Existem três situações principais:

1. balão intacto;
2. balão cortado pela cena;
3. balão retangular ou quadrado.

Balões intactos e retangulares devem usar o centro geométrico literal. Somente balões realmente cortados podem receber deslocamento para reconstrução do centro oculto e margem de segurança.

O problema investigado foi um retângulo interpretado como balão cortado. O debug mostrava:

- seleção: <code>160 x 263</code>;
- centro da seleção: <code>98, 1080</code>;
- centro renderizado do texto: <code>98, 1080</code>;
- <code>Formato Retangular: Não</code>;
- <code>Tem Completion: Sim</code>;
- <code>pixelOffsetX: -3.125</code>;
- margem aplicada: <code>8 px</code> horizontal e <code>13 px</code> vertical.

As linhas tinham este padrão:

~~~text
topo:       largura aproximada de 99%
parte alta: largura entre 45% e 91%
centro:     largura entre 1% e 3%
parte baixa: largura entre 45% e 91%
base:       largura aproximada de 99%
~~~

Esse perfil é largo nas duas extremidades e colapsa no centro. Ele não representa corretamente uma área retangular preenchida. O detector antigo interpretava as linhas largas do topo e da base como cortes e criava o deslocamento artificial.

## Fluxo atual

~~~text
previewBlock.jsx
  -> getShapeProfileGeometry()
  -> reconstructPhantomBalloon()
  -> offsetX / offsetY / hasCompletion / isRectangular
  -> utils.js serializa os dados
  -> host.js recebe a geometria
  -> mede o limite visual renderizado do texto
  -> calcula o centro-alvo
  -> aplica margem apenas quando há corte
  -> move o layer original
~~~

## Geometria do painel

Em <code>app_src/components/previewBlock/previewBlock.jsx</code>, <code>handleAlignLayer</code> obtém a geometria do perfil atual usando <code>textShapeREngine.getShapeProfileGeometry()</code>.

Além dos deslocamentos, o painel envia:

- <code>phantomGeometryProvided</code>;
- <code>phantomHasCompletion</code>;
- <code>phantomIsRectangular</code>;
- <code>collectDebug</code>.

Quando existe um perfil válido, a geometria calculada no painel é a fonte usada para o posicionamento. O host não deve substituir silenciosamente um deslocamento explicitamente calculado pelo painel por uma nova inferência.

## Reconstrução geométrica

<code>app_src/textShapeR.js</code> chama <code>reconstructPhantomBalloon()</code> de <code>app_src/phantomEllipse.js</code>.

Quando a forma é retangular, o resultado esperado é:

~~~js
offsetX: 0
offsetY: 0
hasCompletion: false
isRectangular: true
~~~

Quando há evidência de corte, a reconstrução pode retornar deslocamentos diferentes de zero.

## Correção do perfil invertido

Foi criada uma validação equivalente nos dois ambientes:

- <code>hasInvertedSymmetricProfile()</code> em <code>app_src/phantomEllipse.js</code>;
- <code>_hasInvertedSymmetricProfileES3()</code> em <code>app_src/host.js</code>.

Critérios:

- pelo menos 7 linhas;
- largura máxima acima de <code>65%</code>;
- primeira e última linha acima de <code>75%</code> da largura máxima;
- maior largura no intervalo central abaixo de <code>55%</code> da largura máxima;
- erro médio de simetria vertical abaixo de <code>0.12</code>.

Quando todos os critérios são satisfeitos, o perfil é tratado como retangular/neutro. Isso evita que um caminho malformado ou auto-intersectado seja interpretado como corte.

Essa lógica precisa permanecer sincronizada entre o módulo ES6 e o host ExtendScript.

## Medição do texto

Em <code>app_src/host.js</code>, <code>_getCurrentRenderedTextBounds()</code>:

1. duplica temporariamente o layer de texto;
2. tenta rasterizar somente o conteúdo textual;
3. lê o limite visual renderizado;
4. usa conversão temporária para texto de ponto como fallback;
5. exclui a cópia e restaura o layer original.

O objetivo é centralizar o bloco visual realmente desenhado, e não os limites teóricos da caixa de texto.

## Margem de segurança

<code>_positionLayerWithinSelection()</code> recebe <code>useSafetyMargin</code>.

A regra atual no alinhamento principal é:

~~~js
var useSafetyMargin = !state.phantomGeometryProvided ||
  (state.phantomHasCompletion === true &&
   state.phantomIsRectangular !== true);
~~~

Consequências:

- geometria retangular explícita: margem zero;
- geometria intacta explícita: margem zero;
- geometria cortada: margem de até 5%;
- chamadas legadas sem geometria explícita: comportamento conservador anterior.

O deslocamento final continua sendo:

~~~text
targetCenter = selectionCenter + phantomOffset
appliedMove = targetCenter - renderedTextCenter
~~~

Não reintroduzir correções fixas de itálico, DPI, baseline ou escala sem evidência de medição.

## Debug atual

Arquivos principais:

- <code>app_src/components/previewBlock/BalloonCenteringDebug.jsx</code>;
- <code>app_src/context.jsx</code>;
- <code>app_src/components/footer/footer.jsx</code>;
- <code>app_src/components/previewBlock/previewBlock.jsx</code>;
- <code>app_src/utils.js</code>;
- <code>app_src/host.js</code>.

O painel mostra:

- limites da seleção;
- classificação retangular;
- completion;
- linhas amostradas;
- limites renderizados do texto;
- centro-alvo;
- deslocamento aplicado;
- margem efetivamente aplicada;
- análise bruta do host.

O host também envia <code>sampledRows</code>, <code>polygons</code> e <code>geometryAnalysis</code>. Antes disso, o host enviava <code>sampledShape</code> e <code>phantomFit</code>, mas o componente esperava nomes diferentes, fazendo várias seções aparecerem vazias.

Para um retângulo correto, o resultado esperado é:

~~~text
Formato Retangular: Sim
Tem Completion: Não
Margem X aplicada: 0 px
Margem Y aplicada: 0 px
pixelOffsetX: 0
pixelOffsetY: 0
isCut: false
~~~

## Correção de Balões Normais / Intactos (Elipses com Rabicho)

Foi resolvido o falso positivo de corte em balões normais/intactos (elipses ou ovais com rabicho de fala apontando para a esquerda/direita):

### Problema:
Um balão intacto com rabicho de fala estreito tocando a extremidade (`left = 0.00`) tinha apenas 2 a 3 linhas com largura $> 0.2$. O cálculo de `leftCutRatio` usava `leftFlatCount / validIndices.length`, resultando em $3/3 = 100\%$ e acionando falso `isLeftCut = true` e `Tem Completion: Sim`. Além disso, a detecção lateral transferia o centroide vertical de massa ($Y = 0.45$) para `targetNormY`, empurrando o texto verticalmente por $-10.45\text{ px}$.

### Solução implementada:
1. **Critérios robustos de corte lateral em `phantomEllipse.js` e `host.js`:**
   - Exigência de contagem mínima de linhas planas (`minCutRows = Math.max(5, Math.floor(n * 0.35))`);
   - Exigência de volume mínimo de linhas válidas (`validIndices.length >= Math.max(6, Math.floor(n * 0.40))`);
   - Exigência de largura máxima substancial da forma (`maxRowWidth >= 0.45`).
2. **Isolamento de eixos:**
   - Balões sem corte vertical explícito (`!isTopCut && !isBottomCut`) mantêm `targetNormY = 0.5` estritamente.
   - Balões sem corte lateral explícito (`!isLeftCut && !isRightCut`) mantêm `targetNormX = 0.5` estritamente.
3. **Proteção para balões intactos no fitting:**
   - Se `!hasCutEvidence` (sem corte e sem evidência angular em polígonos reais), `reconstructPhantomBalloon` e `_fitPhantomEllipseForSelection` retornam centro literal $(0, 0)$ com `hasCompletion: false` e margem de segurança desativada.
4. **Alinhamento do `textShapeR.js`:**
   - `getShapeProfileGeometry` retorna geometria intacta neutra quando `phantom && !phantom.hasCompletion`, sem cair em fallbacks 1D espúrios.
5. **Regressão adicionada:**
   - `Case 8: User diagnostic speech tail balloon` em `scripts/testMangaBalloonCentering.js`.

## Correção do Loop do TextShapeR e da Demora Inicial de Inicialização

1. **Eliminação do Loop Infinito no TextShapeR + Detecção de Balão:**
   - Em `app_src/host.js`, `getActiveLayerBubbleShape` e `getCurrentSelectionShape` executavam `_withSuspendedHistory`, o que incrementava o índice de histórico do Photoshop (`_getActiveHistoryIndex()`). O painel detectava a nova assinatura de camada e disparava novos scans em loop contínuo.
   - **Solução:** Reversão imediata de `doc.activeHistoryState = previousHistoryState` logo após a amostragem, tornando os scans 100% transientes, sem poluir o histórico e sem disparar falsos eventos de modificação.
   - Em `app_src/components/previewBlock/previewBlock.jsx`, `refreshInlineSelectionShape` foi estabilizada através de `bubbleAwareRef`, impedindo que o listener de eventos principal se desmonte e reinicie em cascata.

2. **Eliminação do Bloqueio de 3 Minutos na Inicialização (`_PATH_SCAN_RETRY_MS`):**
   - Em `app_src/host.js`, `_sampleSelectionShapeViaPath` possuía uma trava de 3 minutos (`var _PATH_SCAN_RETRY_MS = 3 * 60 * 1000;`) que desativava o scan vetorial de caminhos e a extração de polígonos caso houvesse 3 tentativas iniciais antes do documento estar pronto.
   - O código também abortava caso houvesse um WorkPath residual não excluído (`if (_findWorkPath(doc)) return null;`).
   - **Solução:**
     - Remoção completa do bloqueio de 3 minutos (`_PATH_SCAN_RETRY_MS` e contador `pathScanFails >= 3`).
     - Limpeza preventiva automática de WorkPaths residuais (`_deleteWorkPath()`) antes de gerar novos caminhos.
     - Padronização da amostragem em 21 scans para exibição imediata na tabela do diagnóstico.

## Correção da Margem de Segurança em Balões Intactos e Unificação do Atalho

1. **Correção do Cálculo da Margem de Segurança (`useSafetyMargin`):**
   - No `host.js`, quando `state.phantomGeometryProvided` era falso (como em chamadas legadas ou via atalho de teclado), a condição fazia `var useSafetyMargin = !state.phantomGeometryProvided || ...`, forçando `useSafetyMargin = true` (com margem de 5% = 8px e 11px) mesmo quando a própria análise do host detectava `isCut: false`.
   - **Solução:** O `host.js` agora respeita a análise geométrica:
     ```javascript
     if (state.phantomGeometryProvided) {
       useSafetyMargin = state.phantomHasCompletion === true && state.phantomIsRectangular !== true;
     } else {
       var isRect = _isRectangularShapeES3({ bounds: selection, rows: sampledRowsForCheck, polygons: sampledPolyForCheck });
       var hostPhantom = (debugData && debugData.phantomFit) || phantom;
       useSafetyMargin = !isRect && !!hostPhantom && hostPhantom.isCut === true;
     }
     ```
   - Para balões intactos e retangulares, `useSafetyMargin` é `false` (0px de margem), usando o centro literal e exato.

2. **Unificação do Atalho (`WIN+ALT`) com o Botão e Diagnóstico:**
   - Em `app_src/shortcutCommands.js`, o atalho `center` agora passa os parâmetros de diagnóstico (`collectDebug` e callback de dispatch `setBalloonCenteringDebugData`).
   - Tanto o atalho quanto o botão agora atualizam a janela de diagnóstico e aplicam a mesma precisão matemática.

## Testes executados

Todos passaram com 100% de precisão:

~~~powershell
npm test
npm run build
node scripts/testHostBalloonCentering.js
node scripts/testPhantomEllipse.js
node scripts/testMangaBalloonCentering.js
node scripts/testTextShapeR.js
~~~

## Arquivos importantes

| Arquivo | Responsabilidade |
|---|---|
| <code>app_src/components/previewBlock/previewBlock.jsx</code> | Inicia o alinhamento e envia a geometria do painel. |
| <code>app_src/utils.js</code> | Serializa os parâmetros e recebe o retorno do host. |
| <code>app_src/host.js</code> | Seleção, amostragem, medição, margem e movimentação. |
| <code>app_src/textShapeR.js</code> | Perfil da forma e geometria usada pelo painel. |
| <code>app_src/phantomEllipse.js</code> | Classificação e reconstrução geométrica. |
| <code>app_src/components/previewBlock/BalloonCenteringDebug.jsx</code> | Interface do diagnóstico. |
| <code>scripts/testMangaBalloonCentering.js</code> | Casos sintéticos e regressão do perfil invertido e rabicho. |
| <code>docs/centralizacao-baloes.md</code> | Documentação técnica anterior e mais ampla. |

## Próxima investigação recomendada

1. Reexecutar o alinhamento no mesmo balão de mangá usado no diagnóstico.
2. Confirmar se o debug mostra:
   - `Formato Retangular: Não`
   - `Tem Completion: Não`
   - `Margem X aplicada: 0 px`
   - `Margem Y aplicada: 0 px`
   - `Applied Offset X: 0 px` (ou ajuste milimétrico para o centro)
   - `Applied Offset Y: 0 px`
   - `Target Center`: exatamente no centro da seleção `(736, 151)`.
3. Testar outros balões normais/elipses com cauda apontando para direções variadas (baixo, esquerda, direita).
4. Testar balões realmente cortados pela borda do quadrinho (sangria) e verificar que `Tem Completion: Sim` continua funcionando perfeitamente quando há corte real.

## Cuidados para a próxima IA

- Não remover a distinção entre geometria fornecida pelo painel e fallback legado.
- Não usar somente <code>phantomOffsetX !== 0</code> para decidir se existe corte.
- Não interpretar qualquer deslocamento do texto como clamp; deslocamento normal até o centro não é clamp.
- Não aplicar correções fixas de baseline, itálico, DPI ou escala sem evidência.
- Manter a classificação do host sincronizada com <code>phantomEllipse.js</code>.
- O import em <code>previewBlock.jsx</code> usa <code>textShapeRFitpreview</code>, enquanto o arquivo se chama <code>textShapeRFitPreview.jsx</code>. O build Windows passa, mas essa diferença pode quebrar em ambiente case-sensitive.
- O working tree contém alterações anteriores do projeto. Não usar <code>git reset --hard</code>, <code>git checkout --</code> ou apagar arquivos sem autorização.

## Estado do Git

As alterações ainda não foram commitadas. O diretório contém mudanças no debug, na centralização, nos testes e nos arquivos de idioma. A próxima IA deve começar com:

~~~powershell
git status --short
git diff --stat
~~~

e preservar todas as mudanças existentes antes de continuar.
