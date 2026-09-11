# Plano técnico: Gestão de Atas — MVP

Status: implementado em `feature/gestao-atas-mvp`; publicação e piloto ainda não iniciados.

## Stack

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Interface | HTML/CSS/JavaScript puro | Preserva a arquitetura atual e o GitHub Pages |
| Gateway/autorização | Google Apps Script | Reaproveita sessão, permissões, triggers e MailApp |
| Persistência | Firestore por unidade | Fonte ativa do app, cache resiliente e auditoria |
| Fonte oficial | API Dados Abertos Compras.gov.br | Consulta pública e somente leitura de ARPs/itens |
| E-mail | MailApp | Reaproveita infraestrutura atual com quota guard e resumo consolidado |
| Aviso persistente | Central de notificações do app | Não depende da entrega de e-mail |
| Testes | `node --test` | Ferramenta já adotada pelo repositório |

## Arquitetura

```text
GitHub Pages (index.html + atas.js + atas.css)
          |
          | appsel.call + token + unidade
          v
Google Apps Script (Atas.gs)
   |            |                    |
   | leitura    | conta de serviço   | MailApp + quota
   v            v                    v
Compras.gov   Firestore           E-mail consolidado
 API          unidades/{u}/atas   90 / 60 / 30 dias
                   |
                   v
          Sino persistente no app
```

O navegador nunca chama a API oficial diretamente e nunca recebe credenciais do Firestore. O Apps Script consulta, normaliza, autoriza e persiste.

## Integração oficial

- ARPs: `GET https://dadosabertos.compras.gov.br/modulo-arp/1_consultarARP`
- Itens/fornecedores ficam adiados para uma evolução posterior do MVP.
- A API exige UASG e janela de vigência; compra/ano são filtrados no backend após a consulta paginada.
- Chave oficial preferencial: `numeroControlePncpAta`.
- O cabeçalho oficial fornece número da ata/compra, objeto, datas, valor e links PNCP.
- O campo grupo/lote não é assumido como oficial; pode existir apenas como anotação interna futura.

## Estratégia de sincronização

1. Consulta imediata ao cadastrar/vincular uma compra.
2. Sincronização diária antes da geração dos alertas.
3. Paginação até `totalPaginas`, em janelas anuais aceitas pela API.
4. Upsert idempotente por identificador PNCP.
5. Registro manual é comparado por UASG + compra/ano + número da ata.
6. Último snapshot válido permanece disponível em falhas HTTP, timeout ou resposta inválida.
7. O frontend mostra `último sucesso`, não apenas `última tentativa`.

## Estratégia de avisos e cota

- O sino é calculado a partir das atas persistidas e não depende do MailApp.
- A chave persistente do aviso inclui ata, data final e marco; leituras e destinatários de e-mail são deduplicados dentro do documento.
- E-mail: um digest por destinatário/dia, reunindo todas as atas elegíveis.
- Destinatários: responsável e chefia da unidade; requisitante não participa.
- Prioridade: vencida, 30, 60 e 90 dias.
- Antes do envio, usar `MailApp.getRemainingDailyQuota()`.
- Configuração inicial proposta: reservar pelo menos 50 destinatários/dia para os fluxos atuais enquanto o acionador ainda estiver em conta pessoal.
- Limitar a 20 destinatários de digest por execução no piloto SEL/SEPMA.
- Ao faltar cota, persistir estado e manter o aviso no app; nunca fazer loop de envio no mesmo dia.
- Pré-condição recomendada para expansão multiunidade: acionadores instalados por conta institucional Google Workspace.

## Permissões

- Toda leitura/escrita de atas passa pelo Apps Script autenticado.
- `getGestaoAtasApp`: qualquer usuário autenticado da unidade.
- `consultarAtasComprasApp`: qualquer sessão válida da unidade com a feature ativa; a autorização do vínculo é conferida ao salvar.
- `salvarAtaApp`: responsável externo do processo, chefia ou admin.
- `atualizarAtaInternaApp`: responsável da ata, chefia ou admin.
- `arquivarAtaApp`: chefia ou admin.
- O backend valida unidade da sessão; o cliente não escolhe livremente outra unidade.

## Estrutura de arquivos proposta

