/* ===========================================================================
   app.js — núcleo: acesso, barra de canais, mensagens e edição.
   Complementos: ops.js (dossiês), manage.js (usuários/canais), search.js.
   =========================================================================== */
// A sessão vive no sessionStorage: sobrevive ao F5, morre ao fechar o navegador.
const authStore = (() => {
  try {
    const s = window.sessionStorage;
    s.setItem('cit.probe', '1'); s.removeItem('cit.probe');
    return s;
  } catch {                       // navegação privada com storage bloqueado
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();
// versões antigas guardavam a sessão no localStorage, que sobrevivia ao fechamento
try { Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k)); } catch {}

const sb = supabase.createClient(CFG.url, CFG.key, {
  auth: { storage: authStore, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const $ = s => document.querySelector(s);

let me, chan = 'geral', signup = false, live;
const people = {};        // id -> perfil
const cats   = {};        // id -> categoria
const chans  = {};        // id -> canal
const catMem = {};        // categoria -> Set(perfil)
const chanMem = {};       // canal     -> Set(perfil)
const msgEls = new Map(); // id da mensagem -> elemento
const order  = {};        // chave da barra lateral -> posição
const unread = new Set(); // canais com mensagem nova ainda não vista

const isStaff = () => me && (me.role === 'command' || me.role === 'admin');
const isAdmin = () => me && me.role === 'admin';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- tela de acesso ----------
const boot = ['> interceptando transmissão............ SINAL LIMPO', '> origem............................... REALIDADE NÃO CATALOGADA', '> canal seguro CIT.................... AGUARDANDO CREDENCIAIS'];
(async () => { for (const l of boot) { for (const ch of l) { $('#boot').textContent += ch; await new Promise(r => setTimeout(r, 12)); } $('#boot').textContent += '\n'; } })();

function mode(up) {
  signup = up;
  $('#t-in').classList.toggle('on', !up); $('#t-up').classList.toggle('on', up);
  $('#c').classList.toggle('hide', !up);
  $('#go').textContent = up ? 'Criar acesso' : 'Entrar';
  $('#p').autocomplete = up ? 'new-password' : 'current-password';
  $('#err').textContent = '';
}
$('#t-in').onclick = () => mode(false);
$('#t-up').onclick = () => mode(true);
['#u', '#p', '#c'].forEach(s => $(s).addEventListener('keydown', e => e.key === 'Enter' && $('#go').click()));

$('#go').onclick = async () => {
  const name = $('#u').value.trim(), pass = $('#p').value, code = $('#c').value.trim(), err = $('#err');
  err.textContent = '';
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return err.textContent = 'Codinome: 3 a 20 caracteres (letras, números e _).';
  if (pass.length < 6) return err.textContent = 'Senha: mínimo de 6 caracteres.';
  $('#go').disabled = true;
  const email = name.toLowerCase() + '.cit.paralela@gmail.com';
  const { error } = signup
    ? await sb.auth.signUp({ email, password: pass, options: { data: { codename: name, code } } })
    : await sb.auth.signInWithPassword({ email, password: pass });
  $('#go').disabled = false;
  if (error) { console.error(error); err.textContent = error.message; }
  else start();
};

$('#out').onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- janelas ----------
function modal(title) {
  const root = $('#modal');
  root.innerHTML = '';
  root.classList.remove('hide');
  const box = el('div', 'modal-box');
  const head = el('header');
  head.append(el('b', null, title));
  const x = el('button', 'ghost', '✕');
  x.setAttribute('aria-label', 'Fechar');
  head.append(x);
  const body = el('div', 'modal-body');
  const foot = el('div', 'modal-foot');
  box.append(head, body, foot);
  root.append(box);

  const close = () => { root.classList.add('hide'); root.innerHTML = ''; document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', esc);
  x.onclick = close;
  root.onmousedown = e => { if (e.target === root) close(); };
  return { body, foot, close };
}

function field(parent, label, value = '', { area = false, ph = '' } = {}) {
  const w = el('label', 'fld');
  w.append(el('span', null, label));
  const i = area ? el('textarea') : el('input');
  i.value = value || '';
  if (ph) i.placeholder = ph;
  if (area) i.rows = 4;
  w.append(i);
  parent.append(w);
  return i;
}

function toast(text, bad) {
  const t = el('div', 'toast' + (bad ? ' bad' : ''), text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3600);
}

// ---------- carregamento ----------
async function loadPeople() {
  const { data } = await sb.from('profiles').select('*');
  Object.keys(people).forEach(k => delete people[k]);
  (data || []).forEach(p => people[p.id] = p);
}

async function loadTree() {
  const [c, ch, cm, chm, ord] = await Promise.all([
    sb.from('categories').select('*').order('position').order('name'),
    sb.from('channels').select('*').order('position').order('name'),
    sb.from('category_members').select('*'),
    sb.from('channel_members').select('*'),
    sb.from('sidebar_order').select('*'),
  ]);
  [cats, chans, catMem, chanMem, order].forEach(o => Object.keys(o).forEach(k => delete o[k]));
  (ord.data || []).forEach(x => order[x.key] = x.position);
  (c.data || []).forEach(x => cats[x.id] = x);
  (ch.data || []).forEach(x => chans[x.id] = x);
  (cm.data || []).forEach(x => (catMem[x.category_id] ||= new Set()).add(x.profile_id));
  (chm.data || []).forEach(x => (chanMem[x.channel_id] ||= new Set()).add(x.profile_id));
}

// ---------- app ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  await loadPeople();
  me = people[session.user.id];
  if (!me) return $('#err').textContent = 'Perfil não encontrado. Fale com o comando.';
  await loadTree();

  $('#auth').classList.add('hide'); $('#app').classList.remove('hide');
  window.FX?.rain?.visivel(false);   // a chuva fica só na tela de acesso
  $('#me-name').textContent = me.codename;
  $('#me-role').textContent = { admin: 'ADMIN', command: 'COMANDO', agent: 'AGENTE' }[me.role] || 'AGENTE';
  $('#me-role').className = 'role-' + me.role;
  $('#new-ch').classList.toggle('hide', !isStaff());

  drawChannels();
  openChannel('geral');
  listen();
}

function listen() {
  live?.unsubscribe();
  const reload = async () => {
    await loadTree();
    // canal excluído (ou acesso revogado) enquanto estava aberto
    if (chan.startsWith('chan:') && !chans[chan.slice(5)]) return openChannel('geral');
    drawChannels();
  };

  live = sb.channel('cit')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, p => {
      const m = p.new || p.old;
      if (!m) return;
      if (p.eventType === 'INSERT') {
        if (m.channel === chan) { addMsg(m); if (m.author_id !== me.id) window.FX?.som.recebida(); }
        else {
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
        const changed = people[me.id].role !== me.role;
        me = people[me.id];
        if (changed) return location.reload();
      }
      drawChannels();
      window.MANAGE?.refresh?.();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'category_members' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sidebar_order' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'operations' }, p => window.OPS?.realtime?.('operations', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'operation_entries' }, p => window.OPS?.realtime?.('operation_entries', p))
    .subscribe();
}

// ---------- barra lateral ----------
const collapsed = new Set(JSON.parse(localStorage.getItem('cit.collapsed') || '[]'));
const saveCollapsed = () => localStorage.setItem('cit.collapsed', JSON.stringify([...collapsed]));

function chanInfo(key) {
  if (key === 'geral') return { label: 'geral', icon: '#', hint: 'todos os agentes · anônimo' };
  if (key === 'manage') return { label: 'Gerenciar usuários', icon: '⚙', hint: 'administração' };
  if (key.startsWith('agent:')) {
    const p = people[key.slice(6)];
    if (!p) return { label: '[removido]', icon: '🔒', hint: 'privado' };
    const meu = p.id === me.id;
    return {
      label: meu && me.role === 'agent' ? 'canal do comando' : p.codename + (meu ? ' (você)' : ''),
      icon: '🔒',
      hint: 'privado · ' + (meu ? 'você' : p.codename) + ' ⇄ comando',
    };
  }
  const c = chans[key.slice(5)];
  if (!c) return { label: 'canal', icon: '#', hint: '' };
  const cat = c.category_id && cats[c.category_id];
  const who = (c.category_id && c.inherit_access)
    ? (cat?.everyone ? 'todos' : `${(catMem[c.category_id] || new Set()).size} agente(s)`)
    : (c.everyone ? 'todos' : `${(chanMem[c.id] || new Set()).size} agente(s)`);
  return { label: c.name, icon: '#', hint: (c.topic ? c.topic + ' · ' : '') + 'acesso: ' + who, ch: c };
}

/** Cabeçalho recolhível, usado pelas categorias e pelos canais individuais. */
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
  const byCat = {}, loose = [];
  Object.values(chans)
    .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
    .forEach(c => {
      if (c.category_id && cats[c.category_id]) (byCat[c.category_id] ||= []).push(c);
      else loose.push(c);
    });

  const items = [
    { key: 'geral', kind: 'geral', def: 0 },
    { key: 'individuais', kind: 'group', def: 1 },
    ...Object.values(cats).map(c => ({ key: 'cat:' + c.id, kind: 'cat', cat: c, def: 10 + (c.position || 0) })),
    ...loose.map(c => ({ key: 'chan:' + c.id, kind: 'chan', ch: c, def: 100 + (c.position || 0) })),
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

    if (it.kind === 'geral') {
      navBtn(box, 'geral', 'geral', '#');

    } else if (it.kind === 'group') {
      if (me.role === 'agent') {
        navBtn(box, 'agent:' + me.id, 'canal do comando', '🔒');
      } else {
        // todo mundo tem canal individual, inclusive o próprio comando;
        // quem tem COMANDO ou ADMIN enxerga todos eles
        const todos = Object.values(people).sort((a, b) => a.codename.localeCompare(b.codename));
        if (!todos.length) { box.remove(); return; }
        const chaves = todos.map(p => 'agent:' + p.id);
        box.append(grupoHead('individuais', 'Canais individuais', todos.length, chaves));
        if (!collapsed.has('individuais')) {
          todos.forEach(p => navBtn(box, 'agent:' + p.id,
            p.codename + (p.id === me.id ? ' (você)' : ''), '🔒'));
        }
      }

    } else if (it.kind === 'cat') {
      const cat = it.cat;
      const dentro = byCat[cat.id] || [];
      const head = grupoHead(cat.id, cat.name, dentro.length, dentro.map(c => 'chan:' + c.id));
      if (isStaff()) {
        const ed = el('button', 'cat-ed', '✎');
        ed.title = 'Editar ou excluir categoria';
        ed.onclick = e => { e.stopPropagation(); window.MANAGE?.categoryForm?.(cat); };
        head.append(ed);
      }
      box.append(head);
      box.dataset.catId = cat.id;
      if (!collapsed.has(cat.id)) {
        dentro.forEach(c => armaCanal(navBtn(box, 'chan:' + c.id, c.name, '#', 'sub'), c));
      }

    } else {
      armaCanal(navBtn(box, 'chan:' + it.ch.id, it.ch.name, '#'), it.ch);
    }

    armaTopo(box);
  });

  if (isAdmin()) {
    const box = el('div', 'nav-item');
    box.append(el('h3', null, 'Administração'));
    navBtn(box, 'manage', 'Gerenciar usuários', '⚙', 'gear');
    nav.append(box);
  }
}

// ---------- membros do canal ----------
// Mostra só codinomes: o cargo continua invisível, como no chat. Onde o acesso
// vem do comando ou da administração, a lista diz isso sem nomear ninguém.
function membrosDoCanal(key) {
  const todos = () => Object.values(people);
  if (key === 'geral') {
    return { regra: 'Canal aberto: todos os agentes cadastrados.', lista: todos() };
  }
  if (key.startsWith('agent:')) {
    const p = people[key.slice(6)];
    return {
      regra: 'Canal privado, entre o agente e o comando.',
      lista: p ? [p] : [],
      extra: 'o comando',
    };
  }
  const c = chans[key.slice(5)];
  if (!c) return { regra: 'Canal não encontrado.', lista: [] };

  const herda = !!c.category_id && c.inherit_access && cats[c.category_id];
  const cat = herda ? cats[c.category_id] : null;
  const aberto = herda ? cat.everyone : c.everyone;

  if (aberto) {
    return {
      regra: herda
        ? `Aberto a todos os agentes, pela categoria ${cat.name}.`
        : 'Aberto a todos os agentes.',
      lista: todos(),
    };
  }
  const ids = herda ? (catMem[c.category_id] || new Set()) : (chanMem[c.id] || new Set());
  return {
    regra: herda
      ? `Acesso restrito, herdado da categoria ${cat.name}.`
      : 'Acesso restrito aos agentes abaixo.',
    lista: [...ids].map(id => people[id]).filter(Boolean),
    extra: 'a administração',
  };
}

function abreMembros(key) {
  const info = chanInfo(key);
  const { regra, lista, extra } = membrosDoCanal(key);
  const m = modal('MEMBROS · ' + info.label);
  m.body.append(el('p', 'form-note', regra));

  const ul = el('div', 'membros');
  lista.sort((a, b) => a.codename.localeCompare(b.codename)).forEach(p => {
    const li = el('div', 'membro');
    const pt = el('span', 'mb-dot');
    pt.style.background = `hsl(${hue(p.codename)} 90% 70%)`;
    li.append(pt, el('span', 'mb-nome', p.codename));
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
  m.foot.append(el('span', 'form-note', n + (n === 1 ? ' agente' : ' agentes') + (extra ? ' · e ' + extra : '')));
  const ok = el('button', 'primary', 'Fechar');
  ok.onclick = m.close;
  m.foot.append(ok);
}

$('#members').onclick = () => { if (chan !== 'manage') abreMembros(chan); };

// ---------- reordenar arrastando ----------
// Só o COMANDO arrasta, porque a ordem vale para todo mundo.
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

// ---------- colunas: ordem, largura e colapso ----------
// A barra de canais fica sempre à esquerda e fora dessa dança; as três de
// dentro da sala trocam de lugar arrastando o cabeçalho.
const COLS = {
  side:    { css: '--side-w', el: '#side',        min: 180, max: 460 },
  entries: { el: '#col-entries' },   // sempre a elástica: ocupa a sobra
  dossier: { css: '--dos-w',  el: '#col-dossier', min: 240, max: 900 },
  chat:    { css: '--chat-w', el: '#chat',        min: 260, max: 900 },
};
const INNER = ['entries', 'dossier', 'chat'];

let colOrder = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem('cit.colorder') || 'null');
    if (Array.isArray(raw) && raw.length === INNER.length && INNER.every(k => raw.includes(k))) return raw;
  } catch {}
  return [...INNER];
})();

// Preferência explícita do usuário: '1' aberta, '0' recolhida, null automático.
const colPref = k => { try { return localStorage.getItem('cit.col2.' + k); } catch { return null; } };
const soChat = () => document.documentElement.classList.contains('view-chat-only');

let temDossie = false;   // o canal atual tem alguma operação?
function marcaDossies(v) {
  const antes = temDossie;
  temDossie = !!v;
  if (antes !== temDossie) layout();
}

/**
 * No automático, relatos e dossiê só aparecem quando há operação no canal —
 * um canal de conversa abre com a transmissão inteira. Basta o usuário mexer
 * no botão da coluna para a escolha dele passar a mandar.
 */
function colVisivel(k) {
  if (soChat()) {
    if (k === 'entries' || k === 'dossier') return false;
    // no geral o chat é a sala inteira: recolhido em outro canal, ele não pode
    // vir fechado aqui, senão o canal abre vazio
    if (k === 'chat') return true;
  }
  const p = colPref(k);
  if (p === '0') return false;
  if (p === '1') return true;
  if (k === 'entries' || k === 'dossier') return temDossie;
  return true;
}

/**
 * Reposiciona colunas e alças conforme a ordem atual.
 * Cada alça guarda quem está à sua esquerda e à sua direita; quem ela
 * redimensiona só se decide na hora do arrasto, porque a coluna elástica
 * não tem largura própria para ajustar.
 */
function layout() {
  ['side', ...INNER].forEach(k => {
    const on = colVisivel(k);
    document.documentElement.classList.toggle('no-' + k, !on);
    document.querySelectorAll('.col-tg[data-col="' + k + '"]').forEach(b => b.classList.toggle('on', on));
  });
  const vis = colOrder.filter(colVisivel);
  const flexKey = vis.includes('entries') ? 'entries' : vis[0];
  requestAnimationFrame(reajustaLarguras);

  colOrder.forEach((k, i) => {
    const n = $(COLS[k].el);
    if (!n) return;
    n.style.order = i * 2;
    if (k === flexKey) { n.style.flex = '1'; n.style.width = 'auto'; }
    // 0 1 auto (e não 'none'): sob aperto elas cedem em vez de estourar a fila
    else { n.style.flex = '0 1 auto'; n.style.width = COLS[k].css ? `var(${COLS[k].css})` : ''; }
  });

  const grips = [...document.querySelectorAll('#room-body .grip.inner')];
  grips.forEach(g => { g.style.display = 'none'; delete g.dataset.esq; delete g.dataset.dir; });
  vis.slice(0, -1).forEach((k, i) => {
    const g = grips[i];
    if (!g) return;
    g.style.display = '';
    g.style.order = colOrder.indexOf(k) * 2 + 1;
    g.dataset.esq = k;
    g.dataset.dir = vis[i + 1];
  });
}

/**
 * Quanto uma coluna pode crescer agora. O teto não é fixo: depende do que as
 * outras colunas visíveis já ocupam. Sem isso, a coluna continuava "crescendo"
 * no papel depois que a elástica encolhia a zero, a fila estourava a largura da
 * sala e a alça descolava do cursor — que é a sensação de travar.
 */
const FOLGA_ELASTICA = 220;   // respiro mínimo da coluna que absorve a sobra

function maxCol(k) {
  const c = COLS[k];
  if (!c?.css) return 0;
  if (k === 'side') return Math.max(c.min, Math.min(c.max, innerWidth - 480));

  const body = $('#room-body');
  const cs = getComputedStyle(body);
  const gap = parseFloat(cs.gap) || 0;
  const vis = colOrder.filter(colVisivel);
  const alcas = Math.max(0, vis.length - 1);
  const itens = vis.length + alcas;

  let livre = body.getBoundingClientRect().width
    - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    - Math.max(0, itens - 1) * gap
    - alcas * 8;

  const elastica = vis.includes('entries') ? 'entries' : vis[0];
  vis.forEach(o => {
    if (o === k) return;
    livre -= (o === elastica || !COLS[o].css)
      ? FOLGA_ELASTICA
      : $(COLS[o].el).getBoundingClientRect().width;
  });
  return Math.max(c.min, Math.min(c.max, livre));
}

function larguraCol(k, px) {
  const c = COLS[k];
  if (!c?.css) return;
  const w = Math.round(Math.min(Math.max(px, c.min), maxCol(k)));
  document.documentElement.style.setProperty(c.css, w + 'px');
  try { localStorage.setItem('cit.w.' + k, String(w)); } catch {}
}

/** Reaplica as larguras dentro do teto atual (janela menor, coluna recolhida). */
function reajustaLarguras() {
  Object.keys(COLS).forEach(k => {
    if (!COLS[k].css) return;
    const atual = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(COLS[k].css));
    if (atual) larguraCol(k, atual);
  });
}

function abreCol(k, on) {
  try { localStorage.setItem('cit.col2.' + k, on ? '1' : '0'); } catch {}
  layout();
}

/** Devolve a coluna ao comportamento automático. */
function autoCol(k) {
  try { localStorage.removeItem('cit.col2.' + k); } catch {}
  layout();
}

function ordenaCols(mover, alvo, antes) {
  if (mover === alvo) return;
  const arr = colOrder.filter(k => k !== mover);
  const at = arr.indexOf(alvo);
  arr.splice(antes ? at : at + 1, 0, mover);
  colOrder = arr;
  try { localStorage.setItem('cit.colorder', JSON.stringify(colOrder)); } catch {}
  layout();
}

(() => {
  Object.entries(COLS).forEach(([k, c]) => {
    if (!c.css) return;
    const w = +localStorage.getItem('cit.w.' + k);
    if (w) document.documentElement.style.setProperty(c.css, w + 'px');
  });
  layout();

  document.querySelectorAll('.col-tg').forEach(b => {
    b.onclick = () => abreCol(b.dataset.col, document.documentElement.classList.contains('no-' + b.dataset.col));
  });
  document.querySelectorAll('.col-x').forEach(b => {
    b.onclick = () => abreCol(b.dataset.col, false);
  });

  // ---- trocar colunas de lugar ----
  let puxada = null;
  const limpaCol = () => document.querySelectorAll('.col-head.drop-l,.col-head.drop-r')
    .forEach(n => n.classList.remove('drop-l', 'drop-r'));

  document.querySelectorAll('#room-body .col[data-col]').forEach(sec => {
    const head = sec.querySelector('.col-head');
    const alca = head?.querySelector('.col-drag');
    if (!head || !alca) return;
    const key = sec.dataset.col;
    alca.draggable = true;

    alca.addEventListener('dragstart', e => {
      puxada = key;
      sec.classList.add('col-moving');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    });
    alca.addEventListener('dragend', () => { sec.classList.remove('col-moving'); limpaCol(); puxada = null; });

    head.addEventListener('dragover', e => {
      if (!puxada || puxada === key) return;
      e.preventDefault();
      limpaCol();
      const r = head.getBoundingClientRect();
      head.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-l' : 'drop-r');
    });
    head.addEventListener('drop', e => {
      if (!puxada || puxada === key) return;
      e.preventDefault();
      const antes = head.classList.contains('drop-l');
      const mover = puxada;
      limpaCol(); puxada = null;
      ordenaCols(mover, key, antes);
    });
  });

  // ---- redimensionar ----
  let alvo = null, lado = null, caixa = null;
  const eixo = e => (e.touches ? e.touches[0].clientX : e.clientX);
  const move = e => {
    if (!alvo) return;
    const x = eixo(e);
    larguraCol(alvo, lado === 'esq' ? x - caixa.left : caixa.right - x);
  };
  const up = () => { alvo = null; document.body.classList.remove('dragging'); };

  document.querySelectorAll('.grip').forEach(g => {
    const down = e => {
      if (g.dataset.grip === 'side') {
        alvo = 'side'; lado = 'esq';
      } else {
        // a coluna elástica não tem largura própria: nesse caso a alça
        // ajusta a vizinha do outro lado
        const esq = g.dataset.esq, dir = g.dataset.dir;
        if (COLS[esq]?.css) { alvo = esq; lado = 'esq'; }
        else if (COLS[dir]?.css) { alvo = dir; lado = 'dir'; }
        else return;
      }
      caixa = $(COLS[alvo].el).getBoundingClientRect();
      document.body.classList.add('dragging');
      e.preventDefault();
    };
    g.addEventListener('mousedown', down);
    g.addEventListener('touchstart', down, { passive: false });
  });
  addEventListener('mousemove', move);
  addEventListener('touchmove', move, { passive: true });
  addEventListener('mouseup', up);
  addEventListener('touchend', up);
  addEventListener('resize', reajustaLarguras);
})();

// ---------- abrir canal ----------
let loadToken = 0;

async function openChannel(key, jumpTo) {
  chan = key;
  const info = chanInfo(key);
  window.FX?.decodifica($('#ch-title'), info.label, 380);
  $('#ch-hint').textContent = info.hint;
  drawChannels();

  const manageView = key === 'manage';
  const apenasChat = key === 'geral';
  document.documentElement.classList.toggle('view-manage', manageView);
  document.documentElement.classList.toggle('view-chat-only', apenasChat);
  layout();
  $('#manage').classList.toggle('hide', !manageView);
  const alvoKick = key.startsWith('agent:') ? people[key.slice(6)] : null;
  $('#kick').classList.toggle('hide', manageView || !alvoKick || alvoKick.id === me.id
    || !(isAdmin() || (isStaff() && alvoKick.role === 'agent')));
  $('#ch-edit').classList.toggle('hide', manageView || !(isStaff() && key.startsWith('chan:')));
  $('#op-new').classList.toggle('hide', manageView || apenasChat);
  document.querySelector('.col-tgs').classList.toggle('hide', manageView);
  $('#members').classList.toggle('hide', manageView);
  window.OPS?.setChannel?.(key);
  if (manageView) return window.MANAGE?.open?.();

  unread.delete(key);
  window.FX?.bootLine(info.label);

  const token = ++loadToken;
  const box = $('#msgs');
  box.innerHTML = '';
  msgEls.clear();

  let data;
  if (jumpTo?.created_at) {
    const [before, after] = await Promise.all([
      sb.from('messages').select('*').eq('channel', key).lte('created_at', jumpTo.created_at).order('created_at', { ascending: false }).limit(80),
      sb.from('messages').select('*').eq('channel', key).gt('created_at', jumpTo.created_at).order('created_at').limit(40),
    ]);
    data = [...(before.data || []).reverse(), ...(after.data || [])];
  } else {
    ({ data } = await sb.from('messages').select('*').eq('channel', key).order('created_at').limit(300));
  }
  if (token !== loadToken) return;

  if (!data?.length) box.innerHTML = EMPTY_CH;
  data?.forEach(m => addMsg(m, true));
  box.scrollTop = box.scrollHeight;

  if (jumpTo?.id) {
    const t = msgEls.get(String(jumpTo.id));
    if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 2500); }
  }
}

