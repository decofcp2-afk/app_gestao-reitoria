# Fase 3 — Checklist de ATIVAÇÃO (corte para o Firestore)

Todo o código já está pronto e atrás da flag `firestoreAtivo` (hoje **false** nos dois
`config.js`). Com a flag false, os apps funcionam exatamente como antes (Apps Script + planilha).
Ativar = executar os passos abaixo. Antes disso, pode dar `git push` sem risco.

## O que já está pronto (não precisa mexer)
- Leitura: `appsel-firestore.js` (getEtapasParaApp + getCapacidadeApp) e `painel-firestore.js`.
- Escrita: `apps-script/FirestoreSync.gs` (14 funções `fs_*` + helpers), já na whitelist do `Code.gs`.
- Frontend: dispatcher e pontos de chamada já roteiam para `fs_*` quando `firestoreAtivo=true`
  (status/concluir/regredir usam `docEtapa`; capacidade usa `matricula`/`docId`).
- `salvarServidoresApp` espelha equipe/e-mails no Firestore (aditivo).

## Passos de ativação (na ordem)
1. **Apps Script** (projeto "SEL Etapas" da DECOF) — **sem biblioteca**, tudo via REST:
   - Colar o arquivo `apps-script/FirestoreSync.gs` (já contém `_setupFirestoreProps_` com a chave).
   - Colar o `apps-script/Code.gs` atualizado.
   - Rodar a função **`_setupFirestoreProps_`** uma vez (grava FS_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY/FS_ATIVO=true — resolve a tela de propriedades read-only).
   - Rodar **`testarMigracao`** e conferir no log: contagens > 0 e "OK ✓".
   - Reimplantar o Web App.
2. **Firestore**: republicar as regras (`firebase/firestore.rules` — já inclui `cargas`).
3. **Flag**: trocar `firestoreAtivo: false → true` no `config.js` do **App Gestão** e do **Painel**.
4. **Deploy**: `git push` nos dois repositórios (GitHub Pages).
5. **Validar**: concluir/regredir uma etapa de teste, mover fila, pontuar, e conferir no
   console do Firestore. Conferir o Painel refletindo as mudanças.

## Recomendado fazer junto do corte (rápido)
- A planilha vira **backup congelado** (parar de editá-la à mão).
- Depois do corte estável: trocar a chave de serviço exposta (só o valor da propriedade).

## Fase 4 (e-mails) — JÁ IMPLEMENTADA
As rotinas `enviarAvisosPrazo` e `getAlertasApp` leem do Firestore via
`_fsGetEtapasParaApp_()` (em FirestoreSync.gs) quando `FS_ATIVO=true`; senão, da planilha.
Os triggers (10h30/14h, seg–sex) e o envio via `MailApp` não mudam. `_getEmails_` continua
nas Script Properties. Para ativar: basta a propriedade `FS_ATIVO=true` (passo 1 acima).
