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

  let root = null;
  // O grafo da vista atual: a lista de nós, a de arestas, o índice por id e
  // quem toca quem. Era isto que o Cytoscape guardava; agora que o desenho é
  // nosso, o modelo também é — e cabe em quatro campos.
  let G = { nos: [], arestas: [], porId: {}, toca: {} };
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
   * Miniatura de quem não tem foto: o ícone do TIPO. É a convenção de toda
   * ferramenta de análise de vínculo — o desenho diz o que a coisa é antes de
   * qualquer leitura, e a cor só confirma. A coruja do CIT fica para o único
   * nó que é a casa: o FUKUROU, no centro da Teia Geral.
   *
   * Desenho vetorial, e não texto: fonte dentro de data-URI não carrega, o
   * navegador cai numa qualquer e era isso que desenquadrava a sigla no nó.
   * Todo traço cabe numa caixa central de 44×44, com folga para a borda.
   */
  const cacheSvg = {};

  function svgNo(kind, cor) {
    const chave = kind + cor;
    if (cacheSvg[chave]) return cacheSvg[chave];
    const c = escapaXml(cor);
    const corpo = {
      pessoa:
        `<circle cx="40" cy="32" r="11" fill="${c}"/>` +
        `<path d="M21 62c0-10.5 8.5-19 19-19s19 8.5 19 19z" fill="${c}"/>`,
      local:
        `<path d="M40 19c-8.3 0-15 6.7-15 15 0 11.2 15 28 15 28s15-16.8 15-28` +
        ` c0-8.3-6.7-15-15-15z" fill="${c}"/>` +
        `<circle cx="40" cy="33.5" r="6" fill="${FUNDO}"/>`,
      veiculo:
        `<path d="M21 45l5-13h28l5 13v9H21z" fill="${c}"/>` +
        `<path d="M29 43l3-8h16l3 8z" fill="${FUNDO}"/>` +
        `<circle cx="30" cy="55" r="5" fill="${c}"/>` +
        `<circle cx="50" cy="55" r="5" fill="${c}"/>`,
      organizacao:
        `<path d="M23 26h19v36H23z" fill="${c}"/>` +
        `<path d="M42 38h15v24H42z" fill="${c}"/>` +
        `<g fill="${FUNDO}">` +
        `<rect x="28" y="32" width="4" height="5"/><rect x="34" y="32" width="4" height="5"/>` +
        `<rect x="28" y="42" width="4" height="5"/><rect x="34" y="42" width="4" height="5"/>` +
        `<rect x="28" y="52" width="4" height="5"/><rect x="34" y="52" width="4" height="5"/>` +
        `<rect x="46" y="44" width="4" height="5"/><rect x="51" y="44" width="4" height="5"/>` +
        `<rect x="46" y="53" width="4" height="5"/><rect x="51" y="53" width="4" height="5"/>` +
        `</g>`,
      informacao:
        `<circle cx="40" cy="40" r="19" fill="${c}"/>` +
        `<circle cx="40" cy="31" r="3.4" fill="${FUNDO}"/>` +
        `<rect x="37" y="37" width="6" height="15" rx="2.4" fill="${FUNDO}"/>`,
    }[kind] || `<circle cx="40" cy="40" r="15" fill="${c}"/>`;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">` +
      `<rect width="80" height="80" fill="${FUNDO}"/>${corpo}</svg>`;
    return (cacheSvg[chave] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg));
  }

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

  // ============================================================== o palco 3D
  /**
   * A teia é desenhada à mão, num canvas 2D, com a projeção em perspectiva
   * feita aqui mesmo. Não entra biblioteca 3D de propósito: são dezenas de nós
   * e algumas centenas de linhas, e girar e projetar isso custa menos do que
   * carregar um motor inteiro. De quebra o desenho sai com a fonte e as cores
   * do site — que é justamente o que uma textura de WebGL não dá de graça.
   *
   * O mundo gira sozinho em torno do eixo vertical, devagar, no sentido
   * horário. A câmera só muda de ângulo quando o agente segura ESPAÇO e
   * arrasta; arrastar sem o ESPAÇO desloca a vista, e a roda aproxima.
   */
  const TAU = Math.PI * 2;
  const FOCAL = 900;        // distância focal da projeção
  const GIRO = 0.055;       // rad/s — uma volta a cada ~114 segundos
  const OCIO = 5000;        // ms de quadro parado antes de o giro voltar
  // Teclado e dedo não têm os mesmos gestos, então não podem ler a mesma
  // dica: no celular a linha falava de SHIFT e de barra de espaço, teclas que
  // não existem ali, e o agente concluía que a teia simplesmente não funciona.
  const DEDO = !!window.matchMedia?.('(hover:none)')?.matches;
  const DICA = DEDO
    ? 'toque no nó → ficha e vínculos · segure e arraste move o nó · ' +
      'dois dedos aproximam e giram · toque duplo na operação → abre a aba dela'
    : 'clique no nó → ficha e vínculos · SHIFT + arrastar move o nó · ' +
      'ESPAÇO + arrastar gira o plano · duplo clique na operação → abre a aba dela';

  // Gestos de toque, em números. O tempo é o do toque longo; a folga é quanto
  // o dedo pode escorregar antes de o toque virar arrasto — dedo não fica
  // parado como um cursor, e exigir imobilidade nunca pegaria o nó.
  const SEGURA = 380;     // ms até o toque longo pegar o nó
  const FOLGA = 14;       // px de escorregão ainda considerados "parado"
  const DUPLO = 320;      // ms entre dois toques para contarem como duplo

  // `giro` é o do relógio, que anda sozinho; `yaw` e `pitch` são do agente.
  // Separados, porque soltar o arrasto não pode desfazer o que já girou.
  // `dist` é só a força da perspectiva — quanto o que está na frente cresce em
  // relação ao que está atrás. O tamanho na tela é `zoom`, à parte: misturar os
  // dois faria o enquadramento achatar ou esticar a profundidade junto.
  const cam = { giro: 0, yaw: 0, pitch: .62, dist: 2400, zoom: 1, px: 0, py: 0 };

  let cena = null;          // o canvas e o laço, enquanto a teia está aberta
  let foco = null;          // { nos:Set, arestas:Set } enquanto há seleção
  let espaco = false;       // a barra está pressionada?

  const noDe = id => G.porId[id] || null;
  const ligacoesDe = id => G.toca[id] || [];
  const emFoco = id => !foco || foco.nos.has(id);
  /** 0 para quem está na frente, 1 para quem está no fundo deste quadro. */
  const fundura = prof => Math.max(0, Math.min(1, (prof - cena.pPerto) / cena.pFaixa));
  const corta = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

  // ---------------------------------------------------------------- lugares
  /** Ponto i de n espalhados por igual numa esfera (espiral de Fibonacci). */
  function naEsfera(i, n) {
    const y = n < 2 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.39996322972865332;        // o ângulo de ouro
    return { x: Math.cos(th) * r, y, z: Math.sin(th) * r };
  }

  /**
   * O lugar de cada nó no espaço.
   *
   * Na teia de uma operação, ela fica na origem e as entidades se espalham
   * numa esfera em volta: é uma coisa só no meio e o resto orbitando.
   *
   * Na Teia Geral o desenho é uma flor. O FUKUROU na origem, as operações num
   * anel em volta dele, e as entidades num anel MAIOR, por fora das operações
   * — cada uma na fatia de círculo da operação que a apurou. A fatia é
   * proporcional ao tamanho da operação: a que carrega vinte pessoas recebe
   * mais céu do que a que carrega quatro.
   *
   * Por fora, e não em volta: a versão anterior punha cada grupo numa esfera
   * centrada NA operação, e o resultado era a operação enterrada dentro da
   * própria nuvem, com o nome ilegível e as entidades de duas operações
   * vizinhas se misturando no meio do caminho. Com as entidades do lado de
   * fora, toda linha sai do centro para a borda e nenhuma volta.
   *
   * A conta é determinística de propósito. O plano gira, mas não embaralha:
   * quem fechou a teia com uma pessoa à direita da operação a reencontra ali.
   */
  function layout3d() {
    const nivel = n => G.nos.filter(x => x.nivel === n);
    const centro = nivel(0)[0] || nivel(1)[0] || null;
    const ops = nivel(1).filter(o => o !== centro);
    G.nos.forEach(n => { n.centro = false; });
    if (centro) { centro.p = { x: 0, y: 0, z: 0 }; centro.centro = true; }

    // De que operação é cada entidade, nesta vista.
    const donos = {};
    G.arestas.forEach(a => {
      if (a.tipo !== 'operacao') return;
      (donos[a.para] = donos[a.para] || []).push(a.de);
    });
    const ents = nivel(2);

    if (!ops.length) {
      // Teia de uma operação: ela no meio, todo mundo numa esfera em volta.
      const n = ents.length;
      const raio = 350 * (.65 + Math.min(1, n / 16) * .95);
      ents.forEach((e, i) => {
        const d = naEsfera(i, n);
        e.p = { x: d.x * raio, y: d.y * raio * .7, z: d.z * raio };
      });
    } else {
      // Quem é de uma operação só, e quem é de mais de uma.
      const minhas = {}, compart = [];
      const peso = o => 1 + (minhas[o.id] || []).length;
      ents.forEach(e => {
        const meus = [...new Set(donos[e.id] || [])].sort();
        if (meus.length === 1) (minhas[meus[0]] = minhas[meus[0]] || []).push(e);
        else compart.push({ e, meus });
      });

      // Vizinhas no anel são as que têm gente em comum. Em ordem alfabética,
      // duas operações que compartilham três suspeitos podiam cair em lados
      // opostos, e a linha dourada cruzava o quadro inteiro para ligá-las —
      // justamente a linha que o agente mais precisa enxergar.
      const parentesco = {};
      compart.forEach(c => c.meus.forEach(a => c.meus.forEach(b => {
        if (a !== b) parentesco[a + '>' + b] = (parentesco[a + '>' + b] || 0) + 1;
      })));
      const fila = ops.slice().sort((a, b) =>
        peso(b) - peso(a) || a.id.localeCompare(b.id));
      const anel = fila.length ? [fila.shift()] : [];
      while (fila.length) {
        const u = anel[anel.length - 1].id;
        let melhor = 0;
        fila.forEach((o, i) => {
          const v = parentesco[u + '>' + o.id] || 0;
          const m = parentesco[u + '>' + fila[melhor].id] || 0;
          if (v > m) melhor = i;
        });
        anel.push(fila.splice(melhor, 1)[0]);
      }

      const soma = ops.reduce((t, o) => t + peso(o), 0);
      const R1 = 300 + ops.length * 46;
      const R2 = R1 + 420 + Math.min(soma, 44) * 9;

      const fatia = {};
      let giro = 0;
      anel.forEach((o, i) => {
        const larg = (peso(o) / soma) * TAU;
        const meio = giro + larg / 2;
        giro += larg;
        fatia[o.id] = { meio, larg };
        o.p = { x: Math.cos(meio) * R1, y: (i % 2 ? 1 : -1) * R1 * .1,
                z: Math.sin(meio) * R1 };
      });

      ops.forEach(o => {
        const lista = minhas[o.id] || [];
        const { meio, larg } = fatia[o.id];
        const n = lista.length;
        lista.forEach((e, i) => {
          // Dentro da fatia, em três distâncias e cinco alturas alternadas.
          // Num anel só, de uma altura só, quarenta nomes viram uma cerca.
          const t = n < 2 ? 0 : i / (n - 1) - .5;
          const th = meio + t * larg * .84;
          const rr = R2 * (1 + ((i % 3) - 1) * .09);
          e.p = { x: Math.cos(th) * rr, y: [0, 1, -1, .5, -.5][i % 5] * 155,
                  z: Math.sin(th) * rr };
        });
      });

      // A entidade de duas operações vai para o limite entre as duas fatias,
      // um pouco mais longe e um pouco mais alta. Mais longe porque a linha
      // dourada tem de passar por fora: cortando o meio, ela atravessaria o
      // quadro inteiro. Mais alta porque é ela que o agente procura.
      const juntas = new Map();
      compart.forEach(c => {
        const k = c.meus.join('|');
        (juntas.get(k) || juntas.set(k, []).get(k)).push(c.e);
      });
      juntas.forEach((lista, k) => {
        const as = k ? k.split('|').map(id => fatia[id]?.meio)
                        .filter(v => v != null) : [];
        // Média circular: dois ângulos em lados opostos do anel não têm média
        // aritmética que signifique alguma coisa.
        const cx = as.reduce((t, v) => t + Math.cos(v), 0);
        const cz = as.reduce((t, v) => t + Math.sin(v), 0);
        const base = as.length ? Math.atan2(cz, cx) : 0;
        lista.forEach((e, i) => {
          const t = lista.length < 2 ? 0 : i / (lista.length - 1) - .5;
          const th = base + t * .40;
          const rr = R2 * (as.length ? 1.17 : 1.34);
          e.p = { x: Math.cos(th) * rr, y: 180 + (i % 2 ? 95 : -95),
                  z: Math.sin(th) * rr };
        });
      });
    }

    // O que foi arrumado à mão vence o cálculo. É quadro de investigação: onde
    // alguém pôs um nó é informação, e vale para todo mundo que abre a aba.
    //
    // O centro é a única exceção, e de propósito: ele mora na origem e ponto.
    // Se ele pudesse ser gravado, bastaria uma posição vinda de outro ponto
    // zero — as da teia plana, por exemplo — para o quadro inteiro nascer num
    // canto, com o centro de fora. Arrastá-lo desloca a vista, não o mundo.
    const salvas = dados.pos[chaveVista()] || {};
    const gravadas = [];
    G.nos.forEach(n => {
      if (n === centro || n.id === 'fukurou') return;
      const { kind, id } = parte(n.id);
      const q = salvas[kind + ':' + id];
      if (q) { n.p = { x: q.x, y: q.y, z: q.z || 0 }; gravadas.push(n); }
    });

    // Rede de segurança. O centro É a origem; se a nuvem inteira estiver longe
    // dela, o quadro nasce torto, com o centro de fora. Já aconteceu duas
    // vezes — com as coordenadas herdadas da teia plana e com uma versão
    // antiga em cache, que gravava o mundo inteiro ao arrastar o centro. Aqui
    // o conserto é feito E gravado: corrigir só na tela estragaria a posição
    // relativa de quem fosse arrastado depois.
    if (gravadas.length > 2) {
      const meio = c => {
        const v = gravadas.map(x => x.p[c]);
        return (Math.min(...v) + Math.max(...v)) / 2;
      };
      const d = { x: meio('x'), y: meio('y'), z: meio('z') };
      const raio = Math.max(...gravadas.map(x =>
        Math.hypot(x.p.x - d.x, x.p.y - d.y, x.p.z - d.z)), 1);
      if (Math.hypot(d.x, d.y, d.z) > raio * .45) {
        gravadas.forEach(x => { x.p.x -= d.x; x.p.y -= d.y; x.p.z -= d.z; });
        gravaPosicoes(gravadas);
      }
    }

    // A câmera fica longe o bastante para a perspectiva ser suave: de perto, o
    // nó da frente ficaria três vezes maior que o de trás e o quadro inteiro
    // teria de recuar para caber o pior ângulo do giro.
    let longe = 1;
    G.nos.forEach(n => { longe = Math.max(longe, Math.hypot(n.p.x, n.p.y, n.p.z)); });
    cam.dist = Math.max(900, longe * 4.2);
  }

  /**
   * Recua a câmera até o quadro inteiro caber — e não só no ângulo de agora.
   * O plano gira, então a conta é feita em oito ângulos e vale a pior sobra:
   * enquadrar só o que está à vista faria o grafo transbordar meio minuto
   * depois, sozinho, sem ninguém ter encostado em nada.
   */
  function enquadra() {
    if (!cena || !G.nos.length) return;
    const yaw0 = cam.yaw;
    const caixa = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let g = 0; g < 8; g++) {
        cam.yaw = yaw0 + (g / 8) * TAU;
        for (const n of G.nos) {
          const s = projeta(n.p);
          if (!s) return null;                 // alguém atrás da câmera: recua
          const r = (n.tam / 2) * s.k + 16;
          x0 = Math.min(x0, s.x - r); x1 = Math.max(x1, s.x + r);
          y0 = Math.min(y0, s.y - r); y1 = Math.max(y1, s.y + r);
        }
      }
      return { x0, x1, y0, y1 };
    };

    for (let i = 0; i < 24; i++) {
      const c = caixa();
      if (!c) { cam.dist *= 1.25; continue; }
      const f = Math.max((c.x1 - c.x0) / cena.w, (c.y1 - c.y0) / cena.h);
      if (f <= 1.0 && f >= .88) break;
      cam.zoom = Math.max(.15, Math.min(6, cam.zoom / Math.min(1.6, Math.max(.62, f))));
    }

    // A perspectiva joga o lado de perto para baixo: o meio do desenho não é o
    // meio da tela, e sem este acerto o quadro nasce encostado no rodapé.
    const c = caixa();
    cam.yaw = yaw0;
    if (c) cam.py += cena.cy - (c.y0 + c.y1) / 2;
  }

  // -------------------------------------------------------------- projeção
  function projeta(p) {
    const a = cam.giro + cam.yaw;
    const ca = Math.cos(a), sa = Math.sin(a);
    const x1 = p.x * ca + p.z * sa;
    const z1 = p.z * ca - p.x * sa;
    const cb = Math.cos(cam.pitch), sb = Math.sin(cam.pitch);
    const y2 = p.y * cb - z1 * sb;
    const z2 = p.y * sb + z1 * cb;
    const prof = cam.dist - z2;                // o que está mais perto é maior
    if (prof < 90) return null;
    const k = FOCAL * cam.zoom / prof;
    return { x: cena.cx + cam.px + x1 * k, y: cena.cy + cam.py - y2 * k, k, prof };
  }

  // --------------------------------------------------------------- figuras
  // Cada nó é desenhado UMA vez num canvas de 128 e reaproveitado em todo
  // quadro. Sem isto seriam cem recortes circulares por quadro, sessenta vezes
  // por segundo, para desenhar sempre a mesma coisa.
  const figuras = {};
  const retratos = {};

  function retrato(src) {
    let im = retratos[src];
    if (!im) { im = retratos[src] = new Image(); im.src = src; }
    return im.complete && im.naturalWidth ? im : null;
  }

  /** Quebra o texto nas linhas que cabem numa largura, na fonte já escolhida. */
  function quebra(ctx, texto, larg) {
    const linhas = [];
    let atual = '';
    String(texto).split(/\s+/).forEach(w => {
      const tenta = atual ? atual + ' ' + w : w;
      if (ctx.measureText(tenta).width > larg && atual) { linhas.push(atual); atual = w; }
      else atual = tenta;
    });
    if (atual) linhas.push(atual);
    return linhas;
  }

  /**
   * O nome da operação, escrito dentro do círculo e no tamanho que couber ali.
   * Não entra no desenho fixo do nó justamente por isto: o nó muda de tamanho
   * com a distância e com o zoom, e um texto gravado junto encolheria com ele
   * até virar um borrão de dois pixels.
   */
  function escreveDentro(ctx, texto, cx, cy, r) {
    const larg = r * 1.45;
    for (let corpo = Math.min(17, r * .3); corpo >= 7.5; corpo -= 1) {
      ctx.font = '600 ' + corpo.toFixed(1) + 'px "Chakra Petch", sans-serif';
      const linhas = quebra(ctx, texto, larg);
      const cabe = linhas.every(l => ctx.measureText(l).width <= larg) &&
                   linhas.length * (corpo + 2) <= r * 1.7;
      if (!cabe && corpo > 8.5) continue;
      const alt = corpo + 2;
      const y0 = cy - ((linhas.length - 1) * alt) / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#bff3ff';
      linhas.forEach((l, i) => ctx.fillText(l, cx, y0 + i * alt));
      return;
    }
  }

  function figura(n) {
    const chave = n.kind === 'operacao'
      ? 'op|' + (n.sigiloso ? 's' : '')
      : n.kind + '|' + n.cor + '|' + n.img;
    if (figuras[chave]) return figuras[chave];

    let im = null;
    if (n.kind !== 'operacao') {
      im = retrato(n.img);
      if (!im) return null;              // volta no próximo quadro, já carregada
    }

    const L = 128, c = L / 2, r = c - 4;
    const cv = document.createElement('canvas');
    cv.width = cv.height = L;
    const x = cv.getContext('2d');

    x.save();
    x.beginPath(); x.arc(c, c, r, 0, TAU); x.clip();
    if (n.kind === 'operacao') {
      x.fillStyle = '#071a38'; x.fillRect(0, 0, L, L);
    } else {
      x.fillStyle = FUNDO; x.fillRect(0, 0, L, L);
      const esc = L / Math.max(im.naturalWidth, im.naturalHeight);
      const w = im.naturalWidth * esc, h = im.naturalHeight * esc;
      x.drawImage(im, c - w / 2, c - h / 2, w, h);
    }
    x.restore();

    // Anel fino. Grosso, cinquenta deles viram uma grade de argolas e o que
    // está DENTRO do nó — que é a informação — some atrás da moldura.
    x.lineWidth = 3.5;
    x.strokeStyle = n.cor;
    x.beginPath(); x.arc(c, c, r - 2, 0, TAU); x.stroke();
    if (n.sigiloso) {
      x.lineWidth = 2.5; x.strokeStyle = '#ff2e5f';
      x.beginPath(); x.arc(c, c, r - 8, 0, TAU); x.stroke();
    }
    return (figuras[chave] = cv);
  }

  // A fonte da casa pode não ter chegado quando a primeira figura foi feita, e
  // aí o nome da operação ficaria gravado numa fonte qualquer para sempre.
  document.fonts?.ready?.then(() => { Object.keys(figuras).forEach(k => delete figuras[k]); });

  // --------------------------------------------------------------- o quadro
  function pinta() {
    const ctx = cena.ctx;
    ctx.setTransform(cena.dpr, 0, 0, cena.dpr, 0, 0);
    ctx.clearRect(0, 0, cena.w, cena.h);
    ctx.lineCap = 'round';

    G.nos.forEach(n => { n.s = projeta(n.p); });

    // A faixa de profundidade DESTE quadro, que é com o que o fundo desbota.
    // Medida a cada quadro, e não uma vez: o plano gira, e quem estava na
    // frente passa para trás. Amarrar isso à escala do nó não serve — a escala
    // também responde ao zoom, e aí o quadro inteiro desbotaria junto.
    let perto = Infinity, longe = -Infinity;
    G.nos.forEach(n => {
      if (!n.s) return;
      perto = Math.min(perto, n.s.prof);
      longe = Math.max(longe, n.s.prof);
    });
    cena.pPerto = perto;
    cena.pFaixa = Math.max(1, longe - perto);

    G.arestas.forEach(a => {
      const A = noDe(a.de)?.s, B = noDe(a.para)?.s;
      if (A && B) pintaAresta(a, A, B);
    });

    const fila = G.nos.filter(n => n.s).sort((x, y) => y.s.prof - x.s.prof);
    cena.atras.length = 0;
    fila.forEach(pintaNo);

    // Os nomes vêm por último, numa passada só e da frente para o fundo: assim
    // nenhum nome fica metade escondido atrás de um nó, e quando dois querem o
    // mesmo pedaço de tela o da frente leva. Nome sobre nome é o que mais suja
    // o quadro — e quem perdeu o lugar continua a um passar de mouse.
    cena.rotulos.length = 0;
    const nomes = fila.slice().reverse();
    const i0 = nomes.findIndex(n => n.centro);
    if (i0 > 0) nomes.unshift(nomes.splice(i0, 1)[0]);
    [selecionado, cena.sobre].forEach(id => {
      const i = nomes.findIndex(n => n.id === id);
      if (i > 0) nomes.unshift(nomes.splice(i, 1)[0]);
    });
    nomes.forEach(pintaRotulo);
  }

  function pintaAresta(a, A, B) {
    const ctx = cena.ctx;
    const dentro = !foco || foco.arestas.has(a.id);
    const k = Math.min(1.5, (A.k + B.k) / 2);
    const base = foco ? (dentro ? .95 : .05)
      : a.conf === 'suposto' ? .24 : a.compartilhado ? .6 : .34;
    ctx.globalAlpha = base * (1 - fundura((A.prof + B.prof) / 2) * .6);
    ctx.strokeStyle = a.cor;
    ctx.lineWidth = Math.max(.7, (foco && dentro ? 2.2 : a.compartilhado ? 1.5 : 1) * k);
    // Suposto é tracejado, provável é pontilhado curto, confirmado é cheio — e
    // a conexão que o sistema achou sozinha tem tracejado largo, para destoar.
    ctx.setLineDash(a.conf === 'suposto' ? [7, 6]
      : a.conf === 'provavel' ? [2, 5]
      : a.compartilhado ? [9, 7] : []);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rótulo de linha só no ramo selecionado e na linha sob o ponteiro. Todos
    // de uma vez eram cem palavrinhas cinzas cruzando o quadro.
    if (!a.rotulo || !((foco && dentro) || a.id === cena.sobreAresta)) return;
    ctx.globalAlpha = Math.max(.8, ctx.globalAlpha);
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const corpo = Math.max(7, Math.min(10, 8 * k));
    ctx.font = corpo + 'px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(a.rotulo).width;
    ctx.fillStyle = '#04020c';
    ctx.globalAlpha *= .85;
    ctx.fillRect(mx - w / 2 - 3, my - corpo / 2 - 2, w + 6, corpo + 4);
    ctx.fillStyle = '#9d95dd';
    ctx.fillText(a.rotulo, mx, my);
  }

  function pintaNo(n) {
    const ctx = cena.ctx, s = n.s;
    const r = Math.max(6, (n.tam / 2) * s.k);
    // Duas coisas desbotam o nó. A primeira é a profundidade: quem vai ficando
    // para trás vai ficando translúcido, e é isso que dá fundo ao quadro. O
    // centro é a âncora e escapa dela — ele mora na profundidade do meio para
    // sempre, e apagá-lo seria apagar a referência de todo o resto.
    //
    // A segunda é cobrir alguém: se este nó cai em cima de um que já foi
    // desenhado — e desenhado antes quer dizer mais atrás —, ele fica
    // translúcido para deixar ver através. Pilha opaca é o que mais embaralha
    // o quadro, e abrir buraco nela custa menos do que esconder o de baixo.
    const tapa = cena.atras.some(o =>
      Math.hypot(o.x - s.x, o.y - s.y) < Math.max(r, o.r) * .95);
    ctx.globalAlpha = (foco && !emFoco(n.id) ? .08
      : n.centro ? 1 : 1 - fundura(s.prof) * .68) * (tapa ? .55 : 1);
    cena.atras.push({ x: s.x, y: s.y, r });

    const fig = figura(n);
    if (fig) {
      ctx.drawImage(fig, s.x - r, s.y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = FUNDO; ctx.strokeStyle = n.cor; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill(); ctx.stroke();
    }

    // Quem aparece em mais de uma operação ganha a pastilha dourada. É a cor
    // da linha que o sistema desenhou sozinho, mas lida no próprio nó: a linha
    // pode estar atrás dele, ou apagada por um filtro.
    if (n.compartilhada) {
      const g = Math.max(2.5, r * .26);
      const bx = s.x + r * .7, by = s.y - r * .7;
      ctx.fillStyle = FUNDO;
      ctx.beginPath(); ctx.arc(bx, by, g + 1.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffc74d';
      ctx.beginPath(); ctx.arc(bx, by, g, 0, TAU); ctx.fill();
    }

    if (n.id === selecionado || n.id === cena.sobre) {
      ctx.globalAlpha = Math.min(1, ctx.globalAlpha + .3);
      ctx.strokeStyle = n.id === selecionado ? '#fff' : n.cor;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 5, 0, TAU); ctx.stroke();
    }
  }

  /** O nome do nó, com fundo próprio e sem pisar no nome de ninguém. */
  function pintaRotulo(n) {
    const ctx = cena.ctx, s = n.s;
    const alfa = foco && !emFoco(n.id) ? 0
      : n.centro ? 1 : 1 - fundura(s.prof) * .68;
    if (alfa < .42) return;                   // o do fundo sai antes do nó

    // A operação escreve o nome dentro de si — mas só enquanto couber. Longe,
    // ou com o quadro afastado, o círculo fica pequeno demais para qualquer
    // texto, e aí o nome desce para baixo do nó como o de todo mundo.
    const raio = Math.max(6, (n.tam / 2) * s.k);
    if (n.kind === 'operacao' && raio >= 24) {
      ctx.globalAlpha = alfa;
      escreveDentro(ctx, n.nome, s.x, s.y, raio);
      return;
    }

    const eCentro = n.kind === 'fukurou';
    const opera = n.kind === 'operacao';
    const destaque = n.centro || n.id === selecionado || n.id === cena.sobre;
    const corpo = Math.max(8, Math.min(13, 9.5 * s.k));
    ctx.font = (eCentro || opera ? '600 ' : '') + corpo + 'px ' +
      (eCentro || opera ? '"Chakra Petch", sans-serif' : '"JetBrains Mono", monospace');
    const texto = corta(n.nome, 26);
    const w = ctx.measureText(texto).width;
    const livre = c => !cena.rotulos.some(o =>
      c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
    const caixaEm = yy => ({ x0: s.x - w / 2 - 4, x1: s.x + w / 2 + 4,
                             y0: yy - 1, y1: yy + corpo + 4 });

    // Embaixo é o lugar de sempre; em cima é o plano B. Num anel visto de
    // perfil os nós se espremem na horizontal e metade dos nomes ficaria de
    // fora por brigar com o vizinho — alternar o lado recupera quase todos.
    // Quem o agente está olhando escreve sempre, no lugar de sempre.
    let cx = caixaEm(s.y + raio + 4);
    if (!destaque && !livre(cx)) {
      cx = caixaEm(s.y - raio - corpo - 6);
      if (!livre(cx)) return;
    }
    const x = s.x, y = cx.y0 + 1;
    cena.rotulos.push(cx);

    // Fundo próprio: sem ele o nome no meio do quadro fica ilegível em cima
    // das linhas, por mais claro que seja.
    ctx.globalAlpha = alfa * .78;
    ctx.fillStyle = '#04020c';
    ctx.fillRect(cx.x0, cx.y0, cx.x1 - cx.x0, cx.y1 - cx.y0);

    ctx.globalAlpha = alfa;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = eCentro || opera ? '#45e3ff'
      : (n.id === selecionado || n.id === cena.sobre) ? '#ffffff' : '#cfc9ff';
    ctx.fillText(texto, x, y + 1);
  }

  // ------------------------------------------------------------- apontar
  function noEm(x, y, folga = 4) {
    let achado = null;
    G.nos.forEach(n => {
      if (!n.s) return;
      const r = Math.max(8, (n.tam / 2) * n.s.k) + folga;
      if (Math.hypot(n.s.x - x, n.s.y - y) <= r &&
          (!achado || n.s.prof < achado.s.prof)) achado = n;
    });
    return achado;
  }

  function distSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  // A folga é parâmetro porque o dedo não aponta como o cursor: sete pixels
  // bastam para o mouse e não acertam uma linha nunca no celular.
  function arestaEm(x, y, folga = 7) {
    let achada = null, melhor = folga;
    G.arestas.forEach(a => {
      const A = noDe(a.de)?.s, B = noDe(a.para)?.s;
      if (!A || !B) return;
      const d = distSeg(x, y, A.x, A.y, B.x, B.y);
      if (d < melhor) { melhor = d; achada = a; }
    });
    return achada;
  }

  /**
   * Quem vai junto quando este nó é arrastado. A operação leva as entidades que
   * só ela tem — a que aparece em duas fica onde está, porque pertence às duas
   * e arrastá-la atrás de uma seria mentir sobre a outra. A entidade anda
   * sozinha. O centro não passa por aqui: arrastá-lo desloca a vista, e aí
   * tudo vai junto sem que nada saia do lugar no mundo.
   */
  function arrastaJunto(n) {
    if (n.nivel !== 1) return [n];
    const leva = new Set([n]);
    ligacoesDe(n.id).forEach(a => {
      if (a.tipo !== 'operacao') return;
      const e = G.porId[a.para];
      if (e && !e.compartilhada) leva.add(e);
    });
    return [...leva];
  }

  /**
   * Move os nós pela tela. O deslocamento vem em pixels e precisa voltar ao
   * mundo: desfaz a escala da perspectiva na profundidade DAQUELE nó, depois o
   * pitch, depois o giro. Sem desfazer na ordem inversa, arrastar para a
   * direita com o plano virado jogaria o nó para o fundo.
   */
  function moveNos(nos, dx, dy, ref) {
    const k = ref.s?.k || 1;
    const a = cam.giro + cam.yaw;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cb = Math.cos(cam.pitch), sb = Math.sin(cam.pitch);
    const dx1 = dx / k, dy2 = -dy / k;
    const dY = dy2 * cb, dz1 = -dy2 * sb;
    const dX = dx1 * ca - dz1 * sa;
    const dZ = dx1 * sa + dz1 * ca;
    nos.forEach(n => { n.p.x += dX; n.p.y += dY; n.p.z += dZ; });
  }

  /** Grava onde os nós foram parar. O centro da Teia Geral não é linha de banco. */
  async function gravaPosicoes(nos) {
    const chave = chaveVista();
    const linhas = [];
    nos.forEach(n => {
      if (n.centro || n.id === 'fukurou') return;
      const { kind, id } = parte(n.id);
      linhas.push({
        view_key: chave, node_kind: kind, node_id: id,
        x: Math.round(n.p.x), y: Math.round(n.p.y), z: Math.round(n.p.z),
        updated_by: me.id, updated_at: new Date().toISOString(),
      });
      (dados.pos[chave] = dados.pos[chave] || {})[kind + ':' + id] = { ...n.p };
    });
    if (!linhas.length) return;
    const { error } = await sb.from('node_positions').upsert(linhas);
    if (error) console.error('posições:', error);
  }

  /**
   * Joga fora o que foi arrumado à mão nesta aba e deixa o cálculo refazer o
   * quadro. Serve para desfazer uma arrumação que não deu certo — e para as
   * abas que herdaram posição da teia plana sem ninguém ter pedido: a versão
   * antiga gravava sozinha o resultado do primeiro desenho, e por isso uma
   * operação aparecia com um arranjo diferente de todas as outras.
   */
  async function reorganiza() {
    if (!confirm('Recalcular o lugar de todos os nós desta aba?\n\n' +
                 'O que foi arrumado à mão aqui se perde — para todo mundo.')) return;
    const chave = chaveVista();
    const { error } = await sb.from('node_positions').delete().eq('view_key', chave);
    if (error) return toast('Não foi possível reorganizar: ' + error.message, true);
    delete dados.pos[chave];
    desenha();
    toast('Teia reorganizada.');
  }

  /** Traz o nó para a frente da câmera e aproxima. O plano segue girando. */
  function centraliza(n) {
    if (!n?.p || !cena) return;
    cam.yaw = Math.atan2(-n.p.x, n.p.z) - cam.giro;
    cam.zoom = Math.max(cam.zoom, 1.5);
    cam.px = cam.py = 0;
    const s = projeta(n.p);
    if (s) { cam.px += cena.cx - s.x; cam.py += cena.cy - s.y; }
  }

  // ---------------------------------------------------------------- a cena
  const agiu = () => { if (cena) cena.agir = performance.now(); };

  function liga(cv) {
    let arrasto = null;
    const ponto = e => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    // ---------------------------------------------------------------- toque
    // Sem teclado não há SHIFT nem barra de espaço, e sem roda não há zoom.
    // A tradução dos gestos:
    //   um dedo arrastando ....... desloca a vista (ou gira, com o botão ⟳)
    //   um dedo parado sobre o nó  pega o nó e passa a arrastá-lo
    //   dois dedos ............... aproximam, giram e deslocam ao mesmo tempo
    //   toque simples ............ seleciona nó ou vínculo
    //   toque duplo na operação .. abre a aba dela
    //
    // O toque longo é o que substitui o SHIFT, e pelo mesmo motivo: sem um
    // gesto deliberado, errar o nó por dois pixels arrastaria o quadro
    // inteiro — e no dedo "dois pixels" é otimismo.
    const dedos = new Map();     // pointerId → último ponto, no canvas
    let pinca = null;            // { x, y, d, a } da dupla de dedos
    let espera = 0;              // temporizador do toque longo
    let ultimo = 0;              // instante do último toque, para o duplo
    let fimToque = 0;            // quando o último dedo saiu, para calar o dblclick

    const paraEspera = () => { clearTimeout(espera); espera = 0; };
    /** Centro, distância e ângulo entre os dois dedos. */
    const dupla = () => {
      const [a, b] = [...dedos.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
               d: Math.hypot(b.x - a.x, b.y - a.y),
               a: Math.atan2(b.y - a.y, b.x - a.x) };
    };

    function toqueDesce(e) {
      cv.setPointerCapture(e.pointerId);
      const p = ponto(e);
      dedos.set(e.pointerId, p);
      cena.parado = true;
      agiu();

      if (dedos.size === 2) {
        // O segundo dedo cancela o que o primeiro ia fazer: ninguém pousa
        // dois dedos querendo arrastar um nó.
        paraEspera();
        if (arrasto?.modo === 'no' && arrasto.junto) gravaPosicoes(arrasto.junto);
        arrasto = null;
        cena.sobre = null;
        pinca = dupla();
        return;
      }
      if (dedos.size > 2) return;

      pinca = null;
      arrasto = { x: p.x, y: p.y, andou: 0, modo: espaco ? 'gira' : 'vista',
                  no: null, junto: null, toque: true };
      espera = setTimeout(() => {
        espera = 0;
        if (!arrasto || arrasto.andou > FOLGA || dedos.size !== 1) return;
        const alvo = noEm(arrasto.x, arrasto.y, 26);
        if (!alvo || alvo.centro) return;
        arrasto.modo = 'no';
        arrasto.no = alvo;
        arrasto.junto = arrastaJunto(alvo);
        arrasto.pegou = true;
        cena.sobre = alvo.id;          // o nó acende: pegou
        navigator.vibrate?.(18);
      }, SEGURA);
      cv.classList.add('girando');
    }

    function toqueAnda(e) {
      const ant = dedos.get(e.pointerId);
      if (!ant) return;
      const p = ponto(e);
      dedos.set(e.pointerId, p);

      if (dedos.size >= 2 && pinca) {
        const c = dupla();
        cam.zoom = Math.max(.2, Math.min(6, cam.zoom * (c.d / (pinca.d || c.d || 1))));
        // Torcer os dedos gira o plano. A diferença de ângulo precisa ser
        // normalizada: passando por ±π ela daria um salto de uma volta
        // inteira e o quadro giraria de uma vez.
        let da = c.a - pinca.a;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        cam.yaw += da;
        cam.px += c.x - pinca.x;
        cam.py += c.y - pinca.y;
        pinca = c;
        agiu();
        return;
      }
      if (!arrasto) return;

      const dx = p.x - ant.x, dy = p.y - ant.y;
      arrasto.andou += Math.abs(dx) + Math.abs(dy);
      arrasto.x = p.x; arrasto.y = p.y;
      if (espera && arrasto.andou > FOLGA) paraEspera();   // escorregou: é arrasto
      if (arrasto.modo === 'gira') {
        cam.yaw -= dx * .006;
        cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * .005));
      } else if (arrasto.modo === 'no') {
        moveNos(arrasto.junto, dx, dy, arrasto.no);
      } else {
        cam.px += dx; cam.py += dy;
      }
    }

    function toqueSobe(e) {
      if (!dedos.has(e.pointerId)) return;
      dedos.delete(e.pointerId);
      paraEspera();

      if (dedos.size >= 2) { pinca = dupla(); return; }
      if (dedos.size === 1) {
        // Saiu um dedo da pinça. O que sobrou continua na tela, e tratá-lo
        // como um toque novo faria o quadro pular para onde ele está.
        // `andou` já nasce alto: o que vier dele é arrasto, nunca toque.
        pinca = null;
        const [v] = [...dedos.values()];
        arrasto = { x: v.x, y: v.y, andou: 99, modo: espaco ? 'gira' : 'vista',
                    no: null, junto: null, toque: true };
        return;
      }

      pinca = null;
      fimToque = performance.now();
      cena.parado = false;
      cena.sobre = null;
      cv.classList.remove('girando');
      agiu();
      const a = arrasto;
      arrasto = null;
      if (!a) return;
      // Pegou o nó e o moveu, por pouco que seja: grava. O limite aqui é
      // baixo de propósito — com `FOLGA` o nó saía do lugar na tela e não era
      // gravado, e voltava sozinho para o lugar antigo no próximo
      // carregamento, sem nada explicando por quê.
      if (a.modo === 'no' && a.junto && a.andou >= 3) return gravaPosicoes(a.junto);
      if (a.andou >= FOLGA) return;              // foi arrasto, não toque

      const p = ponto(e);
      const n = noEm(p.x, p.y, 20);
      const agora = performance.now();
      if (agora - ultimo < DUPLO) {
        ultimo = 0;
        if (n && n.kind === 'operacao' && vista === 'geral') return openChannel('teia:' + n.id.slice(3));
      }
      ultimo = agora;
      if (n) return seleciona(n.id);
      const ar = arestaEm(p.x, p.y, 16);
      if (ar) return selecionaVinculo(ar);
      limpaSelecao();
    }

    function toqueCancela(e) {
      dedos.delete(e.pointerId);
      paraEspera();
      if (dedos.size) return;
      pinca = null; arrasto = null;
      cena.parado = false; cena.sobre = null;
      cv.classList.remove('girando');
    }

    // ---------------------------------------------------------------- mouse
    cv.addEventListener('pointerleave', () => { cena.sobre = cena.sobreAresta = null; });

    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return toqueDesce(e);
      if (e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      const p = ponto(e);
      // ESPAÇO gira a câmera, SHIFT move o nó, e sem nenhum dos dois o arrasto
      // desloca a vista. O gesto do nó pede tecla de propósito: sem ela, errar
      // o nó por dois pixels arrastava o quadro inteiro, e o que chegava de
      // volta era "não consigo arrastar os nós".
      //
      // Com a tecla na mão a folga para pegar pode ser generosa — ninguém
      // segura SHIFT sem querer pegar alguma coisa.
      const alvo = e.shiftKey && !espaco ? noEm(p.x, p.y, 22) : null;
      const pega = !!alvo && !alvo.centro;
      arrasto = {
        x: p.x, y: p.y, andou: 0,
        modo: espaco ? 'gira' : pega ? 'no' : 'vista',
        no: alvo, junto: pega ? arrastaJunto(alvo) : null,
      };
      cena.parado = true;                     // o relógio espera a mão sair
      cv.classList.add('girando');
      agiu();
    });

    cv.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return toqueAnda(e);
      const p = ponto(e);
      if (!arrasto) {
        const n = noEm(p.x, p.y);
        cena.sobre = n ? n.id : null;
        // Sem nó debaixo do ponteiro, procura linha: é assim que o rótulo do
        // vínculo aparece, um de cada vez, em vez de todos ao mesmo tempo.
        const a = n ? null : arestaEm(p.x, p.y);
        cena.sobreAresta = a ? a.id : null;
        // Mão aberta só com o SHIFT na mão: é aí que o nó sai do lugar.
        cv.style.cursor = n ? (e.shiftKey ? 'grab' : 'pointer')
          : a ? 'pointer' : espaco ? 'grab' : 'default';
        return;
      }
      const dx = p.x - arrasto.x, dy = p.y - arrasto.y;
      arrasto.andou += Math.abs(dx) + Math.abs(dy);
      arrasto.x = p.x; arrasto.y = p.y;
      if (arrasto.modo === 'gira') {
        cam.yaw -= dx * .006;
        cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * .005));
      } else if (arrasto.modo === 'no') {
        moveNos(arrasto.junto, dx, dy, arrasto.no);
      } else {
        cam.px += dx; cam.py += dy;
      }
    });

    const solta = e => {
      if (e.pointerType === 'touch') return toqueSobe(e);
      if (!arrasto) return;
      const clique = arrasto.andou < 5;
      const movido = !clique && arrasto.modo === 'no' ? arrasto.junto : null;
      arrasto = null;
      cena.parado = false;
      cv.classList.remove('girando');
      agiu();
      if (movido) return gravaPosicoes(movido);
      if (!clique) return;
      const p = ponto(e);
      const n = noEm(p.x, p.y);
      if (n) return seleciona(n.id);
      const a = arestaEm(p.x, p.y);
      if (a) return selecionaVinculo(a);
      limpaSelecao();
    };
    cv.addEventListener('pointerup', solta);
    cv.addEventListener('pointercancel', e => {
      if (e.pointerType === 'touch') return toqueCancela(e);
      arrasto = null; cena.parado = false; cv.classList.remove('girando');
    });

    cv.addEventListener('dblclick', e => {
      // O navegador ainda manda `dblclick` depois de um toque duplo, e
      // `dblclick` é MouseEvent — não tem `pointerType` para distinguir. Quem
      // distingue é o relógio: se um dedo saiu agora, aquilo já foi tratado
      // como toque duplo, e abrir a aba de novo é abrir duas vezes.
      if (performance.now() - fimToque < 700) return;
      agiu();
      const p = ponto(e);
      const n = noEm(p.x, p.y);
      if (n && n.kind === 'operacao' && vista === 'geral') openChannel('teia:' + n.id.slice(3));
    });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      agiu();
      cam.zoom = Math.max(.2, Math.min(6, cam.zoom * (e.deltaY > 0 ? 1 / 1.12 : 1.12)));
    }, { passive: false });
  }

  function quadro(t) {
    if (!cena) return;
    cena.raf = requestAnimationFrame(quadro);
    const dt = Math.min(.05, (t - cena.t) / 1000);
    cena.t = t;
    if (document.hidden) return;              // aba escondida não gasta quadro

    // O plano gira sozinho, mas sai do caminho na hora de ler: clicar,
    // arrastar ou girar a roda zera a contagem, e ele só volta depois de cinco
    // segundos parado. Só passar o ponteiro por cima não conta — senão a teia
    // congelaria com o mouse esquecido em qualquer canto do palco.
    if (!cena.parado && t - cena.agir > OCIO) cam.giro -= GIRO * dt;
    pinta();
  }

  function criaCena(palco) {
    const cv = el('canvas', 'tw-cv');
    palco.innerHTML = '';
    palco.append(cv);
    cena = { cv, ctx: cv.getContext('2d'), w: 1, h: 1, cx: 0, cy: 0,
             dpr: 1, raf: 0, t: performance.now(), parado: false, obs: null,
             sobre: null, sobreAresta: null, agir: 0, rotulos: [], atras: [] };

    const mede = () => {
      const w = palco.clientWidth || 1, h = palco.clientHeight || 1;
      // Em tela retina o canvas sairia no dobro e cada quadro custaria quatro
      // vezes mais pixels. Preso em 1,5 o traço continua limpo.
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      cena.w = w; cena.h = h; cena.cx = w / 2; cena.cy = h / 2; cena.dpr = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };
    mede();
    cena.obs = new ResizeObserver(mede);
    cena.obs.observe(palco);

    liga(cv);
    cena.raf = requestAnimationFrame(quadro);
  }

  function paraCena() {
    if (!cena) return;
    cancelAnimationFrame(cena.raf);
    cena.obs?.disconnect();
    cena.cv.remove();
    cena = null;
  }

  // A barra de espaço arma o giro à mão. Sem o `preventDefault` a página rola
  // e, pior, o botão que estiver em foco dispara — espaço é "clicar" nele.
  addEventListener('keydown', e => {
    if (e.code !== 'Space' || !cena) return;
    const t = e.target;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName))) return;
    e.preventDefault();
    espaco = true;
    if (cena.cv.style.cursor !== 'pointer') cena.cv.style.cursor = 'grab';
  });
  addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    espaco = false;
    if (cena && cena.cv.style.cursor === 'grab') cena.cv.style.cursor = 'default';
  });

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
      (ps.data || []).forEach(r => {
        (dados.pos[r.view_key] = dados.pos[r.view_key] || {})[r.node_kind + ':' + r.node_id] =
          { x: r.x, y: r.y, z: r.z || 0 };
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
      nos.push({ id: 'fukurou', nome: 'FUKUROU', kind: 'fukurou', cor: '#9b5cff',
                 tam: 90, img: svgCoruja('#9b5cff'), nivel: 0 });
    }

    ops.forEach(o => {
      nos.push({
        id: noOp(o.id), nome: o.title, kind: 'operacao', cor: TIPO_NO.operacao.cor,
        tam: geral ? 98 : 132, nivel: 1, sigiloso: sigilosa(o),
        status: o.status, canal: o.channel,
      });
      if (geral) {
        arestas.push({ id: 'fk:' + o.id, de: 'fukurou', para: noOp(o.id),
                       cor: TIPO_VINC.comando.cor, rotulo: '',
                       tipo: 'comando', conf: 'confirmado' });
      }
    });

    idsEnts.forEach(id => {
      const e = window.ENT.cache[id];
      if (!e) return;
      if (filtros.tipos && !filtros.tipos.has(e.kind)) { idsEnts.delete(id); return; }
      const t = TIPO_NO[e.kind] || TIPO_NO.pessoa;
      const capa = e.images?.[0] && dados.fotos[e.images[0]];
      nos.push({ id: noEnt(id), nome: e.name, kind: e.kind, cor: t.cor,
                 tam: 45, img: capa || svgNo(e.kind, t.cor), nivel: 2,
                 compartilhada: (porEntidade[id]?.size || 0) > 1 });
    });

    vincs.forEach(v => {
      if (!window.ENT.cache[v.entity_id] || !idsEnts.has(v.entity_id)) return;
      const compartilhada = (porEntidade[v.entity_id]?.size || 0) > 1;
      arestas.push({
        id: 'eo:' + v.entity_id + ':' + v.operation_id,
        de: noOp(v.operation_id), para: noEnt(v.entity_id),
        cor: compartilhada ? '#ffc74d' : TIPO_VINC.outro.cor,
        rotulo: v.role || ROTULO_SLOT[v.slot] || '',
        tipo: 'operacao', conf: 'confirmado', auto: true,
        compartilhado: compartilhada,
      });
    });

    // Vínculo manual só entra quando as duas pontas estão desenhadas aqui.
    const existe = new Set(nos.map(n => n.id));
    dados.links.forEach(l => {
      const a = l.a_kind === 'op' ? noOp(l.a_id) : noEnt(l.a_id);
      const b = l.b_kind === 'op' ? noOp(l.b_id) : noEnt(l.b_id);
      if (!existe.has(a) || !existe.has(b)) return;
      if (filtros.vincs && !filtros.vincs.has(l.type)) return;
      const t = TIPO_VINC[l.type] || TIPO_VINC.outro;
      arestas.push({ id: 'ln:' + l.id, de: a, para: b, cor: t.cor,
                     rotulo: l.label || '', tipo: l.type,
                     conf: l.confidence, linkId: l.id });
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
        <button class="ghost tw-menu" aria-label="Canais" title="Canais">☰</button>
        <div class="tw-tools">
          <button class="ghost tw-girar" aria-pressed="false"
                  title="Com ⟳ ligado, arrastar um dedo gira o plano em vez de deslocar a vista">⟳ GIRAR</button>
          <button class="ghost tw-volta hide">← VOLTAR À TEIA GERAL</button>
          <button class="ghost tw-buscar">BUSCAR NÓ</button>
          <button class="ghost tw-filtros">FILTROS</button>
          <button class="ghost tw-arrumar" title="Recalcula o lugar de todos os nós desta aba">↻ REORGANIZAR</button>
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

    // A teia esconde o cabeçalho do canal, e com ele o ☰ que abre a gaveta:
    // no celular isso trancava o agente aqui dentro.
    root.querySelector('.tw-menu').onclick = () => window.GAVETA?.();
    // O equivalente de toque à barra de espaço. Trava ligado em vez de pedir
    // que se segure algo: no dedo não há "segurar uma tecla e arrastar".
    const gir = root.querySelector('.tw-girar');
    gir.onclick = () => {
      espaco = !espaco;
      gir.classList.toggle('on', espaco);
      gir.setAttribute('aria-pressed', String(espaco));
    };
    root.querySelector('.tw-volta').onclick = () => openChannel('teia:geral');
    root.querySelector('.tw-acesso').onclick = painelAcesso;
    root.querySelector('.tw-novo').onclick = criaNo;
    root.querySelector('.tw-buscar').onclick = () => alterna('busca');
    root.querySelector('.tw-filtros').onclick = () => alterna('filtros');
    root.querySelector('.tw-arrumar').onclick = reorganiza;
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
    root.querySelector('.tw-dica').textContent = selecionado ? '' : DICA;

    paraCena();
    G = { nos, arestas, porId: {}, toca: {} };

    if (!nos.length) {
      palco.innerHTML = '';
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

    nos.forEach(n => { G.porId[n.id] = n; });
    arestas.forEach(a => {
      (G.toca[a.de] = G.toca[a.de] || []).push(a);
      (G.toca[a.para] = G.toca[a.para] || []).push(a);
    });

    // A câmera volta ao ângulo de sempre a cada troca de vista; o giro do
    // relógio, não — ele é contínuo, e reiniciá-lo daria um salto na tela.
    cam.yaw = 0;
    cam.pitch = .62;
    cam.zoom = 1;
    cam.px = cam.py = 0;

    layout3d();
    criaCena(palco);
    enquadra();

    legenda();
    foco = null;
    if (selecionado && G.porId[selecionado]) seleciona(selecionado);
  }

  // ------------------------------------------------------------ seleção
  function limpaSelecao() {
    selecionado = null;
    foco = null;
    // Fecha deslizando: a gaveta sai de cena pelo transform, não por display,
    // senão não haveria o que animar.
    root.querySelector('.tw-painel').classList.remove('aberto');
    root.querySelector('.tw-dica').textContent = DICA;
  }

  function seleciona(id) {
    const no = G.porId[id];
    if (!no) return;
    selecionado = id;
    agiu();

    // O nó escolhido e tudo que sai dele ficam acesos; o resto do quadro
    // esmaece, para a ramificação se ler no meio de dezenas de linhas.
    const ligacoes = ligacoesDe(id);
    foco = { nos: new Set([id]), arestas: new Set() };
    ligacoes.forEach(a => { foco.arestas.add(a.id); foco.nos.add(a.de); foco.nos.add(a.para); });

    root.querySelector('.tw-dica').textContent =
      `nó selecionado: ${no.nome} · ${ligacoes.length} vínculo(s) destacado(s)`;
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
    lista.forEach(a => {
      const outroId = a.de === meuId ? a.para : a.de;
      const outro = G.porId[outroId];
      const linha = el('button', 'tw-p-rel-l');
      linha.append(el('span', 'n', outro?.nome || '—'));
      const rot = a.rotulo ||
        (a.tipo === 'operacao' ? 'nesta operação' : TIPO_VINC[a.tipo]?.nome || a.tipo);
      const marca = el('span', 'k', rot);
      marca.style.color = a.cor;
      if (a.conf && a.conf !== 'confirmado') {
        marca.title = 'nível de confiança: ' + (CONF[a.conf] || a.conf);
      }
      linha.append(marca);
      linha.onclick = () => seleciona(outroId);
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
      if (!G.nos.length || q.length < 2) return;

      const achados = G.nos.filter(n => n.nome.toLowerCase().includes(q));
      const vistos = new Set(achados.map(n => n.id));

      // Apelido não está no grafo: ele vive no banco, e é lá que se procura.
      const { data } = await sb.from('entity_aliases')
        .select('entity_id').ilike('alias', `%${q.replace(/[,()"\\%]/g, ' ')}%`).limit(20);
      (data || []).forEach(r => {
        const no = G.porId[noEnt(r.entity_id)];
        if (no && !vistos.has(no.id)) { vistos.add(no.id); achados.push(no); }
      });

      if (!achados.length) {
        res.append(el('p', 'tw-q-nada', '> nenhum nó com esse nome nesta vista.'));
        return;
      }
      achados.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(n => {
        const b = el('button', 'tw-q-l');
        b.append(el('span', 'n', n.nome));
        b.append(el('span', 'k', n.kind === 'operacao'
          ? 'OPERAÇÃO' : window.ENT.rotuloTipo(n.kind)));
        b.onclick = () => { seleciona(n.id); centraliza(n); };
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

  const selecionaSeExiste = id => { if (G.porId[id]) seleciona(id); };

  /** O formulário do vínculo manual. A outra ponta só pode ser um nó desta
      vista — o que já está na tela é, por definição, o que o agente alcança. */
  function formVinculo(deId, link) {
    if (!G.nos.length) return;
    const m = modal(link ? 'EDITAR VÍNCULO' : 'NOVO VÍNCULO');

    const de = G.porId[deId];
    m.body.append(el('h4', 'form-block', 'PONTAS'));
    const linha = el('p', 'tw-v-de');
    linha.append(el('b', null, de?.nome || '?'), el('span', null, ' ⟷ '));
    const alvoNome = el('b', null, '—');
    linha.append(alvoNome);
    m.body.append(linha);

    let alvo = null;
    if (link) {
      alvo = link.de === deId ? link.para : link.de;
      alvoNome.textContent = G.porId[alvo]?.nome || '—';
    } else {
      const w = el('label', 'fld');
      w.append(el('span', null, 'Ligar a'));
      const sel = el('select');
      const vazio = el('option', null, '— escolha o outro nó —');
      vazio.value = '';
      sel.append(vazio);
      G.nos
        .filter(n => n.id !== deId && n.id !== 'fukurou')
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .forEach(n => {
          const o = el('option', null, n.nome);
          o.value = n.id;
          sel.append(o);
        });
      sel.onchange = () => {
        alvo = sel.value || null;
        alvoNome.textContent = alvo ? (G.porId[alvo]?.nome || '—') : '—';
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
    selTipo.value = link?.tipo || 'outro';
    wTipo.append(selTipo);
    m.body.append(wTipo);

    const rotulo = field(m.body, 'Rótulo (opcional)', link?.rotulo || '',
      { ph: 'o que aparece na linha: "irmão", "sócio"...' });

    const wConf = el('label', 'fld');
    wConf.append(el('span', null, 'Nível de confiança'));
    const selConf = el('select');
    Object.entries(CONF).forEach(([v, t]) => {
      const o = el('option', null, t.toUpperCase());
      o.value = v;
      selConf.append(o);
    });
    selConf.value = link?.conf || 'provavel';
    wConf.append(selConf);
    m.body.append(wConf);

    const atual = link?.linkId && dados.links.find(l => l.id === link.linkId);
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
    foco = { nos: new Set([aresta.de, aresta.para]), arestas: new Set([aresta.id]) };

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

    const a = G.porId[aresta.de], b = G.porId[aresta.para];
    const par = el('p', 'tw-p-nome');
    par.textContent = (a?.nome || '?') + '  ⟷  ' + (b?.nome || '?');
    corpo.append(par);

    const linkId = aresta.linkId;
    const bruto = linkId && dados.links.find(l => l.id === linkId);

    if (!bruto) {
      corpo.append(el('p', 'tw-p-sub', 'DETECTADO AUTOMATICAMENTE'));
      corpo.append(el('p', 'tw-p-res', aresta.tipo === 'operacao'
        ? 'A entidade está vinculada a esta operação pelo dossiê. Para desfazer, ' +
          'tire-a do dossiê em ✎ Editar.'
        : 'Ligação da operação com o centro da teia.'));
      if (aresta.compartilhado) {
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
    ed.onclick = () => formVinculo(aresta.de, aresta);
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
      paraCena();
      root.querySelector('.tw-grafo').innerHTML = '';
      const vazio = root.querySelector('.tw-vazio');
      vazio.classList.remove('hide');
      vazio.innerHTML = '';
      vazio.append(el('p', null,
        '> a Teia Geral é restrita. Peça a um ADMIN para liberar o seu acesso.'));
      return;
    }

    root.classList.remove('hide');
    // A teia já redesenha o próprio quadro sessenta vezes por segundo. As
    // listras do tubo e a varredura do CRT passariam a disputar a mesma GPU
    // por nada — e é justamente aqui que a conta aperta.
    document.documentElement.classList.add('teia-aberta');
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
    document.documentElement.classList.remove('teia-aberta');
    paraCena();
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
    if (guardado && G.porId[guardado]) seleciona(guardado);
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
      if (G.porId[no]) { seleciona(no); centraliza(G.porId[no]); }
    },
  };
})();
