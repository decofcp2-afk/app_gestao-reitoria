# Plano de Segurança — Camada de Abstração

> **Objetivo:** introduzir uma camada de abstração entre as telas e os recursos
> sensíveis (backend, dados, sessão, renderização) para elevar a segurança do
> sistema sem reescrever tudo de uma vez. Cada fase é incremental e mantém o
> comportamento atual funcionando.

Aplicável a **app_gestao-reitoria** e, em paralelo, ao **painel-contratacoes-reitoria**
(que compartilha o mesmo padrão de arquitetura).

---

## 1. Diagnóstico do estado atual

| Aspecto | Situação hoje | Risco |
|---|---|---|
| Frontend | `index.html` monolítico (~4.700 linhas) com auth, dados e UI misturados | Difícil auditar; superfície de erro grande |
| Acesso a dados | `fetch()` ao Apps Script + leituras diretas do Firestore espalhadas | Sem ponto único de controle/validação |
| Autenticação | Challenge/response SHA-256 + salt; sessão por token no `PropertiesService` | Admin padrão `admin/1234`, senha inicial `123456` |
| Renderização | ~70 usos de `innerHTML` sem sanitização central | Risco de XSS |
| Cabeçalhos | Sem Content-Security-Policy; scripts externos sem SRI | XSS / script externo adulterado |
| Firestore | Leitura pública, escrita só via service account | OK no modelo escolhido, mas cliente acessa direto |

**Conclusão:** a "camada de abstração de segurança" consiste em **centralizar
acesso a dados, autenticação, validação e renderização** em módulos com
fronteiras claras, substituindo as chamadas dispersas.

> **Incidente aberto (2026-06-23):** leituras server-side do Firestore (API REST)
> falhando com `RESOURCE_EXHAUSTED`, mascaradas como "Processo não encontrado".
> Diagnóstico, correções de mascaramento já aplicadas e a ação pendente de
> quota/billing estão em [INCIDENTE_FIRESTORE_REST.md](INCIDENTE_FIRESTORE_REST.md).

> **Higiene de dados (2026-06-24):** normalizada a caixa do nome do servidor nas
> cargas (`"BRUNO"`/`"Bruno"`, `"AMANDA"`/`"Amanda"`) — fonte de fragilidade em
> agrupamentos por nome. Helper `_fsNomeServ_` (Title Case) aplicado na **origem**
> (escritas de `cargas.servidor` em `FirestoreSync.gs`: criar processo, atribuir
> responsáveis, backfill) + função de manutenção idempotente
> `normalizarNomesCargasTodasUnidades()` para limpar os dados já existentes (rodar
> no editor do Apps Script). Não afeta o KPI do painel (que soma por fase, não por
> nome). Requer **deploy** do Apps Script para valer em produção.

---

## 2. Princípios

1. **Ponto único de entrada** para cada recurso sensível (dados, sessão, DOM).
2. **Cliente nunca é confiável** — toda validação do cliente é revalidada no Apps Script.
3. **Incremental** — nenhuma fase quebra o que já funciona; rollout com *report-only* antes de *enforce*.
4. **Reuso entre os dois repos** — os módulos nascem genéricos para virarem base comum.

---

## 3. Fases

### Fase 0 — Fundação e baseline (sem mudar comportamento)
- [x] **CSP** via `<meta http-equiv="Content-Security-Policy">` no `index.html`. (Report-only **não** é suportado por `<meta>` e o site é estático no GitHub Pages, então a CSP é enforcing e permissiva — `'unsafe-inline'` para script/style — para não quebrar. **Verificar em navegador** antes de tirar o PR de draft.)
- [x] Meta `referrer` = `strict-origin-when-cross-origin`.
- [ ] **SRI** (`integrity` + `crossorigin`) nos scripts externos (`firebase-app-compat`, `firebase-firestore-compat`, `sortablejs`). **Bloqueado neste ambiente**: o egress nega `www.gstatic.com`/`cdn.jsdelivr.net`, impedindo o cálculo do hash `sha384`. Calcular num ambiente com acesso e fixar a versão.
- [ ] Criar pasta `src/` (ou `js/`) para iniciar a quebra do `index.html`.
- [x] Inventariar todas as chamadas: cada `fetch()`, cada leitura Firestore, cada `innerHTML`. → ver [INVENTARIO_CHAMADAS.md](INVENTARIO_CHAMADAS.md) (2026-06-23). Revelou que o token entra em estilos incompatíveis (posicional × nomeado), o que precisa ser padronizado antes do token automático da Fase 1.

