import * as Firebase from './api.js';
import { api, PESSOAL } from './api.js';

// =================================================================== Estado
const STATE = {
  pessoa: null, config: null, dashboard: null, grupos: [], grupoAtual: null, currentTab: 'dashboard', charts: {},
  anoSelecionado: null, mesSelecionado: null
};
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const CAT_PALETTE_VARS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7', '--cat-8'];
const $ = id => document.getElementById(id);

// ---------- Armazenamento local (tudo em try/catch: modo privado do Safari pode bloquear) ----------
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
};
const K = {
  pessoa: 'rachae_pessoa',
  grupo: 'rachae_grupo', // + '_' + id da casa
  config: 'rachae_cache_config',
  grupos: 'rachae_cache_grupos',
  tags: 'rachae_tags',
  installDismissed: 'rachae_install_dismissed'
};

// ---------- Utilidades ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function categoriaCores(n) { return CAT_PALETTE_VARS.slice(0, n).map(cssVar); }
function mesAtualKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function anoAtual() { return new Date().getFullYear(); }
function labelMes(mesKey) { const p = mesKey.split('-'); return MESES_LONGOS[Number(p[1]) - 1] + ' de ' + p[0]; }
function fmtBRL(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const h = escapeHtml;
// Aceita "1.234,56", "1234,56", "1234.56" (teclado decimal do iOS/Android em pt-BR usa vírgula)
function parseMoney(raw) {
  let s = String(raw || '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
let TOAST_TIMER = null;
function showToast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = isError ? 'show error' : 'show';
  clearTimeout(TOAST_TIMER);
  TOAST_TIMER = setTimeout(() => { t.className = ''; }, isError ? 4500 : 2800);
}
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
function onApiError(err) {
  if (err && err.code === 'AUTH') { showToast(err.message, true); goToLogin(); return; }
  if (err && err.code === 'permission-denied') { showToast('Sem permissão. Talvez você tenha sido removida(o) do grupo.', true); return; }
  showToast((err && err.message) || 'Erro inesperado.', true);
}
async function withBusy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Enviando...'; }
  try { return await fn(); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}

// =================================================================== Delegação de eventos
// Sem onclick inline: permite uma Content-Security-Policy sem 'unsafe-inline' para scripts.
const ACTIONS = {};
document.addEventListener('click', ev => {
  const tabBtn = ev.target.closest('[data-tab]');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
  const el = ev.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) { ev.preventDefault(); ACTIONS[el.dataset.action](el, ev); }
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]');
  if (el && ACTIONS[el.dataset.change]) ACTIONS[el.dataset.change](el, ev);
});
document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-input]');
  if (el && ACTIONS[el.dataset.input]) ACTIONS[el.dataset.input](el, ev);
});
document.addEventListener('submit', ev => {
  const form = ev.target;
  if (form.dataset.submit && ACTIONS[form.dataset.submit]) {
    ev.preventDefault();
    ACTIONS[form.dataset.submit](form, ev);
  }
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const el = ev.target.closest('[data-enter]');
  if (el && ACTIONS[el.dataset.enter]) { ev.preventDefault(); ACTIONS[el.dataset.enter](el, ev); }
});
ACTIONS.reload = () => location.reload();

// =================================================================== Init / Login
function mostrarPasso(id) {
  ['login-step-loading', 'form-entrar', 'form-conta', 'form-senha', 'step-sem-casa', 'login-error']
    .forEach(x => $(x).classList.toggle('hidden', x !== id));
}
function mostrarErroInicial(msg) {
  mostrarPasso('login-error');
  $('login-error-msg').textContent = msg;
}
function hint(id, msg, tipo) {
  const el = $(id);
  el.textContent = msg || '';
  el.className = 'hint' + (tipo ? ' ' + tipo : '');
}

async function init() {
  ['form-entrar', 'form-conta', 'form-senha', 'form-convite', 'form-nova-casa'].forEach(id => {
    $(id).dataset.submit = 'submit_' + id.replace(/-/g, '_');
  });
  lerConviteDaUrl();
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  setupInstallPrompt();
  // Outra pessoa lançou algo: atualiza a tela na hora (Firestore em tempo real)
  let timer = null;
  window.addEventListener('rachae:dados', () => {
    clearTimeout(timer);
    timer = setTimeout(atualizarAoVivo, 300);
  });

  if (!Firebase.configurado) {
    mostrarErroInicial('App ainda não configurado: preencha public/firebase-config.js (veja o README).');
    return;
  }
  try {
    const user = await Firebase.aguardarSessao();
    if (!user) { irParaLogin(); return; }
    await abrirCasa(user);
  } catch (err) {
    mostrarErroInicial(err.message);
  }
}

// Depois do login: entra no app se já tem casa, senão pede convite / criar casa
function chaveGrupo() { return K.grupo + '_' + ((STATE.casa && STATE.casa.id) || ''); }

async function abrirCasa(user, hid) {
  mostrarPasso('login-step-loading');
  const casa = await Firebase.carregarCasa(hid);
  if (!casa) {
    STATE.pessoa = null;
    STATE.casa = null;
    document.body.classList.add('on-login');
    $('screen-app').classList.add('hidden');
    $('screen-login').classList.remove('hidden');
    $('sem-casa-nome').textContent = user.displayName || user.email;
    if (CONVITE_URL) $('convite-codigo').value = CONVITE_URL;
    mostrarPasso('step-sem-casa');
    // Chegou pelo link de convite e acabou de criar a conta: entra direto
    if (CONVITE_URL && user.displayName) ACTIONS.submit_form_convite($('form-convite'));
    return;
  }
  STATE.casa = casa;
  STATE.config = await api('config');
  enterApp(casa.meuNome);
}

function irParaLogin() {
  STATE.pessoa = null;
  document.body.classList.add('on-login');
  $('screen-app').classList.add('hidden');
  $('screen-login').classList.remove('hidden');
  if (CONVITE_URL) {
    $('conta-convite').value = CONVITE_URL;
    mostrarPasso('form-conta');
  } else {
    mostrarPasso('form-entrar');
  }
  renderInstallBanner();
}
async function goToLogin() {
  await Firebase.sair().catch(() => {});
  store.remove(K.pessoa);
  irParaLogin();
}
ACTIONS.irPara = el => {
  const passo = el.dataset.step;
  // leva o email digitado de um formulário para o outro
  const email = ['entrar-email', 'conta-email', 'senha-email'].map(id => $(id).value.trim()).find(Boolean) || '';
  ['entrar-email', 'conta-email', 'senha-email'].forEach(id => { if (!$(id).value) $(id).value = email; });
  mostrarPasso(passo);
};

// Link de convite: https://.../?convite=ABCD234567 preenche o código sozinho
let CONVITE_URL = '';
function lerConviteDaUrl() {
  try {
    const url = new URL(location.href);
    const c = url.searchParams.get('convite');
    if (!c) return;
    CONVITE_URL = c.trim().toUpperCase();
    url.searchParams.delete('convite');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (e) {}
}

ACTIONS.submit_form_entrar = async form => {
  const email = $('entrar-email').value.trim(), senha = $('entrar-senha').value;
  if (!email || !senha) { hint('entrar-hint', 'Preencha email e senha.', 'error'); return; }
  hint('entrar-hint', 'Entrando...');
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const user = await Firebase.entrar(email, senha);
      hint('entrar-hint', '');
      $('entrar-senha').value = '';
      await abrirCasa(user);
    } catch (err) { hint('entrar-hint', err.message, 'error'); vibrate(80); }
  });
};

ACTIONS.submit_form_conta = async form => {
  const nome = $('conta-nome').value.trim().replace(/\s+/g, ' ');
  const email = $('conta-email').value.trim();
  const senha = $('conta-senha').value;
  const convite = $('conta-convite').value.trim().toUpperCase();
  const erro = !/^[\p{L}][\p{L} .'-]{0,19}$/u.test(nome) ? 'Digite seu nome (até 20 letras, sem números).'
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Digite um email válido.'
    : senha.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.' : null;
  if (erro) { hint('conta-hint', erro, 'error'); vibrate(60); return; }
  hint('conta-hint', 'Criando conta...');
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const user = await Firebase.criarConta(nome, email, senha);
      $('conta-senha').value = '';
      hint('conta-hint', '');
      if (convite) CONVITE_URL = convite;
      await abrirCasa(user);
    } catch (err) { hint('conta-hint', err.message, 'error'); vibrate(80); }
  });
};

ACTIONS.submit_form_senha = async form => {
  const email = $('senha-email').value.trim();
  if (!email) { hint('senha-hint', 'Digite seu email.', 'error'); return; }
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await Firebase.esqueciSenha(email);
      hint('senha-hint', 'Pronto! Se esse email tiver conta, o link chega em instantes (confira o spam).', 'ok');
    } catch (err) { hint('senha-hint', err.message, 'error'); }
  });
};

ACTIONS.submit_form_convite = async form => {
  const codigo = $('convite-codigo').value.trim();
  if (!codigo) { hint('convite-hint', 'Digite o código de convite.', 'error'); return; }
  const user = Firebase.usuarioAtual();
  hint('convite-hint', 'Entrando no grupo...');
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await Firebase.entrarComConvite(codigo, user.displayName || user.email.split('@')[0]);
      CONVITE_URL = '';
      hint('convite-hint', '');
      await abrirCasa(user);
      showToast('Bem-vinda(o) ao grupo!');
    } catch (err) { hint('convite-hint', err.message, 'error'); vibrate(80); }
  });
};

ACTIONS.submit_form_nova_casa = async form => {
  const user = Firebase.usuarioAtual();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await Firebase.criarCasa($('casa-nome').value, user.displayName || user.email.split('@')[0], $('casa-pessoais').checked);
      await abrirCasa(user);
      switchTab('casa');
      showToast('Grupo criado! Agora convide as pessoas.');
    } catch (err) { hint('nova-casa-hint', err.message, 'error'); }
  });
};

// ---------- Sessão ----------
function enterApp(nome) {
  STATE.pessoa = nome;
  store.set(K.pessoa, nome);
  document.body.classList.remove('on-login');
  $('screen-login').classList.add('hidden');
  $('screen-app').classList.remove('hidden');
  $('who-name').textContent = nome;
  $('who-casa').textContent = (STATE.casa && STATE.casa.nome) || 'Rachaê';
  loadGrupos();
}
ACTIONS.logout = async () => {
  if (!confirm('Sair deste aparelho?')) return;
  await goToLogin();
};
ACTIONS.refresh = () => refreshCurrentTabData();

