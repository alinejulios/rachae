/**
 * Rachaê — Web App de divisão de contas de casa
 * ----------------------------------------------
 * Backend do Google Apps Script. Este script deve ser criado DENTRO da
 * planilha "Divisao_Contas_Casa" (Extensões > Apps Script), para que
 * SpreadsheetApp.getActiveSpreadsheet() aponte para a planilha certa.
 *
 * Veja o guia de publicação (Guia_Interface_WebApp.md) para o passo a passo,
 * incluindo a migração para o modelo de Grupos/Segmentos/Categorias novo
 * (função migrarGruposSegmentos, mais abaixo).
 */

// ---------------------------------------------------------------- Constantes

const SHEET_CONFIG = 'Config';
const SHEET_GRUPOS = 'Grupos';
const SHEET_DESPESAS = 'Despesas';
const SHEET_COMPRAS = 'Compras Parceladas';
const SHEET_PAGAMENTOS = 'Pagamentos Parcelas';
const SHEET_SALDOS = 'Saldos';
const SHEET_RESUMO = 'Resumo Mensal';
const SHEET_DASHDATA = 'Dashboard_Data';

// Capacidade / faixa de linhas de dados de cada aba (deve bater com a planilha)
const DESP_START = 3, DESP_END = 122;
const PARC_START = 3, PARC_END = 82;
const PAG_START = 3, PAG_END = 402;
const N_GRUPOS = 8;
const GRUPOS_START = 3, GRUPOS_END = GRUPOS_START + N_GRUPOS - 1; // 3..10
const N_SALDOS = N_GRUPOS * 5;
const SALDOS_START = 7, SALDOS_END = SALDOS_START + N_SALDOS - 1; // 7..46 (grupo x pessoa)
const DASH_START = 2;
const N_DASH = (DESP_END - DESP_START + 1) * 5; // 600

// Colunas (1-based) da aba Despesas — layout novo, com Segmento, Grupo e Participa
// (participação é sempre marcada pessoa a pessoa em cada despesa — nunca herdada
// automaticamente do grupo)
const D_DATA = 1, D_DESC = 2, D_CAT = 3, D_SEG = 4, D_GRUPO = 5, D_VALOR = 6, D_PAGOPOR = 7, D_METODO = 8;
const D_PARTICIPA = [9, 10, 11, 12, 13]; // I..M — quem participa desta despesa (marcado por linha)
const D_DIV = [14, 15, 16, 17, 18];      // N..R — divisão informada por pessoa
const D_DEVIDO = [19, 20, 21, 22, 23];   // S..W — valor devido por pessoa (calculado)
const D_CONFERE = 24;                    // X

// Colunas (1-based) da aba Compras Parceladas — layout novo, com Grupo e Participa
const C_ID = 1, C_DATA = 2, C_DESC = 3, C_CAT = 4, C_GRUPO = 5, C_VALOR = 6, C_COMPRADOR = 7,
      C_NPARC = 8, C_VPARC = 9, C_METODO = 10;
const C_PARTICIPA = [11, 12, 13, 14, 15];
const C_DIV = [16, 17, 18, 19, 20];
const C_DEVIDO = [21, 22, 23, 24, 25];
const C_CONFERE = 26;
const C_PAGO = [27, 28, 29, 30, 31];
const C_SALDODEV = [32, 33, 34, 35, 36];
const C_SALDOTOTAL = 37;
const C_IMPACTO = [38, 39, 40, 41, 42];

// Colunas (1-based) da aba Pagamentos Parcelas (não mudou)
const P_ID = 1, P_DATA = 2, P_COMPRAID = 3, P_DESC = 4, P_PESSOA = 5, P_VALOR = 6, P_PARCELANUM = 7;

// Colunas (1-based) da aba Grupos
const G_NOME = 1, G_TIPO = 2;
const G_MEMBROS = [3, 4, 5, 6, 7]; // um por pessoa (Config!B5..B9)
const G_NMEMBROS = 8;

// Coluna de Email na aba Config (adicionada pela função setupEmailColumn)
const CFG_EMAIL_COL = 3; // C

// Faixas da aba Config
const CFG_CAT_START = 16, CFG_CAT_END = 26;         // 11 categorias
const CFG_METODO_START = 30, CFG_METODO_END = 32;   // 3 métodos
const CFG_SEG_START = 36, CFG_SEG_END = 37;         // 2 segmentos
const CFG_TIPOGRUPO_START = 41, CFG_TIPOGRUPO_END = 42; // 2 tipos de grupo

const CATEGORIAS_NOVAS = ['Aluguel', 'Mercado/Supermercado', 'Lazer', 'Transporte', 'Streaming',
  'Contas de Consumo', 'Saúde', 'Pet', 'Viagem', 'Alimentação', 'Outros'];
const SEGMENTOS = ['Mensais', 'À Vista'];
const TIPOS_GRUPO = ['Compartilhado', 'Pessoal'];

// Categorias antigas -> categoria nova equivalente (usado só na migração, para
// não deixar despesas já lançadas "órfãs" de categoria no Resumo Mensal)
const CATEGORIA_REMAP_ = {
  'Condomínio': 'Aluguel',
  'Água': 'Contas de Consumo',
  'Luz': 'Contas de Consumo',
  'Gás': 'Contas de Consumo',
  'Internet': 'Contas de Consumo',
  'Limpeza': 'Outros',
  'Manutenção': 'Outros'
};

// Login por código enviado por email (OTP)
const OTP_TTL_SECONDS = 300;   // código válido por 5 minutos
const OTP_MAX_TENTATIVAS = 5;

function colLetter_(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

// ---------------------------------------------------------------- Entrada da Web App

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Rachaê')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------- Config

function getConfig() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const names = sh.getRange(5, 2, 5, 1).getValues().map(r => String(r[0]).trim()).filter(String);
  const categorias = sh.getRange(CFG_CAT_START, 1, CFG_CAT_END - CFG_CAT_START + 1, 1)
    .getValues().map(r => String(r[0]).trim()).filter(String);
  const metodos = sh.getRange(CFG_METODO_START, 1, CFG_METODO_END - CFG_METODO_START + 1, 1)
    .getValues().map(r => String(r[0]).trim()).filter(String);
  const segmentos = sh.getRange(CFG_SEG_START, 1, CFG_SEG_END - CFG_SEG_START + 1, 1)
    .getValues().map(r => String(r[0]).trim()).filter(String);
  const emails = sh.getRange(5, CFG_EMAIL_COL, 5, 1).getValues().map(r => String(r[0]).trim());
  const emailsConfigured = emails.some(e => e !== '');
  return { names, categorias, metodos, segmentos, emailsConfigured };
}

/**
 * Rode esta função UMA VEZ pelo editor do Apps Script (selecione
 * "setupEmailColumn" no menu de funções e clique em Executar) para criar a
 * coluna de Email na aba Config, sem mexer em mais nada da planilha.
 * Depois é só preencher os emails de cada morador nas células C5:C9.
 */
function setupEmailColumn() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  sh.getRange(4, CFG_EMAIL_COL).setValue('Email')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6')
    .setHorizontalAlignment('center');
  sh.setColumnWidth(CFG_EMAIL_COL, 190);
  sh.getRange(5, CFG_EMAIL_COL, 5, 1).setBackground('#FFF2CC');
  Logger.log('Coluna de Email criada em Config!C4:C9. Preencha os emails de cada morador.');
}

// ---------------------------------------------------------------- Grupos

function getGrupos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfgSh = ss.getSheetByName(SHEET_CONFIG);
  // mantém as posições (inclusive vazias) para casar com as colunas C..G de Grupos
  const allNames = cfgSh.getRange(5, 2, 5, 1).getValues().map(r => String(r[0]).trim());

  const sh = ss.getSheetByName(SHEET_GRUPOS);
  if (!sh) return [];
  const data = sh.getRange(GRUPOS_START, 1, GRUPOS_END - GRUPOS_START + 1, G_NMEMBROS).getValues();
  const grupos = [];
  data.forEach(row => {
    const nome = String(row[G_NOME - 1] || '').trim();
    if (!nome) return;
    const tipo = row[G_TIPO - 1];
    const membros = [];
    G_MEMBROS.forEach((col, i) => {
      if (row[col - 1] === true && allNames[i]) membros.push(allNames[i]);
    });
    grupos.push({ nome, tipo, membros });
  });
  return grupos;
}

// ---------------------------------------------------------------- Login por email (OTP)

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function findPessoaPorEmail_(email) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const names = sh.getRange(5, 2, 5, 1).getValues().map(r => String(r[0]).trim());
  const emails = sh.getRange(5, CFG_EMAIL_COL, 5, 1).getValues().map(r => normalizeEmail_(r[0]));
  const idx = emails.indexOf(normalizeEmail_(email));
  return (idx >= 0 && names[idx]) ? names[idx] : null;
}

/** Gera e envia o código de acesso por email. */
function iniciarLogin(email) {
  const emailNorm = normalizeEmail_(email);
  if (!emailNorm || emailNorm.indexOf('@') === -1) {
    throw new Error('Digite um email válido.');
  }
  const nome = findPessoaPorEmail_(emailNorm);
  if (!nome) {
    throw new Error('Esse email não está cadastrado. Peça para quem administra a planilha cadastrar seu email na aba Config.');
  }

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const cache = CacheService.getScriptCache();
  cache.put('otp_' + emailNorm, JSON.stringify({ codigo, nome, tentativas: 0 }), OTP_TTL_SECONDS);

  MailApp.sendEmail({
    to: emailNorm,
    subject: 'Seu código de acesso — Rachaê',
    name: 'Rachaê',
    body: 'Olá, ' + nome + '!\n\n' +
      'Seu código de acesso é: ' + codigo + '\n\n' +
      'Ele é válido por 5 minutos. Se você não pediu esse código, pode ignorar este email.'
  });

  return { ok: true };
}

