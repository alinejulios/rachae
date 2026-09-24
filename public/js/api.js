// Camada de dados do Rachaê sobre o Firebase (Auth + Firestore, plano Spark).
//
// Vocabulário: na tela, "grupo" = quem divide as contas (coleção `households`)
// e "conjunto de despesas" = subdivisão dentro dele (coleção `grupos`). Os
// nomes das coleções ficaram os da primeira versão para não migrar dados.
// Despesas pessoais (privadas) ficam em households/{hid}/pessoais/{uid}/despesas e .../compras.
//
// Mantém a mesma interface que o app usava com o Apps Script — api('dashboard'),
// api('addDespesa', {payload}) etc. —, então as telas quase não mudaram. Os
// cálculos de saldo (que antes eram fórmulas da planilha) estão em calc.js e
// rodam no aparelho; a segurança fica nas regras do Firestore (firestore.rules).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, collection, onSnapshot, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';
import { normalizarChave } from './pix.js';
import { montarDashboard, montarHistorico, membrosDoGrupo, montarDashboardPessoal, montarHistoricoPessoal } from './calc.js';

/** Valor especial do seletor de conjunto para o conjunto pessoal (privado). */
export const PESSOAL = '__pessoal__';

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const CATEGORIAS_PADRAO = ['Aluguel', 'Mercado/Supermercado', 'Lazer', 'Transporte', 'Streaming',
  'Contas de Consumo', 'Saúde', 'Pet', 'Viagem', 'Alimentação', 'Outros'];
const SEGMENTOS_PADRAO = ['Mensais', 'À Vista'];
const METODOS = ['Igual', 'Porcentagem', 'Valor customizado'];

export const configurado = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
let app, auth, fs;
if (configurado) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'pt';
  fs = initializeFirestore(app, {
    // Cache no aparelho: abre instantâneo e funciona offline (sincroniza ao voltar a conexão)
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
}
function exigirConfig() {
  if (!configurado) throw new ApiError('App ainda não configurado: preencha public/firebase-config.js (veja o README).', 'CONFIG');
}

// ------------------------------------------------------------------ mensagens de erro
const ERROS = {
  'auth/invalid-credential': 'Email ou senha incorretos.',
  'auth/wrong-password': 'Email ou senha incorretos.',
  'auth/user-not-found': 'Email ou senha incorretos.',
  'auth/invalid-email': 'Digite um email válido.',
  'auth/email-already-in-use': 'Esse email já tem conta. Use "Já tenho conta" para entrar.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/configuration-not-found': 'O login ainda não foi ativado no Firebase (Authentication > Método de login > E-mail/senha).',
  'auth/operation-not-allowed': 'O login por email e senha está desativado no Firebase (Authentication > Método de login).',
  'auth/missing-email': 'Digite seu email.',
  'auth/unauthorized-continue-uri': 'Este endereço não está autorizado no Firebase (Authentication > Configurações > Domínios autorizados).',
  'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase (Authentication > Configurações > Domínios autorizados).',
  'permission-denied': 'Sem permissão para isso.',
  'unavailable': 'Sem conexão com o servidor. Tente de novo.'
};
function traduz(err) {
  if (err instanceof ApiError) return err;
  const code = err && err.code;
  return new ApiError(ERROS[code] || (err && err.message) || 'Erro inesperado.', code);
}
async function tenta(fn) {
  try { return await fn(); } catch (e) { throw traduz(e); }
}

// ------------------------------------------------------------------ sessão
let CASA = null;   // { id, nome, ownerUid, categorias, segmentos, conviteAtual }
let DB = null;     // { membros, grupos, despesas, compras, pagamentos }
let unsubs = [];

export function dominioAuth() { return configurado ? firebaseConfig.authDomain : ''; }
export function usuarioAtual() { return auth ? auth.currentUser : null; }
export function souDono() { return !!(CASA && usuarioAtual() && CASA.ownerUid === usuarioAtual().uid); }
export function casaAtual() { return CASA; }

/** Resolve com o usuário (ou null) assim que o Firebase restaurar a sessão salva. */
export function aguardarSessao() {
  exigirConfig();
  return new Promise(resolve => { const off = onAuthStateChanged(auth, u => { off(); resolve(u); }); });
}

export const entrar = (email, senha) => tenta(async () => {
  exigirConfig();
  return (await signInWithEmailAndPassword(auth, email.trim(), senha)).user;
});
export const criarConta = (nome, email, senha) => tenta(async () => {
  exigirConfig();
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), senha);
  await updateProfile(user, { displayName: nome });
  return user;
});
export const esqueciSenha = email => tenta(async () => {
  exigirConfig();
  // Depois de criar a senha nova, o Firebase mostra o botão "Continuar", que volta para o app
  await sendPasswordResetEmail(auth, email.trim().toLowerCase(), { url: location.origin + '/' });
});
export async function sair() {
  pararEscuta();
  CASA = null; DB = null;
  if (auth) await signOut(auth);
}

