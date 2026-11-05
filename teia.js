/* ===========================================================================
   teia.js — a Teia de Vínculos: o quadro de investigação do CIT.

   Duas visões dos mesmos dados, sem duplicar nada:
     · Teia Geral    — tudo que o agente alcança, girando em torno do FUKUROU.
                       Cada operação é um nó ligado a ele; as pessoas, locais
                       e demais entidades se ramificam a partir da operação.
     · Teia por operação — só os nós daquela investigação, com a operação no
                       meio. A aba aparece sozinha quando a operação é criada,
                       porque ela é derivada da lista de operações visíveis.

   Nada aqui filtra sigilo à mão: as quatro consultas saem cruas e o RLS corta
   o que o agente não alcança. O que não vem do banco, não vira nó.
   =========================================================================== */
(() => {
  const TIPO_NO = {
    operacao:    { forma: 'ellipse',         cor: '#45e3ff' },
    pessoa:      { forma: 'ellipse',         cor: '#9b5cff' },
    local:       { forma: 'round-rectangle', cor: '#ffc74d' },
    veiculo:     { forma: 'round-rectangle', cor: '#3d8bff' },
    organizacao: { forma: 'hexagon',         cor: '#00ffd5' },
    informacao:  { forma: 'diamond',         cor: '#7d76b9' },
  };

  const TIPO_VINC = {
    comando:    { cor: '#45e3ff', nome: 'comando' },
    familia:    { cor: '#9b5cff', nome: 'família' },
    local:      { cor: '#ffc74d', nome: 'local / patrimônio' },
    financeiro: { cor: '#37ff8b', nome: 'financeiro' },
    social:     { cor: '#ff5cf0', nome: 'social' },
    outro:      { cor: '#3d8bff', nome: 'outro' },
  };

  const CONF = { confirmado: 'confirmado', provavel: 'provável', suposto: 'suposto' };

  let root = null, cy = null;
  let vista = 'geral';          // 'geral' ou o id da operação
  let selecionado = null;
  let dados = { ops: [], vincs: [], links: [], pos: {}, fotos: {} };
  let carregando = false;

  const chaveVista = () => (vista === 'geral' ? 'geral' : 'op:' + vista);
  const noOp  = id => 'op:' + id;
  const noEnt = id => 'ent:' + id;
  const parte = id => ({ kind: id.slice(0, 3) === 'op:' ? 'op' : 'ent', id: id.slice(id.indexOf(':') + 1) });

  /** Ordem fixa das pontas de um vínculo, para o par não entrar duas vezes. */
  function ordena(a, b) {
    return (a.kind + a.id) <= (b.kind + b.id) ? [a, b] : [b, a];
  }

  // ---------------------------------------------------------------- desenho
  /** Miniatura de quem não tem foto: a sigla dentro do nó, como no quadro. */
  const escapaXml = t => String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function svgSigla(texto, cor) {
    const t = escapaXml((texto || '?').slice(0, 4));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
      `<rect width="80" height="80" fill="#0a0622"/>` +
      `<text x="40" y="40" fill="${cor}" font-family="Chakra Petch,sans-serif" ` +
      `font-size="${t.length > 3 ? 20 : t.length > 2 ? 24 : 30}" font-weight="700" ` +
      `letter-spacing="1" text-anchor="middle" dominant-baseline="central">${t}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function svgCoruja() {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" fill="#0a0622"/>` +
      `<g fill="none" stroke="#9b5cff" stroke-width="2.5" stroke-linejoin="round">` +
      `<path d="M8 6l12 8h24l12-8v26c0 16-10 26-24 26S8 48 8 32z"/>` +
      `<circle cx="22" cy="30" r="8"/><circle cx="42" cy="30" r="8"/></g>` +
      `<circle cx="22" cy="30" r="3.5" fill="#45e3ff"/><circle cx="42" cy="30" r="3.5" fill="#45e3ff"/>` +
      `<path d="M28 40h8l-4 8z" fill="#9b5cff"/></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  const estilo = () => [
    { selector: 'node', style: {
      'label': 'data(nome)',
      'color': '#d8d5ff',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': 9,
      'text-valign': 'bottom',
      'text-margin-y': 6,
      'text-wrap': 'ellipsis',
      'text-max-width': 110,
      'background-color': '#0a0622',
      'background-image': 'data(img)',
      'background-fit': 'cover',
      'border-width': 2,
      'border-color': 'data(cor)',
      'shape': 'data(forma)',
      'width': 'data(tam)',
      'height': 'data(tam)',
      'transition-property': 'opacity, border-width',
      'transition-duration': '140ms',
    } },
    { selector: 'node.fukurou', style: {
      'border-width': 3, 'font-size': 11, 'color': '#45e3ff',
      'text-margin-y': 9, 'font-family': 'Chakra Petch, sans-serif',
    } },
    { selector: 'node.sigiloso', style: { 'border-style': 'double', 'border-color': '#ff2e5f' } },
    { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#fff' } },
    { selector: 'node.foco', style: { 'border-width': 4 } },

    { selector: 'edge', style: {
      'width': 1.4,
      'line-color': 'data(cor)',
      'opacity': .55,
      'curve-style': 'straight',
      'label': 'data(rotulo)',
      'font-size': 7,
      'color': '#7d76b9',
      'text-background-color': '#04020c',
      'text-background-opacity': .8,
      'text-background-padding': 2,
      'transition-property': 'opacity, width',
      'transition-duration': '140ms',
    } },
    // Suposto é tracejado, provável é pontilhado curto, confirmado é cheio:
    // o nível de confiança tem que se ler sem clicar em nada.
    { selector: 'edge[conf = "suposto"]',  style: { 'line-style': 'dashed', 'opacity': .32 } },
    { selector: 'edge[conf = "provavel"]', style: { 'line-style': 'dotted' } },
    // A conexão que o sistema achou sozinha: a entidade está em mais de uma
    // operação. Fica tracejada e mais viva, para destoar do vínculo digitado.
    { selector: 'edge.compartilhado', style: { 'line-style': 'dashed', 'width': 2, 'opacity': .85 } },
    { selector: 'edge.foco', style: { 'width': 2.6, 'opacity': 1 } },

    { selector: '.apagado', style: { 'opacity': .12, 'text-opacity': .12 } },
  ];

  // ----------------------------------------------------------------- dados
  async function carrega() {
    if (carregando) return;
    carregando = true;
    try {
      const [o, eo, ln, ps] = await Promise.all([
        sb.from('operations').select('id,title,channel,status,images,entities_at'),
        sb.from('entity_operations').select('*'),
        sb.from('links').select('*'),
        sb.from('node_positions').select('*'),
      ]);
      dados.ops = o.data || [];
      dados.vincs = eo.data || [];
      dados.links = ln.data || [];
      dados.pos = {};
      (ps.data || []).forEach(p => {
        (dados.pos[p.view_key] = dados.pos[p.view_key] || {})[p.node_kind + ':' + p.node_id] =
          { x: p.x, y: p.y };
      });

      // As entidades: as que estão em alguma operação e as que algum vínculo
      // manual alcança.
      const ids = new Set(dados.vincs.map(v => v.entity_id));
      dados.links.forEach(l => {
        if (l.a_kind === 'ent') ids.add(l.a_id);
        if (l.b_kind === 'ent') ids.add(l.b_id);
      });
      await window.ENT.carregar([...ids]);

      // Uma assinatura só para todas as miniaturas: uma chamada por nó seria
      // uma rajada de requisições a cada vez que a teia abre.
      const caminhos = [];
      [...ids].forEach(id => { const c = window.ENT.cache[id]?.images?.[0]; if (c) caminhos.push(c); });
      dados.fotos = caminhos.length ? await window.ENT.urlsAssinadas([...new Set(caminhos)]) : {};
    } finally {
      carregando = false;
    }
  }

  /** As operações que viram aba na barra lateral. */
  const abas = () => dados.ops.slice().sort((a, b) => a.title.localeCompare(b.title));

  const sigilosa = op => {
    const i = typeof chanInfo === 'function' ? chanInfo(op.channel) : null;
    return !!i?.sigiloso;
  };

  /** Monta nós e arestas da visão atual. Sigilo já veio resolvido do banco. */
  function monta() {
    const nos = [], arestas = [];
    const geral = vista === 'geral';
    const ops = geral ? dados.ops : dados.ops.filter(o => o.id === vista);
    if (!ops.length) return { nos, arestas };

    const idsOps = new Set(ops.map(o => o.id));
    const vincs = dados.vincs.filter(v => idsOps.has(v.operation_id));
    const idsEnts = new Set(vincs.map(v => v.entity_id));

    // Quantas operações visíveis cada entidade tem: 2 ou mais é a conexão que
    // o sistema cria sozinha entre investigações.
    const porEntidade = {};
    dados.vincs.forEach(v => (porEntidade[v.entity_id] = porEntidade[v.entity_id] || new Set())
      .add(v.operation_id));

    if (geral) {
      nos.push({ data: {
        id: 'fukurou', nome: 'FUKUROU', kind: 'fukurou', cor: '#9b5cff',
        forma: 'ellipse', tam: 58, img: svgCoruja(), nivel: 0,
      }, classes: 'fukurou' });
    }

    ops.forEach(o => {
      const cor = TIPO_NO.operacao.cor;
      nos.push({
        data: {
          id: noOp(o.id), nome: o.title, kind: 'operacao', cor,
          forma: TIPO_NO.operacao.forma, tam: geral ? 34 : 40,
          img: svgSigla(window.ENT.sigla(o.title), cor), nivel: 1,
          status: o.status, canal: o.channel,
        },
        classes: sigilosa(o) ? 'sigiloso' : '',
      });
      if (geral) {
        arestas.push({ data: {
          id: 'fk:' + o.id, source: 'fukurou', target: noOp(o.id),
          cor: TIPO_VINC.comando.cor, rotulo: '', tipo: 'comando', conf: 'confirmado',
        } });
      }
    });

    idsEnts.forEach(id => {
      const e = window.ENT.cache[id];
      if (!e) return;
      const t = TIPO_NO[e.kind] || TIPO_NO.pessoa;
      const capa = e.images?.[0] && dados.fotos[e.images[0]];
      nos.push({ data: {
        id: noEnt(id), nome: e.name, kind: e.kind, cor: t.cor, forma: t.forma,
        tam: 28, img: capa || svgSigla(e.abbr || window.ENT.sigla(e.name), t.cor), nivel: 2,
      } });
    });

    vincs.forEach(v => {
      if (!window.ENT.cache[v.entity_id]) return;
      const compartilhada = (porEntidade[v.entity_id]?.size || 0) > 1;
      arestas.push({
        data: {
          id: 'eo:' + v.entity_id + ':' + v.operation_id,
          source: noOp(v.operation_id), target: noEnt(v.entity_id),
          cor: compartilhada ? '#ffc74d' : TIPO_VINC.outro.cor,
          rotulo: v.role || '', tipo: 'operacao', conf: 'confirmado', auto: true,
        },
        classes: compartilhada ? 'compartilhado' : '',
      });
    });

    // Vínculo manual só entra quando as duas pontas estão desenhadas aqui.
    const existe = new Set(nos.map(n => n.data.id));
    dados.links.forEach(l => {
      const a = l.a_kind === 'op' ? noOp(l.a_id) : noEnt(l.a_id);
      const b = l.b_kind === 'op' ? noOp(l.b_id) : noEnt(l.b_id);
      if (!existe.has(a) || !existe.has(b)) return;
      const t = TIPO_VINC[l.type] || TIPO_VINC.outro;
      arestas.push({ data: {
        id: 'ln:' + l.id, source: a, target: b, cor: t.cor,
        rotulo: l.label || '', tipo: l.type, conf: l.confidence, linkId: l.id,
      } });
    });

    return { nos, arestas };
  }

  // ------------------------------------------------------------- a página
  function cria() {
    root = el('section', 'tw hide');
    root.id = 'teia';
    root.setAttribute('aria-label', 'Teia de Vínculos');
    root.innerHTML = `
      <header class="tw-head">
        <h2 class="tw-title">TEIA</h2>
        <span class="tw-sub"></span>
        <div class="tw-tools">
          <button class="ghost tw-volta hide">← VOLTAR À TEIA GERAL</button>
          <button class="ghost tw-acesso hide" title="Quem pode abrir a Teia Geral">ACESSO</button>
        </div>
      </header>
      <div class="tw-stat">
        <span class="tw-cont"></span>
        <span class="tw-dica"></span>
      </div>
      <div class="tw-palco">
        <div class="tw-grafo"></div>
        <aside class="tw-painel hide" aria-label="Dossiê do nó"></aside>
        <div class="tw-legenda"></div>
        <div class="tw-vazio hide"></div>
      </div>`;
    $('#room-body').append(root);

    root.querySelector('.tw-volta').onclick = () => openChannel('teia:geral');
    root.querySelector('.tw-acesso').onclick = painelAcesso;
  }

  function legenda() {
    const box = root.querySelector('.tw-legenda');
    box.innerHTML = '';
    const itens = vista === 'geral'
      ? [['#ffc74d', 'em mais de uma operação'], ['#3d8bff', 'vínculo'],
         ['#45e3ff', 'operação'], ['#9b5cff', 'pessoa']]
      : Object.entries(TIPO_VINC).map(([, v]) => [v.cor, v.nome]);
    itens.forEach(([cor, nome]) => {
      const i = el('span', 'tw-leg');
      const t = el('i');
      t.style.background = cor;
      i.append(t, el('span', null, nome));
      box.append(i);
    });
  }

  function desenha() {
    const { nos, arestas } = monta();
    const palco = root.querySelector('.tw-grafo');
    const vazio = root.querySelector('.tw-vazio');

    root.querySelector('.tw-cont').textContent =
      `NÓS ${nos.length} · VÍNCULOS ${arestas.length}`;
    root.querySelector('.tw-dica').textContent = selecionado
      ? ''
      : 'clique no nó → abre a ficha e destaca os vínculos · duplo clique na operação → abre a aba dela';

    cy?.destroy();
    cy = null;

    if (!nos.length) {
      vazio.classList.remove('hide');
      vazio.innerHTML = '';
      vazio.append(el('p', null, vista === 'geral'
        ? '> nenhuma operação alcançável. A teia se desenha sozinha quando houver dossiê.'
        : '> esta operação ainda não tem entidades vinculadas.'));
      if (vista !== 'geral') {
        const b = el('button', 'ghost', '⇄ converter o dossiê em entidades');
        b.onclick = () => {
          const op = dados.ops.find(o => o.id === vista);
          if (op) window.ENT.revisar(op, () => recarrega());
        };
        vazio.append(b);
      }
      legenda();
      return;
    }
    vazio.classList.add('hide');

    const salvas = dados.pos[chaveVista()] || {};
    const todasSalvas = nos.every(n => n.data.id === 'fukurou' || salvas[n.data.id]);

    cy = cytoscape({
      container: palco,
      elements: { nodes: nos, edges: arestas },
      style: estilo(),
      minZoom: .2,
      maxZoom: 3,
      wheelSensitivity: .22,
      layout: todasSalvas
        ? { name: 'preset', positions: n => salvas[n.id()] || { x: 0, y: 0 }, fit: true, padding: 60 }
        : vista === 'geral'
          ? { name: 'concentric', concentric: n => 3 - (n.data('nivel') ?? 2),
              levelWidth: () => 1, minNodeSpacing: 46, padding: 60, animate: false }
          : { name: 'cose', idealEdgeLength: 110, nodeRepulsion: 9000, padding: 60,
              animate: false, randomize: true },
    });

    // Posição dos que já tinham lugar marcado, mesmo quando outros não têm.
    if (!todasSalvas) {
      cy.nodes().forEach(n => { const p = salvas[n.id()]; if (p) n.position(p); });
      cy.fit(undefined, 60);
      gravaPosicoes(cy.nodes());        // o layout recém-calculado vira o lugar
    }

    cy.on('tap', 'node', e => seleciona(e.target.id()));
    cy.on('tap', evt => { if (evt.target === cy) limpaSelecao(); });
    cy.on('dbltap', 'node', e => {
      const id = e.target.id();
      if (id.startsWith('op:') && vista === 'geral') openChannel('teia:' + id.slice(3));
    });
    cy.on('dragfree', 'node', e => gravaPosicoes(e.target));

    legenda();
    if (selecionado && cy.getElementById(selecionado).length) seleciona(selecionado);
  }

  async function gravaPosicoes(nos) {
    const chave = chaveVista();
    const linhas = [];
    nos.forEach(n => {
      if (n.id() === 'fukurou') return;        // o centro não é linha de banco
      const p = n.position();
      const { kind, id } = parte(n.id());
      linhas.push({ view_key: chave, node_kind: kind, node_id: id,
                    x: Math.round(p.x), y: Math.round(p.y), updated_by: me.id,
                    updated_at: new Date().toISOString() });
      (dados.pos[chave] = dados.pos[chave] || {})[kind + ':' + id] = { x: p.x, y: p.y };
    });
    if (!linhas.length) return;
    const { error } = await sb.from('node_positions').upsert(linhas);
    if (error) console.error('posições:', error);
  }

  // ------------------------------------------------------------ seleção
  function limpaSelecao() {
    selecionado = null;
    cy?.elements().removeClass('apagado foco');
    root.querySelector('.tw-painel').classList.add('hide');
    root.querySelector('.tw-dica').textContent =
      'clique no nó → abre a ficha e destaca os vínculos · duplo clique na operação → abre a aba dela';
  }

  function seleciona(id) {
    const no = cy.getElementById(id);
    if (!no.length) return;
    selecionado = id;

    // Destaca o nó e tudo que sai dele; o resto do grafo esmaece, para a
    // ramificação ficar legível no meio de dezenas de linhas.
    const vizinhos = no.closedNeighborhood();
    cy.elements().addClass('apagado').removeClass('foco');
    vizinhos.removeClass('apagado').addClass('foco');

    const ligacoes = no.connectedEdges();
    root.querySelector('.tw-dica').textContent =
      `nó selecionado: ${no.data('nome')} · ${ligacoes.length} vínculo(s) destacado(s)`;
    painelDoNo(id, ligacoes);
  }

  function painelDoNo(id, ligacoes) {
    const painel = root.querySelector('.tw-painel');
    painel.innerHTML = '';
    painel.classList.remove('hide');

    const head = el('header', 'tw-p-head');
    head.append(el('b', null, '« FICHA DO NÓ'));
    const x = el('button', 'ghost', '✕');
    x.setAttribute('aria-label', 'Fechar');
    x.onclick = limpaSelecao;
    head.append(x);
    painel.append(head);

    const corpo = el('div', 'tw-p-corpo');
    painel.append(corpo);

    if (id === 'fukurou') {
      corpo.append(el('h3', 'tw-p-nome', 'FUKUROU'));
      corpo.append(el('p', 'tw-p-sub', 'centro · todas as operações que você alcança'));
      corpo.append(el('p', 'tw-p-res',
        'Cada operação pendura-se aqui. As pessoas, locais e demais entidades ' +
        'se ramificam a partir da operação em que foram apuradas.'));
      return;
    }

    const { kind, id: uid } = parte(id);
    if (kind === 'op') return fichaOperacao(corpo, uid, ligacoes);
    fichaEntidade(corpo, uid, ligacoes);
  }

  function cabecalho(corpo, { img, nome, sub, sigilo }) {
    const topo = el('div', 'tw-p-topo');
    topo.append(img);
    const txt = el('div');
    txt.append(el('h3', 'tw-p-nome', nome));
    txt.append(el('p', 'tw-p-sub', sub));
    if (sigilo) txt.append(el('p', 'tw-p-sig', '{sigiloso}'));
    topo.append(txt);
    corpo.append(topo);
  }

  /** A lista de relacionamentos, com o tipo alinhado à direita, como no quadro. */
  function relacionamentos(corpo, ligacoes, meuId) {
    const lista = ligacoes;
    corpo.append(el('h4', 'tw-p-h', `RELACIONAMENTOS (${lista.length})`));
    if (!lista.length) {
      corpo.append(el('p', 'tw-p-res', 'nenhum vínculo registrado.'));
      return;
    }
    const box = el('div', 'tw-p-rel');
    lista.forEach(e => {
      const outro = e.source().id() === meuId ? e.target() : e.source();
      const linha = el('button', 'tw-p-rel-l');
      linha.append(el('span', 'n', outro.data('nome')));
      const t = e.data('tipo');
      const rot = e.data('rotulo') || (t === 'operacao' ? 'nesta operação' : TIPO_VINC[t]?.nome || t);
      const marca = el('span', 'k', rot);
      marca.style.color = e.data('cor');
      if (e.data('conf') && e.data('conf') !== 'confirmado') {
        marca.title = 'nível de confiança: ' + (CONF[e.data('conf')] || e.data('conf'));
      }
      linha.append(marca);
      linha.onclick = () => seleciona(outro.id());
      box.append(linha);
    });
    corpo.append(box);
  }

  function fichaOperacao(corpo, opId, ligacoes) {
    const op = dados.ops.find(o => o.id === opId);
    if (!op) return;
    const cor = TIPO_NO.operacao.cor;
    const mini = el('span', 'ent-foto k-operacao');
    mini.append(el('span', 'ent-ini', window.ENT.sigla(op.title)));

    const info = typeof chanInfo === 'function' ? chanInfo(op.channel) : { label: op.channel };
    cabecalho(corpo, {
      img: mini, nome: op.title,
      sub: `OPERAÇÃO · ${op.status === 'encerrada' ? 'encerrada' : 'ativa'} · ${info.label}`,
      sigilo: info.sigiloso,
    });

    relacionamentos(corpo, ligacoes, noOp(opId));

    const pe = el('div', 'tw-p-pe');
    if (vista === 'geral') {
      const abrir = el('button', 'primary sm', `ABRIR ABA ${op.title} →`);
      abrir.onclick = () => openChannel('teia:' + opId);
      pe.append(abrir);
    }
    const dossie = el('button', 'ghost sm', 'ABRIR DOSSIÊ');
    dossie.onclick = async () => {
      await openChannel(op.channel);
      window.OPS?.focus?.(opId);
    };
    pe.append(dossie);
    corpo.append(pe);
  }

  function fichaEntidade(corpo, entId, ligacoes) {
    const e = window.ENT.cache[entId];
    if (!e) return;

    const mini = window.ENT.miniatura(e);
    // As operações desta entidade que ESTE agente alcança. Operação que ele
    // não lê não entrou em `dados.vincs`, então não há o que esconder aqui.
    const minhas = dados.vincs.filter(v => v.entity_id === entId);
    const nomes = minhas.map(v => dados.ops.find(o => o.id === v.operation_id))
      .filter(Boolean);
    const papel = minhas.find(v => v.role)?.role;

    cabecalho(corpo, {
      img: mini,
      nome: e.name,
      sub: window.ENT.rotuloTipo(e.kind) + (papel ? ' · ' + papel : ''),
      sigilo: nomes.some(sigilosa),
    });

    if (e.images?.length > 1) {
      const gal = el('div', 'tw-p-gal');
      e.images.slice(0, 4).forEach(p => {
        const cel = el('button', 'ent-foto');
        const img = el('img');
        img.dataset.entPath = p;
        img.alt = e.name;
        cel.append(img);
        cel.onclick = () => { if (img.src) window.open(img.src, '_blank', 'noopener'); };
        gal.append(cel);
      });
      if (e.images.length > 4) gal.append(el('span', 'tw-p-mais', '+' + (e.images.length - 4)));
      corpo.append(gal);
      window.ENT.pintaFotos();
    }

    if (e.summary) {
      const d = el('div', 'tw-p-res md');
      d.append(MD.render(e.summary));
      corpo.append(d);
    }
    window.ENT.apelidos(entId).then(as => {
      if (!as.length) return;
      corpo.insertBefore(el('p', 'tw-p-ape', '“' + as.join('”, “') + '”'),
        corpo.querySelector('.tw-p-h'));
    });

    if (nomes.length) {
      corpo.append(el('h4', 'tw-p-h', `OPERAÇÕES (${nomes.length})`));
      const box = el('div', 'tw-p-ops');
      nomes.forEach(o => {
        const b = el('button', 'tw-p-op' + (sigilosa(o) ? ' sig' : ''));
        b.append(el('span', null, o.title));
        b.onclick = () => openChannel('teia:' + o.id);
        box.append(b);
      });
      corpo.append(box);
      if (nomes.length > 1) {
        corpo.append(el('p', 'tw-p-alerta',
          '⚠ aparece em mais de uma operação — conexão detectada automaticamente.'));
      }
    }

    relacionamentos(corpo, ligacoes, noEnt(entId));

    const pe = el('div', 'tw-p-pe');
    const editar = el('button', 'ghost sm', 'ABRIR FICHA');
    editar.onclick = () => window.ENT.form(e, () => recarrega());
    pe.append(editar);
    corpo.append(pe);
  }

  // ------------------------------------------------- acesso à Teia Geral
  async function painelAcesso() {
    if (!isAdmin()) return;
    const m = modal('QUEM ABRE A TEIA GERAL');
    m.body.append(el('p', 'form-note',
      'ADMIN e MASTER entram sempre. Os demais, só marcados aqui. ' +
      'A concessão abre a página — ela não derruba o sigilo dos canais: ' +
      'lá dentro cada um continua vendo só as operações que já alcançava.'));

    const { data } = await sb.from('teia_geral_access').select('profile_id');
    const tem = new Set((data || []).map(r => r.profile_id));

    const box = el('div', 'membros');
    Object.values(people)
      .filter(p => !['admin', 'master'].includes(p.role))
      .sort((a, b) => a.codename.localeCompare(b.codename))
      .forEach(p => {
        const linha = el('label', 'membro');
        const cx = el('input');
        cx.type = 'checkbox';
        cx.checked = tem.has(p.id);
        cx.onchange = async () => {
          cx.disabled = true;
          const { error } = cx.checked
            ? await sb.from('teia_geral_access').insert({ profile_id: p.id, granted_by: me.id })
            : await sb.from('teia_geral_access').delete().eq('profile_id', p.id);
          cx.disabled = false;
          if (error) { cx.checked = !cx.checked; return toast('Falha: ' + error.message, true); }
          toast(`${p.codename} ${cx.checked ? 'entra' : 'não entra mais'} na Teia Geral.`);
        };
        const ponto = el('span', 'mb-dot');
        ponto.style.background = corDe(p);
        linha.append(cx, ponto, el('span', 'mb-nome', p.codename));
        box.append(linha);
      });
    if (!box.childNodes.length) box.append(el('p', 'empty', '> só há contas de ADMIN.'));
    m.body.append(box);

    const ok = el('button', 'primary', 'Fechar');
    ok.onclick = m.close;
    m.foot.append(ok);
  }

  // ------------------------------------------------------------- abertura
  let podeGeral = false;

  async function confereAcesso() {
    if (isAdmin()) { podeGeral = true; return; }
    const { data } = await sb.from('teia_geral_access').select('profile_id').eq('profile_id', me.id);
    podeGeral = !!(data || []).length;
  }

  async function abre(alvo) {
    if (!root) cria();
    vista = alvo === 'geral' ? 'geral' : alvo;

    if (vista === 'geral' && !podeGeral) {
      root.classList.remove('hide');
      root.querySelector('.tw-title').textContent = 'TEIA';
      root.querySelector('.tw-volta').classList.add('hide');
      root.querySelector('.tw-acesso').classList.add('hide');
      root.querySelector('.tw-sub').textContent = 'acesso restrito';
      root.querySelector('.tw-cont').textContent = '';
      root.querySelector('.tw-dica').textContent = '';
      cy?.destroy(); cy = null;
      root.querySelector('.tw-grafo').innerHTML = '';
      const vazio = root.querySelector('.tw-vazio');
      vazio.classList.remove('hide');
      vazio.innerHTML = '';
      vazio.append(el('p', null,
        '> a Teia Geral é restrita. Peça a um ADMIN para liberar o seu acesso.'));
      return;
    }

    root.classList.remove('hide');
    selecionado = null;
    await carrega();

    const op = vista === 'geral' ? null : dados.ops.find(o => o.id === vista);
    const titulo = root.querySelector('.tw-title');
    const nome = vista === 'geral' ? 'TEIA' : 'TEIA · ' + (op?.title || '?');
    titulo.textContent = nome;
    window.FX?.decodifica?.(titulo, nome, 420);
    root.querySelector('.tw-sub').textContent = vista === 'geral'
      ? 'visão geral · todas as operações' : 'somente nós desta operação';
    root.querySelector('.tw-volta').classList.toggle('hide', vista === 'geral');
    root.querySelector('.tw-acesso').classList.toggle('hide', !(isAdmin() && vista === 'geral'));

    desenha();
  }

  function fecha() {
    if (!root) return;
    root.classList.add('hide');
    cy?.destroy();
    cy = null;
  }

  /** Recarrega sem perder a seleção — usado pelo realtime e pelas edições. */
  async function recarrega() {
    // Fechada, ela ainda recarrega: é da mesma lista que sai a seção de abas
    // da barra lateral, e uma operação nova tem que aparecer lá na hora.
    if (!root || root.classList.contains('hide')) {
      await carrega();
      drawChannels();
      return;
    }
    const guardado = selecionado;
    await carrega();
    desenha();
    if (guardado && cy?.getElementById(guardado).length) seleciona(guardado);
  }

  window.TEIA = {
    open: abre,
    close: fecha,
    recarrega,
    abas,
    podeGeral: () => podeGeral,
    confereAcesso,
    /** Lista as operações para a barra lateral mesmo com a teia fechada. */
    async prepara() {
      await confereAcesso();
      await carrega();
      drawChannels();
    },
    /** Abre a teia já com um nó escolhido — é o destino da notificação. */
    async abrirNo(kind, id) {
      const alvo = kind === 'op' ? id : null;
      if (podeGeral) await openChannel('teia:geral');
      else if (alvo) await openChannel('teia:' + alvo);
      else {
        // Sem Teia Geral: cai na primeira operação daquela entidade que o
        // agente alcança, que é o mais perto que ele pode chegar.
        const v = dados.vincs.find(x => x.entity_id === id);
        if (!v) return toast('Sem acesso a uma operação com este nó.', true);
        await openChannel('teia:' + v.operation_id);
      }
      const no = kind === 'op' ? noOp(id) : noEnt(id);
      if (cy?.getElementById(no).length) { seleciona(no); cy.center(cy.getElementById(no)); }
    },
  };
})();
