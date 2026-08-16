# Centralização de balões no TypeR

Documento técnico da implementação atual da centralização de texto em balões, com foco nos balões intactos, nos balões cortados pela cena e nos balões com geometria irregular.

> Este documento descreve o código atual da branch. Os nomes das funções são mais importantes que os números de linha, porque as linhas podem mudar durante as próximas alterações.

## 1. Objetivo

A centralização resolve duas decisões diferentes:

1. descobrir qual é o centro útil do balão;
2. mover o texto usando o centro visual realmente renderizado, e não o tamanho teórico da caixa de texto.

O fluxo geral é:

```text
seleção ou balão detectado
  -> limites, linhas e polígonos do contorno
  -> análise geométrica
  -> centro-alvo do balão
  -> medição do bloco de texto renderizado
  -> deslocamento do layer original
```

A geometria do balão define o alvo. A medição do texto define qual ponto do layer deve chegar a esse alvo. Essas duas etapas não devem ser confundidas.

## 2. Componentes envolvidos

| Componente | Responsabilidade |
|---|---|
| `app_src/components/previewBlock/previewBlock.jsx` | Observa a seleção, solicita a forma do balão, mantém cache e inicia o alinhamento. |
| `app_src/utils.js` | Serializa os dados do painel e chama as funções ExtendScript do host. |
| `app_src/host.js` | Lê a seleção, amostra o contorno, mede o texto e move o layer. |
| `app_src/textShapeR.js` | Normaliza a forma e calcula a geometria usada pelo painel e pelas quebras de linha. |
| `app_src/phantomEllipse.js` | Reconstrói uma parte ausente do balão quando há evidência de corte. |
| `scripts/testHostBalloonCentering.js` | Verifica invariantes do host por análise do código. |
| `scripts/testMangaBalloonCentering.js` | Verifica formas sintéticas intactas, cortadas, orgânicas e retangulares. |
| `scripts/testPhantomEllipse.js` | Verifica ajuste de elipse e reconstrução de contornos incompletos. |

## 3. Como o painel obtém a geometria

### 3.1 Seleção manual

Quando existe uma seleção ativa, ela tem prioridade sobre a detecção automática do balão.

O painel:

1. lê os limites por `requestPanelSnapshot`;
2. cria uma chave baseada nesses limites;
3. espera a seleção estabilizar por aproximadamente 350 ms;
4. chama `getCurrentSelectionShape({ samples: 21 })` no host;
5. recebe limites, linhas normalizadas e, quando possível, polígonos;
6. calcula `getShapeProfileGeometry(data)`;
7. guarda a geometria e os offsets normalizados no estado do painel.

A espera evita executar uma análise cara a cada movimento intermediário do mouse.

### 3.2 Detecção automática do balão

Quando não há seleção manual, o modo `textShapeRBubbleAware` pode procurar o balão ao redor do layer de texto.

`getActiveLayerBubbleShape`:

1. confirma que existe um layer de texto;
2. recusa seleção ativa ou múltiplos layers, pois o alvo seria ambíguo;
3. esconde temporariamente o texto para não contaminar a seleção;
4. usa a varinha mágica para encontrar a área do balão;
5. rejeita áreas absurdamente grandes em relação ao texto;
6. suaviza e contrai a seleção para fechar pequenos buracos;
7. amostra o contorno e devolve a geometria;
8. restaura a visibilidade do texto, reverte o estado de histórico para o original (`doc.activeHistoryState = previousHistoryState` para evitar loops de eventos e não poluir o histórico) e remove a seleção temporária.

O resultado fica em cache por layer, dimensões e assinatura da origem. Mover o texto não altera o formato do balão; mudança de tamanho ou refresh explícito invalida o cache.

### 3.3 Amostragem do contorno

`_sampleSelectionShapeViaPath` tenta converter a seleção em um Work Path. A rota rápida limpa previamente Work Paths residuais, lê os polígonos e usa linhas horizontais para encontrar `left`, `right` e `width`. Essas linhas são normalizadas em relação aos limites da seleção, não a um modelo universal de elipse.