// ---------- mensagens ----------
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return 180 + (h % 130); } // azul → roxo

function buildMsg(m) {
  const a = people[m.author_id] || { codename: '[removido]', role: 'agent' };
  const wrap = el('div', 'm' + (m.author_id === me.id ? ' mine' : ''));
  wrap.dataset.id = m.id;

  const head = el('div', 'head');
  const who = el('span', 'who', a.codename);
  who.style.color = `hsl(${hue(a.codename)} 90% 70%)`;
  head.append(who);
  // sem etiqueta de cargo: ninguém deve deduzir pelo chat quem é comando ou admin
  head.append(el('time', null, new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  if (m.edited_at) {
    const e = el('span', 'ed', '(editada)');
    const by = people[m.edited_by];
    e.title = 'editada' + (by ? ' por ' + by.codename : '') + ' em ' + new Date(m.edited_at).toLocaleString('pt-BR');
    head.append(e);
  }
  if (m.author_id === me.id || isStaff()) {
    const own = m.author_id === me.id;
    const b = el('button', 'act', '✎');
    b.title = own ? 'Editar' : 'Editar (comando)';
    b.onclick = () => editMsg(wrap, m);
    const d = el('button', 'act del', '🗑');
    d.title = own ? 'Apagar' : 'Apagar (comando)';
    d.onclick = () => delMsg(wrap, m);
    head.append(b, d);
  }
  wrap.append(head);

  const txt = el('div', 'txt md');
  txt.append(MD.render(m.body));
  wrap.append(txt);
  return wrap;
}

function addMsg(m, bulk) {
  const box = $('#msgs');
  box.querySelector('.empty')?.remove();
  if (msgEls.has(String(m.id))) return;
  const node = buildMsg(m);
  msgEls.set(String(m.id), node);
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || m.author_id === me.id;
  box.append(node);
  if (!bulk && near) box.scrollTop = box.scrollHeight;
}

const EMPTY_CH = '<p class="empty">&gt; canal silencioso.<br>&gt; seja o primeiro a transmitir.</p>';

async function delMsg(wrap, m) {
  const own = m.author_id === me.id;
  const who = people[m.author_id]?.codename || 'agente removido';
  if (!confirm(own ? 'Apagar esta mensagem?' : `Apagar a mensagem de ${who}? Não há volta.`)) return;
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
    toast('Falha ao enviar: ' + error.message, true);
  }
}

// Altura da caixa de texto: cresce sozinha até 180px, ou fica na altura que o
// usuário arrastar. Duplo clique na alça volta para o automático.
let msgH = +localStorage.getItem('cit.msgh') || 0;

function grow() {
  const ta = $('#msg');
  if (msgH) { ta.style.height = msgH + 'px'; return; }
  ta.style.height = 'auto';
  ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
}

(() => {
  const grip = $('#msg-grip');
  let from = 0, base = 0, dragging = false;
  const y = e => (e.touches ? e.touches[0].clientY : e.clientY);

  const down = e => {
    dragging = true;
    from = y(e);
    base = $('#msg').getBoundingClientRect().height;
    document.body.classList.add('dragging-v');
    e.preventDefault();
  };
  const move = e => {
    if (!dragging) return;
    const h = Math.round(Math.min(Math.max(base + (from - y(e)), 38), innerHeight * 0.65));
    msgH = h;
    $('#msg').style.height = h + 'px';
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-v');
    localStorage.setItem('cit.msgh', String(msgH));
  };

  grip.addEventListener('mousedown', down);
  grip.addEventListener('touchstart', down, { passive: false });
  addEventListener('mousemove', move);
  addEventListener('touchmove', move, { passive: true });
  addEventListener('mouseup', up);
  addEventListener('touchend', up);
  grip.addEventListener('dblclick', () => {
    msgH = 0;
    localStorage.removeItem('cit.msgh');
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

$('#kick').onclick = async () => {
  const id = chan.replace('agent:', ''), p = people[id];
  if (!p || !confirm(`Remover o agente ${p.codename}? O acesso e o canal individual dele serão apagados.`)) return;
  const { error } = await sb.rpc('remove_agent', { target: id });
  if (error) return toast('Não foi possível remover: ' + error.message, true);
  delete people[id];
  openChannel('geral');
};

$('#ch-edit').onclick = () => window.MANAGE?.channelForm?.(chans[chan.slice(5)]);
$('#new-ch').onclick = () => window.MANAGE?.newMenu?.();

// ---------- ruído de CRT ----------
// A cada 9 a 30 segundos a tela dá uma "vacilada" de sinal. Puramente visual:
// tudo acontece numa camada sobreposta, sem tocar no layout nem capturar clique.
(() => {
  const html = document.documentElement;
  const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const pref = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const ligado = () => pref('cit.crt') !== '0' && !calmo?.matches;

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

  // atalho para quem se incomodar: desliga e lembra da escolha
  window.CRT = {
    toggle() {
      const on = !ligado();
      try { localStorage.setItem('cit.crt', on ? '1' : '0'); } catch {}
      html.classList.toggle('no-crt', !on);
      return on;
    },
  };
  if (!ligado()) html.classList.add('no-crt');
})();

// os complementos (ops/manage/search) carregam depois deste arquivo
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start);
else setTimeout(start);
