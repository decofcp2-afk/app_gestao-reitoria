(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AtasDomain = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MARCOS = [30, 60, 90];

  function texto(v) { return String(v == null ? '' : v).trim(); }

  function normalizarTexto(v) {
    return texto(v).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function apenasDigitos(v) { return texto(v).replace(/\D/g, ''); }

  function dataSomente(v) {
    if (!v) return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    }
    var s = texto(v);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) {
      var br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if (br) m = [br[0], br[3], br[2], br[1]];
    }
    if (!m) return null;
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return d;
  }

  function isoData(v) {
    var d = dataSomente(v);
    return d ? d.toISOString().slice(0, 10) : '';
  }

  function formatarDataBR(v) {
    var iso = isoData(v);
    return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  }

  function diasAte(fim, hoje) {
    var a = dataSomente(hoje || new Date());
    var b = dataSomente(fim);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function situacaoAta(ata, hoje) {
    ata = ata || {};
    var dias = diasAte(ata.vigenciaFim, hoje);
    if (dias === null) return { codigo: 'aguardando', rotulo: 'Aguardando dados', dias: null };
    if (dias < 0) return { codigo: 'vencida', rotulo: 'Vencida em ' + formatarDataBR(ata.vigenciaFim), dias: dias };
    if (dias <= 90) return { codigo: 'vencendo', rotulo: 'Vence em ' + dias + (dias === 1 ? ' dia' : ' dias'), dias: dias };
    return { codigo: 'ativa', rotulo: 'Ativa', dias: dias };
  }

  function marcosPendentes(ata, hoje, enviados) {
    var dias = diasAte(ata && ata.vigenciaFim, hoje);
    if (dias === null) return [];
    enviados = enviados || {};
    var candidatos = dias < 0 ? [0] : MARCOS.filter(function (m) { return dias <= m; });
    return candidatos.filter(function (m) { return !enviados[chaveAviso(ata, m, ata && ata.responsavel, 'sino')]; });
  }

  function chaveOficial(ata) {
    ata = ata || {};
    var pncp = texto(ata.idAtaPNCP || ata.identificadorPncp || ata.pncpId);
    if (pncp) return 'pncp-' + normalizarTexto(pncp).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return ['arp', apenasDigitos(ata.uasg || ata.codigoUnidade), apenasDigitos(ata.numeroAta || ata.numeroAtaRegistroPreco), apenasDigitos(ata.anoAta || ata.ano)].join('-');
  }

  function chaveAviso(ata, marco, destinatario, canal) {
    return [chaveOficial(ata), isoData(ata && ata.vigenciaFim) || 'sem-data', String(marco), normalizarTexto(destinatario).replace(/[^a-z0-9]+/g, '-'), canal || 'sino'].join('|');
  }

  function normalizarAtaOficial(r) {
    r = r || {};
    var numero = texto(r.numeroAtaRegistroPreco || r.numeroAta || r.numero);
    var ano = texto(r.anoAta || (numero.indexOf('/') >= 0 ? numero.split('/').pop() : r.anoCompra));
    return {
      origem: 'compras',
      numeroAta: numero,
      anoAta: ano,
      uasg: texto(r.codigoUnidadeGerenciadora || r.codigoUnidade || r.uasg || r.codigoUasg),
      nomeUasg: texto(r.nomeUnidadeGerenciadora || r.nomeUnidade || r.nomeUasg),
      numeroCompra: texto(r.numeroCompra),
      anoCompra: texto(r.anoCompra),
      modalidadeCompra: texto(r.nomeModalidadeCompra || r.modalidadeCompra),
      processo: texto(r.numeroProcesso || r.processo),
      objeto: texto(r.objetoCompra || r.objeto),
      dataAssinatura: isoData(r.dataAssinatura || r.assinatura),
      vigenciaInicio: isoData(r.dataVigenciaInicial || r.vigenciaInicial || r.vigenciaInicio),
      vigenciaFim: isoData(r.dataVigenciaFinal || r.vigenciaFinal || r.vigenciaFim),
      idAtaPNCP: texto(r.idAtaPNCP || r.identificadorPncp || r.numeroControlePncpAta || r.numeroControlePNCPAta),
      linkPncp: texto(r.linkAtaPNCP || r.linkPncp),
      atualizadoOficialEm: new Date().toISOString()
    };
  }

  function mesclarOficial(interno, oficial) {
    var out = Object.assign({}, interno || {});
    Object.keys(oficial || {}).forEach(function (k) {
      if (oficial[k] !== '' && oficial[k] !== null && oficial[k] !== undefined) out[k] = oficial[k];
    });
    out.origem = 'compras';
    return out;
  }

  function filtrarAtas(atas, filtros, hoje) {
    filtros = filtros || {};
    var busca = normalizarTexto(filtros.busca);
    return (atas || []).filter(function (ata) {
      if (ata.arquivada) return false;
      var sit = situacaoAta(ata, hoje).codigo;
      if (filtros.situacao && filtros.situacao !== sit) return false;
      if (filtros.responsavel && normalizarTexto(ata.responsavel) !== normalizarTexto(filtros.responsavel)) return false;
      if (filtros.ano && texto(ata.anoAta) !== texto(filtros.ano)) return false;
      if (!busca) return true;
      return normalizarTexto([
        ata.numeroAta, ata.processo, ata.numeroCompra, ata.anoCompra,
        ata.objeto, ata.responsavel, ata.fornecedor
      ].join(' ')).indexOf(busca) >= 0;
    });
  }

  function kpis(atas, hoje) {
    var out = { ativas: 0, vencendo90: 0, aguardando: 0, vencidas: 0 };
    (atas || []).forEach(function (ata) {
      if (ata.arquivada) return;
      var s = situacaoAta(ata, hoje).codigo;
      if (s === 'ativa') out.ativas++;
      else if (s === 'vencendo') out.vencendo90++;
      else if (s === 'aguardando') out.aguardando++;
      else if (s === 'vencida') out.vencidas++;
    });
    return out;
  }

  return {
    MARCOS: MARCOS.slice(), normalizarTexto: normalizarTexto, dataSomente: dataSomente,
    isoData: isoData, formatarDataBR: formatarDataBR, diasAte: diasAte,
    situacaoAta: situacaoAta, marcosPendentes: marcosPendentes,
    chaveOficial: chaveOficial, chaveAviso: chaveAviso,
    normalizarAtaOficial: normalizarAtaOficial, mesclarOficial: mesclarOficial,
    filtrarAtas: filtrarAtas, kpis: kpis
  };
});
