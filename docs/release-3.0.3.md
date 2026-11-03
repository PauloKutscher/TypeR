# TypeR 3.0.3

Esta atualização adiciona uma opção de quebra automática pela caixa de texto à Colagem inteligente. **A opção vem desligada**, inclusive para quem atualiza: o ajuste atual ao contorno do balão permanece como padrão.

## Novidades e correções

- **Quebra automática pela caixa de texto:** o Photoshop distribui as palavras em uma caixa retangular, sem gravar quebras extras no conteúdo. As quebras que já estavam no texto são preservadas. A formatação, o texto branco em balões pretos, a distribuição entre balões conectados e a limpeza automática continuam disponíveis. O resultado pode diferir visualmente do ajuste ao contorno, especialmente em balões irregulares.
- **Só pontuação:** nova opção **×1.5**, além de tamanho normal, ×2 e ×3.
- **Atalhos no Windows:** o endereço de download do módulo agora usa o prefixo `v` das releases deste fork. O endereço anterior procurava uma release inexistente, impedindo a instalação automática do módulo em pacotes sem o addon Windows.
- **Presets e TextShapeR:** corrigidos o tratamento da direção do texto e a conversão de estilos importados com caixa de fonte desativada (`fontCaps: null`). A correção da direção também alcança a colagem comum usada quando a Colagem inteligente não consegue ler o contorno.
- **Atualizador:** passa a reconhecer versões com quatro números, como `3.0.3.1`. Esta publicação usa **3.0.3** para ser reconhecida pelo atualizador já instalado na versão 3.0.2.

## Instalar e usar

1. No TypeR, use a notificação de atualização para instalar a versão **3.0.3**. Salve seus documentos e reinicie o Photoshop se o painel solicitar.
2. Para instalar offline no Windows, baixe **TypeR.zip** nesta release, extraia todo o conteúdo, salve seus documentos e feche o Photoshop. Abra `install_win.cmd` na pasta extraída, escolha **UXP** com as setas e confirme com Enter. No macOS, use `install_mac.command` e escolha UXP.
3. Reabra o Photoshop e acesse **Plug-ins → TypeR → TypeR**. Para o painel antigo, escolha Legacy/CEP no instalador e abra **Janela → Extensões (herdadas) → TypeR (CEP)**.
4. Para experimentar a nova quebra, abra as configurações do TypeR e encontre **Colagem inteligente**. Mantenha a Colagem inteligente ligada e ative **Quebra automática pela caixa de texto**. Salve as configurações. O novo modo usa texto de parágrafo, mesmo se o preset estiver configurado para texto de ponto.
5. Para voltar ao ajuste anterior, desmarque apenas essa nova opção e salve. A cor automática e a distribuição entre balões conectados continuam disponíveis nos dois modos.

O pacote offline inclui o addon de atalhos do Windows e não precisa de credenciais. O arquivo avulso para Windows é **UXP-Windows.ccx**; no macOS, **TypeR-UXP.ccx**. Os arquivos `.sha256` permitem conferir a integridade dos downloads.

## Validação e limites

Os testes automatizados cobrem a preferência desligada por padrão, persistência e importação, conteúdo sem quebras extras, preservação de quebras explícitas e formatação, cor branca em balões pretos, distribuição entre balões conectados e criação de caixas nos dois hosts. A regressão de pastas e a ordem do Auto clean permanecem cobertas.

Foram verificadas **93 suítes em etapas**, além de **214 verificações de equivalência**, compatibilidade ES5 e integridade dos artefatos. O comando completo de release parou em uma falha intermitente de substituição de arquivo do instalador Windows; os **31 cenários do instalador** passaram integralmente na repetição isolada. As etapas restantes de testes e empacotamento foram executadas separadamente.

A comparação visual entre os dois modos no Photoshop não foi realizada, conforme solicitado. A correção do download não confirma, por si só, todos os relatos de atalhos com o painel em foco. A leitura de contornos que a Colagem inteligente não consegue interpretar continua sujeita ao fallback para a colagem comum.

Para recuperação, salve os documentos, feche o Photoshop e reinstale o ZIP da release anterior. Os dados e estilos devem ser preservados; no Windows, os dados UXP ficam em `%APPDATA%\TypeR\UXP`, e no macOS em `~/Library/Application Support/TypeR/UXP`. Mantenha somente um painel, UXP ou CEP, aberto para evitar atalhos duplicados.