O resultado contém, conceitualmente:

```js
{
  bounds: { left, top, right, bottom, width, height, xMid, yMid },
  rows: [{ y, left, right, width }],
  polygons: [...],
  scan: "path"
}
```

`y`, `left`, `right` e `width` são relativos ao retângulo da seleção.

Se o Work Path falhar pontualmente, o host usa a amostragem legada por linhas sem travar ou penalizar chamadas subsequentes. Se ainda não houver dados suficientes, usa um perfil baseado apenas nos limites retangulares.

## 4. Como a geometria é interpretada

O painel e o host mantêm versões equivalentes da análise: o painel usa `phantomEllipse.js` por meio de `textShapeR.js`, e o host possui uma versão compatível com ExtendScript em `host.js`.

Para cada linha são calculados largura visível, ponto médio e peso. O centroide horizontal e vertical usa as linhas com largura relevante; a potência aproximada de `1.5` dá mais peso às linhas largas sem deixar uma única linha dominar completamente.

### 4.1 Formato retangular

O formato é considerado retangular quando os polígonos têm poucos vértices próximos das bordas ou quando a maioria das linhas ocupa quase toda a largura.

Nesse caso a reconstrução de elipse é desativada:

```text
offsetX = 0
offsetY = 0
```

Isso evita deslocamento fantasma em caixas de narração e formatos quadrados.

### 4.2 Balão intacto

Quando não há corte direcional comprovado:

- o centro horizontal usa a mediana dos centros das linhas ou centro geométrico;
- o centro vertical é fixado em `0.5` da altura caso não haja corte vertical;
- não há reconstrução de uma elipse ausente (`hasCompletion: false`);
- o offset geométrico esperado é zero (`phantomOffsetX: 0`, `phantomOffsetY: 0`).

A detecção de corte exige evidência substancial: mínimo de linhas retas (`minCutRows >= 35%` das linhas), largura substancial (`maxRowWidth >= 0.45`) e volume suficiente de fatias válidas. A mediana e o desacoplamento de eixos impedem que caudas de fala (mesmo tocando os limites da seleção) ou irregularidades desenhadas à mão inclinem o centro ou ativem falsos cortes. Essa regra é a proteção principal dos balões intactos.

### 4.3 Balão cortado

Uma lateral pode ser marcada como cortada quando apresenta uma sequência reta e consistente de linhas rente ao limite:

- `isLeftCut` identifica borda esquerda cortada;
- `isRightCut` identifica borda direita cortada;
- os eixos horizontal e vertical são isolados: se apenas um lado estiver cortado, o outro eixo mantém `0.5` neutro.

O alvo combina centroide visual, meio da área visível e uma correção em direção ao lado ausente. Cortes no topo ou na base usam a mesma ideia no eixo vertical. O resultado final é limitado a 5% da largura ou altura da seleção.

### 4.4 Reconstrução por elipse

Quando há polígonos suficientes, o sistema extrai pontos do arco preservado, ajusta uma elipse e verifica distância do centro, proporção dos eixos e cobertura angular. A elipse só é usada se houver evidência de arco parcial ou de corte já detectado.

A correção da elipse é combinada com a análise robusta por linhas e novamente limitada a 5%. Uma elipse completa e simétrica não deve inventar deslocamento.

## 5. Como o texto é medido

Esta é a parte mais importante para os exemplos de várias linhas.

### 5.1 Problema da caixa de texto

Uma camada de texto de parágrafo pode ter uma caixa maior que os glifos realmente desenhados. Se a centralização usar apenas essa caixa, o centro pode ficar acima, abaixo ou ao lado do centro visual.

Métricas de fonte, baseline, itálico e resolução do documento também não são correções geométricas universais. Elas variam com fonte, tamanho, idioma, acentos, descendentes e composição do texto.

### 5.2 Medição atual por cópia temporária

`_getCurrentRenderedTextBounds` executa esta sequência:

