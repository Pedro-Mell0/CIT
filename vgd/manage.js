/* ===========================================================================
   manage.js — painel de contas (ADMIN) e criação de categorias e canais
   (COMANDO e ADMIN).
   =========================================================================== */
(() => {
  const ROLES = { candidato: 'CANDIDATO', oficial: 'OFICIAL', comando: 'COMANDO', admin: 'ADMIN' };
  const ORDEM_CARGO = ['admin', 'comando', 'oficial', 'candidato'];

  // ---------------------------------------------------------------- contas
  function open() {
    const root = $('#manage');
    root.innerHTML = '';
    if (!isAdmin()) {
      root.append(el('p', 'empty', '> acesso restrito ao ADMIN.'));
      return;
    }
    const box = el('div', 'pane-scroll');
    root.append(box);

    const head = el('header', 'pane-head');
    head.append(el('h3', null, 'CONTAS DA UNIDADE'));
    const add = el('button', 'primary sm', '+ CRIAR CONTA');
    add.onclick = createUser;
    head.append(add);
    box.append(head);

    cargosSection(box);

    const table = el('div', 'mg-table');
    const hr = el('div', 'mg-row mg-hr');
    // CREDENCIAL, e não "cargo": cargo virou outra coisa, e chamar as duas
    // pela mesma palavra é pedir confusão na hora de dar acesso a alguém.
    ['NOME DO PERSONAGEM', 'CREDENCIAL', 'DESDE', 'AÇÕES'].forEach(t => hr.append(el('span', null, t)));
    table.append(hr);

    Object.values(people)
      .sort((a, b) => (ORDEM_CARGO.indexOf(a.role) - ORDEM_CARGO.indexOf(b.role))
        || a.name.localeCompare(b.name))
      .forEach(p => table.append(userRow(p)));

    box.append(table);
    box.append(el('p', 'pane-note',
      'CANDIDATO só enxerga a prova. OFICIAL lê os informes liberados. COMANDO corrige provas, '
      + 'monta o banco de questões e cria categorias e canais. ADMIN faz tudo isso e ainda gerencia contas.'));
  }

  // ---------------------------------------------------------------- cargos
  /** Bloco de cargos no alto do painel: criar, renomear, recolorir, excluir. */
  function cargosSection(box) {
    const head = el('header', 'pane-head');
    head.append(el('h3', null, 'CARGOS'));
    const novo = el('button', 'primary sm', '+ NOVO CARGO');
    novo.onclick = () => cargoForm(null);
    head.append(novo);
    box.append(head);

    box.append(el('p', 'pane-note',
      'Cargo é etiqueta: você pendura numa conta e libera canais e categorias para ele inteiro, '
      + 'sem listar pessoa por pessoa. É coisa diferente da credencial — ela é a escada de permissão '
      + '(candidato, oficial, comando, admin) e manda no que cada um pode fazer; o cargo manda em onde entra.'));

    const lista = el('div', 'cargo-lista');
    const todos = Object.values(cargos)
      .sort((a, b) => (a.position - b.position) || a.nome.localeCompare(b.nome));
    if (!todos.length) lista.append(el('p', 'form-note', 'Nenhum cargo criado ainda.'));
    todos.forEach(c => {
      const n = Object.values(cargoMem).filter(s => s.has(c.id)).length;
      const chip = el('button', 'cargo-chip');
      const tag = el('span', 'cargo-tag', c.nome);
      if (c.cor) { tag.style.color = c.cor; tag.style.borderColor = c.cor; }
      chip.append(tag, el('span', 'cargo-n', n + (n === 1 ? ' conta' : ' contas')));
      chip.title = 'Configurar o cargo ' + c.nome;
      chip.onclick = () => cargoForm(c);
      lista.append(chip);
    });
    box.append(lista);
  }

  function cargoForm(c) {
    const m = modal(c ? 'CARGO · ' + c.nome : 'NOVO CARGO');
    const nome = field(m.body, 'Nome do cargo', c?.nome || '', { ph: 'ex.: Instrutor' });
    m.body.append(el('h4', 'form-block', 'COR DA ETIQUETA'));
    const prova = el('p', 'prova-cor', c?.nome || 'Instrutor');
    prova.style.color = c?.cor || PALETA[0];
    m.body.append(prova);
    const cor = paletaPicker(m.body, c?.cor);
    nome.addEventListener('input', () => { prova.textContent = nome.value.trim() || 'Instrutor'; });

    const save = el('button', 'primary', c ? 'Salvar' : 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    if (c) {
      const del = el('button', 'ghost danger', 'Excluir');
      del.onclick = async () => {
        if (!confirma(`Excluir o cargo "${c.nome}"? Ele some das contas que o têm e dos canais liberados por ele. `
          + 'Quem entrava só por este cargo perde o acesso.')) return;
        const { error } = await sb.from('cargos').delete().eq('id', c.id);
        if (error) return toast(error.message, true);
        m.close(); await loadTree(); open(); drawChannels();
      };
      m.foot.prepend(del);
    }
    nome.focus();

    save.onclick = async () => {
      const nm = nome.value.trim();
      if (!nm) { nome.focus(); return toast('Dê um nome ao cargo.', true); }
      save.disabled = true;
      const linha = { nome: nm, cor: cor.value };
      const { error } = c
        ? await sb.from('cargos').update(linha).eq('id', c.id)
        : await sb.from('cargos').insert({ ...linha, position: Object.keys(cargos).length });
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close(); await loadTree(); open(); drawChannels();
    };
  }

  /** Quais cargos esta conta tem. É a tela que o ADMIN usa no dia a dia. */
  function cargosDaConta(p) {
    const m = modal('CARGOS · ' + p.name);
    const todos = Object.values(cargos)
      .sort((a, b) => (a.position - b.position) || a.nome.localeCompare(b.nome));
    if (!todos.length) {
      m.body.append(el('p', 'form-note', 'Nenhum cargo criado ainda. Crie um no alto do painel de contas.'));
      const ok = el('button', 'primary', 'Fechar');
      ok.onclick = m.close;
      m.foot.append(ok);
      return;
    }

    m.body.append(el('p', 'form-note',
      'Marque os cargos desta conta. O acesso aos canais liberados para eles muda na hora, sem precisar recarregar.'));
    const escolhidos = new Set(cargoMem[p.id] || []);
    const list = el('div', 'access-list');
    todos.forEach(c => {
      const lb = el('label', 'access-item');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = escolhidos.has(c.id);
      cb.onchange = () => cb.checked ? escolhidos.add(c.id) : escolhidos.delete(c.id);
      const tag = el('span', 'cargo-tag', c.nome);
      if (c.cor) { tag.style.color = c.cor; tag.style.borderColor = c.cor; }
      lb.append(cb, tag);
      list.append(lb);
    });
    m.body.append(list);

    const save = el('button', 'primary', 'Salvar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);

    save.onclick = async () => {
      save.disabled = true;
      // apaga e regrava: a lista é curta, e assim não há diferença a calcular
      await sb.from('cargo_membros').delete().eq('profile_id', p.id);
      let error = null;
      if (escolhidos.size) {
        ({ error } = await sb.from('cargo_membros')
          .insert([...escolhidos].map(cid => ({ cargo_id: cid, profile_id: p.id }))));
      }
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close(); await loadTree(); open(); drawChannels();
      toast('Cargos de ' + p.name + ' atualizados.');
    };
  }

  /** Caixas de marcar com os cargos, para liberar um canal ou categoria. */
  function cargoPicker(parent, marcados) {
    parent.append(el('h4', 'form-block', 'LIBERAR PARA CARGOS'));
    const todos = Object.values(cargos)
      .sort((a, b) => (a.position - b.position) || a.nome.localeCompare(b.nome));
    if (!todos.length) {
      parent.append(el('p', 'form-note', 'Nenhum cargo criado ainda — crie no painel de contas.'));
      return { get value() { return []; } };
    }
    parent.append(el('p', 'form-note',
      'Quem tiver um destes cargos entra, mesmo fora da lista de acesso acima. É a forma de abrir '
      + 'uma exceção precisa sem promover ninguém.'));
    const escolhidos = new Set(marcados || []);
    const list = el('div', 'access-list');
    todos.forEach(c => {
      const lb = el('label', 'access-item');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = escolhidos.has(c.id);
      cb.onchange = () => cb.checked ? escolhidos.add(c.id) : escolhidos.delete(c.id);
      const tag = el('span', 'cargo-tag', c.nome);
      if (c.cor) { tag.style.color = c.cor; tag.style.borderColor = c.cor; }
      lb.append(cb, tag);
      list.append(lb);
    });
    parent.append(list);
    return { get value() { return [...escolhidos]; } };
  }

  /** Regrava as liberações por cargo de um canal ou categoria. */
  async function salvaCargos(tipo, id, ids) {
    const tabela = tipo === 'cat' ? 'category_cargos' : 'channel_cargos';
    const chave = tipo === 'cat' ? 'category_id' : 'channel_id';
    await sb.from(tabela).delete().eq(chave, id);
    if (!ids.length) return null;
    const { error } = await sb.from(tabela)
      .insert(ids.map(cid => ({ [chave]: id, cargo_id: cid })));
    return error;
  }

  function userRow(p) {
    const row = el('div', 'mg-row');
    const nome = el('span', 'mg-name', p.name);
    nome.style.color = corDe(p);
    if (p.id === me.id) nome.append(el('em', null, ' (você)'));
    etiquetasCargo(nome, p.id);
    row.append(nome);
    row.append(el('span', 'badge r-' + p.role, ROLES[p.role] || p.role));
    row.append(el('span', 'mg-date', p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—'));

    const acts = el('span', 'mg-acts');
    const eu = p.id === me.id;

    if (!eu) {
      if (p.role === 'candidato') acts.append(btn('▲ aprovar direto', () => setRole(p, 'oficial')));
      if (p.role === 'oficial')   acts.append(btn('▲ dar COMANDO', () => setRole(p, 'comando')));
      if (p.role === 'comando') {
        acts.append(btn('▼ tirar COMANDO', () => setRole(p, 'oficial')));
        acts.append(btn('★ dar ADMIN', () => setRole(p, 'admin')));
      }
      if (p.role === 'admin') acts.append(btn('▼ tirar ADMIN', () => setRole(p, 'comando')));
    }
    acts.append(btn('◈ cargos', () => cargosDaConta(p)));
    acts.append(btn('✎ nome/cor', () => renomear(p)));
    acts.append(btn('⚿ senha', () => resetPass(p)));
    if (!eu) acts.append(btn('✕ excluir', () => removeUser(p), 'danger'));
    row.append(acts);
    return row;
  }

  const btn = (label, fn, cls) => {
    const b = el('button', 'ghost' + (cls ? ' ' + cls : ''), label);
    b.onclick = fn;
    return b;
  };

  async function setRole(p, role) {
    if (!confirma(`Definir ${p.name} como ${ROLES[role]}?`)) return;
    const { error } = await sb.rpc('set_role', { target: p.id, new_role: role });
    if (error) return toast(error.message, true);
    p.role = role;
    open(); drawChannels();
    toast(`${p.name} agora é ${ROLES[role]}.`);
  }

  async function removeUser(p) {
    if (!confirma(`Excluir a conta de ${p.name}? Informes e provas dela somem junto. Não há volta.`)) return;
    const { error } = await sb.rpc('admin_delete_user', { target: p.id });
    if (error) return toast(error.message, true);
    delete people[p.id];
    open(); drawChannels();
    toast(`Conta de ${p.name} removida.`);
  }

  function renomear(p) {
    const m = modal('NOME E COR · ' + p.name);
    m.body.append(el('p', 'form-note',
      'O login sai do nome do personagem: depois da troca, a conta entra com o nome novo e a mesma senha.'));
    const nome = field(m.body, 'Nome do personagem', p.name, { ph: '3 a 40 caracteres' });
    m.body.append(el('h4', 'form-block', 'COR'));
    const prova = el('p', 'prova-cor', p.name);
    prova.style.color = corDe(p);
    m.body.append(prova);
    const cor = paletaPicker(m.body, p.color);
    nome.addEventListener('input', () => { prova.textContent = nome.value.trim() || p.name; });

    const save = el('button', 'primary', 'Salvar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    nome.focus();
    nome.select();

    save.onclick = async () => {
      const novo = nome.value.trim();
      const antigo = p.name;
      save.disabled = true;
      if (novo !== antigo) {
        const { error } = await sb.rpc('set_name', { target: p.id, new_name: novo });
        if (error) { save.disabled = false; return toast(error.message, true); }
      }
      if (cor.value !== p.color) {
        const { error } = await sb.rpc('admin_set_color', { target: p.id, new_color: cor.value });
        if (error) { save.disabled = false; return toast(error.message, true); }
      }
      save.disabled = false;
      m.close();
      await loadPeople();
      open(); drawChannels(); pintaMensagens();
      toast(novo !== antigo ? `${antigo} agora é ${novo}.` : 'Cor atualizada.');
    };
  }

  function resetPass(p) {
    const m = modal('REDEFINIR SENHA · ' + p.name);
    const pw = field(m.body, 'Nova senha', '', { ph: 'mínimo de 6 caracteres' });
    pw.type = 'password';
    const save = el('button', 'primary', 'Salvar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    pw.focus();
    save.onclick = async () => {
      save.disabled = true;
      const { error } = await sb.rpc('admin_set_password', { target: p.id, p_password: pw.value });
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close();
      toast('Senha redefinida.');
    };
  }

  function createUser() {
    const m = modal('CRIAR CONTA');
    const nm = field(m.body, 'Nome do personagem', '', { ph: '3 a 40 caracteres' });
    const pw = field(m.body, 'Senha', '', { ph: 'mínimo de 6 caracteres' });
    pw.type = 'password';
    const wrap = el('label', 'fld');
    wrap.append(el('span', null, 'Cargo'));
    const role = el('select');
    Object.entries(ROLES).forEach(([k, v]) => {
      const o = el('option', null, v); o.value = k; role.append(o);
    });
    role.value = 'oficial';
    wrap.append(role);
    m.body.append(wrap);
    m.body.append(el('p', 'form-note',
      'Conta criada aqui já nasce com o cargo escolhido: OFICIAL entra direto nos informes, sem passar pela prova.'));

    const save = el('button', 'primary', 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    nm.focus();

    save.onclick = async () => {
      save.disabled = true;
      const { error } = await sb.rpc('admin_create_user', {
        p_name: nm.value.trim(), p_password: pw.value, p_role: role.value,
      });
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close();
      await loadPeople();
      open(); drawChannels();
      toast('Conta criada.');
    };
  }

  // ------------------------------------------------- categorias e canais
  /** Seletor de acesso: "todos" ou lista de oficiais. */
  function accessPicker(parent, { everyone, members, inheritFrom }) {
    const box = el('div', 'access');
    const modeWrap = el('div', 'access-mode');
    const modes = [];
    const inicial = inheritFrom ? 'inherit' : everyone ? 'all' : 'some';
    const mk = (val, label) => {
      const b = el('button', 'chip' + (val === inicial ? ' on' : ''), label);
      b.dataset.v = val;
      b.onclick = () => { modes.forEach(x => x.classList.remove('on')); b.classList.add('on'); sync(); };
      modes.push(b); modeWrap.append(b);
    };
    if (inheritFrom !== undefined) mk('inherit', 'Herdar da categoria');
    mk('all', 'Todos os oficiais');
    mk('some', 'Selecionar oficiais');
    box.append(modeWrap);

    const list = el('div', 'access-list');
    const picked = new Set(members || []);
    // candidato não entra em lista de acesso nenhuma: ele não lê informe nem
    // que esteja marcado, porque o RLS barra antes
    Object.values(people)
      .filter(p => p.role !== 'candidato')
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(p => {
        const lb = el('label', 'access-item');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = picked.has(p.id);
        cb.onchange = () => cb.checked ? picked.add(p.id) : picked.delete(p.id);
        lb.append(cb, el('span', null, p.name), el('span', 'badge r-' + p.role, ROLES[p.role]));
        list.append(lb);
      });
    box.append(list);
    parent.append(box);

    const mode = () => modeWrap.querySelector('.on')?.dataset.v || 'all';
    const sync = () => list.classList.toggle('hide', mode() !== 'some');
    sync();

    return {
      get value() {
        const md = mode();
        return { inherit: md === 'inherit', everyone: md === 'all', members: [...picked] };
      },
    };
  }

  /** Caixa de marcar com explicação embaixo. */
  function marcador(parent, label, nota, marcado) {
    const lb = el('label', 'access-item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!marcado;
    lb.append(cb, el('span', null, label));
    parent.append(lb);
    if (nota) parent.append(el('p', 'form-note', nota));
    return { get value() { return cb.checked; } };
  }

  /** Trava por código: campo de definir, trocar ou remover. */
  function lockPicker(parent, { locked, alvo }) {
    parent.append(el('h4', 'form-block', '⚿ TRAVA DE ACESSO'));
    parent.append(el('p', 'form-note', locked
      ? `Este ${alvo} está travado. Em branco mantém o código atual; digitar um novo troca o código.`
      : `Código opcional. Com ele, estar na lista de acesso não basta: só abre ${alvo === 'canal' ? 'o canal' : 'a categoria'} quem digitar o código — inclusive COMANDO e ADMIN.`));

    const linha = el('div', 'lock-row');
    const inp = el('input');
    inp.placeholder = locked ? '•••••••• (em branco = manter)' : 'ex.: PIT-9 (em branco = sem trava)';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    linha.append(inp);

    let tirar = false;
    if (locked) {
      const rm = el('button', 'ghost sm danger', '✕ Remover trava');
      rm.onclick = () => {
        tirar = !tirar;
        inp.disabled = tirar;
        if (tirar) inp.value = '';
        rm.textContent = tirar ? '↺ Manter trava' : '✕ Remover trava';
        linha.classList.toggle('tirando', tirar);
      };
      linha.append(rm);
    }
    parent.append(linha);

    return { get value() { return { code: inp.value.trim(), tirar }; } };
  }

  /** Grava a trava depois que a linha já existe. Devolve o erro, se houver. */
  async function salvaTrava(tipo, id, lv) {
    if (!lv.tirar && !lv.code) return null;
    const rpc = tipo === 'cat' ? 'set_category_lock' : 'set_channel_lock';
    const args = tipo === 'cat' ? { cat: id } : { cid: id };
    const { error } = await sb.rpc(rpc, { ...args, code: lv.tirar ? null : lv.code });
    // sem atalho para quem definiu o código: ao entrar, digita como todo mundo
    return error;
  }

  function newMenu() {
    const m = modal('CRIAR');
    m.body.append(el('p', 'form-note',
      'Categorias agrupam canais. Um canal também pode ficar avulso, fora de qualquer categoria.'));
    const a = el('button', 'primary', '▾ Nova categoria');
    const b = el('button', 'primary', '# Novo canal');
    a.onclick = () => { m.close(); categoryForm(null); };
    b.onclick = () => { m.close(); channelForm(null); };
    const row = el('div', 'pick-row');
    row.append(a, b);
    m.body.append(row);
  }

  function categoryForm(cat) {
    if (!isStaff()) return;
    const m = modal(cat ? 'EDITAR CATEGORIA' : 'NOVA CATEGORIA');
    const name = field(m.body, 'Nome da categoria', cat?.name || '', { ph: 'ex.: PERSEGUIÇÕES' });
    m.body.append(el('h4', 'form-block', 'QUEM TEM ACESSO'));
    const acc = accessPicker(m.body, {
      everyone: cat ? cat.everyone : true,
      members: cat ? [...(catMem[cat.id] || [])] : [me.id],
    });
    const cand = marcador(m.body, 'Abrir também a candidatos',
      'Marcada, a categoria fica visível para quem ainda não passou na prova. É assim que o material de estudo chega a eles. Deixe desmarcada em tudo que não pode ser visto antes da aprovação.',
      cat?.candidatos);
    const cargosSel = cargoPicker(m.body, cat ? [...(catCargos[cat.id] || [])] : []);
    const lock = lockPicker(m.body, { locked: !!cat?.locked, alvo: 'categoria' });

    const save = el('button', 'primary', cat ? 'Salvar' : 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    if (cat) {
      const del = el('button', 'ghost danger', 'Excluir');
      del.onclick = async () => {
        const dentro = Object.values(chans).filter(c => c.category_id === cat.id);
        if (!confirma(`Excluir a categoria "${cat.name}"?`
          + (dentro.length ? ` Os ${dentro.length} canal(is) dentro dela viram canais avulsos, mantendo o acesso atual.` : '')
          + (cat.locked ? ' A trava de código some junto: quem tinha acesso passa a entrar sem código.' : ''))) return;
        // canais que herdavam o acesso passam a ter lista própria, senão sumiriam da barra
        const herdeiros = dentro.filter(c => c.inherit_access);
        if (herdeiros.length) {
          const mem = [...(catMem[cat.id] || [])];
          for (const c of herdeiros) {
            await sb.from('channels').update({ inherit_access: false, everyone: cat.everyone }).eq('id', c.id);
            if (!cat.everyone && mem.length) {
              await sb.from('channel_members').delete().eq('channel_id', c.id);
              await sb.from('channel_members').insert(mem.map(pid => ({ channel_id: c.id, profile_id: pid })));
            }
          }
        }
        const { error } = await sb.from('categories').delete().eq('id', cat.id);
        if (error) return toast(error.message, true);
        m.close(); await loadTree(); drawChannels();
      };
      m.foot.prepend(del);
    }
    name.focus();

    save.onclick = async () => {
      const nm = name.value.trim();
      if (!nm) { name.focus(); return toast('Dê um nome à categoria.', true); }
      const v = acc.value;
      save.disabled = true;
      let id = cat?.id, error;
      const linha = { name: nm, everyone: v.everyone, candidatos: cand.value };
      if (cat) ({ error } = await sb.from('categories').update(linha).eq('id', cat.id));
      else {
        const r = await sb.from('categories').insert({ ...linha, created_by: me.id }).select().single();
        error = r.error; id = r.data?.id;
      }
      if (!error && id) {
        await sb.from('category_members').delete().eq('category_id', id);
        if (!v.everyone) {
          const ids = new Set([...v.members, me.id]);
          const rows = [...ids].map(pid => ({ category_id: id, profile_id: pid }));
          ({ error } = await sb.from('category_members').insert(rows));
        }
      }
      if (!error && id) error = await salvaCargos('cat', id, cargosSel.value);
      if (!error && id) error = await salvaTrava('cat', id, lock.value);
      save.disabled = false;
      if (error) return toast('Falha ao salvar: ' + error.message, true);
      m.close();
      await loadTree(); drawChannels();
    };
  }

  function channelForm(ch) {
    if (!isStaff()) return;
    const m = modal(ch ? 'EDITAR CANAL' : 'NOVO CANAL');
    const name = field(m.body, 'Nome do canal', ch?.name || '', { ph: 'ex.: rotas-fuga' });
    const topic = field(m.body, 'Assunto (opcional)', ch?.topic || '', { ph: 'aparece no topo do canal' });

    const cw = el('label', 'fld');
    cw.append(el('span', null, 'Categoria'));
    const sel = el('select');
    const nenhuma = el('option', null, '— sem categoria (canal avulso) —');
    nenhuma.value = '';
    sel.append(nenhuma);
    Object.values(cats).sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
      const o = el('option', null, c.name); o.value = c.id; sel.append(o);
    });
    sel.value = ch?.category_id || '';
    cw.append(sel);
    m.body.append(cw);

    m.body.append(el('h4', 'form-block', 'QUEM TEM ACESSO'));
    const acc = accessPicker(m.body, {
      everyone: ch ? ch.everyone : true,
      members: ch ? [...(chanMem[ch.id] || [])] : [me.id],
      inheritFrom: ch ? ch.inherit_access : false,   // canal novo começa aberto a todos
    });
    const cand = marcador(m.body, 'Abrir também a candidatos',
      'Visível para quem ainda não passou na prova. Herdando o acesso de uma categoria já aberta a candidatos, o canal abre junto sem precisar desta marca.',
      ch?.candidatos);
    const leitura = marcador(m.body, 'Somente leitura',
      'Só COMANDO e ADMIN publicam; o resto lê. É o que usar em canal de material do curso.',
      ch?.somente_leitura);
    const cargosSel = cargoPicker(m.body, ch ? [...(chanCargos[ch.id] || [])] : []);
    const lock = lockPicker(m.body, { locked: !!ch?.locked, alvo: 'canal' });

    const save = el('button', 'primary', ch ? 'Salvar' : 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    if (ch) {
      const del = el('button', 'ghost danger', 'Excluir');
      del.onclick = async () => {
        if (!confirma(`Excluir o canal "${ch.name}"? Todos os informes dele serão apagados.`)) return;
        const key = 'chan:' + ch.id;
        await sb.from('messages').delete().eq('channel', key);
        const { error } = await sb.from('channels').delete().eq('id', ch.id);
        if (error) return toast(error.message, true);
        m.close();
        await loadTree();
        openChannel('mural');
      };
      m.foot.prepend(del);
    }
    name.focus();

    save.onclick = async () => {
      const nm = name.value.trim();
      if (!nm) { name.focus(); return toast('Dê um nome ao canal.', true); }
      const v = acc.value;
      const cid = sel.value || null;
      if (v.inherit && !cid) return toast('Escolha uma categoria para herdar o acesso, ou defina o acesso do canal.', true);
      const herda = !!cid && v.inherit;
      const row = {
        name: nm, topic: topic.value.trim(), category_id: cid,
        inherit_access: herda, everyone: !herda && v.everyone,
        candidatos: cand.value, somente_leitura: leitura.value,
      };
      save.disabled = true;
      let id = ch?.id, error;
      if (ch) ({ error } = await sb.from('channels').update(row).eq('id', ch.id));
      else {
        row.created_by = me.id;
        const r = await sb.from('channels').insert(row).select().single();
        error = r.error; id = r.data?.id;
      }
      if (!error && id) {
        await sb.from('channel_members').delete().eq('channel_id', id);
        if (!herda && !row.everyone) {
          const ids = new Set([...v.members, me.id]);
          const rows = [...ids].map(pid => ({ channel_id: id, profile_id: pid }));
          ({ error } = await sb.from('channel_members').insert(rows));
        }
      }
      if (!error && id) error = await salvaCargos('chan', id, cargosSel.value);
      if (!error && id) error = await salvaTrava('chan', id, lock.value);
      save.disabled = false;
      if (error) return toast('Falha ao salvar: ' + error.message, true);
      m.close();
      await loadTree(); drawChannels();
      if (!ch && id) openChannel('chan:' + id);
    };
  }

  window.MANAGE = {
    open,
    refresh: () => { if (chan === 'contas') open(); },
    newMenu, categoryForm, channelForm,
  };
})();
