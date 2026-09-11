'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function carregarBackend(resposta) {
  const chamadas = [];
  const contexto = {
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    encodeURIComponent,
    Utilities: {
      formatDate() { return '2026'; },
      getUuid() { return 'uuid-teste'; }
    },
    UrlFetchApp: {
      fetch(url, opcoes) {
        chamadas.push({ url, opcoes });
        return {
          getResponseCode() { return 200; },
          getContentText() { return JSON.stringify(resposta); }
        };
      }
    }
  };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync('apps-script/Atas.gs', 'utf8'), contexto);
  return { contexto, chamadas };
}

test('cliente ARP usa os parâmetros obrigatórios atuais e apenas GET', () => {
  const registro = {
    numeroAtaRegistroPreco: '90032/2025',
    codigoUnidadeGerenciadora: '153167',
    nomeUnidadeGerenciadora: 'COLEGIO PEDRO II',
    numeroCompra: '90021', anoCompra: '2025',
    dataVigenciaInicial: '2026-01-10', dataVigenciaFinal: '2027-01-11',
    numeroControlePncpAta: '42414284000102-1-000143/2025-000001'
  };
  const { contexto, chamadas } = carregarBackend({ resultado: [registro], totalPaginas: 1 });
  const atas = contexto._atasBuscarOficiais_({ uasg: '153167', numeroCompra: '90021', anoCompra: '2025' });

  assert.equal(atas.length, 1, 'as três janelas anuais não duplicam a mesma ata');
  assert.equal(atas[0].uasg, '153167');
  assert.equal(atas[0].idAtaPNCP, registro.numeroControlePncpAta);
  assert.equal(chamadas.length, 3);
  chamadas.forEach(({ url, opcoes }) => {
    assert.match(url, /codigoUnidadeGerenciadora=153167/);
    assert.match(url, /dataVigenciaInicialMin=\d{4}-01-01/);
    assert.match(url, /dataVigenciaInicialMax=\d{4}-12-31/);
    assert.equal(opcoes.method, 'get');
  });
});

test('consulta oficial exige número da compra porque a API não filtra processo', () => {
  const { contexto, chamadas } = carregarBackend({ resultado: [], totalPaginas: 1 });
  assert.throws(() => contexto._atasBuscarOficiais_({ processo: '23040.000001/2026-00' }), /número da compra/);
  assert.equal(chamadas.length, 0);
});

test('marco atual escolhe uma única urgência entre 90, 60, 30 e vencida', () => {
  const { contexto } = carregarBackend({ resultado: [] });
  assert.equal(contexto._atasMarcoAtual_({ vigenciaFim: '2026-12-10' }, '2026-09-11'), 90);
  assert.equal(contexto._atasMarcoAtual_({ vigenciaFim: '2026-10-11' }, '2026-09-11'), 30);
  assert.equal(contexto._atasMarcoAtual_({ vigenciaFim: '2026-09-10' }, '2026-09-11'), 0);
});

test('vínculo oficial encontra cadastro manual sem misturar atas distintas', () => {
  const { contexto } = carregarBackend({ resultado: [] });
  contexto._atasListar_ = () => [
    { _id: 'manual-certo', origem: 'manual', numeroAta: '001/2026', uasg: '153167', processoId: 'p1' },
    { _id: 'manual-outro', origem: 'manual', numeroAta: '002/2026', uasg: '153167', processoId: 'p1' },
    { _id: 'arquivado', origem: 'manual', numeroAta: '001/2026', uasg: '153167', processoId: 'p1', arquivada: true }
  ];
  const encontrado = contexto._atasLocalizarManualCorrespondente_(
    { numeroAta: '001/2026', uasg: '153167', numeroCompra: '90001', anoCompra: '2026' },
    { processoId: 'p1' }
  );
  assert.equal(encontrado._id, 'manual-certo');
});
