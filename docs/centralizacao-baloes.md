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
8. restaura a visibilidade do texto e remove a seleção temporária.

O resultado fica em cache por layer, dimensões e assinatura da origem. Mover o texto não altera o formato do balão; mudança de tamanho ou refresh explícito invalida o cache.

### 3.3 Amostragem do contorno

`_sampleSelectionShapeViaPath` tenta converter a seleção em um Work Path. A rota rápida lê os polígonos e usa linhas horizontais para encontrar `left`, `right` e `width`. Essas linhas são normalizadas em relação aos limites da seleção, não a um modelo universal de elipse.

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

Se o Work Path falhar, o host usa a amostragem legada por linhas. Se ainda não houver dados suficientes, usa um perfil baseado apenas nos limites retangulares. Depois de três falhas no caminho rápido, ele entra em backoff por três minutos.

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

Quando não há corte direcional:

- o centro horizontal usa a mediana dos centros das linhas;
- o centro vertical é fixado em `0.5` da altura;
- não há reconstrução de uma elipse ausente;
- o offset geométrico esperado é zero ou muito próximo de zero.

A mediana impede que uma cauda curta, uma ponta ou uma irregularidade desenhada à mão incline todo o centro. Essa regra é a proteção principal dos balões intactos.

### 4.3 Balão cortado

Uma lateral pode ser marcada como cortada quando muitas linhas mantêm uma borda reta:

- `isLeftCut` identifica borda esquerda;
- `isRightCut` identifica borda direita;
- a outra lateral precisa manter comportamento compatível com um arco.

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

Antes do movimento, há uma proteção contra estouro:

- a margem máxima é 5% da seleção;
- a margem também é limitada pelo espaço que sobra entre texto e bordas;
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

### 7.2 Alinhar um layer existente

Ao clicar em centralizar:

1. o painel usa a geometria já detectada, quando disponível;
2. envia `phantomOffsetX`, `phantomOffsetY` e `phantomGeometryProvided`;
3. o host esconde temporariamente o texto;
4. se a geometria veio do painel, mantém os limites da seleção original e não faz nova abertura adaptativa;
5. redimensiona a caixa opcionalmente;
6. mede os pixels renderizados;
7. só usa a análise geométrica do host quando não recebeu geometria válida;
8. posiciona o layer e restaura visibilidade/tipo de texto.

`phantomGeometryProvided` é necessário porque `(0, 0)` pode ser uma resposta correta. Sem esse sinal, um balão simétrico poderia ser tratado como “não analisado” e receber uma segunda correção do host.

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
- backoff após falhas repetidas do caminho rápido;
- limite de deslocamento geométrico de 5%;
- nenhum deslocamento fantasma para geometrias simétricas ou retangulares;
- uso de `suspendHistory` para reduzir poluição do histórico;
- cache da forma do balão para evitar reamostragem a cada atualização.

## 10. Testes existentes

Os testes automatizados cobrem principalmente regras e dados puros.

### `testHostBalloonCentering.js`

Confere reconhecimento de retângulos, fórmulas de cortes, limite de 5%, evidência de arco parcial, ausência de heurísticas de itálico/DPI, preservação de `phantomGeometryProvided`, quadro de coordenadas e preferência por limites rasterizados.

### `testMangaBalloonCentering.js`

Verifica círculo simétrico, balão achatado, cortes laterais, balão orgânico, balão intacto com cauda curta e caixa retangular.

### `testPhantomEllipse.js`

Verifica ajuste de elipse intacta, cortes laterais e diagonais, cortes verticais, neutralidade em formas retangulares, geração de linhas e limite seguro.

Esses testes não substituem um teste visual dentro do Photoshop. Eles confirmam a matemática e as proteções, mas não reproduzem integralmente diferenças de fonte, anti-aliasing, escala do documento e comportamento de cada versão do Photoshop.

## 11. Relatório técnico

### 11.1 O que está bem resolvido

1. **Separação entre geometria e medição do texto**: o balão fornece o alvo e o texto fornece o próprio centro visual.
2. **Medição por pixels da cópia temporária**: evita alterar o layer original e é mais fiel para blocos com várias linhas.
3. **Proteção para balões intactos**: formatos simétricos não recebem reconstrução de elipse sem evidência de corte.
4. **Tratamento de formatos não universais**: o algoritmo trabalha com linhas e polígonos observados, em vez de assumir que toda série usa a mesma elipse.
5. **Limite de segurança**: um erro de detecção não pode deslocar o texto indefinidamente.
6. **Fallbacks**: falhas do Work Path, de seleção ou de recursos de versões antigas não interrompem todo o fluxo.
7. **Controle de histórico e cache**: a solução considera o custo real das operações no Photoshop.

