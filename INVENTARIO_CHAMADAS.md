# Inventário de Chamadas — base da Fase 1 (data-gateway)

> Deliverable da **Fase 0** do [PLANO_SEGURANCA.md](PLANO_SEGURANCA.md):
> "Inventariar todas as chamadas: cada `fetch()`, cada leitura Firestore, cada
> `innerHTML`." Levantado em **2026-06-23** sobre `app_gestao-reitoria`.
>
> Objetivo: dar visibilidade do que o futuro `data-gateway.js` precisa cobrir e,
> em especial, **destravar o token automático** da Fase 1.

---

## 1. Ponto único de comunicação (já existe, inline)

Todo o tráfego com o backend passa pelo bloco IIFE em `index.html` (~L776–1060):

| Função | Papel |
|---|---|
| `callApi` / `callApiPromise` | `fetch` GET ao Apps Script, timeout (`apiTimeoutMs`), fallback JSONP, `asError`. Anexa **unidade** automaticamente (L869). |
| `callApiJsonp` | Fallback via `<script>` quando `fetch` falha. |
| `invoke` | Despacho **leitura (Firestore) × escrita (Apps Script)**; trata `loginApp`/`trocarSenhaApp`; mapeia métodos `fs_*`. |
| `makeRunner` | Emula a API `google.script.run` (`withSuccessHandler`/`withFailureHandler`). |

`fetch()` cru fora desse bloco: **nenhum** (só `sw.js`, service worker, fora de escopo).

---

## 2. Leitura direta do Firestore (`appsel-firestore.js`)

Coleções lidas (sempre sob `unidades/{unidadeId}`):

| Origem | Coleções |
|---|---|
| `carregar()` | `processos`, `etapas`, `cargas`, `calendario` |
| `carregarCapacidade()` | `cargas`, `processos`, `etapas`, `servidores` |
| `listarUnidades()` | `unidades` |

Leituras que **permanecem no Apps Script** (coleção privada / não migradas):
`getHistorico` (cadeado de motivo), `getAlertasApp`, `getEmails`.

---

## 3. Métodos de backend por tipo e estilo de token  ⬅ chave da Fase 1

O token (`AUTH_TOKEN`) entra de **dois jeitos incompatíveis**, e é isso que
impede anexá-lo automaticamente no `callApi` hoje:

### 3a. Leitura — token **posicional** (1º arg)
`getEtapasParaApp`, `getCapacidadeApp`, `getHistorico`, `getServidoresApp`,
`getAlertasApp`, `getEmails`.

### 3b. Escrita — token **posicional** (posição varia!)
| Método | Posição do token |
|---|---|
| `salvarServidoresApp(lista, TOKEN)` | 2º |
| `resetarSenhaServidorApp(TOKEN, matricula)` | **1º** |
| `trocarSenhaApp(TOKEN, '', nova)` | **1º** |
| `atualizarStatusEtapa(linha, status, TOKEN)` / `fs_atualizarStatusEtapa(docId, status, TOKEN)` | 3º |
| `salvarEmailProcesso(pid, novo, TOKEN)` | 3º |
| `salvarEmail(servidor, novo, TOKEN)` | 3º |
| `iniciarProcessos(params, TOKEN)` | 2º |
| `logoutApp(TOKEN)`, `validarSessaoApp(TOKEN)`, `verificarTriggerAvisos(TOKEN)`, `instalarTriggerAvisos(TOKEN)`, `enviarEmailTesteServidor(serv, TOKEN)`, `enviarAvisosPrazoApp(TOKEN)` | 1º/2º |

### 3c. Escrita — token **nomeado** (`authToken:` em objeto)
`atribuirResponsaveisApp`, `salvarLinkSuapProcessoApp`, `devolverProcessoFilaApp`,
`regredirEtapa`/`fs_regredirEtapa`, `salvarOrdemFilaApp`,
`salvarNomeProcessoFilaApp`, `excluirProcessoApp`, `cadastrarProcesso`,
`fs_salvarOutros`/`salvarOutrosCap`, `fs_salvarDadosUnidade`, `fs_excluirUnidade`,
`fs_getDadosUnidade`.

**Conclusão p/ Fase 1:** para o `callApi` anexar o token automaticamente é
preciso **padronizar o estilo** antes — recomendado migrar 3a/3b para o estilo
nomeado `authToken` (3c), ajustando as assinaturas correspondentes no `Code.gs`.
Só então o token sai dos ~40 pontos de chamada e passa a ser injetado num lugar
só. Enquanto isso não acontece, o token continua manual (sem regressão).

---

## 4. Renderização — `innerHTML` (escopo da Fase 3, anti-XSS)

`index.html`: **70 usos** de `innerHTML`. Não detalhados aqui por linha — são
alvo da **Fase 3** (`dom.text`/`dom.html`). Registrado o total como baseline.

---

## 5. Itens da Fase 0 ainda abertos

- [ ] **SRI** nos scripts externos (bloqueado: egress nega `gstatic`/`jsdelivr`).
- [ ] Criar pasta `src/` para iniciar a quebra do `index.html`.
- [x] Inventário de chamadas — **este documento**.
