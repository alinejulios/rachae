// Finanças pessoais (aba "Finanças") — módulo puro, como o calc.js: sem Firebase, sem DOM.
// Junta num lugar só tudo o que é da pessoa:
//  - o que ela lançou em Finanças (users/{uid}/lancamentos e .../fixos);
//  - as despesas "Pessoal (só você)" antigas, que continuam dentro de cada grupo;
//  - a PARTE dela nas despesas, contas fixas e compras parceladas de cada grupo.
// Valores em CENTAVOS. Cada item é um "pedaço" de gasto num mês:
//   valor   = a parte da pessoa (é o que entra em gráficos e totais);
//   cobrado = o que saiu do cartão/conta dela (inteiro, quando ela pagou pelo grupo; 0 se outra pessoa pagou).
import { devidoPorPessoa, membrosDoGrupo, expandirFixas, parcelasDaCompra, valorNoMes } from './calc.js';

/**
 * Categorias de sempre — as mesmas em "Só minha" e "De um grupo" (e nos limites). Inclui todas as que os
 * grupos já usavam (Aluguel, Mercado/Supermercado, Contas de Consumo…), então nada lançado antes muda de nome.
 */
export const CATEGORIAS = ['Aluguel', 'Casa', 'Contas de Consumo', 'Mercado/Supermercado', 'Alimentação', 'Saúde', 'Ensino',
  'Transporte', 'Lazer', 'Compras', 'Streaming', 'Internet', 'Pet', 'Higiene', 'Seguro', 'Clube/Delivery', 'Viagem',
  'Poupança', 'Outros'];
export const TIPOS_FONTE = { credito: 'Cartão de crédito', debito: 'Débito / conta', beneficio: 'Benefício (VR, VA, VT…)' };

export const addM = (mes, n) => {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + String(((t % 12) + 12) % 12 + 1).padStart(2, '0');
};
const mesDe = data => String(data || '').slice(0, 7);
export const ehCredito = f => !!f && f.tipo === 'credito';

/**
 * Mês da fatura que paga uma compra no cartão (= mês em que a fatura vence).
 * Compra no dia do fechamento ou depois entra na fatura seguinte.
 */
export function mesFatura(fonte, data) {
  const mes = mesDe(data);
  if (!ehCredito(fonte) || !fonte.fecha) return mes;
  const fecha = Number(String(data).slice(8, 10)) < fonte.fecha ? mes : addM(mes, 1);
  return (fonte.vence || fonte.fecha) > fonte.fecha ? fecha : addM(fecha, 1);
}

/** Parcelas a partir de um mês (centavos que sobram nas primeiras; adiantamentos como no calc.js). */
export function parcelasDesde(valor, nParcelas, mes0, adiantamentos = []) {
  const n = Math.max(1, nParcelas || 1);
  const base = Math.floor(valor / n);
  let resto = valor - base * n;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ mes: addM(mes0, i), valor: base + (resto > 0 ? 1 : 0), num: i + 1 });
    if (resto > 0) resto--;
  }
  let fim = n;
  (adiantamentos || []).forEach(a => {
    for (let k = 0; k < a.qtd && fim > 0; k++) {
      const p = out[--fim];
      if (p.mes > a.mes) { p.mes = a.mes; p.adiantada = true; }
    }
  });
  return out;
}

/** 1º mês de um lançamento: pelo fechamento, se foi no cartão de crédito; senão pela data (+1 com "mês seguinte"). */
export const primeiroMes = (data, fonte, seguinte) => ehCredito(fonte) ? mesFatura(fonte, data) : addM(mesDe(data), seguinte ? 1 : 0);

/**
 * Valor de uma conta fixa pessoal num mês: o confirmado (se houver); senão o valor vigente
 * (`valores[].desde`); se for "valor variável", a média dos últimos 3 meses confirmados.
 * @returns {{valor:number, estimado:boolean}|null}
 */
export function valorFixoNoMes(fx, mes) {
  if (!fx.desde || mes < fx.desde || (fx.ate && mes > fx.ate)) return null;
  const conf = fx.confirmados || {};
  if (conf[mes] > 0) return { valor: conf[mes], estimado: false };
  if (fx.estimado) {
    const ant = Object.keys(conf).filter(m => m < mes && conf[m] > 0).sort().slice(-3);
    if (ant.length) return { valor: Math.round(ant.reduce((t, m) => t + conf[m], 0) / ant.length), estimado: true };
  }
  return { valor: valorNoMes(fx, mes), estimado: !!fx.estimado };
}