// Recarrega o que a tela atual mostra quando os dados mudam em outro aparelho.
// Formulários não são redesenhados (para não apagar o que a pessoa está digitando).
async function atualizarAoVivo() {
  if (!STATE.pessoa) return;
  try {
    STATE.config = await api('config');
    applyGrupos(await api('grupos'));
    const meuNome = await api('meuNome');
    if (meuNome && meuNome !== STATE.pessoa) { STATE.pessoa = meuNome; $('who-name').textContent = meuNome; }
    if (STATE.casa) $('who-casa').textContent = Firebase.casaAtual().nome;
    const saiuDaCasa = !meuNome;
    if (saiuDaCasa) { showToast('Você não faz mais parte deste grupo.', true); goToLogin(); return; }
    if (['dashboard', 'historico', 'casa', 'grupos'].includes(STATE.currentTab)) refreshCurrentTabData();
  } catch (err) { /* sem conexão: tenta na próxima mudança */ }
}

// ---------- Grupos ----------
async function loadGrupos() {
  try {
    applyGrupos(await api('grupos'));
  } catch (err) {
    showToast('Erro ao carregar conjuntos: ' + err.message, true);
    STATE.grupos = [];
  }
  // Ao abrir outro grupo, vai para o painel dele (exceto logo após criar, que abre os ajustes)
  switchTab(STATE.currentTab === 'casa' ? 'casa' : 'dashboard');
}
function pessoaisLigadas() { return !!(STATE.config && STATE.config.despesasPessoais); }
function noPessoal() { return STATE.grupoAtual === PESSOAL && pessoaisLigadas(); }
function applyGrupos(grupos) {
  STATE.grupos = grupos || [];
  const saved = store.get(chaveGrupo());
  const meusGrupos = STATE.grupos.filter(g => g.membros.indexOf(STATE.pessoa) >= 0);
  const valido = saved && (STATE.grupos.some(g => g.nome === saved) || (saved === PESSOAL && pessoaisLigadas()));
  STATE.grupoAtual = valido ? saved
    : (meusGrupos[0] ? meusGrupos[0].nome : (STATE.grupos[0] ? STATE.grupos[0].nome : null));
  renderGrupoSwitcher();
}
function renderGrupoSwitcher() {
  const sel = $('grupo-switcher');
  const opcoes = STATE.grupos.map(g => ({ valor: g.nome, rotulo: g.nome }));
  if (pessoaisLigadas()) opcoes.push({ valor: PESSOAL, rotulo: 'Pessoal (só você)' });
  sel.classList.toggle('hidden', opcoes.length <= 1);
  if (!opcoes.length) { sel.innerHTML = '<option value="">Sem conjuntos</option>'; return; }
  sel.innerHTML = opcoes.map(o =>
    `<option value="${h(o.valor)}" ${o.valor === STATE.grupoAtual ? 'selected' : ''}>${h(o.rotulo)}</option>`).join('');
}
ACTIONS.onGrupoSwitch = sel => {
  STATE.grupoAtual = sel.value;
  store.set(chaveGrupo(), sel.value);
  refreshCurrentTabData();
};
function refreshCurrentTabData() {
  switchTab(STATE.currentTab, { keepScroll: true });
}
function grupoMembros(nomeGrupo) {
  const g = STATE.grupos.find(g => g.nome === nomeGrupo);
  return (g && g.membros.length) ? g.membros : (STATE.config ? STATE.config.names : []);
}

// ---------- Tags locais (só neste aparelho, não vão para a planilha) ----------
const TAG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
function getTags(key) { return store.get(K.tags, {})[key] || []; }
function saveTags(key, tags) {
  const all = store.get(K.tags, {});
  if (tags.length) all[key] = tags; else delete all[key];
  store.set(K.tags, all);
}
function normalizeTag(raw) {
  let tag = String(raw || '').trim().replace(/\s+/g, '-');
  if (!tag) return '';
  return tag[0] === '#' ? tag : '#' + tag;
}
function tagColor(tag) {
  let x = 0;
  for (let i = 0; i < tag.length; i++) x = (x * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[x % TAG_COLORS.length];
}
function tagPill(t, removeAttrs) {
  const c = tagColor(t);
  return `<span class="tag-pill" style="background:${c}22;color:${c};border-color:${c}55">${h(t)}${
    removeAttrs ? `<button type="button" aria-label="Remover ${h(t)}" ${removeAttrs}>&times;</button>` : ''}</span>`;
}
// Editor de tags para itens já salvos (histórico): grava direto no localStorage
function renderHistTags(containerId, key) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = `<div class="tag-pills">
    ${getTags(key).map(t => tagPill(t, `data-action="removeHistTag" data-container="${h(containerId)}" data-key="${h(key)}" data-tag="${h(t)}"`)).join('')}
    <input type="text" class="tag-input" placeholder="+ tag" enterkeyhint="done" aria-label="Nova tag"
           data-enter="addHistTag" data-container="${h(containerId)}" data-key="${h(key)}">
  </div>`;
}
ACTIONS.addHistTag = el => {
  const tag = normalizeTag(el.value);
  if (!tag) return;
  const tags = getTags(el.dataset.key);
  if (tags.indexOf(tag) === -1) { tags.push(tag); saveTags(el.dataset.key, tags); }
  renderHistTags(el.dataset.container, el.dataset.key);
};
ACTIONS.removeHistTag = el => {
  saveTags(el.dataset.key, getTags(el.dataset.key).filter(t => t !== el.dataset.tag));
  renderHistTags(el.dataset.container, el.dataset.key);
};
// Editor de tags "rascunho" para formulários novos (o item ainda não tem linha/ID na planilha)
const TAG_DRAFTS = {};
function renderTagEditor(containerId) {
  const el = $(containerId);
  if (!el) return;
  const tags = TAG_DRAFTS[containerId] || [];
  el.innerHTML = `<div class="tag-pills">
    ${tags.map(t => tagPill(t, `data-action="removeDraftTag" data-container="${h(containerId)}" data-tag="${h(t)}"`)).join('')}
    <input type="text" class="tag-input" placeholder="+ tag" enterkeyhint="done" aria-label="Nova tag"
           data-enter="addDraftTag" data-container="${h(containerId)}">
  </div>
  <p class="tags-hint">Tags ficam só neste aparelho — não vão para a planilha.</p>`;
}
ACTIONS.addDraftTag = el => {
  const tag = normalizeTag(el.value);
  if (!tag) return;
  const id = el.dataset.container;
  TAG_DRAFTS[id] = TAG_DRAFTS[id] || [];
  if (TAG_DRAFTS[id].indexOf(tag) === -1) TAG_DRAFTS[id].push(tag);
  renderTagEditor(id);
  const input = $(id).querySelector('.tag-input');
  if (input) input.focus();
};
ACTIONS.removeDraftTag = el => {
  const id = el.dataset.container;
  TAG_DRAFTS[id] = (TAG_DRAFTS[id] || []).filter(t => t !== el.dataset.tag);
  renderTagEditor(id);
};

