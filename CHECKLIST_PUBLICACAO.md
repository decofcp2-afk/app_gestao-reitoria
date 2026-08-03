# Checklist de Publicação — App Gestão (AppSEL)

Aplicação **interna e protegida por login**. A equipe SEL/SEPMA faz toda a gestão dos processos por aqui (escrita na planilha, fila, etapas, capacidade, e-mails e avisos de prazo). O Painel de Contratações apenas exibe, em modo público e somente leitura, os dados consolidados desta mesma base.

---

## 1. Backend — Apps Script da DECOF

### Atualizar o backend (projeto já existente)

Use `scripts/deploy-apps-script.sh`, com o `clasp` autenticado na conta institucional:

```bash
scripts/deploy-apps-script.sh            # confere divergências, não escreve nada
scripts/deploy-apps-script.sh release    # envia + versiona + publica em produção
```

O `release` mantém a **mesma URL `/exec`** que está no `config.js` — ele atualiza a
implantação "Producao AppSEL" em vez de criar outra.

> **Não rode `clasp push` direto.** Os nomes dos arquivos diferem entre o repositório e
> o projeto remoto (`apps-script/Code.gs` lá é `Código.js`, na raiz), e o push **espelha**
> a pasta: o que não estiver nela é apagado no projeto. O script faz o mapeamento, confere
> antes se alguém editou algo direto no editor e recusa publicar se encontrar arquivo que
> ele não conhece. É por isso que **não existe `.clasp.json` na raiz** do repositório.

Publicar só o código, sem mexer na produção: `scripts/deploy-apps-script.sh push`
(atualiza apenas o `@HEAD`; a URL `/exec` continua servindo a versão anterior).

### Primeira instalação (projeto novo)

- Criar projeto novo no Apps Script da conta institucional da DECOF.
- Copiar/atualizar `apps-script/Code.gs` no editor.
- Em `Configurações do projeto > Propriedades do script`, configurar:
  - `SEL_SS_ID` — ID real da planilha.
  - `SEL_CHEFIA_EMAIL` — e-mail institucional da chefia, se necessário.
  - `SEL_MUNICIPIO_CALENDARIO` — município dos feriados locais (padrão: `Rio de Janeiro`).
- Salvar.
- Implantar como Web App:
  - Executar como: `Eu`.
  - Quem pode acessar: `Qualquer pessoa`.
- Autorizar as permissões solicitadas pelo Google.
- Copiar a URL final terminada em `/exec`.
- Em `Acionadores`, confirmar que **não** existe acionador antigo de conta pessoal para `enviarAvisosPrazo`.

---

## 2. Frontend — GitHub Pages

- Colar a URL `/exec` em `config.js`, no campo `apiUrl`.
- Manter `apiTimeoutMs` em `90000`, salvo se o Apps Script precisar de outro tempo de espera.
- Enviar os arquivos desta pasta para o repositório do App Gestão (separado do Painel).
- Configurar GitHub Pages:
  - Source: `Deploy from a branch`.
  - Branch: `main`.
  - Folder: `/(root)`.
- Deixar `Custom domain` vazio, salvo domínio institucional real com DNS configurado.

---

## 3. Testes obrigatórios

- Abrir o AppSEL pelo link do GitHub Pages no Chrome.
- Abrir o AppSEL pelo link do GitHub Pages no Edge.
- Testar em aba anônima.
- Fazer login com matrícula e senha temporária.
- Confirmar troca obrigatória de senha.
- Testar recuperação de senha por e-mail.
- Em **Etapas**: concluir uma etapa e regredir uma etapa.
- Voltar um processo em andamento para a **Fila** com justificativa.
- Confirmar que o status real foi preservado e que o processo saiu dos avisos de atraso.
- Em **Fila**: iniciar um processo e reativar um processo marcado como retorno para fila.
- Em **Capacidade**: salvar pontuação e salvar "Outros".
- Em **Configurações** (como chefia): editar equipe e editar e-mails.
- Instalar/reinstalar o trigger pela conta DECOF.
- Confirmar que os acionadores ficaram separados: prazos próximos por volta de 10h30 e etapas vencidas por volta de 14h, de segunda a sexta.
- Testar e-mail e enviar avisos agora.

---

## 4. Conferência de segurança

- Confirmar que o repositório **não** contém ID real da planilha.
- Confirmar que o repositório **não** contém e-mail pessoal.
- Confirmar que **não** há planilhas, PDFs ou documentos administrativos versionados.
- Confirmar que o Apps Script usa propriedades do script para dados sensíveis.
- Confirmar que os avisos automáticos aparecem como acionadores da conta institucional e que a conta pessoal não envia mais e-mails.
- Após a migração para o Firestore: confirmar que **nenhuma chave de conta de serviço** (`*.json`) foi versionada — elas ficam só nas propriedades do script / fora do Git (já cobertas pelo `.gitignore`).

---

## 5. Solução de problemas

- App não carrega dados: conferir se `config.js` tem a URL `/exec` correta e `apiTimeoutMs` adequado.
- Funciona no Chrome e falha no Edge: testar em aba anônima e confirmar implantação como Web App acessível por `Qualquer pessoa`.
- Login não conclui: confirmar que as rotas `appsel.challenge` / `appsel.loginProof` respondem (o app usa desafio criptográfico, a senha não trafega aberta).
- E-mails não saem ou saem da conta errada: conferir em `Acionadores` se os gatilhos estão na conta institucional e se o acionador de conta pessoal foi removido.
- GitHub Pages não atualiza: aguardar alguns minutos e conferir a aba `Actions`.
- Mudança no nome do repositório: atualizar links no README e atalhos salvos.

---

> **Nota de migração:** há um plano de mover a base de dados da planilha para o **Firestore** (modelo híbrido, plano gratuito — ver `PLANO_ORGANIZACAO_E_MIGRACAO.md`). Quando isso ocorrer, este checklist será atualizado: o frontend passará a ler/escrever no Firestore e os e-mails do Apps Script lerão o Firestore via REST + conta de serviço, mantendo os triggers atuais. O App Gestão continuará protegido por login.
