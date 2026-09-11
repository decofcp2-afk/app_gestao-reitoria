# Especificação: Gestão de Atas — MVP

Status: aprovado e implementado em branch de feature. Este documento não autoriza publicação em produção.

## Constituição

- Contexto institucional do Colégio Pedro II.
- Stack preservada: JavaScript puro, GitHub Pages, Google Apps Script e Firestore.
- Nenhuma escrita, publicação ou alteração no Compras.gov.br; integração exclusivamente de leitura.
- Dados oficiais não são editáveis no app. Dados internos são separados e auditáveis.
- Dados sensíveis e credenciais permanecem no Apps Script/PropertiesService.
- Primeira liberação limitada à unidade `reitoria-sel` (SEL/SEPMA), por feature flag.
- Identidade visual sóbria e consistente com o app atual.
- Formatos: datas `dd/mm/aaaa`, moeda `R$ 1.234,56`, fuso `America/Sao_Paulo`.

## Problema

O acompanhamento das Atas de Registro de Preços do setor é feito em planilhas. O maior problema é controlar datas de vigência, responsáveis e providências próximas ao vencimento. O Compras.gov.br possui os dados oficiais, mas não organiza o acompanhamento interno por servidor e unidade.

## Objetivo do MVP

Substituir a planilha do setor por um controle simples que permita:

1. adicionar uma ou várias atas ao acompanhamento da unidade;
2. preencher dados oficiais por consulta ao Compras.gov.br ou cadastrar manualmente quando a publicação ainda não existir;
3. visualizar vigência, situação e responsável em uma tabela única;
4. receber avisos persistentes no sino e resumos por e-mail nos marcos de 90, 60 e 30 dias;
5. continuar funcionando com o último dado sincronizado quando a API ou o Gmail estiverem indisponíveis.

## Critérios de sucesso observáveis

- Um servidor da fase externa adiciona uma compra ao controle sem redigitar os dados encontrados na API.
- Uma contratação com várias atas permite selecionar e acompanhar cada ata separadamente.
- Uma ata manual pode ser vinculada posteriormente ao registro oficial sem duplicação.
- A tela principal informa, sem abrir detalhes, quais atas estão ativas, vencendo, incompletas ou vencidas.
- Cada marco de 90, 60 ou 30 dias gera no máximo uma notificação por ata e destinatário para a mesma data final.
- A indisponibilidade do Compras.gov.br não bloqueia a tela nem apaga o último dado confirmado.
- A falta de cota de e-mail não remove o aviso do sino; o envio fica registrado como pendente ou dispensado.
- Nenhuma rota nova fica visível fora da unidade habilitada pela feature flag.

## Usuários e permissões

| Papel | Pode visualizar | Pode criar/vincular | Pode editar | Pode arquivar/reabrir |
|---|---|---|---|---|
| Servidor da fase externa | Atas da própria unidade | Atas dos processos em que é responsável externo | Responsável, observação e avisos das atas sob sua responsabilidade | Não |
| Chefia da unidade | Todas as atas da unidade | Qualquer ata da unidade | Todos os campos internos e responsáveis | Sim |
| Administrador geral | Atas da unidade selecionada | Qualquer ata da unidade selecionada | Todos os campos internos | Sim |
| Servidor sem vínculo com a ata | Lista e detalhe oficial da unidade | Não | Não | Não |

Dados oficiais vindos do Compras.gov.br são somente leitura para todos os perfis.

## Contexto de uso

- Desktop é o alvo principal para tabela, filtros e gestão.
- Celular mantém consulta, avisos e cadastro essencial em layout compacto.
- Uso diário pela chefia e eventual pelos responsáveis da fase externa.
- Volume inicial esperado: dezenas ou poucas centenas de atas por unidade.

## Fluxos principais

### F01 — Adicionar pelo processo

1. O responsável abre um processo cuja fase externa está ativa.
2. Seleciona `Adicionar ao controle de atas`.
3. Processo, unidade e responsável são preenchidos automaticamente.
4. Informa número/ano da compra e seleciona `Consultar atas`.
5. O sistema consulta a UASG 153167 no Compras.gov.br.
6. Se houver várias atas, apresenta uma lista simples com número, objeto e vigência.
7. O servidor seleciona uma ou mais atas e confirma.
8. Cada ata vira um acompanhamento independente ligado ao mesmo processo/compra.