// =================================================================== Navegação
function switchTab(tab, opts = {}) {
  STATE.currentTab = tab;
  ['dashboard', 'despesa', 'compra', 'pagamento', 'historico', 'casa', 'grupos'].forEach(t => {
    $('tab-' + t).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('nav.tabbar button').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (!opts.keepScroll) window.scrollTo(0, 0);

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'despesa') renderDespesaForm();
  if (tab === 'compra') renderCompraForm();
  if (tab === 'pagamento') renderPagamentoForm();
  if (tab === 'historico') loadHistorico();
  if (tab === 'casa') renderCasa();
  if (tab === 'grupos') renderMeusGrupos();
}

// =================================================================== Dashboard
async function loadDashboard() {
  const grupo = STATE.grupoAtual;
  try {
    const d = await api('dashboard', { grupo });
    if (STATE.currentTab !== 'dashboard') return;
    STATE.dashboard = d;
    if (d.grupoAtual && d.grupoAtual !== STATE.grupoAtual) {
      STATE.grupoAtual = d.grupoAtual;
      store.set(chaveGrupo(), d.grupoAtual);
      renderGrupoSwitcher();
    }
    renderDashboard(d);
  } catch (err) {
    onApiError(err);
    $('tab-dashboard').innerHTML = `<div class="card"><p class="empty">${h(err.message)}</p>
      <button class="primary" type="button" data-action="refresh">Tentar de novo</button></div>`;
  }
}
function statusIconSvg(kind) {
  if (kind === 'good') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5"/></svg>';
  if (kind === 'critical') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8.5 12.5 12 16l3.5-3.5"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 11 15l4.5-6"/></svg>';
}
function renderDashboard(d) {
  if (d.pessoalMode) { renderDashboardPessoal(d); return; }
  const el = $('tab-dashboard');
  const p = d.pessoal || { saldoGeral: 0, saldoAv: 0, saldoParc: 0 };
  const statusKind = p.saldoGeral > 0.5 ? 'good' : (p.saldoGeral < -0.5 ? 'critical' : 'neutral');
  const statusClass = 'status-' + statusKind;
  const statusLabel = { good: 'A RECEBER', critical: 'A PAGAR', neutral: 'QUITADO' }[statusKind];
  const grupoLabel = d.grupoAtual ? ' · ' + d.grupoAtual : '';
  const naoEhMembro = d.grupoAtual && !d.pessoal;

  const anos = Array.from(new Set((d.evolucaoMensal || []).map(m => Number(m.mes.slice(0, 4)))));
  if (anos.indexOf(anoAtual()) === -1) anos.push(anoAtual());
  anos.sort((a, b) => b - a);
  if (!STATE.anoSelecionado || anos.indexOf(STATE.anoSelecionado) === -1) STATE.anoSelecionado = anoAtual();

  const meses = Object.keys(d.catPorMes || {});
  if (meses.indexOf(mesAtualKey()) === -1) meses.push(mesAtualKey());
  meses.sort().reverse();
  if (!STATE.mesSelecionado || (STATE.mesSelecionado !== 'todos' && meses.indexOf(STATE.mesSelecionado) === -1)) {
    STATE.mesSelecionado = mesAtualKey();
  }
  const nReemb = (d.reembolsosPorPessoa || []).length;

  el.innerHTML = `
    <div id="install-card"></div>
    <div class="card hero">
      <div class="label">Seu saldo geral${h(grupoLabel)}</div>
      <div class="value ${statusClass}">${fmtBRL(Math.abs(p.saldoGeral))}</div>
      <div class="status ${statusClass}">${statusIconSvg(statusKind)}${statusLabel}</div>
      ${naoEhMembro ? `<p class="hint">Você não participa do conjunto "${h(d.grupoAtual)}".</p>` : ''}
      <div class="stat-row">
        <div class="stat-tile"><div class="l">Saldo avulsas</div><div class="v">${fmtBRL(p.saldoAv)}</div></div>
        <div class="stat-tile"><div class="l">Saldo parceladas</div><div class="v">${fmtBRL(p.saldoParc)}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>Saldo de todos</h3>
      <div id="saldos-bars"></div>
    </div>

    <div class="card">
      <div class="chart-head">
        <h3>Gastos por mês</h3>
        <select id="ano-select" class="chart-select" data-change="onAnoChange" aria-label="Ano">
          ${anos.map(a => `<option value="${a}" ${a === STATE.anoSelecionado ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
      <div class="chart-box" style="height:220px"><canvas id="chart-mensal"></canvas></div>
      <p class="empty hidden" id="chart-mensal-empty">Sem lançamentos neste ano ainda.</p>
      <p class="hint" id="mensal-comparacao-hint"></p>
    </div>

    <div class="card">
      <div class="chart-head">
        <h3>Categorias</h3>
        <select id="mes-select" class="chart-select" data-change="onMesChange" aria-label="Mês">
          <option value="todos" ${STATE.mesSelecionado === 'todos' ? 'selected' : ''}>Todos os meses</option>
          ${meses.map(m => `<option value="${m}" ${m === STATE.mesSelecionado ? 'selected' : ''}>${labelMes(m)}</option>`).join('')}
        </select>
      </div>
      <div class="chart-box" style="height:300px"><canvas id="chart-categoria-mes"></canvas></div>
      <p class="empty hidden" id="chart-categoria-mes-empty">Sem despesas neste período ainda.</p>
    </div>

    <div class="card">
      <h3>Reembolsos recebidos</h3>
      <p class="hint" style="margin:-6px 0 10px;">Quanto cada pessoa já recebeu de volta, em parcelas pagas.</p>
      <div class="chart-box" style="height:${Math.max(90, nReemb * 40)}px"><canvas id="chart-reembolsos"></canvas></div>
      <p class="empty hidden" id="chart-reembolsos-empty">Nenhum reembolso registrado ainda.</p>
    </div>
  `;

  renderInstallCard();
  renderSaldoBars(d.saldosPorPessoa || []);
  renderChartMensal();
  renderChartCategoriaMes();
  renderChartReembolsos(d.reembolsosPorPessoa || []);
}
function seletoresGraficos(d) {
  const anos = Array.from(new Set((d.evolucaoMensal || []).map(m => Number(m.mes.slice(0, 4)))));
  if (anos.indexOf(anoAtual()) === -1) anos.push(anoAtual());
  anos.sort((a, b) => b - a);
  if (!STATE.anoSelecionado || anos.indexOf(STATE.anoSelecionado) === -1) STATE.anoSelecionado = anoAtual();
  const meses = Object.keys(d.catPorMes || {});
  if (meses.indexOf(mesAtualKey()) === -1) meses.push(mesAtualKey());
  meses.sort().reverse();
  if (!STATE.mesSelecionado || (STATE.mesSelecionado !== 'todos' && meses.indexOf(STATE.mesSelecionado) === -1)) {
    STATE.mesSelecionado = mesAtualKey();
  }
  return { anos, meses };
}
// Conjunto pessoal: só os gastos da própria pessoa, sem saldos nem divisão
function renderDashboardPessoal(d) {
  const { anos, meses } = seletoresGraficos(d);
  $('tab-dashboard').innerHTML = `
    <div id="install-card"></div>
    <div class="card hero">
      <div class="label">Seus gastos pessoais em ${MESES_LONGOS[new Date().getMonth()].toLowerCase()} (com parcelas do mês)</div>
      <div class="value">${fmtBRL(d.totalMes)}</div>
      <div class="status status-neutral">🔒 Só você vê</div>
      <div class="stat-row">
        <div class="stat-tile"><div class="l">Lançamentos no mês</div><div class="v">${d.qtdMes}</div></div>
        <div class="stat-tile"><div class="l">Parcelas a vencer</div><div class="v">${fmtBRL(d.parcelasFuturas)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="chart-head">
        <h3>Gastos por mês</h3>
        <select id="ano-select" class="chart-select" data-change="onAnoChange" aria-label="Ano">
          ${anos.map(a => `<option value="${a}" ${a === STATE.anoSelecionado ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
      <div class="chart-box" style="height:220px"><canvas id="chart-mensal"></canvas></div>
      <p class="empty hidden" id="chart-mensal-empty">Sem gastos pessoais neste ano ainda.</p>
      <p class="hint" id="mensal-comparacao-hint"></p>
    </div>
    <div class="card">
      <div class="chart-head">
        <h3>Categorias</h3>
        <select id="mes-select" class="chart-select" data-change="onMesChange" aria-label="Mês">
          <option value="todos" ${STATE.mesSelecionado === 'todos' ? 'selected' : ''}>Todos os meses</option>
          ${meses.map(m => `<option value="${m}" ${m === STATE.mesSelecionado ? 'selected' : ''}>${labelMes(m)}</option>`).join('')}
        </select>
      </div>
      <div class="chart-box" style="height:300px"><canvas id="chart-categoria-mes"></canvas></div>
      <p class="empty hidden" id="chart-categoria-mes-empty">Sem gastos neste período ainda.</p>
    </div>
  `;
  renderInstallCard();
  renderChartMensal();
  renderChartCategoriaMes();
}
ACTIONS.onAnoChange = el => { STATE.anoSelecionado = Number(el.value); renderChartMensal(); };
ACTIONS.onMesChange = el => { STATE.mesSelecionado = el.value; renderChartCategoriaMes(); };

function renderSaldoBars(saldos) {
  const wrap = $('saldos-bars');
  if (!saldos.length) { wrap.innerHTML = '<p class="empty">Sem lançamentos ainda.</p>'; return; }
  const max = Math.max(1, ...saldos.map(s => Math.abs(s.saldoGeral)));
  wrap.innerHTML = saldos.map(s => {
    const good = s.saldoGeral >= 0;
    const pct = Math.min(100, Math.round(Math.abs(s.saldoGeral) / max * 100));
    const color = good ? 'var(--good)' : 'var(--critical)';
    return `<div class="bar-row">
      <div class="name">${h(s.nome)}</div>
      <div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="val" style="color:${good ? 'var(--good-text)' : 'var(--critical)'}">${fmtBRL(s.saldoGeral)}</div>
    </div>`;
  }).join('');
}
function destroyChart(key) {
  if (STATE.charts[key]) { STATE.charts[key].destroy(); delete STATE.charts[key]; }
}
function toggleChartEmpty(canvasId, emptyId, isEmpty) {
  const ctx = $(canvasId), emptyEl = $(emptyId);
  if (!ctx || !emptyEl) return false;
  ctx.parentElement.classList.toggle('hidden', isEmpty);
  emptyEl.classList.toggle('hidden', !isEmpty);
  return true;
}
function chartsReady() { return typeof window.Chart !== 'undefined'; }
function fmtBRLCurto(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  return 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
    interaction: { mode: 'nearest', intersect: true }
  };
}

function renderChartMensal() {
  destroyChart('mensal');
  const d = STATE.dashboard;
  const hintEl = $('mensal-comparacao-hint');
  if (!d || !$('chart-mensal') || !chartsReady()) return;
  const ano = STATE.anoSelecionado;

  const porMes = {};
  (d.evolucaoMensal || []).forEach(m => { porMes[m.mes] = m.valor; });
  const atual = [], anterior = [];
  for (let mm = 1; mm <= 12; mm++) {
    atual.push(porMes[ano + '-' + String(mm).padStart(2, '0')] || 0);
    anterior.push(porMes[(ano - 1) + '-' + String(mm).padStart(2, '0')] || 0);
  }
  const temAnoAnterior = (d.evolucaoMensal || []).some(m => m.mes.indexOf(String(ano - 1) + '-') === 0);

  // Em um ano em andamento, compara só os meses já decorridos
  const hoje = new Date();
  const mesesConsiderados = (ano === hoje.getFullYear()) ? (hoje.getMonth() + 1) : 12;
  const totalAtual = atual.slice(0, mesesConsiderados).reduce((s, v) => s + v, 0);
  const totalAnterior = anterior.slice(0, mesesConsiderados).reduce((s, v) => s + v, 0);
  const semNada = atual.every(v => v === 0) && !temAnoAnterior;
  if (!toggleChartEmpty('chart-mensal', 'chart-mensal-empty', semNada)) return;
  if (semNada) { hintEl.textContent = ''; return; }

  const datasets = [{ label: String(ano), data: atual, backgroundColor: cssVar('--brand-blue'), borderRadius: 4, maxBarThickness: 18 }];
  if (temAnoAnterior) {
    datasets.push({ label: String(ano - 1), data: anterior, backgroundColor: cssVar('--brand-aqua'), borderRadius: 4, maxBarThickness: 18 });
  }
  STATE.charts.mensal = new Chart($('chart-mensal'), {
    type: 'bar',
    data: { labels: MESES_ABREV, datasets },
    options: {
      ...baseChartOptions(),
      plugins: {
        legend: { display: temAnoAnterior, position: 'top', align: 'end', labels: { boxWidth: 12, font: { size: 12 }, color: cssVar('--text-secondary') } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmtBRL(c.raw) } }
      },
      scales: {
        y: { grid: { color: cssVar('--gridline') }, border: { display: false }, ticks: { callback: fmtBRLCurto, color: cssVar('--text-muted'), maxTicksLimit: 5 } },
        x: { grid: { display: false }, ticks: { color: cssVar('--text-muted'), autoSkip: false, maxRotation: 0, font: { size: 10 } } }
      }
    }
  });

  const periodoLabel = mesesConsiderados < 12 ? ' (' + MESES_ABREV[0] + '–' + MESES_ABREV[mesesConsiderados - 1] + ')' : '';
  if (temAnoAnterior) {
    const diff = totalAtual - totalAnterior;
    const pct = totalAnterior > 0 ? (diff / totalAnterior * 100) : (totalAtual > 0 ? 100 : 0);
    hintEl.className = 'hint' + (diff > 0 ? ' warn' : (diff < 0 ? ' ok' : ''));
    hintEl.textContent = 'Total ' + ano + periodoLabel + ': ' + fmtBRL(totalAtual) + ' · ' + (diff > 0 ? '+' : '') + pct.toFixed(0) +
      '% vs ' + (ano - 1) + ' (' + fmtBRL(totalAnterior) + ')';
  } else {
    hintEl.className = 'hint';
    hintEl.textContent = 'Total ' + ano + periodoLabel + ': ' + fmtBRL(totalAtual);
  }
}

function renderChartCategoriaMes() {
  destroyChart('categoriaMes');
  const d = STATE.dashboard;
  if (!d || !$('chart-categoria-mes') || !chartsReady()) return;
  const mes = STATE.mesSelecionado;
  const dados = mes === 'todos' ? (d.gastosPorCategoria || []) : ((d.catPorMes && d.catPorMes[mes]) || []);
  if (!toggleChartEmpty('chart-categoria-mes', 'chart-categoria-mes-empty', !dados.length)) return;
  if (!dados.length) return;

  const MAX_SLOTS = 8;
  const top = dados.slice(0, MAX_SLOTS);
  const resto = dados.slice(MAX_SLOTS).reduce((s, c) => s + c.valor, 0);
  const labels = top.map(c => c.categoria);
  const valores = top.map(c => c.valor);
  const cores = categoriaCores(top.length);
  if (resto > 0) { labels.push('Outras'); valores.push(Math.round(resto * 100) / 100); cores.push(cssVar('--cat-other')); }

  STATE.charts.categoriaMes = new Chart($('chart-categoria-mes'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: valores, backgroundColor: cores, borderColor: cssVar('--surface-1'), borderWidth: 2 }] },
    options: {
      ...baseChartOptions(),
      cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 12 }, color: cssVar('--text-secondary') } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmtBRL(c.raw) } }
      }
    }
  });
}

