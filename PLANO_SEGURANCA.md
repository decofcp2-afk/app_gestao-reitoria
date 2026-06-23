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

**Estado em 2026-06-23:** a Fase 1 já está **majoritariamente atendida**, porém
**inline** no `index.html` (bloco IIFE `callApi`/`invoke`/`makeRunner`, ~linhas
776–1015) em vez de em um módulo separado. A leitura já está isolada em
`appsel-firestore.js` (`AppselFirestore.carregar*`). Falta apenas a **extração**
para arquivo próprio (auditabilidade) e o **token automático**.

- [x] `api.read(route, params)` — leitura encapsulada em `AppselFirestore` (Firestore) com fallback ao Apps Script; o despacho leitura×escrita vive em `invoke()`.
- [x] `api.write(route, params)` — sempre via Apps Script (`callApi('appsel.call', …)`).
- [x] Centraliza timeout, retry e tratamento de erro padronizado (✅ `callApi`: timeout + fallback JSONP + `asError`) **e anexa o token de sessão automaticamente** (2026-06-23): `callApi` adiciona `token` no topo da requisição (como a `unidade`); o `Code.gs` (v61) usa `_AUTH_TOKEN_REQ` como fallback em `_authGetSession_` quando a função não recebe o token posicional. **Verificado ao vivo** (write de status de etapa via fallback retornou `ok:true`, sem token posicional). Mudança aditiva: os ~38 call sites que ainda passam o token posicional seguem válidos.
- [~] Telas já chamam o backend **apenas** via `invoke`/`makeRunner` (emula `google.script.run`), mas o gateway ainda **não é módulo separado** — continua embutido no `index.html`. **Pendente:** extrair para `data-gateway.js`.

**Próximos passos (ordem segura — apurada pelo [INVENTARIO_CHAMADAS.md](INVENTARIO_CHAMADAS.md)):**
1. **Padronizar o token** em todos os ~40 pontos de chamada para o estilo nomeado `authToken` (hoje há posicional com posição variável — `resetarSenhaServidorApp`/`trocarSenhaApp` no 1º arg, outros no 2º/3º). Ajustar as assinaturas correspondentes no `Code.gs`. **Mudança de produção com risco de auth → branch + teste de login e de uma escrita de cada estilo antes de mergear.**
2. Só então **anexar o token automaticamente** em `callApi` (um único lugar), removendo-o dos pontos de chamada.
3. **Extrair** o bloco inline (`callApi`/`invoke`/`makeRunner`) para `data-gateway.js`, espelhando o que `appsel-firestore.js` fez pela leitura.

### Fase 2 — Camada de Autenticação/Sessão (`auth.js` + endurecimento no `Code.gs`)
- [ ] Cliente: guardião de sessão (armazenamento, expiração, renovação, logout automático em 401).
- [ ] Servidor: **remover credenciais padrão fracas** (`admin/1234`, `123456`); forçar troca no primeiro acesso.
- [ ] Expiração/rotação de token; `_authRequire_` aplicado de forma consistente em **todos** os endpoints de escrita.
- [ ] Verificar que nenhuma rota sensível responde sem token válido.

### Fase 3 — Camada de Sanitização/Renderização (anti-XSS)
- [ ] Helpers `dom.text(el, valor)` e `dom.html(el, fragmentoConfiável)` substituindo os `innerHTML`.
- [ ] Regra: dado vindo do backend nunca entra via `innerHTML` cru — sempre `textContent` ou template escapado.
- [ ] Migrar handlers `inline` (`onclick=`) para `addEventListener` e ativar a **CSP em modo enforce**.

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
