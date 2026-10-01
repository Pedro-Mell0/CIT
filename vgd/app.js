/* ===========================================================================
   app.js — núcleo: acesso, barra lateral, informes e edição.
   Complementos: prova.js (prova e correção), manage.js (contas e canais),
   search.js (varredura).
   =========================================================================== */
// A sessão vive no sessionStorage: sobrevive ao F5, morre ao fechar o navegador.
const authStore = (() => {
  try {
    const s = window.sessionStorage;
    s.setItem('vgd.probe', '1'); s.removeItem('vgd.probe');
    return s;
  } catch {                       // navegação privada com storage bloqueado
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();

const $ = s => document.querySelector(s);

// Enquanto o config.js estiver com os valores de exemplo, `createClient` morre
// com "Invalid URL" e a página fica preta, sem uma linha que explique por quê.
// O aviso na tela custa cinco linhas e economiza meia hora de console.
//
// A conferência da chave é deliberadamente frouxa: serve para pegar o
// texto de exemplo, não para validar formato. O Supabase aceita tanto a
// `anon` antiga (um JWT longo) quanto a publishable nova (`sb_publishable_…`,
// bem mais curta), e exigir um tamanho mínimo generoso rejeitaria a segunda.
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(CFG?.url || '')
    || (CFG?.key || '').length < 20 || /COLE_AQUI/i.test(CFG?.key || '')) {
  $('#boot').textContent = '> CONFIGURAÇÃO AUSENTE\n'
    + '> preencha a URL e a chave anon do Supabase em config.js\n'
    + '> (Project Settings → API, no projeto da VGD)';
  $('#go').disabled = true;
  throw new Error('config.js ainda não foi preenchido.');
}

const sb = supabase.createClient(CFG.url, CFG.key, {
  auth: { storage: authStore, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let me, chan = 'mural', signup = false, live;
const people  = {};       // id -> perfil
const cats    = {};       // id -> categoria
const chans   = {};       // id -> canal
const catMem  = {};       // categoria -> Set(perfil)
const chanMem = {};       // canal     -> Set(perfil)
const cargos    = {};     // id -> cargo
const cargoMem  = {};     // perfil    -> Set(cargo)
const catCargos = {};     // categoria -> Set(cargo)
const chanCargos = {};    // canal     -> Set(cargo)
const msgEls  = new Map();// id da mensagem -> elemento
const order   = {};       // chave da barra lateral -> posição
const unread  = new Set();// canais com informe novo ainda não visto

// Painéis da sala. Só um fica visível de cada vez.
const PAINEIS = { chat: '#chat', prova: '#prova', resultados: '#resultados', exame: '#exame', contas: '#manage' };

/**
 * O nome do personagem reduzido a letras, números e pontos. É a parte local do
 * e-mail interno com que a conta entra, e precisa dar exatamente o mesmo
 * resultado que `handle_do_nome()` no schema.sql — mexer aqui obriga a mexer
 * lá. `normalize('NFD')` separa a letra do acento e o `replace` seguinte joga
 * fora os acentos soltos, que é como "José" vira "jose".
 */
const handleDe = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
const emailDe = nome => handleDe(nome) + '.vgd.vanguarda@gmail.com';

// ---------- o que já foi lido ----------
// Um Set em memória não dá conta: ele nasce vazio a cada F5 e só enxerga o que
// chega com a aba aberta, então informe recebido enquanto o oficial estava
// fora nunca acendia aviso nenhum. O que guardamos é a data da última visita a
// cada canal; o não lido sai da comparação com a data do informe mais recente.
// Fica no localStorage — precisa sobreviver ao fechar do navegador, ao
// contrário da sessão — e separado por conta.
let lido = {};
const chaveLido = () => 'vgd.lido.' + (me?.id || 'anon');

function carregaLido() {
  try { lido = JSON.parse(localStorage.getItem(chaveLido()) || '{}'); } catch { lido = {}; }
}

/**
 * Marca o canal como visto até `quando`. A data vem do servidor sempre que
 * possível — o informe mais recente já carregado — e não do relógio local:
 * relógio adiantado esconderia informe novo, atrasado deixaria aviso preso.
 * Nunca anda para trás.
 */
function marcaLido(key, quando) {
  unread.delete(key);
  if (!key || !(key === 'mural' || key.startsWith('chan:'))) return;
  const novo = quando || new Date().toISOString();
  if (lido[key] && Date.parse(lido[key]) >= Date.parse(novo)) return;
  lido[key] = novo;
  try { localStorage.setItem(chaveLido(), JSON.stringify(lido)); } catch {}
}

/**
 * Descobre o que chegou enquanto o oficial esteve fora: pede a data do informe
 * mais recente de cada canal e compara com a última visita. O agrupamento
 * pertence ao banco, por isso o RPC; se ele ainda não existir lá, caímos na
 * leitura direta das mensagens recentes. Em ambos os caminhos o RLS continua
 * valendo: só voltam canais que o oficial já podia ler.
 */
async function varreNaoLidas() {
  const ultimas = {};
  const { data, error } = await sb.rpc('ultimas_por_canal');
  if (!error && Array.isArray(data)) {
    data.forEach(r => { if (r?.channel) ultimas[r.channel] = r.ultima; });
  } else {
    const { data: msgs } = await sb.from('messages')
      .select('channel, created_at').order('created_at', { ascending: false }).limit(400);
    (msgs || []).forEach(m => { ultimas[m.channel] ??= m.created_at; });
  }
  Object.entries(ultimas).forEach(([key, quando]) => {
    const visto = lido[key] ? Date.parse(lido[key]) : 0;
    if (Date.parse(quando) > visto) unread.add(key);
  });
}

const isStaff   = () => me && (me.role === 'comando' || me.role === 'admin');
const isAdmin   = () => me && me.role === 'admin';
const isOficial = () => me && me.role !== 'candidato';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- tela de acesso ----------
const boot = [
  '> escuta aberta na frequência da unidade... SINAL FORTE',
  '> telemetria................................ ONLINE',
  '> portão da garagem VGD..................... AGUARDANDO CREDENCIAIS',
];
(async () => { for (const l of boot) { for (const ch of l) { $('#boot').textContent += ch; await new Promise(r => setTimeout(r, 12)); } $('#boot').textContent += '\n'; } })();

function mode(up) {
  signup = up;
  $('#t-in').classList.toggle('on', !up); $('#t-up').classList.toggle('on', up);
  $('#c').classList.toggle('hide', !up);
  $('#go').textContent = up ? 'Criar acesso' : 'Entrar';
  $('#p').autocomplete = up ? 'new-password' : 'current-password';
  $('#auth-tip').textContent = up
    ? 'Use o nome do seu personagem no RP, igual ao da ficha. É por ele que o comando vai te reconhecer. É com ele que você entra daqui em diante.'
    : 'Entre com o nome do seu personagem e a senha que você cadastrou.';
  $('#err').textContent = '';
}
$('#t-in').onclick = () => mode(false);
$('#t-up').onclick = () => mode(true);
['#u', '#p', '#c'].forEach(s => $(s).addEventListener('keydown', e => e.key === 'Enter' && $('#go').click()));

$('#go').onclick = async () => {
  const nome = $('#u').value.trim(), pass = $('#p').value, code = $('#c').value.trim(), err = $('#err');
  err.textContent = '';
  if (nome.length < 3 || nome.length > 40) return err.textContent = 'Nome do personagem: 3 a 40 caracteres.';
  if (handleDe(nome).length < 3) return err.textContent = 'Use um nome com ao menos 3 letras ou números.';
  if (pass.length < 6) return err.textContent = 'Senha: mínimo de 6 caracteres.';
  if (signup && !code) return err.textContent = 'Informe o código de acesso.';

  $('#go').disabled = true;
  const email = emailDe(nome);
  const { error } = signup
    ? await sb.auth.signUp({ email, password: pass, options: { data: { name: nome, code } } })
    : await sb.auth.signInWithPassword({ email, password: pass });
  $('#go').disabled = false;
  if (error) { console.error(error); err.textContent = traduz(error.message); }
  else start();
};

/** O GoTrue responde em inglês; aqui ficam só os casos que o oficial vê. */
function traduz(msg) {
  const m = String(msg || '');
  if (/Invalid login credentials/i.test(m)) return 'Nome ou senha incorretos.';
  if (/User already registered/i.test(m))  return 'Já existe uma conta com esse nome.';
  if (/Database error saving new user/i.test(m)) return 'Código de acesso inválido, ou já existe alguém com esse nome.';
  return m;
}

$('#out').onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- janelas ----------
function modal(title, { onClose, closable = true } = {}) {
  const root = $('#modal');
  root.innerHTML = '';
  root.classList.remove('hide');
  const box = el('div', 'modal-box');
  const head = el('header');
  head.append(el('b', null, title));
  if (closable) {
    const x = el('button', 'ghost', '✕');
    x.setAttribute('aria-label', 'Fechar');
    x.onclick = close;
    head.append(x);
  }
  const body = el('div', 'modal-body');
  const foot = el('div', 'modal-foot');
  box.append(head, body, foot);
  root.append(box);

  function close() {
    root.classList.add('hide'); root.innerHTML = '';
    document.removeEventListener('keydown', esc);
    onClose?.();                    // vale para o ✕, o ESC e o clique fora
  }
  const esc = e => { if (closable && e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', esc);
  root.onmousedown = e => { if (closable && e.target === root) close(); };
  return { body, foot, close };
}

function field(parent, label, value = '', { area = false, ph = '', rows = 4 } = {}) {
  const w = el('label', 'fld');
  w.append(el('span', null, label));
  const i = area ? el('textarea') : el('input');
  i.value = value || '';
  if (ph) i.placeholder = ph;
  if (area) i.rows = rows;
  w.append(i);
  parent.append(w);
  return i;
}

function toast(text, bad) {
  const t = el('div', 'toast' + (bad ? ' bad' : ''), text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3600);
}

const confirma = texto => window.confirm(texto);

// ---------- carregamento ----------
async function loadPeople() {
  const { data } = await sb.from('profiles').select('*');
  Object.keys(people).forEach(k => delete people[k]);
  (data || []).forEach(p => people[p.id] = p);
}

async function loadTree() {
  // O candidato também carrega a árvore: ele enxerga os canais da ACADEMIA,
  // que é onde está o material que a prova cobra. Quem decide o que volta é o
  // RLS, não esta função.
  // As duas últimas consultas são fechadas ao comando pelo RLS (ver
  // catcargo_all e chcargo_all). Para o resto da unidade elas voltam vazias, e
  // tudo bem: quem precisa delas é só o formulário de configurar canal.
  const [c, ch, cm, chm, ord, cg, cgm, ccg, chcg] = await Promise.all([
    sb.from('categories').select('*').order('position').order('name'),
    sb.from('channels').select('*').order('position').order('name'),
    sb.from('category_members').select('*'),
    sb.from('channel_members').select('*'),
    sb.from('sidebar_order').select('*'),
    sb.from('cargos').select('*').order('position').order('nome'),
    sb.from('cargo_membros').select('*'),
    sb.from('category_cargos').select('*'),
    sb.from('channel_cargos').select('*'),
  ]);
  [cats, chans, catMem, chanMem, order, cargos, cargoMem, catCargos, chanCargos]
    .forEach(o => Object.keys(o).forEach(k => delete o[k]));
  (ord.data || []).forEach(x => order[x.key] = x.position);
  (c.data || []).forEach(x => cats[x.id] = x);
  (ch.data || []).forEach(x => chans[x.id] = x);
  (cm.data || []).forEach(x => (catMem[x.category_id] ||= new Set()).add(x.profile_id));
  (chm.data || []).forEach(x => (chanMem[x.channel_id] ||= new Set()).add(x.profile_id));
  (cg.data || []).forEach(x => cargos[x.id] = x);
  (cgm.data || []).forEach(x => (cargoMem[x.profile_id] ||= new Set()).add(x.cargo_id));
  (ccg.data || []).forEach(x => (catCargos[x.category_id] ||= new Set()).add(x.cargo_id));
  (chcg.data || []).forEach(x => (chanCargos[x.channel_id] ||= new Set()).add(x.cargo_id));
}

/** Os cargos de uma conta, na ordem em que a unidade os organizou. */
function cargosDe(pid) {
  return [...(cargoMem[pid] || [])]
    .map(id => cargos[id])
    .filter(Boolean)
    .sort((a, b) => (a.position - b.position) || a.nome.localeCompare(b.nome));
}

/** Etiquetas coloridas dos cargos, para pendurar ao lado de um nome. */
function etiquetasCargo(parent, pid) {
  cargosDe(pid).forEach(c => {
    const t = el('span', 'cargo-tag', c.nome);
    if (c.cor) { t.style.color = c.cor; t.style.borderColor = c.cor; }
    parent.append(t);
  });
}

const ROTULO_CARGO = { candidato: 'CANDIDATO', oficial: 'OFICIAL', comando: 'COMANDO', admin: 'ADMIN' };

// ---------- app ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  await loadPeople();
  me = people[session.user.id];
  if (!me) return $('#err').textContent = 'Perfil não encontrado. Fale com o comando.';
  await loadTree();
  carregaLido();
  if (isOficial()) await varreNaoLidas();

  $('#auth').classList.add('hide'); $('#app').classList.remove('hide');
  window.FX?.road?.visivel(false);   // a estrada fica só na tela de acesso
  $('#me-name').textContent = me.name;
  $('#me-name').style.color = corDe(me);
  $('#me-role').textContent = ROTULO_CARGO[me.role] || 'CANDIDATO';
  $('#me-role').className = 'role-' + me.role;
  $('#new-ch').classList.toggle('hide', !isStaff());

  drawChannels();
  await window.PROVA?.carrega?.();
  openChannel(isOficial() ? 'mural' : 'prova');
  listen();
}

function listen() {
  live?.unsubscribe();
  const reload = async () => {
    await loadTree();
    // canal excluído (ou acesso revogado) enquanto estava aberto
    if (chan.startsWith('chan:') && !chans[chan.slice(5)]) return openChannel('mural');
    // trava posta por outro oficial enquanto o canal estava aberto
    if (travaPendente(chan)) return openChannel('mural');
    drawChannels();
    window.MANAGE?.refresh?.();
  };

  live = sb.channel('vgd')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, p => {
      const m = p.new || p.old;
      if (!m) return;
      if (p.eventType === 'INSERT') {
        if (m.channel === chan) {
          addMsg(m);
          marcaLido(m.channel, m.created_at);   // está à vista: nasce lido
          if (m.author_id !== me.id) window.FX?.som.recebida();
        } else {
          if (!unread.has(m.channel)) { unread.add(m.channel); drawChannels(); }
          window.FX?.som.recebida();
        }
      } else if (p.eventType === 'UPDATE' && m.channel === chan) {
        const old = msgEls.get(String(m.id));
        if (old) { const n = buildMsg(m); old.replaceWith(n); msgEls.set(String(m.id), n); }
      } else if (p.eventType === 'DELETE') {
        dropMsg(m.id);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async p => {
      if (p.eventType === 'DELETE' && p.old?.id === me.id) return sb.auth.signOut().then(() => location.reload());
      await loadPeople();
      if (people[me.id]) {
        const mudouCargo = people[me.id].role !== me.role;
        me = people[me.id];
        // passar de candidato a oficial troca o site inteiro de lugar: a barra
        // ganha os canais, o RLS passa a deixar ler. Recarregar é mais honesto
        // do que remendar meia dúzia de estados na mão.
        if (mudouCargo) return location.reload();
      }
      drawChannels();
      pintaMensagens();
      window.MANAGE?.refresh?.();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'category_members' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sidebar_order' }, reload)
    // Um cargo dado ou tirado muda o que a pessoa enxerga na hora, sem F5.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cargos' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_membros' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_attempts' }, () => window.PROVA?.realtime?.())
    .subscribe();
}

// ---------- barra lateral ----------
const collapsed = new Set(JSON.parse(localStorage.getItem('vgd.collapsed') || '[]'));
const saveCollapsed = () => localStorage.setItem('vgd.collapsed', JSON.stringify([...collapsed]));

function chanInfo(key) {
  if (key === 'mural')      return { label: 'mural', icon: '◈', hint: 'informes gerais · toda a unidade' };
  if (key === 'prova')      return { label: 'prova-teórica', icon: '◎', hint: 'curso de modulação · admissão' };
  if (key === 'resultados') return { label: 'resultados', icon: '✓', hint: 'provas entregues · só a administração' };
  if (key === 'exame')      return { label: 'Banco de questões', icon: '≡', hint: 'montagem da prova' };
  if (key === 'contas')     return { label: 'Contas', icon: '⚙', hint: 'administração' };

  const c = chans[key.slice(5)];
  if (!c) return { label: 'canal', icon: '#', hint: '' };
  const cat = c.category_id && cats[c.category_id];
  const quem = (c.category_id && c.inherit_access)
    ? (cat?.everyone ? 'todos' : `${(catMem[c.category_id] || new Set()).size} oficial(is)`)
    : (c.everyone ? 'todos' : `${(chanMem[c.id] || new Set()).size} oficial(is)`);
  const trava = travaDoCanal(c);
  return {
    label: c.name,
    icon: trava ? '⚿' : '#',
    hint: (c.topic ? c.topic + ' · ' : '') + 'acesso: ' + quem + (trava ? ' · ⚿ trava de código' : ''),
    ch: c,
  };
}

/** Cabeçalho recolhível das categorias. */
function grupoHead(id, label, n, filhos) {
  const fechado = collapsed.has(id);
  const h = el('h3', 'cat' + (fechado ? ' fechada' : ''));
  const tw = el('button', 'cat-tw');
  tw.setAttribute('aria-expanded', String(!fechado));
  tw.title = fechado ? 'Mostrar os canais' : 'Esconder os canais';
  tw.append(el('span', 'arw', fechado ? '▸' : '▾'), el('span', 'cat-nm', label));
  if (n) tw.append(el('span', 'cat-n', n));
  // recolhido, o grupo avisa por dentro o que chegou e o que está aberto
  if (fechado && filhos?.some(k => unread.has(k))) tw.classList.add('new');
  if (fechado && filhos?.includes(chan)) tw.classList.add('dentro');
  tw.onclick = () => {
    fechado ? collapsed.delete(id) : collapsed.add(id);
    saveCollapsed(); drawChannels();
  };
  h.append(tw);
  return h;
}

/** Canal na barra: o botão, o aviso de trava e, para o comando, a engrenagem. */
function linhaCanal(box, c, cls) {
  const row = el('div', 'ch-row');
  const trava = travaDoCanal(c);
  const b = navBtn(row, 'chan:' + c.id, c.name, trava ? '⚿' : '#', 'ch-nav' + (cls ? ' ' + cls : ''));
  if (trava) {
    b.querySelector('.ic')?.classList.add('trava');
    b.title = mesmaTrava(trava, liberada)
      ? 'Trava liberada enquanto você estiver aqui'
      : 'Exige código de acesso' + (trava.tipo === 'cat' ? ` (da categoria ${trava.nome})` : '');
  }
  armaCanal(b, c);
  if (isStaff()) {
    const ed = el('button', 'ch-ed', '⚙');
    ed.title = 'Configurar canal: nome, acesso e trava';
    ed.onclick = e => { e.stopPropagation(); window.MANAGE?.channelForm?.(c); };
    row.append(ed);
  }
  box.append(row);
  return b;
}

function navBtn(parent, key, label, icon, cls) {
  const b = el('button', cls);
  b.dataset.ch = key;
  b.append(el('span', 'ic', icon), el('span', 'nm', label));
  b.classList.toggle('on', key === chan);
  b.classList.toggle('new', unread.has(key));
  b.onclick = () => { openChannel(key); if (innerWidth <= 760) $('#side').classList.remove('open'); };
  parent.append(b);
  return b;
}

/** Itens de primeiro nível, já na ordem salva. */
function topItems() {
  const byCat = {}, soltos = [];
  Object.values(chans)
    .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
    .forEach(c => {
      if (c.category_id && cats[c.category_id]) (byCat[c.category_id] ||= []).push(c);
      else soltos.push(c);
    });

  const items = [
    // o mural é a sala da unidade: candidato não entra, e mostrar um canal que
    // o banco vai negar é pior do que não mostrar
    ...(isOficial() ? [{ key: 'mural', kind: 'mural', def: 0 }] : []),
    ...Object.values(cats).map(c => ({ key: 'cat:' + c.id, kind: 'cat', cat: c, def: 10 + (c.position || 0) })),
    ...soltos.map(c => ({ key: 'chan:' + c.id, kind: 'chan', ch: c, def: 100 + (c.position || 0) })),
  ];
  items.sort((a, b) => (order[a.key] ?? a.def) - (order[b.key] ?? b.def));
  return { items, byCat };
}

function drawChannels() {
  const nav = $('#chans');
  nav.innerHTML = '';

  const { items, byCat } = topItems();

  items.forEach(it => {
    const box = el('div', 'nav-item');
    box.dataset.key = it.key;
    nav.append(box);

    if (it.kind === 'mural') {
      navBtn(box, 'mural', 'mural', '◈');

    } else if (it.kind === 'cat') {
      const cat = it.cat;
      const dentro = byCat[cat.id] || [];
      const head = grupoHead(cat.id, cat.name, dentro.length, dentro.map(c => 'chan:' + c.id));
      if (cat.locked) {
        const marca = el('span', 'trava', '⚿');
        marca.title = mesmaTrava({ tipo: 'cat', id: cat.id }, liberada)
          ? 'Trava liberada enquanto você estiver aqui'
          : 'Categoria travada: exige código de acesso';
        head.querySelector('.cat-nm')?.before(marca);
      }
      if (isStaff()) {
        const ed = el('button', 'cat-ed', '⚙');
        ed.title = 'Configurar categoria: nome, acesso e trava';
        ed.onclick = e => { e.stopPropagation(); window.MANAGE?.categoryForm?.(cat); };
        head.append(ed);
      }
      box.append(head);
      box.dataset.catId = cat.id;
      if (!collapsed.has(cat.id)) dentro.forEach(c => linhaCanal(box, c, 'sub'));

    } else {
      linhaCanal(box, it.ch);
    }

    armaTopo(box);
  });

  // A prova fica à vista do candidato, que ainda vai prestá-la, e de quem já
  // prestou — é onde está o parecer da administração sobre ele.
  if (!isOficial() || window.PROVA?.temTentativa?.()) {
    const box = el('div', 'nav-item');
    box.append(el('h3', null, 'Admissão'));
    navBtn(box, 'prova', 'prova-teórica', '◎', 'prova');
    nav.append(box);
  }

  if (isStaff()) {
    const box = el('div', 'nav-item');
    box.append(el('h3', null, 'Administração'));
    if (isAdmin()) {
      const b = navBtn(box, 'resultados', 'resultados', '✓');
      const n = window.PROVA?.pendentes?.() || 0;
      if (n) b.append(el('span', 'pend', String(n)));
    }
    navBtn(box, 'exame', 'Banco de questões', '≡');
    if (isAdmin()) navBtn(box, 'contas', 'Contas', '⚙', 'gear');
    nav.append(box);
  }
}

// ---------- cores ----------
// Mesma paleta do banco (vgd_paleta). A cor fica no perfil; o cálculo pelo nome
// só serve de rede para contas antigas que ainda não têm cor.
const PALETA = [
  '#ff9d2e', '#ff5c1a', '#4ad9ff', '#b6ff3a', '#ffd166', '#ff3b5c', '#7ae7ff', '#ffae00',
  '#ff7847', '#e0ff4f', '#36c9ff', '#ff4fa3', '#ffc14d', '#9dff6b', '#5ea8ff', '#ff6b35',
];

function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return 20 + (h % 50); }

/** Cor de um perfil, com reserva para quem ainda não tem uma gravada. */
function corDe(p) {
  if (!p) return 'var(--dim)';
  return p.color || `hsl(${hue(p.name || '?')} 95% 62%)`;
}

/** Grade de cores clicável; devolve um objeto com a escolha atual. */
function paletaPicker(parent, atual) {
  const box = el('div', 'paleta');
  let escolhida = atual || PALETA[0];
  const botoes = [];
  PALETA.forEach(c => {
    const b = el('button', 'swatch' + (c === escolhida ? ' on' : ''));
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', 'cor ' + c);
    b.onclick = () => {
      escolhida = c;
      botoes.forEach(x => x.classList.toggle('on', x === b));
      parent.querySelectorAll('.prova-cor').forEach(n => n.style.color = c);
    };
    botoes.push(b);
    box.append(b);
  });
  parent.append(box);
  return { get value() { return escolhida; } };
}

// ---------- minhas configurações ----------
// O nome do personagem não se troca por aqui: ele é a identidade no RP e a
// chave do login. Quem muda é o comando, pelo painel de contas.
function abreConfig() {
  const m = modal('MINHAS CONFIGURAÇÕES');

  m.body.append(el('h4', 'form-block', 'NOME DO PERSONAGEM'));
  const nome = el('p', 'prova-cor', me.name);
  nome.style.color = corDe(me);
  m.body.append(nome);
  m.body.append(el('p', 'form-note',
    'O nome é o que identifica você na unidade e é por ele que você entra. Para trocar, fale com o comando.'));

  m.body.append(el('h4', 'form-block', 'SUA COR'));
  const cor = paletaPicker(m.body, me.color);

  const save = el('button', 'primary', 'Salvar');
  const cancel = el('button', 'ghost', 'Cancelar');
  cancel.onclick = m.close;
  m.foot.append(cancel, save);

  save.onclick = async () => {
    save.disabled = true;
    const { error } = await sb.rpc('update_me', { new_color: cor.value });
    save.disabled = false;
    if (error) return toast(error.message, true);
    m.close();
    await loadPeople();
    me = people[me.id] || me;
    $('#me-name').style.color = corDe(me);
    pintaMensagens();
    drawChannels();
    toast('Cor atualizada.');
  };
}

/** Repinta os nomes já desenhados quando alguém troca de cor. */
function pintaMensagens() {
  msgEls.forEach(elm => {
    const quem = elm.querySelector('.who');
    if (!quem) return;
    const p = Object.values(people).find(x => x.name === quem.textContent);
    if (p) quem.style.color = corDe(p);
  });
}

$('#me-cfg').onclick = abreConfig;

// ---------- quem tem acesso ----------
function membrosDoCanal(key) {
  const oficiais = () => Object.values(people).filter(p => p.role !== 'candidato');
  if (key === 'mural') {
    return { regra: 'Mural aberto: todo oficial da Vanguarda.', lista: oficiais() };
  }
  const c = chans[key.slice(5)];
  if (!c) return { regra: 'Canal não encontrado.', lista: [] };

  const herda = !!c.category_id && c.inherit_access && cats[c.category_id];
  const cat = herda ? cats[c.category_id] : null;
  const aberto = herda ? cat.everyone : c.everyone;

  if (aberto) {
    return {
      regra: herda
        ? `Aberto a todos os oficiais, pela categoria ${cat.name}.`
        : 'Aberto a todos os oficiais.',
      lista: oficiais(),
    };
  }
  const ids = herda ? (catMem[c.category_id] || new Set()) : (chanMem[c.id] || new Set());
  // quem entra por cargo não está na lista de nomes, e some da contagem se a
  // gente não for buscá-lo
  const porCargo = herda ? (catCargos[c.category_id] || new Set()) : (chanCargos[c.id] || new Set());
  const nomes = new Set(ids);
  porCargo.forEach(cid => Object.keys(cargoMem).forEach(pid => {
    if (cargoMem[pid].has(cid)) nomes.add(pid);
  }));

  const etiquetas = [...porCargo].map(id => cargos[id]?.nome).filter(Boolean);
  return {
    regra: (herda
      ? `Acesso restrito, herdado da categoria ${cat.name}.`
      : 'Acesso restrito aos oficiais abaixo.')
      + (etiquetas.length ? ` Liberado também para o cargo ${etiquetas.join(', ')}.` : ''),
    lista: [...nomes].map(id => people[id]).filter(Boolean),
    extra: 'a administração',
  };
}

function abreMembros(key) {
  const info = chanInfo(key);
  const { regra, lista, extra } = membrosDoCanal(key);
  const m = modal('ACESSO · ' + info.label);
  m.body.append(el('p', 'form-note', regra));

  const trava = key.startsWith('chan:') ? travaDoCanal(chans[key.slice(5)]) : null;
  if (trava) {
    m.body.append(el('p', 'form-note', trava.tipo === 'cat'
      ? `⚿ Trava de código, herdada da categoria ${trava.nome}: estar na lista não basta, é preciso digitar o código.`
      : '⚿ Trava de código: estar na lista não basta, é preciso digitar o código.'));
  }

  const ul = el('div', 'membros');
  lista.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
    const li = el('div', 'membro');
    const pt = el('span', 'mb-dot');
    pt.style.background = corDe(p);
    li.append(pt, el('span', 'mb-nome', p.name));
    etiquetasCargo(li, p.id);
    if (p.id === me.id) li.append(el('em', 'mb-voce', 'você'));
    ul.append(li);
  });
  if (extra) {
    const li = el('div', 'membro extra');
    li.append(el('span', 'mb-dot vazio'), el('span', 'mb-nome', extra));
    ul.append(li);
  }
  if (!lista.length && !extra) ul.append(el('p', 'empty', '> ninguém com acesso.'));
  m.body.append(ul);

  const n = lista.length;
  m.foot.append(el('span', 'form-note', n + (n === 1 ? ' oficial' : ' oficiais') + (extra ? ' · e ' + extra : '')));
  const ok = el('button', 'primary', 'Fechar');
  ok.onclick = m.close;
  m.foot.append(ok);
}

$('#members').onclick = () => { if (chan === 'mural' || chan.startsWith('chan:')) abreMembros(chan); };

// ---------- reordenar arrastando ----------
// Só o COMANDO arrasta, porque a ordem vale para a unidade inteira.
let arrasto = null;   // { tipo: 'topo' | 'canal', key, id }

const limpaMarcas = () => document.querySelectorAll('#chans .drop-before,#chans .drop-after,#chans .drop-into')
  .forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-into'));

function armaTopo(box) {
  if (!isStaff()) return;
  box.draggable = true;

  box.addEventListener('dragstart', e => {
    if (arrasto) return;                      // o canal já tomou conta do arrasto
    arrasto = { tipo: 'topo', key: box.dataset.key };
    box.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', box.dataset.key);
  });
  box.addEventListener('dragend', () => { box.classList.remove('dragging'); limpaMarcas(); arrasto = null; });

  box.addEventListener('dragover', e => {
    if (!arrasto) return;
    e.preventDefault();
    limpaMarcas();
    if (arrasto.tipo === 'canal') {
      if (box.dataset.catId) box.classList.add('drop-into');
      return;
    }
    if (arrasto.key === box.dataset.key) return;
    const r = box.getBoundingClientRect();
    box.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });

  box.addEventListener('drop', e => {
    if (!arrasto) return;
    e.preventDefault(); e.stopPropagation();
    const antes = box.classList.contains('drop-before');
    const dentro = box.classList.contains('drop-into');
    const alvoCat = box.dataset.catId;
    const puxado = arrasto;
    limpaMarcas(); arrasto = null;

    if (puxado.tipo === 'canal') {
      if (dentro && alvoCat) moveCanal(puxado.id, alvoCat);
      return;
    }
    if (puxado.key === box.dataset.key) return;
    const keys = topItems().items.map(i => i.key).filter(k => k !== puxado.key);
    const at = keys.indexOf(box.dataset.key);
    keys.splice(antes ? at : at + 1, 0, puxado.key);
    salvaOrdemTopo(keys);
  });
}

function armaCanal(btn, ch) {
  if (!isStaff()) return btn;
  btn.draggable = true;

  btn.addEventListener('dragstart', e => {
    arrasto = { tipo: 'canal', key: 'chan:' + ch.id, id: ch.id };
    btn.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ch.id);
    e.stopPropagation();
  });
  btn.addEventListener('dragend', () => { btn.classList.remove('dragging'); limpaMarcas(); arrasto = null; });

  btn.addEventListener('dragover', e => {
    if (arrasto?.tipo !== 'canal' || arrasto.id === ch.id) return;
    e.preventDefault(); e.stopPropagation();
    limpaMarcas();
    const r = btn.getBoundingClientRect();
    btn.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });

  btn.addEventListener('drop', e => {
    if (arrasto?.tipo !== 'canal' || arrasto.id === ch.id) return;
    e.preventDefault(); e.stopPropagation();
    const antes = btn.classList.contains('drop-before');
    const puxado = arrasto.id;
    limpaMarcas(); arrasto = null;

    const destino = ch.category_id || null;
    const irmaos = Object.values(chans)
      .filter(c => (c.category_id || null) === destino && c.id !== puxado)
      .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
      .map(c => c.id);
    const at = irmaos.indexOf(ch.id);
    irmaos.splice(antes ? at : at + 1, 0, puxado);
    salvaCanais(destino, irmaos);
  });
  return btn;
}

async function salvaOrdemTopo(keys) {
  const rows = keys.map((k, i) => ({ key: k, position: i }));
  const { error } = await sb.from('sidebar_order').upsert(rows);
  if (error) return toast('Não foi possível salvar a ordem: ' + error.message, true);
  rows.forEach(r => order[r.key] = r.position);
  drawChannels();
}

async function salvaCanais(catId, ids) {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await sb.from('channels').update({ position: i, category_id: catId }).eq('id', ids[i]);
    if (error) return toast('Não foi possível mover: ' + error.message, true);
  }
  await loadTree(); drawChannels();
}

async function moveCanal(chanId, catId) {
  const irmaos = Object.values(chans)
    .filter(c => c.category_id === catId && c.id !== chanId)
    .sort((a, b) => a.position - b.position)
    .map(c => c.id);
  await salvaCanais(catId, [...irmaos, chanId]);
}

// ---------- largura da barra lateral ----------
(() => {
  const RAIZ = document.documentElement;
  const MIN = 170, MAX = 430;
  const largura = px => {
    const w = Math.round(Math.min(Math.max(px, MIN), Math.min(MAX, innerWidth - 420)));
    RAIZ.style.setProperty('--side-w', w + 'px');
    try { localStorage.setItem('vgd.sidew', String(w)); } catch {}
  };
  const salvo = +localStorage.getItem('vgd.sidew');
  if (salvo) RAIZ.style.setProperty('--side-w', Math.min(Math.max(salvo, MIN), MAX) + 'px');

  const grip = document.querySelector('.grip[data-grip="side"]');
  if (!grip) return;
  let puxando = false;
  const x = e => (e.touches ? e.touches[0].clientX : e.clientX);
  const down = e => { puxando = true; document.body.classList.add('dragging'); e.preventDefault(); };
  const move = e => { if (puxando) largura(x(e) - $('#side').getBoundingClientRect().left); };
  const up = () => { puxando = false; document.body.classList.remove('dragging'); };

  grip.addEventListener('mousedown', down);
  grip.addEventListener('touchstart', down, { passive: false });
  addEventListener('mousemove', move);
  addEventListener('touchmove', move, { passive: true });
  addEventListener('mouseup', up);
  addEventListener('touchend', up);
  grip.addEventListener('dblclick', () => { largura(272); toast('Barra lateral no tamanho padrão.'); });
})();

// ---------- trava de acesso por código ----------
// Camada por cima da lista de acesso: onde há trava, só entra quem digitar o
// código — inclusive quem acabou de defini-lo. A liberação vale só enquanto a
// seção fica aberta e mora apenas na memória: sair dela, recarregar, abrir
// outra aba ou trocar de conta faz o código ser pedido de novo.
let liberada = null;                    // { tipo, id } da seção aberta agora

/** Mesma seção travada? */
const mesmaTrava = (a, b) => !!a && !!b && a.tipo === b.tipo && a.id === b.id;

/** Quem manda na trava de um canal: ele mesmo, a categoria onde está, ou nada. */
// A trava da categoria vale para tudo que está dentro dela, mesmo para os
// canais que têm lista de acesso própria: ela fecha a seção inteira.
function travaDoCanal(c) {
  if (!c) return null;
  if (c.locked) return { tipo: 'chan', id: c.id, nome: c.name };
  const cat = c.category_id ? cats[c.category_id] : null;
  if (cat?.locked) return { tipo: 'cat', id: cat.id, nome: cat.name };
  return null;
}

/** A trava que ainda barra este canal agora, se houver. */
function travaPendente(key) {
  if (typeof key !== 'string' || !key.startsWith('chan:')) return null;
  const t = travaDoCanal(chans[key.slice(5)]);
  return t && !mesmaTrava(t, liberada) ? t : null;
}

/** Glitch vermelho na tela, aviso piscando e a cantada de pneu. */
function negaAcesso(aviso) {
  window.FX?.som.negado();
  window.FX?.negaTela();
  aviso?.classList.remove('hide', 'nega');
  void aviso?.offsetWidth;                 // reinicia a animação em erros seguidos
  aviso?.classList.add('nega');
}

/**
 * Código aceito: a sala confirma antes de abrir. O selo fica um tempo curto na
 * tela e só depois o canal entra — abrir no mesmo instante engolia a
 * confirmação, e sem ela o acerto passava despercebido no meio do escuro.
 */
const PAUSA_OK = 750;
function permiteAcesso(m, inp, go, cancel, aviso, segue) {
  [inp, go, cancel].forEach(e => e.disabled = true);   // nada de segundo envio
  aviso.classList.add('hide');
  const selo = el('p', 'lock-ok', 'PASSAGEM LIBERADA');
  selo.setAttribute('role', 'status');
  m.body.append(selo);
  window.FX?.som.permitido();
  setTimeout(() => { segue(); m.close(); }, PAUSA_OK);
}

function pedeCodigo(trava) {
  return new Promise(resolve => {
    let respondeu = false;
    const fim = ok => { if (!respondeu) { respondeu = true; resolve(ok); } };
    const m = modal('⚿ SEÇÃO RESTRITA', { onClose: () => fim(false) });
    m.body.append(el('p', 'form-note',
      `${trava.tipo === 'cat' ? 'A categoria' : 'O canal'} “${trava.nome}” exige código de acesso.`));
    const inp = field(m.body, 'Código de acesso', '', { ph: '••••••••' });
    inp.type = 'password';
    inp.autocomplete = 'off';
    const aviso = el('p', 'lock-err hide', 'PASSAGEM BARRADA — SEÇÃO RESTRITA');
    aviso.setAttribute('role', 'alert');
    m.body.append(aviso);

    const go = el('button', 'primary', 'Confirmar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, go);
    inp.focus();

    const tenta = async () => {
      go.disabled = true;
      const { data, error } = trava.tipo === 'cat'
        ? await sb.rpc('verify_category_code', { cat: trava.id, code: inp.value })
        : await sb.rpc('verify_channel_code', { cid: trava.id, code: inp.value });
      go.disabled = false;
      if (!error && data === true) return permiteAcesso(m, inp, go, cancel, aviso, () => fim(true));
      negaAcesso(aviso);
      inp.value = '';
      inp.focus();
    };
    go.onclick = tenta;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tenta(); } });
  });
}

window.LOCKS = { travaPendente };

// ---------- abrir ----------
let loadToken = 0;

/** Mostra um painel da sala e esconde os outros. */
function mostraPainel(qual) {
  Object.entries(PAINEIS).forEach(([k, sel]) => $(sel)?.classList.toggle('hide', k !== qual));
}

async function openChannel(key, jumpTo) {
  // Candidato só tem a prova; qualquer outro destino cai de volta nela.
  if (!isOficial() && key !== 'prova') key = 'prova';

  // Entrar numa seção travada pede o código toda vez. A liberação só é trocada
  // depois que o código passa: quem desiste no meio continua onde estava.
  const alvo = key.startsWith('chan:') ? travaDoCanal(chans[key.slice(5)]) : null;
  if (alvo && !mesmaTrava(alvo, liberada) && !await pedeCodigo(alvo)) return;
  liberada = alvo;
  chan = key;

  const info = chanInfo(key);
  window.FX?.decodifica($('#ch-title'), info.label, 380);
  $('#ch-hint').textContent = info.hint;
  drawChannels();

  const eCanal = key === 'mural' || key.startsWith('chan:');
  $('#members').classList.toggle('hide', !eCanal);
  $('#find-btn').classList.toggle('hide', !isOficial());
  $('#ch-edit').classList.toggle('hide', !(isStaff() && key.startsWith('chan:')));

  if (key === 'prova')      { mostraPainel('prova');      return window.PROVA?.abre?.(); }
  if (key === 'resultados') { mostraPainel('resultados'); return window.PROVA?.abreResultados?.(); }
  if (key === 'exame')      { mostraPainel('exame');      return window.PROVA?.abreBanco?.(); }
  if (key === 'contas')     { mostraPainel('contas');     return window.MANAGE?.open?.(); }

  mostraPainel('chat');

  // Canal de leitura: o material do curso não é lugar de conversa. O banco
  // recusaria a mensagem de qualquer jeito (ver pode_escrever no schema);
  // esconder a caixa é para ninguém digitar à toa e levar um erro na cara.
  const alvoCh = key.startsWith('chan:') ? chans[key.slice(5)] : null;
  const soLeitura = !!alvoCh?.somente_leitura && !isStaff();
  document.querySelector('#chat .composer')?.classList.toggle('hide', soLeitura);

  // só apaga a bolinha; quem carimba a data é o carregamento, com hora do
  // servidor. Carimbar aqui, com o relógio local adiantado, faria o carimbo de
  // verdade ser descartado por parecer velho.
  unread.delete(key);
  window.FX?.bootLine(info.label);

  const token = ++loadToken;
  const box = $('#msgs');
  box.innerHTML = '';
  msgEls.clear();

  let data;
  if (jumpTo?.created_at) {
    const [antes, depois] = await Promise.all([
      sb.from('messages').select('*').eq('channel', key).lte('created_at', jumpTo.created_at).order('created_at', { ascending: false }).limit(80),
      sb.from('messages').select('*').eq('channel', key).gt('created_at', jumpTo.created_at).order('created_at').limit(40),
    ]);
    data = [...(antes.data || []).reverse(), ...(depois.data || [])];
  } else {
    ({ data } = await sb.from('messages').select('*').eq('channel', key).order('created_at').limit(300));
  }
  if (token !== loadToken) return;

  if (!data?.length) box.innerHTML = EMPTY_CH;
  const total = data?.length || 0;
  data?.forEach((m, i) => addMsg(m, true, total - 1 - i));
  // data do servidor, agora que ela é conhecida: é este carimbo que impede o
  // aviso de voltar a acender no próximo carregamento
  marcaLido(key, total ? data[total - 1].created_at : undefined);
  box.scrollTop = box.scrollHeight;

  if (jumpTo?.id) {
    const t = msgEls.get(String(jumpTo.id));
    if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 2500); }
  }
}