### Fase 1 — Camada de Acesso a Dados (`data-gateway.js`)
Único módulo autorizado a falar com o backend.

**Estado em 2026-06-23:** a Fase 1 está **quase concluída**. O gateway funciona
**inline** no `index.html` (bloco IIFE `callApi`/`invoke`/`makeRunner`, ~linhas
776–1015); a leitura está isolada em `appsel-firestore.js`
(`AppselFirestore.carregar*`); o **token já é anexado automaticamente** (ver
abaixo, ATIVO em produção via Apps Script v61). Falta apenas a **extração** para
arquivo próprio (auditabilidade) e a **limpeza dos call sites** que ainda mandam
o token posicional (opcional — hoje é redundante, não obrigatório).

- [x] `api.read(route, params)` — leitura encapsulada em `AppselFirestore` (Firestore) com fallback ao Apps Script; o despacho leitura×escrita vive em `invoke()`.
- [x] `api.write(route, params)` — sempre via Apps Script (`callApi('appsel.call', …)`).
- [x] Centraliza timeout, retry e tratamento de erro padronizado (✅ `callApi`: timeout + fallback JSONP + `asError`) **e anexa o token de sessão automaticamente** (2026-06-23): `callApi` adiciona `token` no topo da requisição (como a `unidade`); o `Code.gs` (v61) usa `_AUTH_TOKEN_REQ` como fallback em `_authGetSession_` quando a função não recebe o token posicional. **Verificado ao vivo** (write de status de etapa via fallback retornou `ok:true`, sem token posicional). Mudança aditiva: os ~38 call sites que ainda passam o token posicional seguem válidos.
- [~] Telas já chamam o backend **apenas** via `invoke`/`makeRunner` (emula `google.script.run`), mas o gateway ainda **não é módulo separado** — continua embutido no `index.html`. **Pendente:** extrair para `data-gateway.js`.

**Token automático — CONCLUÍDO (2026-06-23).** Em vez de padronizar os ~40 call
sites (arriscado), foi usada uma abordagem **aditiva e retrocompatível**:
`callApi` anexa `token` no topo da requisição (como a `unidade`) e o `Code.gs`
(`doGet` → `_AUTH_TOKEN_REQ` → fallback em `_authGetSession_`) o usa quando a
função não recebe o token posicional. Deployado como **Apps Script v61** (mesma
URL `/exec`) e verificado ao vivo. Os call sites antigos seguem válidos.

**Próximos passos (opcionais, na ordem):**
1. **Limpar os ~38 call sites** que ainda mandam o token posicional, agora que é
   redundante. Cada remoção é independente e segura (o servidor já faz fallback).
   Cuidado com os de token no **1º arg** (`resetarSenhaServidorApp`,
   `trocarSenhaApp`): remover desloca os demais — passar `null` na 1ª posição.
2. **Extrair** o bloco inline (`callApi`/`invoke`/`makeRunner`) para
   `data-gateway.js`, espelhando o que `appsel-firestore.js` fez pela leitura e o
   que o painel já fez (ver repo do painel).

### Fase 2 — Camada de Autenticação/Sessão (`auth.js` + endurecimento no `Code.gs`)
- [x] **Servidor: credencial fraca do admin removida do código (2026-06-24).** A senha
  `admin/1234` estava **hardcoded** em `_adminUser_()` com `mustChange:false` (e o repo é
  versionado → exposição). Agora a credencial vem da Script Property `SEL_ADMIN_CRED_JSON`
  (`{salt,hash,mustChange}`); `_adminUser_()` retorna `null` se não configurada (sem senha
  padrão fraca). Nova função `definirSenhaAdmin('senha')` (rodar 1x no editor) seta a senha
  com `mustChange:true` → **força a troca** no 1º login. `trocarSenhaHashApp` ganhou ramo
  para o admin (persiste a troca na Property). **Requer deploy + rodar `definirSenhaAdmin`.**
- [x] Servidores comuns: senha inicial `123456` já vinha com `mustChange:true` (troca forçada) — OK.
- [ ] Cliente: guardião de sessão (armazenamento, expiração, renovação, logout automático em 401).
- [ ] Expiração/rotação de token; `_authRequire_` aplicado de forma consistente em **todos** os endpoints de escrita.
- [ ] Verificar que nenhuma rota sensível responde sem token válido.