function renderChartReembolsos(lista) {
  destroyChart('reembolsos');
  if (!$('chart-reembolsos') || !chartsReady()) return;
  const semNada = !lista.length || lista.every(r => r.valor <= 0);
  if (!toggleChartEmpty('chart-reembolsos', 'chart-reembolsos-empty', semNada)) return;
  if (semNada) return;
  STATE.charts.reembolsos = new Chart($('chart-reembolsos'), {
    type: 'bar',
    data: {
      labels: lista.map(r => r.nome),
      datasets: [{ data: lista.map(r => r.valor), backgroundColor: cssVar('--brand-aqua'), borderRadius: 4, maxBarThickness: 22 }]
    },
    options: {
      ...baseChartOptions(),
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtBRL(c.raw) } } },
      scales: {
        x: { grid: { color: cssVar('--gridline') }, border: { display: false }, ticks: { callback: fmtBRLCurto, color: cssVar('--text-muted'), maxTicksLimit: 4 } },
        y: { grid: { display: false }, ticks: { color: cssVar('--text-secondary'), font: { weight: 'bold' } } }
      }
    }
  });
}

// =================================================================== Formulários (Despesa / Compra)
function grupoInicial() {
  const grupos = STATE.grupos;
  return (grupos.some(g => g.nome === STATE.grupoAtual) ? STATE.grupoAtual : (grupos[0] && grupos[0].nome)) || '';
}
function optionsHtml(list, selected) {
  return list.map(v => `<option value="${h(v)}" ${v === selected ? 'selected' : ''}>${h(v)}</option>`).join('');
}
function moneyInput(id, extraAttrs = '') {
  return `<div class="money"><input type="text" id="${id}" inputmode="decimal" autocomplete="off" placeholder="0,00" enterkeyhint="next" ${extraAttrs}></div>`;
}

function renderDespesaForm() {
  const el = $('tab-despesa');
  const cfg = STATE.config;
  if (!STATE.grupos.length && !pessoaisLigadas()) {
    el.innerHTML = '<div class="card"><h3>Nova despesa</h3><p class="empty">Nenhum conjunto de despesas ainda. Crie um na tela do grupo (ícone de pessoa, no topo).</p></div>';
    return;
  }
  TAG_DRAFTS['desp-tags-editor'] = [];
  el.innerHTML = `
    <form class="card" data-submit="submitDespesa" novalidate autocomplete="off">
      <h3>Nova despesa</h3>
      <label for="desp-descricao">Descrição</label>
      <input type="text" id="desp-descricao" placeholder="Ex.: Conta de luz" autocapitalize="sentences" enterkeyhint="next">
      <label for="desp-valor">Valor total</label>
      ${moneyInput('desp-valor', 'data-input="updateDivisaoHintFromValor" data-prefix="desp"')}
      <label for="desp-data">Data</label>
      <input type="date" id="desp-data" value="${todayStr()}">
      <label for="desp-categoria">Categoria</label>
      <select id="desp-categoria">${optionsHtml(cfg.categorias)}</select>
      <label for="desp-segmento">Segmento</label>
      <select id="desp-segmento">${optionsHtml(cfg.segmentos)}</select>
      <label for="desp-grupo">Conjunto de despesas</label>
      <select id="desp-grupo" data-change="renderPessoasFields" data-prefix="desp">${optionsHtml(STATE.grupos.map(g => g.nome), noPessoal() ? null : grupoInicial())}${
        pessoaisLigadas() ? `<option value="${PESSOAL}" ${noPessoal() ? 'selected' : ''}>Pessoal (só você)</option>` : ''}</select>
      <div id="desp-pessoas-fields"></div>
      <span class="field-label">Tags</span>
      <div id="desp-tags-editor"></div>
      <button class="primary" type="submit">Adicionar despesa</button>
    </form>
  `;
  renderPessoasFields('desp');
  renderTagEditor('desp-tags-editor');
}

function renderCompraForm() {
  const el = $('tab-compra');
  const cfg = STATE.config;
  if (!STATE.grupos.length && !pessoaisLigadas()) {
    el.innerHTML = '<div class="card"><h3>Nova compra parcelada</h3><p class="empty">Nenhum conjunto de despesas ainda. Crie um na tela do grupo (ícone de pessoa, no topo).</p></div>';
    return;
  }
  TAG_DRAFTS['compra-tags-editor'] = [];
  el.innerHTML = `
    <form class="card" data-submit="submitCompra" novalidate autocomplete="off">
      <h3>Nova compra parcelada no cartão</h3>
      <label for="compra-descricao">Descrição</label>
      <input type="text" id="compra-descricao" placeholder="Ex.: Sofá novo" autocapitalize="sentences" enterkeyhint="next">
      <label for="compra-valor">Valor total</label>
      ${moneyInput('compra-valor', 'data-input="updateParcelaPreview"')}
      <label for="compra-nparc">Nº de parcelas</label>
      <input type="text" id="compra-nparc" value="1" inputmode="numeric" pattern="[0-9]*" data-input="updateParcelaPreview">
      <p class="hint" id="compra-parcela-hint"></p>
      <label for="compra-data">Data da compra</label>
      <input type="date" id="compra-data" value="${todayStr()}">
      <label for="compra-categoria">Categoria</label>
      <select id="compra-categoria">${optionsHtml(cfg.categorias)}</select>
      <label for="compra-grupo">Conjunto de despesas</label>
      <select id="compra-grupo" data-change="renderPessoasFields" data-prefix="compra">${optionsHtml(STATE.grupos.map(g => g.nome), noPessoal() ? null : grupoInicial())}${
        pessoaisLigadas() ? `<option value="${PESSOAL}" ${noPessoal() ? 'selected' : ''}>Pessoal (só você)</option>` : ''}</select>
      <div id="compra-pessoas-fields"></div>
      <span class="field-label">Tags</span>
      <div id="compra-tags-editor"></div>
      <button class="primary" type="submit">Adicionar compra parcelada</button>
    </form>
  `;
  renderPessoasFields('compra');
  renderTagEditor('compra-tags-editor');
}

// Campos que dependem do grupo: quem pagou, quem participa, método de divisão
function renderPessoasFields(prefixOrEl) {
  const prefix = typeof prefixOrEl === 'string' ? prefixOrEl : prefixOrEl.dataset.prefix;
  const pessoal = $(prefix + '-grupo').value === PESSOAL;
  const seg = $(prefix + '-segmento');
  if (seg) seg.closest('form').querySelector('label[for="' + prefix + '-segmento"]').classList.toggle('hidden', pessoal);
  if (seg) seg.classList.toggle('hidden', pessoal);
  if (pessoal) {
    $(prefix + '-pessoas-fields').innerHTML = (prefix === 'compra'
      ? '<p class="hint">🔒 Compra pessoal: só você vê. Cada parcela entra no painel no mês em que vence, a partir do mês da compra.</p>'
      : '<p class="hint">🔒 Despesa pessoal: só você vê e ela não entra na divisão do grupo.</p>');
    return;
  }
  const membros = grupoMembros($(prefix + '-grupo').value);
  const pagadorLabel = prefix === 'desp' ? 'Pago por' : 'Comprador (quem colocou no cartão)';
  const pagadorId = prefix === 'desp' ? 'desp-pagopor' : 'compra-comprador';
  const oque = prefix === 'desp' ? 'desta despesa' : 'desta compra';
  $(prefix + '-pessoas-fields').innerHTML = `
    <label for="${pagadorId}">${pagadorLabel}</label>
    <select id="${pagadorId}">${optionsHtml(membros, STATE.pessoa)}</select>
    <span class="field-label">Quem participa ${oque}?</span>
    <div class="participa-grid">
      ${membros.map(n => `
        <label class="participa-item">
          <input type="checkbox" class="${prefix}-participa-input" data-nome="${h(n)}" data-change="onParticipaChange" data-prefix="${prefix}">
          ${h(n)}
        </label>`).join('')}
    </div>
    <div class="participa-actions">
      <button type="button" class="link-btn" data-action="setAllParticipantes" data-prefix="${prefix}" data-checked="1">Marcar todos</button>
      <button type="button" class="link-btn" data-action="setAllParticipantes" data-prefix="${prefix}" data-checked="0">Limpar</button>
    </div>
    <p class="hint" id="${prefix}-participa-hint"></p>
    <label for="${prefix}-metodo">Método de divisão</label>
    <select id="${prefix}-metodo" data-change="renderDivisaoFields" data-prefix="${prefix}">${optionsHtml(STATE.config.metodos)}</select>
    <div id="${prefix}-divisao"></div>
  `;
  updateParticipaHint(prefix);
  renderDivisaoFields(prefix);
}
ACTIONS.renderPessoasFields = renderPessoasFields;