// ------------------------------------------------------------------ casas (households)
// Uma pessoa pode fazer parte de várias casas. O perfil users/{uid} guarda a
// lista (casas) e qual está aberta (casaAtual). Quem manda de verdade é o
// registro em households/{hid}/membros/{uid} — o perfil é só um índice.
async function lerPerfil(uid) {
  const snap = await getDoc(doc(fs, 'users', uid));
  const d = snap.exists() ? snap.data() : {};
  const casas = Array.isArray(d.casas) ? d.casas.slice() : (d.householdId ? [d.householdId] : []);
  const atual = d.casaAtual || d.householdId || casas[0] || null;
  return { casas, atual };
}
async function salvarPerfil(uid, casas, atual) {
  await setDoc(doc(fs, 'users', uid), { casas: [...new Set(casas)].slice(0, 20), casaAtual: atual || '' });
}

/** Lista as casas da pessoa (id, nome, se é dona). Ignora casas das quais foi removida. */
export const minhasCasas = () => tenta(async () => {
  const u = usuarioAtual();
  const { casas, atual } = await lerPerfil(u.uid);
  const out = [];
  for (const hid of casas) {
    try {
      const c = await getDoc(doc(fs, 'households', hid));
      if (c.exists()) out.push({ id: hid, nome: c.data().nome, souDono: c.data().ownerUid === u.uid, atual: hid === atual });
    } catch (e) { /* sem permissão: foi removida dessa casa */ }
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
});

/**
 * Abre uma casa (ou a última aberta, se hid for omitido) e começa a escutar os
 * dados em tempo real. Null se a pessoa não tem nenhuma casa acessível.
 */
export const carregarCasa = (hidDesejada) => tenta(async () => {
  const u = usuarioAtual();
  if (!u) throw new ApiError('Entre novamente.', 'AUTH');
  const perfil = await lerPerfil(u.uid);
  const candidatas = [hidDesejada || perfil.atual, ...perfil.casas].filter(Boolean);
  for (const hid of [...new Set(candidatas)]) {
    let casaSnap, eu;
    try {
      casaSnap = await getDoc(doc(fs, 'households', hid));
      eu = await getDoc(doc(fs, 'households', hid, 'membros', u.uid));
    } catch (e) {
      // Sem acesso: o grupo foi excluído ou a pessoa foi removida. Limpa o que é dela e segue.
      if (e.code === 'permission-denied') { await esquecerGrupo(hid).catch(() => {}); continue; }
      throw e;
    }
    if (!casaSnap.exists() || !eu.exists()) { await esquecerGrupo(hid).catch(() => {}); continue; }
    CASA = { id: hid, ...casaSnap.data() };
    await escutarDados(hid);
    if (perfil.atual !== hid || !perfil.casas.includes(hid)) {
      await salvarPerfil(u.uid, [...perfil.casas, hid], hid).catch(() => {});
    }
    return { ...CASA, meuNome: eu.data().nome, souDono: souDono() };
  }
  pararEscuta();
  CASA = null; DB = null;
  return null;
});

function gerarCodigo(n = 10) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, b => alfabeto[b % alfabeto.length]).join('');
}
function validarNome(nome) {
  const n = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L} .'-]{0,19}$/u.test(n)) throw new ApiError('Digite um nome de até 20 letras (sem números ou símbolos).');
  return n;
}

