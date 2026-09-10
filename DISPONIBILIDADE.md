# Disponibilidade da equipe

Em Config → Disponibilidade / férias da equipe, todos os usuários autenticados
da unidade consultam os períodos. Apenas a chefia registra, edita, encerra ou
cancela férias e afastamentos totais. Férias exigem início e último dia;
afastamentos podem ficar sem previsão final. Datas são inclusivas, no fuso
America/Sao_Paulo. Encerrar significa editar o último dia, preservando o histórico.
Não há substitutos nem disponibilidade parcial nesta versão.

## Dados e segurança

- `unidades/{unidade}/disponibilidade/agenda`: agenda privada, revisão otimista e
  sinalização de sincronização pendente. A gravação usa o bloqueio do Apps Script.
- `unidades/{unidade}/disponibilidadeHistorico`: auditoria privada de tentativas,
  com estados anterior/proposto, autor e horário. Uma tentativa registrada não
  comprova que a gravação seguinte terminou; consulte a revisão atual da agenda.
- `unidades/{unidade}/config/capacidadeDisponivel`: somente versão, fuso e
  transições agregadas `{data, ausentes}`. Nunca contém nomes, matrículas ou motivos.

As duas coleções privadas dependem do bloqueio padrão das regras do Firestore.
Não devem receber leitura pública. O acesso passa exclusivamente pelo Apps Script
autenticado. O cadastro funcional e o espelho público de servidores não armazenam
os períodos. Como a equipe pode ser pequena, contagens agregadas ainda permitem
inferências; os detalhes individuais não são publicados.

Processos, pontos atribuídos, prazos, login e permissões permanecem independentes
da ausência. A capacidade interna sinaliza a ausência; a troca de responsável
exibe uma confirmação quando há ausência atual. Esta versão não cobre todos os
outros pontos de atribuição de processos nem redireciona e-mails de cobrança.

## Implantação coordenada

1. Publicar primeiro o backend completo, incluindo `Disponibilidade.gs`, pelo
   script de implantação atualizado. Não executar somente `Code.gs` isoladamente.
2. Confirmar que as regras implantadas permitem leitura de `config` por unidade
   e negam as duas coleções privadas. Nenhuma regra é publicada por este PR.
3. Publicar o App Gestão com `disponibilidade.js` e o service worker atualizado.
4. Publicar o PR correspondente do Painel de Contratações (KPI via Firestore).
5. Em homologação, testar uma ausência futura, início, último dia, retorno,
   licença aberta, cancelamento e troca de unidade. Confirmar escrita negada para
   não chefia e leitura pública negada para agenda/auditoria.

O painel deve estar no caminho Firestore (`firestoreAtivo: true`). O caminho
legado em planilha não recebe a agenda nesta entrega.

Se a publicação do agregado falhar, a agenda fica salva com `pendente: true`.
A chefia deve abrir a agenda e usar “Tentar sincronizar”. Até a sincronização,
o painel pode refletir a última agenda publicada. Datas futuras já publicadas
entram e saem de vigor sem execução diária do Apps Script.

## Validação

Testes Node executam as funções reais de validação, agregação e gravação com
Firestore simulado; a suíte existente cobre regressões do aplicativo.
Validação visual e integração com Apps Script/Firestore reais ainda precisam
de homologação. O navegador desta sessão bloqueou o endereço do servidor local.
