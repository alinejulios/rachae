// Landing page: seletor "Para quem", carrossel de diferenciais e lista de espera.
// A lista de espera grava em listaEspera/{email} no Firestore (regra: só criar, ninguém lê).
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const check = (w, sw) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`;

// Quem já entrou neste aparelho vê "Abrir o app" no topo
try { if (localStorage.getItem('rachae_pessoa')) { $('lp-entrar').textContent = 'Abrir o app'; $('lp-entrar').href = '/home'; } } catch (e) {}

// =================================================================== Para quem
const MODOS = [
  {
    id: 'eu', label: 'Só você', title: 'As suas contas sem planilha',
    text: 'Renda, cartões e contas fixas num lugar só. Você vê a fatura antes de ela chegar e sabe quanto sobra do salário.',
    bullets: ['Cada cartão na cor do banco', 'A fatura deste mês e a dos próximos', 'A previsão da sobra do salário'],
    panel: 'Outubro · só você',
    rows: [
      { dot: '#820ad1', t: 'Fatura do cartão roxo', s: 'vence dia 10', v: 'R$ 1.240,00' },
      { dot: '#ec7000', t: 'Fatura do cartão laranja', s: 'vence dia 15', v: 'R$ 620,50' },
      { dot: '#0ea5c6', t: 'Fatura do cartão azul', s: 'vence dia 20', v: 'R$ 310,00' }
    ],
    totalLabel: 'Sobra do salário', total: '+R$ 1.829,50', estimate: true,
    alt: 'Exemplo de outubro só com as suas contas: três faturas de cartão e sobra estimada de R$ 1.829,50'
  },
  {
    id: 'casa', label: 'Em casa', title: 'A casa em dia',
    text: 'Casal ou família: as contas da casa num lugar só, com a parte de cada pessoa e o dia de cada vencimento.',
    bullets: ['Divisão por igual, por porcentagem ou valor exato', 'Contas fixas com dia de vencimento', 'Quem deve a quem, num número só'],
    panel: 'Outubro · Apê da Rua 7',
    rows: [
      { dot: '#2a78d6', t: 'Mercado', s: 'você pagou', v: 'R$ 517,96' },
      { dot: '#eda100', t: 'Luz', s: 'dia 12 · Ana pagou', v: 'R$ 184,37' },
      { dot: '#1baf7a', t: 'Internet', s: 'dia 15 · Lucas pagou', v: 'R$ 119,90' }
    ],
    totalLabel: 'A receber no mês', total: '+R$ 312,40', estimate: false,
    alt: 'Exemplo das contas da casa em outubro: mercado, luz e internet, com R$ 312,40 a receber'
  },
  {
    id: 'role', label: 'No rolê', title: 'O rolê acertado',
    text: 'Viagem, jantar ou presente de aniversário: a despesa entra na hora, é dividida entre quem participou e cada pessoa vê a sua parte.',
    bullets: ['Um grupo para cada viagem ou rolê', 'Divisão só entre quem participou', 'O acerto no fim, sem planilha'],
    panel: 'Jantar de sexta · 4 pessoas',
    rows: [
      { dot: '#eb6834', t: 'Restaurante', s: 'você pagou', v: 'R$ 336,00' },
      { dot: '#4a3aa7', t: 'Uber da volta', s: 'Ana pagou', v: 'R$ 48,00' },
      { dot: '#e87ba4', t: 'Sobremesa', s: 'Bia pagou', v: 'R$ 52,00' }
    ],
    totalLabel: 'Você vai receber', total: '+R$ 227,00', estimate: false,
    alt: 'Exemplo de um jantar dividido por 4 pessoas, com R$ 227,00 a receber'
  }
];
let modo = 'eu';
function desenharModos() {
  const m = MODOS.find(x => x.id === modo);
  $('pq-modos').innerHTML = MODOS.map(x => {
    const on = x.id === modo;
    return `<button type="button" data-modo="${x.id}" aria-pressed="${on}" style="min-height: 44px; border-radius: 8px; border: 2px solid ${on ? '#2563eb' : 'transparent'}; background: ${on ? '#e8efff' : 'transparent'}; color: ${on ? '#1d4ed8' : '#5b6779'}; font-family: Inter, sans-serif; font-weight: 700; font-size: 15px; cursor: pointer; padding: 0 8px">${esc(x.label)}</button>`;
  }).join('');
  $('pq-painel').innerHTML = `
        <div style="flex: 1 1 420px; min-width: 0; background: #f4f7fc; padding: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 16px">
          <h3 style="margin: 0; font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: clamp(24px, 2.6vw, 32px); line-height: 1.15; letter-spacing: -0.02em">${esc(m.title)}</h3>
          <p style="margin: 0; font-size: 17px; color: #5b6779">${esc(m.text)}</p>
          <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px">
            ${m.bullets.map(b => `<li style="display: flex; align-items: flex-start; gap: 10px">
              <span aria-hidden="true" style="flex: none; margin-top: 2px; width: 20px; height: 20px; border-radius: 999px; background: #e3f8ef; color: #047857; display: flex; align-items: center; justify-content: center">${check(12, 3)}</span>
              <span>${esc(b)}</span></li>`).join('')}
          </ul>
        </div>
        <div style="flex: 1 1 360px; min-width: 0; background: #ffffff; padding: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; justify-content: center">
          <div role="img" aria-label="${esc(m.alt)}" style="border: 1px solid rgba(20,40,80,0.10); border-radius: 16px; padding: 12px 16px 16px; display: flex; flex-direction: column">
            <span style="font-size: 13px; font-weight: 700; color: #5b6779; padding-bottom: 4px">${esc(m.panel)}</span>
            ${m.rows.map(r => `<div style="display: flex; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid #e6ebf4">
                <span style="flex: none; width: 10px; height: 10px; border-radius: 4px; background: ${r.dot}"></span>
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column">
                  <span style="font-weight: 700; font-size: 15px">${esc(r.t)}</span>
                  <span style="font-size: 12.5px; color: #5b6779">${esc(r.s)}</span>
                </div>
                <span class="r-num" style="font-weight: 700; font-size: 15px; color: #111827; white-space: nowrap">${esc(r.v)}</span>
              </div>`).join('')}
            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding-top: 14px">
              <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #5b6779; white-space: nowrap">${esc(m.totalLabel)}
                ${m.estimate ? '<span style="padding: 2px 8px; border-radius: 999px; background: #e0f8ff; color: #006f8f; font-size: 11px; font-weight: 700">estimado</span>' : ''}
              </span>
              <span class="r-num" style="font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 700; font-size: 24px; color: #047857; white-space: nowrap">${esc(m.total)}</span>
            </div>
          </div>
        </div>`;
}
$('pq-modos').addEventListener('click', e => {
  const b = e.target.closest('[data-modo]');
  if (b && b.dataset.modo !== modo) { modo = b.dataset.modo; desenharModos(); $('pq-modos').querySelector(`[data-modo="${modo}"]`).focus(); }
});
desenharModos();

// =================================================================== Diferenciais (carrossel)
const SLIDES = [
  { n: '01', title: 'Todas as contas numa visão só', rachae: 'as suas, as da casa e as divididas aparecem juntas, e a sua parte entra automaticamente no cálculo do mês.', others: 'Finanças de um lado e conta dividida do outro: para ver tudo, você junta dois apps e uma planilha.' },
  { n: '02', title: 'Previsão, não só registro', rachae: 'você vê a fatura antes de ela chegar e quanto deve sobrar do salário no fim do mês.', others: 'Sem previsão, o que ainda vai vencer fica por sua conta.' },
  { n: '03', title: 'Para você, a casa ou a turma', rachae: 'contas só suas, o grupo da casa ou do casal, a viagem com a turma. Troque de grupo pelo nome no topo da tela.', others: 'Há app só para casal e app só para dividir conta. A sua vida financeira não cabe num formato só.' },
  { n: '04', title: 'Funciona com o banco que você já tem', rachae: 'nada de abrir conta nova nem mudar o seu dinheiro de lugar. O Rachaê organiza, e o pagamento sai do seu banco de sempre.', others: 'Há apps que são conta digital: você abre conta, transfere o dinheiro e paga mensalidade.' },
  { n: '05', title: 'Acerto com Pix, na hora', rachae: 'quem deve paga com o código Pix ou o QR que o app já mostra. Pagou, registrou, o grupo fica em dia.', others: 'Em apps feitos lá fora, o acerto passa por carteiras digitais como o PayPal ou é só marcado como pago.' },
  { n: '06', title: 'Cartões na cor do seu banco', rachae: 'cada cartão aparece na cor do banco, com a fatura mês a mês e as parcelas no lugar certo.', others: 'Em apps estrangeiros, organizar cartão pode ser recurso pago e restrito a bancos dos Estados Unidos.' }
];
const TOTAL = SLIDES.length;
let atual = 0;
$('dif-track').innerHTML = SLIDES.map(sl => `
            <div role="group" aria-roledescription="slide" aria-label="${sl.n} de 06" style="flex: 0 0 100%; min-width: 0; box-sizing: border-box; display: flex">
              <div style="flex: 1; display: flex; flex-wrap: wrap; border: 1px solid rgba(20,40,80,0.10); border-radius: 16px; overflow: hidden">
                <div style="flex: 1 1 440px; min-width: 0; background: #ffffff; padding: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; justify-content: center; gap: 16px">
                  <span class="r-num" style="font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: 48px; line-height: 1; letter-spacing: -0.02em; color: #2563eb">${sl.n}</span>
                  <h3 style="margin: 0; font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; font-size: clamp(24px, 2.6vw, 32px); line-height: 1.15; letter-spacing: -0.02em">${esc(sl.title)}</h3>
                  <div style="display: flex; align-items: flex-start; gap: 10px">
                    <span aria-hidden="true" style="flex: none; margin-top: 2px; width: 22px; height: 22px; border-radius: 999px; background: #e3f8ef; color: #047857; display: flex; align-items: center; justify-content: center">${check(13, 3)}</span>
                    <p style="margin: 0; font-size: 17px; line-height: 1.55; color: #111827"><strong>No Rachaê:</strong> ${esc(sl.rachae)}</p>
                  </div>
                </div>
                <div style="flex: 1 1 320px; min-width: 0; background: #f4f7fc; padding: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; justify-content: center; gap: 10px">
                  <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #5b6779">
                    <span aria-hidden="true" style="width: 22px; height: 22px; border-radius: 999px; background: #e6ebf4; color: #5b6779; display: flex; align-items: center; justify-content: center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                    </span>
                    Em outros apps
                  </span>
                  <p style="margin: 0; font-size: 16px; line-height: 1.55; color: #5b6779">${esc(sl.others)}</p>
                </div>
              </div>
            </div>`).join('');
function desenharCarrossel() {
  $('dif-track').style.transform = `translateX(${-atual * 100}%)`;
  [...$('dif-track').children].forEach((el, k) => { el.setAttribute('aria-hidden', k === atual ? 'false' : 'true'); el.inert = k !== atual; });
  $('dif-contador').textContent = (atual + 1) + ' de ' + TOTAL;
  $('dif-chips').innerHTML = SLIDES.map((sl, k) => {
    const on = k === atual;
    return `<button type="button" data-ir="${k}" aria-current="${on}" aria-controls="dif-track" style="display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: ${on ? '0 14px' : '0 15px'}; border-radius: 999px; background: ${on ? '#e8efff' : '#ffffff'}; border: ${on ? '2px solid #2563eb' : '1px solid #8b95a5'}; color: ${on ? '#1d4ed8' : '#5b6779'}; font-family: Inter, sans-serif; font-weight: 700; font-size: 13px; cursor: pointer"><span class="r-num" style="color: ${on ? '#2563eb' : '#687282'}">${sl.n}</span>${esc(sl.title)}</button>`;
  }).join('');
  $('dif-pontos').innerHTML = SLIDES.map((sl, k) => {
    const on = k === atual;
    return `<button type="button" data-ir="${k}" aria-label="Ir para o diferencial ${k + 1}" aria-current="${on}" style="width: 38px; height: 38px; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0">
            <span style="display: block; height: 8px; width: ${on ? '24px' : '8px'}; border-radius: 999px; background: ${on ? '#2563eb' : '#8b95a5'}; transition: width 250ms ease"></span></button>`;
  }).join('');
}
const ir = k => { atual = (k + TOTAL) % TOTAL; desenharCarrossel(); };
$('dif-ant').addEventListener('click', () => ir(atual - 1));
$('dif-prox').addEventListener('click', () => ir(atual + 1));
['dif-chips', 'dif-pontos'].forEach(id => $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-ir]');
  if (!b) return;
  ir(+b.dataset.ir);
  const novo = $(id).querySelector(`[data-ir="${atual}"]`);
  if (novo) novo.focus();
}));
$('dif-regiao').addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { e.preventDefault(); ir(atual + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); ir(atual - 1); }
});
let toqueX = null;
$('dif-regiao').addEventListener('touchstart', e => { toqueX = e.touches[0] ? e.touches[0].clientX : null; }, { passive: true });
$('dif-regiao').addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  if (toqueX == null || !t) return;
  const d = t.clientX - toqueX;
  toqueX = null;
  if (d < -40) ir(atual + 1); else if (d > 40) ir(atual - 1);
});
desenharCarrossel();

// =================================================================== Lista de espera
const USOS = [['eu', 'Só eu'], ['casa', 'Casa ou família'], ['casal', 'Casal'], ['role', 'Viagens e rolês']];
const ORIGENS = [['indicacao', 'Indicação'], ['redes', 'Redes sociais'], ['busca', 'Internet ou Google']];
const usos = new Set();
let origem = '';
// Mesma validação da regra do Firestore (listaEspera)
const EMAIL_OK = /^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/; // sem "/": o e-mail é o ID do documento

function desenharOpcoes() {
  $('wl-usos').innerHTML = USOS.map(([id, label]) => {
    const on = usos.has(id);
    return `<button type="button" data-uso="${id}" aria-pressed="${on}" style="display: inline-flex; align-items: center; min-height: 38px; padding: ${on ? '0 14px' : '0 15px'}; border-radius: 999px; background: ${on ? '#e8efff' : '#ffffff'}; border: ${on ? '2px solid #2563eb' : '1px solid #8b95a5'}; color: ${on ? '#1d4ed8' : '#5b6779'}; font-family: Inter, sans-serif; font-weight: 700; font-size: 13px; cursor: pointer">${label}</button>`;
  }).join('');
  $('wl-origens').innerHTML = ORIGENS.map(([id, label]) => {
    const on = origem === id;
    return `<label class="lp-radio" style="position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 38px; box-sizing: border-box; padding: ${on ? '0 13px 0 11px' : '0 14px 0 12px'}; border-radius: 999px; background: ${on ? '#e8efff' : '#ffffff'}; border: ${on ? '2px solid #2563eb' : '1px solid #8b95a5'}; color: ${on ? '#1d4ed8' : '#5b6779'}; font-weight: 700; font-size: 13px; cursor: pointer">
      <input type="radio" name="wl-origem" value="${id}"${on ? ' checked' : ''}>
      <span aria-hidden="true" style="flex: none; width: 14px; height: 14px; box-sizing: border-box; border-radius: 999px; background: #ffffff; border: ${on ? '5px solid #2563eb' : '2px solid #8b95a5'}"></span>
      ${label}</label>`;
  }).join('');
}
$('wl-usos').addEventListener('click', e => {
  const b = e.target.closest('[data-uso]');
  if (!b) return;
  const id = b.dataset.uso;
  usos.has(id) ? usos.delete(id) : usos.add(id);
  desenharOpcoes();
  $('wl-usos').querySelector(`[data-uso="${id}"]`).focus();
});
$('wl-origens').addEventListener('change', e => {
  if (e.target.name !== 'wl-origem') return;
  origem = e.target.value;
  desenharOpcoes();
  $('wl-origens').querySelector(`input[value="${origem}"]`).focus();
});
desenharOpcoes();

const mostrar = (el, sim) => { el.hidden = !sim; el.style.display = sim ? 'flex' : ''; };
function erroCampo(id, msg) {
  const input = $(id), hint = $(id + '-hint');
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (msg) input.setAttribute('aria-describedby', id + '-hint'); else input.removeAttribute('aria-describedby');
  input.style.border = msg ? '2px solid #dc2626' : '1px solid #8b95a5';
  input.style.padding = msg ? '0 11px' : '0 12px';
  hint.textContent = msg;
  hint.hidden = !msg;
}
['wl-nome', 'wl-sobrenome', 'wl-email'].forEach(id => $(id).addEventListener('input', () => erroCampo(id, '')));
function erroGeral(msg) { $('wl-erro-txt').textContent = msg; mostrar($('wl-erro'), !!msg); }

let enviando = false, timerLento = null;
function ocupado(sim) {
  enviando = sim;
  $('wl-enviar').disabled = sim;
  $('wl-enviar').style.opacity = sim ? '0.55' : '1';
  $('wl-enviar').textContent = sim ? 'Entrando na lista…' : 'Entrar na lista de espera';
  clearTimeout(timerLento);
  mostrar($('wl-lento'), false);
  if (sim) timerLento = setTimeout(() => mostrar($('wl-lento'), true), 8000);
}

// SDK do Firebase só quando a pessoa envia (a página abre leve)
let gravarNaLista = null;
async function carregarFirestore() {
  if (gravarNaLista) return gravarNaLista;
  const [{ initializeApp }, fs, { firebaseConfig }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js'),
    import('/firebase-config.js')
  ]);
  const db = fs.getFirestore(initializeApp(firebaseConfig, 'lista-espera'));
  gravarNaLista = dados => fs.setDoc(fs.doc(db, 'listaEspera', dados.email), { ...dados, criadoEm: fs.serverTimestamp() });
  return gravarNaLista;
}

async function enviar() {
  if (enviando) return;
  const nome = $('wl-nome').value.trim(), sobrenome = $('wl-sobrenome').value.trim();
  const email = $('wl-email').value.trim().toLowerCase();
  const eNome = nome ? '' : 'Digite o seu nome.';
  const eSobrenome = sobrenome ? '' : 'Digite o seu sobrenome.';
  const eEmail = !email ? 'Digite o seu e-mail.' : (EMAIL_OK.test(email) ? '' : 'Digite um e-mail válido, como nome@email.com.');
  erroCampo('wl-nome', eNome); erroCampo('wl-sobrenome', eSobrenome); erroCampo('wl-email', eEmail);
  erroGeral('');
  if (eNome || eSobrenome || eEmail) { $(eNome ? 'wl-nome' : eSobrenome ? 'wl-sobrenome' : 'wl-email').focus(); return; }
  if (navigator.onLine === false) { erroGeral('Sem internet. Seus dados ficam no formulário até a conexão voltar.'); return; }

  ocupado(true);
  let repetido = false;
  try {
    const gravar = await carregarFirestore();
    await gravar({ nome, sobrenome, email, usos: USOS.map(([id]) => id).filter(id => usos.has(id)), origem });
  } catch (err) {
    // A regra só permite criar: o mesmo e-mail de novo vira "atualizar" e é recusado
    if (err && err.code === 'permission-denied') repetido = true;
    else {
      ocupado(false);
      erroGeral('Não conseguimos registrar o seu e-mail agora. Seus dados continuam no formulário. Tente de novo em instantes.');
      return;
    }
  }
  ocupado(false);
  $('wl-ok-titulo').textContent = repetido ? 'Esse e-mail já está na lista' : nome + ', você está na lista';
  $('wl-ok-email').textContent = email;
  $('wl-form').hidden = true;
  mostrar($('wl-ok'), true);
  $('wl-ok-titulo').focus();
}
$('wl-form').addEventListener('submit', e => { e.preventDefault(); enviar(); });
$('wl-tentar').addEventListener('click', () => { ocupado(false); enviar(); });
$('wl-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.origin + '/'); $('wl-copiar').textContent = 'Link copiado'; }
  catch (e) { $('wl-copiar').textContent = 'Não deu para copiar o link'; }
});
$('wl-outro').addEventListener('click', () => {
  ['wl-nome', 'wl-sobrenome', 'wl-email'].forEach(id => { $(id).value = ''; erroCampo(id, ''); });
  usos.clear(); origem = ''; desenharOpcoes(); erroGeral('');
  $('wl-copiar').textContent = 'Copiar link para chamar alguém';
  mostrar($('wl-ok'), false);
  $('wl-form').hidden = false;
  $('wl-nome').focus();
});
