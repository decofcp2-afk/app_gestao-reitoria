# Plano — Relatório de Prazos por Etapa (perfil Admin)

Função nova, **exclusiva do perfil Admin**, para gerar um relatório estatístico
dos prazos reais de cada etapa dos processos — **por unidade** e **geral (todas as
unidades)** — com consulta **por ano**, quartis (Q1, Q2, Q3), limites de outlier
(LS / LI) e gráficos **boxplot**.

> Origem: pedido do Felipe Coelho (conversa de 2026, WhatsApp). Resumo do que ele
> pediu, com as palavras dele:
> - "colocar **só no perfil do Admin**";
> - "uma forma de **gerar relatório**, que consiga trazer as informações de
>   **prazos de cada etapa, por unidade, e geral**";
> - "fazer essa **consulta por ano**, com os **quartis (Q1, Q2, Q3)**, com
>   **limites superior e inferior (LS = Q3 + 1,5·DIQ / LI = Q1 − 1,5·DIQ)**, com os
>   **gráficos boxplot**";
> - objetivo: "ver quais são os **verdadeiros prazos médios por etapa**, os **prazos
>   outliers**, os **locais com melhores e piores prazos**";
> - **definição de prazo para este relatório:** "considerado com o de **início da
>   tarefa até a data da conclusão real**".

---

## 1. Visão geral (o que será entregue)

Uma nova aba **"Visão Geral"** no App de Gestão, que **só aparece quando o Admin
entra** (invisível para os demais perfis), respondendo a três perguntas:

1. **Qual é o prazo real de cada etapa?** — distribuição (não só a média): mediana,
   quartis e dispersão, para cada etapa do fluxo.
2. **Onde estão os gargalos?** — outliers (etapas que estouraram o prazo) e ranking
   de **melhores e piores unidades** por etapa.
3. **Como isso evolui?** — filtro **por ano**, comparando um ano contra outro.

Entregáveis visuais:

- **Boxplot por etapa** (Q1, mediana, Q3, "bigodes" até LS/LI, pontos de outlier).
- **Comparativo por unidade** dentro de cada etapa (um boxplot por unidade lado a
  lado + a visão "Geral" agregando todas).
- **Tabela-resumo** por etapa/unidade: n, Q1, mediana, Q3, DIQ, LS, LI, média,
  mín/máx, nº de outliers.
- **Ranking** de melhores e piores unidades por etapa (pela mediana).
- **Exportação** (CSV da tabela + impressão/PDF pelo navegador).

Sem dependências novas: os boxplots são desenhados em **SVG inline**, no mesmo
estilo dos ícones já usados no `index.html` (o app hoje só carrega Firebase e
SortableJS — nada de biblioteca de gráficos, e a estatística fica em JS próprio,
testável). O relatório continua funcionando no modo PWA/offline com o último
snapshot carregado.

---

## 2. Definições estatísticas (o que o relatório calcula)

Para um conjunto de prazos (em dias) de uma mesma etapa:

| Símbolo | Nome | Fórmula |
|---|---|---|
| Q1 | 1º quartil (25%) | percentil 25 |
| Q2 | mediana (50%) | percentil 50 |
| Q3 | 3º quartil (75%) | percentil 75 |
| DIQ | distância interquartílica | `Q3 − Q1` |
| **LS** | limite superior | `Q3 + 1,5·DIQ` |
| **LI** | limite inferior | `Q1 − 1,5·DIQ` |
| outlier | prazo atípico | valor `> LS` **ou** `< LI` |
| bigodes | whiskers do boxplot | menor/maior valor **dentro** de [LI, LS] |
| média | prazo médio | média aritmética (informada junto, mas a **mediana** é a medida central robusta do boxplot) |

**Método de quartil:** interpolação linear (tipo 7 / equivalente ao
`QUARTILE.INC`/`PERCENTIL.INC` do Excel e Google Sheets). Escolhido porque a equipe
tende a conferir os números contra a planilha — os valores batem. O método fica
isolado numa função pura (`_quartil_(valores, p)`), com testes de unidade.

Amostras pequenas: com `n < 4`, quartis e cerca de outlier ficam instáveis. O
relatório ainda mostra os pontos e a mediana, mas marca **"amostra pequena (n<4)"**
e omite a caixa/cerca para não induzir conclusão errada.

---

## 3. Regra de cálculo do prazo — início real → conclusão real

Esta é a decisão central do pedido do Felipe. O prazo de uma etapa **não** é o
`Prazo (dias)` planejado da planilha, e **não** é a régua planejada (`ini_iso`/
`fim_iso`). É o **tempo decorrido real**:

