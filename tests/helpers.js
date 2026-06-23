'use strict';
// Builders de dados simulados (mesma forma das coleções do Firestore) para os
// testes de capacidade. Mantém os testes legíveis: cada cenário só sobrescreve
// os campos relevantes.

let _seq = 0;
function uid(prefix) { return (prefix || 'id') + '_' + (++_seq); }

// Carga (coleção `cargas`): vínculo servidor↔processo numa fase, com pontuação.
function carga(o) {
  return Object.assign({
    _id: uid('carga'),
    processoId: 'P1',
    servidor: '',
    fase: 'Interna',
    ativo: false,
    p1: 0, p2: 0, p3: 0,
    modalidade: '',
    objeto: ''
  }, o);
}

// Etapa (coleção `etapas`): usada para derivar fase corrente / conclusão.
function etapa(o) {
  return Object.assign({
    processoId: 'P1',
    etapa: 'Etapa',
    fase: 'Interna',
    status: 'Pendente',
    motivoAtraso: '',
    ordem: 0
  }, o);
}

// Processo (coleção `processos`).
function processo(o) {
  return Object.assign({
    id: 'P1',
    objeto: 'Objeto do processo',
    emailRequisitante: ''
  }, o);
}

// Servidor (coleção `servidores`): fonte dos cards de resumo da Capacidade.
function servidor(o) {
  return Object.assign({
    nome: '',
    matricula: '',
    outrosFixo: 0
  }, o);
}

function byNome(resumo, nome) {
  return resumo.find(function (s) { return s.servidor === nome; });
}

function nomes(resumo) {
  return resumo.map(function (s) { return s.servidor; });
}

module.exports = { carga, etapa, processo, servidor, byNome, nomes, uid };