function getParticipantesSelecionados(prefix) {
  return Array.from(document.querySelectorAll('.' + prefix + '-participa-input:checked')).map(i => i.dataset.nome);
}
ACTIONS.setAllParticipantes = el => {
  const prefix = el.dataset.prefix;
  document.querySelectorAll('.' + prefix + '-participa-input').forEach(i => { i.checked = el.dataset.checked === '1'; });
  ACTIONS.onParticipaChange(el);
};
ACTIONS.onParticipaChange = el => {
  updateParticipaHint(el.dataset.prefix);
  renderDivisaoFields(el.dataset.prefix);
};
function updateParticipaHint(prefix) {
  const hint = $(prefix + '-participa-hint');
  if (!hint) return;
  const n = getParticipantesSelecionados(prefix).length;
  hint.textContent = n === 0 ? 'Marque pelo menos uma pessoa.' : n + (n > 1 ? ' pessoas marcadas.' : ' pessoa marcada.');
  hint.className = 'hint ' + (n === 0 ? 'warn' : 'ok');
}
function renderDivisaoFields(prefixOrEl) {
  const prefix = typeof prefixOrEl === 'string' ? prefixOrEl : prefixOrEl.dataset.prefix;
  const metodoEl = $(prefix + '-metodo');
  if (!metodoEl) return;
  const metodo = metodoEl.value;
  const wrap = $(prefix + '-divisao');
  const membros = getParticipantesSelecionados(prefix);
  if (!membros.length) { wrap.innerHTML = ''; return; }
  if (metodo === 'Igual') {
    const total = parseMoney($(prefix + '-valor').value);
    const cada = total > 0 ? ' (' + fmtBRL(total / membros.length) + ' cada)' : '';
    wrap.innerHTML = `<p class="hint">Dividido igualmente entre ${membros.length} ${membros.length > 1 ? 'pessoas' : 'pessoa'}${cada}.</p>`;
    return;
  }
  const isPct = metodo === 'Porcentagem';
  wrap.innerHTML = `
    <span class="field-label">${isPct ? 'Porcentagem de cada pessoa (%)' : 'Valor de cada pessoa'}</span>
    <div class="divisao-grid">
      ${membros.map(n => `
        <div class="divisao-item">
          <label>${h(n)}</label>
          ${isPct
            ? `<input type="text" inputmode="decimal" class="${prefix}-div-input" data-nome="${h(n)}" data-input="updateDivisaoHint" data-prefix="${prefix}" placeholder="0">`
            : `<div class="money"><input type="text" inputmode="decimal" class="${prefix}-div-input" data-nome="${h(n)}" data-input="updateDivisaoHint" data-prefix="${prefix}" placeholder="0,00"></div>`}
        </div>`).join('')}
    </div>
    <p class="hint" id="${prefix}-divisao-hint"></p>
  `;
  updateDivisaoHint(prefix);
}
ACTIONS.renderDivisaoFields = renderDivisaoFields;

function divisaoSoma(prefix) {
  let sum = 0;
  document.querySelectorAll('.' + prefix + '-div-input').forEach(i => { sum += parseMoney(i.value) || 0; });
  return sum;
}
function updateDivisaoHint(prefixOrEl) {
  const prefix = typeof prefixOrEl === 'string' ? prefixOrEl : prefixOrEl.dataset.prefix;
  const hint = $(prefix + '-divisao-hint');
  if (!hint) return;
  const isPct = $(prefix + '-metodo').value === 'Porcentagem';
  const sum = divisaoSoma(prefix);
  const valorTotal = parseMoney($(prefix + '-valor').value) || 0;
  if (isPct) {
    hint.textContent = 'Soma: ' + sum.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% (deve dar 100%)';
    hint.className = 'hint ' + (Math.abs(sum - 100) < 0.5 ? 'ok' : 'warn');
  } else {
    hint.textContent = 'Soma: ' + fmtBRL(sum) + ' de ' + fmtBRL(valorTotal);
    hint.className = 'hint ' + (Math.abs(sum - valorTotal) < 0.5 ? 'ok' : 'warn');
  }
}
ACTIONS.updateDivisaoHint = updateDivisaoHint;
ACTIONS.updateDivisaoHintFromValor = el => {
  const prefix = el.dataset.prefix;
  if ($(prefix + '-metodo') && $(prefix + '-metodo').value === 'Igual') renderDivisaoFields(prefix);
  else updateDivisaoHint(prefix);
};
function collectDivisao(prefix, isPct) {
  const divisao = {};
  document.querySelectorAll('.' + prefix + '-div-input').forEach(i => {
    if (i.value.trim() !== '') {
      const v = parseMoney(i.value);
      divisao[i.dataset.nome] = isPct ? v / 100 : v;
    }
  });
  return divisao;
}
// Validação comum; devolve mensagem de erro ou null
function validarLancamento(prefix, valorTotal, participantes) {
  if (!$(prefix + '-descricao').value.trim()) return 'Preencha a descrição.';
  if (!(valorTotal > 0)) return 'Informe um valor maior que zero.';
  if (!participantes.length) return 'Marque quem participa.';
  const metodo = $(prefix + '-metodo').value;
  if (metodo === 'Porcentagem' && Math.abs(divisaoSoma(prefix) - 100) >= 0.5) return 'As porcentagens precisam somar 100%.';
  if (metodo !== 'Igual' && metodo !== 'Porcentagem' && Math.abs(divisaoSoma(prefix) - valorTotal) >= 0.5) {
    return 'Os valores de cada pessoa precisam somar ' + fmtBRL(valorTotal) + '.';
  }
  return null;
}

ACTIONS.submitDespesa = async form => {
  if ($('desp-grupo').value === PESSOAL) { await submitDespesaPessoal(form); return; }
  const metodo = $('desp-metodo').value;
  const participantes = getParticipantesSelecionados('desp');
  const valorTotal = parseMoney($('desp-valor').value);
  const erro = validarLancamento('desp', valorTotal, participantes);
  if (erro) { showToast(erro, true); vibrate(60); return; }
  const payload = {
    data: $('desp-data').value || todayStr(),
    descricao: $('desp-descricao').value.trim(),
    categoria: $('desp-categoria').value,
    segmento: $('desp-segmento').value,
    grupo: $('desp-grupo').value,
    valorTotal,
    pagoPor: $('desp-pagopor').value,
    metodo,
    participantes,
    divisao: metodo === 'Igual' ? null : collectDivisao('desp', metodo === 'Porcentagem')
  };
  const tags = (TAG_DRAFTS['desp-tags-editor'] || []).slice();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await api('addDespesa', { payload });
      if (tags.length && res && res.row) saveTags('desp:' + res.row, tags);
      vibrate(20);
      showToast('Despesa adicionada!');
      renderDespesaForm();
    } catch (err) { onApiError(err); }
  });
};

async function submitCompraPessoal(form) {
  const valorTotal = parseMoney($('compra-valor').value);
  const nParcelas = parseInt($('compra-nparc').value, 10);
  const erro = !$('compra-descricao').value.trim() ? 'Preencha a descrição.'
    : !(valorTotal > 0) ? 'Informe um valor maior que zero.'
    : !(nParcelas >= 1 && nParcelas <= 60) ? 'Informe de 1 a 60 parcelas.' : null;
  if (erro) { showToast(erro, true); vibrate(60); return; }
  const payload = {
    grupo: PESSOAL, data: $('compra-data').value || todayStr(), descricao: $('compra-descricao').value.trim(),
    categoria: $('compra-categoria').value, valorTotal, nParcelas
  };
  const tags = (TAG_DRAFTS['compra-tags-editor'] || []).slice();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await api('addCompraParcelada', { payload });
      if (tags.length && res && res.id) saveTags('compra:' + res.id, tags);
      vibrate(20);
      showToast('Compra parcelada pessoal adicionada!');
      renderCompraForm();
    } catch (err) { onApiError(err); }
  });
}
async function submitDespesaPessoal(form) {
  const valorTotal = parseMoney($('desp-valor').value);
  if (!$('desp-descricao').value.trim()) { showToast('Preencha a descrição.', true); vibrate(60); return; }
  if (!(valorTotal > 0)) { showToast('Informe um valor maior que zero.', true); vibrate(60); return; }
  const payload = {
    grupo: PESSOAL, data: $('desp-data').value || todayStr(), descricao: $('desp-descricao').value.trim(),
    categoria: $('desp-categoria').value, valorTotal
  };
  const tags = (TAG_DRAFTS['desp-tags-editor'] || []).slice();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await api('addDespesa', { payload });
      if (tags.length && res && res.row) saveTags('desp:' + res.row, tags);
      vibrate(20);
      showToast('Despesa pessoal adicionada!');
      renderDespesaForm();
    } catch (err) { onApiError(err); }
  });
}
ACTIONS.updateParcelaPreview = () => {
  const valor = parseMoney($('compra-valor').value) || 0;
  const n = parseInt($('compra-nparc').value, 10) || 0;
  $('compra-parcela-hint').textContent = (valor > 0 && n > 0) ? n + 'x de ' + fmtBRL(valor / n) + ' no cartão de quem comprou' : '';
  if ($('compra-metodo') && $('compra-metodo').value === 'Igual') renderDivisaoFields('compra');
  else updateDivisaoHint('compra');
};
ACTIONS.submitCompra = async form => {
  if ($('compra-grupo').value === PESSOAL) { await submitCompraPessoal(form); return; }
  const metodo = $('compra-metodo').value;
  const participantes = getParticipantesSelecionados('compra');
  const valorTotal = parseMoney($('compra-valor').value);
  const nParcelas = parseInt($('compra-nparc').value, 10);
  const erro = validarLancamento('compra', valorTotal, participantes) ||
    (!(nParcelas >= 1) ? 'Informe o número de parcelas.' : null);
  if (erro) { showToast(erro, true); vibrate(60); return; }
  const payload = {
    data: $('compra-data').value || todayStr(),
    descricao: $('compra-descricao').value.trim(),
    categoria: $('compra-categoria').value,
    grupo: $('compra-grupo').value,
    valorTotal,
    comprador: $('compra-comprador').value,
    nParcelas,
    metodo,
    participantes,
    divisao: metodo === 'Igual' ? null : collectDivisao('compra', metodo === 'Porcentagem')
  };
  const tags = (TAG_DRAFTS['compra-tags-editor'] || []).slice();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await api('addCompraParcelada', { payload });
      if (tags.length && res && res.id) saveTags('compra:' + res.id, tags);
      vibrate(20);
      showToast('Compra adicionada!' + (res && res.id ? ' ID: ' + res.id : ''));
      renderCompraForm();
    } catch (err) { onApiError(err); }
  });
};