/** Chave de vínculo (qual cartão a pessoa usou) de um lançamento que fica num grupo. */
export const chaveVinculo = (hid, colecao, id) => hid + '_' + colecao + '_' + id;

/**
 * Todos os itens de finanças da pessoa, mês a mês, até `horizonte` meses à frente.
 * @param {object} p
 * @param {{id, nome, db}[]} p.grupos grupos com membros, grupos (conjuntos), despesas, compras, pessoais, pessoaisCompras
 * @param {string} p.meUid
 * @param {{fontes, fixos, lancamentos, vinculos, config}} p.fin dados de users/{uid}/...
 * @param {string} p.mesAtual 'aaaa-mm'
 */
export function montarItens({ grupos, meUid, fin, mesAtual, horizonte = 12 }) {
  const fontes = Object.fromEntries((fin.fontes || []).map(f => [f.id, f]));
  const vinc = fin.vinculos || {};
  const dup = (fin.config && fin.config.duplicados) || {};
  const limite = addM(mesAtual, horizonte);
  const out = [];
  const add = it => { if (it.mes <= limite) out.push({ previsto: it.mes > mesAtual, estimado: false, confirmar: false, ...it }); };

  // ---- Contas fixas pessoais
  (fin.fixos || []).forEach(fx => {
    if (dup[fx.id] === 'mesmo') return; // a pessoa disse que é a mesma conta de um grupo: conta só a do grupo
    const fim = fx.ate && fx.ate < limite ? fx.ate : limite;
    for (let mes = fx.desde; mes && mes <= fim; mes = addM(mes, 1)) {
      const v = valorFixoNoMes(fx, mes);
      if (!v || !(v.valor > 0)) continue;
      add({ chave: 'fixo:' + fx.id + '@' + mes, origem: 'eu', tipo: 'fixo', descricao: fx.descricao, categoria: fx.categoria,
        fonteId: fx.fonteId || null, pagouEu: true, mes, valor: v.valor, cobrado: v.valor, total: v.valor,
        estimado: v.estimado, confirmar: !!fx.estimado && mes === mesAtual && !((fx.confirmados || {})[mes] > 0),
        ref: { kind: 'fixo', id: fx.id } });
    }
  });

  // ---- Lançamentos pessoais (à vista = 1 parcela)
  const copiados = new Set();
  (fin.lancamentos || []).forEach(l => {
    if (l.legado) copiados.add(chaveVinculo(l.legado.hid, l.legado.colecao, l.legado.id));
    const f = fontes[l.fonteId];
    const n = Math.max(1, l.nParcelas || 1);
    parcelasDesde(l.valor, n, primeiroMes(l.data, f, l.parcelaSeguinte), l.adiantamentos).forEach(p => add({
      chave: 'lanc:' + l.id + '#' + p.num, origem: 'eu', tipo: n > 1 ? 'parcela' : 'avista', descricao: l.descricao,
      categoria: l.categoria, fonteId: l.fonteId || null, pagouEu: true, mes: p.mes, valor: p.valor, cobrado: p.valor,
      total: p.valor, num: p.num, n, data: l.data, ref: { kind: 'lanc', id: l.id } }));
  });

  (grupos || []).forEach(({ id: hid, nome: grupoNome, db }) => {
    const conjuntos = Object.fromEntries((db.grupos || []).map(g => [g.id, g]));
    const membrosCache = {};
    const membrosDe = gid => membrosCache[gid] || (membrosCache[gid] = membrosDoGrupo(conjuntos[gid], db.membros || []));
    const nome = u => u === meUid ? 'você' : ((db.membros || []).find(m => m.uid === u) || {}).nome || 'Ex-morador(a)';
    const base = { origem: hid, origemNome: grupoNome };

    // ---- Despesas pessoais antigas ("Pessoal (só você)" dentro do grupo): continuam lá, aparecem aqui
    const legado = (colecao, x, n) => {
      const k = chaveVinculo(hid, colecao, x.id);
      if (copiados.has(k)) return; // já foi copiada para Finanças (ex.: ao sair do grupo): não conta duas vezes
      const f = fontes[vinc[k]];
      const lista = ehCredito(f) ? parcelasDesde(x.valor, n, mesFatura(f, x.data), x.adiantamentos)
        : n > 1 ? parcelasDaCompra(x) : [{ mes: mesDe(x.data), valor: x.valor, num: 1 }];
      lista.forEach(p => add({ chave: 'leg:' + k + '#' + p.num, origem: 'eu', legadoDe: grupoNome, tipo: n > 1 ? 'parcela' : 'avista',
        descricao: x.descricao, categoria: x.categoria, fonteId: vinc[k] || null, pagouEu: true, mes: p.mes, valor: p.valor,
        cobrado: p.valor, total: p.valor, num: p.num, n, data: x.data, ref: { kind: 'legado', hid, colecao, id: x.id, vinculo: k } }));
    };
    (db.pessoais || []).forEach(d => legado('pessoais', d, 1));
    (db.pessoaisCompras || []).forEach(c => legado('pessoaisCompras', c, Math.max(1, c.nParcelas || 1)));

    // ---- Despesas e contas fixas do grupo (sua parte)
    const { lancadas, previstas } = expandirFixas(db.despesas || [], mesAtual, horizonte);
    [...(db.despesas || []), ...lancadas, ...previstas].forEach(d => {
      if (d.acerto) return; // acerto de contas não é gasto
      const meu = devidoPorPessoa(d, membrosDe(d.grupoId))[meUid] || 0;
      const pagouEu = d.pagoPor === meUid;
      if (meu <= 0 && !pagouEu) return;
      const serie = d.serieId || d.id;
      const k = chaveVinculo(hid, 'despesas', serie);
      const fonteId = pagouEu ? vinc[k] || null : null;
      const f = fontes[fonteId];
      add({ ...base, chave: 'gd:' + hid + ':' + d.id, conjunto: (conjuntos[d.grupoId] || {}).nome || '—',
        tipo: d.valorFixo === true || d.automatica ? 'fixo' : 'avista', descricao: d.descricao, categoria: d.categoria,
        fonteId, pagouEu, pagoPorNome: nome(d.pagoPor), mes: ehCredito(f) ? mesFatura(f, d.data) : mesDe(d.data),
        valor: meu, cobrado: pagouEu ? d.valor : 0, total: d.valor, data: d.data,
        ref: { kind: 'grupo', hid, colecao: 'despesas', id: serie, vinculo: k } });
    });

    // ---- Compras parceladas do grupo (sua parte, parcela a parcela)
    (db.compras || []).forEach(c => {
      const meu = devidoPorPessoa(c, membrosDe(c.grupoId))[meUid] || 0;
      const pagouEu = c.comprador === meUid;
      if (meu <= 0 && !pagouEu) return;
      const k = chaveVinculo(hid, 'compras', c.id);
      const fonteId = pagouEu ? vinc[k] || null : null;
      const f = fontes[fonteId];
      const n = Math.max(1, c.nParcelas || 1);
      const totais = parcelasDaCompra(c);
      const minhas = parcelasDaCompra({ ...c, valor: meu });
      const mes0 = ehCredito(f) ? mesFatura(f, c.data) : null;
      totais.forEach((p, i) => add({ ...base, chave: 'gc:' + hid + ':' + c.id + '#' + p.num, conjunto: (conjuntos[c.grupoId] || {}).nome || '—',
        tipo: n > 1 ? 'parcela' : 'avista', descricao: c.descricao, categoria: c.categoria, fonteId, pagouEu,
        pagoPorNome: nome(c.comprador), mes: mes0 ? addM(mes0, i) : p.mes, valor: minhas[i].valor,
        cobrado: pagouEu ? p.valor : 0, total: p.valor, num: p.num, n, data: c.data,
        ref: { kind: 'grupo', hid, colecao: 'compras', id: c.id, vinculo: k } }));
    });
  });
  return out;
}

