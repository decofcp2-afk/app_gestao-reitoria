'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes de paraCSV() — exportação da tabela-resumo (Fase 4).
// Formato Excel pt-BR: delimitador ';' e decimal ','.
//
// Alvo: paraCSV() de relatorio-prazos.js.
// Rodar: npm test
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarPrazos, montarRelatorio, paraCSV } = require('../relatorio-prazos.js');

function relDe(concl) {
  const processos = concl.map(function (c, i) { return { id: 'P' + i, d0: c.d0 }; });
  const etapas = concl.map(function (c, i) {
    return { processoId: 'P' + i, etapa: c.etapa, ordem: 1, status: 'Concluída', dataRealizacao: c.fim };
  });
  const r = agregarPrazos(processos, etapas, { unidade: 'u', ano: 2026 });
  return montarRelatorio([r], { unidadeSel: '(geral)' });
}

test('cabeçalho e uma linha por etapa, com delimitador ;', () => {
  const rel = relDe([
    { d0: '2026-01-01', etapa: 'Instrução', fim: '2026-01-11' },
    { d0: '2026-01-01', etapa: 'Instrução', fim: '2026-01-13' }
  ]);
  const csv = paraCSV(rel);
  const linhas = csv.split('\r\n');
  assert.ok(linhas[0].startsWith('Etapa;Ano;n;Q1;Mediana;Q3;DIQ;LS;LI;Media;Minimo;Maximo;Outliers'));
  assert.equal(linhas.length, 2, 'cabeçalho + 1 etapa');
  assert.ok(linhas[1].indexOf('Instrução;2026;2;') === 0, 'começa com etapa;ano;n');
});

test('decimais usam vírgula (Excel pt-BR)', () => {
  const rel = relDe([
    { d0: '2026-01-01', etapa: 'A', fim: '2026-01-11' }, // 10
    { d0: '2026-01-01', etapa: 'A', fim: '2026-01-13' }, // 12
    { d0: '2026-01-01', etapa: 'A', fim: '2026-01-12' }, // 11
    { d0: '2026-01-01', etapa: 'A', fim: '2026-01-15' }  // 14
  ]);
  const csv = paraCSV(rel);
  // Q1 de [10,11,12,14] = 10,75 → arredondado a 1 casa (como a tabela na tela) = 10,8.
  assert.ok(/;10,8;/.test(csv), 'Q1 com vírgula decimal (1 casa): ' + csv);
  assert.ok(!/\d\.\d/.test(csv), 'não pode haver ponto decimal');
});

test('escapa campos com ; ou aspas', () => {
  const rel = relDe([
    { d0: '2026-01-01', etapa: 'Etapa; com "aspas"', fim: '2026-01-11' },
    { d0: '2026-01-01', etapa: 'Etapa; com "aspas"', fim: '2026-01-13' }
  ]);
  const csv = paraCSV(rel);
  assert.ok(csv.indexOf('"Etapa; com ""aspas"""') >= 0, 'campo com ; e aspas é escapado');
});

test('relatório vazio devolve só o cabeçalho', () => {
  const csv = paraCSV({ etapas: [] });
  assert.equal(csv.split('\r\n').length, 1);
});
