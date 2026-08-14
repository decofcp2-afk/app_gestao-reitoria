# App Gestao da Reitoria

Aplicacao interna da equipe SEL/SEPMA para gestao das etapas dos processos, fila, capacidade, historico, configuracoes, e-mails e avisos de prazo.

Este projeto foi separado do Painel de Contratacoes. O App Gestao deve ficar em repositorio proprio e em GitHub Pages proprio, porque possui login, escrita na planilha, envio de e-mails e acionadores de aviso.

## Estrutura

```text
app_gestao-reitoria/
|-- index.html              pagina estatica publicada no GitHub Pages
|-- config.js               URL publica do Apps Script da DECOF
|-- CHECKLIST_PUBLICACAO.md roteiro de publicacao e testes
|-- apps-script/
|   |-- Code.gs             backend do App Gestao (publicado no Apps Script)
|   |-- FirestoreSync.gs    escritas e leituras do Firestore (fs_*)
|   `-- appsscript.json     manifesto do projeto do Apps Script
|-- scripts/
|   `-- deploy-apps-script.sh  publica o backend (nao use `clasp push` direto)
|-- README.md
`-- .gitignore             bloqueia arquivos sensiveis (inclui chaves Firebase)
```

> **Migracao planejada:** a base de dados sera movida da planilha para o Firestore (modelo hibrido, plano gratuito). O App Gestao seguira protegido por login e mantera os e-mails no Apps Script. Detalhes no `PLANO_ORGANIZACAO_E_MIGRACAO.md`.

## Fluxo geral

```text
Google Sheets da unidade
  |
  | le e escreve com a conta institucional
  v
Apps Script do App Gestao
  |
  | login, tokens, fila, etapas, capacidade, e-mails e avisos
  v
App Gestao no GitHub Pages
  |
  | equipe usa pelo navegador
  v