// ------------------------------------------------------------------ somas e resumos
export const soma = (lista, campo = 'valor') => lista.reduce((t, i) => t + (i[campo] || 0), 0);
export const doMes = (itens, mes) => itens.filter(i => i.mes === mes);

/** Agrupa e soma; devolve [{ chave, valor }] do maior para o menor (sem zeros). */
export function somarPor(lista, chave, campo = 'valor') {
  const m = new Map();
  lista.forEach(i => { const k = chave(i); m.set(k, (m.get(k) || 0) + (i[campo] || 0)); });
  return [...m].map(([k, valor]) => ({ chave: k, valor })).filter(x => x.valor > 0).sort((a, b) => b.valor - a.valor);
}

/** Renda do mês: as mensais em vigor + as extras daquele mês. */
export function rendaDoMes(rendas, mes) {
  return (rendas || []).reduce((t, r) => {
    if (r.tipo === 'extra') return t + (r.mes === mes ? r.valor : 0);
    if (r.desde && mes < r.desde) return t;
    if (r.ate && mes > r.ate) return t;
    return t + r.valor;
  }, 0);
}

/** À vista dos meses futuros não existe ainda: estimativa = média dos 3 meses anteriores ao atual. */
export function mediaAvista(itens, mesAtual) {
  const meses = [1, 2, 3].map(k => addM(mesAtual, -k));
  return Math.round(meses.reduce((t, m) => t + soma(itens.filter(i => i.mes === m && i.tipo === 'avista')), 0) / 3);
}

