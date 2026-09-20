/* ===========================================================================
   fx.js — ambientação: som, texto que se decodifica, linha de boot,
   relógio/status na barra lateral, chuva de caracteres e cursor de bloco.

   Carrega antes do app.js, então não usa nada dele em tempo de carga.
   Tudo é opcional e respeita `prefers-reduced-motion`.
   =========================================================================== */
(() => {
  const q = s => document.querySelector(s);
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const calmo = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  // ========================================================= som
  // Gerado na hora com Web Audio: nenhum arquivo, nenhuma requisição.
  const SFX = (() => {
    let ctx, master, ruido, humNode;
    let on = pref('cit.sfx', '1') !== '0';

    function acorda() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = on ? 0.9 : 0;
      master.connect(ctx.destination);
      // 2s de ruído branco, reaproveitado por todos os efeitos
      ruido = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = ruido.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return ctx;
    }

    const tom = (freq, ini, dur, tipo, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = tipo; o.frequency.setValueAtTime(freq, ini);
      g.gain.setValueAtTime(0.0001, ini);
      g.gain.exponentialRampToValueAtTime(vol, ini + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, ini + dur);
      o.connect(g); g.connect(master);
      o.start(ini); o.stop(ini + dur + 0.02);
    };

    const estalo = (ini, vol, corte) => {
      const n = ctx.createBufferSource(); n.buffer = ruido;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = corte;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, ini);
      g.gain.exponentialRampToValueAtTime(0.0001, ini + 0.035);
      n.connect(f); f.connect(g); g.connect(master);
      n.start(ini); n.stop(ini + 0.05);
    };

    return {
      get on() { return on; },

      /** tecla mecânica: estalo agudo + batida curta */
      envio() {
        if (!on || !acorda()) return;
        const t = ctx.currentTime;
        estalo(t, 0.22, 2200);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(240, t);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.05);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.08);
      },

      /** transmissão recebida em outro canal: dois tons curtos */
      recebida() {
        if (!on || !acorda()) return;
        const t = ctx.currentTime;
        tom(880, t, 0.07, 'triangle', 0.09);
        tom(1320, t + 0.085, 0.09, 'triangle', 0.07);
      },

      /** aviso de erro */
      falha() {
        if (!on || !acorda()) return;
        const t = ctx.currentTime;
        tom(200, t, 0.12, 'sawtooth', 0.08);
        tom(140, t + 0.1, 0.16, 'sawtooth', 0.07);
      },

      /** chiado grave de fundo, em laço */
      chiado() {
        if (!acorda() || humNode) return;
        humNode = ctx.createBufferSource();
        humNode.buffer = ruido; humNode.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 0.6;
        const g = ctx.createGain(); g.gain.value = 0.022;
        humNode.connect(f); f.connect(g); g.connect(master);
        humNode.start();
      },

      alterna() {
        on = !on;
        save('cit.sfx', on ? '1' : '0');
        if (on) { acorda(); ctx?.resume?.(); this.chiado(); }
        if (master) master.gain.value = on ? 0.9 : 0;
        return on;
      },
    };
  })();

  // O navegador só libera áudio depois de um gesto do usuário.
  const liberar = () => {
    if (SFX.on) { SFX.chiado(); }
    removeEventListener('pointerdown', liberar);
    removeEventListener('keydown', liberar);
  };
  addEventListener('pointerdown', liberar);
  addEventListener('keydown', liberar);

  // ========================================================= texto decodificando
  const LIXO = '▚▞█▓▒░#@%&$/\\|<>=+-*01¥§¤';

  function decodifica(node, texto, ms = 420, espelhaData) {
    const fim = () => {
      node.textContent = texto;
      if (espelhaData) node.dataset.text = texto;
    };
    if (calmo() || !texto) return fim();
    const ini = performance.now(), n = texto.length;
    const passo = agora => {
      const p = Math.min(1, (agora - ini) / ms);
      const fixos = Math.floor(p * n);
      let out = texto.slice(0, fixos);
      for (let i = fixos; i < n; i++) {
        out += texto[i] === ' ' ? ' ' : LIXO[(Math.random() * LIXO.length) | 0];
      }
      node.textContent = out;
      if (espelhaData) node.dataset.text = out;
      if (p < 1) requestAnimationFrame(passo); else fim();
    };
    requestAnimationFrame(passo);
  }

  // ========================================================= linha de boot
  const ETAPAS = ['estabelecendo enlace', 'sincronizando chaves', 'validando credencial',
    'abrindo canal seguro', 'varrendo interferência', 'negociando cifra'];
  let bootSeq = 0;

  function bootLine(rotulo) {
    const box = q('#boot-line');
    if (!box) return;
    const meu = ++bootSeq;
    const txt = `> ${ETAPAS[(Math.random() * ETAPAS.length) | 0]}......... ${String(rotulo).toUpperCase()} :: ENLACE ESTÁVEL`;
    box.classList.remove('hide', 'fade');
    box.textContent = '';
    if (calmo()) {
      box.textContent = txt;
      setTimeout(() => { if (meu === bootSeq) box.classList.add('fade'); }, 700);
      return;
    }
    let i = 0;
    const bate = () => {
      if (meu !== bootSeq) return;
      box.textContent = txt.slice(0, ++i);
      if (i < txt.length) setTimeout(bate, 9);
      else setTimeout(() => { if (meu === bootSeq) box.classList.add('fade'); }, 900);
    };
    bate();
  }

  // ========================================================= relógio e status
  function hud() {
    const cl = q('#hud-clock'), st = q('#hud-stat');
    if (!cl || !st) return;
    const dois = n => String(n).padStart(2, '0');

    const mk = t => { const s = document.createElement('span'); s.textContent = t; return s; };
    const hh = mk(''), mm = mk(''), ss = mk('');
    const c1 = mk(':'), c2 = mk(':');
    c1.className = c2.className = 'pisca';
    cl.append(hh, c1, mm, c2, ss);

    const tique = () => {
      const d = new Date();
      hh.textContent = dois(d.getHours());
      mm.textContent = dois(d.getMinutes());
      ss.textContent = dois(d.getSeconds());
    };
    tique();
    setInterval(tique, 1000);

    const ENLACE = ['ESTÁVEL', 'ESTÁVEL', 'ESTÁVEL', 'OSCILANDO'];
    const CIFRA = ['AES-512', 'AES-512', 'QNT-7'];
    const linha = (rot, val, cls) => {
      const d = document.createElement('div');
      d.append(mk(rot + ': '));
      const v = mk(val); v.className = 'v ' + (cls || '');
      d.append(v);
      st.append(d);
      return v;
    };
    const vEnlace = linha('ENLACE', 'ESTÁVEL', 'ok');
    const vRuido = linha('RUÍDO', '0.3%');
    const vCifra = linha('CIFRA', 'AES-512');

    const mexe = () => {
      const e = ENLACE[(Math.random() * ENLACE.length) | 0];
      vEnlace.textContent = e;
      vEnlace.className = 'v ' + (e === 'ESTÁVEL' ? 'ok' : 'alerta');
      vRuido.textContent = (Math.random() * 1.8).toFixed(1) + '%';
      vCifra.textContent = CIFRA[(Math.random() * CIFRA.length) | 0];
    };
    setInterval(mexe, 19000);
  }

  // ========================================================= chuva de caracteres
  function chuva() {
    const cv = q('#rain');
    if (!cv) return;
    if (calmo()) { cv.remove(); return; }
    const ctx = cv.getContext('2d');
    if (!ctx) { cv.remove(); return; }

    const GLIFOS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789#$%&@/\\<>=+';
    const corpo = 15;
    let w = 0, h = 0, cols = 0, ys = [];

    const medir = () => {
      w = cv.width = innerWidth;
      h = cv.height = innerHeight;
      cols = Math.ceil(w / corpo);
      ys = Array.from({ length: cols }, () => Math.random() * h);
      ctx.fillStyle = '#04020c';
      ctx.fillRect(0, 0, w, h);
    };
    medir();
    addEventListener('resize', medir);

    let ultimo = 0;
    const quadro = t => {
      requestAnimationFrame(quadro);
      if (document.hidden || t - ultimo < 55) return;   // ~18 fps, poupa bateria
      ultimo = t;
      ctx.fillStyle = 'rgba(4,2,12,.11)';               // rastro que some
      ctx.fillRect(0, 0, w, h);
      ctx.font = corpo + "px 'JetBrains Mono',monospace";
      for (let i = 0; i < cols; i++) {
        ctx.fillStyle = Math.random() < 0.03 ? '#9b5cff' : '#45e3ff';
        ctx.fillText(GLIFOS[(Math.random() * GLIFOS.length) | 0], i * corpo, ys[i]);
        ys[i] += corpo;
        if (ys[i] > h && Math.random() > 0.972) ys[i] = 0;
      }
    };
    requestAnimationFrame(quadro);
  }

  // ========================================================= cursor de bloco
  function cursor() {
    const ta = q('#msg'), hint = q('#caret-hint');
    if (!ta || !hint) return;
    const ver = () => hint.classList.toggle('hide', ta.value.length > 0);
    ta.addEventListener('input', ver);
    ta.addEventListener('blur', ver);
    ver();
  }

  // ========================================================= botões
  function botoes() {
    const bs = q('#fx-sfx'), bc = q('#fx-crt');
    if (bs) {
      bs.classList.toggle('off', !SFX.on);
      bs.onclick = () => bs.classList.toggle('off', !SFX.alterna());
    }
    if (bc) {
      bc.classList.toggle('off', pref('cit.crt', '1') === '0');
      bc.onclick = () => bc.classList.toggle('off', !window.CRT?.toggle());
    }
  }

  hud(); chuva(); cursor(); botoes();

  window.FX = { decodifica, bootLine, som: SFX };
})();