/** Quem administra: cria a casa, o grupo "Casa" e o primeiro convite. */
export const criarCasa = (nomeCasa, meuNome, despesasPessoais = true) => tenta(async () => {
  const u = usuarioAtual();
  const nome = validarNome(meuNome);
  const casaRef = doc(collection(fs, 'households'));
  const codigo = gerarCodigo();
  // 1º lote: casa + eu como membro + meu perfil (a regra usa getAfter para o dono)
  const b1 = writeBatch(fs);
  b1.set(casaRef, {
    nome: String(nomeCasa || 'Casa').trim().slice(0, 40) || 'Casa', ownerUid: u.uid,
    categorias: CATEGORIAS_PADRAO, segmentos: SEGMENTOS_PADRAO, despesasPessoais: !!despesasPessoais,
    criadoEm: serverTimestamp()
  });
  b1.set(doc(fs, 'households', casaRef.id, 'membros', u.uid), { nome, email: u.email, convite: '', entrouEm: serverTimestamp() });
  const perfil = await lerPerfil(u.uid);
  b1.set(doc(fs, 'users', u.uid), { casas: [...new Set([...perfil.casas, casaRef.id])].slice(0, 20), casaAtual: casaRef.id });
  await b1.commit();
  // 2º lote: já como membro/dono — grupo padrão e convite
  const b2 = writeBatch(fs);
  b2.set(doc(collection(fs, 'households', casaRef.id, 'grupos')),
    { nome: 'Geral', tipo: 'Compartilhado', todos: true, membros: [], criadoPor: u.uid });
  b2.set(doc(fs, 'convites', codigo), { householdId: casaRef.id, ativo: true, criadoEm: serverTimestamp() });
  await b2.commit();
  await salvarConviteAtual(casaRef.id, codigo);
  return carregarCasa(casaRef.id);
});

// O código de convite atual fica guardado só no aparelho de quem é dono (o
// Firestore não deixa listar convites, de propósito).
const CONVITE_KEY = hid => 'rachae_convite_' + hid;
async function salvarConviteAtual(hid, codigo) {
  try { localStorage.setItem(CONVITE_KEY(hid), codigo); } catch (e) {}
}
export function conviteAtual() {
  try { return CASA ? localStorage.getItem(CONVITE_KEY(CASA.id)) : null; } catch (e) { return null; }
}
/** Dono: gera um convite novo e desativa o anterior. */
export const novoConvite = () => tenta(async () => {
  if (!souDono()) throw new ApiError('Só quem criou o grupo pode gerar convites.');
  const anterior = conviteAtual();
  const codigo = gerarCodigo();
  const b = writeBatch(fs);
  b.set(doc(fs, 'convites', codigo), { householdId: CASA.id, ativo: true, criadoEm: serverTimestamp() });
  if (anterior) b.update(doc(fs, 'convites', anterior), { ativo: false });
  await b.commit().catch(async e => {
    if (!anterior) throw e;
    // convite anterior pode ter sido apagado; cria só o novo
    await setDoc(doc(fs, 'convites', codigo), { householdId: CASA.id, ativo: true, criadoEm: serverTimestamp() });
  });
  await salvarConviteAtual(CASA.id, codigo);
  return codigo;
});
/** Dono: fecha o cadastro (desativa o convite atual). */
export const fecharConvite = () => tenta(async () => {
  const atual = conviteAtual();
  if (atual) await updateDoc(doc(fs, 'convites', atual), { ativo: false });
  try { localStorage.removeItem(CONVITE_KEY(CASA.id)); } catch (e) {}
});

/** Morador: entra numa casa usando o código de convite. */
export const entrarComConvite = (codigo, meuNome) => tenta(async () => {
  const u = usuarioAtual();
  const nome = validarNome(meuNome);
  const cod = String(codigo || '').trim().toUpperCase();
  if (cod.length < 8) throw new ApiError('Código de convite inválido.');
  const conv = await getDoc(doc(fs, 'convites', cod));
  if (!conv.exists() || !conv.data().ativo) throw new ApiError('Código de convite inválido ou já desativado.');
  const hid = conv.data().householdId;
  const perfil = await lerPerfil(u.uid);
  // Já faz parte dessa casa? Só abre.
  let jaSouMembro = false;
  try { jaSouMembro = (await getDoc(doc(fs, 'households', hid, 'membros', u.uid))).exists(); } catch (e) {}
  if (!jaSouMembro) {
    const b = writeBatch(fs);
    b.set(doc(fs, 'households', hid, 'membros', u.uid), { nome, email: u.email, convite: cod, entrouEm: serverTimestamp() });
    b.set(doc(fs, 'users', u.uid), { casas: [...new Set([...perfil.casas, hid])].slice(0, 20), casaAtual: hid });
    await b.commit();
  }
  const casa = await carregarCasa(hid);
  if (!jaSouMembro && DB && DB.membros.some(m => m.uid !== u.uid && m.nome.toLowerCase() === nome.toLowerCase())) {
    const novoNome = (nome + ' ' + u.email[0].toUpperCase()).slice(0, 20);
    await updateDoc(doc(fs, 'households', hid, 'membros', u.uid), { nome: novoNome });
    casa.meuNome = novoNome;
  }
  return casa;
});