/** Confirma o código de 6 dígitos e retorna o nome da pessoa autenticada. */
function confirmarCodigo(email, codigo) {
  const emailNorm = normalizeEmail_(email);
  const cache = CacheService.getScriptCache();
  const key = 'otp_' + emailNorm;
  const raw = cache.get(key);
  if (!raw) {
    throw new Error('Código expirado ou não solicitado. Peça um novo código.');
  }

  const data = JSON.parse(raw);
  if (data.tentativas >= OTP_MAX_TENTATIVAS) {
    cache.remove(key);
    throw new Error('Muitas tentativas incorretas. Solicite um novo código.');
  }
  if (String(codigo).trim() !== data.codigo) {
    data.tentativas += 1;
    cache.put(key, JSON.stringify(data), OTP_TTL_SECONDS);
    throw new Error('Código incorreto. Confira e tente novamente.');
  }

  cache.remove(key);
  return { ok: true, nome: data.nome };
}

// ---------------------------------------------------------------- Dashboard

/**
 * @param {string} pessoa
 * @param {string=} grupoNome  Se omitido, usa o primeiro grupo do qual a pessoa é membro.
 */
function getDashboard(pessoa, grupoNome) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const grupos = getGrupos();

  if (!grupoNome) {
    const g = grupos.find(g => g.membros.indexOf(pessoa) >= 0);
    grupoNome = g ? g.nome : (grupos[0] ? grupos[0].nome : null);
  }
  const grupoAtual = grupos.find(g => g.nome === grupoNome) || null;

  // Saldos do grupo selecionado (lidos da aba Saldos, já calculados por grupo x pessoa)
  const saldosSh = ss.getSheetByName(SHEET_SALDOS);
  const nSaldos = SALDOS_END - SALDOS_START + 1;
  const saldosData = saldosSh.getRange(SALDOS_START, 1, nSaldos, 8).getValues();
  const saldosPorPessoa = [];
  let pessoal = null;
  saldosData.forEach(row => {
    const [grp, nome, totalPagoAv, totalDevidoAv, saldoAv, saldoParc, saldoGeral, situacao] = row;
    if (!nome || grp !== grupoNome) return;
    const item = {
      nome,
      totalPagoAv: Number(totalPagoAv) || 0,
      totalDevidoAv: Number(totalDevidoAv) || 0,
      saldoAv: Number(saldoAv) || 0,
      saldoParc: Number(saldoParc) || 0,
      saldoGeral: Number(saldoGeral) || 0,
      situacao: situacao || ''
    };
    saldosPorPessoa.push(item);
    if (nome === pessoa) pessoal = item;
  });

  // Gastos por categoria, evolução mensal e categoria-por-mês, restritos ao grupo selecionado
  const catTotals = {};
  const monthTotals = {};
  const catPorMesTotals = {}; // { 'yyyy-MM': { categoria: valorAcumulado } }

  function acumulaGasto_(cat, valor, data) {
    catTotals[cat] = (catTotals[cat] || 0) + valor;
    if (data instanceof Date) {
      const key = Utilities.formatDate(data, tz, 'yyyy-MM');
      monthTotals[key] = (monthTotals[key] || 0) + valor;
      if (!catPorMesTotals[key]) catPorMesTotals[key] = {};
      catPorMesTotals[key][cat] = (catPorMesTotals[key][cat] || 0) + valor;
    }
  }

  const despSh = ss.getSheetByName(SHEET_DESPESAS);
  const despValues = despSh.getRange(DESP_START, 1, DESP_END - DESP_START + 1, D_VALOR).getValues();
  despValues.forEach(row => {
    const desc = row[D_DESC - 1], cat = row[D_CAT - 1], grp = row[D_GRUPO - 1],
          valor = row[D_VALOR - 1], data = row[D_DATA - 1];
    if (!desc || grp !== grupoNome) return;
    acumulaGasto_(cat, Number(valor) || 0, data);
  });

  // Lê Compras Parceladas até a coluna Comprador — precisamos dela para depois
  // atribuir os reembolsos (Pagamentos Parcelas) a quem recebeu, não só a
  // quem pagou.
  const comprasSh = ss.getSheetByName(SHEET_COMPRAS);
  const comprasValuesBasic = comprasSh.getRange(PARC_START, 1, PARC_END - PARC_START + 1, C_COMPRADOR).getValues();
  const compradorPorId_ = {}; // só compras do grupo selecionado
  comprasValuesBasic.forEach(row => {
    const id = row[C_ID - 1], desc = row[C_DESC - 1], cat = row[C_CAT - 1], grp = row[C_GRUPO - 1],
          valor = row[C_VALOR - 1], data = row[C_DATA - 1], comprador = row[C_COMPRADOR - 1];
    if (!desc || grp !== grupoNome) return;
    acumulaGasto_(cat, Number(valor) || 0, data);
    if (id) compradorPorId_[id] = comprador;
  });

  const gastosPorCategoria = Object.keys(catTotals)
    .map(cat => ({ categoria: cat, valor: Math.round(catTotals[cat] * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);

  const evolucaoMensal = Object.keys(monthTotals).sort().map(mes => ({
    mes, valor: Math.round(monthTotals[mes] * 100) / 100
  }));

  // Categorias por mês (para o gráfico de pizza "principais categorias do mês
  // escolhido") — { 'yyyy-MM': [{categoria, valor}, ...] ordenado desc }
  const catPorMes = {};
  Object.keys(catPorMesTotals).forEach(mes => {
    catPorMes[mes] = Object.keys(catPorMesTotals[mes])
      .map(cat => ({ categoria: cat, valor: Math.round(catPorMesTotals[mes][cat] * 100) / 100 }))
      .sort((a, b) => b.valor - a.valor);
  });

  // Reembolsos recebidos por pessoa: soma dos pagamentos de parcelas (aba
  // Pagamentos Parcelas) atribuídos a quem comprou no cartão daquela compra
  // (ou seja, quem "recebeu" o reembolso dos pares), restrito ao grupo atual.
  const reembolsosTotals = {};
  (grupoAtual ? grupoAtual.membros : []).forEach(nome => { reembolsosTotals[nome] = 0; });
  const pagSh = ss.getSheetByName(SHEET_PAGAMENTOS);
  const pagValues = pagSh.getRange(PAG_START, 1, PAG_END - PAG_START + 1, P_VALOR).getValues();
  pagValues.forEach(row => {
    const compraId = row[P_COMPRAID - 1], pessoaPagou = row[P_PESSOA - 1], valor = Number(row[P_VALOR - 1]) || 0;
    if (!compraId) return;
    const recebedor = compradorPorId_[compraId];
    if (!recebedor || recebedor === pessoaPagou) return; // ignora auto-pagamento (não é reembolso entre pares)
    reembolsosTotals[recebedor] = (reembolsosTotals[recebedor] || 0) + valor;
  });
  const reembolsosPorPessoa = Object.keys(reembolsosTotals)
    .map(nome => ({ nome, valor: Math.round(reembolsosTotals[nome] * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);

  // Compras parceladas em aberto do grupo, para a pessoa logada
  const comprasEmAberto = [];
  const personIdx = getConfig().names.indexOf(pessoa);
  if (personIdx >= 0) {
    const lastCol = C_IMPACTO[C_IMPACTO.length - 1];
    const comprasFull = comprasSh.getRange(PARC_START, 1, PARC_END - PARC_START + 1, lastCol).getValues();
    comprasFull.forEach(row => {
      const id = row[C_ID - 1], desc = row[C_DESC - 1], grp = row[C_GRUPO - 1];
      if (!desc || grp !== grupoNome) return;
      const saldoDev = Number(row[C_SALDODEV[personIdx] - 1]) || 0;
      if (saldoDev > 0.01) {
        comprasEmAberto.push({ id, descricao: desc, saldoDevedor: Math.round(saldoDev * 100) / 100 });
      }
    });
  }

  return {
    grupoAtual: grupoNome,
    grupos: grupos.map(g => ({ nome: g.nome, tipo: g.tipo })),
    pessoal,
    saldosPorPessoa,
    gastosPorCategoria,
    evolucaoMensal,
    catPorMes,
    reembolsosPorPessoa,
    comprasEmAberto,
    totalAvulsas: saldosPorPessoa.reduce((s, p) => s + p.totalPagoAv, 0)
  };
}

function getComprasParaPagamento(pessoa, grupoNome) {
  return getDashboard(pessoa, grupoNome).comprasEmAberto;
}

// ---------------------------------------------------------------- Histórico

/** @param {string=} grupoNome  Se omitido, traz o histórico de todos os grupos. */
function getHistorico(grupoNome) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();

  const despSh = ss.getSheetByName(SHEET_DESPESAS);
  const despValues = despSh.getRange(DESP_START, 1, DESP_END - DESP_START + 1, D_METODO).getValues();
  const despesas = despValues
    .map((r, i) => ({ r, row: DESP_START + i }))
    .filter(x => x.r[D_DESC - 1] && (!grupoNome || x.r[D_GRUPO - 1] === grupoNome))
    .map(x => { const r = x.r; return {
      row: x.row,
      data: r[D_DATA - 1] instanceof Date ? Utilities.formatDate(r[D_DATA - 1], tz, 'dd/MM/yyyy') : '',
      descricao: r[D_DESC - 1], categoria: r[D_CAT - 1], segmento: r[D_SEG - 1], grupo: r[D_GRUPO - 1],
      valor: r[D_VALOR - 1], pagoPor: r[D_PAGOPOR - 1], metodo: r[D_METODO - 1]
    }; }).reverse();

  const comprasSh = ss.getSheetByName(SHEET_COMPRAS);
  const comprasValues = comprasSh.getRange(PARC_START, 1, PARC_END - PARC_START + 1, C_SALDOTOTAL).getValues();
  const compras = comprasValues
    .filter(r => r[C_DESC - 1] && (!grupoNome || r[C_GRUPO - 1] === grupoNome))
    .map(r => ({
      id: r[C_ID - 1],
      data: r[C_DATA - 1] instanceof Date ? Utilities.formatDate(r[C_DATA - 1], tz, 'dd/MM/yyyy') : '',
      descricao: r[C_DESC - 1], categoria: r[C_CAT - 1], grupo: r[C_GRUPO - 1], valorTotal: r[C_VALOR - 1],
      comprador: r[C_COMPRADOR - 1], nParcelas: r[C_NPARC - 1],
      saldoTotal: r[C_SALDOTOTAL - 1]
    })).reverse();

  let compraIdsDoGrupo = null;
  if (grupoNome) {
    compraIdsDoGrupo = {};
    comprasValues.forEach(r => {
      if (r[C_DESC - 1] && r[C_GRUPO - 1] === grupoNome) compraIdsDoGrupo[r[C_ID - 1]] = true;
    });
  }

  const pagSh = ss.getSheetByName(SHEET_PAGAMENTOS);
  const pagValues = pagSh.getRange(PAG_START, 1, PAG_END - PAG_START + 1, P_DESC).getValues();
  const pagamentos = pagValues
    .filter(r => r[P_COMPRAID - 1] && (!compraIdsDoGrupo || compraIdsDoGrupo[r[P_COMPRAID - 1]]))
    .map(r => ({
      data: r[P_DATA - 1] instanceof Date ? Utilities.formatDate(r[P_DATA - 1], tz, 'dd/MM/yyyy') : '',
      compraId: r[P_COMPRAID - 1], descricao: r[P_DESC - 1], pessoa: r[P_PESSOA - 1], valor: r[P_VALOR - 1]
    })).reverse();

  return {
    despesas: despesas.slice(0, 30),
    compras: compras.slice(0, 30),
    pagamentos: pagamentos.slice(0, 30)
  };
}

// ---------------------------------------------------------------- Escrita (formulários)

function findFirstBlankRow_(sheet, col, start, end) {
  const values = sheet.getRange(start, col, end - start + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v === '' || v === null || v === undefined) return start + i;
  }
  return -1;
}

function parseDate_(str) {
  if (!str) return new Date();
  const parts = String(str).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function validarPayloadBasico_(payload, campos) {
  campos.forEach(c => {
    if (payload[c] === undefined || payload[c] === null || payload[c] === '') {
      throw new Error('Preencha o campo obrigatório: ' + c);
    }
  });
}

function addDespesa(payload) {
  validarPayloadBasico_(payload, ['data', 'descricao', 'categoria', 'segmento', 'grupo', 'valorTotal', 'pagoPor', 'metodo']);
  if (!Array.isArray(payload.participantes) || payload.participantes.length === 0) {
    throw new Error('Marque pelo menos uma pessoa em "Quem participa desta despesa?".');
  }
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DESPESAS);
  const row = findFirstBlankRow_(sh, D_DESC, DESP_START, DESP_END);
  if (row === -1) throw new Error('A aba Despesas está cheia (capacidade esgotada). Avise quem administra a planilha.');

  sh.getRange(row, D_DATA).setValue(parseDate_(payload.data));
  sh.getRange(row, D_DESC).setValue(payload.descricao);
  sh.getRange(row, D_CAT).setValue(payload.categoria);
  sh.getRange(row, D_SEG).setValue(payload.segmento);
  sh.getRange(row, D_GRUPO).setValue(payload.grupo);
  sh.getRange(row, D_VALOR).setValue(Number(payload.valorTotal));
  sh.getRange(row, D_PAGOPOR).setValue(payload.pagoPor);
  sh.getRange(row, D_METODO).setValue(payload.metodo);

  const names = getConfig().names;
  D_PARTICIPA.forEach((col, i) => {
    const nome = names[i];
    const participa = !!nome && payload.participantes.indexOf(nome) !== -1;
    sh.getRange(row, col).setValue(participa);
  });

  if (payload.divisao) {
    D_DIV.forEach((col, i) => {
      const nome = names[i];
      const v = nome ? payload.divisao[nome] : undefined;
      if (v !== undefined && v !== '' && v !== null) sh.getRange(row, col).setValue(Number(v));
    });
  }
  SpreadsheetApp.flush();
  return { ok: true, row };
}

function addCompraParcelada(payload) {
  validarPayloadBasico_(payload, ['data', 'descricao', 'categoria', 'grupo', 'valorTotal', 'comprador', 'nParcelas', 'metodo']);
  if (!Array.isArray(payload.participantes) || payload.participantes.length === 0) {
    throw new Error('Marque pelo menos uma pessoa em "Quem participa desta compra?".');
  }
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COMPRAS);
  const row = findFirstBlankRow_(sh, C_DESC, PARC_START, PARC_END);
  if (row === -1) throw new Error('A aba Compras Parceladas está cheia. Avise quem administra a planilha.');

  sh.getRange(row, C_DATA).setValue(parseDate_(payload.data));
  sh.getRange(row, C_DESC).setValue(payload.descricao);
  sh.getRange(row, C_CAT).setValue(payload.categoria);
  sh.getRange(row, C_GRUPO).setValue(payload.grupo);
  sh.getRange(row, C_VALOR).setValue(Number(payload.valorTotal));
  sh.getRange(row, C_COMPRADOR).setValue(payload.comprador);
  sh.getRange(row, C_NPARC).setValue(Number(payload.nParcelas));
  sh.getRange(row, C_METODO).setValue(payload.metodo);

  const names = getConfig().names;
  C_PARTICIPA.forEach((col, i) => {
    const nome = names[i];
    const participa = !!nome && payload.participantes.indexOf(nome) !== -1;
    sh.getRange(row, col).setValue(participa);
  });

  if (payload.divisao) {
    C_DIV.forEach((col, i) => {
      const nome = names[i];
      const v = nome ? payload.divisao[nome] : undefined;
      if (v !== undefined && v !== '' && v !== null) sh.getRange(row, col).setValue(Number(v));
    });
  }
  SpreadsheetApp.flush();
  const id = sh.getRange(row, C_ID).getValue();
  return { ok: true, row, id };
}

function addPagamento(payload) {
  validarPayloadBasico_(payload, ['data', 'compraId', 'pessoa', 'valor']);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PAGAMENTOS);
  const row = findFirstBlankRow_(sh, P_COMPRAID, PAG_START, PAG_END);
  if (row === -1) throw new Error('A aba Pagamentos Parcelas está cheia. Avise quem administra a planilha.');

  sh.getRange(row, P_DATA).setValue(parseDate_(payload.data));
  sh.getRange(row, P_COMPRAID).setValue(payload.compraId);
  sh.getRange(row, P_PESSOA).setValue(payload.pessoa);
  sh.getRange(row, P_VALOR).setValue(Number(payload.valor));
  if (payload.parcelaNum) sh.getRange(row, P_PARCELANUM).setValue(Number(payload.parcelaNum));

  SpreadsheetApp.flush();
  return { ok: true, row };
}

// ---------------------------------------------------------------- Migração (Grupos/Segmentos)

/**
 * Migração para o modelo de Grupos, Segmentos e Categorias novo. Rode esta
 * função UMA VEZ pelo editor do Apps Script (selecione "migrarGruposSegmentos"
 * no menu de funções e clique em Executar).
 *
 * É SEGURA para rodar mais de uma vez (idempotente): se detectar que a
 * planilha já foi migrada (Despesas!D2 já é "Segmento"), ela não faz nada.
 *
 * O que ela faz, em ordem:
 *  1. Remapeia categorias antigas (Água, Luz, Gás, Internet, Condomínio,
 *     Limpeza, Manutenção) para a categoria nova equivalente, nas despesas
 *     e compras já lançadas — para não "perder" essas linhas no Resumo Mensal.
 *  2. Atualiza a aba Config: nova lista de categorias, segmentos e tipos de grupo.
 *  3. Cria a aba Grupos com um grupo "Casa" contendo todo mundo que já estava
 *     cadastrado — preserva o comportamento antigo (todo mundo dividia tudo).
 *  4. Insere as colunas Segmento e Grupo na aba Despesas (todas as despesas já
 *     lançadas ficam com Segmento="À Vista" e Grupo="Casa" por padrão) e
 *     reescreve as fórmulas de "valor devido" para levar o grupo em conta.
 *  5. Insere a coluna Grupo na aba Compras Parceladas (idem) e reescreve as
 *     fórmulas de "valor devido".
 *  6. Reconstrói do zero as abas Saldos, Dashboard_Data e Resumo Mensal (são
 *     100% calculadas, não têm dado nenhum digitado pelo usuário).
 *
 * As inserções de coluna usam insertColumnsBefore/insertColumnBefore, que é a
 * mesma operação estrutural que o menu do Google Sheets usa — por isso TODAS
 * as fórmulas da planilha inteira que apontavam para as colunas empurradas se
 * ajustam sozinhas, sem precisar reescrever nada manualmente.
 */
function migrarGruposSegmentos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const despSh = ss.getSheetByName(SHEET_DESPESAS);

  if (String(despSh.getRange(2, 4).getValue()).trim() === 'Segmento') {
    Logger.log('Esta planilha já foi migrada para o modelo de Grupos/Segmentos. Nada a fazer.');
    return;
  }

  Logger.log('Iniciando migração para Grupos/Segmentos/Categorias...');

  remapCategoriasAntigas_(despSh, 3, DESP_START, DESP_END); // categoria era coluna C
  const comprasSh0 = ss.getSheetByName(SHEET_COMPRAS);
  remapCategoriasAntigas_(comprasSh0, 4, PARC_START, PARC_END); // categoria era coluna D

  migrarConfig_(ss);
  criarAbaGrupos_(ss);
  migrarDespesas_(ss);
  migrarComprasParceladas_(ss);

  rebuildSaldos_(ss);
  rebuildDashboardData_(ss);
  rebuildResumoMensal_(ss);

  SpreadsheetApp.flush();
  Logger.log('Migração concluída com sucesso. Confira as abas Config, Grupos, Despesas, ' +
    'Compras Parceladas, Saldos, Resumo Mensal e Dashboard_Data.');
}

