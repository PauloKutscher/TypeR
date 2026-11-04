# TypeR 3.0.3.4

O **Tamanho automático da fonte (Beta)** agora usa uma variação padrão de **±12%** em relação à referência da primeira fala da página, em vez de ±5%. A variação também pode ser configurada.

Somente essa função é Beta. Ela continua **desligada por padrão**, e quem já a ativou mantém sua escolha.

## Configurar a variação

1. Abra a engrenagem do TypeR e entre em **Inserção → Colagem inteligente**.
2. Ative **Tamanho automático da fonte (Beta)**.
3. No campo **Variação entre falas (%)**, escolha um valor de **0 a 100**. O padrão é **12**.
4. Clique em **Salvar**.

Com uma referência de 20 pt, 12% corresponde à faixa de 17,6 a 22,4 pt, respeitando os limites do preset. Com 0%, o TypeR tenta manter o tamanho de referência. Balões pequenos ainda podem diminuir abaixo da faixa para acomodar a fala, respeitando **Tamanho mínimo do texto (%)**.

A preferência é salva e acompanha a exportação e a importação das configurações. Perfis antigos sem esse campo passam a usar 12%. A mudança reutiliza as medições existentes e não acrescenta capturas de imagem nem chamadas de medição de fonte ao Photoshop.

## Validação

Testes cobrem o padrão de 12%, valores configurados de 0%, 5% e 100%, limites de entrada, persistência, exportação/importação, passagem do valor ao motor compartilhado e redução em balões pequenos. Também preservam o resultado anterior quando o Beta está desligado.

A validação visual no Photoshop continua pendente; os testes automatizados não substituem a avaliação tipográfica do usuário.

## Instalar

1. Baixe **TypeR.zip** desta release e extraia todo o conteúdo em uma pasta nova.
2. Salve os PSDs e feche o Photoshop.
3. No Windows, execute **install_win.cmd**. No macOS, execute **install_mac.command**. Escolha **UXP** ou **Legacy/CEP** e siga o instalador.
4. Reabra o Photoshop. UXP: **Plug-ins → TypeR → TypeR**. CEP: **Janela → Extensões (herdadas) → TypeR (CEP)**.

O ZIP inclui os pacotes UXP para instalação offline. O pacote universal mantém o módulo do Windows incluído; ao instalá-lo diretamente no Windows, reinicie o Photoshop quando solicitado. Para instalar o CCX específico do Windows, use **UXP-Windows.ccx**.

As configurações e os estilos são preservados. Para voltar, feche o Photoshop e reinstale o ZIP da 3.0.3.3.
