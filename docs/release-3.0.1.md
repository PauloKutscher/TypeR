# TypeR 3.0.1 — integração UXP do fork

Integração do `ScanR/TypeR:develop` até `cccf0f5`, preservando as correções do fork `PauloKutscher/TypeR`. O ponto anterior à integração é `2df35aa`.

## O que mudou

- UXP, Smart Paste, colagem ao clicar, instaladores e atualização para Windows/macOS, junto das melhorias de interface, estilos, fontes e abas do upstream.
- Novo aprendizado do TextShapeR: ranker pareado, modelo de quebras e regras por idioma. Foram mantidas a geometria do fork, a atualização adiada do contorno, o reaproveitamento de balões e as proteções de camada/histórico.
- Geometria calibrada de centroide e separação de balões em `app_src/bubbleGeometry.jsxinc`, compartilhada pelo CEP e pelo alinhamento do UXP. Textos amontoados continuam usando a distribuição por ordem de leitura do Smart Paste.
- O alinhamento lê o contorno com tolerância de **0,5 px** nos dois hosts. Os 2 px usados pelo novo caminho suavizavam detalhes necessários aos cortes calibrados.
- Treinamento UXP converte as camadas em conjunto e lê o texto por identificador, com fallback por camada se a conversão conjunta for recusada. Trabalha em documento descartável.
- UXP preserva a formatação mista ao mudar tamanho, os estilos de todos os parágrafos, a proteção contra aplicar uma sugestão a outra camada e as consultas sem leitura de texto.
- Assinaturas de atualização do UXP incluem o documento, evitando reutilizar a informação de outra página.
- Configuração, manifesto CEP e pacotes gerados usam **3.0.1**. Atualizadores, migração e instaladores consultam os releases deste fork.

## Avaliação do TextShapeR

Mesmo benchmark determinístico (`textShapeRBench2 --quick`), mesma máquina, comparando o fork anterior, o upstream e o integrado. São preferências **simuladas**, não avaliações de um diagramador nem um corpus de qualidade visual em português.

| Medida | Fork anterior | Upstream novo | Integrado |
| --- | ---: | ---: | ---: |
| Preferida em primeiro, após 16 escolhas | 45% | 53% | 53% |
| Preferida entre as três primeiras, após 16 escolhas | 65% | 80% | 80% |
| Preferida em primeiro, contextos variados | 41% | 55% | 55% |
| Preferida entre as três primeiras, contextos variados | 66% | 80% | 80% |
| Arrependimento após 16 escolhas, menor é melhor | 2,86 | 1,57 | 1,57 |
| Acerto pareado da lista inteira, após 16 escolhas | 75,8% | 71,6% | 71,6% |
| Preferida em primeiro, 4 escolhas após mudar de preferência | 29% | 17% | 17% |
| Geração, mediana com memória cheia | 2,2 ms | 6,9 ms | 7,1 ms |

A escolha foi usar o aprendizado novo com as correções do fork: ele melhorou as primeiras sugestões neste teste e a integração manteve os resultados do upstream. Não houve melhora em todas as medidas: o modelo antigo reage melhor à troca abrupta de preferência e foi mais rápido. Não foi acrescentado um seletor de modelos nem um fallback automático sem evidência de necessidade.

Reproduzir no PowerShell local, na pasta do projeto, com Node 24 e dependências instaladas por `npm ci`:

```powershell
node scripts/textShapeRBench2.js 2df35aa --quick
node scripts/textShapeRBench2.js cccf0f5 --quick
node scripts/textShapeRBench2.js --quick
```

O harness resolve as dependências do modelo e remove seus diretórios temporários ao terminar. Tempos variam com máquina, carga e cache.

## Centralização: por que conservar a geometria do fork

Comparação com os contornos reais já versionados em `scripts/balloonOutlines.fixture.json`; erro medido contra o centro salvo na referência:

