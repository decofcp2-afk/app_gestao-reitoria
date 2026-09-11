# Tarefas: Gestão de Atas — MVP

Status: implementação concluída em branch de feature; piloto e publicação permanecem pendentes.

## Onda 0 — Proteção da produção

- [x] **T001** — Criar branch de feature e registrar baseline da suíte atual. **Verificação:** `npm test` passa sem mudanças funcionais.
- [x] **T002** — Adicionar feature flag por unidade com padrão desligado. **Verificação:** nenhuma rota, aba ou trigger de atas aparece em `main`/unidades sem flag.
- [x] **T003** — Preparar fixtures oficiais anonimizadas e prévia local. **Verificação:** testes não consultam nem escrevem dados de produção.

## Onda 1 — Contrato de dados e regras puras

- [x] **T004** — Implementar normalização do cabeçalho da API. **Verificação:** fixture realista produz número, compra/ano, PNCP e vigência esperados.
- [x] **T005** — Implementar status por vigência e fuso de Brasília (RN06). **Verificação:** casos ativa, 90/60/30, vencida e datas-limite passam.
- [x] **T006** — Implementar chave de identidade/deduplicação oficial e manual (RN03/RN04). **Verificação:** reconsulta não cria segunda ata.
- [x] **T007** — Implementar chave de aviso por data final e marco (RN07/RN08). **Verificação:** mesma vigência não repete; vigência alterada volta a gerar marco.
- [x] **T008** — Atualizar regras Firestore para manter `atas`, `avisosAtas` e `syncAtas` privadas. **Verificação local:** regras negam explicitamente acesso direto do cliente.

## Onda 2 — Backend de consulta e acompanhamento

- [x] **T009** — Criar cliente paginado e somente leitura do módulo ARP. **Verificação:** consulta retorna várias atas da mesma compra sem escrita externa.
- [ ] **T010 — Futuro** — Consultar itens/fornecedores sob demanda. Adiado para manter o MVP focado em vigência e responsável.
- [x] **T011** — Criar `consultarAtasComprasApp` com autorização e validação. **Verificação:** sessão válida e feature ativa são obrigatórias.
- [x] **T012** — Criar cadastro manual e oficial idempotente. **Verificação:** manual funciona sem API e oficial preenche dados sem redigitação.
- [x] **T013** — Criar vínculo posterior manual→oficial. **Verificação:** preserva responsável/observação, arquiva o manual substituído e não duplica a ata ativa.
- [x] **T014** — Criar listagem e detalhe escopados à unidade. **Verificação:** todos os caminhos usam o namespace da unidade da sessão.
- [x] **T015** — Criar atualização interna e arquivamento lógico. **Verificação:** oficial permanece imutável; somente autorizado edita/arquiva.
- [x] **T016** — Criar sincronização diária resiliente. **Verificação:** falha HTTP conserva snapshot e registra estado parcial.

## Onda 3 — Interface

- [x] **T017** — Criar módulo isolado `atas.js`/`atas.css` e contêiner da tela. **Verificação:** feature flag desligada não altera a interface atual.
- [x] **T018** — Implementar tela principal aprovada com KPIs, filtros, paginação e tabela. **Verificação:** uma linha por ata e filtros por situação, responsável, ano e busca.
- [x] **T019** — Implementar modal `Adicionar ata ao controle`. **Verificação:** consulta e cadastro manual são caminhos alternativos no mesmo fluxo.
- [x] **T020** — Implementar seleção de múltiplas atas sem mostrar itens por padrão. **Verificação:** duas atas selecionadas geram dois acompanhamentos ligados ao mesmo processo.
- [x] **T021** — Implementar drawer de detalhe aprovado. **Verificação:** datas oficiais bloqueadas; responsável e observação editáveis conforme permissão.
- [x] **T022** — Implementar estados vazio, carregando, API indisponível, não localizada, duplicada e sucesso. **Verificação:** cada estado informa a recuperação adequada.
- [x] **T023** — Implementar responsividade e acessibilidade básica. **Verificação:** desktop e mobile sem corte; foco visível; Escape fecha drawer/modal.
- [x] **T024** — Atualizar service worker e versionamento de cache. **Verificação:** cache atualizado para a versão 10.

## Onda 4 — Sino e KPIs

