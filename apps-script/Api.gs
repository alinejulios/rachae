/**
 * Rachaê — API JSON para o app mobile (PWA)
 * ------------------------------------------
 * Este arquivo fica AO LADO do Code.gs no mesmo projeto do Apps Script
 * (Extensões > Apps Script > + > Script > nome "Api"). Ele não muda nada
 * no Code.gs: só reaproveita as funções que já existem lá (getConfig,
 * getGrupos, getDashboard, addDespesa...) e as expõe via doPost para o
 * front-end hospedado fora do Google.
 *
 * Como o front-end chama:
 *   fetch(URL_DO_APP_DA_WEB, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
 *     body: JSON.stringify({ action: 'dashboard', token: '...', grupo: 'Casa' })
 *   })
 *
 * Resposta sempre em JSON: { ok: true, data: ... } ou { ok: false, error: '...' }.
 *
 * Sessão: depois que o código do email é confirmado, o servidor gera um token
 * aleatório e guarda só o HASH dele em Script Properties. O front guarda o
 * token no aparelho. Toda chamada que lê/grava dados exige o token — e a
 * "pessoa" de cada chamada vem do token, nunca de um campo enviado pelo
 * front (ninguém consegue lançar pagamento em nome de outra pessoa).
 */

const SESSION_TTL_DAYS = 90;
const SESSION_PREFIX = 'sess_';
const OTP_COOLDOWN_SECONDS = 30; // intervalo mínimo entre envios de código para o mesmo email

