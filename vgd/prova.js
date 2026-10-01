/* ===========================================================================
   prova.js — a prova da Vanguarda, nas três pontas:
     · fazer      (candidato)
     · corrigir   (comando)
     · montar     (banco de questões e nota de corte)

   O gabarito nunca chega ao navegador do candidato: ele lê as questões pela
   view exam_questions_public, que não traz a coluna `correct`. A correção das
   objetivas acontece dentro do banco, no RPC enviar_prova().
   =========================================================================== */
(() => {
  const LETRAS = 'ABCDE';
  const ST = { em_andamento: 'EM ANDAMENTO', aguardando: 'AGUARDANDO CORREÇÃO', aprovado: 'APROVADO', reprovado: 'REPROVADO' };

  let cfg = { intro: '', min_percent: 70 };
  let minha = null;      // minha tentativa mais recente, se houver
  let pendentesN = 0;    // provas esperando correção (só interessa ao comando)

  const dataBR = d => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  // ---------------------------------------------------------------- estado
  async function carrega() {
    const [c, t] = await Promise.all([
      sb.from('exam_config').select('*').maybeSingle(),
      sb.from('exam_attempts').select('*').eq('profile_id', me.id).eq('arquivada', false)
        .order('started_at', { ascending: false }).limit(1),
    ]);
    if (c.data) cfg = c.data;
    minha = t.data?.[0] || null;
    if (isStaff()) {
      const { count } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aguardando').eq('arquivada', false);
      pendentesN = count || 0;
    }
  }

  /** Chamado pelo realtime: reconta e repinta o que estiver na tela. */
  async function realtime() {
    await carrega();
    drawChannels();
    if (chan === 'prova') abre();
    if (chan === 'correcao' && !document.querySelector('#correcao .cor-detalhe')) abreCorrecao();
  }

  // ---------------------------------------------------------------- rascunho
  // A prova só é gravada no banco na entrega. Entre uma coisa e outra, o que o
  // candidato escreveu vive aqui: sem isso, um F5 no meio da prova jogaria fora
  // tudo que ele já tinha respondido.
  const chaveRascunho = id => 'vgd.prova.' + id;
  const leRascunho = id => { try { return JSON.parse(localStorage.getItem(chaveRascunho(id)) || '{}'); } catch { return {}; } };
  const gravaRascunho = (id, r) => { try { localStorage.setItem(chaveRascunho(id), JSON.stringify(r)); } catch {} };
  const limpaRascunho = id => { try { localStorage.removeItem(chaveRascunho(id)); } catch {} };

  // ---------------------------------------------------------------- fazer
  async function abre() {
    const root = $('#prova');
    root.innerHTML = '';
    await carrega();

    if (!minha) return capa(root);
    if (minha.status === 'em_andamento') return formulario(root);
    return resultado(root, minha);
  }

  function capa(root) {
    const box = el('div', 'pane-scroll');
    const bloco = el('div', 'prova-capa');
    bloco.append(el('div', 'selo', 'PROVA DA VANGUARDA'));
    bloco.append(el('p', null, cfg.intro));

    const regras = el('div', 'prova-regras');
    regras.append(el('b', null, 'ANTES DE LARGAR'));
    const ul = el('ul');
    [
      'A prova mistura questões objetivas e dissertativas.',
      'As objetivas são corrigidas na hora; as dissertativas passam pelo comando.',
      `A nota de corte é ${cfg.min_percent}%.`,
      'Você tem uma tentativa. Uma segunda só com liberação do comando.',
      'Suas respostas ficam salvas neste navegador até a entrega — pode fechar e voltar.',
    ].forEach(t => ul.append(el('li', null, t)));
    regras.append(ul);
    bloco.append(regras);

    const go = el('button', 'primary', '▶ INICIAR A PROVA');
    go.onclick = async () => {
      go.disabled = true;
      const { data, error } = await sb.rpc('iniciar_prova');
      go.disabled = false;
      if (error) return toast(error.message, true);
      window.FX?.som.largada();
      minha = { id: data, status: 'em_andamento', pontos_max: 0 };
      abre();
    };
    bloco.append(go);
    box.append(bloco);
    root.append(box);
  }

  async function formulario(root) {
    const { data: qs, error } = await sb.from('exam_questions_public')
      .select('*').order('position').order('id');
    if (error) { root.append(el('p', 'empty', '> não foi possível carregar a prova: ' + error.message)); return; }
    if (!qs?.length) { root.append(el('p', 'empty', '> a prova ainda não foi montada pelo comando.')); return; }

    const rascunho = leRascunho(minha.id);

    const topo = el('div', 'prova-top');
    topo.append(el('b', null, 'PROVA DA VANGUARDA'));
    const prog = el('div', 'prova-prog');
    const barra = el('i');
    prog.append(barra);
    const conta = el('span', 'conta');
    topo.append(prog, conta);

    const box = el('div', 'pane-scroll');

    const atualiza = () => {
      const feitas = qs.filter(q => {
        const r = rascunho[q.id];
        return q.kind === 'objetiva' ? !!r?.escolha : !!r?.texto?.trim();
      }).length;
      barra.style.width = Math.round(feitas / qs.length * 100) + '%';
      conta.textContent = `${feitas} de ${qs.length} respondidas`;
      qs.forEach(q => {
        const card = box.querySelector(`[data-q="${q.id}"]`);
        const r = rascunho[q.id];
        const ok = q.kind === 'objetiva' ? !!r?.escolha : !!r?.texto?.trim();
        card?.classList.toggle('resp', ok);
      });
    };

    qs.forEach((q, i) => {
      const card = el('div', 'q-card');
      card.dataset.q = q.id;

      const head = el('div', 'q-head');
      head.append(el('span', 'q-num', String(i + 1).padStart(2, '0')));
      head.append(el('span', 'q-kind' + (q.kind === 'dissertativa' ? ' dis' : ''),
        q.kind === 'dissertativa' ? 'DISSERTATIVA' : 'OBJETIVA'));
      head.append(el('span', 'q-pts', q.points + (q.points === 1 ? ' ponto' : ' pontos')));
      card.append(head);
      card.append(el('p', 'q-prompt', q.prompt));

      if (q.kind === 'objetiva') {
        const opts = el('div', 'q-opts');
        (q.options || []).forEach((o, k) => {
          const lb = el('label', 'opt' + (rascunho[q.id]?.escolha === o.id ? ' marcada' : ''));
          const rd = el('input');
          rd.type = 'radio';
          rd.name = 'q' + q.id;
          rd.value = o.id;
          rd.checked = rascunho[q.id]?.escolha === o.id;
          rd.onchange = () => {
            rascunho[q.id] = { escolha: o.id };
            gravaRascunho(minha.id, rascunho);
            opts.querySelectorAll('.opt').forEach(n => n.classList.remove('marcada'));
            lb.classList.add('marcada');
            atualiza();
          };
          lb.append(rd, el('span', 'letra', (LETRAS[k] || '?') + '.'), el('span', null, o.text));
          opts.append(lb);
        });
        card.append(opts);
      } else {
        const ta = el('textarea');
        ta.rows = 5;
        ta.maxLength = 4000;
        ta.placeholder = 'Escreva sua resposta...';
        ta.value = rascunho[q.id]?.texto || '';
        ta.oninput = () => {
          rascunho[q.id] = { texto: ta.value };
          gravaRascunho(minha.id, rascunho);
          atualiza();
        };
        card.append(ta);
      }
      box.append(card);
    });

    const foot = el('div', 'prova-foot');
    foot.append(el('span', 'form-note',
      `Nota de corte: ${cfg.min_percent}%. Depois de entregar não dá para voltar.`));
    const go = el('button', 'primary', '✔ ENTREGAR A PROVA');
    go.onclick = async () => {
      const faltam = qs.filter(q => {
        const r = rascunho[q.id];
        return q.kind === 'objetiva' ? !r?.escolha : !r?.texto?.trim();
      }).length;
      if (!confirma(faltam
        ? `Faltam ${faltam} questão(ões) sem resposta. Entregar assim mesmo?`
        : 'Entregar a prova? Não há como voltar atrás.')) return;

      const respostas = qs.map(q => ({
        q: q.id,
        escolha: rascunho[q.id]?.escolha || null,
        texto: rascunho[q.id]?.texto || '',
      }));
      go.disabled = true;
      const { error } = await sb.rpc('enviar_prova', { p_attempt: minha.id, p_respostas: respostas });
      go.disabled = false;
      if (error) return toast(error.message, true);
      limpaRascunho(minha.id);
      window.FX?.som.envio();
      abre();
    };
    foot.append(go);
    box.append(foot);

    root.append(topo, box);
    atualiza();
  }

  function resultado(root, t) {
    const box = el('div', 'pane-scroll');
    const card = el('div', 'res-card');
    const selo = el('div', 'res-selo ' + t.status, ST[t.status] || t.status);
    card.append(selo);

    if (t.status === 'aguardando') {
      card.append(el('p', null,
        'Prova entregue em ' + dataBR(t.submitted_at) + '. As dissertativas estão com o comando; o resultado aparece aqui assim que sair.'));
    } else {
      const nota = el('div', 'res-nota', (t.nota ?? 0) + '%');
      nota.append(el('small', null, `NOTA DE CORTE ${cfg.min_percent}%`));
      card.append(nota);
      card.append(el('p', 'form-note',
        `${t.pontos_obj + t.pontos_dis} de ${t.pontos_max} pontos · corrigida em ${dataBR(t.reviewed_at)}`));
      if (t.parecer) {
        const p = el('div', 'res-parecer');
        p.append(el('b', null, 'PARECER DO COMANDO'), el('br'));
        p.append(document.createTextNode(t.parecer));
        card.append(p);
      }
      card.append(el('p', null, t.status === 'aprovado'
        ? 'Bem-vindo à Vanguarda. Os informes da unidade já estão liberados na barra ao lado.'
        : 'A tentativa não passou. Uma nova só com liberação do comando.'));
    }
    box.append(card);
    root.append(box);
  }

  // ---------------------------------------------------------------- corrigir
  async function abreCorrecao() {
    const root = $('#correcao');
    root.innerHTML = '';
    if (!isStaff()) { root.append(el('p', 'empty', '> acesso restrito ao comando.')); return; }

    const box = el('div', 'pane-scroll');
    root.append(box);

    const head = el('header', 'pane-head');
    head.append(el('h3', null, 'CORREÇÃO DE PROVAS'));
    box.append(head);

    const { data, error } = await sb.from('exam_attempts')
      .select('*, profiles(name,color,role)')
      .eq('arquivada', false)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false });
    if (error) { box.append(el('p', 'empty', '> ' + error.message)); return; }
    if (!data?.length) { box.append(el('p', 'empty', '> nenhuma prova iniciada até agora.')); return; }

    const aguardando = data.filter(t => t.status === 'aguardando');
    box.append(el('p', 'pane-note', aguardando.length
      ? `${aguardando.length} prova(s) esperando correção.`
      : 'Nenhuma prova esperando correção no momento.'));

    const lista = el('div', 'cor-lista');
    data.forEach(t => lista.append(linhaTentativa(t)));
    box.append(lista);
  }

  function linhaTentativa(t) {
    const row = el('button', 'cor-row');
    const nome = el('span', 'cor-nome', t.profiles?.name || '[removido]');
    nome.style.color = t.profiles?.color || 'var(--text)';
    row.append(nome);
    row.append(el('span', 'st ' + t.status, ST[t.status] || t.status));
    row.append(el('span', 'cor-nota', t.nota != null ? t.nota + '%' : '—'));
    row.append(el('span', 'cor-data', dataBR(t.submitted_at || t.started_at)));
    const ir = el('span', 'form-note', t.status === 'em_andamento' ? 'em prova' : 'abrir ›');
    row.append(ir);
    row.onclick = () => { if (t.status !== 'em_andamento') detalhe(t); };
    if (t.status === 'em_andamento') row.disabled = true;
    return row;
  }

  async function detalhe(t) {
    const root = $('#correcao');
    root.innerHTML = '';
    const box = el('div', 'pane-scroll cor-detalhe');
    root.append(box);

    const head = el('header', 'pane-head');
    const voltar = el('button', 'ghost', '‹ Voltar');
    voltar.onclick = abreCorrecao;
    head.append(voltar);
    head.append(el('h3', null, (t.profiles?.name || '[removido]').toUpperCase()));
    head.append(el('span', 'st ' + t.status, ST[t.status] || t.status));
    box.append(head);

    const [qr, ar] = await Promise.all([
      sb.from('exam_questions').select('*').order('position').order('id'),
      sb.from('exam_answers').select('*').eq('attempt_id', t.id),
    ]);
    if (qr.error || ar.error) {
      box.append(el('p', 'empty', '> ' + (qr.error || ar.error).message));
      return;
    }
    const resp = {};
    (ar.data || []).forEach(a => resp[a.question_id] = a);
    // só as questões que a prova de fato cobrou: questão desativada depois da
    // entrega não pode aparecer como se o candidato a tivesse ignorado
    const qs = (qr.data || []).filter(q => resp[q.id]);

    const notas = {};   // question_id -> pontos dados agora
    qs.forEach(q => { if (q.kind === 'dissertativa') notas[q.id] = resp[q.id]?.pontos || 0; });

    const resumo = el('div', 'cor-sum');
    const vObj = el('b', 'v'), vDis = el('b', 'v'), vTot = el('b', 'v');
    [['OBJETIVAS', vObj], ['DISSERTATIVAS', vDis], ['NOTA', vTot]].forEach(([k, v]) => {
      const d = el('div');
      d.append(el('span', 'k', k), v);
      resumo.append(d);
    });
    box.append(resumo);

    const maxObj = qs.filter(q => q.kind === 'objetiva').reduce((s, q) => s + q.points, 0);
    const maxDis = qs.filter(q => q.kind === 'dissertativa').reduce((s, q) => s + q.points, 0);
    const pontosObj = qs.filter(q => q.kind === 'objetiva' && resp[q.id]?.certa).reduce((s, q) => s + q.points, 0);

    const recalcula = () => {
      const dis = Object.values(notas).reduce((s, n) => s + (+n || 0), 0);
      const total = t.pontos_max || (maxObj + maxDis) || 1;
      vObj.textContent = `${pontosObj}/${maxObj}`;
      vDis.textContent = `${dis}/${maxDis}`;
      vTot.textContent = Math.round((pontosObj + dis) * 10000 / total) / 100 + '%';
    };

    qs.forEach((q, i) => {
      const a = resp[q.id];
      const card = el('div', 'q-card');
      const h = el('div', 'q-head');
      h.append(el('span', 'q-num', String(i + 1).padStart(2, '0')));
      h.append(el('span', 'q-kind' + (q.kind === 'dissertativa' ? ' dis' : ''),
        q.kind === 'dissertativa' ? 'DISSERTATIVA' : 'OBJETIVA'));
      h.append(el('span', 'q-pts', q.points + (q.points === 1 ? ' ponto' : ' pontos')));
      card.append(h, el('p', 'q-prompt', q.prompt));

      if (q.kind === 'objetiva') {
        const opts = el('div', 'q-opts');
        (q.options || []).forEach((o, k) => {
          const linha = el('div', 'opt');
          if (o.id === q.correct) linha.classList.add('certa');
          if (o.id === a?.escolha && o.id !== q.correct) linha.classList.add('errada');
          linha.append(el('span', 'letra', (LETRAS[k] || '?') + '.'), el('span', null, o.text));
          const marca = el('span', 'marca');
          if (o.id === q.correct) marca.textContent = 'gabarito';
          if (o.id === a?.escolha) marca.textContent = (o.id === q.correct ? 'marcou · gabarito' : 'marcou');
          linha.append(marca);
          opts.append(linha);
        });
        if (!a?.escolha) opts.append(el('p', 'form-note', 'Deixou em branco.'));
        card.append(opts);
      } else {
        const r = el('div', 'resposta' + (a?.texto ? '' : ' vazia'), a?.texto || 'Deixou em branco.');
        card.append(r);
        const nb = el('div', 'nota-box');
        nb.append(el('span', null, 'Pontos:'));
        const inp = el('input');
        inp.type = 'number'; inp.min = '0'; inp.max = String(q.points);
        inp.value = String(notas[q.id] ?? 0);
        inp.oninput = () => {
          notas[q.id] = Math.max(0, Math.min(q.points, +inp.value || 0));
          recalcula();
        };
        nb.append(inp, el('span', null, 'de ' + q.points));
        card.append(nb);
      }
      box.append(card);
    });

    const parecer = el('textarea');
    parecer.rows = 3;
    parecer.placeholder = 'Parecer do comando — o candidato vai ler isto.';
    parecer.value = t.parecer || '';
    const lbl = el('label', 'fld');
    lbl.append(el('span', null, 'PARECER'), parecer);
    box.append(lbl);

    const foot = el('div', 'prova-foot');
    foot.append(el('span', 'form-note', `Nota de corte: ${cfg.min_percent}%. O veredito é seu, não da conta.`));

    const mandar = async aprovar => {
      const quem = t.profiles?.name || 'o candidato';
      if (!confirma(aprovar
        ? `Aprovar ${quem}? A conta vira OFICIAL e os informes abrem na hora.`
        : `Reprovar ${quem}?`)) return;
      const notasArr = Object.entries(notas).map(([q, pontos]) => ({ q, pontos: +pontos || 0 }));
      const { error } = await sb.rpc('corrigir_prova', {
        p_attempt: t.id, p_notas: notasArr, p_aprovar: aprovar, p_parecer: parecer.value.trim(),
      });
      if (error) return toast(error.message, true);
      window.FX?.som[aprovar ? 'permitido' : 'falha']();
      toast(aprovar ? `${quem} aprovado.` : `${quem} reprovado.`);
      await carrega();
      drawChannels();
      abreCorrecao();
    };

    const rep = el('button', 'ghost danger', '✕ REPROVAR');
    rep.onclick = () => mandar(false);
    const apr = el('button', 'primary', '✔ APROVAR');
    apr.onclick = () => mandar(true);
    foot.append(rep, apr);

    if (t.status !== 'aguardando') {
      const nova = el('button', 'ghost', '↺ Liberar nova tentativa');
      nova.onclick = async () => {
        if (!confirma('Arquivar esta prova e liberar uma nova tentativa?')) return;
        const { error } = await sb.rpc('liberar_nova_tentativa', { target: t.profile_id });
        if (error) return toast(error.message, true);
        toast('Nova tentativa liberada.');
        await carrega();
        drawChannels();
        abreCorrecao();
      };
      foot.append(nova);
    }
    box.append(foot);
    recalcula();
  }

  // ---------------------------------------------------------------- montar
  async function abreBanco() {
    const root = $('#exame');
    root.innerHTML = '';
    if (!isStaff()) { root.append(el('p', 'empty', '> acesso restrito ao comando.')); return; }

    const box = el('div', 'pane-scroll');
    root.append(box);

    const head = el('header', 'pane-head');
    head.append(el('h3', null, 'BANCO DE QUESTÕES'));
    const nova = el('button', 'primary sm', '+ NOVA QUESTÃO');
    nova.onclick = () => questaoForm(null);
    head.append(nova);
    box.append(head);

    if (isAdmin()) {
      const ajustes = el('button', 'ghost', '⚙ Nota de corte e abertura');
      ajustes.onclick = configForm;
      box.append(ajustes);
    }

    const { data, error } = await sb.from('exam_questions').select('*').order('position').order('created_at');
    if (error) { box.append(el('p', 'empty', '> ' + error.message)); return; }

    const ativas = (data || []).filter(q => q.active);
    box.append(el('p', 'pane-note',
      `${ativas.length} questão(ões) valendo, somando ${ativas.reduce((s, q) => s + q.points, 0)} ponto(s). `
      + `Nota de corte: ${cfg.min_percent}%. Questão desativada some da prova sem apagar o histórico de quem já respondeu.`));

    if (!data?.length) { box.append(el('p', 'empty', '> nenhuma questão ainda. Comece pelo botão acima.')); return; }

    const lista = el('div', 'q-lista');
    data.forEach((q, i) => lista.append(linhaQuestao(q, i, data)));
    box.append(lista);
  }

  function linhaQuestao(q, i, todas) {
    const row = el('div', 'q-row' + (q.active ? '' : ' off'));
    row.append(el('span', 'q-num', String(i + 1).padStart(2, '0')));
    row.append(el('span', 'txt', MD.plain(q.prompt)));
    row.append(el('span', 'q-kind' + (q.kind === 'dissertativa' ? ' dis' : ''),
      q.kind === 'dissertativa' ? 'DISSERTATIVA' : 'OBJETIVA'));
    row.append(el('span', 'cor-data', q.points + ' pt'));

    const acts = el('span', 'q-acts');
    const b = (txt, fn, cls) => { const x = el('button', 'ghost' + (cls ? ' ' + cls : ''), txt); x.onclick = fn; acts.append(x); };
    if (i > 0) b('▲', () => troca(todas, i, i - 1));
    if (i < todas.length - 1) b('▼', () => troca(todas, i, i + 1));
    b(q.active ? '◉ valendo' : '○ fora', async () => {
      const { error } = await sb.from('exam_questions').update({ active: !q.active }).eq('id', q.id);
      if (error) return toast(error.message, true);
      abreBanco();
    });
    b('✎', () => questaoForm(q));
    b('✕', async () => {
      if (!confirma('Excluir esta questão? As respostas já dadas a ela somem junto.')) return;
      const { error } = await sb.from('exam_questions').delete().eq('id', q.id);
      if (error) return toast(error.message, true);
      abreBanco();
    }, 'danger');
    row.append(acts);
    return row;
  }

  /**
   * Troca duas questões de lugar e regrava a numeração inteira. Escrever só as
   * duas posições parece bastar, mas não: questões criadas antes de haver
   * ordem, ou importadas, podem compartilhar a mesma `position` — e aí a troca
   * embaralha em vez de mover. Reescrever 0..n-1 deixa a lista sempre coerente.
   */
  async function troca(todas, a, b) {
    const ordem = todas.slice();
    [ordem[a], ordem[b]] = [ordem[b], ordem[a]];
    for (let i = 0; i < ordem.length; i++) {
      if (ordem[i].position === i) continue;
      const { error } = await sb.from('exam_questions').update({ position: i }).eq('id', ordem[i].id);
      if (error) return toast(error.message, true);
    }
    abreBanco();
  }

  function configForm() {
    const m = modal('NOTA DE CORTE E ABERTURA');
    const intro = field(m.body, 'Texto de abertura', cfg.intro, { area: true, rows: 4 });
    const min = field(m.body, 'Nota de corte (%)', String(cfg.min_percent));
    min.type = 'number'; min.min = '0'; min.max = '100';
    m.body.append(el('p', 'form-note',
      'A nota de corte vale para a correção automática das provas só de objetivas. Onde houver dissertativa, ela é referência: quem aprova é o comando.'));

    const save = el('button', 'primary', 'Salvar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    save.onclick = async () => {
      save.disabled = true;
      const { error } = await sb.from('exam_config').update({
        intro: intro.value.trim(),
        min_percent: Math.max(0, Math.min(100, +min.value || 0)),
        updated_at: new Date().toISOString(),
      }).eq('id', true);
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close();
      await carrega();
      abreBanco();
      toast('Ajustes salvos.');
    };
  }

  function questaoForm(q) {
    const m = modal(q ? 'EDITAR QUESTÃO' : 'NOVA QUESTÃO');

    const kw = el('label', 'fld');
    kw.append(el('span', null, 'Tipo'));
    const kind = el('select');
    [['objetiva', 'Objetiva — alternativas, corrigida na hora'],
     ['dissertativa', 'Dissertativa — texto livre, corrigida pelo comando']].forEach(([v, t]) => {
      const o = el('option', null, t); o.value = v; kind.append(o);
    });
    kind.value = q?.kind || 'objetiva';
    kw.append(kind);
    m.body.append(kw);

    const prompt = field(m.body, 'Enunciado', q?.prompt || '', { area: true, rows: 3, ph: 'O que você faz quando...' });
    const pts = field(m.body, 'Pontos', String(q?.points || 1));
    pts.type = 'number'; pts.min = '1'; pts.max = '100';

    // ---- alternativas ----
    const alts = el('div', 'fld');
    alts.append(el('span', null, 'Alternativas — marque a correta'));
    const caixa = el('div');
    alts.append(caixa);
    const addBtn = el('button', 'ghost sm', '+ alternativa');
    alts.append(addBtn);
    m.body.append(alts);

    let lista = (q?.options || []).map(o => ({ id: o.id, text: o.text }));
    if (!lista.length) lista = [{ id: 'a', text: '' }, { id: 'b', text: '' }];
    let correta = q?.correct || lista[0].id;

    function pinta() {
      caixa.innerHTML = '';
      lista.forEach((o, i) => {
        const row = el('div', 'alt-row');
        const rd = el('input');
        rd.type = 'radio'; rd.name = 'gabarito'; rd.checked = o.id === correta;
        rd.title = 'Esta é a alternativa correta';
        rd.onchange = () => { correta = o.id; };
        const txt = el('input');
        txt.type = 'text';
        txt.value = o.text;
        txt.placeholder = 'texto da alternativa';
        txt.oninput = () => { o.text = txt.value; };
        row.append(rd, el('span', 'letra', (LETRAS[i] || '?') + '.'), txt);
        if (lista.length > 2) {
          const x = el('button', 'ghost danger', '✕');
          x.onclick = () => {
            lista = lista.filter(a => a !== o);
            if (correta === o.id) correta = lista[0].id;
            pinta();
          };
          row.append(x);
        }
        caixa.append(row);
      });
      addBtn.classList.toggle('hide', lista.length >= LETRAS.length);
    }
    addBtn.onclick = () => {
      // a letra vem da posição, mas o id tem de ser estável: ele é o que fica
      // gravado na resposta de quem já fez a prova
      const usados = new Set(lista.map(o => o.id));
      const livre = 'abcde'.split('').find(c => !usados.has(c)) || 'x' + lista.length;
      lista.push({ id: livre, text: '' });
      pinta();
    };
    pinta();

    const sync = () => alts.classList.toggle('hide', kind.value !== 'objetiva');
    kind.onchange = sync;
    sync();

    const save = el('button', 'primary', q ? 'Salvar' : 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    prompt.focus();

    save.onclick = async () => {
      const texto = prompt.value.trim();
      if (!texto) { prompt.focus(); return toast('Escreva o enunciado.', true); }
      const objetiva = kind.value === 'objetiva';
      const opcoes = lista.map(o => ({ id: o.id, text: o.text.trim() })).filter(o => o.text);
      if (objetiva) {
        if (opcoes.length < 2) return toast('Uma questão objetiva precisa de ao menos duas alternativas.', true);
        if (!opcoes.some(o => o.id === correta)) return toast('Marque qual alternativa é a correta.', true);
      }

      const row = {
        kind: kind.value,
        prompt: texto,
        points: Math.max(1, Math.min(100, +pts.value || 1)),
        options: objetiva ? opcoes : [],
        correct: objetiva ? correta : null,
      };
      save.disabled = true;
      let error;
      if (q) ({ error } = await sb.from('exam_questions').update(row).eq('id', q.id));
      else {
        const { count } = await sb.from('exam_questions').select('id', { count: 'exact', head: true });
        row.position = count || 0;
        ({ error } = await sb.from('exam_questions').insert(row));
      }
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close();
      abreBanco();
    };
  }

  window.PROVA = {
    carrega, realtime, abre, abreCorrecao, abreBanco,
    pendentes: () => pendentesN,
    // Quem já fez a prova continua alcançando o resultado depois de aprovado:
    // o parecer do comando é dele, e sumir com ele junto com a promoção seria
    // esconder justamente a resposta que ele estava esperando.
    temTentativa: () => !!minha,
  };
})();
