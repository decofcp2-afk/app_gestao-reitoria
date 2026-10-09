# Solicitações públicas de notas técnicas

Escopo aprovado em 09/10/2026: formulário público, administração pelo administrador geral, aviso para `decof@cp2.g12.br` e anexos temporários privados. O módulo usa Firestore para metadados e Google Drive para arquivos; não utiliza Firebase Storage nem exige a ativação do Blaze.

## Operação e ativação

1. Publicar o backend usando `scripts/deploy-apps-script.sh`, que preserva os nomes dos arquivos e a implantação existente.
2. Na conta institucional proprietária do Apps Script, executar `autorizarAnexosNotasTecnicas` uma vez no editor e conceder as permissões solicitadas pelo Google. A função somente consulta a quota da conta: não envia e-mail nem ativa o formulário.
3. Entrar no App Gestão como administrador geral, abrir **Solicitações de notas técnicas → Recebimento e avisos**, conferir `decof@cp2.g12.br`, marcar o recebimento público e salvar.
4. A ativação cria uma pasta privada exclusiva e um gatilho de manutenção a cada dez minutos. Nenhum link público do Drive é gerado.

O formulário aparece diretamente em `solicitar.html`. A preparação usa GET `?route=nt.preparar` e o envio usa POST `?route=nt.enviar` em JSON, com tipo `text/plain`, redirecionamentos habilitados e `credentials: omit`. Isso evita o erro de seleção de conta do Google em navegadores com várias contas conectadas. A rota `?route=nt.form` é mantida para compatibilidade; não é mais incorporada ao portal. A escrita pública exige nonce e conserva as mesmas validações de anexos, idempotência e limites diários. O frontend estático não contém credenciais de armazenamento. Antes da ativação, a página informa que o recebimento está em configuração.

## Regras do atendimento

- Estados: Nova, Em análise, Atendida, Encerrada. Atendida exige resposta; Encerrada exige atendimento anterior.
- Ao atender, grava-se primeiro a resposta e o histórico. Depois os anexos são excluídos permanentemente pela API do Drive. O administrador confirma essa ação na interface.
- Falhas de exclusão ficam marcadas e são repetidas pelo gatilho; o registro do atendimento permanece salvo. Pedidos atendidos não oferecem download e não podem voltar para análise.
- Protocolo, dados do pedido, resposta, link do documento produzido e histórico permanecem. Arquivos necessários ao processo oficial devem ser preservados pelo administrador antes de concluir o atendimento.
- O e-mail informa o protocolo e o assunto, com link para o App Gestão. Não envia anexos ou links privados. Falha de aviso não descarta o pedido; a manutenção tenta novamente.
- Documento produzido pode ser cadastrado na biblioteca por seu endereço HTTPS. Anexos recebidos nunca se tornam documentos públicos automaticamente.

## Limites e recuperação

Até cinco arquivos PDF/JPG/PNG, até 5 MiB cada, até 10 MiB por pedido. O servidor verifica extensão, MIME, assinatura do arquivo e tamanho decodificado. Há campo antirrobô, validade de trinta minutos, tempo mínimo de preenchimento e limites de cinco pedidos por e-mail/dia e cem pedidos/dia no módulo. Estes controles reduzem abuso; não substituem um CAPTCHA caso o volume de spam exija proteção adicional.

O módulo reserva até 10 GB decimais para anexos, com aviso a partir de 80%, e também verifica o espaço efetivamente livre na conta. **10 GB é um teto configurado do módulo, não uma garantia da quota gratuita da conta.** O espaço do Drive é compartilhado com os demais serviços da conta.

O protocolo é reservado antes do upload. Repetir um envio concluído recupera o mesmo protocolo. Envios interrompidos e arquivos órfãos do módulo são recuperados pela manutenção após uma hora. A pasta deve permanecer exclusiva deste módulo.

## Dados e acesso

Pedidos ficam em `unidades/reitoria-sel/solicitacoesNT`; documentos, em `unidades/reitoria-sel/documentosNT`. As regras do Firestore devem continuar bloqueando a leitura e escrita diretas destas coleções. A biblioteca pública entrega somente os campos selecionados pelo backend; pedidos e arquivos exigem sessão de administrador geral, inclusive no download. O logout apaga a tela, o estado local e os indicadores do módulo.

Propriedades do script: `NT_ATIVA`, `NT_DRIVE_FOLDER_ID`, `NT_EMAIL_AVISOS`, `NT_CONFIGURADO_POR`, `NT_CONTADORES`. Pausar o recebimento não suspende a limpeza de anexos ou os avisos pendentes.

## Validação

`tests/notas-tecnicas.test.js` testa permissões, formatos e limites, idempotência, falha de e-mail, atendimento com resposta, exclusão e repetição de falhas, recuperação de upload interrompido, download restrito à pasta e biblioteca sem dados privados. Os serviços do Google são simulados; autorização, quota e entrega real de e-mail precisam de conferência na conta institucional após a publicação.

Fontes técnicas: [comunicação HTML do Apps Script](https://developers.google.com/apps-script/guides/html/communication), [exclusão permanente de arquivos no Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete), [quotas do Apps Script](https://developers.google.com/apps-script/guides/services/quotas).

Conferência de produção em 09/10/2026: autorização do Drive concluída pela conta proprietária, formulário ativado com `decof@cp2.g12.br`, backend publicado na versão 114 e ambos os GitHub Pages publicados. As duas coleções privadas retornaram HTTP 403 a consultas anônimas. Formulário incorporado e biblioteca foram conferidos no navegador, incluindo largura móvel. Não foi enviado um pedido fictício nem um e-mail de teste ao destinatário.

Correção de 09/10/2026: erro do iframe reproduzido com redirecionamento Google para `/macros/u/2/`; abertura direta com `authuser=0` também falhou. O formulário nativo do portal carregou no mesmo Chrome usando requisições sem cookies. Nenhum pedido fictício foi criado nem e-mail enviado nessa conferência.
