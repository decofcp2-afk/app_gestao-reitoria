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
- **Validação de entrada:** exige admin geral, nome com 3+ caracteres e e-mail
  institucional (`...g12.br`).
- **Duplicidade:** cobre a regressão corrigida onde um erro na checagem de
  duplicidade que NÃO era 404 (5xx/403/rede) era tratado como "unidade não
  existe" e o `patch` (sem updateMask) sobrescrevia uma unidade já existente.
- **Login do 1º chefe:** parte local do e-mail → sigla → `gestor-<id>`.
- **Senha temporária:** 7 caracteres, sem caracteres ambíguos (0/O, 1/I/L).

### `helpers.js`
Builders dos dados simulados (cargas, etapas, processos, servidores).
