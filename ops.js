/* ===========================================================================
   ops.js — dossiês de operação: coluna do dossiê e coluna dos relatos.
   =========================================================================== */
(() => {
  const BLOCKS = [
    { title: 'INFORMAÇÕES', items: [['status', 'Status'], ['f_date', 'Data inicial'], ['f_time', 'Horário'], ['f_place', 'Local'], ['f_nature', 'Natureza da ocorrência']] },
    { title: 'ENVOLVIDOS',  items: [['f_suspects', 'Suspeitos'], ['f_agents', 'Agentes'], ['f_witnesses', 'Testemunhas'], ['f_victims', 'Vítimas']] },
    { title: 'RELATÓRIO',   items: [['f_report', 'Relatório']] },
  ];
  // O relato descreve um fato, não o andamento da operação: não leva status,
  // e a data é a do fato relatado.
  const entryBlocks = () => BLOCKS.map(b => ({
    title: b.title,
    items: b.items.filter(([k]) => k !== 'status').map(([k, l]) => [k, k === 'f_date' ? 'Data' : l]),
  }));
  const KEYS = BLOCKS.flatMap(b => b.items.map(([k]) => k)).filter(k => k !== 'status');
  const statusOf = row => (row?.status === 'encerrada' ? 'encerrada' : 'ativa');
  const stamp = st => el('div', 'op-stamp ' + st, st.toUpperCase());
  const dot = st => el('span', 'op-dot ' + st);
  const LONG = new Set(['f_report', 'f_suspects', 'f_agents', 'f_witnesses', 'f_victims']);

  let curChan = null, ops = [], sel = null, entries = [];

  // ---------- dados ----------
  async function load() {
    if (!curChan || curChan === 'manage') { ops = []; sel = null; entries = []; marcaDossies(false); return draw(); }
    const { data } = await sb.from('operations').select('*').eq('channel', curChan).order('created_at', { ascending: false });
    ops = data || [];
    marcaDossies(ops.length > 0);
    if (sel && !ops.find(o => o.id === sel)) sel = null;
    sel = sel || ops[0]?.id || null;
    await loadEntries();
    draw();
  }

  async function loadEntries() {
    if (!sel) { entries = []; return; }
    const { data } = await sb.from('operation_entries').select('*').eq('operation_id', sel).order('created_at');
    entries = data || [];
  }

  // ---------- desenho ----------
  function draw() {
    $('#ops-count').textContent = ops.length ? `${ops.length} em curso` : '';
    const tabs = $('#ops-tabs'); tabs.innerHTML = '';
    ops.forEach(o => {
      const b = el('button', 'op-tab' + (o.id === sel ? ' on' : ''));
      b.append(dot(statusOf(o)), el('span', null, o.title));
      b.onclick = async () => { sel = o.id; await loadEntries(); draw(); };
      tabs.append(b);
    });
    tabs.classList.toggle('hide', ops.length < 2);

    const body = $('#ops-body'); body.innerHTML = '';
    const op = ops.find(o => o.id === sel);
    if (!op) {
      const e = el('div', 'ops-empty');
      e.append(el('p', null, '> nenhum dossiê aberto neste canal.'));
      const b = el('button', 'primary sm', '⬢ CRIAR OPERAÇÃO');
      b.onclick = create;
      e.append(b);
      body.append(e);
      drawEntries(null);
      return;
    }

    // bloco 1 — título, com a luz de status ao lado
    const st = statusOf(op);
    body.append(stamp(st));
    const row = el('div', 'op-head-row');
    const led = dot(st);
    led.title = st === 'ativa' ? 'operação ativa' : 'operação encerrada';
    const h = el('h2', 'op-title');
    if (window.FX) window.FX.decodifica(h, op.title, 460, true);
    else { h.textContent = op.title; h.dataset.text = op.title; }
    row.append(led, h);
    body.append(row);

    const meta = el('p', 'op-meta');
    meta.textContent = `aberta por ${people[op.created_by]?.codename || '[removido]'} · ${new Date(op.created_at).toLocaleString('pt-BR')}`;
    body.append(meta);

    const bar = el('div', 'op-bar');
    const edit = el('button', 'ghost', '✎ Editar');
    edit.onclick = () => form(op);
    const add = el('button', 'primary sm', '+ ADICIONAR RELATO');
    add.onclick = () => entryForm(null);
    const pdf = el('button', 'ghost', '⎙ PDF');
    pdf.title = 'Exportar dossiê em PDF';
    pdf.onclick = () => exportPdf(op);
    bar.append(edit, add, pdf);
    if (op.created_by === me.id || isStaff()) {
      const del = el('button', 'ghost danger', 'Excluir');
      del.onclick = async () => {
        if (!confirm(`Excluir a operação "${op.title}" e todos os relatos?`)) return;
        const { error } = await sb.from('operations').delete().eq('id', op.id);
        if (error) return toast('Não foi possível excluir: ' + error.message, true);
        sel = null; load();
      };
      bar.append(del);
    }
    body.append(bar);

    // blocos 2 a 4 — todos os rótulos aparecem, mesmo em branco
    BLOCKS.forEach(b => body.append(blockView(b, op, false)));

    if (op.images?.length) {
      const sec = el('section', 'op-block');
      sec.append(el('h4', null, 'ANEXOS'));
      sec.append(anexosView(op.images));
      body.append(sec);
    }

    drawEntries(op);
    pintaAnexos();
  }

  /** Coluna dos relatos: do mais antigo no topo ao mais novo embaixo,
      para que rolar para cima seja voltar no tempo. */
  function drawEntries(op) {
    const box = $('#ent-body');
    box.innerHTML = '';
    $('#ent-count').textContent = entries.length
      ? entries.length + (entries.length === 1 ? ' relato' : ' relatos') : '';
    $('#ent-add').classList.toggle('hide', !op);

    if (!op) {
      box.append(el('p', 'empty', '> nenhuma operação aberta neste canal.'));
      return;
    }
    if (!entries.length) {
      const e = el('div', 'ops-empty');
      e.append(el('p', null, '> sem relatos em ' + op.title + '.'));
      const b = el('button', 'primary sm', '+ ADICIONAR RELATO');
      b.onclick = () => entryForm(null);
      e.append(b);
      box.append(e);
      return;
    }
    box.append(el('div', 'ent-top', '↑ relatos mais antigos'));
    entries.forEach((en, i) => box.append(entryView(en, i + 1)));
    box.scrollTop = box.scrollHeight;     // abre no mais recente
    pintaAnexos();
  }

  function blockView(b, row, onlyFilled) {
    const sec = el('section', 'op-block');
    const filled = b.items.filter(([k]) => (row[k] || '').trim());
    if (onlyFilled && !filled.length) return sec;
    sec.append(el('h4', null, b.title));
    (onlyFilled ? filled : b.items).forEach(([k, label]) => {
      const v = (row[k] || '').trim();
      if (k === 'status') {
        const st = statusOf(row);
        const line = el('div', 'op-line');
        line.append(el('span', 'lbl', 'Status:'));
        const val = el('span', 'op-status ' + st);
        val.append(dot(st), el('b', null, st.toUpperCase()));
        line.append(val);
        sec.append(line);
        return;
      }
      if (k === 'f_report') {
        const d = el('div', 'op-report md');
        if (v) d.append(MD.render(v)); else d.append(el('span', 'blank', '—'));
        sec.append(d);
      } else {
        const line = el('div', 'op-line');
        line.append(el('span', 'lbl', label + ':'));
        const val = el('span', 'val md');
        if (v) val.append(MD.render(v)); else val.classList.add('blank');
        line.append(val);
        sec.append(line);
      }
    });
    return sec;
  }

  function entryView(en, n, noActions) {
    const card = el('article', 'op-entry');
    const head = el('header');
    head.append(el('b', null, 'RELATO #' + String(n).padStart(2, '0')));
    head.append(el('span', 'by', (people[en.created_by]?.codename || '[removido]') + ' · ' +
      new Date(en.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
    if (!noActions && (en.created_by === me.id || isStaff())) {
      const ed = el('button', 'act', '✎');
      ed.title = 'Editar relato';
      ed.onclick = () => entryForm(en);
      const rm = el('button', 'act', '✕');
      rm.title = 'Excluir relato';
      rm.onclick = async () => {
        if (!confirm('Excluir este relato?')) return;
        const { error } = await sb.from('operation_entries').delete().eq('id', en.id);
        if (error) return toast('Não foi possível excluir: ' + error.message, true);
        loadEntries().then(() => draw());
      };
      head.append(ed, rm);
    }
    card.append(head);
    entryBlocks().forEach(b => {
      const sec = blockView(b, en, true);
      if (sec.childNodes.length) card.append(sec);
    });
    if (en.images?.length) card.append(anexosView(en.images));
    if (en.edited_at || en.updated_at !== en.created_at) card.append(el('p', 'op-meta', 'atualizado em ' + new Date(en.updated_at).toLocaleString('pt-BR')));
    return card;
  }

  // ---------- anexos de imagem ----------
  // Bucket privado: nada é servido por URL pública. Cada imagem só aparece
  // depois de uma URL assinada, que o banco só emite a quem enxerga o canal.
  const BUCKET = 'operacoes';
  const MAX_MB = 8;

  async function urlsAssinadas(paths) {
    const mapa = {};
    if (!paths.length) return mapa;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (error) { console.error('anexos:', error); return mapa; }
    (data || []).forEach(d => { if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl; });
    return mapa;
  }

  /** Preenche as imagens já desenhadas que ainda estão sem endereço. */
  async function pintaAnexos() {
    const imgs = [...document.querySelectorAll('img[data-path]:not([src])')];
    if (!imgs.length) return;
    const mapa = await urlsAssinadas([...new Set(imgs.map(i => i.dataset.path))]);
    imgs.forEach(i => {
      const u = mapa[i.dataset.path];
      if (u) i.src = u; else i.closest('.anexo')?.classList.add('quebrado');
    });
  }

  function lightbox(src, legenda) {
    const m = modal(legenda || 'ANEXO');
    const img = el('img', 'anexo-grande');
    img.src = src;
    img.alt = legenda || 'anexo';
    m.body.append(img);
    const abrir = el('button', 'ghost', 'Abrir em nova aba');
    abrir.onclick = () => window.open(src, '_blank', 'noopener');
    const ok = el('button', 'primary', 'Fechar');
    ok.onclick = m.close;
    m.foot.append(abrir, ok);
  }

  /** Grade de miniaturas exibida no dossiê e nos relatos. */
  function anexosView(paths) {
    const grade = el('div', 'anexo-grade');
    (paths || []).forEach(p => {
      const cel = el('button', 'anexo');
      const img = el('img');
      img.dataset.path = p;
      img.alt = 'anexo da operação';
      img.loading = 'lazy';
      cel.append(img);
      cel.onclick = () => { if (img.src) lightbox(img.src); };
      grade.append(cel);
    });
    return grade;
  }

  /**
   * Campo de anexos dos formulários: botão de escolher arquivo, Ctrl+V e
   * arrastar-e-soltar. Os arquivos novos só sobem ao salvar, então cancelar o
   * formulário não deixa lixo no armazenamento.
   */
  function anexosField(m, iniciais) {
    m.body.append(el('h4', 'form-block', 'ANEXOS'));
    const dica = el('p', 'form-note', 'Escolha um arquivo, cole com Ctrl+V ou arraste a imagem para cá.');
    m.body.append(dica);

    const zona = el('div', 'anexo-zona');
    const grade = el('div', 'anexo-grade');
    const itens = [];   // { path } já salvo · { file, url } novo

    const escolher = el('button', 'ghost', '+ Anexar imagem');
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.className = 'hide';
    escolher.onclick = () => input.click();
    input.onchange = () => { aceita(input.files); input.value = ''; };

    zona.append(grade, escolher, input);
    m.body.append(zona);

    function desenha() {
      grade.innerHTML = '';
      itens.forEach((it, i) => {
        const cel = el('div', 'anexo');
        const img = el('img');
        if (it.url) img.src = it.url; else img.dataset.path = it.path;
        img.alt = 'anexo';
        const x = el('button', 'anexo-x', '✕');
        x.title = 'Remover';
        x.onclick = () => { itens.splice(i, 1); desenha(); };
        cel.append(img, x);
        grade.append(cel);
      });
      grade.classList.toggle('hide', !itens.length);
      pintaAnexos();
    }

    function aceita(lista) {
      let recusados = 0;
      [...(lista || [])].forEach(f => {
        if (!f || !f.type.startsWith('image/')) { recusados++; return; }
        if (f.size > MAX_MB * 1024 * 1024) { recusados++; return; }
        itens.push({ file: f, url: URL.createObjectURL(f) });
      });
      if (recusados) toast(`${recusados} arquivo(s) ignorado(s): só imagens de até ${MAX_MB}MB.`, true);
      desenha();
    }

    // Ctrl+V: o evento nasce no campo com foco, então escutamos no documento
    // e nos removemos sozinhos quando o formulário sai da tela.
    const colar = e => {
      if (!document.body.contains(zona)) { document.removeEventListener('paste', colar); return; }
      const arquivos = [...(e.clipboardData?.items || [])]
        .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
        .map(i => i.getAsFile());
      if (!arquivos.length) return;
      e.preventDefault();
      aceita(arquivos);
    };
    document.addEventListener('paste', colar);

    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
    zona.addEventListener('drop', e => {
      e.preventDefault();
      zona.classList.remove('sobre');
      aceita(e.dataTransfer?.files);
    });

    (iniciais || []).forEach(p => itens.push({ path: p }));
    desenha();

    return {
      get itens() { return itens; },
      /** Sobe o que é novo e devolve a lista final de caminhos. */
      async enviar(opId) {
        const paths = [];
        for (const it of itens) {
          if (it.path) { paths.push(it.path); continue; }
          const ext = (it.file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          const nome = `${opId}/${crypto.randomUUID()}.${ext}`;
          const { error } = await sb.storage.from(BUCKET)
            .upload(nome, it.file, { contentType: it.file.type || 'image/png' });
          if (error) throw new Error('Falha ao enviar imagem: ' + error.message);
          paths.push(nome);
        }
        return paths;
      },
    };
  }

  // ---------- exportar em PDF ----------
  // Monta um documento próprio e chama a impressão do navegador ("Salvar como
  // PDF"). O conteúdo sai das mesmas funções que desenham o painel, então o PDF
  // nunca fica defasado em relação à tela, e o texto continua selecionável.
  async function exportPdf(op) {
    document.getElementById('print-root')?.remove();
    const root = el('div');
    root.id = 'print-root';

    const head = el('header', 'p-head');
    head.append(el('span', 'p-brand', 'CIT · DEPARTAMENTO DE POLÍCIA PARALELA'));
    head.append(el('span', 'p-meta',
      'canal: ' + chanInfo(curChan).label + ' · emitido em ' +
      new Date().toLocaleString('pt-BR') + ' por ' + me.codename));
    root.append(head);

    const st = statusOf(op);
    const marca = stamp(st);
    marca.classList.add('p-stamp');
    root.append(marca);
    const row = el('div', 'op-head-row');
    row.append(dot(st));
    const h = el('h2', 'op-title');
    h.dataset.text = op.title;
    h.textContent = op.title;
    row.append(h);
    root.append(row);
    root.append(el('p', 'op-meta',
      `aberta por ${people[op.created_by]?.codename || '[removido]'} · ` +
      `${new Date(op.created_at).toLocaleString('pt-BR')} · ` +
      `última atualização ${new Date(op.updated_at).toLocaleString('pt-BR')}`));

    BLOCKS.forEach(b => root.append(blockView(b, op, false)));
    if (op.images?.length) {
      const sec = el('section', 'op-block');
      sec.append(el('h4', null, 'ANEXOS'));
      sec.append(anexosView(op.images));
      root.append(sec);
    }

    if (entries.length) {
      const sep = el('div', 'op-sep');
      sep.append(el('span', null, 'RELATOS'));
      root.append(sep);
      entries.forEach((en, i) => root.append(entryView(en, i + 1, true)));
    }

    root.append(el('p', 'p-foot',
      'documento gerado pelo sistema CIT · uso interno · não catalogado'));

    document.body.append(root);
    const title = document.title;
    document.title = 'CIT — ' + op.title;   // vira o nome sugerido do arquivo

    let cleaned = false;
    const done = () => {
      if (cleaned) return;
      cleaned = true;
      root.remove();
      document.title = title;
      window.removeEventListener('afterprint', done);
    };
    // Sem esperar as imagens, o navegador imprime os quadros em branco. Mas a
    // espera tem teto: uma imagem que nunca carrega não pode engolir o clique.
    await pintaAnexos();
    const carregando = [...root.querySelectorAll('img')]
      .filter(i => !i.complete)
      .map(i => new Promise(pronto => { i.onload = i.onerror = pronto; }));
    if (carregando.length) {
      await Promise.race([
        Promise.all(carregando),
        new Promise(pronto => setTimeout(pronto, 2500)),
      ]);
    }

    window.addEventListener('afterprint', done);
    window.print();
    done();   // navegadores que não disparam afterprint
  }

  // ---------- formulários ----------
  function statusField(parent, value) {
    const w = el('label', 'fld');
    w.append(el('span', null, 'Status'));
    const s = el('select', 'sel-status');
    [['ativa', 'ATIVA'], ['encerrada', 'ENCERRADA']].forEach(([v, t]) => {
      const o = el('option', null, t); o.value = v; s.append(o);
    });
    s.value = value;
    w.append(s);
    parent.append(w);
    return s;
  }

  function fieldsInto(body, blocks, row = {}) {
    const inputs = {};
    blocks.forEach(b => {
      body.append(el('h4', 'form-block', b.title));
      b.items.forEach(([k, label]) => {
        inputs[k] = k === 'status'
          ? statusField(body, statusOf(row))
          : field(body, label, row[k] || '', { area: LONG.has(k), ph: LONG.has(k) ? 'aceita formatação: **negrito**, - tópicos...' : '' });
      });
    });
    return inputs;
  }

  function create() { form(null); }

  function form(op) {
    const m = modal(op ? 'EDITAR OPERAÇÃO' : 'NOVA OPERAÇÃO');
    m.body.append(el('h4', 'form-block', 'TÍTULO DA OPERAÇÃO'));
    const title = field(m.body, 'Título', op?.title || '', { ph: 'ex.: ECO NEGRO' });
    const inputs = fieldsInto(m.body, BLOCKS, op || {});
    const anexos = anexosField(m, op?.images);

    const save = el('button', 'primary', op ? 'Salvar' : 'Publicar dossiê');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    title.focus();

    save.onclick = async () => {
      const t = title.value.trim();
      if (!t) { title.focus(); return toast('A operação precisa de um título.', true); }
      const row = { title: t, status: inputs.status.value };
      KEYS.forEach(k => row[k] = inputs[k].value.trim());
      save.disabled = true;
      // o id sai daqui para os anexos poderem subir antes do registro existir
      const id = op?.id || crypto.randomUUID();
      try { row.images = await anexos.enviar(id); }
      catch (e) { save.disabled = false; return toast(e.message, true); }

      let error;
      if (op) ({ error } = await sb.from('operations').update(row).eq('id', op.id));
      else {
        row.id = id; row.channel = curChan; row.created_by = me.id;
        ({ error } = await sb.from('operations').insert(row));
      }
      save.disabled = false;
      if (error) return toast('Falha ao salvar: ' + error.message, true);
      m.close();
      sel = id;
      autoCol('dossier'); autoCol('entries');
      load();
    };
  }

  function entryForm(en) {
    if (!sel) return;
    const m = modal(en ? 'EDITAR RELATO' : 'ADICIONAR RELATO');
    m.body.append(el('p', 'form-note', 'Preencha apenas o que for apurado. Campos vazios não aparecem no dossiê.'));
    const inputs = fieldsInto(m.body, entryBlocks(), en || {});
    const anexos = anexosField(m, en?.images);

    const save = el('button', 'primary', en ? 'Salvar' : 'Publicar relato');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);

    save.onclick = async () => {
      const row = {};
      KEYS.forEach(k => row[k] = inputs[k].value.trim());
      if (!KEYS.some(k => row[k]) && !anexos.itens.length) {
        return toast('Preencha ao menos um campo ou anexe uma imagem.', true);
      }
      save.disabled = true;
      try { row.images = await anexos.enviar(sel); }
      catch (e) { save.disabled = false; return toast(e.message, true); }
      let error;
      if (en) ({ error } = await sb.from('operation_entries').update(row).eq('id', en.id));
      else {
        row.operation_id = sel; row.created_by = me.id;
        ({ error } = await sb.from('operation_entries').insert(row));
      }
      save.disabled = false;
      if (error) return toast('Falha ao salvar: ' + error.message, true);
      m.close();
      loadEntries().then(() => draw());
    };
  }

  // ---------- ligações ----------
  $('#op-new').onclick = () => { if (curChan && curChan !== 'manage') create(); };
  $('#ent-add').onclick = () => { if (sel) entryForm(null); };

  window.OPS = {
    setChannel(key) {
      curChan = key;
      sel = null;
      load();
    },
    realtime(table, p) {
      const row = p.new || p.old;
      if (!row) return;
      if (table === 'operations') { if (row.channel === curChan) load(); }
      else if (row.operation_id === sel) loadEntries().then(() => draw());
    },
    async focus(opId) {
      sel = opId;
      autoCol('dossier'); autoCol('entries');
      await load();
      sel = opId;
      await loadEntries();
      draw();
      $('#ops-body').scrollTop = 0;
    },
    has: () => ops.length,
  };
})();
