'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes de boxplotSVG() — o desenho do boxplot em SVG inline (sem lib).
// Verifica a ESTRUTURA do SVG (não a estética): um box por série, uma linha
// de mediana por série com dados, pontos de outlier, e robustez a vazio.
//
// Alvo: boxplotSVG() de relatorio-prazos.js.
// Rodar: npm test
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { estatEtapa, boxplotSVG } = require('../relatorio-prazos.js');

function conta(str, sub) { return str.split(sub).length - 1; }

test('retorna um SVG válido (string começando com <svg)', () => {
  const svg = boxplotSVG([{ rotulo: 'Etapa A', estat: estatEtapa([1, 2, 3, 4, 5]) }]);
  assert.equal(typeof svg, 'string');
  assert.ok(svg.trim().startsWith('<svg'), 'deve começar com <svg');
  assert.ok(svg.trim().endsWith('</svg>'), 'deve fechar o <svg>');
});

test('desenha um box por série', () => {
  const series = [
    { rotulo: 'A', estat: estatEtapa([1, 2, 3, 4, 5, 6]) },
    { rotulo: 'B', estat: estatEtapa([2, 4, 6, 8, 10, 12]) },
    { rotulo: 'C', estat: estatEtapa([5, 5, 6, 7, 8, 30]) }
  ];
  const svg = boxplotSVG(series);
  assert.equal(conta(svg, 'class="bp-box"'), 3, 'um grupo bp-box por série');
  assert.equal(conta(svg, 'class="bp-mediana"'), 3, 'uma mediana por série com dados');
});

test('outliers viram pontos (bp-outlier)', () => {
  // [1..9,100] tem exatamente 1 outlier (100).
  const svg = boxplotSVG([{ rotulo: 'X', estat: estatEtapa([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]) }]);
  assert.equal(conta(svg, 'class="bp-outlier"'), 1, 'um ponto de outlier');
});

test('amostra pequena (n<4) não desenha caixa (rect), mas mostra mediana', () => {
  const svg = boxplotSVG([{ rotulo: 'P', estat: estatEtapa([10, 20, 30]) }]);
  assert.equal(conta(svg, '<rect'), 0, 'sem caixa quando n<4');
  assert.equal(conta(svg, 'class="bp-mediana"'), 1, 'ainda mostra a mediana');
});

test('série vazia não quebra e não conta como box com dados', () => {
  const svg = boxplotSVG([{ rotulo: 'Vazia', estat: estatEtapa([]) }]);
  assert.ok(svg.trim().startsWith('<svg'));
  assert.equal(conta(svg, 'class="bp-mediana"'), 0, 'sem mediana quando não há dados');
});

test('lista vazia devolve um SVG de "sem dados"', () => {
  const svg = boxplotSVG([]);
  assert.ok(svg.trim().startsWith('<svg'));
  assert.ok(/sem dados/i.test(svg), 'mostra aviso de sem dados');
});

test('escapa o rótulo (sem injeção de HTML no SVG)', () => {
  const svg = boxplotSVG([{ rotulo: '<b>&"x"', estat: estatEtapa([1, 2, 3, 4]) }]);
  assert.ok(svg.indexOf('<b>') === -1, 'não pode conter <b> cru');
  assert.ok(svg.indexOf('&lt;b&gt;') >= 0, 'deve escapar para &lt;b&gt;');
});

test('é determinístico (mesma entrada → mesma saída)', () => {
  const s = [{ rotulo: 'A', estat: estatEtapa([1, 2, 3, 4, 5]) }];
  assert.equal(boxplotSVG(s), boxplotSVG(s));
});
