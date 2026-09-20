const sb = supabase.createClient(CFG.url, CFG.key);
const $ = s => document.querySelector(s);
let me, chan = 'geral', people = {}, signup = false, live;

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

// ---------- app ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const { data: list } = await sb.from('profiles').select('*');
  if (!list) return;
  list.forEach(p => people[p.id] = p);
  me = people[session.user.id];
  if (!me) return $('#err').textContent = 'Perfil não encontrado. Fale com o comando.';

  $('#auth').classList.add('hide'); $('#app').classList.remove('hide');
  $('#me-name').textContent = me.codename;
  $('#me-role').textContent = me.role === 'command' ? 'COMANDO' : 'AGENTE';
  drawChannels(); open('geral');

  live?.unsubscribe();
  live = sb.channel('cit')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
      if (m.channel === chan) addMsg(m);
      else document.querySelector(`[data-ch="${CSS.escape(m.channel)}"]`)?.classList.add('new');
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, ({ new: p }) => {
      people[p.id] = p; drawChannels();
    }).subscribe();
}

function channels() {
  if (me.role === 'agent') return [['geral', '# geral'], ['agent:' + me.id, '🔒 canal do comando']];
  const agents = Object.values(people).filter(p => p.role === 'agent').sort((a, b) => a.codename.localeCompare(b.codename));
  return [['geral', '# geral'], ...agents.map(a => ['agent:' + a.id, '🔒 ' + a.codename])];
}

function drawChannels() {
  const nav = $('#chans'); nav.innerHTML = '';
  channels().forEach(([id, label], i) => {
    if (me.role === 'command' && i === 1) { const h = document.createElement('h3'); h.textContent = 'Canais individuais'; nav.append(h); }
    const b = document.createElement('button');
    b.dataset.ch = id; b.textContent = label;
    b.classList.toggle('on', id === chan);
    b.onclick = () => { open(id); $('#side').classList.remove('open'); };
    nav.append(b);
  });
}

async function open(id) {
  chan = id;
  const c = channels().find(x => x[0] === id) || [id, id];
  $('#ch-title').textContent = c[1].replace('🔒 ', '');
  $('#ch-hint').textContent = id === 'geral' ? 'todos os agentes · anônimo' : 'privado · comando ⇄ agente';
  drawChannels();
  const box = $('#msgs'); box.innerHTML = '';
  const { data } = await sb.from('messages').select('*').eq('channel', id).order('created_at').limit(200);
  if (!data?.length) box.innerHTML = '<p class="empty">> canal silencioso.<br>> seja o primeiro a transmitir.</p>';
  data?.forEach(addMsg);
}

function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return 180 + (h % 130); } // azul → roxo

function addMsg(m) {
  const box = $('#msgs'); box.querySelector('.empty')?.remove();
  const a = people[m.author_id] || { codename: '???', role: 'agent' };
  const el = document.createElement('div');
  el.className = 'm' + (m.author_id === me.id ? ' mine' : '');
  const who = document.createElement('span'); who.className = 'who'; who.textContent = a.codename;
  who.style.color = `hsl(${hue(a.codename)} 90% 70%)`;
  el.append(who);
  if (a.role === 'command') { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'CMD'; el.append(t); }
  const tm = document.createElement('time'); tm.textContent = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = m.body;
  el.append(tm, txt);
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120 || m.author_id === me.id;
  box.append(el);
  if (near) box.scrollTop = box.scrollHeight;
}

async function send() {
  const body = $('#msg').value.trim();
  if (!body) return;
  $('#msg').value = '';
  const { error } = await sb.from('messages').insert({ channel: chan, body });
  if (error) { $('#msg').value = body; $('#ch-hint').textContent = 'falha ao enviar — tente de novo'; }
}
$('#send').onclick = send;
$('#msg').addEventListener('keydown', e => e.key === 'Enter' && send());
$('#menu').onclick = () => $('#side').classList.toggle('open');

start(); // retoma sessão salva
