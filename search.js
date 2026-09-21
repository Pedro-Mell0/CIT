/* ===========================================================================
   search.js — varredura global (Ctrl+F) em mensagens, dossiês e relatos,
   limitada pelo RLS aos canais que o usuário realmente acessa.
   =========================================================================== */
(() => {
  const OP_COLS = ['title', 'f_date', 'f_time', 'f_place', 'f_nature',
    'f_suspects', 'f_agents', 'f_witnesses', 'f_victims', 'f_report'];
  const ENTRY_COLS = OP_COLS.filter(c => c !== 'title');

  let timer, seq = 0, results = [];

  // PostgREST usa vírgula e parênteses como sintaxe no filtro `or`.
  const clean = s => s.replace(/[,()"\\]/g, ' ').trim();
  const orFilter = (cols, q) => cols.map(c => `${c}.ilike.%${q}%`).join(',');

  function openFind() {
    $('#find').classList.remove('hide');
    const i = $('#find-q');
    i.focus(); i.select();
    if (i.value.trim()) run(i.value);
  }
  const closeFind = () => $('#find').classList.add('hide');

  function snippet(text, q) {
    const flat = MD.plain(text);
    const at = flat.toLowerCase().indexOf(q.toLowerCase());
    const from = Math.max(0, at - 60);
    const cut = flat.slice(from, from + 220);
    const out = el('p', 'r-snip');
    if (at < 0) { out.textContent = (from ? '…' : '') + cut; return out; }
    if (from) out.append('…');
    const rel = at - from;
    out.append(cut.slice(0, rel));
    out.append(el('mark', null, cut.slice(rel, rel + q.length)));
    out.append(cut.slice(rel + q.length));
    if (from + 220 < flat.length) out.append('…');
    return out;
  }

  async function run(raw) {
    const q = raw.trim();
    const mine = ++seq;
    const res = $('#find-res');
    if (q.length < 2) {
      results = [];
      res.innerHTML = '';
      $('#find-stat').textContent = q ? 'digite ao menos 2 caracteres' : '';
      return;
    }
    $('#find-stat').textContent = 'varrendo...';
    const safe = clean(q);
    const none = { data: [] };

    const [msgs, opsR, ents] = await Promise.all([
      sb.from('messages').select('*').ilike('body', `%${q}%`).order('created_at', { ascending: false }).limit(50),
      safe ? sb.from('operations').select('*').or(orFilter(OP_COLS, safe)).order('updated_at', { ascending: false }).limit(30) : none,
      safe ? sb.from('operation_entries').select('*, operations(id,title,channel)').or(orFilter(ENTRY_COLS, safe)).order('updated_at', { ascending: false }).limit(30) : none,
    ]);
    if (mine !== seq) return;

    results = [];
    (msgs.data || []).forEach(m => results.push({
      kind: 'msg', channel: m.channel, text: m.body, row: m,
      who: people[m.author_id]?.codename || '[removido]',
      when: m.created_at,
    }));
    (opsR.data || []).forEach(o => results.push({
      kind: 'op', channel: o.channel, opId: o.id, title: o.title,
      text: OP_COLS.map(c => o[c]).filter(Boolean).join(' · '),
      who: people[o.created_by]?.codename || '[removido]', when: o.updated_at,
    }));
    (ents.data || []).forEach(e => {
      const o = e.operations;
      if (!o) return;
      results.push({
        kind: 'entry', channel: o.channel, opId: o.id, title: o.title,
        text: ENTRY_COLS.map(c => e[c]).filter(Boolean).join(' · '),
        who: people[e.created_by]?.codename || '[removido]', when: e.updated_at,
      });
    });
    // canal com trava de código pendente não aparece na varredura: o trecho
    // entregaria justamente o que a trava esconde
    results = results.filter(r => !window.LOCKS?.travaPendente?.(r.channel));
    results.sort((a, b) => new Date(b.when) - new Date(a.when));

    res.innerHTML = '';
    $('#find-stat').textContent = results.length
      ? `${results.length} ocorrência(s)`
      : 'nada encontrado nos seus canais';

    const groups = [
      ['MENSAGENS', results.filter(r => r.kind === 'msg')],
      ['DOSSIÊS', results.filter(r => r.kind === 'op')],
      ['RELATOS', results.filter(r => r.kind === 'entry')],
    ];
    groups.forEach(([label, list]) => {
      if (!list.length) return;
      res.append(el('h4', 'r-group', `${label} (${list.length})`));
      list.forEach(r => res.append(card(r, q)));
    });
  }

  function card(r, q) {
    const a = el('button', 'r-card');
    const head = el('div', 'r-head');
    head.append(el('span', 'r-ch', (r.kind === 'msg' ? '#' : '⬢') + ' ' + chanInfo(r.channel).label));
    if (r.title) head.append(el('span', 'r-op', r.title));
    head.append(el('span', 'r-who', r.who));
    head.append(el('time', null, new Date(r.when).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })));
    a.append(head, snippet(r.text, q));
    a.onclick = () => go(r);
    return a;
  }

  async function go(r) {
    closeFind();
    if (r.kind === 'msg') {
      await openChannel(r.channel, { id: r.row.id, created_at: r.row.created_at });
    } else {
      await openChannel(r.channel);
      window.OPS?.focus?.(r.opId);
    }
  }

  // ---------- ligações ----------
  $('#find-q').addEventListener('input', e => {
    clearTimeout(timer);
    const v = e.target.value;
    timer = setTimeout(() => run(v), 220);
  });
  $('#find-q').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); results.length ? go(results[0]) : run(e.target.value); }
  });
  $('#find-x').onclick = closeFind;
  $('#find').onmousedown = e => { if (e.target === $('#find')) closeFind(); };
  $('#find-btn').onclick = openFind;

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      if ($('#app').classList.contains('hide')) return;   // ainda na tela de acesso
      e.preventDefault();
      $('#find').classList.contains('hide') ? openFind() : closeFind();
    }
    if (e.key === 'Escape' && !$('#find').classList.contains('hide')) closeFind();
  });
})();
