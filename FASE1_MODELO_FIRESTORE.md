# Fase 1 — Modelo de dados no Firestore

Migração da planilha `CronogramaContratacoes_CPII.xlsx` para o Firestore (plano Spark, grátis).
Decisão de autenticação: **o login da equipe permanece no Apps Script**. O frontend **lê** o
Firestore direto (rápido); toda **escrita** passa pelo Apps Script via conta de serviço.

## Coleções

| Coleção | ID do documento | Acesso (regras) | Origem (aba) | Qtde |
|---|---|---|---|---|
| `processos` | `SEL-2026-001` | leitura pública | 🏛 Processos | 21 |
| `etapas` | `SEL-2026-001_01` | leitura pública | 🗓 Etapas | 173 |
| `servidores` | matrícula (`3419547`) | leitura pública (sem e-mail) | ⚙️ ConfigSEL | 4 |
| `calendario` | data (`2026-01-01`) | leitura pública | Calendario | 15 |
| `config` | `matrizPontuacao` | leitura pública | Matriz de Pontuação | 1 |
| `emails` | matrícula | **privado** (só Apps Script) | ⚙️ ConfigSEL | 4 |
| `historico` | `h0000` | **privado** | __historico_motivos | 23 |
| `dispositivos` | DeviceId | **privado** | __pwa_dispositivos | 2 |

> A aba **📊 Capacidade** não vira coleção: é calculada no app a partir de `etapas`.
> A aba **📋 Instruções** é só texto de UI e é descartada.

### Campos por coleção

- **processos:** `id, suap, objeto, modalidade, d0 (timestamp), linkSuap, temIrp (bool), status, setorRequisitante, emailRequisitante, ordemFila (int|null)`
- **etapas:** `processoId, ordem (int), etapa, fase, agente, prazoDias (int), dataRealizacao (timestamp|null), motivoAtraso, status`
- **servidores:** `matricula, nome, cor, chefe (bool)` — *sem e-mail*
- **emails:** `matricula, nome, email`
- **calendario:** `data (timestamp), nome, tipo, municipio, afetaPrazo (bool), fonte, observacao`
- **config/matrizPontuacao:** `{ itens: [ { fator, pontos, fundamentacao, observacao } ] }`
- **historico:** `timestamp, processoId, etapa, servidor, motivo, diasAtraso (number), dataRealizacao`
- **dispositivos:** campos da aba `__pwa_dispositivos` (registro de push do PWA)

## Regras de segurança

Ver `firebase/firestore.rules`. Resumo: leitura pública nas coleções consumidas pelo Painel e
pelo App Gestão; **escrita sempre bloqueada para o cliente** (a conta de serviço do Apps Script
ignora as regras); coleções sensíveis (`emails`, `historico`, `dispositivos`) sem acesso pelo cliente.

---

## Passos manuais no console (só você consegue fazer)

1. **Criar o projeto** em <https://console.firebase.google.com> — plano **Spark**, **sem cartão**.
2. **Ativar o Firestore** (modo de produção) e o **Hosting**.
3. Em *Configurações do projeto > Contas de serviço*, **gerar nova chave privada** →
   baixar o `serviceAccount.json`. **Nunca** versionar esse arquivo (já está no `.gitignore`).
4. Publicar as regras: copiar o conteúdo de `firebase/firestore.rules` na aba
   *Firestore > Regras* e publicar.

## Rodar a migração (Fase 2)

```bash
pip install openpyxl firebase-admin

# valida a leitura sem tocar no Firebase:
python firebase/migrar_para_firestore.py --xlsx "CronogramaContratacoes_CPII.xlsx" --dry-run

# migra de verdade (com a chave baixada no passo 3):
python firebase/migrar_para_firestore.py --xlsx "CronogramaContratacoes_CPII.xlsx" --key serviceAccount.json
```

Conferência pós-migração: 21 processos, 173 etapas, 4 servidores. Manter a planilha como
**backup congelado** durante a transição.