// =================================================================== Pagamento de parcela
async function renderPagamentoForm() {
  const el = $('tab-pagamento');
  el.innerHTML = '<div class="spinner">Carregando compras em aberto...</div>';
  try {
    const compras = await api('comprasParaPagamento', { grupo: STATE.grupoAtual });
    if (STATE.currentTab !== 'pagamento') return;
    renderPagamentoFormBody(compras);
  } catch (err) {
    onApiError(err);
    el.innerHTML = `<div class="card"><p class="empty">${h(err.message)}</p>
      <button class="primary" type="button" data-action="refresh">Tentar de novo</button></div>`;
  }
}
function renderPagamentoFormBody(compras) {
  const el = $('tab-pagamento');
  if (!compras.length) {
    el.innerHTML = noPessoal()
      ? '<div class="card"><h3>Registrar pagamento</h3><p class="empty">O conjunto pessoal não tem parcelas a pagar. Escolha um conjunto compartilhado no topo.</p></div>'
      : '<div class="card"><h3>Registrar pagamento</h3><p class="empty">Você não tem nenhuma parcela em aberto neste conjunto 🎉</p></div>';
    return;
  }
  el.innerHTML = `
    <form class="card" data-submit="submitPagamento" novalidate autocomplete="off">
      <h3>Registrar pagamento de parcela</h3>
      <label for="pag-compra">Compra</label>
      <select id="pag-compra" data-change="updateSaldoDevedorHint">
        ${compras.map(c => `<option value="${h(c.id)}" data-saldo="${c.saldoDevedor}">${h(c.descricao)} — ${fmtBRL(c.saldoDevedor)}</option>`).join('')}
      </select>
      <p class="hint" id="pag-saldo-hint"></p>
      <label for="pag-valor">Valor pago</label>
      ${moneyInput('pag-valor')}
      <button type="button" class="link-btn" data-action="pagarTudo">Usar saldo total</button>
      <label for="pag-data">Data do pagamento</label>
      <input type="date" id="pag-data" value="${todayStr()}">
      <button class="primary" type="submit">Registrar pagamento</button>
    </form>
  `;
  ACTIONS.updateSaldoDevedorHint();
}
function saldoSelecionado() {
  const sel = $('pag-compra');
  return Number(sel.options[sel.selectedIndex].dataset.saldo) || 0;
}
ACTIONS.updateSaldoDevedorHint = () => {
  $('pag-saldo-hint').textContent = 'Você deve ' + fmtBRL(saldoSelecionado()) + ' nesta compra.';
};
ACTIONS.pagarTudo = () => {
  $('pag-valor').value = saldoSelecionado().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
ACTIONS.submitPagamento = async form => {
  const valor = parseMoney($('pag-valor').value);
  if (!(valor > 0)) { showToast('Informe o valor pago.', true); vibrate(60); return; }
  if (valor > saldoSelecionado() + 0.01 && !confirm('O valor é maior que o saldo devedor. Registrar mesmo assim?')) return;
  const payload = { compraId: $('pag-compra').value, data: $('pag-data').value || todayStr(), valor };
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('addPagamento', { payload });
      vibrate(20);
      showToast('Pagamento registrado!');
      renderPagamentoForm();
    } catch (err) { onApiError(err); }
  });
};

// =================================================================== Histórico
let HIST_SEG = 'despesas';
async function loadHistorico() {
  const el = $('tab-historico');
  el.innerHTML = '<div class="spinner">Carregando...</div>';
  try {
    const data = await api('historico', { grupo: STATE.grupoAtual });
    if (STATE.currentTab !== 'historico') return;
    renderHistorico(data);
  } catch (err) {
    onApiError(err);
    el.innerHTML = `<div class="card"><p class="empty">${h(err.message)}</p>
      <button class="primary" type="button" data-action="refresh">Tentar de novo</button></div>`;
  }
}
function renderHistorico(data) {
  const el = $('tab-historico');
  if (data.pessoalMode) {
    el.innerHTML = `<div class="card"><h3>🔒 Despesas pessoais (só você vê)</h3>
      ${data.despesas.length ? data.despesas.map(d => `
        <div class="hist-item">
          <div class="top"><span>${h(d.descricao)}</span><span>${fmtBRL(d.valor)}</span></div>
          <div class="sub">${h(d.data)} · ${h(d.categoria)}</div>
          <div id="tags-desp-${h(d.row)}"></div>
          ${apagarBtn('pessoais', d.id, true)}
        </div>`).join('') : '<p class="empty">Nenhuma despesa pessoal lançada ainda.</p>'}</div>
      <div class="card"><h3>🔒 Parceladas pessoais</h3>
      ${data.compras.length ? data.compras.map(c => `
        <div class="hist-item">
          <div class="top"><span>${h(c.descricao)}</span><span>${fmtBRL(c.valorTotal)}</span></div>
          <div class="sub">${h(c.data)} · ${h(c.categoria)} · ${c.nParcelas}x de ${fmtBRL(c.valorParcela)} ·
            ${c.parcelaAtual >= c.nParcelas ? 'quitada' : 'parcela ' + c.parcelaAtual + '/' + c.nParcelas + ' · faltam ' + fmtBRL(c.restante)}</div>
          <div id="tags-compra-${h(c.row)}"></div>
          ${apagarBtn('pessoaisCompras', c.id, true)}
        </div>`).join('') : '<p class="empty">Nenhuma compra parcelada pessoal ainda.</p>'}</div>`;
    data.despesas.forEach(d => renderHistTags('tags-desp-' + d.row, 'desp:' + d.row));
    data.compras.forEach(c => renderHistTags('tags-compra-' + c.row, 'compra:' + c.row));
    return;
  }
  const seg = (id, label) => `<button type="button" data-action="showHistSeg" data-seg="${id}" class="${HIST_SEG === id ? 'active' : ''}">${label}</button>`;
  const card = (id, inner) => `<div class="card ${HIST_SEG === id ? '' : 'hidden'}" id="hist-${id}">${inner}</div>`;
  el.innerHTML = `
    <div class="segmented" role="tablist">
      ${seg('despesas', 'Despesas')}${seg('compras', 'Parceladas')}${seg('pagamentos', 'Pagamentos')}
    </div>
    ${card('despesas', data.despesas.length ? data.despesas.map(d => `
      <div class="hist-item">
        <div class="top"><span>${h(d.descricao)}</span><span>${fmtBRL(d.valor)}</span></div>
        <div class="sub">${h(d.data)} · ${h(d.categoria)}${d.segmento ? ' · ' + h(d.segmento) : ''} · pago por ${h(d.pagoPor)} · ${h(d.metodo)}</div>
        <div id="tags-desp-${h(d.row)}"></div>
        ${apagarBtn('despesas', d.id, d.podeApagar)}
      </div>`).join('') : '<p class="empty">Nenhuma despesa lançada ainda.</p>')}
    ${card('compras', data.compras.length ? data.compras.map(c => `
      <div class="hist-item">
        <div class="top"><span>${h(c.descricao)}</span><span>${fmtBRL(c.valorTotal)}</span></div>
        <div class="sub">${h(c.id)} · ${h(c.data)} · ${h(c.categoria)} · ${h(c.comprador)} em ${h(c.nParcelas)}x · em aberto: ${fmtBRL(c.saldoTotal)}</div>
        <div id="tags-compra-${h(c.id)}"></div>
        ${apagarBtn('compras', c.docId, c.podeApagar)}
      </div>`).join('') : '<p class="empty">Nenhuma compra parcelada lançada ainda.</p>')}
    ${card('pagamentos', data.pagamentos.length ? data.pagamentos.map(p => `
      <div class="hist-item">
        <div class="top"><span>${h(p.pessoa)} · ${h(p.descricao || p.compraId)}</span><span>${fmtBRL(p.valor)}</span></div>
        <div class="sub">${h(p.data)} · compra ${h(p.compraId)}</div>
        ${apagarBtn('pagamentos', p.id, p.podeApagar)}
      </div>`).join('') : '<p class="empty">Nenhum pagamento registrado ainda.</p>')}
  `;
  data.despesas.forEach(d => renderHistTags('tags-desp-' + d.row, 'desp:' + d.row));
  data.compras.forEach(c => renderHistTags('tags-compra-' + c.id, 'compra:' + c.id));
}
function apagarBtn(colecao, id, pode) {
  return pode ? `<button type="button" class="del-btn" data-action="apagarItem" data-colecao="${colecao}" data-id="${h(id)}">Apagar</button>` : '';
}
ACTIONS.apagarItem = async el => {
  if (!confirm('Apagar este lançamento? Os saldos de todos serão recalculados.')) return;
  try {
    await api('apagar', { colecao: el.dataset.colecao, id: el.dataset.id });
    showToast('Apagado.');
    loadHistorico();
  } catch (err) { onApiError(err); }
};
ACTIONS.showHistSeg = el => {
  HIST_SEG = el.dataset.seg;
  ['despesas', 'compras', 'pagamentos'].forEach(s => $('hist-' + s).classList.toggle('hidden', s !== HIST_SEG));
  document.querySelectorAll('.segmented button').forEach(b => b.classList.toggle('active', b.dataset.seg === HIST_SEG));
};