Atualizacoes voltam para a mesma planilha
```

O Painel de Contratacoes le a mesma planilha por outro Apps Script, separado e somente leitura. Assim o painel pode ficar publico, enquanto o App Gestao continua protegido por login.

## Principais funcoes

- Login por matricula e senha.
- Recuperacao de senha por e-mail.
- Registro e conclusao de etapas.
- Regressao de etapa quando uma etapa precisa ser reaberta.
- Reabertura de processo concluido por engano (restrita a chefia), com justificativa no historico.
- Retorno de processo para a fila preservando o status real do processo, com aviso por e-mail ao servidor responsavel e ao setor requisitante.
- Reativacao de processos retornados pela aba Fila, com aviso de retomada aos mesmos destinatarios.
- Cobranca automatica da pontuacao de carga quando um processo fica sem pontuar.
- Controle de capacidade por servidor e fase.
- Cadastro e manutencao da equipe.
- Envio de avisos de prazo de segunda a sexta-feira, em dois lotes.

## Retorno para fila

Processos em andamento podem voltar para a fila em casos reais como suspensao, paralisacao, devolucao pelo setor ou desistencia.

Esse fluxo preserva o historico do processo:

- O status atual do processo e da etapa fica preservado.
- A etapa atual recebe uma marca operacional `RETORNO PARA FILA` no campo de motivo.
- O D0 existente continua registrado.
- Etapas ja concluidas continuam concluidas.
- A justificativa fica registrada no historico.
- A capacidade do processo deixa de contar como ativa.
- Os avisos automaticos de atraso deixam de ser enviados enquanto o processo estiver na fila.
- O processo aparece novamente na aba Fila.
- Ao iniciar/reativar pela Fila, o status volta para `Em andamento`.

Esse comportamento tambem ajuda nos testes, porque permite simular a volta para fila sem apagar a realidade atual dos dados.

### Aviso automatico do retorno e da retomada

Um processo que sai do andamento some da lista de quem o acompanha e para de gerar aviso de prazo. Antes, o servidor responsavel e o setor requisitante so descobriam a parada quando cobravam o andamento. Agora a justificativa que a chefia ja digitava vira comunicacao:

1. Ao clicar em "Voltar para a fila", a chefia escolhe um **motivo** (pendencia de documentacao, suspensao, indisponibilidade orcamentaria, manifestacao externa, repriorizacao, desistencia ou outro), escreve a **justificativa** e, se quiser, a **previsao de retomada**.
2. O texto do e-mail e montado conforme o motivo — a providencia esperada muda de caso para caso — e aparece numa **previa editavel**, uma mensagem para o servidor e outra para o setor requisitante. A chefia pode ajustar o texto e desmarcar destinatarios antes de enviar.
3. Ao confirmar, o retorno e gravado e os e-mails saem. Falha de e-mail nunca desfaz nem trava o retorno: a chefia recebe na tela a lista do que nao saiu (por exemplo, processo sem e-mail do requisitante cadastrado).
4. Quando o processo e reativado pela aba Fila, sai o **aviso de retomada** para os mesmos destinatarios, com a etapa retomada e uma observacao opcional da chefia. Processo novo (nunca iniciado) nao dispara e-mail.

O rotulo do motivo entra no proprio texto registrado (`RETORNO PARA FILA: <motivo> — <justificativa>`), entao aparece na aba Fila e no historico sem coluna nova.

## Cobranca de pontuacao pendente

A pontuacao de carga e atribuida depois do cadastro, num segundo passo, e e o passo que mais escapa. Enquanto ela nao e lancada, o processo **nao entra no calculo da Capacidade**: o setor aparece com folga que nao tem, e a distribuicao de novos processos e feita sobre um numero subestimado.

Regras:

- Varredura diaria as **9h30**, de segunda a sexta, junto com os demais acionadores.
- **Um e-mail por processo pendente** para a chefia, no maximo um por dia, repetido enquanto a pendencia existir. A cobranca cessa sozinha assim que a pontuacao e lancada.
- Teto de 20 e-mails por execucao, para proteger a cota diaria do `MailApp`.
- Ficam de fora os casos que nunca seriam pontuados: processo concluido, processo devolvido para a fila, fase inteira "Nao se aplica" (a fase externa de uma contratacao direta sem disputa, por exemplo) e carga orfa.
- Processos ainda **nao iniciados contam** — e logo depois do cadastro que a pontuacao costuma ser esquecida.
- A mesma lista aparece no app, na aba **Pontuacao** da central de notificacoes (visivel so para a chefia). Clicar leva direto a fase correspondente da aba Capacidade.
- Em Configuracoes ha o botao **Cobrar pontuacao agora**, para disparo manual.

A cobranca **nao depende** de reinstalar acionador: quando o acionador proprio das 9h30 nao existe (projetos cujos triggers foram instalados antes desta versao), a varredura roda junto com o aviso de prazo das 10h30. Reinstalar o trigger so antecipa o horario — o app mostra em Configuracoes qual dos dois esta valendo. Rodar duas vezes no mesmo dia e inofensivo: a trava de um e-mail por processo/fase por dia vale para as duas execucoes.

## Configuracao

Use `CHECKLIST_PUBLICACAO.md` como roteiro curto. O resumo e:

1. Crie um projeto novo em `script.google.com` na conta da DECOF.
2. Copie o conteudo de `apps-script/Code.gs` para o Apps Script.
3. Em `Configuracoes do projeto > Propriedades do script`, cadastre:
   - `SEL_SS_ID`: ID real da planilha.
   - `SEL_CHEFIA_EMAIL`: e-mail institucional da chefia, se necessario.
   - `SEL_MUNICIPIO_CALENDARIO`: municipio usado nos feriados locais, por exemplo `Rio de Janeiro`.
4. Implante como Web App:
   - Executar como: `Eu`.
   - Quem pode acessar: `Qualquer pessoa`.
5. Copie a URL terminada em `/exec`.
6. Cole essa URL em `config.js`, no campo `apiUrl`.
7. Mantenha `apiTimeoutMs` em `90000`, salvo se o Apps Script precisar de outro tempo de espera.
8. Publique este repositorio no GitHub Pages em `main` + `/(root)`.

## Avisos por e-mail

Os avisos automaticos sao enviados pelo Google Apps Script usando a conta que instalou os acionadores. Por isso, em producao, instale ou reinstale os acionadores estando logado na conta institucional da DECOF.

Regras atuais:

- Os acionadores rodam de segunda a sexta-feira em tres horarios: cobranca de pontuacao pendente por volta de 9h30, prazos proximos por volta de 10h30 e etapas vencidas por volta de 14h.
- Quando houver e-mail do requisitante cadastrado, ele acompanha o lote correspondente: 10h30 se o prazo estiver proximo, 14h se a etapa estiver vencida.
- O codigo tambem possui uma trava interna para nao enviar no sabado ou domingo.
- Se existir acionador antigo em conta pessoal, ele deve ser excluido em `Apps Script > Acionadores`.
- Processos devolvidos para a fila, suspensos/paralisados ou ainda em planejamento nao enviam aviso de atraso.
- **Envio conservador (anti-cota):** cada etapa gera no maximo **um** e-mail de "prazo proximo" (na primeira varredura dentro da janela de `DIAS_AVISO`) e **um** de "vencido" (na primeira varredura apos vencer) — e nao mais um e-mail por dia util enquanto a pendencia existir. Isso evita estourar a cota diaria do `MailApp` (100/dia em conta pessoal `@gmail.com`; 1500/dia em conta Workspace). O estado de "ja avisado" e guardado por unidade: na colecao `avisosEnviados` do Firestore quando `FS_ATIVO='true'`, senao na aba oculta `__avisos_enviados` da planilha. Se o prazo da etapa for remarcado (muda o `fim_iso`), um novo aviso volta a ser permitido.

## Calendario de feriados oficiais

Os prazos sao contados em **dias corridos** (todos os dias contam, inclusive fins de semana e feriados). O modo e controlado pela constante `MODO_CONTAGEM_PRAZOS` no `Code.gs` (espelhada no `index.html`). Se for alterada para `'uteis'`, o calculo volta a excluir sabado, domingo, feriados nacionais fixos e, quando existir, as datas da aba `Calendario` da planilha — a infraestrutura de feriados abaixo continua valida para esse caso.

A aba deve ter estas colunas:

```text
Data | Nome | Tipo | Municipio | AfetaPrazo | Fonte | Observacao
```

Regras:

- `Tipo` precisa conter `Feriado`; linhas de `Ponto facultativo` sao ignoradas nesta versao.
- `AfetaPrazo` precisa ser `Sim` para a data entrar no calculo.
- Use `Municipio = TODOS` para feriados nacionais e estaduais do RJ.
- Use `Municipio = Rio de Janeiro`, `Niteroi` ou `Duque de Caxias` quando o feriado for local.
- Se a aba nao existir ou estiver vazia, o app continua funcionando com o fallback de feriados nacionais fixos.

Fontes recomendadas:

- Feriados nacionais: Gov.br / MGI.
- Feriados estaduais do RJ: ALERJ / Lei RJ 5.645/2010.
- Feriados municipais: prefeitura ou diario oficial do municipio.

Pontos facultativos podem ser avaliados no futuro, mas nao fazem parte da regra atual para evitar distorcao de prazos.

## Rotas do Apps Script

- `?route=appsel.challenge`
- `?route=appsel.loginProof`
- `?route=appsel.changePasswordHash`
- `?route=appsel.call&method=...`

O login no GitHub Pages usa desafio criptografico: a senha digitada nao e enviada aberta na URL. As demais chamadas preservam a compatibilidade com as funcoes atuais do App Gestao e exigem token quando a funcao original ja exigia token.

## Solucao de problemas

- Se o app nao carregar dados, confira se `config.js` tem a URL `/exec` correta e o `apiTimeoutMs` adequado.
- Se funcionar no Chrome e falhar no Edge, teste em aba anonima e confirme se o Apps Script foi implantado como Web App acessivel por `Qualquer pessoa`.
- Se o login nao concluir, confirme que as rotas `appsel.challenge` e `appsel.loginProof` estao respondendo.
- Se os e-mails nao sairem ou sairem da conta errada, confira em `Acionadores` se os gatilhos estao na conta institucional e se o acionador de conta pessoal foi removido.
- Se o aviso de retorno para a fila nao chegar ao setor requisitante, confira se o processo tem `EmailRequisitante` cadastrado (o app avisa na hora quando falta).
- Se a cobranca de pontuacao nao chegar, confira se a chefia tem e-mail cadastrado em Equipe e se o acionador de 9h30 existe (reinstale o trigger).
- Se o GitHub Pages nao atualizar, aguarde alguns minutos e confira a aba `Actions` do repositorio.
- Se mudar o nome do repositorio, atualize tambem links do README e qualquer atalho salvo no navegador.
