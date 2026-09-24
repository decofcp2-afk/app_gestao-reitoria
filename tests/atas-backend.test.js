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

test('consulta e cadastro não assumem UASG da Reitoria em outras unidades', () => {
  const { contexto, chamadas } = carregarBackend({ resultado: [], totalPaginas: 1 });
  contexto._fsUnidade_ = () => 'campus-centro';
  assert.equal(contexto._atasUasgSugerida_(), '');
  assert.throws(() => contexto._atasBuscarOficiais_({ numeroCompra: '1234' }), /UASG/);
  assert.equal(chamadas.length, 0);
  contexto._fsUnidade_ = () => 'reitoria-sel';
  assert.equal(contexto._atasUasgSugerida_(), '153167');
});

test('retirada e alteração da vigência removem avisos antigos da tela e do e-mail', () => {
  const { contexto } = carregarBackend({ resultado: [] });
  contexto._atasListar_ = () => [
    { _id: 'a1', vigenciaFim: '2026-12-31' },
    { _id: 'a2', vigenciaFim: '2026-12-31', arquivada: true }
  ];
  const avisos = [
    { ataId: 'a1', vigenciaFim: '2026-12-31' },
    { ataId: 'a1', vigenciaFim: '2026-10-31' },
    { ataId: 'a2', vigenciaFim: '2026-12-31' }
  ];
  assert.equal(contexto._atasAvisosAtivos_(avisos).length, 1);
});

test('edição manual ajusta os campos e permite limpar datas sem mudar a identidade da ata', () => {
  const { contexto } = carregarBackend({ resultado: [] });
  const updates = [];
  contexto._withAppLockResult_ = (_, fn) => fn();
  contexto._authRequire_ = () => ({ nome: 'Maria', isChefe: true });
  contexto._atasRequireAtiva_ = () => {};
  contexto._fsGet_ = () => ({ origem: 'manual', responsavel: 'Maria', numeroAta: '10/2026', vigenciaFim: '2026-12-31' });
  contexto._fsUpdate_ = (path, value) => updates.push({ path, value });
  contexto._fs_ = () => ({ query: () => ({ Execute: () => [] }) });
  const r = contexto.atualizarAtaInternaApp({ id: 'ata10', responsavel: 'Maria', processo: 'P2', objeto: 'Livros', numeroCompra: '91', vigenciaFim: '' }, 'token');
  assert.equal(r.ok, true);
  assert.equal(updates[0].value.objeto, 'Livros');
  assert.equal(updates[0].value.vigenciaFim, '');
  assert.equal('numeroAta' in updates[0].value, false);
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

test('responsável externo aceita e-mail pessoal válido sem criar servidor', () => {
  const { contexto } = carregarBackend({ resultado: [] });
  contexto._fsUnidade_ = () => 'reitoria-sel';
  const dados = contexto._atasSanitizarInterno_({
    responsavelTipo: 'externo', responsavel: 'Maria', responsavelSetor: 'Almoxarifado',
    responsavelEmail: 'Maria.Pessoal@gmail.com'
  });
  assert.equal(dados.responsavelTipo, 'externo');
  assert.equal(dados.responsavelEmail, 'maria.pessoal@gmail.com');
  assert.equal(contexto._atasEmailValido_(dados.responsavelEmail), true);
  assert.equal(contexto._atasEmailValido_('email-invalido'), false);
});