/** Sair de uma casa (quem não é dono). Os lançamentos continuam no histórico dela. */
async function apagarEmLotes(refs) {
  for (let i = 0; i < refs.length; i += 450) {
    const b = writeBatch(fs);
    refs.slice(i, i + 450).forEach(r => b.delete(r));
    await b.commit();
  }
}
/** Apaga as despesas pessoais da pessoa num grupo (só ela tem acesso a elas). */
async function apagarMeusPessoais(hid) {
  const uid = usuarioAtual().uid;
  const refs = [];
  for (const sub of ['despesas', 'compras']) {
    const snap = await getDocs(collection(fs, 'households', hid, 'pessoais', uid, sub));
    snap.forEach(d => refs.push(d.ref));
  }
  await apagarEmLotes(refs);
}
/** Grupo que sumiu (excluído, ou a pessoa foi removida): apaga os pessoais dela ali e tira da lista. */
async function esquecerGrupo(hid) {
  const u = usuarioAtual();
  await apagarMeusPessoais(hid).catch(() => {});
  const perfil = await lerPerfil(u.uid);
  if (!perfil.casas.includes(hid) && perfil.atual !== hid) return;
  const resto = perfil.casas.filter(x => x !== hid);
  await salvarPerfil(u.uid, resto, perfil.atual === hid ? (resto[0] || '') : perfil.atual);
}

/** Convidado sai do grupo: apaga as próprias despesas pessoais dele ali e o registro de membro. */
export const sairDaCasa = () => tenta(async () => {
  const u = usuarioAtual();
  if (souDono()) throw new ApiError('Quem administra o grupo não pode sair dele. Você pode excluir o grupo.');
  const hid = CASA.id;
  pararEscuta();
  await apagarMeusPessoais(hid);
  await deleteDoc(doc(fs, 'households', hid, 'membros', u.uid));
  const perfil = await lerPerfil(u.uid);
  const resto = perfil.casas.filter(x => x !== hid);
  await salvarPerfil(u.uid, resto, resto[0] || '');
  CASA = null; DB = null;
});

/**
 * Admin exclui o grupo inteiro. Sem Cloud Functions, o app apaga tudo, em ordem:
 * marca o grupo como "excluindo" (as regras passam a aceitar a limpeza), apaga
 * lançamentos, conjuntos, convite, as pessoas e por último o próprio grupo.
 * As despesas pessoais dos OUTROS membros ninguém além deles consegue ler; elas
 * são apagadas automaticamente no próximo acesso de cada um (esquecerGrupo).
 */
export const excluirGrupoInteiro = () => tenta(async () => {
  if (!souDono()) throw new ApiError('Só quem administra pode excluir o grupo.');
  const hid = CASA.id;
  const u = usuarioAtual().uid;
  const copia = DB;
  pararEscuta();
  await updateDoc(doc(fs, 'households', hid), { excluindo: true });
  const ref = (col, id) => doc(fs, 'households', hid, col, id);
  await apagarEmLotes([
    ...copia.pagamentos.map(x => ref('pagamentos', x.id)),
    ...copia.compras.map(x => ref('compras', x.id)),
    ...copia.despesas.map(x => ref('despesas', x.id)),
    ...copia.grupos.map(x => ref('grupos', x.id))
  ]);
  const convite = conviteAtual();
  if (convite) await deleteDoc(doc(fs, 'convites', convite)).catch(() => {});
  try { localStorage.removeItem(CONVITE_KEY(hid)); } catch (e) {}
  await apagarMeusPessoais(hid);
  // Pessoas: os outros primeiro, eu por último (as regras de exclusão dependem do grupo existir)
  await apagarEmLotes(copia.membros.filter(m => m.uid !== u).map(m => ref('membros', m.uid)));
  await deleteDoc(ref('membros', u));
  await deleteDoc(doc(fs, 'households', hid));
  const perfil = await lerPerfil(u);
  const resto = perfil.casas.filter(x => x !== hid);
  await salvarPerfil(u, resto, resto[0] || '');
  CASA = null; DB = null;
});

// ------------------------------------------------------------------ dados em tempo real
function pararEscuta() { unsubs.forEach(f => f()); unsubs = []; }