function remapCategoriasAntigas_(sh, catCol, start, end) {
  const n = end - start + 1;
  const range = sh.getRange(start, catCol, n, 1);
  const values = range.getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    const v = String(values[i][0] || '').trim();
    if (CATEGORIA_REMAP_[v]) {
      values[i][0] = CATEGORIA_REMAP_[v];
      changed = true;
    }
  }
  if (changed) range.setValues(values);
}

function migrarConfig_(ss) {
  const sh = ss.getSheetByName(SHEET_CONFIG);

  // Categorias: limpa a faixa antiga (16:25, 10 categorias) e escreve a nova
  // lista mesclada (16:26, 11 categorias)
  sh.getRange(16, 1, 10, 1).clearContent();
  const catRows = CATEGORIAS_NOVAS.map(c => [c]);
  const catRange = sh.getRange(CFG_CAT_START, 1, catRows.length, 1);
  catRange.setValues(catRows);
  catRange.setBorder(true, true, true, true, true, true);

  // 5. Segmentos de despesa
  sh.getRange('A34').setValue('5. Segmentos de despesa').setFontWeight('bold').setFontColor('#1F4E78');
  sh.getRange('A35').setValue('Segmento')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  SEGMENTOS.forEach((s, i) => sh.getRange(CFG_SEG_START + i, 1).setValue(s));

  // 6. Tipos de grupo
  sh.getRange('A39').setValue('6. Tipos de grupo').setFontWeight('bold').setFontColor('#1F4E78');
  sh.getRange('A40').setValue('Tipo')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  TIPOS_GRUPO.forEach((t, i) => sh.getRange(CFG_TIPOGRUPO_START + i, 1).setValue(t));

  Logger.log('Config atualizada: categorias mescladas, segmentos e tipos de grupo adicionados.');
}

