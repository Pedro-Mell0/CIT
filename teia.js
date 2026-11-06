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
  // Todo nó é redondo. Quem diz o tipo é a cor — da borda e do desenho de
  // dentro. Forma variada só brigava com a moldura circular da miniatura.
  const TIPO_NO = {
    operacao:    { cor: '#45e3ff' },
    pessoa:      { cor: '#9b5cff' },
    local:       { cor: '#ffc74d' },
    veiculo:     { cor: '#3d8bff' },
    organizacao: { cor: '#00ffd5' },
    informacao:  { cor: '#7d76b9' },
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

  // Como a entidade entrou na operação. Vira o rótulo da aresta quando o
  // vínculo não traz um papel escrito — assim `role` fica livre para o que
  // realmente acrescenta ("Capitã", "Dono da Mecânica") em vez de repetir o
  // nome do campo em que a pessoa foi digitada.
  const ROTULO_SLOT = {
    place: 'Localização', suspects: 'Suspeito', agents: 'Agente',
    witnesses: 'Testemunha', victims: 'Vítima',
  };

  let root = null, cy = null;
  let vista = 'geral';          // 'geral' ou o id da operação
  let selecionado = null;
  let dados = { ops: [], vincs: [], links: [], pos: {}, fotos: {}, conexoes: [] };
  let carregando = false;
  // `null` em qualquer um quer dizer "tudo": é o estado de quem nunca mexeu
  // nos filtros, e evita ter de encher três conjuntos a cada carregamento.
  let filtros = { tipos: null, vincs: null, ops: null };
  const filtrando = () => !!(filtros.tipos || filtros.vincs || filtros.ops);

  const chaveVista = () => (vista === 'geral' ? 'geral' : 'op:' + vista);
  const noOp  = id => 'op:' + id;
  const noEnt = id => 'ent:' + id;
  const parte = id => ({ kind: id.slice(0, 3) === 'op:' ? 'op' : 'ent', id: id.slice(id.indexOf(':') + 1) });

  /** Ordem fixa das pontas de um vínculo, para o par não entrar duas vezes. */
  function ordena(a, b) {
    return (a.kind + a.id) <= (b.kind + b.id) ? [a, b] : [b, a];
  }

  // ---------------------------------------------------------------- desenho
  const escapaXml = t => String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const FUNDO = '#0a0622';

  /**
   * Miniatura de quem não tem foto: a coruja do CIT, pintada na cor do tipo.
   * É o símbolo da casa, e vale mais do que um ícone genérico por categoria —
   * o tipo já se lê na cor.
   *
   * Desenho vetorial, e não texto: fonte dentro de data-URI não carrega, o
   * navegador cai numa qualquer e era isso que desenquadrava a sigla no nó.
   * O traço todo cabe num raio de 31 a partir do centro, com folga para a
   * borda do círculo de 80.
   */
  const cacheSvg = {};

  function svgCoruja(cor) {
    if (cacheSvg[cor]) return cacheSvg[cor];
    const c = escapaXml(cor);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">` +
      `<rect width="80" height="80" fill="${FUNDO}"/>` +
      `<g transform="translate(12.5 12.5) scale(.86)">` +
      `<g fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round">` +
      `<path d="M8 6l12 8h24l12-8v26c0 16-10 26-24 26S8 48 8 32z"/>` +
      `<circle cx="22" cy="30" r="8"/><circle cx="42" cy="30" r="8"/></g>` +
      `<circle cx="22" cy="30" r="3.5" fill="${c}"/>` +
      `<circle cx="42" cy="30" r="3.5" fill="${c}"/>` +
      `<path d="M28 40h8l-4 8z" fill="${c}"/></g></svg>`;
    return (cacheSvg[cor] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg));
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
      'shape': 'ellipse',
      'width': 'data(tam)',
      'height': 'data(tam)',
      'transition-property': 'opacity',
      'transition-duration': '120ms',
    } },
    { selector: 'node.fukurou', style: {
      'border-width': 3, 'font-size': 12, 'color': '#45e3ff',
      'text-margin-y': 9, 'font-family': 'Chakra Petch, sans-serif',
    } },
    // A operação não tem retrato: o nome dela É o desenho do nó. Rótulo no
    // centro, quebrando em linhas dentro do círculo, e nada embaixo.
    { selector: 'node.operacao', style: {
      'background-image': 'none',
      'background-color': '#071a38',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-margin-y': 0,
      'text-wrap': 'wrap',
      'text-max-width': 'data(larg)',
      'font-family': 'Chakra Petch, sans-serif',
      'font-size': 11,
      'color': '#bff3ff',
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
      'transition-property': 'opacity',
      'transition-duration': '120ms',
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
      const [o, eo, ln, ps, cx] = await Promise.all([
        sb.from('operations').select('id,title,channel,status,images,entities_at'),
        sb.from('entity_operations').select('*'),
        sb.from('links').select('*'),
        sb.from('node_positions').select('*'),
        // Só vem o que o agente alcança dos DOIS lados: resolver uma conexão
        // exige enxergar as duas operações.
        sb.from('auto_connections').select('*'),
      ]);
      // Só canal de verdade vira teia. `operations.channel` também guarda
      // `agent:<id>`, que é o espaço privado entre um agente e o comando: o
      // dossiê que mora lá é anotação pessoal, não investigação, e não tem
      // teia. Sem este corte a barra lateral enchia de "teia do AKILE".
      //
      // Canal com trava de código ainda não liberada nesta sessão também fica
      // de fora, pela mesma razão da busca: o nó entregaria justamente o que a
      // trava esconde. A parede continua sendo o RLS; isto é a porta.
      dados.ops = (o.data || []).filter(x =>
        String(x.channel || '').startsWith('chan:') &&
        !window.LOCKS?.travaPendente?.(x.channel));
      // Só as ligações das operações que ficaram de pé: senão uma operação
      // atrás de trava ainda contaria para o "aparece em mais de uma".
      const visiveis = new Set(dados.ops.map(x => x.id));
      dados.vincs = (eo.data || []).filter(v => visiveis.has(v.operation_id));
      dados.links = ln.data || [];
      dados.conexoes = cx.data || [];
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
    let ops = geral ? dados.ops : dados.ops.filter(o => o.id === vista);
    if (geral && filtros.ops) ops = ops.filter(o => filtros.ops.has(o.id));
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
        tam: 74, img: svgCoruja('#9b5cff'), nivel: 0,
      }, classes: 'fukurou' });
    }

    ops.forEach(o => {
      const cor = TIPO_NO.operacao.cor;
      nos.push({
        data: {
          id: noOp(o.id), nome: o.title, kind: 'operacao', cor,
          tam: geral ? 84 : 96, larg: geral ? 60 : 70, nivel: 1,
          status: o.status, canal: o.channel,
        },
        classes: 'operacao' + (sigilosa(o) ? ' sigiloso' : ''),
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
      if (filtros.tipos && !filtros.tipos.has(e.kind)) { idsEnts.delete(id); return; }
      const t = TIPO_NO[e.kind] || TIPO_NO.pessoa;
      const capa = e.images?.[0] && dados.fotos[e.images[0]];
      nos.push({ data: {
        id: noEnt(id), nome: e.name, kind: e.kind, cor: t.cor,
        tam: 36, img: capa || svgCoruja(t.cor), nivel: 2,
      } });
    });

    vincs.forEach(v => {
      if (!window.ENT.cache[v.entity_id] || !idsEnts.has(v.entity_id)) return;
      const compartilhada = (porEntidade[v.entity_id]?.size || 0) > 1;
      arestas.push({
        data: {
          id: 'eo:' + v.entity_id + ':' + v.operation_id,
          source: noOp(v.operation_id), target: noEnt(v.entity_id),
          cor: compartilhada ? '#ffc74d' : TIPO_VINC.outro.cor,
          rotulo: v.role || ROTULO_SLOT[v.slot] || '',
          tipo: 'operacao', conf: 'confirmado', auto: true,
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
      if (filtros.vincs && !filtros.vincs.has(l.type)) return;
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
          <button class="ghost tw-buscar">BUSCAR NÓ</button>
          <button class="ghost tw-filtros">FILTROS</button>
          <button class="ghost tw-acesso hide" title="Quem pode abrir a Teia Geral">ACESSO</button>
          <button class="primary sm tw-novo">⬢ CRIAR NÓ</button>
        </div>
      </header>
      <div class="tw-stat">
        <span class="tw-cont"></span>
        <span class="tw-dica"></span>
      </div>
      <div class="tw-caixa hide"></div>
      <div class="tw-palco">
        <div class="tw-grafo"></div>
        <aside class="tw-painel" aria-label="Dossiê do nó"></aside>
        <div class="tw-legenda"></div>
        <div class="tw-vazio hide"></div>
      </div>`;
    $('#room-body').append(root);

    root.querySelector('.tw-volta').onclick = () => openChannel('teia:geral');
    root.querySelector('.tw-acesso').onclick = painelAcesso;
    root.querySelector('.tw-novo').onclick = criaNo;
    root.querySelector('.tw-buscar').onclick = () => alterna('busca');
    root.querySelector('.tw-filtros').onclick = () => alterna('filtros');
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
      `NÓS ${nos.length} · VÍNCULOS ${arestas.length}` + (filtrando() ? ' · FILTRADO' : '');
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
      // Em tela retina o canvas sai no dobro da resolução e cada quadro custa
      // quatro vezes mais. Preso em 1, o arrasto fica fluido e a diferença no
      // desenho não aparece neste tamanho de nó.
      pixelRatio: 1,
      // Durante o pan e o zoom o grafo vira uma textura única e volta a ser
      // desenhado quando a mão para: é o que tira o arrastão do movimento.
      textureOnViewport: true,
      motionBlur: false,
      layout: todasSalvas
        ? { name: 'preset', positions: n => salvas[n.id()] || { x: 0, y: 0 }, fit: true, padding: 60 }
        : vista === 'geral'
          ? { name: 'concentric', concentric: n => 3 - (n.data('nivel') ?? 2),
              levelWidth: () => 1, minNodeSpacing: 64, padding: 60, animate: false }
          : { name: 'cose', idealEdgeLength: 150, nodeRepulsion: 14000, padding: 60,
              animate: false, randomize: true },
    });

    // Posição dos que já tinham lugar marcado, mesmo quando outros não têm.
    if (!todasSalvas) {
      cy.nodes().forEach(n => { const p = salvas[n.id()]; if (p) n.position(p); });
      cy.fit(undefined, 60);
      // O layout recém-calculado vira o lugar de todo mundo — mas só quando
      // está tudo à vista. Com filtro ligado o desenho é de um recorte, e
      // gravá-lo embaralharia o lugar dos nós no quadro inteiro.
      if (!filtrando()) gravaPosicoes(cy.nodes());
    }

    cy.on('tap', 'node', e => seleciona(e.target.id()));
    cy.on('tap', 'edge', e => selecionaVinculo(e.target));
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
    cy?.batch(() => cy.elements().removeClass('apagado foco'));
    // Fecha deslizando: a gaveta sai de cena pelo transform, não por display,
    // senão não haveria o que animar.
    root.querySelector('.tw-painel').classList.remove('aberto');
    root.querySelector('.tw-dica').textContent =
      'clique no nó → abre a ficha e destaca os vínculos · duplo clique na operação → abre a aba dela';
  }

  function seleciona(id) {
    const no = cy.getElementById(id);
    if (!no.length) return;
    selecionado = id;

    // Destaca o nó e tudo que sai dele; o resto do grafo esmaece, para a
    // ramificação ficar legível no meio de dezenas de linhas.
    // Em lote: sem isto são dois recalculos de estilo sobre o grafo inteiro,
    // e com dezenas de nós o clique trava antes de a ficha abrir.
    const vizinhos = no.closedNeighborhood();
    cy.batch(() => {
      cy.elements().addClass('apagado').removeClass('foco');
      vizinhos.removeClass('apagado').addClass('foco');
    });

    const ligacoes = no.connectedEdges();
    root.querySelector('.tw-dica').textContent =
      `nó selecionado: ${no.data('nome')} · ${ligacoes.length} vínculo(s) destacado(s)`;
    painelDoNo(id, ligacoes);
  }

  function painelDoNo(id, ligacoes) {
    const painel = root.querySelector('.tw-painel');
    painel.innerHTML = '';
    painel.classList.add('aberto');

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
    const vinc = el('button', 'ghost sm', '+ VÍNCULO');
    vinc.onclick = () => formVinculo(noOp(opId), null);
    pe.append(dossie, vinc);
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
      if (nomes.length > 1) conexoesDa(corpo, entId);
    }

    relacionamentos(corpo, ligacoes, noEnt(entId));

    const pe = el('div', 'tw-p-pe');
    const editar = el('button', 'ghost sm', '✎ FICHA');
    editar.onclick = () => window.ENT.form(e, () => recarrega());
    const vinc = el('button', 'ghost sm', '+ VÍNCULO');
    vinc.onclick = () => formVinculo(noEnt(entId), null);
    pe.append(editar, vinc);
    if (e.created_by === me.id || isStaff()) {
      const rm = el('button', 'ghost sm danger', 'EXCLUIR NÓ');
      rm.title = 'Apaga a entidade de todas as operações e desfaz os vínculos dela';
      rm.onclick = async () => {
        if (!confirm(`Excluir "${e.name}" de todas as operações, com os vínculos dela?`)) return;
        const { error } = await sb.from('entities').delete().eq('id', entId);
        if (error) return toast('Não foi possível excluir: ' + error.message, true);
        limpaSelecao();
        recarrega();
      };
      pe.append(rm);
    }
    corpo.append(pe);
  }

  /**
   * As conexões automáticas desta entidade. Aparecem só para quem alcança as
   * duas operações do par — é o próprio RLS que decide isso, e por isso o
   * agente que enxerga um lado só recebe o aviso mas não vê par nenhum aqui.
   */
  function conexoesDa(corpo, entId) {
    const minhas = dados.conexoes.filter(c => c.entity_id === entId);
    corpo.append(el('p', 'tw-p-alerta',
      '⚠ aparece em mais de uma operação — conexão detectada automaticamente.'));
    if (!minhas.length) return;

    const ESTADO = { nova: 'não avaliada', confirmada: 'confirmada', ignorada: 'ignorada' };
    const box = el('div', 'tw-p-conex');
    minhas.forEach(c => {
      const a = dados.ops.find(o => o.id === c.op_a);
      const b = dados.ops.find(o => o.id === c.op_b);
      if (!a || !b) return;
      const linha = el('div', 'tw-conex ' + c.state);
      linha.append(el('b', null, a.title + '  ⟷  ' + b.title));
      linha.append(el('span', 'est', ESTADO[c.state] || c.state));
      if (c.note) linha.append(el('p', 'obs', c.note));

      const acoes = el('div', 'acoes');
      const grava = async campos => {
        const { error } = await sb.from('auto_connections')
          .update({ ...campos, updated_by: me.id, updated_at: new Date().toISOString() })
          .eq('entity_id', entId).eq('op_a', c.op_a).eq('op_b', c.op_b);
        if (error) return toast('Falha: ' + error.message, true);
        await recarrega();
        selecionaSeExiste(noEnt(entId));
      };

      if (c.state !== 'confirmada') {
        const ok = el('button', 'ghost sm', '✓ confirmar');
        ok.onclick = () => grava({ state: 'confirmada' });
        acoes.append(ok);
      }
      if (c.state !== 'ignorada') {
        const nao = el('button', 'ghost sm', '✕ ignorar');
        nao.onclick = () => grava({ state: 'ignorada' });
        acoes.append(nao);
      }
      const obs = el('button', 'ghost sm', '✎ observação');
      obs.onclick = () => {
        const m = modal('OBSERVAÇÃO DA CONEXÃO');
        m.body.append(el('p', 'form-note', a.title + '  ⟷  ' + b.title));
        const t = field(m.body, 'Observação', c.note, { area: true });
        const sv = el('button', 'primary', 'Salvar');
        const cl = el('button', 'ghost', 'Cancelar');
        cl.onclick = m.close;
        sv.onclick = async () => { m.close(); await grava({ note: t.value.trim() }); };
        m.foot.append(cl, sv);
      };
      acoes.append(obs);
      linha.append(acoes);
      box.append(linha);
    });
    corpo.append(box);
  }

  // --------------------------------------------------- busca e filtros
  let caixaAberta = null;

  function alterna(qual) {
    const caixa = root.querySelector('.tw-caixa');
    if (caixaAberta === qual) {
      caixaAberta = null;
      caixa.classList.add('hide');
      caixa.innerHTML = '';
      return;
    }
    caixaAberta = qual;
    caixa.classList.remove('hide');
    caixa.innerHTML = '';
    (qual === 'busca' ? montaBusca : montaFiltros)(caixa);
  }

  /** Procura entre os nós desenhados — que são, por definição, os que este
      agente alcança. Nome e apelido, como no cadastro. */
  function montaBusca(caixa) {
    const inp = el('input', 'tw-q');
    inp.placeholder = 'nome ou apelido do nó...';
    inp.spellcheck = false;
    const res = el('div', 'tw-q-res');
    caixa.append(inp, res);
    inp.focus();

    let t;
    const procura = async () => {
      const q = inp.value.trim().toLowerCase();
      res.innerHTML = '';
      if (!cy || q.length < 2) return;

      let achados = cy.nodes().filter(n => n.data('nome').toLowerCase().includes(q));
      const vistos = new Set(achados.map(n => n.id()));

      // Apelido não está no grafo: ele vive no banco, e é lá que se procura.
      const { data } = await sb.from('entity_aliases')
        .select('entity_id').ilike('alias', `%${q.replace(/[,()"\\%]/g, ' ')}%`).limit(20);
      (data || []).forEach(r => {
        const no = cy.getElementById(noEnt(r.entity_id));
        if (no.length && !vistos.has(no.id())) { vistos.add(no.id()); achados = achados.merge(no); }
      });

      if (!vistos.size) {
        res.append(el('p', 'tw-q-nada', '> nenhum nó com esse nome nesta vista.'));
        return;
      }
      achados.sort((a, b) => a.data('nome').localeCompare(b.data('nome'))).forEach(n => {
        const b = el('button', 'tw-q-l');
        b.append(el('span', 'n', n.data('nome')));
        b.append(el('span', 'k', n.data('kind') === 'operacao'
          ? 'OPERAÇÃO' : window.ENT.rotuloTipo(n.data('kind'))));
        b.onclick = () => {
          seleciona(n.id());
          cy.animate({ center: { eles: n }, zoom: 1.1 }, { duration: 260 });
        };
        res.append(b);
      });
    };
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(procura, 200); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); alterna('busca'); }
      if (e.key === 'Enter') { e.preventDefault(); res.querySelector('.tw-q-l')?.click(); }
    });
  }

  /** Grupo de caixas de seleção. `null` no filtro quer dizer tudo ligado. */
  function grupo(caixa, titulo, itens, chave) {
    const bloco = el('div', 'tw-f-grupo');
    bloco.append(el('h5', null, titulo));
    const linha = el('div', 'tw-f-itens');
    itens.forEach(([v, rotulo, cor]) => {
      const lb = el('label', 'tw-f-i');
      const cx = el('input');
      cx.type = 'checkbox';
      cx.checked = !filtros[chave] || filtros[chave].has(v);
      cx.onchange = () => {
        const todos = itens.map(i => i[0]);
        const atual = filtros[chave] ? new Set(filtros[chave]) : new Set(todos);
        cx.checked ? atual.add(v) : atual.delete(v);
        // Tudo marcado volta a ser `null`: o filtro deixa de existir em vez de
        // virar um conjunto com todos os valores dentro.
        filtros[chave] = atual.size === todos.length ? null : atual;
        marcaFiltro();
        desenha();
      };
      const pt = el('i');
      if (cor) pt.style.background = cor;
      lb.append(cx, pt, el('span', null, rotulo));
      linha.append(lb);
    });
    bloco.append(linha);
    caixa.append(bloco);
  }

  function montaFiltros(caixa) {
    grupo(caixa, 'TIPO DE NÓ',
      window.ENT.TIPOS.map(([v, r]) => [v, r, TIPO_NO[v]?.cor]), 'tipos');
    grupo(caixa, 'TIPO DE VÍNCULO',
      Object.entries(TIPO_VINC).map(([v, t]) => [v, t.nome.toUpperCase(), t.cor]), 'vincs');
    if (vista === 'geral' && dados.ops.length > 1) {
      grupo(caixa, 'OPERAÇÃO',
        dados.ops.slice().sort((a, b) => a.title.localeCompare(b.title))
          .map(o => [o.id, o.title, TIPO_NO.operacao.cor]), 'ops');
    }
    const limpar = el('button', 'ghost sm', 'limpar filtros');
    limpar.onclick = () => {
      filtros = { tipos: null, vincs: null, ops: null };
      marcaFiltro();
      desenha();
      caixa.innerHTML = '';
      montaFiltros(caixa);
    };
    caixa.append(limpar);
  }

  function marcaFiltro() {
    root.querySelector('.tw-filtros').classList.toggle('ativo', filtrando());
  }

  // --------------------------------------------------- criar e editar
  /**
   * Nó novo. Ele não pode nascer solto: uma entidade sem operação nenhuma é
   * rascunho que só o autor enxerga e que não aparece em teia alguma. Então
   * aqui ela já sai amarrada a uma operação — a da aba, ou a escolhida na
   * Teia Geral.
   */
  function criaNo() {
    const escolhiveis = vista === 'geral' ? dados.ops : dados.ops.filter(o => o.id === vista);
    if (!escolhiveis.length) {
      return toast('Não há operação alcançável para receber o nó.', true);
    }

    const amarra = async (ent, opId, papel) => {
      const { error } = await sb.from('entity_operations').insert({
        entity_id: ent.id, operation_id: opId, slot: ent.kind === 'local' ? 'place' : 'other',
        role: (papel || '').trim(), created_by: me.id,
      });
      if (error && error.code !== '23505') return toast('Falha ao vincular: ' + error.message, true);
      await recarrega();
      selecionaSeExiste(noEnt(ent.id));
    };

    if (escolhiveis.length === 1) {
      return window.ENT.form(null, ent => amarra(ent, escolhiveis[0].id, ''));
    }

    // Na Teia Geral pergunta primeiro a que investigação o nó pertence: é o
    // vínculo com a operação que decide quem vai poder enxergá-lo.
    const m = modal('NÓ NOVO — EM QUE OPERAÇÃO?');
    m.body.append(el('p', 'form-note',
      'O nó nasce dentro de uma operação, e é dela que ele herda o sigilo. ' +
      'Depois dá para ligá-lo a outras — e aí ele vira nó compartilhado.'));
    const w = el('label', 'fld');
    w.append(el('span', null, 'Operação'));
    const sel = el('select');
    escolhiveis.slice().sort((a, b) => a.title.localeCompare(b.title)).forEach(o => {
      const op = el('option', null, o.title);
      op.value = o.id;
      sel.append(op);
    });
    w.append(sel);
    m.body.append(w);
    const papel = field(m.body, 'Papel nesta operação (opcional)', '', { ph: 'ex.: chefe, ponto de encontro' });

    const seguir = el('button', 'primary', 'Continuar');
    const cancelar = el('button', 'ghost', 'Cancelar');
    cancelar.onclick = m.close;
    m.foot.append(cancelar, seguir);
    seguir.onclick = () => {
      const opId = sel.value, pap = papel.value;
      m.close();
      window.ENT.form(null, ent => amarra(ent, opId, pap));
    };
  }

  const selecionaSeExiste = id => { if (cy?.getElementById(id).length) seleciona(id); };

  /** O formulário do vínculo manual. A outra ponta só pode ser um nó desta
      vista — o que já está na tela é, por definição, o que o agente alcança. */
  function formVinculo(deId, link) {
    if (!cy) return;
    const m = modal(link ? 'EDITAR VÍNCULO' : 'NOVO VÍNCULO');

    const de = cy.getElementById(deId);
    m.body.append(el('h4', 'form-block', 'PONTAS'));
    const linha = el('p', 'tw-v-de');
    linha.append(el('b', null, de.data('nome')), el('span', null, ' ⟷ '));
    const alvoNome = el('b', null, '—');
    linha.append(alvoNome);
    m.body.append(linha);

    let alvo = null;
    if (link) {
      const outro = link.source().id() === deId ? link.target() : link.source();
      alvo = outro.id();
      alvoNome.textContent = outro.data('nome');
    } else {
      const w = el('label', 'fld');
      w.append(el('span', null, 'Ligar a'));
      const sel = el('select');
      const vazio = el('option', null, '— escolha o outro nó —');
      vazio.value = '';
      sel.append(vazio);
      cy.nodes()
        .filter(n => n.id() !== deId && n.id() !== 'fukurou')
        .sort((a, b) => a.data('nome').localeCompare(b.data('nome')))
        .forEach(n => {
          const o = el('option', null, n.data('nome'));
          o.value = n.id();
          sel.append(o);
        });
      sel.onchange = () => {
        alvo = sel.value || null;
        alvoNome.textContent = alvo ? cy.getElementById(alvo).data('nome') : '—';
      };
      w.append(sel);
      m.body.append(w);
    }

    m.body.append(el('h4', 'form-block', 'NATUREZA'));
    const wTipo = el('label', 'fld');
    wTipo.append(el('span', null, 'Tipo'));
    const selTipo = el('select');
    Object.entries(TIPO_VINC).forEach(([v, t]) => {
      const o = el('option', null, t.nome.toUpperCase());
      o.value = v;
      selTipo.append(o);
    });
    selTipo.value = link?.data('tipo') || 'outro';
    wTipo.append(selTipo);
    m.body.append(wTipo);

    const rotulo = field(m.body, 'Rótulo (opcional)', link?.data('rotulo') || '',
      { ph: 'o que aparece na linha: "irmão", "sócio"...' });

    const wConf = el('label', 'fld');
    wConf.append(el('span', null, 'Nível de confiança'));
    const selConf = el('select');
    Object.entries(CONF).forEach(([v, t]) => {
      const o = el('option', null, t.toUpperCase());
      o.value = v;
      selConf.append(o);
    });
    selConf.value = link?.data('conf') || 'provavel';
    wConf.append(selConf);
    m.body.append(wConf);

    const atual = link?.data('linkId') && dados.links.find(l => l.id === link.data('linkId'));
    const nota = field(m.body, 'Observação', atual?.note || '', { area: true });

    const salvar = el('button', 'primary', link ? 'Salvar' : 'Criar vínculo');
    const cancelar = el('button', 'ghost', 'Cancelar');
    cancelar.onclick = m.close;
    m.foot.append(cancelar, salvar);

    salvar.onclick = async () => {
      if (!alvo) return toast('Escolha o outro nó do vínculo.', true);
      salvar.disabled = true;
      const campos = {
        type: selTipo.value, label: rotulo.value.trim(),
        confidence: selConf.value, note: nota.value.trim(),
      };
      let error;
      if (atual) {
        ({ error } = await sb.from('links').update(campos).eq('id', atual.id));
      } else {
        // Ordem fixa das pontas: é o que faz o índice único valer e impede o
        // mesmo par entrar duas vezes, uma em cada sentido.
        const [a, b] = ordena(parte(deId), parte(alvo));
        ({ error } = await sb.from('links').insert({
          a_kind: a.kind, a_id: a.id, b_kind: b.kind, b_id: b.id,
          created_by: me.id, ...campos,
        }));
      }
      salvar.disabled = false;
      if (error) {
        return toast(error.code === '23505'
          ? 'Esses dois nós já estão ligados. Edite o vínculo que existe.'
          : 'Falha ao salvar: ' + error.message, true);
      }
      m.close();
      await recarrega();
      selecionaSeExiste(deId);
    };
  }

  /** Ficha da aresta: só o vínculo digitado tem o que editar. O que o sistema
      desenhou sozinho — entidade ligada à operação — se desfaz no dossiê. */
  function selecionaVinculo(aresta) {
    selecionado = null;
    cy.batch(() => {
      cy.elements().addClass('apagado').removeClass('foco');
      aresta.removeClass('apagado').addClass('foco');
      aresta.connectedNodes().removeClass('apagado');
    });

    const painel = root.querySelector('.tw-painel');
    painel.innerHTML = '';
    painel.classList.add('aberto');

    const head = el('header', 'tw-p-head');
    head.append(el('b', null, '« VÍNCULO'));
    const x = el('button', 'ghost', '✕');
    x.setAttribute('aria-label', 'Fechar');
    x.onclick = limpaSelecao;
    head.append(x);
    painel.append(head);

    const corpo = el('div', 'tw-p-corpo');
    painel.append(corpo);

    const a = aresta.source(), b = aresta.target();
    const par = el('p', 'tw-p-nome');
    par.textContent = a.data('nome') + '  ⟷  ' + b.data('nome');
    corpo.append(par);

    const linkId = aresta.data('linkId');
    const bruto = linkId && dados.links.find(l => l.id === linkId);

    if (!bruto) {
      corpo.append(el('p', 'tw-p-sub', 'DETECTADO AUTOMATICAMENTE'));
      corpo.append(el('p', 'tw-p-res', aresta.data('tipo') === 'operacao'
        ? 'A entidade está vinculada a esta operação pelo dossiê. Para desfazer, ' +
          'tire-a do dossiê em ✎ Editar.'
        : 'Ligação da operação com o centro da teia.'));
      if (aresta.hasClass('compartilhado')) {
        corpo.append(el('p', 'tw-p-alerta',
          '⚠ esta entidade aparece em mais de uma operação que você alcança.'));
      }
      return;
    }

    corpo.append(el('p', 'tw-p-sub',
      (TIPO_VINC[bruto.type]?.nome || bruto.type) + ' · ' + (CONF[bruto.confidence] || bruto.confidence)));
    if (bruto.label) corpo.append(el('p', 'tw-p-ape', '“' + bruto.label + '”'));
    if (bruto.note) {
      const d = el('div', 'tw-p-res md');
      d.append(MD.render(bruto.note));
      corpo.append(d);
    }
    corpo.append(el('p', 'tw-p-sub',
      'por ' + (people[bruto.created_by]?.codename || '[removido]')));

    const pe = el('div', 'tw-p-pe');
    const ed = el('button', 'ghost sm', '✎ EDITAR');
    ed.onclick = () => formVinculo(a.id(), aresta);
    pe.append(ed);
    if (bruto.created_by === me.id || isStaff()) {
      const rm = el('button', 'ghost sm danger', 'EXCLUIR');
      rm.onclick = async () => {
        if (!confirm('Excluir este vínculo?')) return;
        const { error } = await sb.from('links').delete().eq('id', bruto.id);
        if (error) return toast('Não foi possível excluir: ' + error.message, true);
        limpaSelecao();
        recarrega();
      };
      pe.append(rm);
    }
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
    // Filtro por operação não sobrevive à troca de aba: na teia individual ele
    // não quer dizer nada, e voltando para a geral seria um filtro invisível.
    filtros.ops = null;
    caixaAberta = null;
    root.querySelector('.tw-caixa').classList.add('hide');
    root.querySelector('.tw-caixa').innerHTML = '';
    marcaFiltro();
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

  /**
   * O realtime chega em rajada: converter um dossiê insere uma linha de
   * `entity_operations` por entidade, e cada uma acordaria cinco consultas e
   * um grafo inteiro refeito. Uma espera curta junta a rajada num só
   * recarregamento. Quem chama de dentro continua usando `recarrega`, que é
   * imediato — ali a tela precisa estar pronta na linha seguinte.
   */
  let timerRecarga = null;
  function recarregaLogo() {
    clearTimeout(timerRecarga);
    timerRecarga = setTimeout(() => { timerRecarga = null; recarrega(); }, 240);
  }

  window.TEIA = {
    open: abre,
    close: fecha,
    recarrega: recarregaLogo,
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