// =================================================================== Casa (membros, convite, grupos)
let GRUPO_EDITANDO = null; // null = fechado, '' = novo, id = editando
async function renderCasa() {
  const el = $('tab-casa');
  const casa = Firebase.casaAtual();
  if (!casa) return;
  const dono = Firebase.souDono();
  const membros = await api('membros');
  const grupos = await api('grupos');
  const convite = dono ? Firebase.conviteAtual() : null;
  const link = convite ? location.origin + location.pathname + '?convite=' + convite : '';
  const eu = Firebase.usuarioAtual();
  el.innerHTML = `
    <h2 class="page-title">Ajustes de ${h(casa.nome)}</h2>
    <p class="escopo">⚙️ Tudo aqui vale só para este grupo. Para trocar de grupo ou sair da conta, toque no nome do grupo no topo.</p>
    <div class="card">
      ${EDITANDO_NOME === 'grupo' ? `
        <form data-submit="salvarNomeGrupo" novalidate>
          <label for="nome-grupo-input">Nome do grupo</label>
          <input type="text" id="nome-grupo-input" maxlength="40" value="${h(casa.nome)}" autocapitalize="sentences">
          <div class="btn-row">
            <button class="secondary" type="button" data-action="editarNome" data-qual="">Cancelar</button>
            <button class="primary" type="submit">Salvar</button>
          </div>
        </form>` : `
        <div class="list-row">
          <div><span class="field-label" style="margin:0">Nome do grupo</span>${h(casa.nome)}</div>
          ${dono ? '<button type="button" class="del-btn" data-action="editarNome" data-qual="grupo">Editar nome</button>' : ''}
        </div>`}
      <span class="field-label">Pessoas</span>
      ${membros.map(m => `
        <div class="list-row">
          <div>${h(m.nome)}${m.dono ? '<span class="badge">admin</span>' : ''}${m.uid === eu.uid ? '<span class="badge">você</span>' : ''}
            <div class="sub">${h(m.email)}</div></div>
          ${m.uid === eu.uid ? '<button type="button" class="del-btn" data-action="editarNome" data-qual="eu">Mudar meu nome</button>'
            : (dono && !m.dono ? `<button type="button" class="del-btn" data-action="removerMembro" data-uid="${h(m.uid)}" data-nome="${h(m.nome)}">Remover</button>` : '')}
        </div>`).join('')}
      ${EDITANDO_NOME === 'eu' ? `
        <form data-submit="salvarMeuNome" novalidate>
          <label for="meu-nome-input">Seu nome neste grupo</label>
          <input type="text" id="meu-nome-input" maxlength="20" value="${h(STATE.pessoa || '')}" autocapitalize="words">
          <div class="btn-row">
            <button class="secondary" type="button" data-action="editarNome" data-qual="">Cancelar</button>
            <button class="primary" type="submit">Salvar</button>
          </div>
        </form>` : ''}
    </div>

    ${dono ? `
    <div class="card">
      <h3>Convidar pessoas</h3>
      ${convite ? `
        <div class="convite-box">${h(convite)}</div>
        <p class="hint">Mande o link abaixo. Quem abrir cria a conta e já entra no grupo.</p>
        <button class="primary" type="button" data-action="compartilharConvite" data-link="${h(link)}">Compartilhar link de convite</button>
        <div class="btn-row">
          <button class="secondary" type="button" data-action="novoConvite">Gerar outro código</button>
          <button class="secondary danger" type="button" data-action="fecharConvite">Fechar convites</button>
        </div>`
      : `<p class="hint">Nenhum convite aberto neste aparelho.</p>
         <button class="primary" type="button" data-action="novoConvite">Gerar código de convite</button>`}
    </div>` : ''}

    <div class="card">
      <h3>Conjuntos de despesas</h3>
      <p class="hint" style="margin:-6px 0 8px">Organize as despesas do grupo (ex.: Contas fixas, Viagem). O conjunto marcado "todos" inclui automaticamente quem entrar.</p>
      ${grupos.map(g => `
        <div class="list-row">
          <div>${h(g.nome)}${g.todos ? '<span class="badge">todos</span>' : ''}
            <div class="sub">${g.todos ? 'Todo mundo do grupo' : (g.membros.map(h).join(', ') || 'ninguém')}</div></div>
          ${(g.todos ? dono : (dono || g.criadoPor === eu.uid)) ? `<button type="button" class="del-btn" data-action="editarGrupo" data-id="${h(g.id)}">Editar</button>` : ''}
        </div>`).join('')}
      <div id="grupo-form"></div>
      ${GRUPO_EDITANDO === null ? '<button class="secondary" type="button" data-action="editarGrupo" data-id="">+ Novo conjunto</button>' : ''}
    </div>

    ${dono ? `
    <div class="card">
      <h3>Despesas pessoais</h3>
      <label class="participa-item">
        <input type="checkbox" data-change="alternarPessoais" ${casa.despesasPessoais ? 'checked' : ''}> Permitir despesas pessoais neste grupo
      </label>
      <p class="hint">Cada pessoa ganha um conjunto "Pessoal (só você)": ninguém mais vê, nem quem administra, e não entra na divisão.</p>
    </div>` : ''}

    ${!dono ? `
    <div class="card">
      <h3>Sair do grupo</h3>
      <p class="hint" style="margin-top:0">Você deixa de ver ${h(casa.nome)}. Os lançamentos compartilhados que você fez
        continuam no histórico do grupo; suas despesas pessoais daqui são apagadas.</p>
      <button class="secondary danger" type="button" data-action="sairDaCasa">Sair de ${h(casa.nome)}</button>
    </div>` : `
    <div class="card zona-perigo">
      <h3>Excluir grupo</h3>
      <p class="hint" style="margin-top:0">Apaga ${h(casa.nome)} para todo mundo: lançamentos, conjuntos, convites e pessoas.
        As despesas pessoais de cada um também somem. <strong>Não dá para desfazer.</strong></p>
      <button class="secondary danger" type="button" data-action="excluirGrupoInteiro">Excluir ${h(casa.nome)}</button>
    </div>`}
  `;
  if (GRUPO_EDITANDO !== null) renderGrupoForm(grupos.find(g => g.id === GRUPO_EDITANDO) || null);
}

// =================================================================== Meus grupos e conta (vale para tudo)
async function renderMeusGrupos() {
  const el = $('tab-grupos');
  const casa = Firebase.casaAtual();
  const eu = Firebase.usuarioAtual();
  const casas = await Firebase.minhasCasas().catch(() => []);
  el.innerHTML = `
    <h2 class="page-title">Meus grupos</h2>
    <p class="page-sub">Toque num grupo para abrir. Os ajustes de cada grupo ficam na engrenagem ⚙️, dentro dele.</p>
    <div class="card">
      ${casas.map(c => `
        <div class="list-row">
          <div>${h(c.nome)}${c.souDono ? '<span class="badge">admin</span>' : ''}
            <div class="sub">${c.id === (casa && casa.id) ? 'Aberto agora' : ''}</div></div>
          ${c.id !== (casa && casa.id)
            ? `<button type="button" class="del-btn" data-action="trocarCasa" data-id="${h(c.id)}">Abrir</button>`
            : '<button type="button" class="del-btn" data-tab="dashboard">Voltar a ele</button>'}
        </div>`).join('')}
      <div id="outra-casa-form"></div>
      ${OUTRA_CASA === null ? `
        <div class="btn-row">
          <button class="secondary" type="button" data-action="outraCasa" data-modo="criar">+ Criar grupo</button>
          <button class="secondary" type="button" data-action="outraCasa" data-modo="convite">Entrar com convite</button>
        </div>` : ''}
    </div>

    <h2 class="page-title" style="margin-top:22px">Minha conta</h2>
    <div class="card">
      <div class="list-row"><div>Email<div class="sub">${h(eu ? eu.email : '')}</div></div></div>
      <p class="hint">Seu nome pode ser diferente em cada grupo: mude nos ajustes ⚙️ de cada um.</p>
      <button class="secondary danger" type="button" data-action="logout">Sair da conta neste aparelho</button>
    </div>
  `;
  if (OUTRA_CASA !== null) renderOutraCasaForm();
}