/**
 * Média de uma categoria nos 3 meses antes de `mes`. 0 se houver gasto nela em menos de 2 desses meses
 * (quem começou a lançar agora não tem com o que comparar).
 */
export function mediaCategoria(itens, mes, categoria) {
  const meses = [1, 2, 3].map(k => addM(mes, -k));
  const porMes = meses.map(m => soma(itens.filter(i => i.mes === m && i.categoria === categoria)));
  if (porMes.filter(v => v > 0).length < 2) return 0;
  return Math.round(porMes.reduce((t, v) => t + v, 0) / 3);
}

const normal = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Avisos do card "Atenção" (dados; o texto é montado na tela).
 * @param {object[]} itensMes itens do mês já filtrados pela origem
 * @param {object[]} todos todos os itens (para médias)
 */
export function avisos({ itensMes, todos, mes, mesAtual, fin }) {
  const out = [];
  const fontes = (fin.fontes || []).filter(f => !f.arquivada);
  itensMes.filter(i => i.confirmar).forEach(i => out.push({ tipo: 'confirmar', item: i }));
  const limites = (fin.config && fin.config.limites) || {};
  Object.keys(limites).forEach(cat => {
    const v = soma(itensMes.filter(i => i.categoria === cat));
    if (limites[cat] > 0 && v > limites[cat]) out.push({ tipo: 'limite', categoria: cat, valor: v, limite: limites[cat] });
  });
  const adiantado = itensMes.filter(i => i.origem !== 'eu' && i.pagouEu && i.cobrado > i.valor);
  if (adiantado.length) out.push({ tipo: 'adiantado', valor: soma(adiantado, 'cobrado') - soma(adiantado), itens: [...new Set(adiantado.map(i => i.descricao))] });
  if (mes === mesAtual) {
    const hoje = new Date().getDate();
    fontes.filter(f => f.tipo === 'beneficio' && f.mensal > 0).forEach(f => {
      const usado = soma(itensMes.filter(i => i.fonteId === f.id));
      if (usado / f.mensal > 0.8) out.push({ tipo: 'beneficio', fonte: f, usado, dia: hoje });
    });
  }
  // A mesma conta nos fixos pessoais e num grupo (mesma descrição e mesma parte)
  const dupOk = (fin.config && fin.config.duplicados) || {};
  const fixasGrupo = itensMes.filter(i => i.origem !== 'eu' && i.tipo === 'fixo');
  (fin.fixos || []).forEach(fx => {
    if (dupOk[fx.id]) return;
    const meu = itensMes.find(i => i.ref.kind === 'fixo' && i.ref.id === fx.id);
    if (!meu) return;
    const g = fixasGrupo.find(i => Math.abs(i.valor - meu.valor) <= 50 &&
      (normal(i.descricao).includes(normal(fx.descricao)) || normal(fx.descricao).includes(normal(i.descricao))));
    if (g) out.push({ tipo: 'duplicado', fixo: fx, grupo: g });
  });
  const acabam = itensMes.filter(i => i.tipo === 'parcela' && i.num === i.n);
  if (acabam.length) out.push({ tipo: 'acabam', valor: soma(acabam), itens: [...new Set(acabam.map(i => i.descricao))] });
  // Categoria bem acima da média (fixas não variam: só o resto)
  const alta = somarPor(itensMes.filter(i => i.tipo !== 'fixo'), i => i.categoria)
    .map(c => ({ ...c, media: mediaCategoria(todos.filter(i => i.tipo !== 'fixo'), mes, c.chave) }))
    .filter(c => c.media > 3000 && c.valor > c.media * 1.2)
    .sort((a, b) => (b.valor - b.media) - (a.valor - a.media))[0];
  if (alta) out.push({ tipo: 'acima', categoria: alta.chave, valor: alta.valor, media: alta.media });
  return out;
}