function escutarDados(hid) {
  pararEscuta();
  DB = { membros: [], grupos: [], despesas: [], compras: [], pagamentos: [], pessoais: [], pessoaisCompras: [] };
  const meuUid = usuarioAtual().uid;
  const caminhos = {
    membros: ['households', hid, 'membros'], grupos: ['households', hid, 'grupos'],
    despesas: ['households', hid, 'despesas'], compras: ['households', hid, 'compras'],
    pagamentos: ['households', hid, 'pagamentos'],
    pessoais: ['households', hid, 'pessoais', meuUid, 'despesas'],
    pessoaisCompras: ['households', hid, 'pessoais', meuUid, 'compras']
  };
  const colecoes = Object.keys(caminhos);
  let pendentes = colecoes.length;
  // Mudanças no próprio grupo (nome, opção de despesas pessoais)
  unsubs.push(onSnapshot(doc(fs, 'households', hid), snap => {
    if (!snap.exists() || !CASA || CASA.id !== hid) return;
    CASA = { id: hid, ...snap.data() };
    window.dispatchEvent(new CustomEvent('rachae:dados', { detail: { colecao: 'grupo' } }));
  }, () => {}));
  return new Promise((resolve, reject) => {
    colecoes.forEach(nome => {
      let primeira = true;
      unsubs.push(onSnapshot(collection(fs, ...caminhos[nome]), snap => {
        DB[nome] = snap.docs.map(d => {
          const x = { id: d.id, ...d.data() };
          if (nome === 'membros') x.uid = d.id;
          if (x.criadoEm && x.criadoEm.toMillis) x.criadoEm = String(x.criadoEm.toMillis());
          return x;
        });
        if (primeira) { primeira = false; if (--pendentes === 0) resolve(); }
        else window.dispatchEvent(new CustomEvent('rachae:dados', { detail: { colecao: nome } }));
      }, err => {
        if (primeira) reject(err);
        else window.dispatchEvent(new CustomEvent('rachae:erro', { detail: traduz(err) }));
      }));
    });
  });
}

// ------------------------------------------------------------------ tradução nome <-> uid
const uidPorNome = nome => {
  const m = DB.membros.find(x => x.nome === nome);
  if (!m) throw new ApiError('Pessoa não encontrada: ' + nome);
  return m.uid;
};
const grupoPorNome = nome => {
  const g = DB.grupos.find(x => x.nome === nome);
  if (!g) throw new ApiError('Conjunto não encontrado: ' + nome);
  return g;
};
const nomePorUid = uid => (DB.membros.find(m => m.uid === uid) || {}).nome || 'Ex-morador(a)';
const centavos = v => {
  const c = Math.round(Number(v) * 100);
  if (!(c > 0)) throw new ApiError('Informe um valor maior que zero.');
  return c;
};
const dataOk = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : new Date().toISOString().slice(0, 10));
function divisaoParaUids(payload) {
  if (!payload.divisao) return null;
  const out = {};
  Object.keys(payload.divisao).forEach(nome => {
    const v = Number(payload.divisao[nome]) || 0;
    out[uidPorNome(nome)] = payload.metodo === 'Porcentagem' ? v : Math.round(v * 100);
  });
  return out;
}
function exigirCasa() {
  if (!CASA || !DB) throw new ApiError('Entre novamente.', 'AUTH');
}

