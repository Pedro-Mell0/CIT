/* ===========================================================================
   format.js — formatação de texto das mensagens, operações e relatos.

   Bloco (início da linha)          Inline
   ------------------------------   ---------------------------------------
   - item      → tópico             **texto**   → negrito
   * item      → tópico             'texto'     → itálico
   1. item     → lista numerada     *texto*     → itálico
   > citação   → citação            _texto_     → itálico
   # Título    → título (1 a 3 #)   __texto__   → sublinhado
   ---         → linha divisória    ~~texto~~   → riscado
   ```bloco``` → bloco de código    `texto`     → código
                                    ||texto||   → spoiler (revela no clique)
                                    http://...  → link

   Tudo é construído com createElement/textContent: nada de innerHTML,
   então texto de agente nunca vira HTML.
   =========================================================================== */
(() => {
  const el = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  // pre: grupo do prefixo que não faz parte da marcação (evita lookbehind)
  // g:   grupo com o conteúdo a formatar
  const RULES = [
    { re: /`([^`\n]+)`/,                                              tag: 'code', raw: true },
    { re: /\|\|([\s\S]+?)\|\|/,                                       tag: 'span', cls: 'spoiler' },
    { re: /\*\*\*([\s\S]+?)\*\*\*/,                                   tag: 'strong', wrap: 'em' },
    { re: /\*\*([\s\S]+?)\*\*/,                                       tag: 'strong' },
    { re: /__([\s\S]+?)__/,                                           tag: 'u' },
    { re: /~~([\s\S]+?)~~/,                                           tag: 's' },
    { re: /https?:\/\/[^\s<>()[\]]+/,                                 link: true },
    { re: /(^|[\s(["'*_—–-])\*([^*\n]+)\*(?=$|[\s.,;:!?)\]"'*_—–-])/, tag: 'em', pre: 1, g: 2 },
    { re: /(^|[\s(["'*_—–-])_([^_\n]+)_(?=$|[\s.,;:!?)\]"'*_—–-])/,   tag: 'em', pre: 1, g: 2 },
    { re: /(^|[\s(\["*_—–-])'([^'\n]+)'(?=$|[\s.,;:!?)\]"*_—–-])/,    tag: 'em', pre: 1, g: 2 },
  ];

  function inline(text, out) {
    let rest = text;
    let guard = 0;
    while (rest && guard++ < 500) {
      let best = null;
      for (const r of RULES) {
        const m = r.re.exec(rest);
        if (!m) continue;
        const start = m.index + (r.pre ? m[r.pre].length : 0);
        if (!best || start < best.start) best = { r, m, start };
      }
      if (!best) break;

      const { r, m, start } = best;
      if (start > 0) out.append(rest.slice(0, start));

      if (r.link) {
        const a = el('a');
        a.href = m[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = m[0];
        out.append(a);
      } else {
        const content = m[r.g || 1];
        const node = el(r.tag, r.cls);
        if (r.raw) {
          node.textContent = content;
        } else if (r.wrap) {
          const inner = el(r.wrap);
          inline(content, inner);
          node.append(inner);
        } else {
          inline(content, node);
        }
        if (r.cls === 'spoiler') {
          node.title = 'clique para revelar';
          node.onclick = () => node.classList.toggle('open');
        }
        out.append(node);
      }
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) out.append(rest);
  }

  /** Converte texto formatado em um DocumentFragment pronto para inserir. */
  function render(src) {
    const frag = document.createDocumentFragment();
    const lines = String(src ?? '').replace(/\r/g, '').split('\n');
    let i = 0, list = null, listKind = null;

    const closeList = () => { list = null; listKind = null; };
    const openList = kind => {
      if (listKind !== kind) {
        list = el(kind === 'ol' ? 'ol' : 'ul');
        listKind = kind;
        frag.append(list);
      }
      return list;
    };

    while (i < lines.length) {
      const line = lines[i];

      // bloco de código cercado
      if (/^\s*```/.test(line)) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        const pre = el('pre'), code = el('code');
        code.textContent = buf.join('\n');
        pre.append(code);
        frag.append(pre);
        continue;
      }

      // linha divisória
      if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
        closeList(); frag.append(el('hr')); i++; continue;
      }

      // título
      let m = /^\s*(#{1,3})\s+(.*)$/.exec(line);
      if (m) {
        closeList();
        const h = el('h' + (m[1].length + 3)); // h4..h6, não compete com o layout
        h.classList.add('md-h');
        inline(m[2], h);
        frag.append(h); i++; continue;
      }

      // citação
      if (/^\s*>\s?/.test(line)) {
        closeList();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        const q = el('blockquote');
        inline(buf.join('\n'), q);
        frag.append(q); continue;
      }

      // tópico
      m = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (m) {
        const li = el('li');
        inline(m[1], li);
        openList('ul').append(li); i++; continue;
      }

      // lista numerada
      m = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (m) {
        const li = el('li');
        inline(m[1], li);
        openList('ol').append(li); i++; continue;
      }

      // linha em branco
      if (!line.trim()) { closeList(); i++; continue; }

      // parágrafo (linhas consecutivas viram um bloco só, com quebras)
      closeList();
      const buf = [];
      while (i < lines.length && lines[i].trim()
             && !/^\s*([-*•]\s|\d+[.)]\s|>|#{1,3}\s|```)/.test(lines[i])
             && !/^\s*(---|___|\*\*\*)\s*$/.test(lines[i])) buf.push(lines[i++]);
      const p = el('p');
      buf.forEach((l, k) => { if (k) p.append(el('br')); inline(l, p); });
      frag.append(p);
    }
    return frag;
  }

  /** Versão sem marcação, para prévias e resultados de busca. */
  function plain(src) {
    return String(src ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s*[-*•]\s+/gm, '• ')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*#{1,3}\s+/gm, '')
      .replace(/\|\|([\s\S]+?)\|\|/g, '$1')
      .replace(/\*\*\*|\*\*|__|~~|[`*_]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  window.MD = { render, plain };
})();