function criarAbaGrupos_(ss) {
  let sh = ss.getSheetByName(SHEET_GRUPOS);
  if (sh) {
    Logger.log('Aba Grupos já existe — pulando criação.');
    return;
  }
  const cfgSh = ss.getSheetByName(SHEET_CONFIG);
  sh = ss.insertSheet(SHEET_GRUPOS, cfgSh.getIndex());

  sh.getRange(1, 1, 1, G_NMEMBROS).merge()
    .setValue('GRUPOS — quem compartilha despesas com quem')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E78').setHorizontalAlignment('center');
  sh.setRowHeight(1, 26);

  sh.getRange(2, G_NOME).setValue('Nome do Grupo');
  sh.getRange(2, G_TIPO).setValue('Tipo');
  G_MEMBROS.forEach((col, i) => sh.getRange(2, col).setFormula(`=Config!$B$${5 + i}`));
  sh.getRange(2, G_NMEMBROS).setValue('Nº de Membros');
  sh.getRange(2, 1, 1, G_NMEMBROS)
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');

  // Grupo "Casa" com todo mundo que já estava cadastrado — preserva o
  // comportamento antigo (todo mundo dividia todas as despesas)
  const names = cfgSh.getRange(5, 2, 5, 1).getValues().map(r => String(r[0]).trim());
  sh.getRange(GRUPOS_START, G_NOME).setValue('Casa');
  sh.getRange(GRUPOS_START, G_TIPO).setValue('Compartilhado');
  G_MEMBROS.forEach((col, i) => sh.getRange(GRUPOS_START, col).setValue(!!names[i]));

  for (let i = 0; i < N_GRUPOS; i++) {
    const r = GRUPOS_START + i;
    const rng = `${colLetter_(G_MEMBROS[0])}${r}:${colLetter_(G_MEMBROS[G_MEMBROS.length - 1])}${r}`;
    sh.getRange(r, G_NMEMBROS).setFormula(`=IF(A${r}="","",SUM(${rng}))`);
  }

  const dvTipo = SpreadsheetApp.newDataValidation()
    .requireValueInRange(cfgSh.getRange(CFG_TIPOGRUPO_START, 1, TIPOS_GRUPO.length, 1), true)
    .setAllowInvalid(true).build();
  sh.getRange(GRUPOS_START, G_TIPO, N_GRUPOS, 1).setDataValidation(dvTipo);

  const dvBool = SpreadsheetApp.newDataValidation()
    .requireValueInList(['VERDADEIRO', 'FALSO'], true).setAllowInvalid(true).build();
  G_MEMBROS.forEach(col => sh.getRange(GRUPOS_START, col, N_GRUPOS, 1).setDataValidation(dvBool));

  sh.setColumnWidth(G_NOME, 160);
  sh.setColumnWidth(G_TIPO, 130);
  sh.setColumnWidth(G_NMEMBROS, 110);
  G_MEMBROS.forEach(col => sh.setColumnWidth(col, 90));
  sh.setFrozenRows(2);

  Logger.log('Aba Grupos criada com o grupo "Casa" (todos os participantes atuais).');
}

function migrarDespesas_(ss) {
  const sh = ss.getSheetByName(SHEET_DESPESAS);

  // Insere 2 colunas antes da antiga coluna D (Valor Total) — empurra D:Q
  // para F:S; todas as fórmulas de toda a planilha se ajustam sozinhas.
  sh.insertColumnsBefore(4, 2);

  sh.getRange(2, D_SEG).setValue('Segmento')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  sh.getRange(2, D_GRUPO).setValue('Grupo')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  sh.setColumnWidth(D_SEG, 100);
  sh.setColumnWidth(D_GRUPO, 130);
  sh.getRange(1, D_DATA).setValue('Detalhes da despesa');

  const n = DESP_END - DESP_START + 1;
  const descValues = sh.getRange(DESP_START, D_DESC, n, 1).getValues();
  const segValues = descValues.map(r => [r[0] ? 'À Vista' : '']);
  const grupoValues = descValues.map(r => [r[0] ? 'Casa' : '']);
  sh.getRange(DESP_START, D_SEG, n, 1).setValues(segValues);
  sh.getRange(DESP_START, D_GRUPO, n, 1).setValues(grupoValues);

  const cfgSh = ss.getSheetByName(SHEET_CONFIG);
  const dvSeg = SpreadsheetApp.newDataValidation()
    .requireValueInRange(cfgSh.getRange(CFG_SEG_START, 1, SEGMENTOS.length, 1), true)
    .setAllowInvalid(true).build();
  sh.getRange(DESP_START, D_SEG, n, 1).setDataValidation(dvSeg);

  const gruposSh = ss.getSheetByName(SHEET_GRUPOS);
  const dvGrupo = SpreadsheetApp.newDataValidation()
    .requireValueInRange(gruposSh.getRange(GRUPOS_START, G_NOME, N_GRUPOS, 1), true)
    .setAllowInvalid(true).build();
  sh.getRange(DESP_START, D_GRUPO, n, 1).setDataValidation(dvGrupo);

  // Reescreve "Valor devido por pessoa" e "Confere?" levando o grupo em conta.
  // Neste ponto (logo após inserir só Segmento/Grupo) a planilha ainda está no
  // esquema INTERMEDIÁRIO "grupos-only" — Divisão/Devido/Confere ainda não
  // têm as colunas de Participa individual (isso vem depois, em
  // migrarParticipantesDespesas_). Por isso usamos literais locais fixos em
  // vez das constantes globais D_DIV/D_DEVIDO/D_CONFERE, que já apontam para
  // o esquema FINAL (pós-participantes).
  const OLD_D_DIV = [9, 10, 11, 12, 13];
  const OLD_D_DEVIDO = [14, 15, 16, 17, 18];
  const OLD_D_CONFERE = 19;

  const formulasDevido = [];
  const formulasConfere = [];
  const dDescCol = colLetter_(D_DESC), dMetodoCol = colLetter_(D_METODO), dValorCol = colLetter_(D_VALOR),
        dGrupoCol = colLetter_(D_GRUPO), dDevidoFirst = colLetter_(OLD_D_DEVIDO[0]), dDevidoLast = colLetter_(OLD_D_DEVIDO[OLD_D_DEVIDO.length - 1]);
  for (let i = 0; i < n; i++) {
    const r = DESP_START + i;
    const descRef = `${dDescCol}${r}`, metodoRef = `${dMetodoCol}${r}`, valorRef = `${dValorCol}${r}`, grupoRef = `${dGrupoCol}${r}`;
    const rowFormulas = [];
    for (let p = 0; p < 5; p++) {
      const divCol = colLetter_(OLD_D_DIV[p]);
      const nameRow = 5 + p;
      const membroCol = colLetter_(G_MEMBROS[p]);
      const membroRange = `Grupos!$${membroCol}$${GRUPOS_START}:$${membroCol}$${GRUPOS_END}`;
      const nmembrosRange = `Grupos!$${colLetter_(G_NMEMBROS)}$${GRUPOS_START}:$${colLetter_(G_NMEMBROS)}$${GRUPOS_END}`;
      const grupoRefFull = `Grupos!$A$${GRUPOS_START}:$A$${GRUPOS_END}`;
      const ehMembro = `IFERROR(INDEX(${membroRange},MATCH(${grupoRef},${grupoRefFull},0)),FALSE)`;
      const nMembros = `IFERROR(INDEX(${nmembrosRange},MATCH(${grupoRef},${grupoRefFull},0)),1)`;
      rowFormulas.push(
        `=IF(${descRef}="","",IF(${ehMembro}=FALSE,0,` +
        `IF(Config!$B$${nameRow}="",0,` +
        `IF(${metodoRef}="Igual",${valorRef}/${nMembros},` +
        `IF(${metodoRef}="Porcentagem",${valorRef}*${divCol}${r},` +
        `IF(${metodoRef}="Valor customizado",${divCol}${r},0))))))`
      );
    }
    formulasDevido.push(rowFormulas);
    formulasConfere.push([`=IF(${descRef}="","",IF(ROUND(SUM(${dDevidoFirst}${r}:${dDevidoLast}${r})-${valorRef},2)=0,"OK","Verificar"))`]);
  }
  sh.getRange(DESP_START, OLD_D_DEVIDO[0], n, 5).setFormulas(formulasDevido);
  sh.getRange(DESP_START, OLD_D_CONFERE, n, 1).setFormulas(formulasConfere);

  Logger.log('Despesas migrada: colunas Segmento/Grupo adicionadas, ' + n + ' linhas de fórmula reescritas.');
}