```text
index.html                         navegação, contêiner da aba e integração com sino
atas.js                            estado e renderização da Gestão de Atas
atas.css                           estilos isolados e responsivos
sw.js                              versão/cache dos novos arquivos
apps-script/Atas.gs                API oficial, CRUD, sync, alertas e digest
apps-script/Code.gs                gateway, permissões e instalação dos triggers
apps-script/FirestoreSync.gs       helpers reutilizados; sem duplicar cliente REST
firebase/firestore.rules.multiunidade
                                   atas/avisosAtas/syncAtas privados ao cliente
tests/atas-domain.test.js          datas, estados, normalização e filtros
tests/atas-backend.test.js         contrato atual da API, leitura GET e vínculo manual
docs/gestao-atas/                  especificação, plano e tarefas
```

## Feature flag e rollout seguro

- `GESTAO_ATAS_UNIDADES` guarda as unidades habilitadas; ausência da propriedade significa `false` para todas.
- A interface, rotas e triggers de atas respeitam a flag.
- Desenvolvimento em branch e PR; nenhum merge automático.
- Testes com fixtures anonimizadas e namespace/unidade de teste.
- Primeira publicação de código com flag desligada.
- Smoke test autenticado na implantação antes de habilitar `reitoria-sel`.
- Habilitação das notificações no app antes do envio de e-mails.
- E-mail habilitado por último, após verificar conta proprietária dos triggers e cota remanescente.

## Ondas de entrega

### Onda 1 — Fundação privada

- Schema, regras, normalização da API, feature flag e testes puros.
- Nenhuma tela visível e nenhum trigger ativo.

### Onda 2 — Consulta e cadastro

- Consulta por compra, múltiplas atas, cadastro manual, deduplicação e vínculo posterior.
- Gestão de Atas ainda restrita ao ambiente/usuário de teste.

### Onda 3 — Interface aprovada

- Tela principal, filtros, modal de cadastro e drawer de detalhe.
- Estados vazio, carregando, erro, duplicado e indisponibilidade da API.

### Onda 4 — Sino

- Filtros Atas/Processos.
- Atas vencidas e marcos 90/60/30.
- Processos vencidos removidos do sino, preservados nos KPIs.

### Onda 5 — E-mail

- Digest por destinatário, deduplicação, prioridade, cota, auditoria e fallback.
- Ativação controlada somente no piloto.

### Onda 6 — Navegação mínima

- Gestão de Atas no menu e na fase externa.
- Histórico no menu; Gestão da Equipe assume a vaga com funções existentes.
- Cabeçalho horizontal no desktop e compacto no mobile.

## Decisões técnicas

| Decisão | Alternativa descartada no MVP | Motivo |
|---|---|---|
| Apps Script como gateway | Chamada direta da API pelo browser | Cache, autorização, consistência e menor acoplamento |
| Firestore privado para atas | Expor coleção para leitura pública | Processo/responsável são dados internos |
| Linha por ata | Linha por compra | Cada compra pode gerar várias atas independentes |
| Consulta + cadastro manual | Somente importação automática | Publicação pode ainda não existir |
| Snapshot oficial + campos internos | Copiar tudo manualmente | Evita redundância e preserva organização do setor |
| Sino primário | E-mail como fonte de verdade | Cota e entrega de e-mail não são garantidas |
| Digest diário | Um e-mail por ata | Protege cota e reduz ruído |
| Feature flag por unidade | Liberação geral | Sistema já está em produção |

## Riscos técnicos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| API oficial indisponível/lenta | média | cache, timeout, último sucesso e cadastro manual |
| Associação manual duplicada | média | chave PNCP + fallback composto + confirmação explícita |
| Uma compra gerar muitas atas | média | seleção múltipla, paginação e uma linha por ata |
| Conta Gmail pessoal atingir 100 destinatários/dia no MailApp | média | piloto unitário, digest, quota guard, reserva e sino |
| Trigger instalado pela conta errada | média | verificação visível e checklist institucional |
| Alteração de vigência oficial | média | nova chave de dedupe usa `vigenciaFim`; sinalizar mudança |
| Exposição pública de dados internos | baixa/alta gravidade | regras privadas + gateway autenticado + teste de regras |
| Regressão no app monolítico | média | arquivos isolados, feature flag e suíte completa |

## Dependências externas

- API de Dados Abertos do Compras.gov.br: consulta oficial. Em falha, usar snapshot.
- MailApp: canal complementar. Em falha/cota, sino permanece.
- Firestore: persistência. Em falha de escrita, operação não é confirmada como salva.
- GitHub Pages: interface. Novos arquivos entram no cache versionado do service worker.

## Critério para publicação

- Revisão e aprovação do PR.
- Smoke test autenticado com a flag ainda desligada.
- Publicação do backend e das regras antes da habilitação da unidade.
- Sino habilitado e verificado antes do primeiro envio de e-mail.