| Caso | Caminho original do upstream | Geometria do fork |
| --- | ---: | ---: |
| Balão superior da cadeia | 23,1 px | 5,1 px |
| Balão inferior da cadeia | 30,6 px | 1,9 px |
| Balão intermediário | 7,5 px | 7,4 px |

Os cortes calibrados foram reaproveitados no planejador compartilhado. As fixtures também verificam outros cortes e a distribuição de textos em balões duplos/triplos. Esses números não demonstram melhora universal em qualquer página.

No Photoshop 27.11.0 em Windows, a reconstrução de um desses contornos mostrou o efeito da precisão: leitura de 2 px resultou em aproximadamente 17 px de erro, enquanto a leitura de 0,5 px resultou em 5,2 px. Não foi necessário alterar as constantes calibradas.

## Verificação

- 92 suítes automatizadas de CEP, UXP, Smart Paste, armazenamento, atualização, fontes, atalhos e geometria; regressões específicas para precisão do contorno e treinamento em lote. Auditoria de dependências sem alertas.
- Build CEP com verificação dos artefatos, inventário, compatibilidade e caso Task 33.
- Pacotes UXP Windows/macOS com conferência de manifestos, binários e SHA-256; ZIP offline com validação de integridade.
- Photoshop 27.11.0 no Windows: abertura do painel UXP e importação inicial de dados CEP; Smart Paste real; consulta sem leitura da camada; assinatura por documento; recusa de camada desatualizada inclusive no fallback; mudança de tamanho mantendo três trechos de formatação; treinamento preservando histórico e camada selecionada. O botão de alinhamento no painel recompilado deixou o caso de balão encadeado a 5,1 px da referência.
- Em um PSD local com nove camadas de texto, a leitura UXP passou de 726 ms para 388 ms, sem erros. É uma medição pontual, sujeita a cache e ordem de execução; não representa uma garantia de desempenho.

Os testes no Photoshop usaram documentos descartáveis. Os PSDs de referência não são distribuídos. Não foi executado Photoshop em macOS nem em versões antigas; a compatibilidade desses ambientes ainda depende de validação real.

## Instalar no Windows

1. Baixe **TypeR.zip** deste release no repositório **PauloKutscher/TypeR**.
2. Clique com o botão direito no ZIP, escolha **Extrair tudo** e mantenha todos os arquivos e a pasta `installer` juntos.
3. Salve seus documentos e feche o Photoshop.
4. Na pasta extraída, dê duplo clique em `install_win.cmd`. Selecione **UXP** com as setas e confirme com Enter.
5. O instalador deve informar TypeR **3.0.1** instalado e verificar os arquivos. Reabra o Photoshop e acesse **Plug-ins → TypeR → TypeR**.
6. Na primeira abertura, confira suas pastas, estilos e perfis. A importação copia os dados CEP; a instalação CEP original permanece disponível.

Não é necessário informar credenciais do GitHub nem da Adobe para o instalador offline. Com Creative Cloud, o arquivo avulso para Windows é **UXP-Windows.ccx**; para macOS, **TypeR-UXP.ccx**. O ZIP inclui ambos.

Não mantenha os painéis CEP e UXP abertos juntos, pois ambos podem executar atalhos. Se precisar voltar ao CEP, feche o painel UXP e abra a instalação anterior em **Janela → Extensões (herdado)**, onde ela pode aparecer como **TypeR (old)** ou **TypeR (CEP)**. Os dados UXP ficam em `%APPDATA%\TypeR\UXP`, separados dos dados CEP.

## Diferenças deliberadas

- Os controles antigos de tamanho individual dos links do rodapé foram substituídos pelo novo rodapé de ícones e modos responsivos. As configurações originais continuam nos arquivos CEP.
- O bootstrap remoto Windows `get.ps1` não faz parte deste fork; use o instalador offline verificado do ZIP.
- Os canais de desenvolvimento permitem testes locais no Windows, mas não são incluídos nos pacotes de produção.
