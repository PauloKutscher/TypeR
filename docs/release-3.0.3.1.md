# TypeR 3.0.3.1

Integra os commits upstream `5654de3` e `30860ad`:

- CEP: preserva as camadas selecionadas pelo usuário após leituras temporárias do histórico.
- UXP: devolve o foco ao documento após alterações pelo painel, recuperando os atalhos do Photoshop.
- UXP Windows: identifica falhas de criação do WebView2 nos logs e oferece o endereço de instalação do runtime.

Mantém as correções do fork para pastas, ordem do Auto clean, presets importados e direção do texto, multiplicador ×1.5 e quebra automática pela caixa. **A quebra automática pela caixa permanece desligada por padrão.**

O atualizador reconhece quatro números desde a 3.0.3. O validador de arquivos CEP foi corrigido nesta versão: quem está no CEP 3.0.3 deve instalar esta atualização pelo ZIP.

## Instalação offline

1. Baixe TypeR.zip e extraia todo o conteúdo.
2. Salve os documentos e feche o Photoshop.
3. No Windows, execute install_win.cmd; no macOS, install_mac.command. Escolha UXP ou Legacy/CEP e confirme.
4. Reabra o Photoshop. UXP: Plug-ins → TypeR → TypeR. CEP: Janela → Extensões (herdadas) → TypeR (CEP).

Para voltar, feche o Photoshop e reinstale o ZIP da 3.0.3, preservando os dados do usuário.

## Validação

`npm run release` concluiu com sucesso: 93 suítes, build, 214 verificações de equivalência, compatibilidade ES5 e pacotes UXP Windows/macOS. Os testes incluem as correções anteriores do fork e os cenários novos do upstream. Não foi realizado teste manual desta versão no Photoshop.
