# TypeR 3.0.2 — build corrigida: pastas, Auto clean e atalhos

Integra `ScanR/TypeR:develop` até `411c9f2` ao fork `PauloKutscher/TypeR`, preservando as correções do fork:

- `090f3b6`: corrige a ordem das camadas no Auto clean e a espera por um WebView lento.
- `411c9f2`: recupera o foco do documento quando um tooltip do Photoshop prende os atalhos no Windows.

Esta build substitui os arquivos anteriores do release **3.0.2** e corrige a camada de texto que saía da pasta ao usar a colagem ao clicar, inclusive no UXP sem Auto clean. Quem já instalou o 3.0.2 deve baixar novamente o ZIP e reinstalar; o atualizador por versão não distingue duas builds com o mesmo número.

## O que mudou

- A camada de texto permanece dentro da pasta selecionada, incluindo pastas vazias e aninhadas. Ela sobe antes da primeira camada da própria pasta; o texto na raiz continua subindo ao topo do documento. O ajuste também foi aplicado ao CEP.
- O texto colado com Auto clean fica acima de `TypeR Clean`. A pasta escolhida pelo usuário é conservada quando está acima da limpeza; a nova camada vai para a frente da própria pasta pelo comando do Photoshop, sem calcular índices de movimentação.
- O painel UXP mantém o WebView visível após o aviso de demora. Quando o Photoshop termina de iniciá-lo, o painel pode abrir sem precisar ser fechado e reaberto.
- O addon nativo do Windows identifica o foco preso em um tooltip e solicita a devolução ao documento. Isso corrige os atalhos que paravam após colagem ao clicar ou TextShapeR. No CEP, continua sendo necessário clicar no documento ou pressionar a tecla Windows quando esse problema do Photoshop ocorrer.
- Foram preservadas a geometria calibrada, a precisão de contorno de 0,5 px, as proteções de dados e formatação e as atualizações direcionadas a este fork. O canal de testes conserva o acesso a `evalScript` e adota o diretório Windows do upstream, `%APPDATA%\TypeR\UXP\dev`; ele não integra os pacotes de produção.
- Aplicação, manifesto CEP e pacotes UXP usam a versão **3.0.2**.

## Validação

- `npm run release`: 93 suítes automatizadas, build CEP, verificações dos artefatos e Task 33, pacotes UXP Windows/macOS e validação do ZIP offline.
- Regressões de hierarquia e ordem das camadas: pasta vazia, pasta aninhada, camada selecionada dentro da pasta, texto na raiz, liberação de máscara de recorte e documentos com ou sem fundo.
- Auto clean com limpeza nova ou existente, pasta acima ou abaixo dela e dois textos na mesma operação. A regra que mantém o texto acima de `TypeR Clean` foi preservada; uma pasta abaixo da limpeza continua usando o destino acima da limpeza previsto na correção do upstream.
- Os testes detectam tanto o código anterior do bug da pasta quanto o código anterior à correção do Auto clean, carregados apenas em memória para a contraprova.
- O addon nativo mantém o mesmo binário e código já verificados no teste de compilação C++ da build anterior.
- `npm audit --audit-level=moderate`: nenhuma vulnerabilidade encontrada.
- Pacotes e arquivos SHA-256 conferidos localmente.

O Webpack emitiu avisos de tamanho dos bundles e separação do runtime; os builds concluíram sem erros.

O reposicionamento CEP foi executado no Photoshop 27.11.0 em Windows, em documentos descartáveis com pastas simples e aninhadas: o texto permaneceu dentro da pasta e como seu primeiro item. Não foi realizado teste manual do painel UXP nem do Photoshop em macOS. A recuperação de foco e a inicialização ainda precisam de confirmação no ambiente real afetado.

## Instalar ou atualizar

1. Baixe novamente **TypeR.zip** nos arquivos deste release em **PauloKutscher/TypeR**. Mesmo se já usa 3.0.2, utilize o novo ZIP para instalar a correção.
2. No Windows, clique com o botão direito no ZIP e escolha **Extrair tudo**. No macOS, abra o ZIP para extraí-lo. Mantenha os arquivos e a pasta `installer` juntos.
3. Salve seus documentos e feche o Photoshop.
4. Na pasta extraída, abra `install_win.cmd` no Windows ou `install_mac.command` no macOS. Escolha **UXP** com as setas e confirme com Enter; para a extensão antiga, escolha **Legacy/CEP**.
5. O instalador deve informar a instalação da versão **3.0.2**. Reabra o Photoshop e acesse **Plug-ins → TypeR → TypeR** para UXP, ou **Janela → Extensões (herdado) → TypeR (CEP)** para CEP. A instalação anterior também pode aparecer como **TypeR (old)**.
6. Confira suas pastas, estilos e perfis antes de trabalhar. Em um documento de teste, selecione uma pasta e use a colagem ao clicar: a nova camada deve ficar dentro da pasta. Com Auto clean, confira também que o texto permanece visível acima da limpeza. Os dados UXP ficam em `%APPDATA%\TypeR\UXP` no Windows e em `~/Library/Application Support/TypeR/UXP` no macOS.

O ZIP instala offline e não exige credenciais do GitHub ou da Adobe. Para instalar pelo Creative Cloud, use o arquivo avulso **UXP-Windows.ccx** no Windows ou **TypeR-UXP.ccx** no macOS.

Se precisar voltar à versão anterior, feche o Photoshop e instale o **TypeR.zip** do release **v3.0.1** pelo mesmo procedimento, preservando seus dados. Se a instalação CEP anterior estiver disponível, feche o painel UXP e abra o CEP no menu de extensões herdadas. Mantenha apenas um dos dois painéis aberto para evitar atalhos duplicados.

## Reproduzir a geração

No PowerShell local, com Git, Node.js 22.12 ou superior e npm instalados:

```powershell
Set-Location -LiteralPath 'C:\Users\PICHAU\Documents\Codex\2026-06-28\Claude TypeR'
git switch develop
npm ci
node scripts/testTextLayerStack.js
npm run release
```

Cada comando deve terminar sem erro antes do seguinte. O resultado fica em `Releases`: **TypeR.zip**, **UXP-Windows.ccx**, **TypeR-UXP.ccx** e seus arquivos `.sha256`. Para repetir o teste nativo, instale também Visual Studio C++ Build Tools e Windows SDK e execute `npm run test:keys-addon:native` no mesmo PowerShell e diretório. Nenhuma VPS, WSL ou Docker é necessária.