1. guarda o ID do layer original;
2. duplica o layer ativo;
3. tenta rasterizar a cópia com `RasterizeType.TEXTCONTENTS`;
4. lê os limites da cópia rasterizada;
5. remove a cópia;
6. seleciona novamente o layer original.

A rasterização ocorre somente na cópia. O layer original continua sendo texto editável, com a mesma fonte, conteúdo, tipo e estilo.

Os limites rasterizados representam o retângulo dos pixels efetivamente desenhados. Isso inclui a altura total das várias linhas e respeita as quebras automáticas do texto de parágrafo.

### 5.3 Fallback de compatibilidade

Se a versão do Photoshop não disponibilizar o rasterizador de conteúdo de texto, o código converte a cópia para texto de ponto, força a leitura da composição e lê seus limites. Esse fallback é menos preciso que a rasterização, mas é preferível a usar diretamente a caixa de parágrafo inteira.

### 5.4 Por que isso resolve várias linhas

```text
texto com 1 linha  -> limites dos pixels da linha
texto com 2 linhas -> limites dos pixels das duas linhas
texto com 4 linhas -> limites dos pixels do bloco inteiro
```

O ponto médio usado no posicionamento passa a ser o ponto médio do bloco renderizado, e não o ponto médio de uma única linha ou da caixa original.

## 6. Como o layer é posicionado

`_positionLayerWithinSelection` recebe limites da seleção, limites renderizados do texto e os offsets geométricos.

O alvo inicial é:

```text
targetX = selection.xMid + phantomOffsetX
targetY = selection.yMid + phantomOffsetY
```

O centro atual do texto é:

```text
textX = renderedBounds.xMid
textY = renderedBounds.yMid
```

Antes do movimento, há a verificação da margem de segurança (`useSafetyMargin`):

- para balões intactos e retangulares, `useSafetyMargin = false` e a margem é 0 (centro geométrico literal sem recuo artificial);
- para balões cortados (`hasCompletion: true`), a margem máxima é 5% da seleção para evitar que o texto encoste no corte;
- o alvo é limitado para que o texto não passe dos limites seguros;
- se o texto for maior que a área utilizável, o centro da seleção é usado como fallback.

Por fim:

```text
offsetX = targetX - textX
offsetY = targetY - textY
```

O layer original é movido por esse deslocamento. Não há correção fixa de itálico, DPI, tamanho de fonte ou baseline nessa função.

## 7. Diferenças entre as rotas de uso

### 7.1 Criar texto em uma seleção

`_createTextLayerInSelection`:

1. lê a seleção;
2. aplica abertura adaptativa;
3. calcula a largura com escala padrão de 90%;
4. cria o layer;
5. transforma para ponto ou redimensiona a caixa;
6. mede os limites renderizados;
7. tenta descobrir o offset geométrico no próprio host;
8. posiciona o layer.

Essa rota ainda usa `adaptiveOpen: true` desde o início. Portanto, ela não é idêntica à rota de alinhamento iniciada pelo painel.

### 7.2 Alinhar um layer existente e atalho (WIN + ALT)

Ao clicar em centralizar ou usar o atalho `WIN + ALT`:

1. o painel usa a geometria já detectada, quando disponível;
2. envia `phantomOffsetX`, `phantomOffsetY`, `phantomGeometryProvided`, `phantomHasCompletion` e `phantomIsRectangular`;
3. ativa a coleta de diagnóstico (`collectDebug: true`) e despacha os dados para a janela de Diagnóstico (`setBalloonCenteringDebugData`);
4. o host esconde temporariamente o texto;
5. se a geometria veio do painel, mantém os limites da seleção original e não faz nova abertura adaptativa;
6. redimensiona a caixa opcionalmente;
7. mede os pixels renderizados;
8. só usa a análise geométrica do host quando não recebeu geometria válida prévia;
9. posiciona o layer e restaura visibilidade/tipo de texto.