**Caminhos infelizes:** compra inválida orienta correção; API indisponível oferece nova tentativa ou cadastro manual; nenhuma ata encontrada permite `Acompanhar publicação`; ata já acompanhada é marcada como existente e não é duplicada.

### F02 — Adicionar pela Gestão de Atas

1. Usuário seleciona `Cadastrar ata` na tela principal.
2. Escolhe `Consultar Compras.gov.br` ou `Cadastro manual`.
3. Na consulta, informa processo, compra/ano e responsável.
4. No cadastro manual, informa apenas os dados necessários para vigência e identificação.
5. O registro manual entra como `Aguardando confirmação oficial` quando possuir compra/ano.

### F03 — Consultar e atualizar acompanhamento

1. A tela principal mostra KPIs, filtros e uma linha por ata.
2. O usuário abre o detalhe pelo ícone de visualização.
3. O drawer mostra primeiro dias restantes e data final.
4. Dados oficiais permanecem bloqueados.
5. Responsável e observação permanecem editáveis conforme permissão; os marcos são fixos no MVP.

### F04 — Sincronização oficial

1. Uma rotina diária consulta as atas da UASG e janela configurada.
2. Registros oficiais são associados pelo identificador PNCP; na ausência dele, usa-se a combinação controlada de UASG, número/ano da compra e número da ata.
3. O sistema atualiza o espelho oficial e recalcula a situação.
4. Registros manuais compatíveis são arquivados com referência ao registro oficial, preservando responsável, observação e auditoria.

### F05 — Avisos

1. O sino separa `Atas` e `Processos`.
2. Em `Atas`, aparecem atas vencidas e os marcos de 30, 60 e 90 dias.
3. Em `Processos`, permanecem somente avisos futuros/operacionais; atrasados continuam nos KPIs.
4. O servidor recebe suas atas; a chefia recebe todas as atas da unidade.
5. No máximo um resumo de atas por destinatário é enviado no dia.
6. E-mail não enviado não remove nem marca como lido o aviso do sino.

## Contrato de dados

### Entidade `atas`

Coleção privada por unidade: `unidades/{unidadeId}/atas/{ataId}`.

| Campo | Tipo | Obrigatório | Origem/regra |
|---|---|---:|---|
| `_id` | string | sim | PNCP normalizado quando oficial; UASG+número+ano quando manual |
| `unidade` | string | sim | sessão autenticada |
| `origem` | enum | sim | `compras` ou `manual` |
| `idAtaPNCP` | string | não | oficial e único quando disponível |
| `linkPncp` | string | não | link oficial para consulta |
| `numeroAta` | string | sim | formato `NNNNN/AAAA` |
| `numeroCompra` | string | não | número sem ano |
| `anoCompra` | string | não | quatro dígitos |
| `uasg` | string | sim | inicialmente `153167` |
| `processoId` | string | não | processo interno vinculado |
| `objeto` | string | sim | oficial; manual enquanto não localizado |
| `dataAssinatura` | date/string ISO | não | oficial ou manual |
| `vigenciaInicio` | date/string ISO | sim | base do controle |
| `vigenciaFim` | date/string ISO | sim | base dos alertas |
| `responsavel` | string | sim | snapshot interno de exibição e permissão |
| `observacao` | string | não | máximo 1.500 caracteres |
| `arquivada` | boolean | sim | arquivamento lógico |
| `atualizadoOficialEm` | timestamp | não | última confirmação oficial |
| `criadoPor` / `criadoEm` | string/timestamp | sim | auditoria |
| `atualizadoPor` / `atualizadoEm` | string/timestamp | sim | auditoria |

Uma compra pode possuir várias atas. Itens e fornecedores ficam fora do MVP para manter o controle focado em datas e responsáveis.

### Entidade `avisosAtas`

Coleção privada por unidade: `unidades/{unidadeId}/avisosAtas/{avisoId}`.