```
prazo_real(etapa) = dias( início_real → conclusão_real )
```

Onde, no modelo de dados atual (ver `FASE1_MODELO_FIRESTORE.md` e
`getEtapasParaApp` no `Code.gs`):

- **conclusão_real** = `DataRealizacao` da etapa (campo `realiz`), considerado
  **só quando a etapa está concluída** (`status === 'ok'`).
- **início_real** = **conclusão_real da etapa concluída imediatamente anterior** do
  mesmo processo; para a **primeira** etapa do processo, o início é o **D0**
  (`D0 (Data Abertura)` do processo).
- **dias** = contagem pelo mesmo helper já usado no app (`_contDU_`), respeitando
  `MODO_CONTAGEM_PRAZOS`. Recomendação: manter **dias corridos** neste relatório
  (é o tempo real de calendário que a gestão quer medir), independentemente do modo
  de exibição das telas operacionais.

Entram no cálculo **apenas etapas concluídas** e com início/fim válidos.
Ficam **de fora**:

- etapas ainda não concluídas (sem `DataRealizacao`);
- etapas `na` (não se aplica) e etapas contratuais (`_isEtapaContratual_`), que já
  são ocultadas na UI e não têm prazo próprio da equipe;
- a primeira etapa quando o processo **não tem D0** (ainda está na fila);
- casos com data inconsistente (fim antes do início) — contabilizados num contador
  de "descartados por inconsistência" para auditoria, não jogados na distribuição.