// ------------------------------------------------------------------ ações usadas pelas telas
const ACOES = {
  config() {
    return {
      names: DB.membros.map(m => m.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
      categorias: CASA.categorias || CATEGORIAS_PADRAO,
      segmentos: CASA.segmentos || SEGMENTOS_PADRAO,
      metodos: METODOS,
      emailsConfigured: true,
      despesasPessoais: !!CASA.despesasPessoais
    };
  },
  grupos() {
    return DB.grupos
      .map(g => ({ nome: g.nome, tipo: g.tipo, todos: !!g.todos, id: g.id, criadoPor: g.criadoPor,
        membros: [...membrosDoGrupo(g, DB.membros)].map(nomePorUid) }))
      .sort((a, b) => (b.todos - a.todos) || a.nome.localeCompare(b.nome, 'pt-BR'));
  },
  dashboard({ grupo }) {
    if (grupo === PESSOAL) return montarDashboardPessoal(DB.pessoais, DB.pessoaisCompras);
    return comPix(ACOES._dashboard({ grupo }));
  },
  _dashboard({ grupo }) {
    const u = usuarioAtual().uid;
    const g = DB.grupos.find(x => x.nome === grupo)
      || DB.grupos.find(x => membrosDoGrupo(x, DB.membros).has(u)) || DB.grupos[0];
    const d = montarDashboard(DB, u, g && g.id);
    d.grupos = DB.grupos.map(x => ({ nome: x.nome, tipo: x.tipo }));
    return d;
  },
  comprasParaPagamento({ grupo }) {
    return ACOES.dashboard({ grupo }).comprasEmAberto;
  },
  historico({ grupo }) {
    if (grupo === PESSOAL) return montarHistoricoPessoal(DB.pessoais, DB.pessoaisCompras);
    const g = DB.grupos.find(x => x.nome === grupo);
    return montarHistorico(DB, g && g.id, usuarioAtual().uid, souDono());
  },
  async addDespesa({ payload }) {
    if (payload.grupo === PESSOAL) {
      if (!CASA.despesasPessoais) throw new ApiError('Despesas pessoais estão desligadas neste grupo.');
      const ref = await addDoc(collection(fs, 'households', CASA.id, 'pessoais', usuarioAtual().uid, 'despesas'), {
        data: dataOk(payload.data), descricao: String(payload.descricao).trim().slice(0, 80),
        categoria: payload.categoria, valor: centavos(payload.valorTotal), criadoEm: serverTimestamp()
      });
      return { ok: true, row: 'p:' + ref.id };
    }
    const g = grupoPorNome(payload.grupo);
    const ref = await addDoc(collection(fs, 'households', CASA.id, 'despesas'), {
      data: dataOk(payload.data), descricao: String(payload.descricao).trim().slice(0, 80),
      categoria: payload.categoria, segmento: payload.segmento, grupoId: g.id,
      valor: centavos(payload.valorTotal), pagoPor: uidPorNome(payload.pagoPor), metodo: payload.metodo,
      participantes: payload.participantes.map(uidPorNome), divisao: divisaoParaUids(payload),
      criadoPor: usuarioAtual().uid, criadoEm: serverTimestamp()
    });
    return { ok: true, row: ref.id };
  },
  async addCompraParcelada({ payload }) {
    if (payload.grupo === PESSOAL) {
      if (!CASA.despesasPessoais) throw new ApiError('Despesas pessoais estão desligadas neste grupo.');
      const ref = await addDoc(collection(fs, 'households', CASA.id, 'pessoais', usuarioAtual().uid, 'compras'), {
        data: dataOk(payload.data), descricao: String(payload.descricao).trim().slice(0, 80),
        categoria: payload.categoria, valor: centavos(payload.valorTotal),
        nParcelas: Math.max(1, Math.min(60, parseInt(payload.nParcelas, 10) || 1)),
        parcelaSeguinte: !!payload.parcelaSeguinte, criadoEm: serverTimestamp()
      });
      return { ok: true, id: 'pc:' + ref.id };
    }
    const g = grupoPorNome(payload.grupo);
    const ref = await addDoc(collection(fs, 'households', CASA.id, 'compras'), {
      data: dataOk(payload.data), descricao: String(payload.descricao).trim().slice(0, 80),
      categoria: payload.categoria, grupoId: g.id, valor: centavos(payload.valorTotal),
      comprador: uidPorNome(payload.comprador), nParcelas: Math.max(1, Math.min(60, parseInt(payload.nParcelas, 10) || 1)),
      metodo: payload.metodo, participantes: payload.participantes.map(uidPorNome), divisao: divisaoParaUids(payload),
      parcelaSeguinte: !!payload.parcelaSeguinte, criadoPor: usuarioAtual().uid, criadoEm: serverTimestamp()
    });
    return { ok: true, id: 'CP-' + ref.id.slice(0, 5).toUpperCase() };
  },
  async addPagamento({ payload }) {
    await addDoc(collection(fs, 'households', CASA.id, 'pagamentos'), {
      data: dataOk(payload.data), compraId: payload.compraId, pessoa: usuarioAtual().uid,
      valor: centavos(payload.valor), criadoEm: serverTimestamp()
    });
    return { ok: true };
  },
  async apagar({ colecao, id }) {
    if (colecao === 'pessoais' || colecao === 'pessoaisCompras') {
      const sub = colecao === 'pessoais' ? 'despesas' : 'compras';
      await deleteDoc(doc(fs, 'households', CASA.id, 'pessoais', usuarioAtual().uid, sub, id));
      return { ok: true };
    }
    if (!['despesas', 'compras', 'pagamentos'].includes(colecao)) throw new ApiError('Tipo inválido.');
    if (colecao === 'compras' && DB.pagamentos.some(p => p.compraId === id)) {
      throw new ApiError('Essa compra já tem pagamentos registrados. Apague os pagamentos primeiro.');
    }
    await deleteDoc(doc(fs, 'households', CASA.id, colecao, id));
    return { ok: true };
  },
  async salvarGrupo({ id, nome, tipo, membros }) {
    const n = String(nome || '').trim().slice(0, 30);
    if (!n) throw new ApiError('Dê um nome ao conjunto.');
    if (DB.grupos.some(g => g.id !== id && g.nome.toLowerCase() === n.toLowerCase())) throw new ApiError('Já existe um conjunto com esse nome.');
    const uids = (membros || []).map(uidPorNome);
    const atual = id ? DB.grupos.find(g => g.id === id) : null;
    if (atual && atual.todos) {
      // Conjunto com todos do grupo: só o nome muda (quem participa é sempre todo mundo)
      await setDoc(doc(fs, 'households', CASA.id, 'grupos', id),
        { nome: n, tipo: atual.tipo || 'Compartilhado', todos: true, membros: [], criadoPor: atual.criadoPor });
      return { ok: true };
    }
    if (!uids.length) throw new ApiError('Marque pelo menos uma pessoa no conjunto.');
    if (id) {
      await setDoc(doc(fs, 'households', CASA.id, 'grupos', id),
        { nome: n, tipo, todos: false, membros: uids, criadoPor: atual.criadoPor });
    } else {
      await addDoc(collection(fs, 'households', CASA.id, 'grupos'),
        { nome: n, tipo, todos: false, membros: uids, criadoPor: usuarioAtual().uid });
    }
    return { ok: true };
  },
  async excluirGrupo({ id }) {
    const g = DB.grupos.find(x => x.id === id);
    if (!g) throw new ApiError('Conjunto não encontrado.');
    if (g.todos) throw new ApiError('O conjunto com todos do grupo não pode ser excluído.');
    const u = usuarioAtual().uid;
    const despesas = DB.despesas.filter(d => d.grupoId === id);
    const compras = DB.compras.filter(c => c.grupoId === id);
    const idsCompras = new Set(compras.map(c => c.id));
    const pagamentos = DB.pagamentos.filter(p => idsCompras.has(p.compraId));
    const temLancamentos = despesas.length + compras.length + pagamentos.length > 0;
    if (!souDono() && g.criadoPor !== u) throw new ApiError('Só quem criou o conjunto (ou quem administra o grupo) pode excluí-lo.');
    if (temLancamentos && !souDono()) {
      throw new ApiError('Esse conjunto tem lançamentos. Só quem administra o grupo pode excluí-lo junto com eles.');
    }
    // Apaga lançamentos (pagamentos antes das compras) e por último o grupo; lotes de até 450
    const refs = [
      ...pagamentos.map(p => doc(fs, 'households', CASA.id, 'pagamentos', p.id)),
      ...compras.map(c => doc(fs, 'households', CASA.id, 'compras', c.id)),
      ...despesas.map(d => doc(fs, 'households', CASA.id, 'despesas', d.id)),
      doc(fs, 'households', CASA.id, 'grupos', id)
    ];
    await apagarEmLotes(refs);
    return { ok: true, apagados: refs.length - 1 };
  },
  contarLancamentosGrupo({ id }) {
    const idsCompras = new Set(DB.compras.filter(c => c.grupoId === id).map(c => c.id));
    return DB.despesas.filter(d => d.grupoId === id).length + idsCompras.size +
      DB.pagamentos.filter(p => idsCompras.has(p.compraId)).length;
  },
  async despesasPessoais({ ativo }) {
    if (!souDono()) throw new ApiError('Só quem criou o grupo muda essa opção.');
    await updateDoc(doc(fs, 'households', CASA.id), { despesasPessoais: !!ativo });
    CASA.despesasPessoais = !!ativo;
    return { ok: true };
  },
  async salvarPix({ tipo, chave, nome, cidade }) {
    const n = normalizarChave(tipo, chave);
    if (n.erro) throw new ApiError(n.erro);
    const titular = String(nome || '').trim().slice(0, 25);
    const cid = String(cidade || '').trim().slice(0, 15);
    if (!titular) throw new ApiError('Informe o nome do titular da conta (como aparece no banco).');
    if (!cid) throw new ApiError('Informe a cidade do titular.');
    return salvarPixEmTodosOsGrupos({ tipo, chave: n.chave, nome: titular, cidade: cid });
  },
  async removerPix() {
    return salvarPixEmTodosOsGrupos(null);
  },
  meuPix() {
    const eu = DB.membros.find(m => m.uid === usuarioAtual().uid);
    return (eu && eu.pix) || null;
  },
  /** Registra que eu paguei alguém (acerto de contas): zera a dívida nos saldos, não conta como gasto. */
  async registrarAcerto({ para, valor, grupo, mesRef }) {
    const g = grupoPorNome(grupo);
    const u = usuarioAtual().uid;
    if (para === u) throw new ApiError('Não dá para acertar contas consigo mesma(o).');
    if (!DB.membros.some(m => m.uid === para)) throw new ApiError('Essa pessoa não está mais no grupo.');
    await addDoc(collection(fs, 'households', CASA.id, 'despesas'), {
      data: new Date().toISOString().slice(0, 10),
      descricao: ('Acerto: ' + nomePorUid(u) + ' → ' + nomePorUid(para)).slice(0, 80),
      categoria: 'Acerto', segmento: 'À Vista', grupoId: g.id, valor: centavos(valor), pagoPor: u,
      metodo: 'Igual', participantes: [para], divisao: null, acerto: true,
      mesRef: /^\d{4}-\d{2}$/.test(mesRef || '') ? mesRef : new Date().toISOString().slice(0, 7),
      criadoPor: u, criadoEm: serverTimestamp()
    });
    return { ok: true };
  },
  meuNome() {
    const eu = DB.membros.find(m => m.uid === usuarioAtual().uid);
    return eu ? eu.nome : null;
  },
  async renomearGrupo({ nome }) {
    if (!souDono()) throw new ApiError('Só quem administra o grupo pode mudar o nome.');
    const n = String(nome || '').trim().slice(0, 40);
    if (!n) throw new ApiError('Dê um nome ao grupo.');
    await updateDoc(doc(fs, 'households', CASA.id), { nome: n });
    CASA.nome = n;
    return { ok: true };
  },
  async renomearMe({ nome }) {
    const n = validarNome(nome);
    const u = usuarioAtual().uid;
    if (DB.membros.some(m => m.uid !== u && m.nome.toLowerCase() === n.toLowerCase())) {
      throw new ApiError('Já tem alguém com esse nome no grupo. Use um sobrenome ou apelido.');
    }
    await updateDoc(doc(fs, 'households', CASA.id, 'membros', u), { nome: n });
    return { ok: true, nome: n };
  },
  membros() {
    return DB.membros.map(m => ({ nome: m.nome, email: m.email, uid: m.uid, dono: m.uid === CASA.ownerUid, temPix: !!m.pix }))
      .sort((a, b) => b.dono - a.dono || a.nome.localeCompare(b.nome, 'pt-BR'));
  },
  async removerMembro({ uid }) {
    if (!souDono()) throw new ApiError('Só quem criou o grupo pode remover pessoas.');
    await deleteDoc(doc(fs, 'households', CASA.id, 'membros', uid));
    return { ok: true };
  }
};

/** Anexa a chave Pix de quem recebe às sugestões de acerto e às compras em aberto. */
function comPix(d) {
  const pixDe = uid => { const m = DB.membros.find(x => x.uid === uid); return (m && m.pix) || null; };
  d.acertos = (d.acertos || []).map(a => ({ ...a, pix: pixDe(a.para) }));
  Object.values(d.meses || {}).forEach(m => { m.acertos = m.acertos.map(a => ({ ...a, pix: pixDe(a.para) })); });
  d.comprasEmAberto = (d.comprasEmAberto || []).map(c => ({ ...c, pix: pixDe(c.comprador) }));
  return d;
}

/** A chave vale para a pessoa em todos os grupos dela (fica no registro de membro de cada um). */
async function salvarPixEmTodosOsGrupos(pix) {
  const u = usuarioAtual().uid;
  const { casas } = await lerPerfil(u);
  let ok = 0;
  for (const hid of [...new Set([CASA.id, ...casas])]) {
    try { await updateDoc(doc(fs, 'households', hid, 'membros', u), { pix }); ok++; } catch (e) { /* grupo inacessível */ }
  }
  if (!ok) throw new ApiError('Não foi possível salvar a chave Pix.');
  return { ok: true, grupos: ok };
}

export async function api(action, params = {}) {
  exigirConfig();
  if (!usuarioAtual()) throw new ApiError('Entre novamente.', 'AUTH');
  exigirCasa();
  const fn = ACOES[action];
  if (!fn) throw new ApiError('Ação desconhecida: ' + action);
  return tenta(() => fn(params));
}
