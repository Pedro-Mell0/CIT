/* ===========================================================================
   search.js — varredura global (Ctrl+F) nos informes, limitada pelo RLS aos
   canais que o oficial realmente acessa.
   =========================================================================== */
(() => {
  let timer, seq = 0, results = [];

  function openFind() {
    if (!isOficial()) return;          // candidato não tem o que varrer
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
    const meu = ++seq;
    const res = $('#find-res');
    if (q.length < 2) {
      results = [];
      res.innerHTML = '';
      $('#find-stat').textContent = q ? 'digite ao menos 2 caracteres' : '';
      return;
    }
    $('#find-stat').textContent = 'varrendo...';

    const { data } = await sb.from('messages').select('*')
      .ilike('body', `%${q}%`).order('created_at', { ascending: false }).limit(60);
    if (meu !== seq) return;

    results = (data || []).map(m => ({
      channel: m.channel, text: m.body, row: m,
      who: people[m.author_id]?.name || '[removido]',
      when: m.created_at,
    }));
    // canal com trava de código pendente não aparece na varredura: o trecho
    // entregaria justamente o que a trava esconde
    results = results.filter(r => !window.LOCKS?.travaPendente?.(r.channel));

    res.innerHTML = '';
    $('#find-stat').textContent = results.length
      ? `${results.length} ocorrência(s)`
      : 'nada encontrado nos seus canais';
    results.forEach(r => res.append(card(r, q)));
  }

  function card(r, q) {
    const a = el('button', 'r-card');
    const head = el('div', 'r-head');
    head.append(el('span', 'r-ch', chanInfo(r.channel).icon + ' ' + chanInfo(r.channel).label));
    head.append(el('span', 'r-who', r.who));
    head.append(el('time', null, new Date(r.when).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })));
    a.append(head, snippet(r.text, q));
    a.onclick = () => go(r);
    return a;
  }

  async function go(r) {
    closeFind();
    await openChannel(r.channel, { id: r.row.id, created_at: r.row.created_at });
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
