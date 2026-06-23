# Incidente — leituras server-side do Firestore falhando (REST `RESOURCE_EXHAUSTED`)

> Diagnosticado em **2026-06-23** durante os testes da Fase 1 (token automático).
> **Não é regressão** do deploy v61 (token automático) — é um problema
> independente do Firestore/Apps Script.

## Sintoma

Editar o e-mail de um processo retorna **"Processo &lt;id&gt; não encontrado"**
para qualquer processo da unidade `reitoria-sel`, mesmo existindo.

## Causa raiz

**Todas as leituras server-side do Firestore via API REST estão falhando.** O
Apps Script (`FirestoreSync.gs`) lê o Firestore por REST
(`firestore.googleapis.com/v1`, com bearer de service account); essa API estava
retornando **`429 RESOURCE_EXHAUSTED`** (confirmado também no caminho com apiKey).

O erro ficava **mascarado** por dois pontos do código:

1. `_fsGet_(path)` fazia `catch(e){ return null }` para **qualquer** erro → um
   429/403 virava `null`, que `fs_salvarEmailProcesso` traduz como
   "Processo não encontrado".
2. `fs_getDadosUnidade` retornava `ok:true` com **campos vazios** quando a
   leitura falhava (confirmado: `nome`/`sigla`/`endereco`/`email` com
   comprimento 0, mas `ok:true`).

### Evidências
- `fs_getDadosUnidade({})` → `ok:true` porém todos os campos vazios (leitura falhou, mascarada).
- Leitura de processo falha de forma **consistente** (não intermitente) → descarta rajada pontual; é throttling/quota da API REST.
- API REST do Firestore retorna **429 `RESOURCE_EXHAUSTED`**.
- **Escritas (PATCH) e leituras do cliente (SDK gRPC) funcionam** → o app parece
  saudável; só quebram operações server-side que dependem de leitura (ex.:
  `fs_salvarEmailProcesso` faz um `_fsGet_` de existência antes de gravar).

**Por que cliente funciona e servidor não:** o cliente lê via SDK (canal gRPC) e
o Apps Script lê via API REST — cotas/limites distintos. A REST está exaurida.

## Correções aplicadas no código (`FirestoreSync.gs`)

1. **`_fsReq_`** — passa a **repetir** em `429`/`503` (throttling transitório) com
   backoff curto (até 3×) antes de falhar, e anexa `httpCode` ao erro.
2. **`getDocument` (wrapper `_fs_()`)** — só trata **404** como "não existe"
   (retorna `null`); **demais erros propagam** em vez de virar `null`.
3. **`_fsGet_`** — deixa de engolir o erro (sem `try/catch` externo); 404 continua
   `null`, mas 429/403/5xx **propagam** para o chamador tratar/mostrar.
4. **`fs_getDadosUnidade`** — deixa de mascarar: em falha de leitura retorna
   `ok:false` com a mensagem real, em vez de `ok:true` com campos vazios.

> ⚠️ As correções **tornam o erro visível** — não restauram a leitura. Enquanto a
> quota REST estiver exaurida, as operações server-side de leitura passarão a
> retornar **erro claro** (em vez de "não encontrado"/dados vazios).

## Ação pendente (dono do projeto) — a causa de fato

Verificar **quota/billing do Firestore** no projeto `gestao-de-processos-a0099`:
- Firebase Console → **Uso**; GCP Console → APIs e Serviços → **Cloud Firestore
  API → Cotas/Métricas**, procurando `RESOURCE_EXHAUSTED`.
- Avaliar plano (Spark/gratuito batendo limite diário vs **Blaze**).
- Conferir se há restrição/limite específico na **API REST** do Firestore.

## Observação sobre o repositório

Os arquivos em `apps-script/` (especialmente `FirestoreSync.gs`) estavam
**defasados** em relação ao código publicado no Apps Script (ex.: `_fsUnidade_`
no repo usava só a Script Property, enquanto o publicado já usa
`_FS_UNIDADE_REQ`). Recomenda-se **ressincronizar o repo a partir do código
publicado** numa tarefa à parte, para o controle de versão refletir produção.