// ---------- Várias casas ----------
let OUTRA_CASA = null; // null | 'criar' | 'convite'
function renderOutraCasaForm() {
  $('outra-casa-form').innerHTML = OUTRA_CASA === 'criar' ? `
    <form data-submit="criarOutraCasa" novalidate>
      <label for="outra-casa-nome">Nome do novo grupo</label>
      <input type="text" id="outra-casa-nome" maxlength="40" placeholder="Ex.: Viagem Chile" autocapitalize="sentences">
      <label class="participa-item" style="margin-top:12px"><input type="checkbox" id="outra-casa-pessoais" checked> Incluir despesas pessoais</label>
      <p class="hint">Cada pessoa ganha um conjunto "Pessoal" só dela, que ninguém mais vê.</p>
      <div class="btn-row">
        <button class="secondary" type="button" data-action="outraCasa" data-modo="">Cancelar</button>
        <button class="primary" type="submit">Criar</button>
      </div>
    </form>` : `
    <form data-submit="entrarOutraCasa" novalidate>
      <label for="outra-casa-convite">Código de convite</label>
      <input type="text" id="outra-casa-convite" maxlength="20" placeholder="ABCD234567" autocapitalize="characters"
             autocomplete="off" autocorrect="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:2px;font-weight:700">
      <div class="btn-row">
        <button class="secondary" type="button" data-action="outraCasa" data-modo="">Cancelar</button>
        <button class="primary" type="submit">Entrar</button>
      </div>
    </form>`;
  const input = $('outra-casa-form').querySelector('input');
  if (input) input.focus();
}
ACTIONS.alternarPessoais = async el => {
  const ativo = el.checked;
  if (!ativo && !confirm('Desligar as despesas pessoais? As que já foram lançadas ficam guardadas, mas o conjunto "Pessoal" some até você ligar de novo.')) {
    el.checked = true; return;
  }
  try {
    await api('despesasPessoais', { ativo });
    STATE.config = await api('config');
    STATE.casa.despesasPessoais = ativo;
    applyGrupos(STATE.grupos);
    showToast(ativo ? 'Despesas pessoais ligadas.' : 'Despesas pessoais desligadas.');
  } catch (err) { el.checked = !ativo; onApiError(err); }
};
ACTIONS.outraCasa = el => { OUTRA_CASA = el.dataset.modo || null; renderMeusGrupos(); };
async function abrirOutraCasa(fn, msg) {
  const user = Firebase.usuarioAtual();
  const casa = await fn();
  OUTRA_CASA = null;
  GRUPO_EDITANDO = null;
  STATE.casa = casa;
  STATE.config = await api('config');
  STATE.grupoAtual = null;
  enterApp(casa.meuNome);
  showToast(msg);
  return user;
}
ACTIONS.criarOutraCasa = async form => {
  const nome = $('outra-casa-nome').value.trim();
  if (!nome) { showToast('Dê um nome para o grupo.', true); return; }
  const user = Firebase.usuarioAtual();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await abrirOutraCasa(() => Firebase.criarCasa(nome, STATE.pessoa || user.displayName || user.email.split('@')[0], $('outra-casa-pessoais').checked),
        'Grupo criado! Convide as pessoas abaixo.');
      switchTab('casa');
    } catch (err) { onApiError(err); }
  });
};
ACTIONS.entrarOutraCasa = async form => {
  const codigo = $('outra-casa-convite').value.trim();
  if (!codigo) { showToast('Digite o código de convite.', true); return; }
  const user = Firebase.usuarioAtual();
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await abrirOutraCasa(() => Firebase.entrarComConvite(codigo, STATE.pessoa || user.displayName || user.email.split('@')[0]),
        'Você entrou no grupo!');
    } catch (err) { onApiError(err); }
  });
};
ACTIONS.trocarCasa = async el => {
  try {
    await abrirOutraCasa(() => Firebase.carregarCasa(el.dataset.id), 'Grupo aberto.');
  } catch (err) { onApiError(err); }
};
ACTIONS.excluirGrupoInteiro = async el => {
  const nome = Firebase.casaAtual().nome;
  const digitado = prompt('Isso apaga "' + nome + '" para todo mundo e não pode ser desfeito.\n\nPara confirmar, digite o nome do grupo:');
  if (digitado === null) return;
  if (digitado.trim().toLowerCase() !== nome.trim().toLowerCase()) { showToast('O nome não confere. Nada foi apagado.', true); return; }
  el.disabled = true;
  el.textContent = 'Excluindo...';
  try {
    await Firebase.excluirGrupoInteiro();
    showToast('Grupo "' + nome + '" excluído.');
    store.remove(chaveGrupo());
    STATE.casa = null;
    await abrirCasa(Firebase.usuarioAtual());
  } catch (err) {
    onApiError(err);
    if (el.isConnected) { el.disabled = false; el.textContent = 'Excluir ' + nome; }
  }
};
ACTIONS.sairDaCasa = async () => {
  const nome = STATE.casa ? STATE.casa.nome : 'este grupo';
  if (!confirm('Sair de "' + nome + '"? Você deixa de ver o grupo e suas despesas pessoais dele são apagadas.')) return;
  try {
    await Firebase.sairDaCasa();
    showToast('Você saiu do grupo.');
    await abrirCasa(Firebase.usuarioAtual());
  } catch (err) { onApiError(err); }
};
function renderGrupoForm(grupo) {
  const nomes = STATE.config.names;
  $('grupo-form').innerHTML = `
    <form data-submit="salvarGrupo" novalidate>
      <label for="grupo-nome">${grupo ? 'Editar conjunto' : 'Novo conjunto de despesas'}</label>
      <input type="text" id="grupo-nome" maxlength="30" placeholder="Ex.: Contas fixas, Viagem" value="${grupo ? h(grupo.nome) : ''}">
      ${grupo && grupo.todos ? '<p class="hint">Este conjunto sempre inclui todo mundo do grupo (e quem entrar depois).</p>' : `
      <span class="field-label">Quem faz parte</span>
      <div class="participa-grid">
        ${nomes.map(n => `<label class="participa-item"><input type="checkbox" class="grupo-membro" data-nome="${h(n)}"
          ${(grupo ? grupo.membros.includes(n) : n === STATE.pessoa) ? 'checked' : ''}> ${h(n)}</label>`).join('')}
      </div>`}
      <div class="btn-row">
        <button class="secondary" type="button" data-action="cancelarGrupo">Cancelar</button>
        <button class="primary" type="submit">Salvar</button>
      </div>
      ${grupo && !grupo.todos ? `<button class="secondary danger" type="button" data-action="excluirGrupo" data-id="${h(grupo.id)}" data-nome="${h(grupo.nome)}">Excluir conjunto</button>` : ''}
    </form>`;
  $('grupo-nome').focus();
}
ACTIONS.excluirGrupo = async el => {
  const n = await api('contarLancamentosGrupo', { id: el.dataset.id });
  const aviso = n
    ? 'Excluir o conjunto "' + el.dataset.nome + '" e APAGAR os ' + n + ' lançamento(s) dele? Isso não pode ser desfeito.'
    : 'Excluir o conjunto "' + el.dataset.nome + '"?';
  if (!confirm(aviso)) return;
  try {
    await api('excluirGrupo', { id: el.dataset.id });
    GRUPO_EDITANDO = null;
    applyGrupos(await api('grupos'));
    showToast('Conjunto excluído.');
    renderCasa();
  } catch (err) { onApiError(err); }
};
let EDITANDO_NOME = ''; // '' | 'grupo' | 'eu'
ACTIONS.editarNome = el => {
  EDITANDO_NOME = el.dataset.qual || '';
  renderCasa().then(() => {
    const input = $(EDITANDO_NOME === 'grupo' ? 'nome-grupo-input' : 'meu-nome-input');
    if (input) { input.focus(); input.select(); }
  });
};
ACTIONS.salvarNomeGrupo = async form => {
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('renomearGrupo', { nome: $('nome-grupo-input').value });
      STATE.casa.nome = Firebase.casaAtual().nome;
      $('who-casa').textContent = STATE.casa.nome;
      EDITANDO_NOME = '';
      showToast('Nome do grupo atualizado.');
      renderCasa();
    } catch (err) { onApiError(err); }
  });
};
ACTIONS.salvarMeuNome = async form => {
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await api('renomearMe', { nome: $('meu-nome-input').value });
      STATE.pessoa = res.nome;
      store.set(K.pessoa, res.nome);
      $('who-name').textContent = res.nome;
      EDITANDO_NOME = '';
      showToast('Seu nome foi atualizado.');
      setTimeout(renderCasa, 400);
    } catch (err) { onApiError(err); }
  });
};
ACTIONS.editarGrupo = el => { GRUPO_EDITANDO = el.dataset.id || ''; renderCasa(); };
ACTIONS.cancelarGrupo = () => { GRUPO_EDITANDO = null; renderCasa(); };
ACTIONS.salvarGrupo = async form => {
  const membros = Array.from(document.querySelectorAll('.grupo-membro:checked')).map(i => i.dataset.nome);
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('salvarGrupo', { id: GRUPO_EDITANDO || null, nome: $('grupo-nome').value, tipo: 'Compartilhado', membros });
      GRUPO_EDITANDO = null;
      showToast('Conjunto salvo!');
      applyGrupos(await api('grupos'));
      renderCasa();
    } catch (err) { onApiError(err); }
  });
};
ACTIONS.novoConvite = async () => {
  if (Firebase.conviteAtual() && !confirm('Gerar um código novo? O código atual deixa de funcionar.')) return;
  try { await Firebase.novoConvite(); renderCasa(); } catch (err) { onApiError(err); }
};
ACTIONS.fecharConvite = async () => {
  if (!confirm('Fechar os convites? Ninguém novo consegue entrar até você gerar outro código.')) return;
  try { await Firebase.fecharConvite(); renderCasa(); showToast('Convites fechados.'); } catch (err) { onApiError(err); }
};
ACTIONS.compartilharConvite = async el => {
  const link = el.dataset.link;
  const texto = 'Entra na nossa casa no Rachaê pra gente dividir as contas: ' + link;
  try {
    if (navigator.share) { await navigator.share({ title: 'Rachaê', text: texto, url: link }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(link); showToast('Link copiado!'); }
  catch (e) { prompt('Copie o link:', link); }
};
ACTIONS.removerMembro = async el => {
  if (!confirm('Remover ' + el.dataset.nome + ' da casa? Os lançamentos dela continuam no histórico.')) return;
  try { await api('removerMembro', { uid: el.dataset.uid }); showToast('Pessoa removida.'); } catch (err) { onApiError(err); }
};

// =================================================================== Instalação / PWA
let DEFERRED_INSTALL = null;
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  if (/android/i.test(navigator.userAgent)) return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS se apresenta como Mac
}
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // Android/Chrome: guardamos para mostrar nosso próprio botão
    DEFERRED_INSTALL = e;
    renderInstallBanner();
    renderInstallCard();
  });
  window.addEventListener('appinstalled', () => {
    DEFERRED_INSTALL = null;
    renderInstallBanner();
    renderInstallCard();
  });
}
function installHtml(withDismiss) {
  if (isStandalone()) return '';
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>';
  const dismiss = withDismiss ? ' <button type="button" class="link-btn" data-action="dismissInstall">Agora não</button>' : '';
  if (DEFERRED_INSTALL) {
    return `${icon}<div>Instale o Rachaê na tela inicial para abrir como app.
      <button class="primary" type="button" data-action="installApp">Instalar app</button>${dismiss}</div>`;
  }
  if (isIOS()) {
    return `${icon}<div>Para usar como app no iPhone: toque em <strong>Compartilhar</strong>
      (<svg style="width:15px;height:15px;vertical-align:-2px;margin:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>)
      e depois em <strong>Adicionar à Tela de Início</strong>. Depois de instalar, entre de novo pelo ícone.${dismiss}</div>`;
  }
  return '';
}
function renderInstallBanner() {
  const el = $('install-banner');
  const html = installHtml(false);
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
}
function renderInstallCard() {
  const el = $('install-card');
  if (!el) return;
  const html = store.get(K.installDismissed) ? '' : installHtml(true);
  el.innerHTML = html ? `<div class="install-banner" style="margin:0 0 14px">${html}</div>` : '';
}
ACTIONS.installApp = async () => {
  if (!DEFERRED_INSTALL) return;
  DEFERRED_INSTALL.prompt();
  await DEFERRED_INSTALL.userChoice.catch(() => null);
  DEFERRED_INSTALL = null;
  renderInstallBanner();
  renderInstallCard();
};
ACTIONS.dismissInstall = () => { store.set(K.installDismissed, true); renderInstallCard(); };

function updateOnlineStatus() {
  $('offline-bar').classList.toggle('hidden', navigator.onLine);
}

// Volta para o app depois de um tempo em segundo plano: atualiza a aba atual
let HIDDEN_AT = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { HIDDEN_AT = Date.now(); return; }
  if (STATE.pessoa && HIDDEN_AT && Date.now() - HIDDEN_AT > 5 * 60 * 1000 &&
      (STATE.currentTab === 'dashboard' || STATE.currentTab === 'historico')) {
    refreshCurrentTabData();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

init();