| Campo | Tipo | Regra |
|---|---|---|
| `ataId` | string | referência da ata |
| `vigenciaFim` | string ISO | compõe a deduplicação |
| `marcoDias` | number | somente 90, 60 ou 30; `0` identifica vencida |
| `lidoPor` | array<string> | matrículas que dispensaram o aviso no sino |
| `emailEnviadoPara` | array<string> | destinatários já atendidos pelo digest |
| `criadoEm` / `emailUltimoEnvioEm` | timestamp | auditoria |
| `emailUltimoErro` / `emailUltimaFalhaEm` | string/timestamp | falha sanitizada e data, quando houver |

### Entidade `syncAtas`

Documento privado `unidades/{unidadeId}/syncAtas/estado` com última tentativa/sucesso, estado, quantidades de sincronização e resumo de envio.

## Regras de negócio

- **RN01** — A integração com Compras.gov.br é exclusivamente de leitura.
- **RN02** — Uma compra pode vincular zero, uma ou várias atas.
- **RN03** — `idAtaPNCP` não pode se repetir dentro da mesma unidade.
- **RN04** — Registro manual compatível com retorno oficial deve ser vinculado, não duplicado.
- **RN05** — `vigenciaFim` oficial prevalece para cálculo após o vínculo.
- **RN06** — Situação é calculada pela data local de Brasília: ativa, vencendo ou vencida.
- **RN07** — Marcos de e-mail do MVP são fixos em 90, 60 e 30 dias.
- **RN08** — Se o marco passar entre execuções, o aviso sai na primeira execução seguinte dentro da janela e não se repete.
- **RN09** — O sino é persistente e independente da cota de e-mail.
- **RN10** — O e-mail de atas é consolidado por destinatário, no máximo uma mensagem por dia.
- **RN11** — O sistema consulta `MailApp.getRemainingDailyQuota()` e preserva uma reserva para os avisos atuais e recuperação de senha.
- **RN12** — Atas de 30 dias têm prioridade de e-mail sobre 60, que têm prioridade sobre 90.
- **RN13** — Servidor comum não altera dados oficiais nem atas de outro responsável.
- **RN14** — Arquivamento preserva histórico e avisos já emitidos; não há exclusão física no MVP.
- **RN15** — Falha de consulta ou e-mail nunca apaga dados nem bloqueia o uso da tela.

## Navegação aprovada

- Desktop: atalhos principais no cabeçalho horizontal quando houver espaço.
- Mobile: menu compacto/suspenso.
- `Histórico` sai da barra inferior e vai para o menu.
- `Gestão da equipe` ocupa a posição liberada, inicialmente apenas com funções já existentes de equipe e disponibilidade/férias.
- `Gestão de Atas` fica no menu e pode ser acessada também por botão dentro da fase externa.

## Estados obrigatórios de interface

- Vazio: explica como adicionar a primeira ata.
- Carregando: skeleton sem bloquear a página inteira.
- API indisponível: mostra último sucesso e oferece cadastro manual/nova tentativa.
- Nenhuma ata encontrada: permite acompanhar publicação.
- Duplicada: informa onde a ata já está acompanhada.
- Sem vigência: permanece em pendências e não agenda aviso.
- Sem cota: aviso continua no sino e e-mail aparece como pendente/dispensado.
- Sucesso: confirma quantas atas foram adicionadas ao controle.

## Fora do escopo do MVP

- Escrever ou publicar qualquer dado no Compras.gov.br/PNCP.
- Gestão detalhada de consumo, empenhos, saldos, adesões e quantitativos por item.
- Relatórios analíticos de desempenho de servidores.
- Priorização de férias por produtividade.
- Importação automática de planilhas antigas.
- Disponibilização da Gestão de Atas para todas as unidades no primeiro lançamento.
- Serviço externo de e-mail transacional.

## Decisões aprovadas

1. Avisos e e-mails rodam somente em dias úteis, seguindo os acionadores atuais.
2. Todos os usuários autenticados da unidade podem visualizar as atas; edição segue a tabela de permissões.
3. Planilhas existentes não serão importadas no MVP; os acompanhamentos serão incluídos pela consulta ou cadastro manual.
4. A consulta ao Compras.gov.br é somente leitura e nunca publica dados externos.