### Fase 3 — Camada de Sanitização/Renderização (anti-XSS)
**Iniciada em 2026-06-24.** Existe o helper `esc()` (~L3734; escapa `&<>"` — **não** escapa
aspas simples `'`). São ~70 `innerHTML`. Auditoria parcial feita; corrigidos os pontos
óbvios que injetavam dado do backend cru:
- [x] Seletores de unidade (`abrirTrocaUnidadeApp` ~L4632, `popularUnidadesLogin` ~L4675,
  `popularExcluirUnidade` ~L4721): `u.id`/`u.nome` no `<option>` → agora com `esc()`.
- [x] `submeterCadastroUnidade` (~L4658): `email` no `innerHTML` → agora `esc(email)`.
- [x] **Vetores de `s.nome` (nome do servidor) — corrigidos (2026-06-24):** novo helper
  `escJsAttr()` (~L3737; neutraliza `'` e `\`, aplica `esc()`) para valor em string-JS dentro
  de atributo. `renderPillsServ_` (~L1407): `onclick` agora usa `escJsAttr(s.nome)` e o texto
  `esc(s.nome)`. Avatar (~L1461): `esc(...)` nas iniciais. Verificado no preview.
  - [ ] **PENDENTE (baixo risco):** `aplicarServidores_` (~L1389) injeta `s.nome` num seletor
    CSS `.st-NAME{…}`. Corrigir exige *slugificar* o nome igual onde a classe é aplicada
    (`SERV_CLS[s.nome]`) — mudança em vários pontos; deixado p/ depois. Nome é admin-entered e
    precisaria de `{}`/`<` p/ injetar, então risco prático é mínimo.
- [x] **Varredura dos ~70 `innerHTML` concluída (2026-06-24):** os builders de
  processos/etapas/histórico/notificações/capacidade já passam todo campo do backend por
  `esc()` (ex.: `esc(proc)`, `esc(respAtual)`, `esc(it.num…)`); diálogos usam `textContent`
  (seguro). Único resíduo encontrado e corrigido: `onclick="toggleNotifPilha_('…')"` (~L2024/2039)
  usava `esc(chave)` — e `chave` pode conter nome de processo — trocado para `escJsAttr(chave)`.
  Nenhum onclick com dado do backend **cru** (sem escape). Resta só o seletor CSS `s.nome`
  (~L1389/1403, baixo risco, acima) e a migração de handlers (abaixo).
- [ ] Helpers `dom.text(el, valor)` e `dom.html(el, fragmentoConfiável)` substituindo os `innerHTML`.
- [ ] Migrar handlers `inline` (`onclick=`) para `addEventListener` e ativar a **CSP em modo enforce**
  (o painel já fez isso — usar como referência).

### Fase 4 — Camada de Validação de Entrada (`validators.js`)
- [ ] Regras de validação compartilhadas (matrícula, datas, status, etc.).
- [ ] Validação no cliente (UX) **e** revalidação no Apps Script (segurança real).

### Fase 5 — Consolidação / biblioteca compartilhada
- [ ] Extrair `data-gateway`, `auth`, `dom`, `validators` para base comum entre os dois repos.
- [ ] Testes (`node --test`) cobrindo gateway e validadores.

### Fase 6 — Auditoria e rollout
- [ ] Revisão de segurança da branch (`/security-review`).
- [ ] Publicar regras Firestore revisadas; CSP em *enforce*; atualizar `CHECKLIST_PUBLICACAO.md`.

---

## 4. Ordem sugerida de execução

```
Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6
```

As Fases 0–2 entregam o maior ganho de segurança com o menor risco e devem vir
primeiro. As Fases 3–4 reduzem a superfície de XSS e entrada inválida. As Fases
5–6 consolidam e auditam.

## 5. Critérios de aceite

- Nenhuma tela faz `fetch`/acesso Firestore fora do `data-gateway`.
- Nenhum endpoint de escrita responde sem token válido.
- Sem credenciais padrão fracas no servidor.
- CSP em *enforce* sem violações; scripts externos com SRI.
- Dados do backend nunca renderizados via `innerHTML` cru.
- Testes verdes cobrindo gateway e validadores.
