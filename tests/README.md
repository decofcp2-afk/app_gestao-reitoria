# Testes simulados — App Gestão

Testes sem dependências externas (usam o runner nativo `node:test`). Eles
exercitam as funções puras de `appsel-firestore.js` — **o mesmo código que o
navegador roda** para montar as abas Capacidade, Etapas e Fila — alimentando-as
com dados de mentira para flagrar bugs e inconsistências.

## Como rodar

```bash
npm test          # ou: node --test
```

## O que cobrem

### `capacidade.test.js` — aba Capacidade (`construirCapacidade`)
- **Servidor fantasma (caso Bruno):** a Capacidade só pode listar servidores que
  existem na coleção `servidores`. Inclui a regressão do bug relatado — um
  servidor excluído reaparecia como card porque seu doc ficava órfão no
  Firestore. O fix está em `fs_espelharServidores_` (`apps-script/FirestoreSync.gs`),
  que agora **poda** os docs de servidores removidos.
- **Troca automática de fase:** ao concluir a fase interna, a carga interna some
  e a externa fica ativa; a pontuação migra do servidor interno para o externo.
- **Ativação das cargas:** carga `ativo` conta como carga atual; inativa entra
  como projeção "futuros".
- **Exclusões:** processos concluídos e devolvidos à fila não pesam na capacidade.
- **Semáforo:** status (Disponível/Atenção/Crítico) acompanha o percentual.

### `processo-troca.test.js` — cards de processo (`construir`)
- Responsável interno/externo derivado das cargas, com preferência pela carga
  ativa.
- Após a troca de fase, o responsável externo ativo vira o responsável corrente.
- Fallback para o agente da etapa quando não há carga.

### `prune-servidores.test.js` — poda de servidores fantasmas
Spec da regra de `_fsPodarServidoresOrfaos_` (Apps Script): remove docs de
servidores que saíram da lista, mantém os atuais e — **trava de segurança** —
nunca apaga nada quando a lista atual está vazia (evita perda de dados quando a
lista não carregou). É um espelho da regra do GS; mantenha em sincronia.

### `criar-unidade.test.js` — cadastro de unidade (`fs_criarUnidade`)
Espelho das regras puras de `fs_criarUnidade` (`apps-script/FirestoreSync.gs`):
- **Slug/id:** nomes reais das unidades do CPII (Centro, Humaitá I/II/III,
  Tijuca I/II, São Cristóvão I/II/III, etc.) geram ids válidos e sem colisão;
  acento/caixa não mudam o id; nome só com símbolos vira id vazio.
- **Autocadastro aberto:** o cadastro sai da tela de login (sem sessão), então
  `fs_criarUnidade` **não** exige admin — a guarda é o e-mail institucional.
  Cobre a regressão do "Sessão expirada" ao cadastrar.
- **Validação de entrada:** nome com 3+ caracteres e e-mail institucional
  (`...g12.br`).
- **Duplicidade:** cobre a regressão corrigida onde um erro na checagem de
  duplicidade que NÃO era 404 (5xx/403/rede) era tratado como "unidade não
  existe" e o `patch` (sem updateMask) sobrescrevia uma unidade já existente.
- **Login do 1º chefe:** parte local do e-mail → sigla → `gestor-<id>`.
- **Senha temporária:** 7 caracteres, sem caracteres ambíguos (0/O, 1/I/L).

### `excluir-unidade.test.js` — exclusão de unidade (`fs_excluirUnidade`)
- **Paginação:** regressão em que a exclusão só lia a 1ª página (`pageSize=300`)
  de cada coleção e ignorava o `nextPageToken` — uma unidade com coleções que
  crescem sem limite (`etapas`, `historico`) passando de 300 docs ficava com
  sobras órfãs mesmo com a exclusão reportando sucesso. Corrigido para paginar
  até esgotar.
- **Travas:** só admin geral exclui; a unidade base `reitoria-sel` nunca pode
  ser excluída.

### `sessao-multiunidade.test.js` — trava de unidade na sessão (`_authGetSession_`)
Regressão de segurança: a unidade "ativa" numa requisição vem do `localStorage`
do navegador, não é amarrada ao token. `_authGetSession_` resolvia o usuário
buscando a matrícula da sessão na lista de usuários da unidade **da
requisição atual**, não da unidade onde o login aconteceu — trocar de unidade
sem deslogar podia, por coincidência de matrícula, fazer a sessão "virar"
outra pessoa (com o nível de acesso dela) em outra unidade. Corrigido
comparando `sess.unidade` (já gravada no login, só não era conferida) com a
unidade da requisição; o admin geral fica de fora dessa trava.

### `atribuir-responsavel.test.js` — servidor marcado no modal de responsável
Regressão em que o servidor já atribuído não aparecia **selecionado** no modal
"Responsável pelo processo" nas unidades novas (funcionava nas antigas). O
responsável vem em Title Case (`p.servidor`), mas a lista de servidores guarda o
nome como foi digitado (`amanda2`, `SAMUEL`); a marcação usava `===` cru,
sensível a caixa/acento. Espelha `_mesmoServ_` (index.html), a comparação
normalizada que corrige a marcação (e a cor do chip) sem depender da caixa.

### `nome-servidor.test.js` — capitalização do nome do servidor
Regressão em `construir()` e `construirCapacidade()`: o nome do servidor era
recapitalizado como "1ª letra maiúscula, resto minúsculo" — certo só para
nomes de uma palavra. Nomes compostos (a maioria dos nomes reais: "Maria
Eduarda", "Ana Paula Souza", "João Pedro") apareciam errados nos cards de
processo e na Capacidade, mesmo já gravados com a capitalização certa no
Firestore. Corrigido para Title Case por palavra, espelhando `_fsNomeServ_`
(apps-script/FirestoreSync.gs) — a mesma regra passou a ser usada nos 5 outros
pontos do código (Code.gs e FirestoreSync.gs) que tinham a mesma conta errada.

### `helpers.js`
Builders dos dados simulados (cargas, etapas, processos, servidores).
