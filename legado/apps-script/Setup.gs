/**
 * Rachaê — criação da planilha do zero
 * -------------------------------------
 * Para uma planilha VAZIA. Rode UMA VEZ pelo editor do Apps Script:
 * selecione "criarPlanilhaDoZero" no menu de funções e clique em Executar.
 *
 * Monta exatamente o layout que o Code.gs espera (o mesmo que as migrações
 * produzem): Config, Grupos, Despesas, Compras Parceladas, Pagamentos
 * Parcelas, Saldos, Resumo Mensal e Dashboard_Data — com fórmulas, listas e
 * validações. Depois é só preencher Config!B5:B9 (nomes) e C5:C9 (emails).
 *
 * Não apaga nada e pode ser rodada de novo: cada aba que já existe é
 * mantida como está (útil se uma execução anterior parou no meio).
 */

const HDR_BG_ = '#2E75B6', TITLE_BG_ = '#1F4E78', INPUT_BG_ = '#FFF2CC', GROUP_BG_ = '#BDD7EE';
const METODOS_ = ['Igual', 'Porcentagem', 'Valor customizado'];

function criarPlanilhaDoZero() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_SALDOS)) {
    Logger.log('Esta planilha já tem a estrutura completa (a aba Saldos existe). Nada foi alterado.');
    return;
  }
  Logger.log('Criando a estrutura do Rachaê...');

  const existe = nome => {
    const sh = ss.getSheetByName(nome);
    if (sh) Logger.log('Aba "' + nome + '" já existe — mantida como está.');
    return sh;
  };
  const cfg = existe(SHEET_CONFIG) || setupConfig_(ss);
  const grupos = existe(SHEET_GRUPOS) || setupGrupos_(ss, cfg);
  existe(SHEET_DESPESAS) || setupDespesas_(ss, cfg, grupos);
  // Uma execução anterior pode ter deixado Compras Parceladas pela metade (sem
  // colunas suficientes). Se ela ainda não tem nenhuma compra lançada, recria.
  const comprasSh = ss.getSheetByName(SHEET_COMPRAS);
  if (comprasSh && comprasSh.getMaxColumns() < C_IMPACTO[4] && comprasSh.getLastRow() <= 2) {
    Logger.log('Aba "' + SHEET_COMPRAS + '" estava incompleta — recriando.');
    ss.deleteSheet(comprasSh);
  }
  existe(SHEET_COMPRAS) || setupCompras_(ss, cfg, grupos);
  existe(SHEET_PAGAMENTOS) || setupPagamentos_(ss);
  rebuildResumoMensal_(ss);
  rebuildDashboardData_(ss);
  rebuildSaldos_(ss); // por último: é o marcador de "estrutura completa"

  // Remove a aba em branco padrão ("Página1"/"Sheet1"), se estiver vazia
  ss.getSheets().forEach(sh => {
    if (/^(Página|Sheet|Planilha)\s*1$/i.test(sh.getName()) && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });
  if (!String(cfg.getRange('B45').getValue() || '').trim()) gerarCodigoConvite();
  ss.setActiveSheet(cfg);
  SpreadsheetApp.flush();
  Logger.log('Pronto! Mande o código de convite (Config!B45) para os moradores se cadastrarem pelo app.');
}

// ---------------------------------------------------------------- helpers

function titleRow_(sh, text, nCols) {
  sh.getRange(1, 1, 1, nCols).merge().setValue(text)
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground(TITLE_BG_).setHorizontalAlignment('center');
  sh.setRowHeight(1, 26);
}
function headerStyle_(range) {
  return range.setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HDR_BG_)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
}
function groupHeader_(sh, col, n, text) {
  sh.getRange(1, col, 1, n).merge().setValue(text)
    .setFontWeight('bold').setFontColor(TITLE_BG_).setBackground(GROUP_BG_).setHorizontalAlignment('center');
}
function fill_(n, width, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let p = 0; p < width; p++) row.push(fn(i, p));
    out.push(row);
  }
  return out;
}
function listValidation_(range) {
  return SpreadsheetApp.newDataValidation().requireValueInRange(range, true).setAllowInvalid(false).build();
}
const nomeCfg_ = p => `Config!$B$${5 + p}`;
// Abas novas nascem com 26 colunas (A–Z); acrescenta as que faltarem
function garantirColunas_(sh, n) {
  const faltam = n - sh.getMaxColumns();
  if (faltam > 0) sh.insertColumnsAfter(sh.getMaxColumns(), faltam);
}

