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
    const pronto = () => {
      const c = acorda();
      if (c?.state === 'suspended') c.resume();
      return c;
    };

    const tom = (freq, ini, dur, tipo, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = tipo; o.frequency.setValueAtTime(freq, ini);
      g.gain.setValueAtTime(0.0001, ini);
      g.gain.exponentialRampToValueAtTime(vol, ini + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, ini + dur);
      o.connect(g); g.connect(master);
      o.start(ini); o.stop(ini + dur + 0.02);
    };

    const estalo = (ini, vol, corte, dec = 0.035) => {
      const n = ctx.createBufferSource(); n.buffer = ruido;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = corte;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, ini);
      g.gain.exponentialRampToValueAtTime(0.0001, ini + dec);
      n.connect(f); f.connect(g); g.connect(master);
      n.start(ini); n.stop(ini + dec + 0.02);
    };

    return {
      get on() { return on; },

      /** tecla mecânica: estalo agudo + batida curta */
      envio() {
        if (!on || !pronto()) return;
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

      /**
       * Tecla digitada: versão bem mais fraca e curta que a do envio, com
       * afinação sorteada a cada toque — teclas idênticas em sequência soam
       * mecânicas demais. Espaço sai mais grave, apagar sai mais abafado.
       */
      tecla(tipo) {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        const espaco = tipo === 'space', apaga = tipo === 'back';
        estalo(t, espaco ? 0.075 : apaga ? 0.04 : 0.055,
          espaco ? 1500 : apaga ? 1100 : 2600 + Math.random() * 1400, 0.016);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        const f0 = espaco ? 150 : apaga ? 220 : 360 + Math.random() * 140;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.018);
        g.gain.setValueAtTime(espaco ? 0.045 : 0.03, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.04);
      },

      /** transmissão recebida em outro canal: dois tons curtos */
      recebida() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        tom(880, t, 0.07, 'triangle', 0.09);
        tom(1320, t + 0.085, 0.09, 'triangle', 0.07);
      },

      /** aviso de erro */
      falha() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        tom(200, t, 0.12, 'sawtooth', 0.08);
        tom(140, t + 0.1, 0.16, 'sawtooth', 0.07);
      },

      /**
       * Acesso liberado: três tons subindo, limpos e curtos. É o contrário
       * exato do alarme — onde o negado usa dente-de-serra grave e ruído, aqui
       * é triângulo agudo e nenhuma estática, para o acerto soar como
       * fechadura abrindo e não como mais um aviso.
       */
      permitido() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        estalo(t, 0.07, 3200, 0.02);                      // o destravar
        [[523.25, 0], [659.25, 0.07], [987.77, 0.14]]     // dó, mi, si
          .forEach(([f, off]) => tom(f, t + off, 0.15, 'triangle', 0.1));
        tom(1975.5, t + 0.2, 0.26, 'sine', 0.045);        // brilho fechando
      },

      /**
       * Acesso negado: um som só, sem voz nenhuma. Duas batidas secas na
       * frente e, por baixo, uma buzina que despenca de tom — dois
       * dentes-de-serra desafinados em meio tom passando por um anel de
       * modulação a 41 Hz. A aspereza vem do batimento entre eles e do anel,
       * não de ruído empilhado por cima. Meio segundo, começo ao fim.
       */
      negado() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;

        // anel de modulação: o oscilador é quem abre o ganho, do zero
        const anel = ctx.createGain();
        anel.gain.value = 0;
        const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
        lfo.type = 'square'; lfo.frequency.value = 41;
        lfoG.gain.value = 1;
        lfo.connect(lfoG); lfoG.connect(anel.gain);
        anel.connect(master);
        lfo.start(t); lfo.stop(t + 0.52);

        // a buzina caindo
        [1, 1.031].forEach((desafina, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(210 * desafina, t);
          o.frequency.exponentialRampToValueAtTime(74 * desafina, t + 0.42);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(i ? 0.09 : 0.13, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
          o.connect(g); g.connect(anel);
          o.start(t); o.stop(t + 0.5);
        });

        // as batidas, para o golpe chegar antes da queda
        for (let i = 0; i < 2; i++) {
          const ini = t + i * 0.1;
          estalo(ini, 0.2, 900, 0.04);
          tom(98, ini, 0.09, 'square', 0.11);
        }
        tom(52, t + 0.06, 0.34, 'sine', 0.12);      // sub grave fechando
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

  // ---------- som leve a cada tecla ----------
  const DIGITAVEL = n => n && (n.tagName === 'TEXTAREA' ||
    (n.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'submit', 'button', 'file'].includes(n.type)));
  let ultimaTecla = 0;

  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (!DIGITAVEL(e.target)) return;
    const k = e.key;
    if (k === 'Enter') return;                       // o envio tem som próprio
    if (k !== ' ' && k !== 'Backspace' && k !== 'Delete' && k.length !== 1) return;
    const agora = performance.now();
    if (agora - ultimaTecla < 16) return;            // segura o digitador veloz
    ultimaTecla = agora;
    SFX.tecla(k === ' ' ? 'space' : (k === 'Backspace' || k === 'Delete') ? 'back' : 'key');
  }, true);

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
  // Só roda na tela de acesso: atrás do chat ela disputa atenção com o texto.
  function chuva() {
    const cv = q('#rain');
    if (!cv) return null;
    if (calmo()) { cv.remove(); return null; }
    const ctx = cv.getContext('2d');
    if (!ctx) { cv.remove(); return null; }
    let ativa = true;

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

    // O laço para de verdade quando a chuva sai de cena. Antes ele seguia
    // pedindo quadro para sempre só para desistir dentro do callback: não
    // desenhava nada, mas mantinha a página "animando" 60 vezes por segundo e
    // nunca deixava o navegador dormir.
    const raiz = document.documentElement;
    let ultimo = 0, rodando = false;
    const quadro = t => {
      if (!ativa) { rodando = false; return; }
      requestAnimationFrame(quadro);
      if (document.hidden || raiz.classList.contains('no-crt') || t - ultimo < 55) return;
      ultimo = t;                                          // ~18 fps, poupa bateria
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
    const liga = () => { if (!rodando) { rodando = true; requestAnimationFrame(quadro); } };
    liga();

    return {
      visivel(v) {
        ativa = !!v;
        cv.classList.toggle('hide', !v);
        if (v) { medir(); liga(); }   // redesenha limpo ao voltar para o acesso
      },
    };
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

  // ========================================================= tela negada
  /**
   * A tela inteira pisca em vermelho. A camada é criada uma vez e fica
   * inerte; reiniciar a animação exige tirar a classe, forçar o navegador a
   * recalcular o estilo e pôr de volta — sem isso, dois erros seguidos só
   * animariam o primeiro.
   */
  let flash;
  function negaTela() {
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'nega-flash';
      flash.setAttribute('aria-hidden', 'true');
      document.body.append(flash);
    }
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
  }

  hud(); cursor(); botoes();
  const rain = chuva();

  window.FX = { decodifica, bootLine, som: SFX, rain, negaTela };
})();
