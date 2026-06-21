# Plano de organização e migração para Firebase (modelo híbrido)

**Projeto:** Sistema SEL/DECOF — Reitoria do Colégio Pedro II
**Apps cobertos:** App Gestão de Etapas (Gestão) + Painel de Contratações (Painel)
**Data:** junho/2026

## Decisões tomadas

- **Escopo:** os dois apps, de forma coordenada.
- **Repositórios:** mantidos **separados** (cada um com seu GitHub Pages hoje).
- **Base de dados:** migrar para o **Firestore** (a planilha foi descontinuada — a equipe já trabalha 100% pelo app, então a planilha virou só depósito de dados e pode ser substituída).
- **E-mails automáticos:** permanecem no **Apps Script** (de graça).
- **Custo:** **plano gratuito (Spark), sem cadastrar cartão.**

---

## 1. Situação atual

Dois aplicativos irmãos, mesma arquitetura, cada um em seu repositório:

| Componente | App Gestão | Painel |
|---|---|---|
| Frontend (PWA estático) | `index.html` (~4.300 linhas) | `index.html` (~2.700 linhas) |
| Backend (Google Apps Script) | `apps-script/Code.gs` (~3.900 linhas) | `apps-script/Code.gs` (~3.000 linhas) |
| Configuração | `config.js` | `config.js` |
| Hospedagem | GitHub Pages | GitHub Pages |

Hoje os dois leem da **mesma planilha Google** via Apps Script. A planilha **não é mais editada à mão** — a equipe faz toda a gestão pelo app de Gestão, e o Painel é só consulta. Os dois enviam e-mail; o de Gestão tem os triggers agendados (seg-sex, 10h30 e 14h).

### O que melhorar
- `index.html` e `Code.gs` gigantes num arquivo só — difícil editar e propenso a truncamento (já aconteceu).
- Lentidão percebida: vem do Apps Script ser um ambiente compartilhado do Google com "cold start" e cota por chamada — **não** da planilha.

---

## 2. Arquitetura-alvo (modelo híbrido, custo zero)

```
┌─────────────────────┐         ┌──────────────────────┐
│  Frontend (PWA)     │  leitura│   Firestore          │
│  Gestão + Painel    │◄───────►│   (plano Spark grátis)│
│  Firebase Hosting   │  escrita│   base de dados       │
└─────────────────────┘         └──────────┬───────────┘
                                            │ leitura (REST + conta de serviço)
                                            ▼
                                 ┌──────────────────────┐
                                 │  Apps Script          │
                                 │  • e-mails (MailApp)  │
                                 │  • triggers agendados │
                                 │  (continua de graça)  │
                                 └──────────────────────┘
```

**Por que esse desenho funciona sem cartão:**

- **Firestore no plano Spark é gratuito e generoso:** 50.000 leituras, 20.000 escritas e 20.000 exclusões por dia, e 1 GB de dados — muito acima do uso de um app interno. Sem cartão.
- **Firebase Hosting é gratuito** e entrega o frontend por CDN, tipicamente mais rápido que o GitHub Pages.
- **O Apps Script lê o Firestore** via REST API usando uma conta de serviço (existe biblioteca pronta: `FirestoreGoogleAppsScript`). Assim os e-mails continuam sendo montados e enviados pelo Apps Script, de graça, agora lendo do Firestore em vez da planilha.

**Ganho de velocidade:** o frontend passa a ler direto do Firestore (resposta em milissegundos), eliminando o "cold start" do Apps Script nas consultas — exatamente o que torna o app lento hoje. O Painel (só consulta) é o que mais melhora.

---

## 3. E-mails automáticos — o que muda

**Continuam funcionando, no Apps Script, de graça.** O que muda é só **de onde** eles leem os dados: hoje leem da planilha; depois leem do Firestore.

