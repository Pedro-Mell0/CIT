/* ===========================================================================
   avisos.js — a caixa de avisos do agente.

   Hoje só carrega um tipo: a conexão encontrada entre operações. Quando a
   mesma entidade passa a estar ligada a duas investigações, quem alcança
   qualquer uma delas recebe o aviso.

   O aviso é mudo de propósito: não diz o nome da entidade, não diz as
   operações, não traz foto nem resumo. Ele diz que existe algo para olhar e
   leva até o grafo — e lá o RLS mostra ao agente exatamente o que ele já
   podia ver, nem uma linha a mais. É o que deixa avisar quem só enxerga um
   lado da conexão sem entregar o outro.
   =========================================================================== */
(() => {
  let avisos = [];
  let aberto = false;

  const naoLidos = () => avisos.filter(a => !a.seen_at).length;

  const quando = t => new Date(t).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function pinta() {
    const b = $('#avisos');
    if (!b) return;
    const n = naoLidos();
    b.classList.remove('hide');
    b.classList.toggle('tem', n > 0);
    b.dataset.n = n > 9 ? '9+' : String(n);
    b.title = n ? `${n} aviso(s) não lido(s)` : 'Avisos';
  }

  async function carrega() {
    const { data, error } = await sb.from('notices')
      .select('*').order('created_at', { ascending: false }).limit(60);
    if (error) { console.error('avisos:', error); return; }
    avisos = data || [];
    pinta();
  }

  /** Marca como visto o que está na tela. Não apaga: a caixa é histórico. */
  async function marcaVistos() {
    const novos = avisos.filter(a => !a.seen_at).map(a => a.id);
    if (!novos.length) return;
    const agora = new Date().toISOString();
    const { error } = await sb.from('notices').update({ seen_at: agora }).in('id', novos);
    if (error) return console.error('avisos:', error);
    avisos.forEach(a => { if (novos.includes(a.id)) a.seen_at = agora; });
    pinta();
  }

  function cartao(a) {
    const card = el('article', 'av-card' + (a.seen_at ? '' : ' novo'));
    const head = el('header');
    head.append(el('b', null, '⚠ CONEXÃO ENCONTRADA'));
    head.append(el('time', null, quando(a.created_at)));
    card.append(head);
    card.append(el('p', 'av-txt',
      'Um alvo de interesse foi identificado em outra operação.'));
    const ver = el('button', 'primary sm', 'Visualizar no grafo →');
    ver.onclick = () => {
      $('#modal').classList.add('hide');
      $('#modal').innerHTML = '';
      window.TEIA?.abrirNo?.('ent', a.entity_id);
    };
    card.append(ver);
    return card;
  }

  async function abre() {
    if (aberto) return;
    aberto = true;
    await carrega();
    const m = modal('AVISOS', { onClose: () => { aberto = false; } });
    m.body.append(el('p', 'form-note',
      'O aviso não nomeia a entidade nem a operação. Abra o grafo para ver o ' +
      'que o seu acesso alcança.'));

    if (!avisos.length) {
      m.body.append(el('p', 'empty', '> nenhum aviso.'));
    } else {
      const box = el('div', 'av-lista');
      avisos.forEach(a => box.append(cartao(a)));
      m.body.append(box);
    }

    const ok = el('button', 'primary', 'Fechar');
    ok.onclick = m.close;
    m.foot.append(ok);

    // Visto ao abrir: a caixa já está na tela, o aviso cumpriu o papel dele.
    marcaVistos();
  }

  window.AVISOS = {
    carrega,
    abre,
    /** Chamado pelo realtime: aviso novo acende a marca na hora. */
    async chegou() {
      await carrega();
      if (naoLidos()) window.FX?.som?.recebida?.();
    },
  };
})();
