# Integração da develop do upstream

A branch de integração reúne a fork PauloKutscher/TypeR em 74eb9c7, a develop de ScanR/TypeR em d7a3429 e as correções da candidata 12f83d9. O histórico incorpora os 60 commits upstream que faltavam à fork. As resoluções preservam as funções da fork quando o mesmo arquivo tem responsabilidades dos dois lados.

## Revisão por commit

| Área | Commits upstream | Resultado na integração |
| --- | --- | --- |
| Inicialização UXP, foco e atalhos | 82dfedd, 9a9a9e0, 5d34e40, 115a95a, 9907afc, 92fa808, 573e38d, 313994a, 10665ed, 5b1f7b9, 7c01506, b3e2444 | Guarda de sessão, inicialização, layout nativo de fallback, foco, preferência de colapso e leitor separado por Photoshop no macOS. O Windows mantém o addon e o caminho de execução da fork. O reparo automático e o launcher novo ficaram fora dos artefatos após o bloqueio no Windows. |
| TypeR Studio | 39dbae3, a00f5c1, 8d15830, 6a53c31, 8b2e99a | Importação do roteiro, integração com páginas, fontes e janela promocional. |
| Preferências e interface | 380e988, 479cd9b, 548c0d0, 64a2d18, 580fe2c, 523a99e, 90de323, 1ef8e59, 5034434, a694845, 819b5d7, 0277160, aa84d29, fc75575, f1ee423, d7a3429 | Novas preferências, navegação, RTL, idiomas, nomes, rolagem, atalhos, estilos e exportação. Mantidas as preferências da fork de tamanho, auto-wrap e pareamento de páginas. |
| Instaladores | f9d5677, 7a0a833, 7bf4b95, de57965, 7662b0b | Reuso do inventário validado, verificação do download, limpeza controlada de bundles antigos, detecção Rosetta e repasse da pasta do Photoshop no resgate. Preservados os URLs da fork e a transação Windows. |
| Smart Paste, TextShapeR e host Photoshop | 2f0fe12, 9bbd066, ce016f4, 007f7e1, 3b166cc, 59b939c, daa88fd, 921a60a, b25146d, a66fd2d, bc1dc67, 68709eb, 97cf33d | Integradas as resoluções de tamanho/unidades, espaços, idiomas, leitura de caminhos, documento já aberto, histórico e seleção. O planejamento e o encaixe de colagem da fork foram preservados. A mudança em Center aproveita o cálculo óptico de 97cf33d com o enquadramento da fork; o alvo integral do upstream e as alterações dependentes desse alvo ficaram fora da centralização de produção. |
| Armazenamento | 785c464, e15fcc3 | Retries e avisos de escrita tardia no painel. O cache de perfil permanece compatível com a fork. |
| Documentação | 3eaf370, 7a811d3 | Ajuda e histórico revistos com as notas do upstream. |
| Versões upstream | d0e2960, de183b7, 43b581c | Histórico incorporado. A versão dos artefatos continua 3.0.3.7 até uma publicação da fork. |
| Importação de estilos | e50bab5, 4623a96 | Módulo compartilhado e entradas no Settings, no editor de estilo e no menu da biblioteca. |

## Centralização medida no Photoshop

O laboratório chama alignCapture no Photoshop real, passa o resultado para o planAlignment do checkout escolhido e envia as posições retornadas para alignTextLayerToSelection. Os ganchos de telemetria da fork são opcionais. Quando um host não possui esses ganchos, a etapa de processamento e a medição do texto continuam. Cada variante abre cópias das mesmas páginas, e o laboratório verifica o hash dos originais.

| Variante | Cenário | Casos | Melhoraram | Equivalentes em ±1 px | Pioraram | Resultado |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Upstream puro | full | 27 | 4 | 16 | 7 | Reprovado |
| Primeiro híbrido, planejador upstream com fallback do host da fork | full | 27 | 7 | 12 | 8 | Reprovado |
| Híbrido com os dois planejadores e ajuste limitado | full | 27 | 1 | 26 | 0 | Aprovado |
| Híbrido com os dois planejadores e ajuste limitado | overlap | 20 | 2 | 18 | 0 | Aprovado |
| Implementação compacta, contorno da fork com centro óptico do upstream | full | 27 | 2 | 25 | 0 | Aprovado |
| Implementação compacta, contorno da fork com centro óptico do upstream | overlap | 20 | 2 | 18 | 0 | Aprovado |
| Build final, host e planejador da branch integrada | full | 27 | 1 | 26 | 0 | Aprovado |

