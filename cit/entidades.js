/* ===========================================================================
   entidades.js — o cadastro de tudo que a apuração identifica.

   Suspeito, local, veículo, organização e informação deixam de ser texto
   digitado dentro do dossiê e passam a ser linha com id próprio. O mesmo
   homem citado em três operações é uma entidade só, com os três vínculos —
   e é disso que a Teia de Vínculos é desenhada.

   Aqui vivem: o cadastro, o seletor que substitui os campos de texto do
   dossiê, o aviso de possível duplicata e a tela que converte os dossiês
   antigos sem perder o que já estava escrito.
   =========================================================================== */
(() => {
  const BUCKET = 'entidades';
  const MAX_MB = 8;

  const TIPOS = [
    ['pessoa',      'PESSOA'],
    ['local',       'LOCAL'],
    ['veiculo',     'VEÍCULO'],
    ['organizacao', 'ORGANIZAÇÃO'],
    ['informacao',  'INFORMAÇÃO'],
  ];
  const rotuloTipo = k => (TIPOS.find(t => t[0] === k) || TIPOS[0])[1];

  // Os cinco campos do dossiê que deixam de ser texto livre. A ordem é a que
  // eles têm na tela, para a conversão sair na mesma sequência.
  const SLOTS = [
    ['place',    'Local',       'local'],
    ['suspects', 'Suspeitos',   'pessoa'],
    ['agents',   'Agentes',     'pessoa'],
    ['witnesses','Testemunhas', 'pessoa'],
    ['victims',  'Vítimas',     'pessoa'],
  ];
  const campoDoSlot = { place: 'f_place', suspects: 'f_suspects', agents: 'f_agents',
                        witnesses: 'f_witnesses', victims: 'f_victims' };

  const cache = {};   // id -> entidade já lida

  /** Sigla do nó no grafo: iniciais quando há mais de uma palavra, senão as
      três primeiras letras. É só o palpite inicial — o cadastro deixa trocar. */
  function sigla(nome) {
    const ps = (nome || '').trim().split(/\s+/).filter(p => p.length > 1);
    if (ps.length > 1) return ps.slice(0, 3).map(p => p[0]).join('').toUpperCase();
    return (ps[0] || nome || '?').slice(0, 3).toUpperCase();
  }

  // ---------- fotos ----------
  // Bucket próprio e privado, servido por URL assinada de 1 hora, como os
  // anexos das operações. Quem não enxerga a entidade não abre a foto dela
  // nem com o endereço na mão: quem decide é a policy, no banco.
  async function urlsAssinadas(paths) {
    const mapa = {};
    if (!paths.length) return mapa;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (error) { console.error('fotos:', error); return mapa; }
    (data || []).forEach(d => { if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl; });
    return mapa;
  }

  /** Preenche as fotos já desenhadas que ainda estão sem endereço. */
  async function pintaFotos() {
    const imgs = [...document.querySelectorAll('img[data-ent-path]:not([src])')];
    if (!imgs.length) return;
    const mapa = await urlsAssinadas([...new Set(imgs.map(i => i.dataset.entPath))]);
    imgs.forEach(i => {
      const u = mapa[i.dataset.entPath];
      if (u) i.src = u; else i.closest('.ent-foto')?.classList.add('quebrado');
    });
  }

  /** Miniatura quadrada de uma entidade, ou a inicial quando não há foto. */
  function miniatura(ent, cls) {
    const box = el('span', 'ent-foto ' + (cls || '') + ' k-' + (ent?.kind || 'pessoa'));
    const p = ent?.images?.[0];
    if (p) {
      const img = el('img');
      img.dataset.entPath = p;
      img.alt = ent.name;
      img.loading = 'lazy';
      box.append(img);
    } else {
      box.append(el('span', 'ent-ini', ent?.abbr || sigla(ent?.name || '?')));
    }
    return box;
  }

  /**
   * Campo de imagens do cadastro. Os arquivos só sobem ao salvar, então
   * fechar o formulário não deixa lixo no armazenamento.
   */
  function fotosField(m, iniciais) {
    m.body.append(el('h4', 'form-block', 'IMAGENS'));
    m.body.append(el('p', 'form-note',
      'A primeira é a miniatura do nó no grafo. Escolha, cole com Ctrl+V ou arraste para cá.'));

    const zona = el('div', 'anexo-zona');
    const grade = el('div', 'anexo-grade');
    const itens = [];

    const escolher = el('button', 'ghost', '+ Anexar imagem');
    const input = el('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.className = 'hide';
    escolher.onclick = () => input.click();
    input.onchange = () => { aceita(input.files); input.value = ''; };

    zona.append(grade, escolher, input);
    m.body.append(zona);

    function desenha() {
      grade.innerHTML = '';
      itens.forEach((it, i) => {
        const cel = el('div', 'anexo' + (i === 0 ? ' capa' : ''));
        const img = el('img');
        if (it.url) img.src = it.url; else img.dataset.entPath = it.path;
        img.alt = 'imagem da entidade';
        const x = el('button', 'anexo-x', '✕');
        x.title = 'Remover';
        x.onclick = () => { itens.splice(i, 1); desenha(); };
        cel.append(img, x);
        if (i > 0) {
          const capa = el('button', 'anexo-capa', '★');
          capa.title = 'Usar como miniatura';
          capa.onclick = () => { itens.unshift(itens.splice(i, 1)[0]); desenha(); };
          cel.append(capa);
        }
        grade.append(cel);
      });
      grade.classList.toggle('hide', !itens.length);
      pintaFotos();
    }

    function aceita(lista) {
      let recusados = 0;
      [...(lista || [])].forEach(f => {
        if (!f || !f.type.startsWith('image/') || f.size > MAX_MB * 1024 * 1024) { recusados++; return; }
        itens.push({ file: f, url: URL.createObjectURL(f) });
      });
      if (recusados) toast(`${recusados} arquivo(s) ignorado(s): só imagens de até ${MAX_MB}MB.`, true);
      desenha();
    }

    const colar = e => {
      if (!document.body.contains(zona)) { document.removeEventListener('paste', colar); return; }
      const fs = [...(e.clipboardData?.items || [])]
        .filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile());
      if (!fs.length) return;
      e.preventDefault();
      aceita(fs);
    };
    document.addEventListener('paste', colar);

    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
    zona.addEventListener('drop', e => {
      e.preventDefault(); zona.classList.remove('sobre'); aceita(e.dataTransfer?.files);
    });

    (iniciais || []).forEach(p => itens.push({ path: p }));
    desenha();

    return {
      async enviar(entId) {
        const paths = [];
        for (const it of itens) {
          if (it.path) { paths.push(it.path); continue; }
          const ext = (it.file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          const nome = `${entId}/${crypto.randomUUID()}.${ext}`;
          const { error } = await sb.storage.from(BUCKET)
            .upload(nome, it.file, { contentType: it.file.type || 'image/png' });
          if (error) throw new Error('Falha ao enviar imagem: ' + error.message);
          paths.push(nome);
        }
        return paths;
      },
    };
  }

  // ---------- dados ----------
  async function buscar(q) {
    const t = (q || '').trim();
    if (t.length < 2) return [];
    const limpo = t.replace(/[,()"\\%]/g, ' ').trim();
    if (!limpo) return [];
    // Duas frentes: o nome da própria entidade e os apelidos. O RLS corta
    // sozinho o que o usuário não alcança — aqui não se filtra sigilo à mão.
    const [porNome, porApelido] = await Promise.all([
      sb.from('entities').select('*').ilike('name', `%${limpo}%`).order('name').limit(12),
      sb.from('entity_aliases').select('entity_id').ilike('alias', `%${limpo}%`).limit(12),
    ]);
    const achadas = porNome.data || [];
    const faltam = (porApelido.data || []).map(r => r.entity_id)
      .filter(id => !achadas.some(e => e.id === id));
    if (faltam.length) {
      const { data } = await sb.from('entities').select('*').in('id', faltam);
      achadas.push(...(data || []));
    }
    achadas.forEach(e => cache[e.id] = e);
    return achadas;
  }

  /** O aviso de duplicata. Devolve nome, apelido e tipo — nunca operação. */
  async function parecidas(nome, ignorar) {
    const { data, error } = await sb.rpc('entidades_parecidas',
      { p_name: nome, p_ignore: ignorar || null });
    if (error) { console.error('duplicatas:', error); return []; }
    return data || [];
  }

  async function carregar(ids) {
    const faltam = [...new Set(ids)].filter(id => id && !cache[id]);
    if (!faltam.length) return;
    const { data } = await sb.from('entities').select('*').in('id', faltam);
    (data || []).forEach(e => cache[e.id] = e);
  }

  async function apelidos(id) {
    const { data } = await sb.from('entity_aliases').select('alias').eq('entity_id', id);
    return (data || []).map(r => r.alias);
  }

  /** As ligações de uma operação, já com as entidades carregadas no cache. */
  async function vinculosDa(opId) {
    if (!opId) return [];
    const { data } = await sb.from('entity_operations').select('*').eq('operation_id', opId);
    const linhas = data || [];
    await carregar(linhas.map(l => l.entity_id));
    return linhas;
  }

  // ---------- cadastro ----------
  function form(ent, aoSalvar, { nomeInicial = '', tipoInicial = 'pessoa' } = {}) {
    const m = modal(ent ? 'EDITAR ENTIDADE' : 'NOVA ENTIDADE');

    m.body.append(el('h4', 'form-block', 'IDENTIFICAÇÃO'));

    const wTipo = el('label', 'fld');
    wTipo.append(el('span', null, 'Tipo'));
    const selTipo = el('select');
    TIPOS.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; selTipo.append(o); });
    selTipo.value = ent?.kind || tipoInicial;
    wTipo.append(selTipo);
    m.body.append(wTipo);

    const nome = field(m.body, 'Nome', ent?.name || nomeInicial, { ph: 'como ele é identificado' });
    const abbr = field(m.body, 'Sigla no grafo', ent?.abbr || '', { ph: 'até 4 letras — em branco, sai do nome' });
    abbr.maxLength = 4;

    // Aviso de duplicata, logo abaixo do nome: é onde a decisão é tomada.
    const aviso = el('div', 'ent-dup hide');
    m.body.append(aviso);

    let usarExistente = null;   // id escolhido no aviso de duplicata
    let timer;
    async function confere() {
      const v = nome.value.trim();
      aviso.classList.add('hide');
      aviso.innerHTML = '';
      usarExistente = null;
      if (v.length < 3) return;
      const cands = await parecidas(v, ent?.id);
      if (!cands.length) return;
      aviso.classList.remove('hide');
      aviso.append(el('b', null, '⚠ Possível duplicata'));
      aviso.append(el('p', 'form-note',
        'Já existe cadastro com nome ou apelido parecido. Usar o que existe mantém ' +
        'um id só para a mesma pessoa — é isso que deixa a teia cruzar as operações.'));
      cands.forEach(c => {
        const linha = el('div', 'ent-dup-l');
        const txt = el('span', 'ent-dup-n', c.name);
        linha.append(el('span', 'ent-dup-k', rotuloTipo(c.kind)), txt);
        if (c.aliases?.length) linha.append(el('span', 'ent-dup-a', '“' + c.aliases.join('”, “') + '”'));
        const usar = el('button', 'ghost sm', 'Usar este');
        usar.onclick = async () => {
          await carregar([c.id]);
          m.close();
          aoSalvar?.(cache[c.id] || { id: c.id, name: c.name, kind: c.kind });
        };
        linha.append(usar);
        aviso.append(linha);
      });
    }
    nome.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(confere, 420); });

    m.body.append(el('h4', 'form-block', 'APELIDOS'));
    m.body.append(el('p', 'form-note',
      'Um por linha. Entram na busca e no aviso de duplicata.'));
    const alias = field(m.body, 'Apelidos / nomes alternativos', '', { area: true });
    alias.rows = 3;
    if (ent) apelidos(ent.id).then(as => { if (!alias.value) alias.value = as.join('\n'); });

    m.body.append(el('h4', 'form-block', 'FICHA'));
    const resumo = field(m.body, 'Resumo', ent?.summary || '',
      { area: true, ph: 'aceita formatação: **negrito**, - tópicos...' });
    const tags = field(m.body, 'Tags', (ent?.tags || []).join(', '), { ph: 'separadas por vírgula' });

    const fotos = fotosField(m, ent?.images);

    const salvar = el('button', 'primary', ent ? 'Salvar' : 'Cadastrar');
    const cancelar = el('button', 'ghost', 'Cancelar');
    cancelar.onclick = m.close;
    m.foot.append(cancelar, salvar);
    nome.focus();
    if (!ent && nomeInicial) confere();

    salvar.onclick = async () => {
      const n = nome.value.trim();
      if (!n) { nome.focus(); return toast('A entidade precisa de um nome.', true); }
      salvar.disabled = true;

      const id = ent?.id || crypto.randomUUID();
      let imagens;
      try { imagens = await fotos.enviar(id); }
      catch (e) { salvar.disabled = false; return toast(e.message, true); }

      const row = {
        kind: selTipo.value,
        name: n,
        abbr: (abbr.value.trim() || sigla(n)).toUpperCase(),
        summary: resumo.value.trim(),
        tags: tags.value.split(',').map(t => t.trim()).filter(Boolean),
        images: imagens,
      };

      let error;
      if (ent) ({ error } = await sb.from('entities').update(row).eq('id', ent.id));
      else {
        row.id = id; row.created_by = me.id;
        ({ error } = await sb.from('entities').insert(row));
      }
      if (error) { salvar.disabled = false; return toast('Falha ao salvar: ' + error.message, true); }

      // Apelidos: apaga e regrava, que é mais simples do que apurar diferença
      // numa lista que nunca passa de um punhado de linhas.
      const lista = alias.value.split('\n').map(a => a.trim()).filter(Boolean);
      await sb.from('entity_aliases').delete().eq('entity_id', id);
      if (lista.length) {
        await sb.from('entity_aliases').insert(
          [...new Set(lista)].map(a => ({ entity_id: id, alias: a })));
      }

      salvar.disabled = false;
      cache[id] = { ...row, id };
      m.close();
      aoSalvar?.(cache[id]);
    };
  }

  // ---------- seletor que substitui o campo de texto ----------
  /**
   * Um campo do dossiê. Em vez de digitar "Zé da Oficina, Tunico", o agente
   * escolhe entidades já cadastradas ou cria na hora. As escolhas ficam
   * guardadas aqui e só vão para o banco em `commit`, porque numa operação
   * nova o id da operação ainda não existe quando o formulário é preenchido.
   */
  function picker(parent, slot, rotulo, tipoPadrao, iniciais) {
    const w = el('div', 'ent-campo');
    w.append(el('span', 'ent-campo-l', rotulo));
    const chips = el('div', 'ent-chips');
    w.append(chips);

    const busca = el('div', 'ent-busca');
    const inp = el('input');
    inp.placeholder = 'buscar entidade ou cadastrar nova...';
    inp.spellcheck = false;
    const res = el('div', 'ent-res hide');
    busca.append(inp, res);
    w.append(busca);
    parent.append(w);

    const itens = (iniciais || []).map(l => ({ entity_id: l.entity_id, role: l.role || '' }));
    const originais = new Set(itens.map(i => i.entity_id));

    function desenha() {
      chips.innerHTML = '';
      itens.forEach((it, i) => {
        const ent = cache[it.entity_id];
        const chip = el('div', 'ent-chip k-' + (ent?.kind || 'pessoa'));
        chip.append(miniatura(ent, 'xs'));
        const nm = el('button', 'ent-chip-n', ent?.name || '[entidade]');
        nm.type = 'button';
        nm.title = 'Abrir o cadastro desta entidade';
        nm.onclick = () => form(ent, atual => { cache[atual.id] = atual; desenha(); });
        chip.append(nm);
        const papel = el('input', 'ent-chip-p');
        papel.value = it.role;
        papel.placeholder = 'papel';
        papel.title = 'Papel nesta operação — vira o rótulo do vínculo na teia';
        papel.oninput = () => { it.role = papel.value; };
        chip.append(papel);
        const x = el('button', 'ent-chip-x', '✕');
        x.type = 'button';
        x.title = 'Desvincular desta operação';
        x.onclick = () => { itens.splice(i, 1); desenha(); };
        chip.append(x);
        chips.append(chip);
      });
      chips.classList.toggle('hide', !itens.length);
      pintaFotos();
    }

    function adiciona(ent) {
      cache[ent.id] = { ...cache[ent.id], ...ent };
      if (itens.some(i => i.entity_id === ent.id)) return toast('Essa entidade já está neste dossiê.', true);
      itens.push({ entity_id: ent.id, role: '' });
      inp.value = '';
      res.classList.add('hide');
      desenha();
    }

    let t;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = inp.value.trim();
        res.innerHTML = '';
        if (q.length < 2) return res.classList.add('hide');
        const achadas = (await buscar(q)).filter(e => !itens.some(i => i.entity_id === e.id));
        res.classList.remove('hide');
        achadas.forEach(e => {
          const b = el('button', 'ent-res-l');
          b.type = 'button';
          b.append(miniatura(e, 'xs'), el('span', 'ent-res-n', e.name),
                   el('span', 'ent-res-k', rotuloTipo(e.kind)));
          b.onclick = () => adiciona(e);
          res.append(b);
        });
        const novo = el('button', 'ent-res-l nova');
        novo.type = 'button';
        novo.append(el('span', 'ent-res-n', `+ cadastrar “${q}” como entidade nova`));
        novo.onclick = () => form(null, adiciona, { nomeInicial: q, tipoInicial: tipoPadrao });
        res.append(novo);
        pintaFotos();
      }, 240);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); res.classList.add('hide'); inp.value = ''; }
    });

    carregar(itens.map(i => i.entity_id)).then(desenha);
    desenha();

    return {
      get itens() { return itens; },
      /** Grava a diferença: o que entrou, o que mudou de papel, o que saiu. */
      async commit(opId) {
        const agora = new Set(itens.map(i => i.entity_id));
        const saiu = [...originais].filter(id => !agora.has(id));
        if (saiu.length) {
          await sb.from('entity_operations').delete()
            .eq('operation_id', opId).in('entity_id', saiu);
        }
        for (const it of itens) {
          const row = { entity_id: it.entity_id, operation_id: opId, slot, role: it.role.trim() };
          if (originais.has(it.entity_id)) {
            await sb.from('entity_operations').update({ slot, role: row.role })
              .eq('operation_id', opId).eq('entity_id', it.entity_id);
          } else {
            row.created_by = me.id;
            const { error } = await sb.from('entity_operations').insert(row);
            if (error && error.code !== '23505') throw new Error('Falha ao vincular: ' + error.message);
          }
        }
      },
    };
  }

  // ---------- conversão do texto livre ----------
  /** Quebra "Zé da Oficina, Tunico; o irmão" nos nomes que ali estavam. */
  function fragmentos(texto) {
    return MD.plain(texto || '')
      .split(/[,;\n]|\s+[·•]\s+|\s+e\s+/i)
      .map(s => s.replace(/^[\s\-–—*>#]+/, '').replace(/[\s.]+$/, '').trim())
      .filter(s => s.length >= 2 && s.length <= 80);
  }

  /**
   * A tela de revisão. Lê o que está escrito no dossiê e nos relatos dele,
   * propõe uma entidade por trecho e deixa o usuário confirmar um por um.
   * Nada é apagado: o texto original só passa a ser recalculado a partir das
   * entidades depois que ele marca a conversão como feita.
   */
  async function revisar(op, aoTerminar) {
    const m = modal('CONVERTER DOSSIÊ EM ENTIDADES');
    m.body.append(el('p', 'form-note',
      `Dossiê “${op.title}”. Cada trecho abaixo saiu do texto que já estava aqui. ` +
      'Confirme o que é entidade de verdade e o que deve ser ignorado. ' +
      'O texto original não é apagado — depois da conversão ele passa a ser ' +
      'reescrito a partir das entidades.'));

    const carregando = el('p', 'form-note', '> lendo o dossiê e os relatos...');
    m.body.append(carregando);

    const { data: relatos } = await sb.from('operation_entries')
      .select('*').eq('operation_id', op.id);
    const jaLigadas = await vinculosDa(op.id);
    carregando.remove();

    // Um trecho pode aparecer no dossiê e repetido em vários relatos: ele vira
    // uma linha só, porque a entidade é uma só.
    const propostas = [];
    SLOTS.forEach(([slot, rotulo, tipo]) => {
      const vindos = [op[campoDoSlot[slot]], ...(relatos || []).map(r => r[campoDoSlot[slot]])];
      const vistos = new Set();
      vindos.forEach(txt => fragmentos(txt).forEach(f => {
        const chave = f.toLowerCase();
        if (vistos.has(chave)) return;
        vistos.add(chave);
        propostas.push({ slot, rotulo, tipo, texto: f, acao: 'nova', ent: null, role: '' });
      }));
    });

    if (jaLigadas.length) {
      m.body.append(el('p', 'form-note',
        `Este dossiê já tem ${jaLigadas.length} entidade(s) vinculada(s); elas não aparecem abaixo.`));
    }

    if (!propostas.length) {
      m.body.append(el('p', 'empty', '> não há texto livre para converter neste dossiê.'));
    }

    const lista = el('div', 'ent-rev');
    m.body.append(lista);

    // Para cada trecho, já consulta o registro: se a pessoa existe, o certo é
    // reaproveitar o cadastro, não criar o segundo.
    propostas.forEach(p => {
      const linha = el('div', 'ent-rev-l');
      const topo = el('div', 'ent-rev-t');
      topo.append(el('span', 'ent-rev-c', p.rotulo));
      topo.append(el('b', 'ent-rev-x', p.texto));
      linha.append(topo);

      const opcoes = el('div', 'ent-rev-o');
      const escolha = el('span', 'ent-rev-e');
      const sel = el('select');
      [['nova', 'criar entidade nova'], ['ignorar', 'ignorar — não é entidade']]
        .forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.append(o); });
      sel.onchange = () => {
        p.acao = sel.value;
        if (sel.value.startsWith('usar:')) { p.acao = 'usar'; p.ent = sel.value.slice(5); }
        linha.classList.toggle('ignorada', sel.value === 'ignorar');
      };
      opcoes.append(sel);

      const papel = el('input', 'ent-rev-p');
      papel.placeholder = 'papel (opcional)';
      papel.oninput = () => { p.role = papel.value; };
      opcoes.append(papel, escolha);
      linha.append(opcoes);
      lista.append(linha);

      parecidas(p.texto).then(cands => {
        if (!cands.length) return;
        cands.forEach(c => {
          const o = el('option', null, `usar o cadastro “${c.name}”`);
          o.value = 'usar:' + c.id;
          sel.insertBefore(o, sel.firstChild);
        });
        sel.value = 'usar:' + cands[0].id;
        p.acao = 'usar'; p.ent = cands[0].id;
        escolha.textContent = '⚠ já existe cadastro parecido';
      });
    });

    const converter = el('button', 'primary', 'Converter dossiê');
    const cancelar = el('button', 'ghost', 'Cancelar');
    cancelar.onclick = m.close;
    m.foot.append(cancelar, converter);

    converter.onclick = async () => {
      converter.disabled = true;
      const aproveitar = propostas.filter(p => p.acao !== 'ignorar');
      try {
        for (const p of aproveitar) {
          let id = p.ent;
          if (p.acao === 'nova' || !id) {
            id = crypto.randomUUID();
            const row = {
              id, kind: p.tipo, name: p.texto, abbr: sigla(p.texto),
              created_by: me.id,
            };
            const { error } = await sb.from('entities').insert(row);
            if (error) throw new Error(error.message);
            cache[id] = row;
          }
          const { error } = await sb.from('entity_operations').insert({
            entity_id: id, operation_id: op.id, slot: p.slot,
            role: (p.role || '').trim(), created_by: me.id,
          });
          if (error && error.code !== '23505') throw new Error(error.message);
        }
        // Só agora o dossiê passa a ter os campos reescritos a partir das
        // entidades: antes disso o gatilho não encosta no texto antigo.
        const { error } = await sb.from('operations')
          .update({ entities_at: new Date().toISOString() }).eq('id', op.id);
        if (error) throw new Error(error.message);
      } catch (e) {
        converter.disabled = false;
        return toast('Falha na conversão: ' + e.message, true);
      }
      converter.disabled = false;
      m.close();
      toast(`${aproveitar.length} entidade(s) vinculada(s) a ${op.title}.`);
      aoTerminar?.();
    };
  }

  window.ENT = {
    TIPOS, SLOTS, campoDoSlot, cache,
    rotuloTipo, sigla, miniatura, pintaFotos,
    buscar, parecidas, carregar, apelidos, vinculosDa,
    urlsAssinadas,
    form, picker, revisar, fragmentos,
  };
})();
