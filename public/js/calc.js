// Cálculos do Rachaê — equivalentes às fórmulas da antiga planilha.
// Módulo puro (sem Firebase, sem DOM): recebe os documentos já lidos e
// devolve os mesmos formatos que o Apps Script devolvia. Valores em CENTAVOS
// (inteiros) para não ter erro de arredondamento; conversão para reais só no final.

export const reais = c => Math.round(c) / 100;

/** Quem de fato entra na divisão: marcados E membros do grupo (igual à fórmula antiga). */
function participantesValidos(item, membrosGrupo) {
  return (item.participantes || []).filter(u => membrosGrupo.has(u));
}

/**
 * Valor devido por pessoa (centavos) num lançamento.
 * - Igual: divide entre os participantes; os centavos que sobram vão para os primeiros.
 * - Porcentagem: divisao[uid] é fração (0.5 = 50%).
 * - Valor customizado: divisao[uid] em centavos.
 */
export function devidoPorPessoa(item, membrosGrupo) {
  const parts = participantesValidos(item, membrosGrupo);
  const out = {};
  if (!parts.length) return out;
  if (item.metodo === 'Igual') {
    const base = Math.floor(item.valor / parts.length);
    let resto = item.valor - base * parts.length;
    parts.forEach(u => { out[u] = base + (resto > 0 ? 1 : 0); if (resto > 0) resto--; });
  } else if (item.metodo === 'Porcentagem') {
    parts.forEach(u => { out[u] = Math.round(item.valor * (Number((item.divisao || {})[u]) || 0)); });
  } else {
    parts.forEach(u => { out[u] = Math.round(Number((item.divisao || {})[u]) || 0); });
  }
  return out;
}

/** Membros (uids) de um grupo; grupos "todos" incluem todo mundo da casa. */
export function membrosDoGrupo(grupo, membros) {
  if (!grupo) return new Set();
  const ativos = new Set(membros.map(m => m.uid));
  return new Set(grupo.todos ? [...ativos] : (grupo.membros || []).filter(u => ativos.has(u)));
}

/** Situação de uma compra parcelada: parte, pago e saldo devedor de cada um. */
export function situacaoCompra(compra, membrosGrupo, pagamentos) {
  const parte = devidoPorPessoa(compra, membrosGrupo);
  const pago = {};
  pagamentos.forEach(p => { if (p.compraId === compra.id) pago[p.pessoa] = (pago[p.pessoa] || 0) + p.valor; });
  const deve = {};
  let saldoTotal = 0;
  Object.keys(parte).forEach(u => {
    if (u === compra.comprador) return; // o comprador não deve a si mesmo
    const d = Math.max(0, parte[u] - (pago[u] || 0));
    if (d > 0) { deve[u] = d; saldoTotal += d; }
  });
  // Impacto no saldo: comprador tem a receber o total em aberto; os outros, a pagar
  const impacto = {};
  Object.keys(deve).forEach(u => { impacto[u] = -deve[u]; });
  if (saldoTotal > 0) impacto[compra.comprador] = (impacto[compra.comprador] || 0) + saldoTotal;
  return { parte, pago, deve, saldoTotal, impacto };
}

/**
 * Painel de um grupo para a pessoa logada — mesmo formato do getDashboard antigo.
 * @param {object} db { membros:[{uid,nome}], grupos:[{id,nome,tipo,todos,membros}], despesas, compras, pagamentos }
 */
