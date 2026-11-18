# Revisão da integração do upstream

A revisão parte da fork em 74eb9c7 e do upstream em d7a3429. O PR #3, em 12f83d9, continua sendo a referência do merge experimental. A auditoria inicial dessa candidata executou 119 suítes no Windows e registrou 23 falhas.

## Decisões

A revisão usa mudanças de 14 commits do upstream, 0277160, 5034434, 580fe2c, 59b939c, 64a2d18, 68709eb, 819b5d7, 90de323, 921a60a, a66fd2d, a694845, f1ee423, fc75575 e 1ef8e59.

- Resolvidos os conflitos da exportação de configurações e da rolagem. A exportação mantém as preferências de tamanho, quebra e pareamento de páginas da fork. A rolagem usa as posições reais ou virtualizadas das linhas e mantém a linha colada visível ao fim da página.
- Incorporados os ajustes de RTL e fallback de idioma, o tooltip de abas, o Enter nas ações de perfis e a confirmação ao sair de Settings. O diálogo UXP lê o idioma do perfil ativo.
- Incorporadas correções de texto e Smart Paste para tipo de texto ao copiar estilo, espaços consecutivos, ordem em balões triplos e reversão de falhas com o histórico cheio. A leitura de PSDs reconhece documentos já abertos pelo ID no Photoshop.
- O atualizador Windows usa a extração ZIP do .NET Framework depois da validação de caminhos. O teste do atualizador revelou que o Expand-Archive disponível neste Windows PowerShell 5.1 chamava uma sobrecarga incompatível.
- Permanecem em avaliação a centralização geométrica do upstream (97cf33d, daa88fd e b25146d), as mudanças de foco e reparo WebView, a reescrita dos instaladores, o TypeR Studio, a importação compartilhada e as alterações de armazenamento. A candidata do PR contém as tentativas anteriores para essas áreas.

## Medida no Photoshop

O corpus local forneceu três PSDs (11, 13 e 14), com 28 camadas e 27 casos elegíveis. A execução foi no Photoshop 28.0.0 com scatter full, tolerância 20, sem redimensionar e com padding zero. A candidata 12f83d9 teve 27 resultados equivalentes à fork em ±1 px, zero casos melhores e zero piores. Nenhuma camada se moveu 1 px ou mais na segunda passada. Uma execução de cada variante levou 136,5 s e 133,3 s, respectivamente. Essa amostra mede o host CEP e preservação, sem estimar ganho de velocidade.

A branch revisada repetiu os 27 casos com o host CEP de produção. Todos ficaram equivalentes à fork em ±1 px e nenhuma camada se moveu 1 px ou mais na segunda passada. A suíte local passou em 103 testes automatizados, a compilação CEP passou nas verificações de artefatos e inventário, o CCX Windows passou na validação da DLL nativa e os 32 testes Windows do instalador passaram com o pacote gerado.
O teste direto do host upstream parou em uma função de instrumentação da fork ausente nele. Os testes de lógica testSmartPasteCentre, testSmartPasteMargins e testAlignPlan passaram no checkout puro do upstream. Uma comparação de qualidade ainda precisa chamar alignCapture, planAlignment e alignTextLayerToSelection com as posições calculadas no painel upstream. Rodar somente a função final em JSX deixa de fora essa parte da centralização.

## Repetir a medição CEP no Windows

Use PowerShell 7 local com Git, Node 24 e Photoshop aberto. O laboratório abre cópias temporárias. Use um checkout de teste que já contenha psd, true, o manifesto congelado em .centering-lab/meta e o cases.json de uma corrida de referência em .centering-lab/runs. Os PSDs e relatórios privados ficam no computador.

Na pasta TypeR-upstream-reviewed, compile a branch e a referência da fork. Se você já tem o checkout TypeR-fork-meter, basta reutilizá-lo.

~~~powershell
npm.cmd ci
npm.cmd run build
$reviewHost = (Resolve-Path .\app\host.jsx).Path

if (-not (Test-Path ..\TypeR-fork-meter)) {
  git worktree add --detach ..\TypeR-fork-meter 74eb9c7
}
Push-Location ..\TypeR-fork-meter
npm.cmd ci
npm.cmd run build
$baselineHost = (Resolve-Path .\app\host.jsx).Path
Pop-Location
~~~

Escolha um laboratório e um dataset existentes. O exemplo usa a amostra preparada nesta revisão, quando disponível. Os dois lados recebem os mesmos parâmetros e o script imprime o resultado por categoria e topologia. O CSV e run.json ficam nas novas pastas em .centering-lab/runs.

~~~powershell
$lab = (Resolve-Path ..\TypeR-fork-meter).Path
$dataset = 'review-1118-190246-fork'
.\scripts\lab\runIntegrationComparison.ps1 -Root $lab -BaselineHost $baselineHost -CandidateHost $reviewHost -DatasetRun $dataset -Scatter full
~~~

Para uma amostra maior, use a pasta do corpus completo e o dataset correspondente. Se o manifesto divergir, confira a lista de arquivos com o corpus que gerou o dataset. Use uma cópia consistente de ambos antes de repetir. Compare também as condições none, mid, overlap e overlapmid e inclua uma rodada com redimensionamento e padding. Verifique quantas camadas realmente produziram medições. Uma categoria vazia pede mais amostras.

## Validação interativa

- CEP e UXP. Em cópias de páginas, use Center, repita a ação, use texto de ponto e de parágrafo e teste balões com cauda, vazamento, dois ou três compartimentos e textos longos. Compare o centro da tinta, o encaixe e a segunda passada com a fork. Exercite o Smart Paste clicando nas duas pontas de um balão triplo e com espaços consecutivos.
- UXP. Compile com npm.cmd run build:uxp:dev. No UXP Developer Tool, adicione uxp/manifest.json em um perfil de Photoshop de teste e carregue o painel. Confira a troca de idioma por perfil, a exportação, o foco após usar atalhos e o retorno ao painel depois de recarregar. Descarregue o plug-in de desenvolvimento ao terminar.
- Instaladores. No PowerShell local da revisão, rode node scripts/testInstallers.js com Node 24. O teste Windows usa diretórios temporários. A instalação real, o reparo do WebView e o caminho macOS exigem ambientes separados.

Para comparar a proposta de centralização do upstream na interface, compile o checkout upstream separado. Execute no PowerShell local a partir da revisão.

~~~powershell
if (-not (Test-Path ..\TypeR-upstream-reference)) {
  git worktree add --detach ..\TypeR-upstream-reference d7a3429
}
Push-Location ..\TypeR-upstream-reference
npm.cmd ci
npm.cmd run build:uxp:dev
(Resolve-Path .\uxp\manifest.json).Path
Pop-Location
~~~

Use o manifesto que o comando imprimiu no UXP Developer Tool. Carregue uma versão por vez para evitar os dois plug-ins com o mesmo ID. No Photoshop, abra uma cópia nova do mesmo PSD para cada versão. Reproduza as mesmas seleções, camadas ativas, fontes, ordem de leitura, padding e tamanho do texto. Registre a posição da tinta antes, depois de Center e depois de repetir Center. Priorize as páginas com balões triplos, caudas e texto próximo ao contorno. Use casos de Smart Paste à parte, porque o upstream guarda seu alvo de colagem e o reutiliza em Center.
