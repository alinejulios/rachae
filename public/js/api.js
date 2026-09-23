// Cliente da API do Apps Script (Api.gs).
//
// Usa POST com Content-Type text/plain para ser uma "simple request" de CORS:
// assim o navegador não manda preflight OPTIONS (que o Apps Script não
// responde). O Apps Script redireciona para script.googleusercontent.com, que
// devolve Access-Control-Allow-Origin: * — funciona no Safari e no Chrome.

const TOKEN_KEY = 'rachae_token';

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

async function api(action, params = {}) {
  const url = window.RACHAE_API_URL;
  if (!url) throw new ApiError('App ainda não configurado: preencha a URL da API em config.js.', 'CONFIG');
  if (!navigator.onLine) throw new ApiError('Sem internet. Confira a conexão e tente de novo.', 'OFFLINE');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getToken(), ...params }),
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal
    });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError'
      ? 'A planilha demorou demais para responder. Tente de novo.'
      : 'Não foi possível falar com a planilha. Tente de novo.', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  let body;
  try { body = await res.json(); } catch (e) {
    throw new ApiError('Resposta inesperada do servidor. Confira se o App da Web está publicado para "Qualquer pessoa".', 'BAD_RESPONSE');
  }
  if (!body.ok) {
    if (body.code === 'AUTH') setToken(null);
    throw new ApiError(body.error || 'Erro desconhecido.', body.code);
  }
  return body.data;
}