O pior caso novo no upstream puro passou de 9,0 para 302,8 px. Na implementação compacta, a moldura e a escolha de compartimento permanecem as mesmas. Se o alvo óptico cair dentro da moldura e estiver a até 5% do lado menor do alvo original, Center usa o ponto médio entre os dois alvos. O maior deslocamento aceito da posição original fica limitado a 2,5% do lado menor. Em full, uma segunda passada teve oscilação adicional de raster de 4 px na horizontal e 2 px na vertical, com o alvo da geometria estável. Em overlap, nenhuma camada se moveu 1 px ou mais na segunda passada. As duas condições reutilizam páginas do mesmo corpus e não sustentam uma conclusão de velocidade. A medição foi feita no Photoshop 28.0.0 via CEP.

## Reproduzir no Windows

Use PowerShell 7 local, Git, Node 24 e Photoshop aberto. O checkout TypeR-fork-meter preparado nesta máquina contém as cópias do corpus, o manifesto de hashes e o dataset congelado. Em outro computador, prepare uma cópia do corpus nas pastas psd e true do checkout de laboratório, com o respectivo manifesto em .centering-lab/meta e cases.json em .centering-lab/runs. Use o manifesto e o dataset da mesma população de páginas.

No PowerShell local, na pasta da integração, compile a fork e a integração. Reutilize TypeR-fork-meter se ele já existir.

~~~powershell
npm.cmd ci
npm.cmd run build
$reviewHost = (Resolve-Path .\app\host.jsx).Path
$integration = (Get-Location).Path

if (-not (Test-Path ..\TypeR-fork-meter)) {
  git worktree add --detach ..\TypeR-fork-meter 74eb9c7
}
Push-Location ..\TypeR-fork-meter
npm.cmd ci
npm.cmd run build
$lab = (Get-Location).Path
$forkHost = (Resolve-Path .\app\host.jsx).Path
Pop-Location

.\scripts\lab\runIntegrationComparison.ps1 -Root $lab -BaselineHost $forkHost -BaselinePanelRoot $lab -CandidateHost $reviewHost -CandidatePanelRoot $integration -CandidateMode product -DatasetRun review-1118-190246-fork -Scatter full
~~~

O relatório deve indicar o número de casos comparáveis, as medições ausentes e o resultado do gate. O CSV e o run.json ficam nas novas pastas em .centering-lab/runs. No corpus local, o dataset acima tem 27 casos elegíveis. Para a condição overlap, use o dataset panel-overlap-201938-dataset com -Scatter overlap. Se os hashes divergirem, confira os arquivos e use uma cópia do corpus que corresponda ao manifesto.

Para validar UXP no Photoshop, execute npm.cmd run build:uxp:dev na integração. No UXP Developer Tool, adicione uxp/manifest.json, carregue um plug-in por vez e use cópias dos mesmos PSDs para testar Center e Smart Paste, com as mesmas fontes e camadas ativas. Repita Center para verificar estabilidade, confira o encaixe da tinta em relação ao contorno e teste texto de ponto, parágrafo, grupos de camadas e balões duplos e triplos. Descarregue o plug-in de desenvolvimento ao terminar.

## Verificações da integração

O npm run verify passou com 115 suítes. Os dois CCX foram gerados e verificados quanto a manifesto,
checksums e leitores de cada plataforma. No Windows, o instalador passou em 32 casos com o CCX final.

## Segurança e verificações pendentes

O antivírus bloqueou o script upstream de alteração da DLL do WebView. O teste do novo launcher recebeu Acesso negado ao iniciar o subprocesso. Os dois artefatos ficaram fora do pacote integrado. O fallback nativo do painel e os caminhos de execução da fork continuam disponíveis. As fontes e testes originais dessas mudanças permanecem no histórico upstream. A validação interativa de UXP no Photoshop e as rotinas macOS continuam pendentes.