// ---------------------------------------------------------------- Config

function setupConfig_(ss) {
  const sh = ss.insertSheet(SHEET_CONFIG, 0);
  titleRow_(sh, 'CONFIGURAÇÃO — Rachaê', 3);

  sh.getRange('A3').setValue('1. Quem mora na casa (até 5 pessoas)').setFontWeight('bold').setFontColor(TITLE_BG_);
  headerStyle_(sh.getRange('A4:C4').setValues([['#', 'Nome', 'Email']]));
  sh.getRange('A5:A9').setValues([[1], [2], [3], [4], [5]]).setHorizontalAlignment('center');
  sh.getRange('B5:C9').setBackground(INPUT_BG_).setBorder(true, true, true, true, true, true);

  sh.getRange('A11').setValue('2. Ano de referência do Resumo Mensal').setFontWeight('bold').setFontColor(TITLE_BG_);
  sh.getRange('A12').setValue('Ano');
  sh.getRange('B12').setValue(new Date().getFullYear()).setBackground(INPUT_BG_).setHorizontalAlignment('center');

  sh.getRange('A14').setValue('3. Categorias').setFontWeight('bold').setFontColor(TITLE_BG_);
  headerStyle_(sh.getRange('A15').setValue('Categoria'));
  sh.getRange(CFG_CAT_START, 1, CATEGORIAS_NOVAS.length, 1).setValues(CATEGORIAS_NOVAS.map(c => [c]))
    .setBorder(true, true, true, true, true, true);

  sh.getRange('A28').setValue('4. Métodos de divisão').setFontWeight('bold').setFontColor(TITLE_BG_);
  headerStyle_(sh.getRange('A29').setValue('Método'));
  sh.getRange(CFG_METODO_START, 1, METODOS_.length, 1).setValues(METODOS_.map(m => [m]));

  sh.getRange('A34').setValue('5. Segmentos de despesa').setFontWeight('bold').setFontColor(TITLE_BG_);
  headerStyle_(sh.getRange('A35').setValue('Segmento'));
  sh.getRange(CFG_SEG_START, 1, SEGMENTOS.length, 1).setValues(SEGMENTOS.map(s => [s]));

  sh.getRange('A39').setValue('6. Tipos de grupo').setFontWeight('bold').setFontColor(TITLE_BG_);
  headerStyle_(sh.getRange('A40').setValue('Tipo'));
  sh.getRange(CFG_TIPOGRUPO_START, 1, TIPOS_GRUPO.length, 1).setValues(TIPOS_GRUPO.map(t => [t]));

  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 230);
  return sh;
}

// ---------------------------------------------------------------- Grupos

function setupGrupos_(ss, cfg) {
  const sh = ss.insertSheet(SHEET_GRUPOS, cfg.getIndex());
  titleRow_(sh, 'GRUPOS — quem compartilha despesas com quem', G_NMEMBROS);

  sh.getRange(2, G_NOME).setValue('Nome do Grupo');
  sh.getRange(2, G_TIPO).setValue('Tipo');
  G_MEMBROS.forEach((col, i) => sh.getRange(2, col).setFormula(`=IF(${nomeCfg_(i)}="","(vazio)",${nomeCfg_(i)})`));
  sh.getRange(2, G_NMEMBROS).setValue('Nº de Membros');
  headerStyle_(sh.getRange(2, 1, 1, G_NMEMBROS));

  // Grupo "Casa": inclui automaticamente todo mundo cadastrado na Config
  sh.getRange(GRUPOS_START, G_NOME).setValue('Casa');
  sh.getRange(GRUPOS_START, G_TIPO).setValue('Compartilhado');
  sh.getRange(GRUPOS_START, G_MEMBROS[0], 1, G_MEMBROS.length)
    .setFormulas([G_MEMBROS.map((c, i) => `=${nomeCfg_(i)}<>""`)])
    .setFontColor('#5b6779');
  sh.getRange(GRUPOS_START, G_NOME).setNote('O grupo Casa inclui automaticamente todo mundo cadastrado em Config!B5:B9.');

  // Demais grupos: caixinhas para marcar quem participa
  const outros = N_GRUPOS - 1;
  sh.getRange(GRUPOS_START + 1, G_MEMBROS[0], outros, G_MEMBROS.length)
    .insertCheckboxes().setBackground(INPUT_BG_);
  sh.getRange(GRUPOS_START + 1, G_NOME, outros, 2).setBackground(INPUT_BG_);

  const mFirst = colLetter_(G_MEMBROS[0]), mLast = colLetter_(G_MEMBROS[G_MEMBROS.length - 1]);
  sh.getRange(GRUPOS_START, G_NMEMBROS, N_GRUPOS, 1)
    .setFormulas(fill_(N_GRUPOS, 1, i => {
      const r = GRUPOS_START + i;
      return `=IF(A${r}="","",COUNTIF(${mFirst}${r}:${mLast}${r},TRUE))`;
    }));

  const cfgSh = ss.getSheetByName(SHEET_CONFIG);
  sh.getRange(GRUPOS_START, G_TIPO, N_GRUPOS, 1)
    .setDataValidation(listValidation_(cfgSh.getRange(CFG_TIPOGRUPO_START, 1, TIPOS_GRUPO.length, 1)));

  sh.setColumnWidth(G_NOME, 160);
  sh.setColumnWidth(G_TIPO, 130);
  sh.setColumnWidth(G_NMEMBROS, 110);
  G_MEMBROS.forEach(col => sh.setColumnWidth(col, 95));
  sh.setFrozenRows(2);
  return sh;
}