// Cadastro pelo próprio app, liberado por código de convite (Config!B45)
const CFG_CONVITE_CELL = 'B45';
const CONVITE_MAX_ERROS_POR_HORA = 20; // trava tentativas de adivinhar o convite
const NOME_REGEX_ = /^[\p{L}][\p{L} .'-]{0,19}$/u;

// Ações que não exigem sessão
const PUBLIC_ACTIONS_ = {
  config: true,
  iniciarLogin: true,
  confirmarCodigo: true,
  loginPorNome: true,
  iniciarCadastro: true,
  confirmarCadastro: true
};

// Ações que gravam na planilha — rodam com LockService para evitar que dois
// lançamentos simultâneos caiam na mesma "primeira linha vazia".
const WRITE_ACTIONS_ = {
  confirmarCadastro: true,
  addDespesa: true,
  addCompraParcelada: true,
  addPagamento: true
};

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Requisição inválida.' });
  }

  const action = String(req.action || '');
  const handler = API_HANDLERS_[action];
  if (!handler) return jsonOut_({ ok: false, error: 'Ação desconhecida: ' + action });

  let lock = null;
  try {
    let sessao = null;
    if (!PUBLIC_ACTIONS_[action]) {
      sessao = lerSessao_(req.token);
      if (!sessao) return jsonOut_({ ok: false, error: 'Sessão expirada. Entre novamente.', code: 'AUTH' });
    }
    if (WRITE_ACTIONS_[action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    const data = handler(req, sessao);
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    return jsonOut_({ ok: false, error: (err && err.message) || String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- Handlers

const API_HANDLERS_ = {
  config: function () {
    const cfg = getConfig();
    cfg.cadastroAberto = !!lerConvite_();
    cfg.vagas = cfg.cadastroAberto ? vagasLivres_().length : 0;
    return cfg;
  },

  // Passo 1 do cadastro: confere convite, nome e email e manda o código por email
  iniciarCadastro: function (req) {
    const convite = lerConvite_();
    if (!convite) throw new Error('O cadastro pelo app ainda não foi liberado. Peça o convite para quem administra a planilha.');

    const cache = CacheService.getScriptCache();
    const erros = Number(cache.get('convite_erros') || 0);
    if (erros >= CONVITE_MAX_ERROS_POR_HORA) throw new Error('Muitas tentativas com convite errado. Tente de novo mais tarde.');
    if (String(req.convite || '').trim().toUpperCase() !== convite.toUpperCase()) {
      cache.put('convite_erros', String(erros + 1), 3600);
      throw new Error('Código de convite inválido.');
    }

    const nome = String(req.nome || '').trim().replace(/\s+/g, ' ');
    if (!NOME_REGEX_.test(nome)) throw new Error('Digite um nome de até 20 letras (sem números ou símbolos).');
    const emailNorm = normalizeEmail_(req.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) throw new Error('Digite um email válido.');

    validarCadastroDisponivel_(nome, emailNorm);

    const coolKey = 'otp_cool_' + emailNorm;
    if (cache.get(coolKey)) throw new Error('Aguarde alguns segundos antes de pedir outro código.');
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    cache.put('cad_' + emailNorm, JSON.stringify({ codigo: codigo, nome: nome, tentativas: 0 }), OTP_TTL_SECONDS);
    cache.put(coolKey, '1', OTP_COOLDOWN_SECONDS);

    MailApp.sendEmail({
      to: emailNorm,
      subject: 'Confirme seu cadastro — Rachaê',
      name: 'Rachaê',
      body: 'Olá, ' + nome + '!\n\n' +
        'Seu código para confirmar o cadastro no Rachaê é: ' + codigo + '\n\n' +
        'Ele é válido por 5 minutos. Se você não pediu esse cadastro, pode ignorar este email.'
    });
    return { ok: true };
  },

  // Passo 2 do cadastro: confirma o código, grava nome + email na Config e já entra
  confirmarCadastro: function (req) {
    const emailNorm = normalizeEmail_(req.email);
    const cache = CacheService.getScriptCache();
    const key = 'cad_' + emailNorm;
    const raw = cache.get(key);
    if (!raw) throw new Error('Código expirado ou não solicitado. Peça um novo código.');
    const data = JSON.parse(raw);
    if (data.tentativas >= OTP_MAX_TENTATIVAS) {
      cache.remove(key);
      throw new Error('Muitas tentativas incorretas. Comece o cadastro de novo.');
    }
    if (String(req.codigo || '').trim() !== data.codigo) {
      data.tentativas += 1;
      cache.put(key, JSON.stringify(data), OTP_TTL_SECONDS);
      throw new Error('Código incorreto. Confira e tente novamente.');
    }

    // Revalida (roda sob LockService): alguém pode ter ocupado a vaga nesse meio-tempo
    validarCadastroDisponivel_(data.nome, emailNorm);
    const linha = vagasLivres_()[0];
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
    sh.getRange(linha, 2, 1, 2).setValues([[data.nome, emailNorm]]);
    SpreadsheetApp.flush();
    cache.remove(key);
    return { nome: data.nome, token: criarSessao_(data.nome) };
  },

  iniciarLogin: function (req) {
    const emailNorm = normalizeEmail_(req.email);
    const cache = CacheService.getScriptCache();
    const coolKey = 'otp_cool_' + emailNorm;
    if (cache.get(coolKey)) {
      throw new Error('Aguarde alguns segundos antes de pedir outro código.');
    }
    const res = iniciarLogin(req.email);
    cache.put(coolKey, '1', OTP_COOLDOWN_SECONDS);
    return res;
  },

  confirmarCodigo: function (req) {
    const res = confirmarCodigo(req.email, req.codigo);
    return { nome: res.nome, token: criarSessao_(res.nome) };
  },

  // Modo antigo (sem emails cadastrados na Config): escolhe o nome direto.
  // Fica bloqueado assim que pelo menos um email for cadastrado.
  loginPorNome: function (req) {
    const cfg = getConfig();
    if (cfg.emailsConfigured || lerConvite_()) throw new Error('Entre com seu email.');
    const nome = String(req.nome || '').trim();
    if (cfg.names.indexOf(nome) === -1) throw new Error('Pessoa não encontrada.');
    return { nome: nome, token: criarSessao_(nome) };
  },

  sessao: function (req, sessao) {
    return { nome: sessao.nome };
  },

  logout: function (req) {
    apagarSessao_(req.token);
    return { ok: true };
  },

  grupos: function () {
    return getGrupos();
  },

  dashboard: function (req, sessao) {
    return getDashboard(sessao.nome, req.grupo || null);
  },

  comprasParaPagamento: function (req, sessao) {
    return getComprasParaPagamento(sessao.nome, req.grupo || null);
  },

  historico: function (req) {
    return getHistorico(req.grupo || null);
  },

  addDespesa: function (req) {
    return addDespesa(req.payload || {});
  },

  addCompraParcelada: function (req) {
    return addCompraParcelada(req.payload || {});
  },

  addPagamento: function (req, sessao) {
    const payload = req.payload || {};
    payload.pessoa = sessao.nome; // sempre quem está logado
    return addPagamento(payload);
  }
};

// ---------------------------------------------------------------- Cadastro

function lerConvite_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  return String(sh.getRange(CFG_CONVITE_CELL).getValue() || '').trim();
}

/** Linhas de Config (5..9) com nome vazio, em ordem. */
function vagasLivres_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const nomes = sh.getRange(5, 2, 5, 1).getValues();
  const livres = [];
  nomes.forEach(function (r, i) { if (String(r[0]).trim() === '') livres.push(5 + i); });
  return livres;
}

function validarCadastroDisponivel_(nome, emailNorm) {
  if (findPessoaPorEmail_(emailNorm)) {
    throw new Error('Esse email já está cadastrado. Use "Já tenho cadastro" para entrar.');
  }
  const nomes = getConfig().names.map(function (n) { return n.toLowerCase(); });
  if (nomes.indexOf(nome.toLowerCase()) !== -1) {
    throw new Error('Já existe alguém chamado "' + nome + '". Use um sobrenome ou apelido.');
  }
  if (!vagasLivres_().length) {
    throw new Error('A casa já tem 5 pessoas cadastradas (o limite da planilha).');
  }
}

/**
 * Rode pelo editor para ligar (ou trocar) o código de convite. Gera um código
 * aleatório em Config!B45 e mostra no Log — mande esse código para os moradores.
 * Para desligar o cadastro pelo app, apague o conteúdo de Config!B45.
 */
function gerarCodigoConvite() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  sh.getRange('A44').setValue('7. Código de convite (cadastro pelo app)').setFontWeight('bold').setFontColor('#1F4E78');
  sh.getRange('A45').setValue('Convite');
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I para não confundir
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  sh.getRange(CFG_CONVITE_CELL).setValue(codigo).setBackground('#FFF2CC').setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.getRange('C45').setValue('Apague o código para fechar o cadastro pelo app.').setFontColor('#5b6779');
  Logger.log('Código de convite: ' + codigo + ' (também está em Config!B45)');
}

// ---------------------------------------------------------------- Sessões

function hashToken_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function criarSessao_(nome) {
  limparSessoesExpiradas_();
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const exp = Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000;
  PropertiesService.getScriptProperties()
    .setProperty(SESSION_PREFIX + hashToken_(token), JSON.stringify({ nome: nome, exp: exp }));
  return token;
}

function lerSessao_(token) {
  if (!token) return null;
  const props = PropertiesService.getScriptProperties();
  const key = SESSION_PREFIX + hashToken_(token);
  const raw = props.getProperty(key);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (!s.exp || s.exp < Date.now()) {
    props.deleteProperty(key);
    return null;
  }
  // Se a pessoa foi removida da Config, a sessão deixa de valer
  if (getConfig().names.indexOf(s.nome) === -1) {
    props.deleteProperty(key);
    return null;
  }
  return s;
}

function apagarSessao_(token) {
  if (!token) return;
  PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + hashToken_(token));
}

function limparSessoesExpiradas_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const agora = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) !== 0) return;
    try {
      if (JSON.parse(all[k]).exp < agora) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

/**
 * Rode pelo editor para desconectar TODO MUNDO de todos os aparelhos
 * (ex.: perdeu um celular). Cada pessoa vai precisar entrar de novo.
 */
function encerrarTodasAsSessoes() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) === 0) { props.deleteProperty(k); n++; }
  });
  Logger.log(n + ' sessão(ões) encerrada(s).');
}
