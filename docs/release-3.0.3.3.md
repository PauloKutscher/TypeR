# TypeR 3.0.3.3

## Tamanho automático da fonte (Beta)

**Somente esta função é Beta. O nome do aplicativo continua TypeR.** A função vem **desligada por padrão**, inclusive para quem atualiza. O comportamento anterior de manter o tamanho do preset e reduzi-lo quando necessário continua disponível sem mudanças.

Para experimentar, abra **Configurações → Inserção → Colagem inteligente**, ative **Tamanho automático da fonte (Beta)** e salve.

O motor estima um tamanho a partir da área útil do balão e das larguras das palavras já medidas. Depois verifica o encaixe no contorno usando o mesmo mecanismo da Colagem inteligente e segue com a centralização, a cor, o traçado e a limpeza existentes. Pode aumentar até 150% do tamanho do preset; o mínimo continua obedecendo à preferência de tamanho mínimo já existente.

A primeira colagem normal concluída guarda uma referência proporcional ao preset para aquela página e PSD. As seguintes tentam permanecer numa faixa de 5% dessa referência, mantendo as proporções entre estilos. Se não couberem, podem reduzir abaixo dessa faixa até o mínimo configurado. Uma primeira fala excepcionalmente pequena não força o restante da página a continuar minúsculo.

Estilos marcados como grito ou narração são dimensionados separadamente. A opção de manter o tamanho ativo e os multiplicadores de pontuação têm prioridade. A referência é temporária: não grava dados no PSD nem no disco, diferencia abas/páginas e documentos e reinicia ao recarregar o painel. Uma tentativa que falha na criação do texto não estabelece referência.

Com a função desligada, os testes comparam os parâmetros gerados com o modo anterior e exigem igualdade. Foram cobertos crescimento, redução em balões pequenos, consistência entre falas, mudança de página/documento, prioridade do tamanho manual e confirmação da referência somente após a colagem.

### PSDs e velocidade

Foram extraídos **88 pares de texto e balão dos 15 PSDs locais**. As comparações usaram os avanços das fontes instaladas em **75 casos**, e uma estimativa nos restantes. A extração serve para avaliar limites e proporções; não é executada durante o uso do painel e não impõe um tamanho absoluto desses arquivos a outras obras.

Na amostra local, a recomendação de tamanho levou em média aproximadamente **0,007 ms** por caso, antes da verificação de encaixe. Em um benchmark do motor com respostas de fonte simuladas, os cenários curto, médio e pequeno usaram dois lotes de medição e uma captura, tanto no modo atual quanto no Beta. Os tempos do motor ficaram abaixo de 1 ms em média; esses números não medem o tempo total do Photoshop, de suas fontes ou do WebView.

O Beta reaproveita as medições existentes e limita a busca de redução a cinco refinamentos. A validação visual dentro do Photoshop ainda é necessária: os testes de PSD e do motor não substituem a avaliação tipográfica pelo usuário.

Para repetir a análise local no PowerShell, na pasta do projeto, execute `node scripts/checkAutoSizePsds.js` e `node scripts/benchmarkAutoFontSize.js`. A análise de PSDs requer Python com Pillow, psd-tools, NumPy e OpenCV e lê as fontes instaladas. O relatório fica em `.native-build/auto-size-psd-results.json`.

## Sincronização entre páginas e PSDs

Em **Configurações → Texto e roteiro → Páginas**, escolha **Sincronização entre página e PSD**:

- **Número no nome do arquivo (atual):** continua como padrão e usa o último número do nome, com a ordem dos arquivos como alternativa quando necessário.
- **Ordem dos arquivos na pasta:** usa a ordem natural dos arquivos vinculados. Page 1 abre o primeiro, Page 2 o segundo. Assim, Page 33 pode abrir o PSD 036 se esse for o 33º arquivo da lista.

Salve as configurações. A escolha vale tanto para abrir o PSD quanto para mostrar seu nome junto do marcador de página, e acompanha a exportação das configurações.

## Traçado inteligente

No editor do preset, junto de **Contorno**, há a opção **Traçado inteligente**, ligada por padrão:

- Fundo claro: mantém a cor do preset e retira o traçado.
- Fundo escuro: usa texto branco sem traçado.
- Fundo misto: usa o traçado configurado no preset. Sem um traçado configurado, nenhum é criado e a colagem continua normalmente.
- Leitura inconclusiva: conserva o comportamento do preset. Desative a opção para manter o comportamento anterior desse preset.

O recurso atua na Colagem inteligente. Se ela recusar a área e cair na colagem comum, permanece o comportamento de fallback existente. A quebra automática pela caixa de texto continua desligada por padrão.

Os limites da limpeza automática não foram ampliados: a tolerância adicional serve somente para escolher a aparência do texto. O detector aceita tons próximos de preto e branco e ignora pequenas quantidades de ruído ou letras, em vez de exigir valores RGB puros. Não há uma captura adicional do Photoshop nem medições adicionais de fonte.

## Validação com PSDs e desempenho

Foram lidos os compostos de **15 PSDs** da pasta local `psd`, sem modificar os originais. A análise cobriu **144 regiões**. Nove verificações de áreas claras, escuras e mistas selecionadas visualmente incluíram o original, compressão JPEG e redução de contraste; todas passaram. As demais regiões compõem uma amostra exploratória, sem rótulos manuais de referência.

O primeiro teste identificou que letras esparsas num balão claro eram tratadas como fundo misto. O limite de predominância foi ajustado para tolerar essa cobertura e a verificação passou também nas variantes degradadas.

No benchmark local, 1.000 repetições por cenário mediram aproximadamente **0,014 ms** por área simples e **0,082 ms** com contorno de 256 pontos (percentil 95: **0,100 ms**). Isso mede o detector, não o tempo total da colagem no Photoshop. O aplicativo não estava disponível para teste manual do painel nesta validação.

Para repetir localmente, na pasta do projeto no PowerShell, execute `node scripts/testSmartStroke.js`, `node scripts/checkSmartStrokePsds.js` e `node scripts/benchmarkSmartStroke.js`. O segundo comando requer Python com Pillow e a pasta `psd`; ele salva o relatório em `.native-build/smart-stroke-psd-results.json`.

## Instalar

O pacote universal `TypeR-UXP.ccx` agora inclui o pacote nativo do Windows da mesma versão. Se for aberto diretamente no Windows, ele prepara a troca localmente e pede para reiniciar o Photoshop, sem baixar arquivos do GitHub. Isso corrige o aviso de falha ao baixar o módulo de atalhos nas builds locais ainda não publicadas. O pacote `UXP-Windows.ccx` já contém o módulo nativo e não precisa dessa troca.

1. Baixe TypeR.zip desta release e extraia todo o conteúdo em uma pasta nova.
2. Salve os documentos e feche o Photoshop.
3. No Windows, abra install_win.cmd. No macOS, abra install_mac.command. Escolha UXP ou Legacy/CEP e confirme.
4. Reabra o Photoshop. UXP: Plug-ins → TypeR → TypeR. CEP: Janela → Extensões (herdadas) → TypeR (CEP).

Use o instalador deste ZIP. Quem está no CEP 3.0.3 deve atualizar pelo ZIP. Os dados e estilos são preservados. Para voltar, feche o Photoshop e reinstale o ZIP da 3.0.3.2.