### 11.2 Limitações atuais

| Prioridade | Limitação | Efeito provável |
|---|---|---|
| Alta | A rota de criação usa abertura adaptativa mesmo quando o painel poderia fornecer a geometria original. | O quadro usado para criar o texto pode não ser exatamente o quadro usado para analisar o balão. |
| Alta | A rota de múltiplas seleções armazenadas não transporta offsets geométricos por seleção. | Balões cortados podem ser centralizados apenas pelo centro retangular no modo batch. |
| Alta | Host e painel mantêm duas implementações parecidas da análise geométrica. | Uma correção futura em um lado pode divergir do outro. |
| Média | A rasterização temporária é mais fiel, mas pode ser cara em documentos grandes. | O botão centralizar pode ficar mais lento em uso repetitivo. |
| Média | Os testes não executam o fluxo real dentro do Photoshop. | Problemas específicos de versão, fonte ou anti-aliasing podem passar despercebidos. |
| Média | O centro dos pixels é geométrico, não necessariamente óptico. | Textos com letras muito assimétricas podem parecer ligeiramente deslocados mesmo com limites exatos. |
| Baixa | O modelo de corte usa limiares fixos, como 55% de borda plana e 5% de deslocamento. | Uma série com balões muito incomuns pode exigir calibração diferente. |

### 11.3 Melhorias recomendadas

#### P0 — validar o resultado visual no Photoshop

Criar um pequeno conjunto de PSDs reais com balões ovais intactos, balões altos e largos, caudas, cortes laterais e verticais, caixas retangulares e textos de uma a cinco linhas. Incluir fontes com itálico, descendentes, acentos e tamanhos diferentes.

Para cada caso, registrar limites do balão, limites renderizados do texto, alvo calculado e deslocamento final. Isso transforma a comparação visual em uma regressão reproduzível.

#### P1 — unificar o contrato de geometria

Criar um formato único para transportar:

```js
{
  bounds,
  rows,
  polygons,
  offsetX,
  offsetY,
  isRectangular,
  hasCompletion,
  sourceFrame
}
```

Esse contrato deve ser usado pelo alinhamento interativo, criação de layer, múltiplas seleções e aprendizado do TextShapeR. `sourceFrame` deve identificar os limites exatos usados na amostragem.

#### P1 — centralizar a análise geométrica em uma única implementação

A versão do host precisa continuar compatível com ExtendScript, mas a lógica matemática pode ser compartilhada por um módulo puro ou por casos de teste comuns. O objetivo é evitar que `phantomEllipse.js` e `_analyzeMangaBalloonGeometryES3` evoluam de forma diferente.

#### P1 — levar a geometria para o modo batch

Ao armazenar uma seleção, guardar também suas linhas, polígonos e offsets. Na criação em lote, cada seleção deve usar o próprio centro geométrico reconstruído, em vez de chamar apenas `_positionLayerWithinSelection(selection, bounds)`.

#### P2 — reduzir o custo da rasterização

Manter um cache curto dos limites renderizados, invalidado por alteração do conteúdo, tamanho, fonte, estilo, tipo de texto ou resolução relevante. O cache não pode sobreviver a uma alteração real do layer.

#### P2 — adicionar diagnóstico opcional

Um modo de depuração poderia mostrar retângulo da seleção, linhas amostradas, centro geométrico, centro reconstruído, limites rasterizados do texto, alvo final, deslocamento aplicado e motivo do fallback. Isso diferencia rapidamente “geometria errada” de “texto medido errado”.

#### P2 — separar centro geométrico de centro óptico como opção

O comportamento padrão deve continuar baseado nos pixels, porque é mais neutro entre séries. Uma opção avançada poderia aplicar um ajuste aprendido por fonte/estilo, desde que seja opcional, limitado, reversível e não altere balões intactos automaticamente sem evidência.

#### P3 — substituir limiares universais por configuração contextual

Os limites de corte e o deslocamento máximo podem futuramente considerar proporção do balão, quantidade de linhas, distância entre a borda reta e o arco, histórico de confirmações e perfil do projeto. Isso deve ser feito somente depois de existir uma coleção de exemplos reais.

## 12. Conclusão

A centralização atual tem uma base sólida: mede o texto renderizado, trata a geometria do balão separadamente e evita aplicar uma elipse universal em formatos intactos. O ponto mais sensível deixou de ser a correção artificial de baseline e passou a ser a consistência entre as diferentes rotas de criação, alinhamento e batch.

O próximo passo mais valioso é criar uma suíte visual dentro do Photoshop e unificar o contrato geométrico. Isso permitirá melhorar os casos difíceis sem sacrificar os balões intactos que já estão funcionando corretamente.