- [x] **T025** — Acrescentar filtro principal `Atas`/`Processos` ao sino. **Verificação:** Gestão de Atas abre com Atas.
- [x] **T026** — Exibir atas vencidas e marcos 90/60/30. **Verificação:** ordem é vencida, 30, 60, 90; clique abre o drawer correto.
- [x] **T027** — Remover processos vencidos do sino sem alterar KPIs. **Verificação:** processo atrasado continua no KPI/painel e não duplica notificação.
- [x] **T028** — Garantir persistência independente de e-mail. **Verificação:** cota zero ainda mostra todos os avisos no app.

## Onda 5 — E-mail consolidado

- [x] **T029** — Agrupar alertas de atas por destinatário. **Verificação:** cinco atas para uma pessoa produzem um único digest.
- [x] **T030** — Aplicar destinatários: responsável e chefia, sem requisitante. **Verificação:** destinatários derivam da equipe da unidade.
- [x] **T031** — Implementar quota guard e reserva. **Verificação:** função nunca tenta enviar acima do saldo reservado.
- [x] **T032** — Implementar prioridade vencida→30→60→90. **Verificação:** cota parcial seleciona os alertas mais urgentes.
- [x] **T033** — Implementar template aprovado do digest. **Verificação:** HTML mostra resumo e linhas sem conteúdo duplicado.
- [x] **T034** — Registrar envio/falha/dispensa por cota e impedir repetição. **Verificação:** aviso enviado não é reenviado; falhas permanecem elegíveis para nova tentativa.

## Onda 6 — Navegação mínima aprovada

- [x] **T035** — Adicionar Gestão de Atas ao menu e à fase externa. **Verificação:** processo elegível abre fluxo prefill; demais não mostram ação inadequada.
- [x] **T036** — Mover Histórico para o menu e criar entrada Gestão da Equipe. **Verificação:** Histórico continua acessível e Gestão da Equipe usa somente funções já existentes.
- [x] **T037** — Adaptar atalhos horizontais no desktop e menu compacto no mobile. **Verificação:** sem overflow nos breakpoints do app.

## Onda 7 — Auditoria e piloto

- [x] **T038** — Rodar suíte completa e testes novos. **Verificação:** todos passam e não há regressão nos testes atuais.
- [ ] **T039** — Testar fluxos felizes e infelizes autenticados na unidade de teste. **Verificação:** evidências de consulta, manual, duplicata, API offline e autorização.
- [ ] **T040** — Validar segurança e exposição Firestore. **Verificação:** coleções privadas não aparecem para cliente anônimo.
- [ ] **T041** — Publicar código com feature flag desligada somente após aprovação do PR. **Verificação:** produção permanece visual e funcionalmente igual.
- [ ] **T042** — Habilitar piloto do sino em `reitoria-sel`. **Verificação:** atas reais aparecem sem disparo de e-mail.
- [ ] **T043** — Confirmar proprietário institucional dos triggers e cota. **Verificação:** painel do Apps Script registra conta/acionadores esperados.
- [ ] **T044** — Habilitar digest por e-mail no piloto. **Verificação:** envio controlado, deduplicado e refletido no histórico.

## Dependências

- T009–T016 dependem de T004–T008.
- T017–T024 dependem de T011–T015.
- T025–T028 dependem de T014, T021 e T007.
- T029–T034 dependem de T007, T014 e T028.
- T035–T037 dependem da interface funcional, mas podem ser revisadas antes da ativação.
- T041–T044 dependem de toda a auditoria e de aprovação explícita.

## Mapeamento das regras

| Regras | Tarefas |
|---|---|
| RN01–RN05 | T004, T006, T009–T016 |
| RN06–RN08 | T005, T007, T016, T026 |
| RN09–RN12 | T025–T034 |
| RN13–RN15 | T008, T011, T014–T016, T022, T040 |

## Auditoria de consistência inicial

- O foco em datas e responsáveis está preservado; itens e grupos não invadem a tela principal.
- A API oficial é ponto externo de falha, mas não é ponto único: cadastro manual e snapshot permitem continuidade.
- O modelo suporta várias atas por compra sem obrigar o usuário a gerenciar detalhes dos itens.
- Sino e e-mail usam a mesma regra de marcos, mas são canais independentes.
- A implementação foi autorizada e concluída na branch de feature. Publicação e piloto continuam condicionados à aprovação explícita e às tarefas T039–T044.
