# TypeR 3.0.3.2

Corrige o erro **Invalid TypeR manifest** do instalador Windows da 3.0.3.1. Os validadores UXP e CEP agora aceitam versões com quatro números.

A falha foi reproduzida em um teste de instalação UXP antes da correção. A validação inclui instalação e registro da versão com quatro números e instalação CEP pelo script nativo. Mantém as correções anteriores e a quebra automática pela caixa desligada por padrão.

## Instalar

1. Baixe o novo **TypeR.zip** desta release e extraia todo o conteúdo em uma pasta nova.
2. Salve os documentos e feche o Photoshop.
3. No Windows, abra **install_win.cmd** da pasta recém-extraída. Escolha UXP ou Legacy/CEP e confirme com Enter. No macOS, use install_mac.command.
4. Reabra o Photoshop. UXP: **Plug-ins → TypeR → TypeR**. CEP: **Janela → Extensões (herdadas) → TypeR (CEP)**.

Use o instalador deste ZIP, pois o instalador antigo continua rejeitando quatro números. Quem está no CEP 3.0.3 deve atualizar pelo ZIP. Os dados e estilos do usuário são preservados.

Validação: `npm run release` passou completo (93 suítes e 214 verificações de equivalência). A suíte nativa do instalador foi repetida após o empacotamento, verificando também o CCX final distribuído. Não foi realizado teste manual de carregamento do painel no Photoshop.
