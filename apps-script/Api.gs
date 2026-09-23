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

// Ações que não exigem sessão
const PUBLIC_ACTIONS_ = {
  config: true,
  iniciarLogin: true,
  confirmarCodigo: true,
  loginPorNome: true
};

// Ações que gravam na planilha — rodam com LockService para evitar que dois
// lançamentos simultâneos caiam na mesma "primeira linha vazia".
const WRITE_ACTIONS_ = {
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
    return getConfig();
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
    if (cfg.emailsConfigured) throw new Error('Entre com seu email.');
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