// ---------- informes ----------
function buildMsg(m) {
  const a = people[m.author_id] || { name: '[removido]', role: 'oficial' };
  const wrap = el('div', 'm' + (m.author_id === me.id ? ' mine' : ''));
  wrap.dataset.id = m.id;

  const head = el('div', 'head');
  const who = el('span', 'who', a.name);
  who.style.color = corDe(a);
  head.append(who);
  head.append(el('time', null, new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  if (m.edited_at) {
    const e = el('span', 'ed', '(editado)');
    const by = people[m.edited_by];
    e.title = 'editado' + (by ? ' por ' + by.name : '') + ' em ' + new Date(m.edited_at).toLocaleString('pt-BR');
    head.append(e);
  }
  if (m.author_id === me.id || isStaff()) {
    const meu = m.author_id === me.id;
    const b = el('button', 'act', '✎');
    b.title = meu ? 'Editar' : 'Editar (comando)';
    b.onclick = () => editMsg(wrap, m);
    const d = el('button', 'act del', '🗑');
    d.title = meu ? 'Apagar' : 'Apagar (comando)';
    d.onclick = () => delMsg(wrap, m);
    head.append(b, d);
  }
  wrap.append(head);

  const txt = el('div', 'txt md');
  txt.append(MD.render(m.body));
  wrap.append(txt);
  return wrap;
}

// Ao abrir um canal chegam até trezentos informes de uma vez. Animar todos
// juntos era o engasgo da troca de canal, mas cortar o fade inteiro tirou o
// charme. O meio-termo: só os últimos entram — são os que ficam na tela depois
// da rolagem automática — e entram em escada, com um atraso curto entre eles.
const FADE_BULK = 10;    // quantos dos últimos ainda entram com fade
const FADE_PASSO = 28;   // ms entre um e o seguinte

function addMsg(m, bulk, daPonta) {
  const box = $('#msgs');
  box.querySelector('.empty')?.remove();
  if (msgEls.has(String(m.id))) return;
  const node = buildMsg(m);
  if (bulk) {
    if (daPonta != null && daPonta < FADE_BULK) {
      node.classList.add('escalona');
      node.style.animationDelay = (FADE_BULK - 1 - daPonta) * FADE_PASSO + 'ms';
    } else {
      node.classList.add('sem-anim');
    }
  }
  msgEls.set(String(m.id), node);
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || m.author_id === me.id;
  box.append(node);
  if (!bulk && perto) box.scrollTop = box.scrollHeight;
}

const EMPTY_CH = '<p class="empty">&gt; canal em silêncio.<br>&gt; publique o primeiro informe.</p>';

async function delMsg(wrap, m) {
  const meu = m.author_id === me.id;
  const quem = people[m.author_id]?.name || 'oficial removido';
  if (!confirma(meu ? 'Apagar este informe?' : `Apagar o informe de ${quem}? Não há volta.`)) return;
  const { error } = await sb.from('messages').delete().eq('id', m.id);
  if (error) return toast('Não foi possível apagar: ' + error.message, true);
  dropMsg(m.id);
}

function dropMsg(id) {
  msgEls.get(String(id))?.remove();
  msgEls.delete(String(id));
  const box = $('#msgs');
  if (!box.querySelector('.m')) box.innerHTML = EMPTY_CH;
}

function editMsg(wrap, m) {
  if (wrap.querySelector('.edit-box')) return;
  const txt = wrap.querySelector('.txt');
  txt.classList.add('hide');
  const box = el('div', 'edit-box');
  const ta = el('textarea');
  ta.value = m.body;
  ta.rows = Math.min(12, m.body.split('\n').length + 1);
  const row = el('div', 'edit-row');
  const save = el('button', 'primary sm', 'Salvar');
  const cancel = el('button', 'ghost', 'Cancelar');
  row.append(save, cancel, el('span', 'tip', 'Esc cancela · Ctrl+Enter salva'));
  box.append(ta, row);
  wrap.append(box);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const done = () => { box.remove(); txt.classList.remove('hide'); };
  cancel.onclick = done;
  save.onclick = async () => {
    const body = ta.value.trim();
    if (!body) return;
    save.disabled = true;
    const { error } = await sb.from('messages').update({ body }).eq('id', m.id);
    save.disabled = false;
    if (error) return toast('Não foi possível editar: ' + error.message, true);
    m.body = body; m.edited_at = new Date().toISOString(); m.edited_by = me.id;
    const n = buildMsg(m);
    wrap.replaceWith(n);
    msgEls.set(String(m.id), n);
  };
  ta.onkeydown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); done(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.onclick();
  };
}

async function send() {
  const ta = $('#msg');
  const body = ta.value.trim();
  if (!body) return;
  ta.value = ''; grow();
  $('#caret-hint')?.classList.remove('hide');
  window.FX?.som.envio();
  const { error } = await sb.from('messages').insert({ channel: chan, body, author_id: me.id });
  if (error) {
    console.error('envio:', error);
    window.FX?.som.falha();
    ta.value = body; grow();
    toast('Falha ao publicar: ' + error.message, true);
  }
}

// Altura da caixa de texto: cresce sozinha até 180px, ou fica na altura que o
// usuário arrastar. Duplo clique na alça volta para o automático.
let msgH = +localStorage.getItem('vgd.msgh') || 0;

// Ler `scrollHeight` logo depois de escrever `height:auto` obriga o navegador a
// refazer o layout ali mesmo, dentro do evento da tecla — e essa conta não é
// barata. A medição acontece uma vez por quadro: a tecla aparece na tela
// primeiro, o campo se ajusta logo em seguida, e rajadas de digitação viram uma
// medição só em vez de uma por caractere.
let growPend = false;
function grow() {
  const ta = $('#msg');
  if (msgH) { ta.style.height = msgH + 'px'; return; }
  if (growPend) return;
  growPend = true;
  requestAnimationFrame(() => {
    growPend = false;
    if (msgH) return;                      // viraram altura manual no meio
    const t = $('#msg');
    t.style.height = 'auto';
    t.style.height = Math.min(180, t.scrollHeight) + 'px';
  });
}

(() => {
  const grip = $('#msg-grip');
  let from = 0, base = 0, puxando = false;
  const y = e => (e.touches ? e.touches[0].clientY : e.clientY);

  const down = e => {
    puxando = true;
    from = y(e);
    base = $('#msg').getBoundingClientRect().height;
    document.body.classList.add('dragging-v');
    e.preventDefault();
  };
  const move = e => {
    if (!puxando) return;
    const h = Math.round(Math.min(Math.max(base + (from - y(e)), 38), innerHeight * 0.65));
    msgH = h;
    $('#msg').style.height = h + 'px';
  };
  const up = () => {
    if (!puxando) return;
    puxando = false;
    document.body.classList.remove('dragging-v');
    localStorage.setItem('vgd.msgh', String(msgH));
  };

  grip.addEventListener('mousedown', down);
  grip.addEventListener('touchstart', down, { passive: false });
  addEventListener('mousemove', move);
  addEventListener('touchmove', move, { passive: true });
  addEventListener('mouseup', up);
  addEventListener('touchend', up);
  grip.addEventListener('dblclick', () => {
    msgH = 0;
    localStorage.removeItem('vgd.msgh');
    grow();
    toast('Caixa de texto voltou ao tamanho automático.');
  });
  grow();
})();

$('#send').onclick = send;
$('#msg').addEventListener('input', grow);
$('#msg').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#menu').onclick = () => $('#side').classList.toggle('open');
$('#ch-edit').onclick = () => window.MANAGE?.channelForm?.(chans[chan.slice(5)]);
$('#new-ch').onclick = () => window.MANAGE?.newMenu?.();

// ---------- ruído de CRT ----------
// A cada 9 a 30 segundos a tela dá uma "vacilada" de sinal. Puramente visual:
// tudo acontece numa camada sobreposta, sem tocar no layout nem capturar clique.
(() => {
  const html = document.documentElement;
  const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const pref = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const ligado = () => pref('vgd.crt') !== '0' && !calmo?.matches;

  const pulso = () => {
    setTimeout(() => {
      if (ligado() && !document.hidden) {
        html.classList.add('flick');
        setTimeout(() => html.classList.remove('flick'), 280);
      }
      pulso();
    }, 9000 + Math.random() * 21000);
  };
  pulso();

  window.CRT = {
    toggle() {
      const on = !ligado();
      try { localStorage.setItem('vgd.crt', on ? '1' : '0'); } catch {}
      html.classList.toggle('no-crt', !on);
      return on;
    },
  };
  if (!ligado()) html.classList.add('no-crt');
})();

// os complementos (prova/manage/search) carregam depois deste arquivo
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start);
else setTimeout(start);