function migrarComprasParceladas_(ss) {
  const sh = ss.getSheetByName(SHEET_COMPRAS);

  // Insere 1 coluna antes da antiga coluna E (Valor Total) — empurra E:AJ
  // para F:AK; todas as fórmulas de toda a planilha se ajustam sozinhas.
  sh.insertColumnsBefore(5, 1);

  sh.getRange(2, C_GRUPO).setValue('Grupo')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  sh.setColumnWidth(C_GRUPO, 130);
  sh.getRange(1, C_ID).setValue('Detalhes da compra parcelada');

  const n = PARC_END - PARC_START + 1;
  const descValues = sh.getRange(PARC_START, C_DESC, n, 1).getValues();
  const grupoValues = descValues.map(r => [r[0] ? 'Casa' : '']);
  sh.getRange(PARC_START, C_GRUPO, n, 1).setValues(grupoValues);

  const gruposSh = ss.getSheetByName(SHEET_GRUPOS);
  const dvGrupo = SpreadsheetApp.newDataValidation()
    .requireValueInRange(gruposSh.getRange(GRUPOS_START, G_NOME, N_GRUPOS, 1), true)
    .setAllowInvalid(true).build();
  sh.getRange(PARC_START, C_GRUPO, n, 1).setDataValidation(dvGrupo);

  // Mesma observação de migrarDespesas_: neste ponto a planilha ainda está no
  // esquema INTERMEDIÁRIO "grupos-only" (sem as colunas de Participa
  // individual), então usamos literais locais fixos em vez das constantes
  // globais C_DIV/C_DEVIDO, que já apontam para o esquema FINAL.
  const OLD_C_DIV = [11, 12, 13, 14, 15];
  const OLD_C_DEVIDO = [16, 17, 18, 19, 20];

  const formulasDevido = [];
  const cDescCol = colLetter_(C_DESC), cMetodoCol = colLetter_(C_METODO), cValorCol = colLetter_(C_VALOR),
        cGrupoCol = colLetter_(C_GRUPO);
  for (let i = 0; i < n; i++) {
    const r = PARC_START + i;
    const descRef = `${cDescCol}${r}`, metodoRef = `${cMetodoCol}${r}`, valorRef = `${cValorCol}${r}`, grupoRef = `${cGrupoCol}${r}`;
    const rowFormulas = [];
    for (let p = 0; p < 5; p++) {
      const divCol = colLetter_(OLD_C_DIV[p]);
      const nameRow = 5 + p;
      const membroCol = colLetter_(G_MEMBROS[p]);
      const membroRange = `Grupos!$${membroCol}$${GRUPOS_START}:$${membroCol}$${GRUPOS_END}`;
      const nmembrosRange = `Grupos!$${colLetter_(G_NMEMBROS)}$${GRUPOS_START}:$${colLetter_(G_NMEMBROS)}$${GRUPOS_END}`;
      const grupoRefFull = `Grupos!$A$${GRUPOS_START}:$A$${GRUPOS_END}`;
      const ehMembro = `IFERROR(INDEX(${membroRange},MATCH(${grupoRef},${grupoRefFull},0)),FALSE)`;
      const nMembros = `IFERROR(INDEX(${nmembrosRange},MATCH(${grupoRef},${grupoRefFull},0)),1)`;
      rowFormulas.push(
        `=IF(${descRef}="","",IF(${ehMembro}=FALSE,0,` +
        `IF(Config!$B$${nameRow}="",0,` +
        `IF(${metodoRef}="Igual",${valorRef}/${nMembros},` +
        `IF(${metodoRef}="Porcentagem",${valorRef}*${divCol}${r},` +
        `IF(${metodoRef}="Valor customizado",${divCol}${r},0))))))`
      );
    }
    formulasDevido.push(rowFormulas);
  }
  sh.getRange(PARC_START, OLD_C_DEVIDO[0], n, 5).setFormulas(formulasDevido);

  Logger.log('Compras Parceladas migrada: coluna Grupo adicionada, ' + n + ' linhas de fórmula reescritas.');
}

// ------------------------------------------------- Migração (Participantes individuais)

/**
 * Lê a aba Grupos e devolve um mapa { nomeDoGrupo: [bool, bool, bool, bool, bool] }
 * (um booleano por pessoa, na mesma ordem de Config!B5:B9), indicando quem é
 * membro de cada grupo. Usado para "preencher" as participações das despesas
 * e compras já lançadas antes da migração (ver migrarParticipantesIndividuais).
 */
function getGrupoMembroMatriz_(ss) {
  const sh = ss.getSheetByName(SHEET_GRUPOS);
  const map = {};
  if (!sh) return map;
  const data = sh.getRange(GRUPOS_START, 1, GRUPOS_END - GRUPOS_START + 1, G_NMEMBROS).getValues();
  data.forEach(row => {
    const nome = String(row[G_NOME - 1] || '').trim();
    if (!nome) return;
    map[nome] = G_MEMBROS.map(col => row[col - 1] === true);
  });
  return map;
}

/**
 * Migração para o modelo de "participação individual por despesa". Rode esta
 * função UMA VEZ pelo editor do Apps Script (selecione
 * "migrarParticipantesIndividuais" no menu de funções e clique em Executar).
 *
 * É SEGURA para rodar mais de uma vez (idempotente): se detectar que a
 * planilha já foi migrada (Despesas!I2 já começa com "Participa: "), ela não
 * faz nada.
 *
 * O que ela faz, em ordem:
 *  1. Roda migrarGruposSegmentos() primeiro, caso ainda não tenha rodado
 *     (também idempotente — não faz nada se já migrado).
 *  2. Insere 5 colunas "Participa" em Despesas e em Compras Parceladas — uma
 *     por pessoa — ANTES das colunas de divisão. Para as linhas já lançadas,
 *     marca VERDADEIRO para quem já era membro do grupo daquela linha
 *     (preserva exatamente o valor devido que já estava calculado). Dali em
 *     diante, toda despesa/compra nova exige marcar pessoa a pessoa quem
 *     participa — nunca assume "todo mundo do grupo" por padrão.
 *  3. Reescreve as fórmulas de "valor devido" (Despesas e Compras Parceladas)
 *     para dividir apenas entre quem está marcado como participante daquela
 *     linha (em vez de dividir pelo total de membros do grupo).
 *  4. Reconstrói as abas Saldos e Dashboard_Data (100% calculadas).
 *
 * Assim como nas outras migrações, usa insertColumnsBefore — a mesma operação
 * estrutural do menu do Google Sheets — então todas as fórmulas e validações
 * de dados que apontavam para as colunas empurradas se ajustam sozinhas.
 */
function migrarParticipantesIndividuais() {
  migrarGruposSegmentos(); // idempotente — não faz nada se já migrado

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const despSh = ss.getSheetByName(SHEET_DESPESAS);

  if (String(despSh.getRange(2, D_PARTICIPA[0]).getValue()).indexOf('Participa: ') === 0) {
    Logger.log('Esta planilha já foi migrada para participação individual por despesa. Nada a fazer.');
    return;
  }

  Logger.log('Iniciando migração para participação individual por despesa...');

  const grupoMatriz = getGrupoMembroMatriz_(ss);

  migrarParticipantesDespesas_(ss, grupoMatriz);
  migrarParticipantesComprasParceladas_(ss, grupoMatriz);

  rebuildSaldos_(ss);
  rebuildDashboardData_(ss);

  SpreadsheetApp.flush();
  Logger.log('Migração concluída com sucesso. A partir de agora, cada despesa/compra exige marcar ' +
    'pessoa a pessoa quem participa — nunca é atribuído a todo mundo do grupo por padrão.');
}