**Ponto de atenção — retorno para fila / suspensão:** um processo pode ter voltado
para a fila ou ficado paralisado no meio de uma etapa (ver README, "Retorno para
fila"). Isso **infla** o tempo início→conclusão. Duas opções (ver §9, decisão D3):
o v1 recomendado mede o tempo **literal** (início→conclusão), porque é justamente
isso que revela os **outliers** e os "piores prazos" que o Felipe quer enxergar; o
tempo de fila descontado fica como melhoria futura.

---

## 4. Onde vive — nova aba "Visão Geral", só do Admin

**Decidido (D5):** a função vive **dentro do próprio App de Gestão**, como uma
**nova aba chamada "Visão Geral"** que **só aparece quando o Admin entra**.
**Somente o Admin vê** — nem chefe nem equipe, e (por ora) nem o Diretor.

O app já distingue papéis: `SESSAO_ADMIN` (admin global) e `isChefe`. A função
`aplicarPerfilUI_()` (no `index.html`) já mostra/esconde a seção "Excluir unidade"
**só para `SESSAO_ADMIN`** — a "Visão Geral" segue exatamente o mesmo padrão:

- Nova aba **"Visão Geral"** (`nav-visao-geral` / `tab-visao-geral`), incluída na
  barra de navegação e na lista de `switchTab`, **oculta por padrão** e revelada
  em `aplicarPerfilUI_()` **apenas quando `SESSAO_ADMIN === true`**. Como as abas
  restritas (`fila`/`historico`/`config`), se um não-admin tentar cair nela o
  `switchTab` a redireciona para `etapas`.
- **Segurança real no backend:** a UI é só o controle remoto. O endpoint novo
  (`getRelatorioPrazosApp`) valida a sessão e **exige admin** no servidor
  (`_authRequire_(token, true)` + checagem de admin), como as demais funções
  sensíveis. Nunca confiar no cliente para gating.

> Nota de papel: hoje "Admin" = admin global (`SESSAO_ADMIN`). No desenho
> multiunidade (`PLANO_MULTIUNIDADE.md`) esse é o papel que enxerga **todas as
> unidades** — coerente com "por unidade e geral". Liberar a aba ao Diretor Geral
> (só leitura) fica como opção **futura, hoje descartada** (D5).

---

## 5. Fontes de dados e agregação por unidade

- **Etapas + Processos** já são lidos em `getEtapasParaApp`/`_getEtapasParaApp_`
  (planilha) e nas versões `fs_*` (Firestore). O relatório usa os mesmos campos:
  `processos.d0`, `etapas.status`, `etapas.realiz (DataRealizacao)`, `etapas.nome`,
  `etapas.fase`.
- **Por unidade:** no modelo multiunidade os dados vivem em
  `unidades/{unidadeId}/processos` e `.../etapas`. O relatório itera as unidades
  ativas (coleção `unidades`) e calcula por unidade; "Geral" agrega todas.
  - **Dependência conhecida (ver `PLANO_MULTIUNIDADE.md`, Fase F/Parte 3):** a
    leitura/escrita por unidade ainda está parcialmente migrada — hoje a Reitoria
    (`reitoria-sel`) está 100% em produção e outras unidades ficam em modo
    visualização. O relatório funciona ponta a ponta para a Reitoria desde já; a
    consolidação multiunidade completa acompanha a Parte 3 (ou usa o documento
    `resumo/atual` da Fase D quando existir).
- **Agrupamento chave:** `etapa.nome` (normalizado: `trim`, colapso de espaços,
  comparação sem diferença de caixa/acentos) × `unidade` × `ano`.
- **Ano:** ano da **conclusão real** da etapa (ano de `DataRealizacao`). É o que faz
  "consulta por ano" refletir quando a etapa **terminou** (ver decisão D1).

---

## 6. Backend — novo endpoint `getRelatorioPrazosApp`

Aditivo, no `apps-script/Code.gs`, registrado na whitelist `_apiCallAppSEL_`
(e a versão `fs_getRelatorioPrazosApp` para Firestore, no `FirestoreSync.gs`).

**Assinatura:**

```js
getRelatorioPrazosApp(authToken, opts)
// opts = { ano: 2026|null (null = todos), unidades: [...]|null (null = todas) }
```

**Contrato:**

1. `_authRequire_(authToken, true)` **+** checagem de admin — recusa quem não é
   admin com erro de permissão.
2. Percorre processos → ordena etapas concluídas por data → calcula
   `prazo_real` (início real → `DataRealizacao`) de cada etapa concluída, como §3.
3. Filtra por `ano` (ano da conclusão) e por `unidades` quando informado.
4. **Retorna dados brutos por grupo** (não os quartis prontos):

```json
{
  "geradoEm": "2026-07-11T…",
  "modoContagem": "corridos",
  "anosDisponiveis": [2025, 2026],
  "grupos": [
    { "etapa": "Elaboração do TR", "unidade": "reitoria-sel", "ano": 2026,
      "dias": [12, 15, 9, 40, 11],
      "itens": [ { "processoId": "SEL-2026-001", "inicio": "…", "fim": "…", "dias": 12 } ] }
  ],
  "descartados": { "semData": 3, "inconsistentes": 0 }
}
```

**Por que dados brutos e não quartis prontos:** manter a estatística no **frontend**
(a) permite recomputar quartis/cerca/outliers ao trocar filtros sem nova ida ao
servidor, (b) mantém a matemática num único lugar testável em JS (pasta `tests/`),
(c) o volume é pequeno (ordem de ~centenas de etapas por unidade/ano). Se no futuro
o volume crescer muito, dá para mover o cálculo para o backend sem mudar a UI.

---

## 7. Frontend — a aba "Visão Geral"

Layout (mobile-first, no mesmo estilo do app):

1. **Barra de filtros** no topo:
   - **Ano** (menu com `anosDisponiveis` + "Todos");
   - **Unidade** (menu: "Geral (todas)" + cada unidade) — só aparece com >1 unidade;
   - **Etapa** (menu: "Todas" ou uma etapa específica para focar);
   - botão **Gerar / Atualizar**.
2. **Cartões de resumo** (KPIs): nº de etapas concluídas na amostra, mediana geral,
   nº de outliers, unidade com melhor e pior mediana.
3. **Boxplots**:
   - modo "Geral": um boxplot por **etapa** (todas as unidades juntas);
   - modo "por unidade": para a etapa escolhida, um boxplot por **unidade** lado a
     lado, com pontos de outlier destacados;
   - cada boxplot desenhado em **SVG inline**: caixa Q1–Q3, traço da mediana,
     bigodes até o último valor dentro de [LI, LS], pontos fora como outliers,
     rótulos com os valores. Acessível (título/`aria-label`), responsivo, com
     rolagem horizontal quando houver muitas categorias.
4. **Tabela-resumo** (uma linha por etapa/unidade): `n · Q1 · Mediana · Q3 · DIQ ·
   LS · LI · Média · Mín · Máx · Outliers`. Ordenável por mediana.
5. **Ranking melhores/piores unidades** por etapa (pela mediana), respondendo
   direto ao "locais com melhores e piores prazos".
6. **Exportar**: botão **CSV** (baixa a tabela-resumo e, opcional, o detalhe por
   processo) e **Imprimir/PDF** (usa `window.print()` com um CSS de impressão que
   esconde a navegação e formata os boxplots para papel). Sem biblioteca externa.

Funções JS puras novas (com testes):
`_quartil_(vals, p)`, `_estatEtapa_(vals)` (retorna Q1/Q2/Q3/DIQ/LS/LI/whiskers/
outliers/média), `_boxplotSVG_(estat, opts)`.

---

## 8. Testes

Na pasta `tests/` (já há suíte Node no projeto):

- `relatorio-quartil.test.js` — `_quartil_` contra casos conhecidos (inclusive os
  valores do Excel/Sheets), n par/ímpar, n<4, valores repetidos.
- `relatorio-prazo.test.js` — cálculo início→conclusão: primeira etapa usa D0;
  etapa seguinte usa a conclusão anterior; ignora `na`/contratuais/não concluídas;
  descarta inconsistências (fim < início).
- `relatorio-outliers.test.js` — LS/LI e classificação de outliers; whiskers param
  no último valor dentro da cerca.
- `relatorio-agregacao.test.js` — agrupamento por etapa × unidade × ano e o filtro
  de ano (pela data de conclusão).

---

## 9. Decisões em aberto (com recomendação)

| # | Decisão | Recomendação (v1) |
|---|---|---|
| D1 | Qual "ano" da consulta? | ✅ **DECIDIDO: ano da conclusão real da etapa** (`DataRealizacao`). |
| D2 | Dias corridos ou úteis no relatório? | **Corridos** (tempo real de calendário), mesmo que as telas usem outro modo. |
| D3 | Descontar tempo em fila/paralisado do prazo? | ✅ **DECIDIDO: não** — medir o literal início→conclusão, justamente para não esconder os outliers/piores prazos. |
| D4 | Média ou mediana como "prazo médio"? | Mostrar **as duas**; destacar a **mediana** (robusta a outlier) como número principal do boxplot. |
| D5 | Quem enxerga e onde? | ✅ **DECIDIDO: só o Admin**, numa **nova aba "Visão Geral" dentro do App de Gestão**, que aparece apenas quando o Admin entra. Diretor não vê (opção futura descartada por ora). |
| D6 | Método de quartil | **Interpolação linear tipo 7** (bate com Excel/Sheets `QUARTILE.INC`). |
| D7 | n mínimo para caixa/cerca | Abaixo de **n<4**, mostrar pontos + mediana e marcar "amostra pequena" (sem caixa). |

> D1, D3 e D5 confirmados pelo solicitante em 2026-07-11. D2, D4, D6 e D7 seguem a
> recomendação salvo objeção.

---

## 10. Fases de implementação

- **Fase 1 — Núcleo estatístico (frontend, isolado).** `_quartil_`, `_estatEtapa_`,
  `_boxplotSVG_` + testes. Sem tocar em backend nem em UI. *Baixo risco.*
- **Fase 2 — Endpoint de dados.** `getRelatorioPrazosApp` (+ `fs_*`) com o cálculo
  início→conclusão e o gating de admin; testes de cálculo de prazo. *Médio.*
- **Fase 3 — Aba "Visão Geral" (Admin only).** Nav/tab + gating em
  `aplicarPerfilUI_`/`switchTab`; filtros; boxplots; tabela; ranking. *Médio.*
- **Fase 4 — Exportação.** CSV + CSS de impressão/PDF. *Baixo.*
- **Fase 5 — Multiunidade.** Iterar unidades ativas / usar `resumo/atual`;
  acompanha a Parte 3 do `PLANO_MULTIUNIDADE.md`. Até lá, Reitoria completa e
  demais unidades conforme a migração de leitura avança. *Depende da Fase F.*

Cada fase é aditiva e não altera o comportamento das telas atuais para quem não é
admin.

---

## 11. Riscos / pontos de atenção

- **Qualidade dos dados de conclusão:** o relatório é tão bom quanto as
  `DataRealizacao` preenchidas. Etapas concluídas sem data viram "descartados" —
  vale expor esse contador para a gestão cobrar preenchimento.
- **Nomes de etapa divergentes** entre processos/unidades quebram o agrupamento —
  daí a normalização (§5) e, se preciso, um mapa de sinônimos.
- **Retorno para fila / paralisação** infla prazos (ver D3).
- **Dependência multiunidade:** consolidação "por unidade" completa depende da
  migração de leitura por unidade (Fase F/Parte 3). Reitoria funciona desde já.
- **Cota Firestore/Apps Script:** leitura de etapas para o relatório é pontual (só
  quando o admin gera), volume pequeno; sem impacto relevante na cota Spark.