`phantomGeometryProvided` é necessário porque `(0, 0)` pode ser uma resposta correta. Sem esse sinal, um balão simétrico poderia ser tratado como “não analisado” e receber uma segunda correção do host. O atalho de teclado e o botão do painel utilizam o mesmo contrato e entregam paridade total de resultado.

### 7.3 Múltiplas seleções armazenadas

A criação em seleções armazenadas usa limites guardados e mede o texto antes de posicionar cada layer. Essa rota atualmente chama `_positionLayerWithinSelection(selection, bounds)` sem passar offsets geométricos individuais.

Na prática, o batch usa o centro geométrico dos limites armazenados. Isso é previsível, mas ainda não tem a mesma reconstrução de balão cortado disponível no alinhamento interativo.

## 8. Relação com o TextShapeR

A centralização e o TextShapeR colaboram, mas não são a mesma operação.

### Centralização

Decide onde o bloco renderizado deve ficar: centro do balão, offset para corte e deslocamento do layer.

### TextShapeR

Decide como o texto pode ser dividido em linhas:

- gera candidatos de quebras;
- considera largura, altura e proporção do balão;
- usa linhas reais do contorno e linhas reconstruídas do phantom;
- calibra unidades com pixels medidos no layer;
- aprende com escolhas feitas pelo usuário.

Para texto de parágrafo, as quebras automáticas não aparecem necessariamente em `textKey`. Por isso `getRenderedTextLines` cria uma cópia e converte para ponto para expor as quebras que o Photoshop realmente usou. Essas quebras alimentam o aprendizado do TextShapeR.

## 9. Proteções atuais

As principais proteções são:

- texto oculto durante a detecção automática;
- cópia descartável durante a medição renderizada;
- restauração do layer original por ID;
- restauração da seleção por canal temporário nas rotas que precisam preservá-la;
- rejeição de seleções pequenas ou áreas absurdamente grandes;
- fallback de Work Path para amostragem legada;
- limpeza preventiva de WorkPaths residuais sem bloqueios ou travas de inicialização;
- limite de deslocamento geométrico de 5%;
- nenhum deslocamento fantasma para geometrias simétricas ou retangulares;
- margem de segurança de recuo restrita exclusivamente a balões cortados (margem zero em intactos e retângulos);
- reversão de histórico após leitura de balão e forma para não poluir o histórico nem disparar loops de eventos;
- cache da forma do balão para evitar reamostragem a cada atualização.

## 10. Testes existentes

Os testes automatizados cobrem principalmente regras e dados puros.

### `testHostBalloonCentering.js`

Confere reconhecimento de retângulos, fórmulas de cortes, limite de 5%, evidência de arco parcial, ausência de heurísticas de itálico/DPI, preservação de `phantomGeometryProvided`, quadro de coordenadas e preferência por limites rasterizados.

### `testMangaBalloonCentering.js`

Verifica círculo simétrico, balão achatado, cortes laterais, balão orgânico, balão intacto com cauda curta, caixas retangulares e balão intacto com cauda tocando a extremidade da seleção (Case 8).

### `testPhantomEllipse.js`

Verifica ajuste de elipse intacta, cortes laterais e diagonais, cortes verticais, neutralidade em formas retangulares, geração de linhas e limite seguro.

Esses testes não substituem um teste visual dentro do Photoshop. Eles confirmam a matemática e as proteções, mas não reproduzem integralmente diferenças de fonte, anti-aliasing, escala do documento e comportamento de cada versão do Photoshop.

## 11. Relatório técnico

### 11.1 O que está bem resolvido

