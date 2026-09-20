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
  const [c, ch, cm, chm] = await Promise.all([
    sb.from('categories').select('*').order('position').order('name'),
    sb.from('channels').select('*').order('position').order('name'),
    sb.from('category_members').select('*'),
    sb.from('channel_members').select('*'),
  ]);
  [cats, chans, catMem, chanMem].forEach(o => Object.keys(o).forEach(k => delete o[k]));
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
          document.querySelector(`[data-ch="${CSS.escape(m.channel)}"]`)?.classList.add('new');
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
    return { label: p ? (p.id === me.id ? 'canal do comando' : p.codename) : '[removido]', icon: '🔒', hint: 'privado · comando ⇄ agente' };
  }
  const c = chans[key.slice(5)];
  if (!c) return { label: 'canal', icon: '#', hint: '' };
  const cat = c.category_id && cats[c.category_id];
  const who = (c.category_id && c.inherit_access)
    ? (cat?.everyone ? 'todos' : `${(catMem[c.category_id] || new Set()).size} agente(s)`)
    : (c.everyone ? 'todos' : `${(chanMem[c.id] || new Set()).size} agente(s)`);
  return { label: c.name, icon: '#', hint: (c.topic ? c.topic + ' · ' : '') + 'acesso: ' + who, ch: c };
}

function navBtn(nav, key, label, icon, cls) {
  const b = el('button', cls);
  b.dataset.ch = key;
  b.append(el('span', 'ic', icon), el('span', 'nm', label));
  b.classList.toggle('on', key === chan);
  b.onclick = () => { openChannel(key); $('#side').classList.remove('open'); };
  nav.append(b);
  return b;
}

function drawChannels() {
  const nav = $('#chans'); nav.innerHTML = '';
  navBtn(nav, 'geral', 'geral', '#');

  if (me.role === 'agent') {
    navBtn(nav, 'agent:' + me.id, 'canal do comando', '🔒');
  } else {
    const agents = Object.values(people).filter(p => p.role === 'agent')
      .sort((a, b) => a.codename.localeCompare(b.codename));
    if (agents.length) nav.append(el('h3', null, 'Canais individuais'));
    agents.forEach(a => navBtn(nav, 'agent:' + a.id, a.codename, '🔒'));
  }

  const byCat = {}, loose = [];
  Object.values(chans)
    .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
    .forEach(c => {
      if (c.category_id && cats[c.category_id]) (byCat[c.category_id] ||= []).push(c);
      else loose.push(c);
    });

  Object.values(cats)
    .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
    .forEach(cat => {
      const head = el('h3', 'cat');
      const tw = el('button', 'cat-tw');
      tw.append(el('span', 'arw', collapsed.has(cat.id) ? '▸' : '▾'), el('span', null, cat.name));
      tw.onclick = () => {
        collapsed.has(cat.id) ? collapsed.delete(cat.id) : collapsed.add(cat.id);
        saveCollapsed(); drawChannels();
      };
      head.append(tw);
      if (isStaff()) {
        const ed = el('button', 'cat-ed', '✎');
        ed.title = 'Editar ou excluir categoria';
        ed.onclick = e => { e.stopPropagation(); window.MANAGE?.categoryForm?.(cat); };
        head.append(ed);
      }
      nav.append(head);
      if (!collapsed.has(cat.id)) (byCat[cat.id] || []).forEach(c => navBtn(nav, 'chan:' + c.id, c.name, '#', 'sub'));
    });

  if (loose.length) {
    nav.append(el('h3', null, 'Canais'));
    loose.forEach(c => navBtn(nav, 'chan:' + c.id, c.name, '#'));
  }

  if (isAdmin()) {
    nav.append(el('h3', null, 'Administração'));
    navBtn(nav, 'manage', 'Gerenciar usuários', '⚙', 'gear');
  }
}

// ---------- abrir canal ----------
let loadToken = 0;

async function openChannel(key, jumpTo) {
  chan = key;
  const info = chanInfo(key);
  window.FX?.decodifica($('#ch-title'), info.label, 380);
  $('#ch-hint').textContent = info.hint;
  drawChannels();

  const manageView = key === 'manage';
  $('#manage').classList.toggle('hide', !manageView);
  $('#chat').classList.toggle('hide', manageView);
  $('#kick').classList.toggle('hide', manageView || !(isStaff() && key.startsWith('agent:')));
  $('#ch-edit').classList.toggle('hide', manageView || !(isStaff() && key.startsWith('chan:')));
  $('#op-new').classList.toggle('hide', manageView);
  $('#ops-toggle').classList.toggle('hide', manageView);
  window.OPS?.setChannel?.(key);
  if (manageView) return window.MANAGE?.open?.();

  document.querySelector(`[data-ch="${CSS.escape(key)}"]`)?.classList.remove('new');
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
  if (a.role === 'command') head.append(el('span', 'tag', 'CMD'));
  if (a.role === 'admin') head.append(el('span', 'tag adm', 'ADM'));
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
