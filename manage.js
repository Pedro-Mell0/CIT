/* ===========================================================================
   manage.js — canal ⚙ "Gerenciar usuários" (ADMIN) e criação de
   categorias/canais pelo COMANDO.
   =========================================================================== */
(() => {
  const ROLES = { agent: 'AGENTE', command: 'COMANDO', admin: 'ADMIN' };

  // ---------------------------------------------------------------- usuários
  function open() {
    const root = $('#manage');
    root.innerHTML = '';
    if (!isAdmin()) {
      root.append(el('p', 'empty', '> acesso restrito ao ADMIN.'));
      return;
    }

    const head = el('header', 'mg-head');
    head.append(el('h3', null, 'GERENCIAMENTO DE USUÁRIOS'));
    const add = el('button', 'primary sm', '+ CRIAR CONTA');
    add.onclick = createUser;
    head.append(add);
    root.append(head);

    const table = el('div', 'mg-table');
    const hr = el('div', 'mg-row mg-hr');
    ['CODINOME', 'CARGO', 'DESDE', 'AÇÕES'].forEach(t => hr.append(el('span', null, t)));
    table.append(hr);

    Object.values(people)
      .sort((a, b) => (['admin', 'command', 'agent'].indexOf(a.role) - ['admin', 'command', 'agent'].indexOf(b.role))
        || a.codename.localeCompare(b.codename))
      .forEach(p => table.append(userRow(p)));

    root.append(table);
    root.append(el('p', 'mg-note',
      'COMANDO cria categorias e canais e edita mensagens de qualquer agente. ADMIN faz tudo isso e ainda gerencia contas.'));
  }

  function userRow(p) {
    const row = el('div', 'mg-row');
    const name = el('span', 'mg-name', p.codename);
    name.style.color = `hsl(${hue(p.codename)} 90% 70%)`;
    if (p.id === me.id) name.append(el('em', null, ' (você)'));
    row.append(name);
    row.append(el('span', 'badge r-' + p.role, ROLES[p.role] || p.role));
    row.append(el('span', 'mg-date', p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—'));

    const acts = el('span', 'mg-acts');
    const self = p.id === me.id;

    if (!self) {
      if (p.role === 'agent') acts.append(btn('▲ dar COMANDO', () => setRole(p, 'command')));
      if (p.role === 'command') {
        acts.append(btn('▼ tirar COMANDO', () => setRole(p, 'agent')));
        acts.append(btn('★ dar ADMIN', () => setRole(p, 'admin')));
      }
      if (p.role === 'admin') acts.append(btn('▼ tirar ADMIN', () => setRole(p, 'command')));
    }
    acts.append(btn('✎ nome', () => renomear(p)));
    acts.append(btn('⚿ senha', () => resetPass(p)));
    if (!self) acts.append(btn('✕ excluir', () => removeUser(p), 'danger'));
    row.append(acts);
    return row;
  }

  const btn = (label, fn, cls) => {
    const b = el('button', 'ghost' + (cls ? ' ' + cls : ''), label);
    b.onclick = fn;
    return b;
  };

  async function setRole(p, role) {
    if (!confirm(`Definir ${p.codename} como ${ROLES[role]}?`)) return;
    const { error } = await sb.rpc('set_role', { target: p.id, new_role: role });
    if (error) return toast(error.message, true);
    p.role = role;
    open(); drawChannels();
    toast(`${p.codename} agora é ${ROLES[role]}.`);
  }

  async function removeUser(p) {
    if (!confirm(`Excluir a conta de ${p.codename}? Mensagens e canal individual dele serão apagados. Não há volta.`)) return;
    const { error } = await sb.rpc('admin_delete_user', { target: p.id });
    if (error) return toast(error.message, true);
    delete people[p.id];
    open(); drawChannels();
    toast(`Conta de ${p.codename} removida.`);
  }

  function renomear(p) {
    const m = modal('ALTERAR CODINOME · ' + p.codename);
    m.body.append(el('p', 'form-note',
      'O login é derivado do codinome: depois da troca, o agente entra com o nome novo e a mesma senha.'));
    const nome = field(m.body, 'Novo codinome', p.codename, { ph: '3 a 20 caracteres (letras, números e _)' });
    const save = el('button', 'primary', 'Salvar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    nome.focus();
    nome.select();
    save.onclick = async () => {
      const novo = nome.value.trim();
      if (novo === p.codename) return m.close();
      save.disabled = true;
      const { error } = await sb.rpc('set_codename', { target: p.id, new_name: novo });
      save.disabled = false;
      if (error) return toast(error.message, true);
      m.close();
      const antigo = p.codename;
      await loadPeople();
      open(); drawChannels();
      toast(`${antigo} agora é ${novo}.`);
    };
  }

  function resetPass(p) {
    const m = modal('REDEFINIR SENHA · ' + p.codename);
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
    const cn = field(m.body, 'Codinome', '', { ph: '3 a 20 caracteres (letras, números e _)' });
    const pw = field(m.body, 'Senha', '', { ph: 'mínimo de 6 caracteres' });
    pw.type = 'password';
    const wrap = el('label', 'fld');
    wrap.append(el('span', null, 'Cargo'));
    const role = el('select');
    Object.entries(ROLES).forEach(([k, v]) => {
      const o = el('option', null, v); o.value = k; role.append(o);
    });
    wrap.append(role);
    m.body.append(wrap);

    const save = el('button', 'primary', 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    cn.focus();

    save.onclick = async () => {
      save.disabled = true;
      const { error } = await sb.rpc('admin_create_user', {
        p_codename: cn.value.trim(), p_password: pw.value, p_role: role.value,
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
  /** Seletor de acesso: "todos" ou lista de agentes. */
  function accessPicker(parent, { everyone, members, inheritFrom }) {
    const box = el('div', 'access');
    const modeWrap = el('div', 'access-mode');
    const modes = [];
    const initial = inheritFrom ? 'inherit' : everyone ? 'all' : 'some';
    const mk = (val, label) => {
      const b = el('button', 'chip' + (val === initial ? ' on' : ''), label);
      b.dataset.v = val;
      b.onclick = () => { modes.forEach(x => x.classList.remove('on')); b.classList.add('on'); sync(); };
      modes.push(b); modeWrap.append(b);
    };
    if (inheritFrom !== undefined) mk('inherit', 'Herdar da categoria');
    mk('all', 'Todos os agentes');
    mk('some', 'Selecionar agentes');
    box.append(modeWrap);

    const list = el('div', 'access-list');
    const picked = new Set(members || []);
    Object.values(people)
      .sort((a, b) => a.codename.localeCompare(b.codename))
      .forEach(p => {
        const lb = el('label', 'access-item');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = picked.has(p.id);
        cb.dataset.id = p.id;
        cb.onchange = () => cb.checked ? picked.add(p.id) : picked.delete(p.id);
        lb.append(cb, el('span', null, p.codename), el('span', 'badge r-' + p.role, ROLES[p.role]));
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

  function newMenu() {
    const m = modal('CRIAR');
    m.body.append(el('p', 'form-note', 'Categorias agrupam canais. Um canal também pode ficar avulso, fora de qualquer categoria.'));
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
    const name = field(m.body, 'Nome da categoria', cat?.name || '', { ph: 'ex.: OPERAÇÕES EM CURSO' });
    m.body.append(el('h4', 'form-block', 'QUEM TEM ACESSO'));
    const acc = accessPicker(m.body, {
      everyone: cat ? cat.everyone : true,
      members: cat ? [...(catMem[cat.id] || [])] : [me.id],
    });

    const save = el('button', 'primary', cat ? 'Salvar' : 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    if (cat) {
      const del = el('button', 'ghost danger', 'Excluir');
      del.onclick = async () => {
        const inside = Object.values(chans).filter(c => c.category_id === cat.id);
        if (!confirm(`Excluir a categoria "${cat.name}"?` + (inside.length ? ` Os ${inside.length} canal(is) dentro dela viram canais avulsos, mantendo o acesso atual.` : ''))) return;
        // canais que herdavam o acesso passam a ter lista própria, senão sumiriam da barra
        const heirs = inside.filter(c => c.inherit_access);
        if (heirs.length) {
          const mem = [...(catMem[cat.id] || [])];
          for (const c of heirs) {
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
      if (cat) ({ error } = await sb.from('categories').update({ name: nm, everyone: v.everyone }).eq('id', cat.id));
      else {
        const r = await sb.from('categories').insert({ name: nm, everyone: v.everyone, created_by: me.id }).select().single();
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
      save.disabled = false;
      if (error) return toast('Falha ao salvar: ' + error.message, true);
      m.close();
      await loadTree(); drawChannels();
    };
  }

  function channelForm(ch) {
    if (!isStaff()) return;
    const m = modal(ch ? 'EDITAR CANAL' : 'NOVO CANAL');
    const name = field(m.body, 'Nome do canal', ch?.name || '', { ph: 'ex.: vigilancia-porto' });
    const topic = field(m.body, 'Assunto (opcional)', ch?.topic || '', { ph: 'aparece no topo do canal' });

    const cw = el('label', 'fld');
    cw.append(el('span', null, 'Categoria'));
    const sel = el('select');
    const none = el('option', null, '— sem categoria (canal avulso) —');
    none.value = '';
    sel.append(none);
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

    const save = el('button', 'primary', ch ? 'Salvar' : 'Criar');
    const cancel = el('button', 'ghost', 'Cancelar');
    cancel.onclick = m.close;
    m.foot.append(cancel, save);
    if (ch) {
      const del = el('button', 'ghost danger', 'Excluir');
      del.onclick = async () => {
        if (!confirm(`Excluir o canal "${ch.name}"? Todas as mensagens e dossiês dele serão apagados.`)) return;
        const key = 'chan:' + ch.id;
        await sb.from('operations').delete().eq('channel', key);
        await sb.from('messages').delete().eq('channel', key);
        const { error } = await sb.from('channels').delete().eq('id', ch.id);
        if (error) return toast(error.message, true);
        m.close();
        await loadTree();
        openChannel('geral');
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
      const inherit = !!cid && v.inherit;
      const row = { name: nm, topic: topic.value.trim(), category_id: cid, inherit_access: inherit, everyone: !inherit && v.everyone };
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
        if (!inherit && !row.everyone) {
          const ids = new Set([...v.members, me.id]);
          const rows = [...ids].map(pid => ({ channel_id: id, profile_id: pid }));
          ({ error } = await sb.from('channel_members').insert(rows));
        }
      }
      save.disabled = false;
      if (error) return toast('Falha ao salvar: ' + error.message, true);
      m.close();
      await loadTree(); drawChannels();
      if (!ch && id) openChannel('chan:' + id);
    };
  }

  window.MANAGE = {
    open,
    refresh: () => { if (chan === 'manage') open(); },
    newMenu, categoryForm, channelForm,
  };
})();