export function montarDashboard(db, meUid, grupoId) {
  const nome = u => (db.membros.find(m => m.uid === u) || {}).nome || 'Ex-morador(a)';
  const grupo = db.grupos.find(g => g.id === grupoId) || null;
  const membrosG = membrosDoGrupo(grupo, db.membros);

  const pagoAv = {}, devidoAv = {}, parc = {};
  membrosG.forEach(u => { pagoAv[u] = 0; devidoAv[u] = 0; parc[u] = 0; });

  const catTotals = {}, monthTotals = {}, catPorMesTotals = {};
  const acumula = (cat, valor, data) => {
    catTotals[cat] = (catTotals[cat] || 0) + valor;
    const mes = String(data || '').slice(0, 7);
    if (!mes) return;
    monthTotals[mes] = (monthTotals[mes] || 0) + valor;
    catPorMesTotals[mes] = catPorMesTotals[mes] || {};
    catPorMesTotals[mes][cat] = (catPorMesTotals[mes][cat] || 0) + valor;
  };

  db.despesas.filter(d => d.grupoId === grupoId).forEach(d => {
    if (!d.acerto) acumula(d.categoria, d.valor, d.data); // acerto de contas não é gasto
    if (d.pagoPor in pagoAv) pagoAv[d.pagoPor] += d.valor;
    const dev = devidoPorPessoa(d, membrosG);
    Object.keys(dev).forEach(u => { if (u in devidoAv) devidoAv[u] += dev[u]; });
  });

  const comprasGrupo = db.compras.filter(c => c.grupoId === grupoId);
  const comprasEmAberto = [];
  const reemb = {};
  membrosG.forEach(u => { reemb[u] = 0; });
  comprasGrupo.forEach(c => {
    acumula(c.categoria, c.valor, c.data);
    const s = situacaoCompra(c, membrosG, db.pagamentos);
    Object.keys(s.impacto).forEach(u => { if (u in parc) parc[u] += s.impacto[u]; });
    if ((s.deve[meUid] || 0) > 1) {
      comprasEmAberto.push({ id: c.id, descricao: c.descricao, saldoDevedor: reais(s.deve[meUid]), comprador: c.comprador, compradorNome: nome(c.comprador) });
    }
  });
  const compraPorId = Object.fromEntries(comprasGrupo.map(c => [c.id, c]));
  db.pagamentos.forEach(p => {
    const c = compraPorId[p.compraId];
    if (!c || c.comprador === p.pessoa) return; // auto-pagamento não é reembolso
    reemb[c.comprador] = (reemb[c.comprador] || 0) + p.valor;
  });

  const saldosPorPessoa = [...membrosG].map(u => {
    const saldoAv = pagoAv[u] - devidoAv[u];
    const saldoGeral = saldoAv + parc[u];
    return {
      nome: nome(u),
      totalPagoAv: reais(pagoAv[u]), totalDevidoAv: reais(devidoAv[u]),
      saldoAv: reais(saldoAv), saldoParc: reais(parc[u]), saldoGeral: reais(saldoGeral),
      situacao: saldoGeral > 0 ? 'A RECEBER' : (saldoGeral < 0 ? 'A PAGAR' : 'QUITADO'),
      _uid: u
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const lista = obj => Object.keys(obj).map(cat => ({ categoria: cat, valor: reais(obj[cat]) })).sort((a, b) => b.valor - a.valor);
  const catPorMes = {};
  Object.keys(catPorMesTotals).forEach(m => { catPorMes[m] = lista(catPorMesTotals[m]); });

  const pessoal = saldosPorPessoa.find(s => s._uid === meUid) || null;
  const porMes = saldosPorMes(db, grupoId, membrosG);
  const meses = {};
  Object.keys(porMes).sort().forEach(mes => {
    const lista = [...membrosG].map(u => ({ uid: u, saldo: porMes[mes][u] || 0 }));
    meses[mes] = {
      saldos: lista.map(x => ({ nome: nome(x.uid), _uid: x.uid, saldo: reais(x.saldo) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      acertos: acertosSugeridos(lista).map(a => ({ ...a, deNome: nome(a.de), paraNome: nome(a.para), valor: reais(a.valor) }))
    };
  });
  const acertos = acertosSugeridos(saldosPorPessoa.map(x => ({ uid: x._uid, saldo: Math.round(x.saldoGeral * 100) })))
    .map(a => ({ ...a, deNome: nome(a.de), paraNome: nome(a.para), valor: reais(a.valor) }));
  return {
    meses,
    acertos,
    grupoAtual: grupo ? grupo.nome : null,
    pessoal,
    saldosPorPessoa,
    gastosPorCategoria: lista(catTotals),
    evolucaoMensal: Object.keys(monthTotals).sort().map(mes => ({ mes, valor: reais(monthTotals[mes]) })),
    catPorMes,
    reembolsosPorPessoa: Object.keys(reemb).map(u => ({ nome: nome(u), valor: reais(reemb[u]) })).sort((a, b) => b.valor - a.valor),
    comprasEmAberto,
    totalAvulsas: reais(Object.values(pagoAv).reduce((s, v) => s + v, 0))
  };
}

/**
 * Saldo de cada pessoa, mês a mês (centavos). A soma de todos os meses é igual
 * ao saldo geral:
 *  - despesa: conta no mês da data (acerto: no mês de referência escolhido, `mesRef`);
 *  - compra parcelada: cada parcela de cada participante conta no mês em que vence
 *    (o comprador recebe a soma das parcelas dos outros naquele mês);
 *  - pagamento de parcela: conta no mês em que foi feito (quem pagou +, comprador −).
 * @returns {Object<string, Object<string, number>>} { 'aaaa-mm': { uid: centavos } }
 */
export function saldosPorMes(db, grupoId, membrosG) {
  const out = {};
  const soma = (mes, u, v) => {
    if (!mes || !v) return;
    out[mes] = out[mes] || {};
    out[mes][u] = (out[mes][u] || 0) + v;
  };
  db.despesas.filter(d => d.grupoId === grupoId).forEach(d => {
    const mes = d.acerto && d.mesRef ? d.mesRef : String(d.data || '').slice(0, 7);
    if (membrosG.has(d.pagoPor)) soma(mes, d.pagoPor, d.valor);
    const dev = devidoPorPessoa(d, membrosG);
    Object.keys(dev).forEach(u => soma(mes, u, -dev[u]));
  });
  const compras = db.compras.filter(c => c.grupoId === grupoId);
  compras.forEach(c => {
    const parte = devidoPorPessoa(c, membrosG);
    Object.keys(parte).forEach(u => {
      if (u === c.comprador) return;
      parcelasDaCompra({ ...c, valor: parte[u] }).forEach(p => {
        soma(p.mes, u, -p.valor);
        if (membrosG.has(c.comprador)) soma(p.mes, c.comprador, p.valor);
      });
    });
  });
  const compraPorId = Object.fromEntries(compras.map(c => [c.id, c]));
  db.pagamentos.forEach(p => {
    const c = compraPorId[p.compraId];
    if (!c || p.pessoa === c.comprador) return;
    const mes = String(p.data || '').slice(0, 7);
    if (membrosG.has(p.pessoa)) soma(mes, p.pessoa, p.valor);
    if (membrosG.has(c.comprador)) soma(mes, c.comprador, -p.valor);
  });
  return out;
}

/**
 * Transferências para zerar os saldos com o menor número de Pix: quem mais deve
 * paga para quem mais tem a receber, até todo mundo ficar quitado.
 * @param {{uid:string, saldo:number}[]} saldos em centavos (+ a receber, − a pagar)
 * @returns {{de:string, para:string, valor:number}[]} valores em centavos
 */
export function acertosSugeridos(saldos) {
  const dev = saldos.filter(s => s.saldo < 0).map(s => ({ uid: s.uid, v: -s.saldo })).sort((a, b) => b.v - a.v);
  const cred = saldos.filter(s => s.saldo > 0).map(s => ({ uid: s.uid, v: s.saldo })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < dev.length && j < cred.length) {
    const v = Math.min(dev[i].v, cred[j].v);
    if (v > 0) out.push({ de: dev[i].uid, para: cred[j].uid, valor: v });
    dev[i].v -= v; cred[j].v -= v;
    if (dev[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return out;
}

const dataBR = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const porDataDesc = (a, b) => (b.data + (b.criadoEm || '')).localeCompare(a.data + (a.criadoEm || ''));
export const codigoCompra = id => 'CP-' + String(id).slice(0, 5).toUpperCase();

/** Histórico de um grupo — mesmo formato do getHistorico antigo (últimos 30 de cada). */
export function montarHistorico(db, grupoId, meUid, souDono) {
  const nome = u => (db.membros.find(m => m.uid === u) || {}).nome || 'Ex-morador(a)';
  const grupo = db.grupos.find(g => g.id === grupoId);
  const membrosG = membrosDoGrupo(grupo, db.membros);
  const podeApagar = x => souDono || x.criadoPor === meUid;

  const despesas = db.despesas.filter(d => d.grupoId === grupoId).sort(porDataDesc).slice(0, 30).map(d => ({
    row: d.id, id: d.id, acerto: !!d.acerto, data: dataBR(d.data), descricao: d.descricao, categoria: d.categoria, segmento: d.segmento,
    grupo: grupo && grupo.nome, valor: reais(d.valor), pagoPor: nome(d.pagoPor), metodo: d.metodo, podeApagar: podeApagar(d)
  }));
  const comprasGrupo = db.compras.filter(c => c.grupoId === grupoId);
  const compras = comprasGrupo.slice().sort(porDataDesc).slice(0, 30).map(c => ({
    id: codigoCompra(c.id), docId: c.id, data: dataBR(c.data), descricao: c.descricao, categoria: c.categoria,
    grupo: grupo && grupo.nome, valorTotal: reais(c.valor), comprador: nome(c.comprador), nParcelas: c.nParcelas,
    saldoTotal: reais(situacaoCompra(c, membrosG, db.pagamentos).saldoTotal), podeApagar: podeApagar(c)
  }));
  const compraPorId = Object.fromEntries(comprasGrupo.map(c => [c.id, c]));
  const pagamentos = db.pagamentos.filter(p => compraPorId[p.compraId]).sort(porDataDesc).slice(0, 30).map(p => ({
    id: p.id, data: dataBR(p.data), compraId: codigoCompra(p.compraId), descricao: compraPorId[p.compraId].descricao,
    pessoa: nome(p.pessoa), valor: reais(p.valor), podeApagar: souDono || p.pessoa === meUid
  }));
  return { despesas, compras, pagamentos };
}

// ------------------------------------------------------------------ despesas pessoais (privadas)
// Não entram em saldos: são só para a pessoa acompanhar os próprios gastos.
// Compras parceladas pessoais são distribuídas mês a mês (uma parcela por mês,
// a partir do mês da compra), para o painel mostrar o gasto real de cada mês.

const somaMeses = (mesISO, n) => {
  const [a, m] = mesISO.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};

/**
 * Parcelas de uma compra: [{ mes: 'aaaa-mm', valor: centavos, num }] — centavos que sobram vão nas primeiras.
 * Com `parcelaSeguinte`, a 1ª parcela cai no mês seguinte ao da compra (fatura seguinte do cartão).
 */
export function parcelasDaCompra(compra) {
  const n = Math.max(1, compra.nParcelas || 1);
  const base = Math.floor(compra.valor / n);
  let resto = compra.valor - base * n;
  const mesCompra = String(compra.data || '').slice(0, 7);
  const mes0 = compra.parcelaSeguinte ? somaMeses(mesCompra, 1) : mesCompra;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ mes: somaMeses(mes0, i), valor: base + (resto > 0 ? 1 : 0), num: i + 1 });
    if (resto > 0) resto--;
  }
  return out;
}

function mesAtualISO() {
  const hoje = new Date();
  return hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
}

export function montarDashboardPessoal(despesas, compras = []) {
  const catTotals = {}, monthTotals = {}, catPorMesTotals = {};
  const soma = (cat, mes, valor) => {
    catTotals[cat] = (catTotals[cat] || 0) + valor;
    if (!mes) return;
    monthTotals[mes] = (monthTotals[mes] || 0) + valor;
    catPorMesTotals[mes] = catPorMesTotals[mes] || {};
    catPorMesTotals[mes][cat] = (catPorMesTotals[mes][cat] || 0) + valor;
  };
  const mesAtual = mesAtualISO();
  let qtdMes = 0, parcelasFuturas = 0;
  despesas.forEach(d => {
    const mes = String(d.data || '').slice(0, 7);
    soma(d.categoria, mes, d.valor);
    if (mes === mesAtual) qtdMes++;
  });
  compras.forEach(c => parcelasDaCompra(c).forEach(p => {
    soma(c.categoria, p.mes, p.valor);
    if (p.mes === mesAtual) qtdMes++;
    if (p.mes > mesAtual) parcelasFuturas += p.valor;
  }));
  const lista = obj => Object.keys(obj).map(cat => ({ categoria: cat, valor: reais(obj[cat]) })).sort((a, b) => b.valor - a.valor);
  const catPorMes = {};
  Object.keys(catPorMesTotals).forEach(m => { catPorMes[m] = lista(catPorMesTotals[m]); });
  return {
    pessoalMode: true,
    grupoAtual: 'Pessoal',
    totalMes: reais(monthTotals[mesAtual] || 0),
    parcelasFuturas: reais(parcelasFuturas),
    qtdMes,
    pessoal: null, saldosPorPessoa: [], reembolsosPorPessoa: [], comprasEmAberto: [],
    gastosPorCategoria: lista(catTotals),
    evolucaoMensal: Object.keys(monthTotals).sort().map(mes => ({ mes, valor: reais(monthTotals[mes]) })),
    catPorMes
  };
}

export function montarHistoricoPessoal(despesas, compras = []) {
  const mesAtual = mesAtualISO();
  return {
    pessoalMode: true,
    despesas: despesas.slice().sort(porDataDesc).slice(0, 50).map(d => ({
      row: 'p:' + d.id, id: d.id, data: dataBR(d.data), descricao: d.descricao,
      categoria: d.categoria, valor: reais(d.valor), podeApagar: true
    })),
    compras: compras.slice().sort(porDataDesc).slice(0, 50).map(c => {
      const parcelas = parcelasDaCompra(c);
      const pagas = parcelas.filter(p => p.mes <= mesAtual).length;
      return {
        row: 'pc:' + c.id, id: c.id, data: dataBR(c.data), descricao: c.descricao, categoria: c.categoria,
        valorTotal: reais(c.valor), nParcelas: parcelas.length, valorParcela: reais(parcelas[parcelas.length - 1].valor),
        parcelaAtual: Math.min(pagas, parcelas.length),
        restante: reais(parcelas.filter(p => p.mes > mesAtual).reduce((s, p) => s + p.valor, 0)), podeApagar: true
      };
    }),
    pagamentos: []
  };
}
