/* ===========================================================================
   fukurou.js — o bot visto de dentro, só para MASTER.
   Uma página por cima da sala: na barra, cada conversa que o Fukurou já teve
   no privado do Discord; no centro, o espelho dela, onde dá para responder
   como se fosse ele. E o painel do texto do aviso de mensagem nova.
   Quem fala com o Discord é a Edge Function `sinal`; aqui só se lê o espelho
   (fukurou_chats / fukurou_msgs) e se pede o envio.
   =========================================================================== */
(() => {
  const chats = {};          // discord_id -> conversa
  const novas = new Set();   // conversas com resposta ainda não vista
  let aberta = null;         // discord_id da conversa à vista, ou 'cfg'
  let vinculos = {};         // discord_id -> perfil do CIT, quando há vínculo
  let live = null;
  let root = null;

  const quando = t => new Date(t).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const nomeDe = c => c.display_name || c.username || c.discord_id;

  // ------------------------------------------------------------- transição
  // A coruja pousa no centro, abre os olhos e o voo mergulha num deles: é
  // nesse mergulho que a página troca. Na volta, ela só pisca e some.
  function coruja() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', 'fk-owl');
    svg.innerHTML =
      '<path d="M8 6l12 8h24l12-8v26c0 16-10 26-24 26S8 48 8 32z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="22" cy="30" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
      '<circle cx="42" cy="30" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
      '<circle class="fk-olho" cx="22" cy="30" r="3.5"/><circle class="fk-olho" cx="42" cy="30" r="3.5"/>' +
      '<path d="M28 40h8l-4 8z" fill="currentColor"/>';
    return svg;
  }

  function transicao(volta, noMeio) {
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tela = el('div', 'fk-trans' + (volta ? ' volta' : '') + (calmo ? ' calmo' : ''));
    tela.setAttribute('aria-hidden', 'true');
    const nome = el('b', 'fk-trans-nome');
    tela.append(coruja(), nome);
    document.body.append(tela);
    nome.textContent = 'FUKUROU';
    if (!volta) window.FX?.decodifica?.(nome, 'FUKUROU', 700);
    window.FX?.som?.recebida?.();
    const [meio, fim] = calmo ? [150, 300] : volta ? [450, 800] : [1150, 1700];
    setTimeout(noMeio, meio);
    setTimeout(() => tela.remove(), fim);
  }

  // ---------------------------------------------------------------- página
  function monta() {
    root = el('section', 'fk hide');
    root.id = 'fukurou';
    root.setAttribute('aria-label', 'Fukurou');
    root.innerHTML = `
      <aside class="fk-side">
        <div class="fk-brand"><svg class="logo sm"><use href="#owl"/></svg>
          <div><b>FUKUROU</b><span>espelho do Discord</span></div></div>
        <nav class="fk-nav">
          <button class="fk-cfg-btn" data-k="cfg"><span class="ic">⚙</span><span class="nm">mensagem padrão</span></button>
          <h3>Conversas</h3>
          <div class="fk-lista"></div>
        </nav>
        <button class="ghost fk-sai">← voltar ao CIT</button>
      </aside>
      <section class="fk-room">
        <header class="fk-head"><h2 class="fk-title"></h2><span class="fk-hint"></span></header>
        <div class="fk-msgs" aria-live="polite"></div>
        <div class="composer fk-composer hide">
          <div class="composer-row">
            <textarea class="fk-txt" rows="2" maxlength="2000" aria-label="Mensagem como Fukurou"
              placeholder="Responder como Fukurou..."></textarea>
            <button class="primary fk-env">Enviar</button>
          </div>
        </div>
        <div class="fk-cfg hide"></div>
      </section>`;
    document.body.append(root);

    root.querySelector('.fk-sai').onclick = fecha;
    root.querySelector('.fk-cfg-btn').onclick = abreConfig;
    const txt = root.querySelector('.fk-txt');
    root.querySelector('.fk-env').onclick = envia;
    txt.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envia(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !root.classList.contains('hide') && $('#modal').classList.contains('hide')) fecha();
    });
  }

  async function abre() {
    if (!isMaster()) return;
    if (!root) monta();
    transicao(false, async () => {
      root.classList.remove('hide');
      document.documentElement.classList.add('view-fukurou');
      await carrega();
      escuta();
      if (aberta && aberta !== 'cfg' && chats[aberta]) abreConversa(aberta);
      else abreConfig();
    });
  }

  function fecha() {
    transicao(true, () => {
      root.classList.add('hide');
      document.documentElement.classList.remove('view-fukurou');
      live?.unsubscribe();
      live = null;
    });
  }

  async function carrega() {
    const [{ data: cs, error }, { data: dl }] = await Promise.all([
      sb.from('fukurou_chats').select('*'),
      sb.from('discord_links').select('profile_id, discord_id'),
    ]);
    if (error) return toast(error.message, true);
    Object.keys(chats).forEach(k => delete chats[k]);
    (cs || []).forEach(c => chats[c.discord_id] = c);
    vinculos = {};
    (dl || []).forEach(r => { if (people[r.profile_id]) vinculos[r.discord_id] = people[r.profile_id]; });
    desenhaLista();
  }

  function desenhaLista() {
    const box = root.querySelector('.fk-lista');
    box.innerHTML = '';
    const lista = Object.values(chats).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (!lista.length) box.append(el('p', 'fk-vazio', '> nenhum contato ainda.'));
    lista.forEach(c => {
      const b = el('button', 'fk-chat');
      b.classList.toggle('on', aberta === c.discord_id);
      b.classList.toggle('new', novas.has(c.discord_id));
      const quem = el('span', 'nm', nomeDe(c));
      const perfil = vinculos[c.discord_id];
      const sub = el('span', 'fk-sub', (c.username ? '@' + c.username + ' · ' : '') + c.discord_id);
      b.append(quem, sub);
      if (perfil) {
        const cn = el('span', 'fk-cit', perfil.codename);
        cn.style.color = corDe(perfil);
        b.append(cn);
      }
      b.onclick = () => abreConversa(c.discord_id);
      box.append(b);
    });
    root.querySelector('.fk-cfg-btn').classList.toggle('on', aberta === 'cfg');
  }

  // ------------------------------------------------------------- conversa
  function mostra(cfg) {
    root.querySelector('.fk-msgs').classList.toggle('hide', cfg);
    root.querySelector('.fk-composer').classList.toggle('hide', cfg);
    root.querySelector('.fk-cfg').classList.toggle('hide', !cfg);
  }

  async function abreConversa(id) {
    const c = chats[id];
    if (!c) return;
    aberta = id;
    novas.delete(id);
    desenhaLista();
    mostra(false);
    window.FX?.decodifica?.(root.querySelector('.fk-title'), nomeDe(c), 380);
    const perfil = vinculos[id];
    root.querySelector('.fk-hint').textContent =
      (c.username ? '@' + c.username + ' · ' : '') + 'ID ' + id + (perfil ? ' · no CIT: ' + perfil.codename : '');

    const box = root.querySelector('.fk-msgs');
    box.innerHTML = '';
    const { data, error } = await sb.from('fukurou_msgs').select('*')
      .eq('discord_id', id).order('created_at').limit(500);
    if (aberta !== id) return;   // trocou de conversa enquanto carregava
    if (error) return toast(error.message, true);
    if (!data.length) box.innerHTML = '<p class="empty">&gt; nenhuma mensagem espelhada ainda.</p>';
    data.forEach(m => poe(m, true));
    box.scrollTop = box.scrollHeight;
    root.querySelector('.fk-txt').focus();
  }

  function poe(m, bulk) {
    const box = root.querySelector('.fk-msgs');
    if (box.querySelector(`[data-id="${m.id}"]`)) return;
    box.querySelector('.empty')?.remove();
    const c = chats[m.discord_id] || {};
    const wrap = el('div', 'm fk-m' + (m.from_bot ? ' fk-bot' : '') + (bulk ? ' sem-anim' : ''));
    wrap.dataset.id = m.id;
    const head = el('div', 'head');
    head.append(el('span', 'who', m.from_bot ? 'FUKUROU' : nomeDe(c)));
    head.append(el('time', null, quando(m.created_at)));
    const por = people[m.sent_by];
    if (por) {
      const p = el('span', 'ed', 'por ' + por.codename);
      p.title = 'Escrita pelo site, na página do Fukurou';
      head.append(p);
    }
    const txt = el('div', 'txt md');
    txt.append(MD.render(m.body));
    wrap.append(head, txt);
    const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || m.from_bot;
    box.append(wrap);
    if (!bulk && perto) box.scrollTop = box.scrollHeight;
  }

  async function envia() {
    const txt = root.querySelector('.fk-txt');
    const btn = root.querySelector('.fk-env');
    const texto = txt.value.trim();
    if (!texto || !aberta || aberta === 'cfg' || btn.disabled) return;
    btn.disabled = true;
    const { data, error } = await sb.functions.invoke('sinal',
      { body: { acao: 'enviar', discord_id: aberta, texto } });
    btn.disabled = false;
    if (error) {
      // o corpo da resposta traz o motivo; o erro do cliente só diz o status
      const motivo = await error.context?.json?.().then(j => j.erro).catch(() => null);
      return toast(motivo || error.message, true);
    }
    if (data?.erro) return toast(data.erro, true);
    txt.value = '';
    window.FX?.som?.envio?.();
  }

  // -------------------------------------------------------- mensagem padrão
  async function abreConfig() {
    aberta = 'cfg';
    desenhaLista();
    mostra(true);
    window.FX?.decodifica?.(root.querySelector('.fk-title'), 'Mensagem padrão', 380);
    root.querySelector('.fk-hint').textContent = 'o aviso que o Fukurou manda quando chega mensagem nova';

    const box = root.querySelector('.fk-cfg');
    box.innerHTML = '';
    const { data, error } = await sb.from('fukurou_settings').select('aviso').maybeSingle();
    if (error) return toast(error.message, true);

    box.append(el('p', 'form-note',
      'Vai no privado de quem tem acesso ao canal, a cada mensagem enviada com /fukurou. ' +
      'Nunca leva o conteúdo, o canal ou o autor. A mudança vale para o próximo aviso.'));
    const campo = field(box, 'Texto do aviso', data?.aviso || '', { area: true });
    campo.maxLength = 2000;
    campo.rows = 5;

    box.append(el('h4', 'form-block', 'COMO CHEGA NO DISCORD'));
    const prova = el('div', 'fk-prova');
    const cabeca = el('div', 'head');
    cabeca.append(el('span', 'who', 'FUKUROU'), el('span', 'fk-tag', 'APP'));
    const corpo = el('div', 'txt md');
    prova.append(cabeca, corpo);
    box.append(prova);
    const conta = el('small', null);
    box.append(conta);
    const repinta = () => {
      corpo.innerHTML = '';
      corpo.append(MD.render(campo.value));
      conta.textContent = `${campo.value.length} / 2000`;
    };
    campo.addEventListener('input', repinta);
    repinta();

    const salva = el('button', 'primary', 'Salvar');
    box.append(salva);
    salva.onclick = async () => {
      const v = campo.value.trim();
      if (!v) return toast('O aviso não pode ficar vazio.', true);
      salva.disabled = true;
      const { error: e } = await sb.from('fukurou_settings').update({ aviso: v }).eq('id', true);
      salva.disabled = false;
      if (e) return toast(e.message, true);
      toast('Mensagem padrão salva.');
    };
  }

  // ------------------------------------------------------------- tempo real
  function escuta() {
    live?.unsubscribe();
    live = sb.channel('fukurou')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fukurou_msgs' }, p => {
        const m = p.new;
        if (m.discord_id === aberta) poe(m);
        else if (!m.from_bot) { novas.add(m.discord_id); window.FX?.som?.recebida?.(); }
        if (chats[m.discord_id] && m.created_at > chats[m.discord_id].updated_at) {
          chats[m.discord_id].updated_at = m.created_at;
        }
        desenhaLista();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fukurou_chats' }, p => {
        if (p.eventType === 'DELETE') delete chats[p.old.discord_id];
        else chats[p.new.discord_id] = { ...chats[p.new.discord_id], ...p.new };
        desenhaLista();
      })
      .subscribe();
  }

  window.FUKUROU = { open: abre };
})();