// ---------------------------------------------------------------- Despesas

/** Mesma fórmula de "valor devido" usada em migrarParticipantesDespesas_. */
function formulaDevido_(r, p, cols) {
  const descRef = `${cols.desc}${r}`, metodoRef = `${cols.metodo}${r}`, valorRef = `${cols.valor}${r}`, grupoRef = `${cols.grupo}${r}`;
  const nPartRange = `${cols.partFirst}${r}:${cols.partLast}${r}`;
  const participaRef = `${colLetter_(cols.participa[p])}${r}`;
  const divRef = `${colLetter_(cols.div[p])}${r}`;
  const membroCol = colLetter_(G_MEMBROS[p]);
  const membroRange = `Grupos!$${membroCol}$${GRUPOS_START}:$${membroCol}$${GRUPOS_END}`;
  const grupoRefFull = `Grupos!$A$${GRUPOS_START}:$A$${GRUPOS_END}`;
  const ehMembro = `IFERROR(INDEX(${membroRange},MATCH(${grupoRef},${grupoRefFull},0)),FALSE)`;
  return `=IF(${descRef}="","",IF(OR(${participaRef}=FALSE,${ehMembro}=FALSE),0,` +
    `IF(${nomeCfg_(p)}="",0,` +
    `IF(${metodoRef}="Igual",IF(COUNTIF(${nPartRange},TRUE)=0,0,${valorRef}/COUNTIF(${nPartRange},TRUE)),` +
    `IF(${metodoRef}="Porcentagem",${valorRef}*${divRef},` +
    `IF(${metodoRef}="Valor customizado",${divRef},0))))))`;
}

