# Plano — Multiunidade (CPII) + Painel do Diretor Geral

Evolução do sistema atual (mono-unidade: Reitoria/SEL) para atender **todas as
unidades do Colégio Pedro II**, mantendo **custo zero** (Firebase Spark, GitHub
Pages, Apps Script) e o modelo já em produção: leitura direta do Firestore,
escrita e e-mails via Apps Script com conta de serviço.

## Decisões aprovadas (2026-06-21)
1. **Modelo de dados:** subcoleções por unidade (`unidades/{unidadeId}/...`).
2. **Frontend:** mesmo código/deploy; a unidade vem do **login** (sem duplicar repositórios).
3. **Apps Script:** **um único** projeto central atende todas as unidades.
4. **Privacidade:** os painéis por unidade **continuam públicos** (leitura aberta, como hoje).
5. **Diretor Geral:** papel **somente leitura/acompanhamento** — nunca age (não move fila, não escreve).

---

## 1. Modelo de dados (Firestore)

```
unidades/{unidadeId}                 # ex.: "reitoria-sel", "campus-tijuca", ...
  (doc)  -> { nome, sigla, ativo, criadoEm }
  /processos/{processoId}
  /etapas/{etapaId}
  /servidores/{matricula}
  /cargas/{cargaId}
  /calendario/{id}
  /config/{doc}                      # matrizPontuacao etc.
  /emails/{doc}        (privado)
  /historico/{doc}     (privado)
  /dispositivos/{doc}  (privado)
  /resumo/atual                      # agregado p/ o Painel do Diretor (ver §4)
```

- Os dados de hoje migram para `unidades/reitoria-sel/...` (1ª unidade).
- IDs de processo continuam por unidade (ex.: prefixo da sigla da unidade).
- **Isolamento natural:** cada unidade só enxerga a sua subárvore.
- **Visão do diretor:** *collectionGroup query* em `resumo` (ou `processos`)
  agrega todas as unidades de uma vez.

## 2. Autenticação e papéis (Apps Script, como hoje)

- O login continua no Apps Script. Cada usuário passa a ter `unidadeId` + `papel`:
  - `equipe` — opera a sua unidade.
  - `chefe` — opera a sua unidade + vê a fila de prioridade.
  - `diretor` — acesso **somente leitura** consolidado a todas as unidades.
- No login, o Apps Script devolve `{ unidadeId, papel }`. O frontend passa a
  prefixar **todas** as leituras/escritas com `unidades/{unidadeId}/`.

## 3. Regras do Firestore

- Leitura pública por unidade nas coleções consumidas pelos painéis
  (`processos, etapas, servidores, cargas, calendario, config, resumo`) —
  mesmo modelo de hoje, só que sob `unidades/{u}/`.
- `emails, historico, dispositivos`: sempre privados.
- Escrita sempre `false` (somente a conta de serviço, que ignora as regras).
- Criar **índice de collectionGroup** para `resumo` (e, se preciso, `processos`).

## 4. Documento-resumo (guardião do custo zero)

O limite do Spark é de leituras/dia (~50 mil). Com N unidades **e** um painel do
diretor lendo tudo, as leituras se multiplicam. Solução:

- O Apps Script grava `unidades/{u}/resumo/atual` a cada escrita relevante
  (e em um trigger diário), com KPIs já calculados:
  `{ total, andamento, atrasados, fila, concluidos, capacidadePct,
     atrasadosLista[], atualizadoEm }`.
- O **Painel do Diretor** lê só ~N documentos pequenos (um por unidade), em vez
  de milhares de etapas. Custo praticamente constante, independente do nº de acessos.

## 5. Frontend

- **App de Gestão** e **Painel** (existentes): trocar os caminhos de leitura
  (`appsel-firestore.js`, `painel-firestore.js`) para `unidades/{unidadeId}/...`.
  `unidadeId` vem do login (App Gestão) ou de `?u=<unidadeId>` na URL (Painel público).
- **Painel do Diretor** (novo, só leitura): lê os `resumo/atual` de todas as
  unidades; mostra ranking de andamento, atrasos por unidade, capacidade por
  equipe, processos parados e drill-down por unidade.

## 6. Apps Script central

- `FirestoreSync.gs`: cada função `fs_*` deriva `unidadeId` da sessão/token do
  usuário e endereça `unidades/{u}/...`.
- E-mails: um trigger central percorre as unidades ativas, lê os dados de cada
  uma e envia para os e-mails daquela unidade. Atenção à cota do MailApp
  (1500/dia no Workspace g12.br — folgado para o volume esperado).
- Após cada escrita, atualizar o `resumo/atual` da unidade afetada.

