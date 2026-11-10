/* ===========================================================================
   lixeira.js — o que foi apagado nos últimos 30 dias, e o botão de voltar.
   Só aparece para quem está em `lixeira_acesso` no banco (Hermes e Nemesis).
   Quem guarda as cópias é o banco (gatilho guarda_na_lixeira), e quem
   restaura também (restaura_lixeira): aqui só se lê e se pede.

   O banco agrupa por transação (`lote`). O site apaga um canal em três
   pedidos seguidos (operações, mensagens, o canal), então aqui os lotes da
   mesma pessoa com poucos segundos de distância viram um evento só, e o
   RESTAURAR leva todos juntos.
   =========================================================================== */
(() => {
  const DIAS = 30;
  const JUNTA_MS = 10_000;

  // Tabela → [singular, plural]. As "menores" são ajuste de bastidor (apagar e
  // regravar apelidos, membros, posições na teia): ficam escondidas por padrão.
  const NOMES = {
    operations:        ['operação', 'operações'],
    operation_entries: ['relato', 'relatos'],
    messages:          ['mensagem', 'mensagens'],
    channels:          ['canal', 'canais'],
    categories:        ['categoria', 'categorias'],
    entities:          ['entidade', 'entidades'],
    entity_operations: ['entidade ligada a operação', 'entidades ligadas a operações'],
    links:             ['vínculo da teia', 'vínculos da teia'],
    entity_aliases:    ['apelido', 'apelidos'],
    category_members:  ['acesso à categoria', 'acessos à categoria'],
    channel_members:   ['acesso ao canal', 'acessos ao canal'],
    category_locks:    ['trava de categoria', 'travas de categoria'],
    channel_locks:     ['trava de canal', 'travas de canal'],
    node_positions:    ['posição na teia', 'posições na teia'],
    auto_connections:  ['conexão entre operações', 'conexões entre operações'],
  };
  const PRINCIPAIS = ['channels', 'categories', 'operations', 'operation_entries',
                      'entities', 'entity_operations', 'links', 'messages'];

  const LX = { pode: false };
  let menores = false;
  const titulos = { op: {}, ent: {}, ch: {} };

  const quando = t => new Date(t).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const corta = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const nome = (t, n) => (NOMES[t] || [t, t])[n === 1 ? 0 : 1];
  const quem = id => id ? (people[id]?.codename || 'conta excluída') : 'sistema';

  LX.prepara = async () => {
    const { data, error } = await sb.rpc('pode_ver_lixeira');
    LX.pode = !error && data === true;
    if (LX.pode) drawChannels();
  };

  // ------------------------------------------------------------- dados
  async function carrega() {
    const { data, error } = await sb.from('lixeira')
      .select('id, lote, tabela, linha, apagado_por, apagado_em, restaurado_em, restaurado_por')
      .order('id', { ascending: false })
      .limit(5000);
    if (error) throw error;
    return data || [];
  }

  /** Lotes → eventos: mesma pessoa, a poucos segundos um do outro. */
  function agrupa(linhas) {
    const lotes = new Map();
    for (const r of linhas) {
      let l = lotes.get(r.lote);
      if (!l) lotes.set(r.lote, l = { lote: r.lote, por: r.apagado_por, t: Infinity, linhas: [] });
      l.linhas.push(r);
      l.t = Math.min(l.t, new Date(r.apagado_em).getTime());
    }
    const ordem = [...lotes.values()].sort((a, b) => b.t - a.t);
    const eventos = [];
    for (const l of ordem) {
      const ult = eventos[eventos.length - 1];
      if (ult && ult.por === l.por && ult.tMin - l.t <= JUNTA_MS) {
        ult.lotes.push(l.lote); ult.linhas.push(...l.linhas); ult.tMin = l.t;
      } else {
        eventos.push({ por: l.por, t: l.t, tMin: l.t, lotes: [l.lote], linhas: [...l.linhas] });
      }
    }
    for (const e of eventos) {
      e.linhas.sort((a, b) => a.id - b.id);
      e.contagem = {};
      e.linhas.forEach(r => e.contagem[r.tabela] = (e.contagem[r.tabela] || 0) + 1);
      e.principal = PRINCIPAIS.find(t => e.contagem[t]);
      e.restaurado = e.linhas.every(r => r.restaurado_em);
      e.parcial = !e.restaurado && e.linhas.some(r => r.restaurado_em);
    }
    return eventos;
  }

  /** Títulos de operações e entidades que as linhas citam só pelo id. */
  async function buscaTitulos(linhas) {
    const ops = new Set(), ents = new Set();
    for (const { tabela: t, linha: l } of linhas) {
      if (t === 'operations') titulos.op[l.id] = l.title;
      if (t === 'entities') titulos.ent[l.id] = l.name;
      if (t === 'channels') titulos.ch[l.id] = l.name;
      if (l.operation_id) ops.add(l.operation_id);
      if (l.entity_id) ents.add(l.entity_id);
      if (t === 'links') [[l.a_kind, l.a_id], [l.b_kind, l.b_id]]
        .forEach(([k, id]) => (k === 'op' ? ops : ents).add(id));
    }
    const faltaOp = [...ops].filter(id => !(id in titulos.op)).slice(0, 300);
    const faltaEnt = [...ents].filter(id => !(id in titulos.ent)).slice(0, 300);
    const [o, e] = await Promise.all([
      faltaOp.length ? sb.from('operations').select('id, title').in('id', faltaOp) : { data: [] },
      faltaEnt.length ? sb.from('entities').select('id, name').in('id', faltaEnt) : { data: [] },
    ]);
    (o.data || []).forEach(r => titulos.op[r.id] = r.title);
    (e.data || []).forEach(r => titulos.ent[r.id] = r.name);
  }

  const tituloOp = id => titulos.op[id] ? `«${titulos.op[id]}»` : 'uma operação';
  const tituloEnt = id => titulos.ent[id] || 'uma entidade';
  const noh = (k, id) => k === 'op' ? tituloOp(id) : tituloEnt(id);
  // Canal que ainda existe sai pelo nome da barra; canal apagado, pelo nome
  // que ficou guardado na lixeira.
  const canal = key => {
    if (key?.startsWith('chan:') && !chans[key.slice(5)] && titulos.ch[key.slice(5)]) return '#' + titulos.ch[key.slice(5)];
    try { const i = chanInfo(key); return (i.icon === '#' ? '#' : '') + i.label; } catch { return key; }
  };

  /** Uma linha legível para cada coisa apagada. */
  function descreve(t, l) {
    switch (t) {
      case 'operations':        return `Operação «${l.title || 'sem título'}»`;
      case 'operation_entries': return `Relato em ${tituloOp(l.operation_id)}` + (l.f_date ? ` · ${l.f_date}` : '') + (l.f_report ? ` — ${corta(l.f_report, 70)}` : '');
      case 'messages':          return `${people[l.author_id]?.codename || '?'} em ${canal(l.channel)}: “${corta(l.body, 80)}”`;
      case 'channels':          return `Canal #${l.name}`;
      case 'categories':        return `Categoria ${l.name}`;
      case 'entities':          return `Entidade ${l.name}` + (l.kind ? ` (${l.kind})` : '');
      case 'entity_operations': return `${tituloEnt(l.entity_id)} tirada de ${tituloOp(l.operation_id)}`;
      case 'links':             return `Vínculo ${noh(l.a_kind, l.a_id)} ⇄ ${noh(l.b_kind, l.b_id)}` + (l.label ? ` · ${l.label}` : '');
      default:                  return nome(t, 1);
    }
  }

  function titulo(e) {
    const t = e.principal;
    if (!t) return 'Ajuste: ' + resumo(e);
    const linhas = e.linhas.filter(r => r.tabela === t);
    if (t === 'messages' && linhas.length > 1) {
      const canais = [...new Set(linhas.map(r => canal(r.linha.channel)))];
      return `${linhas.length} mensagens em ${canais.join(', ')}`;
    }
    if (linhas.length > 1) return `${linhas.length} ${nome(t, 2)}`;
    return descreve(t, linhas[0].linha);
  }

  function resumo(e) {
    return Object.entries(e.contagem)
      .sort((a, b) => PRINCIPAIS.indexOf(b[0]) - PRINCIPAIS.indexOf(a[0]))
      .map(([t, n]) => `${n} ${nome(t, n)}`)
      .join(' · ');
  }

  // ------------------------------------------------------------- tela
  async function open() {
    const m = modal('LIXEIRA · ÚLTIMOS ' + DIAS + ' DIAS');
    m.body.parentElement.classList.add('lx-box');
    m.body.append(el('p', 'empty', '> varrendo a lixeira...'));

    const filtro = el('label', 'lx-filtro');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = menores;
    filtro.append(cb, el('span', null, 'mostrar ajustes menores (apelidos, acessos, posições na teia)'));
    const fechar = el('button', 'ghost', 'Fechar');
    fechar.onclick = m.close;
    m.foot.append(filtro, fechar);

    let eventos;
    const desenha = () => {
      m.body.innerHTML = '';
      const lista = eventos.filter(e => menores || e.principal);
      if (!lista.length) {
        m.body.append(el('p', 'empty', eventos.length
          ? '> só ajustes menores nos últimos ' + DIAS + ' dias. Marque a opção abaixo para ver.'
          : '> nada foi apagado nos últimos ' + DIAS + ' dias.'));
        return;
      }
      lista.forEach(e => m.body.append(cartao(e, recarrega)));
    };
    const recarrega = async () => {
      try {
        const linhas = await carrega();
        await buscaTitulos(linhas);
        eventos = agrupa(linhas);
        desenha();
      } catch (err) {
        m.body.innerHTML = '';
        m.body.append(el('p', 'empty', '> não foi possível abrir a lixeira: ' + err.message));
      }
    };
    cb.onchange = () => { menores = cb.checked; if (eventos) desenha(); };
    await recarrega();
  }

  function cartao(e, recarrega) {
    const box = el('article', 'lx-ev' + (e.restaurado ? ' feito' : '') + (e.principal ? '' : ' menor'));
    const head = el('div', 'lx-head');
    const txt = el('div', 'lx-txt');
    txt.append(el('b', null, titulo(e)));
    const resta = DIAS - Math.floor((Date.now() - e.t) / 86_400_000);
    const meta = `apagado por ${quem(e.por)} · ${quando(e.t)}` +
      (e.restaurado ? '' : ` · some em ${Math.max(resta, 0)} dia${resta === 1 ? '' : 's'}`);
    txt.append(el('small', null, meta));
    if (Object.keys(e.contagem).length > 1 || e.linhas.length > 1) txt.append(el('small', 'lx-resumo', resumo(e)));
    head.append(txt);

    if (e.restaurado) {
      const r = e.linhas.find(x => x.restaurado_em);
      head.append(el('span', 'lx-ok', `✓ restaurado por ${quem(r.restaurado_por)} · ${quando(r.restaurado_em)}`));
    } else {
      const b = el('button', 'primary sm', e.parcial ? 'RESTAURAR O RESTO' : 'RESTAURAR');
      b.onclick = () => restaura(e, b, recarrega);
      head.append(b);
    }
    box.append(head);

    // O que tem dentro, item por item.
    const det = el('details', 'lx-det');
    det.append(el('summary', null, 'ver o que tem dentro'));
    const ul = el('ul');
    e.linhas.filter(r => PRINCIPAIS.includes(r.tabela)).slice(0, 200).forEach(r => {
      const li = el('li', r.restaurado_em ? 'feito' : null, descreve(r.tabela, r.linha));
      li.title = JSON.stringify(r.linha, null, 2);
      ul.append(li);
    });
    const menos = e.linhas.filter(r => !PRINCIPAIS.includes(r.tabela));
    if (menos.length) {
      const c = {};
      menos.forEach(r => c[r.tabela] = (c[r.tabela] || 0) + 1);
      ul.append(el('li', 'lx-aux', '+ ' + Object.entries(c).map(([t, n]) => `${n} ${nome(t, n)}`).join(', ')));
    }
    det.append(ul);
    box.append(det);
    return box;
  }

  async function restaura(e, botao, recarrega) {
    if (!confirm(`Restaurar "${titulo(e)}"?\n\nVolta exatamente como estava, com o mesmo autor e a mesma data.`)) return;
    botao.disabled = true;
    botao.textContent = 'RESTAURANDO...';
    const { data, error } = await sb.rpc('restaura_lixeira', { lotes: e.lotes });
    if (error) {
      botao.disabled = false;
      botao.textContent = 'RESTAURAR';
      return toast('Não foi possível restaurar: ' + error.message, true);
    }
    const voltou = data.restaurados + data.ja_existiam;
    if (data.falharam) {
      console.warn('lixeira: itens que não voltaram', data.erros);
      toast(`${voltou} item(ns) restaurado(s); ${data.falharam} não voltou(aram): ${data.erros[0]?.erro || ''}`, true);
    } else {
      toast(`${voltou} item(ns) restaurado(s).`);
    }
    // Canal e categoria não chegam pelo tempo real da barra: recarrega a árvore.
    if (e.contagem.channels || e.contagem.categories || e.contagem.channel_members || e.contagem.category_members) {
      await loadTree();
      drawChannels();
    }
    window.TEIA?.prepara?.();
    await recarrega();
  }

  LX.open = open;
  window.LIXEIRA = LX;
})();