function setupDespesas_(ss, cfg, grupos) {
  const sh = ss.insertSheet(SHEET_DESPESAS);
  const n = DESP_END - DESP_START + 1;
  const lastCol = D_CONFERE;

  groupHeader_(sh, D_DATA, D_METODO, 'Detalhes da despesa');
  groupHeader_(sh, D_PARTICIPA[0], 5, 'Quem participa desta despesa? (marque pessoa a pessoa — nunca é automático)');
  groupHeader_(sh, D_DIV[0], 5, 'Divisão informada (só para Porcentagem ou Valor customizado)');
  groupHeader_(sh, D_DEVIDO[0], 5, 'Valor devido por pessoa (calculado)');

  sh.getRange(2, 1, 1, D_METODO).setValues([['Data', 'Descrição', 'Categoria', 'Segmento', 'Grupo',
    'Valor Total (R$)', 'Pago Por', 'Método de Divisão']]);
  sh.getRange(2, D_PARTICIPA[0], 1, 5).setFormulas([[0, 1, 2, 3, 4].map(p => `="Participa: "&${nomeCfg_(p)}`)]);
  sh.getRange(2, D_DIV[0], 1, 5).setFormulas([[0, 1, 2, 3, 4].map(p => `="Divisão: "&${nomeCfg_(p)}`)]);
  sh.getRange(2, D_DEVIDO[0], 1, 5).setFormulas([[0, 1, 2, 3, 4].map(p => `="Devido: "&${nomeCfg_(p)}`)]);
  sh.getRange(2, D_CONFERE).setValue('Confere?');
  headerStyle_(sh.getRange(2, 1, 1, lastCol));
  sh.setRowHeight(2, 36);

  const cols = {
    desc: colLetter_(D_DESC), metodo: colLetter_(D_METODO), valor: colLetter_(D_VALOR), grupo: colLetter_(D_GRUPO),
    partFirst: colLetter_(D_PARTICIPA[0]), partLast: colLetter_(D_PARTICIPA[4]), participa: D_PARTICIPA, div: D_DIV
  };
  sh.getRange(DESP_START, D_DEVIDO[0], n, 5).setFormulas(fill_(n, 5, (i, p) => formulaDevido_(DESP_START + i, p, cols)))
    .setNumberFormat('R$ #,##0.00').setBackground('#F2F2F2');
  const devFirst = colLetter_(D_DEVIDO[0]), devLast = colLetter_(D_DEVIDO[4]);
  sh.getRange(DESP_START, D_CONFERE, n, 1).setFormulas(fill_(n, 1, i => {
    const r = DESP_START + i;
    return `=IF(${cols.desc}${r}="","",IF(ROUND(SUM(${devFirst}${r}:${devLast}${r})-${cols.valor}${r},2)=0,"OK","Verificar"))`;
  })).setHorizontalAlignment('center');

  sh.getRange(DESP_START, D_PARTICIPA[0], n, 5).insertCheckboxes();
  sh.getRange(DESP_START, D_DATA, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(DESP_START, D_VALOR, n, 1).setNumberFormat('R$ #,##0.00');
  sh.getRange(DESP_START, D_DIV[0], n, 5).setNumberFormat('0.00');
  sh.getRange(DESP_START, 1, n, D_METODO).setBackground(INPUT_BG_);

  sh.getRange(DESP_START, D_CAT, n, 1).setDataValidation(listValidation_(cfg.getRange(CFG_CAT_START, 1, CATEGORIAS_NOVAS.length, 1)));
  sh.getRange(DESP_START, D_SEG, n, 1).setDataValidation(listValidation_(cfg.getRange(CFG_SEG_START, 1, SEGMENTOS.length, 1)));
  sh.getRange(DESP_START, D_GRUPO, n, 1).setDataValidation(listValidation_(grupos.getRange(GRUPOS_START, G_NOME, N_GRUPOS, 1)));
  sh.getRange(DESP_START, D_PAGOPOR, n, 1).setDataValidation(listValidation_(cfg.getRange('B5:B9')));
  sh.getRange(DESP_START, D_METODO, n, 1).setDataValidation(listValidation_(cfg.getRange(CFG_METODO_START, 1, METODOS_.length, 1)));

  sh.setColumnWidth(D_DATA, 95);
  sh.setColumnWidth(D_DESC, 200);
  sh.setColumnWidth(D_CAT, 150);
  sh.setFrozenRows(2);
}

// ---------------------------------------------------------------- Compras Parceladas

function setupCompras_(ss, cfg, grupos) {
  const sh = ss.insertSheet(SHEET_COMPRAS);
  garantirColunas_(sh, C_IMPACTO[4]);
  const n = PARC_END - PARC_START + 1;
  const lastCol = C_IMPACTO[4];

  groupHeader_(sh, C_ID, C_METODO, 'Detalhes da compra parcelada');
  groupHeader_(sh, C_PARTICIPA[0], 5, 'Quem participa desta compra? (marque pessoa a pessoa — nunca é automático)');
  groupHeader_(sh, C_DIV[0], 5, 'Divisão informada (só para Porcentagem ou Valor customizado)');
  groupHeader_(sh, C_DEVIDO[0], 5, 'Parte de cada pessoa na compra (calculado)');
  groupHeader_(sh, C_PAGO[0], 5, 'Já pago de volta ao comprador (aba Pagamentos Parcelas)');
  groupHeader_(sh, C_SALDODEV[0], 5, 'Ainda deve ao comprador');
  groupHeader_(sh, C_IMPACTO[0], 5, 'Impacto no saldo de cada pessoa (+ receber / − pagar)');

  sh.getRange(2, 1, 1, C_METODO).setValues([['ID', 'Data da Compra', 'Descrição', 'Categoria', 'Grupo',
    'Valor Total (R$)', 'Comprador (cartão)', 'Nº Parcelas', 'Valor Parcela (R$)', 'Método de Divisão']]);
  const byPessoa = (col0, prefix) => sh.getRange(2, col0, 1, 5)
    .setFormulas([[0, 1, 2, 3, 4].map(p => `="${prefix}"&${nomeCfg_(p)}`)]);
  byPessoa(C_PARTICIPA[0], 'Participa: ');
  byPessoa(C_DIV[0], 'Divisão: ');
  byPessoa(C_DEVIDO[0], 'Parte: ');
  byPessoa(C_PAGO[0], 'Pago: ');
  byPessoa(C_SALDODEV[0], 'Deve: ');
  byPessoa(C_IMPACTO[0], 'Impacto: ');
  sh.getRange(2, C_CONFERE).setValue('Confere?');
  sh.getRange(2, C_SALDOTOTAL).setValue('Saldo em aberto (R$)');
  headerStyle_(sh.getRange(2, 1, 1, lastCol));
  sh.setRowHeight(2, 36);

  const L = c => colLetter_(c);
  const cols = {
    desc: L(C_DESC), metodo: L(C_METODO), valor: L(C_VALOR), grupo: L(C_GRUPO),
    partFirst: L(C_PARTICIPA[0]), partLast: L(C_PARTICIPA[4]), participa: C_PARTICIPA, div: C_DIV
  };
  const pagSheet = `'${SHEET_PAGAMENTOS}'`;
  const pagRange = c => `${pagSheet}!$${L(c)}$${PAG_START}:$${L(c)}$${PAG_END}`;

  sh.getRange(PARC_START, C_ID, n, 1).setFormulas(fill_(n, 1, i => {
    const r = PARC_START + i;
    return `=IF(${cols.desc}${r}="","","CP-"&TEXT(ROW()-${PARC_START - 1},"000"))`;
  })).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(PARC_START, C_VPARC, n, 1).setFormulas(fill_(n, 1, i => {
    const r = PARC_START + i;
    return `=IF(OR(${cols.desc}${r}="",N(${L(C_NPARC)}${r})=0),"",${cols.valor}${r}/${L(C_NPARC)}${r})`;
  }));
  sh.getRange(PARC_START, C_DEVIDO[0], n, 5).setFormulas(fill_(n, 5, (i, p) => formulaDevido_(PARC_START + i, p, cols)));
  sh.getRange(PARC_START, C_CONFERE, n, 1).setFormulas(fill_(n, 1, i => {
    const r = PARC_START + i;
    return `=IF(${cols.desc}${r}="","",IF(ROUND(SUM(${L(C_DEVIDO[0])}${r}:${L(C_DEVIDO[4])}${r})-${cols.valor}${r},2)=0,"OK","Verificar"))`;
  })).setHorizontalAlignment('center');
  // Quanto cada pessoa já devolveu ao comprador desta compra
  sh.getRange(PARC_START, C_PAGO[0], n, 5).setFormulas(fill_(n, 5, (i, p) => {
    const r = PARC_START + i;
    return `=IF(OR(${cols.desc}${r}="",${nomeCfg_(p)}=""),IF(${cols.desc}${r}="","",0),` +
      `SUMIFS(${pagRange(P_VALOR)},${pagRange(P_COMPRAID)},$A${r},${pagRange(P_PESSOA)},${nomeCfg_(p)}))`;
  }));
  // Quanto ainda deve ao comprador (o comprador não deve a si mesmo)
  sh.getRange(PARC_START, C_SALDODEV[0], n, 5).setFormulas(fill_(n, 5, (i, p) => {
    const r = PARC_START + i;
    return `=IF(${cols.desc}${r}="","",IF(OR(${nomeCfg_(p)}="",${nomeCfg_(p)}=$${L(C_COMPRADOR)}${r}),0,` +
      `MAX(0,ROUND(${L(C_DEVIDO[p])}${r}-${L(C_PAGO[p])}${r},2))))`;
  }));
  sh.getRange(PARC_START, C_SALDOTOTAL, n, 1).setFormulas(fill_(n, 1, i => {
    const r = PARC_START + i;
    return `=IF(${cols.desc}${r}="","",SUM(${L(C_SALDODEV[0])}${r}:${L(C_SALDODEV[4])}${r}))`;
  })).setFontWeight('bold');
  // Comprador tem a receber o saldo em aberto; os outros têm a pagar o que devem
  sh.getRange(PARC_START, C_IMPACTO[0], n, 5).setFormulas(fill_(n, 5, (i, p) => {
    const r = PARC_START + i;
    return `=IF(${cols.desc}${r}="","",IF(${nomeCfg_(p)}="",0,IF(${nomeCfg_(p)}=$${L(C_COMPRADOR)}${r},` +
      `$${L(C_SALDOTOTAL)}${r},-${L(C_SALDODEV[p])}${r})))`;
  }));

  sh.getRange(PARC_START, C_PARTICIPA[0], n, 5).insertCheckboxes();
  sh.getRange(PARC_START, C_DATA, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(PARC_START, C_VALOR, n, 1).setNumberFormat('R$ #,##0.00');
  sh.getRange(PARC_START, C_VPARC, n, 1).setNumberFormat('R$ #,##0.00');
  sh.getRange(PARC_START, C_DIV[0], n, 5).setNumberFormat('0.00');
  sh.getRange(PARC_START, C_DEVIDO[0], n, C_IMPACTO[4] - C_DEVIDO[0] + 1).setNumberFormat('R$ #,##0.00');
  sh.getRange(PARC_START, C_DATA, n, C_COMPRADOR - C_DATA + 2).setBackground(INPUT_BG_); // Data..Nº Parcelas
  sh.getRange(PARC_START, C_METODO, n, 1).setBackground(INPUT_BG_);

  sh.getRange(PARC_START, C_CAT, n, 1).setDataValidation(listValidation_(cfg.getRange(CFG_CAT_START, 1, CATEGORIAS_NOVAS.length, 1)));
  sh.getRange(PARC_START, C_GRUPO, n, 1).setDataValidation(listValidation_(grupos.getRange(GRUPOS_START, G_NOME, N_GRUPOS, 1)));
  sh.getRange(PARC_START, C_COMPRADOR, n, 1).setDataValidation(listValidation_(cfg.getRange('B5:B9')));
  sh.getRange(PARC_START, C_METODO, n, 1).setDataValidation(listValidation_(cfg.getRange(CFG_METODO_START, 1, METODOS_.length, 1)));

  sh.setColumnWidth(C_ID, 70);
  sh.setColumnWidth(C_DESC, 200);
  sh.setFrozenRows(2);
}

// ---------------------------------------------------------------- Pagamentos Parcelas

function setupPagamentos_(ss) {
  const sh = ss.insertSheet(SHEET_PAGAMENTOS);
  const n = PAG_END - PAG_START + 1;
  titleRow_(sh, 'PAGAMENTOS — cada vez que alguém devolve uma parcela para quem comprou no cartão', 7);
  headerStyle_(sh.getRange(2, 1, 1, 7).setValues([['ID', 'Data', 'ID da Compra', 'Descrição (auto)', 'Quem pagou', 'Valor (R$)', 'Nº Parcela']]));

  const comprasA = `'${SHEET_COMPRAS}'!$A$${PARC_START}:$A$${PARC_END}`;
  const comprasC = `'${SHEET_COMPRAS}'!$C$${PARC_START}:$C$${PARC_END}`;
  sh.getRange(PAG_START, P_ID, n, 1).setFormulas(fill_(n, 1, i => {
    const r = PAG_START + i;
    return `=IF(C${r}="","","PG-"&TEXT(ROW()-${PAG_START - 1},"000"))`;
  }));
  sh.getRange(PAG_START, P_DESC, n, 1).setFormulas(fill_(n, 1, i => {
    const r = PAG_START + i;
    return `=IF(C${r}="","",IFERROR(INDEX(${comprasC},MATCH(C${r},${comprasA},0)),"(compra não encontrada)"))`;
  }));

  sh.getRange(PAG_START, P_DATA, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(PAG_START, P_VALOR, n, 1).setNumberFormat('R$ #,##0.00');
  const cfg = ss.getSheetByName(SHEET_CONFIG);
  sh.getRange(PAG_START, P_PESSOA, n, 1).setDataValidation(listValidation_(cfg.getRange('B5:B9')));
  [P_DATA, P_COMPRAID, P_PESSOA, P_VALOR, P_PARCELANUM].forEach(c => sh.getRange(PAG_START, c, n, 1).setBackground(INPUT_BG_));
  sh.setColumnWidth(P_DESC, 200);
  sh.setFrozenRows(2);
}