function migrarParticipantesDespesas_(ss, grupoMatriz) {
  const sh = ss.getSheetByName(SHEET_DESPESAS);

  // Insere 5 colunas antes da antiga coluna de Divisão (I) — empurra I em
  // diante; todas as fórmulas da planilha inteira se ajustam sozinhas. Como a
  // inserção é na BORDA do merge de "Divisão informada...", o merge inteiro é
  // deslocado (sem expandir) — por isso criamos um merge novo para o cabeçalho
  // das colunas de Participa, abaixo.
  sh.insertColumnsBefore(D_PARTICIPA[0], D_PARTICIPA.length);

  sh.getRange(1, D_PARTICIPA[0], 1, D_PARTICIPA.length).merge()
    .setValue('Quem participa desta despesa? (marque pessoa a pessoa — nunca é automático)')
    .setFontWeight('bold').setFontColor('#1F4E78').setBackground('#BDD7EE').setHorizontalAlignment('center');

  const cfgNameCells = [5, 6, 7, 8, 9].map(r => `Config!$B$${r}`);
  D_PARTICIPA.forEach((col, i) => {
    sh.getRange(2, col).setFormula(`="Participa: "&${cfgNameCells[i]}`)
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
    sh.setColumnWidth(col, 100);
  });

  // Backfill das linhas já lançadas: marca VERDADEIRO para quem já era membro
  // do grupo daquela linha — preserva exatamente o valor devido que já estava
  // calculado (dividir entre "quem participa" = dividir entre "todo mundo do
  // grupo", igual era antes).
  const n = DESP_END - DESP_START + 1;
  const descValues = sh.getRange(DESP_START, D_DESC, n, 1).getValues();
  const grupoValues = sh.getRange(DESP_START, D_GRUPO, n, 1).getValues();
  const participaValues = [];
  for (let i = 0; i < n; i++) {
    const temDados = !!descValues[i][0];
    const grupo = String(grupoValues[i][0] || '').trim();
    const membros = temDados && grupoMatriz[grupo] ? grupoMatriz[grupo] : [false, false, false, false, false];
    participaValues.push(membros);
  }
  sh.getRange(DESP_START, D_PARTICIPA[0], n, D_PARTICIPA.length).setValues(participaValues);

  const dvParticipa = SpreadsheetApp.newDataValidation()
    .requireValueInList(['VERDADEIRO', 'FALSO'], true).setAllowInvalid(true).build();
  D_PARTICIPA.forEach(col => sh.getRange(DESP_START, col, n, 1).setDataValidation(dvParticipa)
    .setBackground('#FFF2CC'));

  // Reescreve "Valor devido por pessoa" e "Confere?" para dividir só entre
  // quem está marcado como participante da linha (nunca todo o grupo por
  // padrão), com uma proteção extra: se a pessoa não é mais membro do grupo,
  // o valor devido dela vai a zero mesmo que a marcação de Participa tenha
  // ficado desatualizada.
  const formulasDevido = [];
  const formulasConfere = [];
  const dDescCol = colLetter_(D_DESC), dMetodoCol = colLetter_(D_METODO), dValorCol = colLetter_(D_VALOR),
        dGrupoCol = colLetter_(D_GRUPO), dDevidoFirst = colLetter_(D_DEVIDO[0]), dDevidoLast = colLetter_(D_DEVIDO[D_DEVIDO.length - 1]),
        dParticipaFirst = colLetter_(D_PARTICIPA[0]), dParticipaLast = colLetter_(D_PARTICIPA[D_PARTICIPA.length - 1]);
  for (let i = 0; i < n; i++) {
    const r = DESP_START + i;
    const descRef = `${dDescCol}${r}`, metodoRef = `${dMetodoCol}${r}`, valorRef = `${dValorCol}${r}`, grupoRef = `${dGrupoCol}${r}`;
    const nPartRange = `${dParticipaFirst}${r}:${dParticipaLast}${r}`;
    const rowFormulas = [];
    for (let p = 0; p < 5; p++) {
      const divCol = colLetter_(D_DIV[p]);
      const participaRef = `${colLetter_(D_PARTICIPA[p])}${r}`;
      const nameRow = 5 + p;
      const membroCol = colLetter_(G_MEMBROS[p]);
      const membroRange = `Grupos!$${membroCol}$${GRUPOS_START}:$${membroCol}$${GRUPOS_END}`;
      const grupoRefFull = `Grupos!$A$${GRUPOS_START}:$A$${GRUPOS_END}`;
      const ehMembro = `IFERROR(INDEX(${membroRange},MATCH(${grupoRef},${grupoRefFull},0)),FALSE)`;
      rowFormulas.push(
        `=IF(${descRef}="","",IF(OR(${participaRef}=FALSE,${ehMembro}=FALSE),0,` +
        `IF(Config!$B$${nameRow}="",0,` +
        `IF(${metodoRef}="Igual",IF(SUM(${nPartRange})=0,0,${valorRef}/SUM(${nPartRange})),` +
        `IF(${metodoRef}="Porcentagem",${valorRef}*${divCol}${r},` +
        `IF(${metodoRef}="Valor customizado",${divCol}${r},0))))))`
      );
    }
    formulasDevido.push(rowFormulas);
    formulasConfere.push([`=IF(${descRef}="","",IF(ROUND(SUM(${dDevidoFirst}${r}:${dDevidoLast}${r})-${valorRef},2)=0,"OK","Verificar"))`]);
  }
  sh.getRange(DESP_START, D_DEVIDO[0], n, 5).setFormulas(formulasDevido);
  sh.getRange(DESP_START, D_CONFERE, n, 1).setFormulas(formulasConfere);

  Logger.log('Despesas migrada: colunas de Participação individual adicionadas, ' + n + ' linhas de fórmula reescritas.');
}

function migrarParticipantesComprasParceladas_(ss, grupoMatriz) {
  const sh = ss.getSheetByName(SHEET_COMPRAS);

  // Insere 5 colunas antes da antiga coluna de Divisão (K) — mesma lógica de
  // migrarParticipantesDespesas_.
  sh.insertColumnsBefore(C_PARTICIPA[0], C_PARTICIPA.length);

  sh.getRange(1, C_PARTICIPA[0], 1, C_PARTICIPA.length).merge()
    .setValue('Quem participa desta compra? (marque pessoa a pessoa — nunca é automático)')
    .setFontWeight('bold').setFontColor('#1F4E78').setBackground('#BDD7EE').setHorizontalAlignment('center');

  const cfgNameCells = [5, 6, 7, 8, 9].map(r => `Config!$B$${r}`);
  C_PARTICIPA.forEach((col, i) => {
    sh.getRange(2, col).setFormula(`="Participa: "&${cfgNameCells[i]}`)
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
    sh.setColumnWidth(col, 100);
  });

  const n = PARC_END - PARC_START + 1;
  const descValues = sh.getRange(PARC_START, C_DESC, n, 1).getValues();
  const grupoValues = sh.getRange(PARC_START, C_GRUPO, n, 1).getValues();
  const participaValues = [];
  for (let i = 0; i < n; i++) {
    const temDados = !!descValues[i][0];
    const grupo = String(grupoValues[i][0] || '').trim();
    const membros = temDados && grupoMatriz[grupo] ? grupoMatriz[grupo] : [false, false, false, false, false];
    participaValues.push(membros);
  }
  sh.getRange(PARC_START, C_PARTICIPA[0], n, C_PARTICIPA.length).setValues(participaValues);

  const dvParticipa = SpreadsheetApp.newDataValidation()
    .requireValueInList(['VERDADEIRO', 'FALSO'], true).setAllowInvalid(true).build();
  C_PARTICIPA.forEach(col => sh.getRange(PARC_START, col, n, 1).setDataValidation(dvParticipa)
    .setBackground('#FFF2CC'));

  // Só a fórmula de "valor devido" precisa ser reescrita — Pago/SaldoDev/
  // SaldoTotal/Impacto referenciam células da mesma linha e se ajustam
  // sozinhas com o insertColumnsBefore.
  const formulasDevido = [];
  const cDescCol = colLetter_(C_DESC), cMetodoCol = colLetter_(C_METODO), cValorCol = colLetter_(C_VALOR),
        cGrupoCol = colLetter_(C_GRUPO), cParticipaFirst = colLetter_(C_PARTICIPA[0]), cParticipaLast = colLetter_(C_PARTICIPA[C_PARTICIPA.length - 1]);
  for (let i = 0; i < n; i++) {
    const r = PARC_START + i;
    const descRef = `${cDescCol}${r}`, metodoRef = `${cMetodoCol}${r}`, valorRef = `${cValorCol}${r}`, grupoRef = `${cGrupoCol}${r}`;
    const nPartRange = `${cParticipaFirst}${r}:${cParticipaLast}${r}`;
    const rowFormulas = [];
    for (let p = 0; p < 5; p++) {
      const divCol = colLetter_(C_DIV[p]);
      const participaRef = `${colLetter_(C_PARTICIPA[p])}${r}`;
      const nameRow = 5 + p;
      const membroCol = colLetter_(G_MEMBROS[p]);
      const membroRange = `Grupos!$${membroCol}$${GRUPOS_START}:$${membroCol}$${GRUPOS_END}`;
      const grupoRefFull = `Grupos!$A$${GRUPOS_START}:$A$${GRUPOS_END}`;
      const ehMembro = `IFERROR(INDEX(${membroRange},MATCH(${grupoRef},${grupoRefFull},0)),FALSE)`;
      rowFormulas.push(
        `=IF(${descRef}="","",IF(OR(${participaRef}=FALSE,${ehMembro}=FALSE),0,` +
        `IF(Config!$B$${nameRow}="",0,` +
        `IF(${metodoRef}="Igual",IF(SUM(${nPartRange})=0,0,${valorRef}/SUM(${nPartRange})),` +
        `IF(${metodoRef}="Porcentagem",${valorRef}*${divCol}${r},` +
        `IF(${metodoRef}="Valor customizado",${divCol}${r},0))))))`
      );
    }
    formulasDevido.push(rowFormulas);
  }
  sh.getRange(PARC_START, C_DEVIDO[0], n, 5).setFormulas(formulasDevido);

  Logger.log('Compras Parceladas migrada: colunas de Participação individual adicionadas, ' + n + ' linhas de fórmula reescritas.');
}