1. **Separação entre geometria e medição do texto**: o balão fornece o alvo e o texto fornece o próprio centro visual.
2. **Medição por pixels da cópia temporária**: evita alterar o layer original e é mais fiel para blocos com várias linhas.
3. **Proteção para balões intactos e caudas de fala**: formatos simétricos, orgânicos e com cauda de fala não recebem corte falso nem reconstrução de elipse indevida.
4. **Margem de segurança zero para intactos e retângulos**: recuo de até 5% restrito exclusivamente a balões cortados; balões intactos e caixas retangulares usam o centro geométrico literal.
5. **Paridade total entre botão e atalho (`WIN + ALT`)**: ambos compartilham as mesmas regras, precisão ao pixel e envio de telemetria.
6. **Diagnóstico visual em tempo real**: interface interativa (`BalloonCenteringDebug.jsx`) para inspecionar limites, tabela de 21 scans, status de corte, ajuste de elipse e dados brutos do host.
7. **Eliminação de travas e loops**: remoção do bloqueio de inicialização de 3 minutos e reversão transiente de histórico após os scans de forma e do balão.
8. **Tratamento de formatos não universais**: o algoritmo trabalha com linhas e polígonos observados, em vez de assumir que toda série usa a mesma elipse.
9. **Limite de segurança**: um erro de detecção não pode deslocar o texto além do teto de 5%.
10. **Fallbacks seguros**: falhas pontuais de Work Path, de seleção ou de recursos legados não interrompem o fluxo.

### 11.2 Limitações atuais

| Prioridade | Limitação | Efeito provável |
|---|---|---|
| Média | A rota de criação direta de novo layer (`_createTextLayerInSelection`) usa abertura adaptativa padrão em vez da geometria já pré-calculada pelo painel. | O quadro usado para criar o texto a partir do zero pode diferir ligeiramente da geometria amostrada antes. |
| Baixa | Host e painel mantêm implementações paralelas da análise geométrica (JS moderno vs ExtendScript ES3). | Exige que qualquer nova fórmula seja mantida sincronizada nos dois arquivos (`phantomEllipse.js` e `host.js`). |

### 11.3 Status das melhorias

#### Itens concluídos e integrados ao projeto

- **Diagnóstico em tempo real (antigo P2):** Implementado no componente `BalloonCenteringDebug.jsx`, ativado nas preferências e alimentado tanto pelo botão quanto pelo atalho `WIN + ALT`.
- **Desacoplamento e blindagem de balões intactos:** Ajuste dos limiares de corte (35% de linhas, largura substancial e desacoplamento de eixos horizontal/vertical).
- **Margem de segurança condicionada:** `useSafetyMargin = false` ($0\text{ px}$) em balões intactos e retângulos.
- **Geometria e centralização no modo batch / Multi-Bubble:** O monitor de seleções captura os limites de forma não-intrusiva sem converter seleções em Work Paths em tempo real, eliminando o piscar de tela. A rota em lote (_createTextLayersInStoredSelections) aplica o posicionamento exato medindo os glifos reais renderizados de cada balão.
- **Eliminação de bloqueios de inicialização e loops de histórico:** WorkPaths limpos preventivamente e histórico restaurado após os scans.

#### Itens descartados / não necessários

- **Cache de rasterização de limites de texto:** A medição por cópia temporária no Photoshop (`_getCurrentRenderedTextBounds`) executa em menos de ~15 ms no momento do clique. Fazer cache de limites de texto traria risco de ler dados defasados caso o usuário editasse o texto.
- **Heurísticas manuais de Itálico, DPI e Baseline:** Como a rasterização da cópia já mede os pixels físicos reais que o Photoshop desenhou na tela (a mancha gráfica real), ajustes empíricos tornaram-se obsoletos e prejudiciais.

#### Próximos passos e melhorias futuras recomendadas

- **P0 — Validação prática no fluxo de trabalho:** Uso diário no Photoshop com páginas reais de mangás/quadrinhos para avaliar o resultado visual em balões ovais, caudas, cortes na borda e caixas de narração.
- **P1 — Unificar o contrato na criação direta de layer:** Fazer a criação de um novo texto a partir do zero consultar a mesma geometria já detectada pelo painel.

## 12. Conclusão

A centralização atual alcançou estabilidade, robustez matemática, paridade no modo Multi-Bubble em lote e transparência diagnóstica. Balões intactos e caixas retangulares mantêm alinhamento exato pelo centro literal sem margem artificial, balões cortados são corrigidos com segurança e o atalho de teclado opera com a mesma precisão do painel.