- `MailApp.sendEmail(...)` — mantido. Não exige servidor de e-mail nem chave de API.
- Triggers de seg-sex (10h30 / 14h) — mantidos.
- Ajuste necessário: trocar, dentro do `Code.gs`, as funções que leem a planilha (`_getEtapasParaApp_`, `_getEmails_` etc.) por funções que leem o Firestore via REST. A lógica de montar e disparar o e-mail **não muda**.

**Por que NÃO mover os e-mails para o Firebase:** no Firebase, e-mail automático exige Cloud Functions agendadas + serviço externo (Resend/SendGrid) **e** o plano **Blaze (pago, com cartão)**. Como a opção é ficar sem cartão, os e-mails ficam no Apps Script — que já faz isso bem e sem custo.

---

## 4. Plano faseado

### Fase 0 — Organização dos repositórios (risco zero, ganho imediato)
Feita antes de qualquer migração, nos dois repos separados.
1. README revisado + `CHECKLIST_PUBLICACAO.md` (criar no Painel) com o passo a passo de deploy.
2. Garantir integridade de `index.html` e `Code.gs` (sem truncamento) e validar sintaxe a cada edição.
3. (Recomendado) Extrair o `<script>` do `index.html` para `app.js` e o `<style>` para `styles.css` — reduz drasticamente o risco de truncar arquivo grande.
4. Padronizar a estrutura de pastas igual nos dois repositórios.

### Fase 1 — Preparar o Firebase (grátis)
1. Criar projeto no Firebase (plano Spark, sem cartão).
2. Ativar **Firestore** e **Hosting**.
3. Modelar as coleções a partir das abas atuais: `processos`, `etapas`, `capacidade`, `servidores`, `config`/`emails`.
4. Definir **regras de segurança** do Firestore (quem lê, quem escreve) — ponto crítico, já que o Painel é público e o Gestão é restrito à equipe.

### Fase 2 — Migrar os dados (uma vez)
1. Script de migração que lê a planilha atual e grava cada aba na coleção correspondente do Firestore.
2. Conferência: contagem de processos/etapas igual à da planilha.
3. Manter a planilha como **backup congelado** por segurança durante a transição.

### Fase 3 — Religar o frontend ao Firestore
1. Frontend passa a ler/escrever no Firestore (SDK web do Firebase) em vez de chamar o Apps Script para dados.
2. Manter compatibilidade: telas e funções iguais para o usuário; muda só a fonte dos dados.
3. App de Gestão: ações de escrita (cadastrar, editar, excluir, mover fila) vão para o Firestore.

### Fase 4 — Religar os e-mails do Apps Script ao Firestore
1. Adicionar a leitura do Firestore via REST + conta de serviço no `Code.gs`.
2. Trocar as funções de leitura da planilha por leitura do Firestore nas rotinas de e-mail.
3. Testar os triggers (próximos/vencidos) com dados reais do Firestore antes de desligar o caminho antigo.

### Fase 5 — Hospedagem e corte
1. Publicar o frontend no **Firebase Hosting**.
2. Validar tudo em paralelo ao GitHub Pages por alguns dias.
3. Apontar o uso para o Firebase e aposentar a dependência da planilha.

---

## 5. Riscos e cuidados

- **Regras de segurança do Firestore:** o Painel é consulta pública, mas escrita só pode vir do app de Gestão autenticado. Definir isso com cuidado para não expor escrita.
- **Conta de serviço do Apps Script:** a chave privada fica nas *Script Properties* (nunca no repositório). Já está coberto pelo `.gitignore`, mas reforçar.
- **Cotas do Spark:** 50k leituras/dia é bastante, mas o frontend deve evitar reler tudo a cada clique (usar leitura sob demanda e cache local). Para um app interno, folga grande.
- **Migração única:** rodar o script de migração com a planilha congelada para não perder nada criado durante a transição.

---

## 6. Próximos passos

1. Validar este plano.
2. Começar pela **Fase 0** no repositório do **Painel** (menos documentado).
3. Criar o projeto Firebase (Spark) e modelar as coleções (Fase 1).
4. Escrever e testar o script de migração da planilha → Firestore (Fase 2) em ambiente de teste antes de valer para produção.