/** Reconstrói a aba Saldos do zero, como tabela achatada Grupo x Pessoa. */
function rebuildSaldos_(ss) {
  let sh = ss.getSheetByName(SHEET_SALDOS);
  if (!sh) sh = ss.insertSheet(SHEET_SALDOS);
  sh.clear();

  sh.getRange(1, 1, 1, 8).merge()
    .setValue('SALDOS — quem pagou, quem deve e quanto, por grupo (avulsas + compras parceladas)')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E78').setHorizontalAlignment('center');
  sh.setRowHeight(1, 26);

  const dValorCol = colLetter_(D_VALOR), cValorCol = colLetter_(C_VALOR);
  sh.getRange('A3').setValue('Total gasto em despesas avulsas (todos os grupos):').setFontWeight('bold');
  sh.getRange('B3').setFormula(`=SUM(Despesas!$${dValorCol}$${DESP_START}:$${dValorCol}$${DESP_END})`)
    .setNumberFormat('R$ #,##0.00');
  sh.getRange('A4').setValue('Total em compras parceladas no cartão (todos os grupos):').setFontWeight('bold');
  sh.getRange('B4').setFormula(`=SUM('Compras Parceladas'!$${cValorCol}$${PARC_START}:$${cValorCol}$${PARC_END})`)
    .setNumberFormat('R$ #,##0.00');

  const headerRow = SALDOS_START - 1;
  const headers = ['Grupo', 'Pessoa', 'Total Pago Avulsas (R$)', 'Total Devido Avulsas (R$)',
    'Saldo Avulsas (R$)', 'Saldo Parceladas (R$)', 'Saldo Geral (R$)', 'Situação'];
  sh.getRange(headerRow, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');

  const dDevidoFirst = colLetter_(D_DEVIDO[0]), dDevidoLast = colLetter_(D_DEVIDO[D_DEVIDO.length - 1]);
  const dGrupoCol = colLetter_(D_GRUPO), dPagoPorCol = colLetter_(D_PAGOPOR);
  const gMembrosFirst = colLetter_(G_MEMBROS[0]), gMembrosLast = colLetter_(G_MEMBROS[G_MEMBROS.length - 1]);
  const parcImpFirst = colLetter_(C_IMPACTO[0]), parcImpLast = colLetter_(C_IMPACTO[C_IMPACTO.length - 1]);
  const parcGrupoCol = colLetter_(C_GRUPO);

  const rowsA = [], rowsB = [], rowsC = [], rowsD = [], rowsE = [], rowsF = [], rowsG = [], rowsH = [], rowsI = [], rowsJ = [];
  for (let i = 0; i < N_SALDOS; i++) {
    const r = SALDOS_START + i;
    rowsI.push([`=1+INT((ROW()-${SALDOS_START})/5)`]);
    rowsJ.push([`=MOD(ROW()-${SALDOS_START},5)+1`]);
    const grupoIdxRef = `$I${r}`, pessoaIdxRef = `$J${r}`;
    rowsA.push([`=IFERROR(INDEX(Grupos!$A$${GRUPOS_START}:$A$${GRUPOS_END},${grupoIdxRef}),"")`]);
    const membroFormula = `IFERROR(INDEX(Grupos!$${gMembrosFirst}$${GRUPOS_START}:$${gMembrosLast}$${GRUPOS_END},${grupoIdxRef},${pessoaIdxRef}),FALSE)`;
    const pessoaCandidata = `IFERROR(INDEX(Config!$B$5:$B$9,${pessoaIdxRef}),"")`;
    rowsB.push([`=IF($A${r}="","",IF(${membroFormula}=FALSE,"",IF(${pessoaCandidata}="","",${pessoaCandidata})))`]);
    rowsC.push([`=IF($B${r}="","",SUMIFS(Despesas!$${dValorCol}$${DESP_START}:$${dValorCol}$${DESP_END},Despesas!$${dGrupoCol}$${DESP_START}:$${dGrupoCol}$${DESP_END},$A${r},Despesas!$${dPagoPorCol}$${DESP_START}:$${dPagoPorCol}$${DESP_END},$B${r}))`]);
    rowsD.push([`=IF($B${r}="","",SUMIFS(INDEX(Despesas!$${dDevidoFirst}$${DESP_START}:$${dDevidoLast}$${DESP_END},0,${pessoaIdxRef}),Despesas!$${dGrupoCol}$${DESP_START}:$${dGrupoCol}$${DESP_END},$A${r}))`]);
    rowsE.push([`=IF($B${r}="","",C${r}-D${r})`]);
    rowsF.push([`=IF($B${r}="","",SUMIFS(INDEX('Compras Parceladas'!$${parcImpFirst}$${PARC_START}:$${parcImpLast}$${PARC_END},0,${pessoaIdxRef}),'Compras Parceladas'!$${parcGrupoCol}$${PARC_START}:$${parcGrupoCol}$${PARC_END},$A${r}))`]);
    rowsG.push([`=IF($B${r}="","",E${r}+F${r})`]);
    rowsH.push([`=IF($B${r}="","",IF(G${r}>0.004,"A RECEBER",IF(G${r}<-0.004,"A PAGAR","QUITADO")))`]);
  }
  sh.getRange(SALDOS_START, 1, N_SALDOS, 1).setFormulas(rowsA);
  sh.getRange(SALDOS_START, 2, N_SALDOS, 1).setFormulas(rowsB);
  sh.getRange(SALDOS_START, 3, N_SALDOS, 1).setFormulas(rowsC).setNumberFormat('R$ #,##0.00');
  sh.getRange(SALDOS_START, 4, N_SALDOS, 1).setFormulas(rowsD).setNumberFormat('R$ #,##0.00');
  sh.getRange(SALDOS_START, 5, N_SALDOS, 1).setFormulas(rowsE).setNumberFormat('R$ #,##0.00');
  sh.getRange(SALDOS_START, 6, N_SALDOS, 1).setFormulas(rowsF).setNumberFormat('R$ #,##0.00');
  sh.getRange(SALDOS_START, 7, N_SALDOS, 1).setFormulas(rowsG).setNumberFormat('R$ #,##0.00');
  sh.getRange(SALDOS_START, 8, N_SALDOS, 1).setFormulas(rowsH);
  sh.getRange(SALDOS_START, 9, N_SALDOS, 1).setFormulas(rowsI);
  sh.getRange(SALDOS_START, 10, N_SALDOS, 1).setFormulas(rowsJ);
  sh.hideColumns(9, 2);

  const verifRow = SALDOS_END + 2;
  sh.getRange(verifRow, 1, 1, 3).merge()
    .setValue('Verificação (deve ser R$ 0,00 — soma de todos os saldos gerais, de todos os grupos):')
    .setFontWeight('bold');
  sh.getRange(verifRow, 4).setFormula(`=SUM(G${SALDOS_START}:G${SALDOS_END})`).setNumberFormat('R$ #,##0.00');

  const widths = [16, 16, 18, 18, 15, 16, 15, 14];
  widths.forEach((w, idx) => sh.setColumnWidth(idx + 1, w));
  sh.setFrozenRows(SALDOS_START - 1);

  Logger.log('Saldos reconstruída com ' + N_SALDOS + ' linhas (grupo x pessoa).');
}

/** Reconstrói a aba Dashboard_Data (fonte "longa" para o Looker Studio) do zero. */
function rebuildDashboardData_(ss) {
  let sh = ss.getSheetByName(SHEET_DASHDATA);
  if (!sh) sh = ss.insertSheet(SHEET_DASHDATA);
  sh.clear();

  const DASH_COL = {
    DATA: 1, ANOMES: 2, CAT: 3, SEG: 4, GRUPO: 5, DESC: 6, PESSOA: 7,
    DEVIDO: 8, PAGOPOR: 9, PAGO: 10, SALDO: 11, DESPROW: 12, PESSOAIDX: 13
  };
  const headers = {};
  headers[DASH_COL.DATA] = 'Data'; headers[DASH_COL.ANOMES] = 'Ano-Mês'; headers[DASH_COL.CAT] = 'Categoria';
  headers[DASH_COL.SEG] = 'Segmento'; headers[DASH_COL.GRUPO] = 'Grupo'; headers[DASH_COL.DESC] = 'Descrição';
  headers[DASH_COL.PESSOA] = 'Pessoa'; headers[DASH_COL.DEVIDO] = 'Valor Devido (R$)';
  headers[DASH_COL.PAGOPOR] = 'Pago Por'; headers[DASH_COL.PAGO] = 'Valor Pago (R$)';
  headers[DASH_COL.SALDO] = 'Saldo da Linha (R$)'; headers[DASH_COL.DESPROW] = '_DespRow';
  headers[DASH_COL.PESSOAIDX] = '_PessoaIdx';
  Object.keys(headers).forEach(col => {
    sh.getRange(1, Number(col)).setValue(headers[col])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  });
  sh.hideColumns(DASH_COL.DESPROW, 2);

  const L = colLetter_(DASH_COL.DESPROW), M = colLetter_(DASH_COL.PESSOAIDX);
  const A_ = colLetter_(DASH_COL.DATA), B_ = colLetter_(DASH_COL.ANOMES), C_ = colLetter_(DASH_COL.CAT),
        D_ = colLetter_(DASH_COL.SEG), E_ = colLetter_(DASH_COL.GRUPO), F_ = colLetter_(DASH_COL.DESC),
        G_ = colLetter_(DASH_COL.PESSOA), H_ = colLetter_(DASH_COL.DEVIDO), I_ = colLetter_(DASH_COL.PAGOPOR),
        J_ = colLetter_(DASH_COL.PAGO), K_ = colLetter_(DASH_COL.SALDO);

  const dDescCol = colLetter_(D_DESC), dDataCol = colLetter_(D_DATA), dCatCol = colLetter_(D_CAT),
        dSegCol = colLetter_(D_SEG), dGrupoCol = colLetter_(D_GRUPO), dPagoPorCol = colLetter_(D_PAGOPOR),
        dValorCol = colLetter_(D_VALOR), dDevidoFirst = colLetter_(D_DEVIDO[0]),
        dDevidoLast = colLetter_(D_DEVIDO[D_DEVIDO.length - 1]);

  const colsL = [], colsM = [], colsG = [], colsF = [], colsA = [], colsC = [], colsD = [],
        colsE = [], colsI = [], colsH = [], colsJ = [], colsK = [], colsB = [];
  for (let i = 0; i < N_DASH; i++) {
    const r = DASH_START + i;
    colsL.push([`=1+INT((ROW()-2)/5)`]);
    colsM.push([`=MOD(ROW()-2,5)+1`]);
    colsG.push([`=IF(INDEX(Config!$B$5:$B$9,$${M}${r})="","",INDEX(Config!$B$5:$B$9,$${M}${r}))`]);
    colsF.push([`=IF(OR($${G_}${r}="",INDEX(Despesas!$${dDescCol}$${DESP_START}:$${dDescCol}$${DESP_END},$${L}${r})=""),"",INDEX(Despesas!$${dDescCol}$${DESP_START}:$${dDescCol}$${DESP_END},$${L}${r}))`]);
    colsA.push([`=IF($${F_}${r}="","",INDEX(Despesas!$${dDataCol}$${DESP_START}:$${dDataCol}$${DESP_END},$${L}${r}))`]);
    colsC.push([`=IF($${F_}${r}="","",INDEX(Despesas!$${dCatCol}$${DESP_START}:$${dCatCol}$${DESP_END},$${L}${r}))`]);
    colsD.push([`=IF($${F_}${r}="","",INDEX(Despesas!$${dSegCol}$${DESP_START}:$${dSegCol}$${DESP_END},$${L}${r}))`]);
    colsE.push([`=IF($${F_}${r}="","",INDEX(Despesas!$${dGrupoCol}$${DESP_START}:$${dGrupoCol}$${DESP_END},$${L}${r}))`]);
    colsI.push([`=IF($${F_}${r}="","",INDEX(Despesas!$${dPagoPorCol}$${DESP_START}:$${dPagoPorCol}$${DESP_END},$${L}${r}))`]);
    colsH.push([`=IF($${F_}${r}="","",INDEX(Despesas!$${dDevidoFirst}$${DESP_START}:$${dDevidoLast}$${DESP_END},$${L}${r},$${M}${r}))`]);
    colsJ.push([`=IF($${F_}${r}="","",IF($${G_}${r}=$${I_}${r},INDEX(Despesas!$${dValorCol}$${DESP_START}:$${dValorCol}$${DESP_END},$${L}${r}),0))`]);
    colsK.push([`=IF($${F_}${r}="","",$${J_}${r}-$${H_}${r})`]);
    colsB.push([`=IF($${A_}${r}="","",TEXT($${A_}${r},"yyyy-mm"))`]);
  }
  sh.getRange(DASH_START, DASH_COL.DESPROW, N_DASH, 1).setFormulas(colsL);
  sh.getRange(DASH_START, DASH_COL.PESSOAIDX, N_DASH, 1).setFormulas(colsM);
  sh.getRange(DASH_START, DASH_COL.PESSOA, N_DASH, 1).setFormulas(colsG);
  sh.getRange(DASH_START, DASH_COL.DESC, N_DASH, 1).setFormulas(colsF);
  sh.getRange(DASH_START, DASH_COL.DATA, N_DASH, 1).setFormulas(colsA).setNumberFormat('dd/mm/yyyy');
  sh.getRange(DASH_START, DASH_COL.CAT, N_DASH, 1).setFormulas(colsC);
  sh.getRange(DASH_START, DASH_COL.SEG, N_DASH, 1).setFormulas(colsD);
  sh.getRange(DASH_START, DASH_COL.GRUPO, N_DASH, 1).setFormulas(colsE);
  sh.getRange(DASH_START, DASH_COL.PAGOPOR, N_DASH, 1).setFormulas(colsI);
  sh.getRange(DASH_START, DASH_COL.DEVIDO, N_DASH, 1).setFormulas(colsH).setNumberFormat('R$ #,##0.00');
  sh.getRange(DASH_START, DASH_COL.PAGO, N_DASH, 1).setFormulas(colsJ).setNumberFormat('R$ #,##0.00');
  sh.getRange(DASH_START, DASH_COL.SALDO, N_DASH, 1).setFormulas(colsK).setNumberFormat('R$ #,##0.00');
  sh.getRange(DASH_START, DASH_COL.ANOMES, N_DASH, 1).setFormulas(colsB);

  sh.setFrozenRows(1);
  Logger.log('Dashboard_Data reconstruída com ' + N_DASH + ' linhas.');
}

/** Reconstrói a aba Resumo Mensal do zero, com a lista de categorias atual. */
function rebuildResumoMensal_(ss) {
  let sh = ss.getSheetByName(SHEET_RESUMO);
  if (!sh) sh = ss.insertSheet(SHEET_RESUMO);
  sh.clear();

  const categorias = CATEGORIAS_NOVAS;
  const totalCol = 2 + categorias.length;

  sh.getRange(1, 1, 1, totalCol).merge()
    .setValue('RESUMO MENSAL — gasto por categoria (ano definido em Config!B12)')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E78').setHorizontalAlignment('center');
  sh.setRowHeight(1, 26);

  sh.getRange('A3').setValue('Ano de referência:').setFontWeight('bold');
  sh.getRange('B3').setFormula('=Config!$B$12').setHorizontalAlignment('center');

  sh.getRange(5, 1).setValue('Mês')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  categorias.forEach((cat, i) => {
    sh.getRange(5, 2 + i).setValue(cat)
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');
  });
  sh.getRange(5, totalCol).setValue('Total')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2E75B6').setHorizontalAlignment('center');

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const dValorCol = colLetter_(D_VALOR), dCatCol = colLetter_(D_CAT), dDataCol = colLetter_(D_DATA);
  meses.forEach((mes, mi) => {
    const r = 6 + mi;
    const mnum = mi + 1;
    sh.getRange(r, 1).setValue(mes).setFontWeight('bold');
    categorias.forEach((cat, ci) => {
      const formula = `=SUMIFS(Despesas!$${dValorCol}$${DESP_START}:$${dValorCol}$${DESP_END},` +
        `Despesas!$${dCatCol}$${DESP_START}:$${dCatCol}$${DESP_END},"${cat}",` +
        `Despesas!$${dDataCol}$${DESP_START}:$${dDataCol}$${DESP_END},">="&DATE($B$3,${mnum},1),` +
        `Despesas!$${dDataCol}$${DESP_START}:$${dDataCol}$${DESP_END},"<"&DATE($B$3,${mnum + 1},1))`;
      sh.getRange(r, 2 + ci).setFormula(formula).setNumberFormat('R$ #,##0.00');
    });
    const firstCat = colLetter_(2), lastCat = colLetter_(1 + categorias.length);
    sh.getRange(r, totalCol).setFormula(`=SUM(${firstCat}${r}:${lastCat}${r})`)
      .setFontWeight('bold').setNumberFormat('R$ #,##0.00');
  });

  const gtRow = 6 + meses.length;
  sh.getRange(gtRow, 1).setValue('Total do ano').setFontWeight('bold');
  for (let ci = 0; ci <= categorias.length; ci++) {
    const colLetterC = colLetter_(2 + ci);
    sh.getRange(gtRow, 2 + ci).setFormula(`=SUM(${colLetterC}6:${colLetterC}${gtRow - 1})`)
      .setFontWeight('bold').setNumberFormat('R$ #,##0.00');
  }

  sh.setColumnWidth(1, 100);
  for (let i = 0; i <= categorias.length; i++) sh.setColumnWidth(2 + i, 115);

  Logger.log('Resumo Mensal reconstruída com a nova lista de categorias.');
}

/**
 * Reconstrói só as abas 100% calculadas (Saldos, Dashboard_Data, Resumo
 * Mensal). Útil se você editar manualmente a aba Grupos ou Config e quiser
 * forçar a planilha a recalcular tudo do zero — não é destrutivo (nenhuma
 * dessas 3 abas tem dado digitado pelo usuário).
 */
function reconstruirAbasCalculadas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  rebuildSaldos_(ss);
  rebuildDashboardData_(ss);
  rebuildResumoMensal_(ss);
  SpreadsheetApp.flush();
  Logger.log('Saldos, Dashboard_Data e Resumo Mensal reconstruídas.');
}