---

## Hospedagem (GitHub Pages — Fase 5/Firebase Hosting segue cancelada)

Os três apps são 100% estáticos (rodam no navegador, leem o Firestore via SDK por
CDN e escrevem via `fetch` no Apps Script). Nenhum precisa de servidor próprio —
o GitHub Pages serve os arquivos, como hoje. Toda a resolução de "qual unidade"
acontece no cliente:

- **App de Gestão:** 1 único deploy atende todas; o `unidadeId` vem do login.
- **Painel público:** mesma página para todas as unidades; o campus vem por
  query string, ex.: `.../painel/?u=campus-tijuca`. Usar `?u=` (e não caminho
  `/campus-tijuca`) porque o GitHub Pages é estático e não tem roteamento de
  servidor — query string funciona sem o truque de fallback 404.
- **Painel do Diretor:** página nova (repo próprio ou subpasta), só leitura.

Privacidade coerente: os painéis já são públicos (decisão aprovada); o que fica
"público" são os arquivos do app, não os dados — coleções sensíveis seguem
fechadas pelas regras do Firestore. **Não é preciso Firebase Hosting.**

## Módulo de Administração (onboarding self-service)

Em vez de o cadastro de cada campus ser feito manualmente pelo dev, o próprio app
ganha uma área de **Administração**, visível conforme o papel:

| Papel | Pode |
|---|---|
| **Diretor (super-admin)** | Criar/ativar/desativar unidades; nomear o admin de cada campus; ver tudo |
| **Admin do campus** | Gerir SÓ a sua unidade: equipe/servidores, usuários, calendário, matriz de pontuação |
| **Chefe / Equipe** | Operam os processos (como hoje) |

**Modelo de adesão aprovado (2026-06-21):** o **diretor habilita** a unidade e
nomeia o admin do campus (porta de entrada controlada); a partir daí **o campus
se autogere**. Não há autocadastro aberto.

Fluxo de uma unidade nova:
1. Diretor cria `unidades/{novoId}` e indica o e-mail do admin do campus.
2. Sistema **semeia** a unidade a partir de um *template*: calendário (feriados),
   `config/matrizPontuacao` e config padrão — para não começar do zero.
3. Diretor delega: o admin do campus monta a própria equipe e toca os processos.

**Segurança:** toda escrita continua via Apps Script + conta de serviço, com
**trava por papel + unidade** (o token de sessão carrega `unidadeId` e `papel`;
um admin do Campus A não consegue tocar no Campus B). A tela é só o controle
remoto; quem valida e grava é o Apps Script. Funções novas (guardadas por papel):
`fs_criarUnidade`, `fs_definirAdminCampus`, `fs_cadastrarUsuario`, etc.

Isto **substitui** o cadastro manual das Fases C/E pela Fase F abaixo. Não altera
o modelo de dados nem a hospedagem.

## Fases de execução

- **Fase A — Modelagem + migração estrutural.** Criar `unidades/{u}`, mover os
  dados atuais para `unidades/reitoria-sel/...`, publicar regras novas e índices
  de collectionGroup. (script de reorganização, com `--dry-run`.)
- **Fase B — Parametrizar por unidade.** Login devolve `unidadeId`+`papel`;
  caminhos prefixados no frontend e no Apps Script; Painel público lê `?u=`.
- **Fase C — Unidade-piloto.** Cadastrar uma 2ª unidade (servidores, usuários,
  calendário); validar isolamento e e-mails.
- **Fase D — Resumo + Painel do Diretor.** Gravação do `resumo/atual`; novo app
  só-leitura consolidado.
- **Fase F — Onboarding self-service.** Módulo de Administração (ver seção acima):
  papéis diretor/admin-campus, criação+seed de unidade, delegação. Substitui o
  cadastro manual.
- **Fase E — Rollout.** Demais unidades (já via Fase F), treinamento, congelamento.

## Riscos / pontos de atenção
- **Cota Spark (leituras):** mitigada pelo documento-resumo (§4).
- **Cota de e-mail (MailApp):** monitorar; se estourar, distribuir o envio ao
  longo do dia ou avaliar contas por região.
- **IDs de processo:** garantir unicidade por unidade (prefixo da sigla).
- **Migração:** a Reitoria/SEL já está em produção — a Fase A precisa ser feita
  com janela e backup (a planilha congelada continua sendo o backup).
- **Privacidade:** os painéis por unidade seguem **públicos** (decisão aprovada).
  Como o Painel do Diretor é só leitura e os dados de painel já são públicos, ele
  pode usar a mesma leitura aberta; coleções sensíveis permanecem privadas.
