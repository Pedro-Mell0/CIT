/* ===========================================================================
   fx.js — ambientação da Vanguarda: som de garagem, texto que se decodifica,
   linha de rádio, relógio e conta-giros, e a estrada de fundo onde um carro
   desvia dos obstáculos.

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
    let ctx, master, ruido, motorNode;
    let on = pref('vgd.sfx', '1') !== '0';

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

    /**
     * Acelerada. É a base sonora da casa: dois dentes-de-serra desafinados
     * entre si subindo de tom, com um filtro passa-baixa abrindo junto — é o
     * desafino que dá o ronco, e o filtro que dá a impressão de o escapamento
     * "abrir". `peso` controla se é um toque no acelerador ou a arrancada.
     */
    const acelera = (ini, dur, f0, f1, vol) => {
      const filtro = ctx.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.setValueAtTime(420, ini);
      filtro.frequency.exponentialRampToValueAtTime(2600, ini + dur * 0.8);
      filtro.Q.value = 2.4;
      filtro.connect(master);

      [1, 1.017, 0.503].forEach((mult, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i === 2 ? 'square' : 'sawtooth';
        o.frequency.setValueAtTime(f0 * mult, ini);
        o.frequency.exponentialRampToValueAtTime(f1 * mult, ini + dur);
        g.gain.setValueAtTime(0.0001, ini);
        g.gain.exponentialRampToValueAtTime(vol * (i === 2 ? 0.6 : 1), ini + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ini + dur + 0.1);
        o.connect(g); g.connect(filtro);
        o.start(ini); o.stop(ini + dur + 0.14);
      });
    };

    /** Cantada de pneu: ruído estreito e agudo, varrendo para baixo. */
    const derrapa = (ini, dur, vol) => {
      const n = ctx.createBufferSource(); n.buffer = ruido; n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 9;
      f.frequency.setValueAtTime(2300, ini);
      f.frequency.exponentialRampToValueAtTime(900, ini + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ini);
      g.gain.exponentialRampToValueAtTime(vol, ini + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, ini + dur);
      n.connect(f); f.connect(g); g.connect(master);
      n.start(ini); n.stop(ini + dur + 0.05);
    };

    return {
      get on() { return on; },

      /** publicar informe: a batida seca de uma troca de marcha */
      envio() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        estalo(t, 0.2, 1900);
        tom(150, t, 0.05, 'square', 0.1);
        estalo(t + 0.055, 0.12, 2600, 0.025);
      },

      /**
       * Tecla digitada: bem mais fraca e curta que a do envio, com afinação
       * sorteada a cada toque — teclas idênticas em sequência soam mecânicas
       * demais. Espaço sai mais grave, apagar sai mais abafado.
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

      /** informe novo em outro canal: dois bipes de rádio da unidade */
      recebida() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        tom(1180, t, 0.06, 'square', 0.055);
        tom(880, t + 0.08, 0.09, 'square', 0.05);
      },

      /** aviso de erro */
      falha() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        tom(190, t, 0.12, 'sawtooth', 0.08);
        tom(132, t + 0.1, 0.16, 'sawtooth', 0.07);
      },

      /** partida: o motor pega e sobe de giro. É o som de "entra". */
      permitido() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        estalo(t, 0.07, 1200, 0.03);            // a chave virando
        acelera(t + 0.04, 0.55, 70, 320, 0.085);
        tom(1320, t + 0.5, 0.14, 'triangle', 0.05);
      },

      /** largada da prova: a mesma partida, mais longa e mais alta */
      largada() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        [0, 0.16, 0.32].forEach(d => tom(760, t + d, 0.1, 'square', 0.05));
        acelera(t + 0.5, 0.9, 80, 520, 0.1);
      },

      /**
       * Barrado: cantada de pneu e buzina caindo de tom. Dois dentes-de-serra
       * desafinados em meio tom passando por um anel de modulação a 41 Hz — a
       * aspereza vem do batimento entre eles, não de ruído empilhado por cima.
       */
      negado() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        derrapa(t, 0.42, 0.11);

        const anel = ctx.createGain();
        anel.gain.value = 0;
        const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
        lfo.type = 'square'; lfo.frequency.value = 41;
        lfoG.gain.value = 1;
        lfo.connect(lfoG); lfoG.connect(anel.gain);
        anel.connect(master);
        lfo.start(t); lfo.stop(t + 0.52);

        [1, 1.031].forEach((desafina, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(210 * desafina, t + 0.06);
          o.frequency.exponentialRampToValueAtTime(74 * desafina, t + 0.46);
          g.gain.setValueAtTime(0.0001, t + 0.06);
          g.gain.exponentialRampToValueAtTime(i ? 0.08 : 0.12, t + 0.08);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          o.connect(g); g.connect(anel);
          o.start(t + 0.06); o.stop(t + 0.52);
        });
        tom(52, t + 0.08, 0.34, 'sine', 0.11);      // sub grave fechando
      },

      /** raspão num cone: uma batida seca e o pneu reclamando de leve */
      raspada() {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;
        estalo(t, 0.13, 800, 0.06);
        tom(85, t, 0.1, 'square', 0.075);
        derrapa(t + 0.03, 0.2, 0.055);
      },

      /**
       * Partida de um motor turbinado, em quatro tempos: o arranque girando
       * em pulsos graves, o motor pegando, a acelerada cheia, e a válvula de
       * alívio soltando no fim. Por cima de tudo, o assobio da turbina subindo
       * junto com o giro — é ele que dá o caráter de turbo, e não o volume.
       */
      turbo(dur) {
        if (!on || !pronto()) return;
        const t = ctx.currentTime;

        // arranque: o motor de partida engasgando antes de pegar
        for (let i = 0; i < 6; i++) {
          const ini = t + i * 0.09;
          tom(56 + Math.random() * 12, ini, 0.07, 'square', 0.075);
          estalo(ini, 0.055, 480, 0.035);
        }

        const pega = t + 0.58;
        const subida = Math.max(0.8, dur - 1.25);
        acelera(pega, 0.42, 52, 190, 0.1);            // o motor segurando
        acelera(pega + 0.42, subida, 140, 640, 0.13); // a acelerada imponente

        // assobio da turbina, acompanhando o giro
        const sopro = ctx.createOscillator(), sg = ctx.createGain(), sf = ctx.createBiquadFilter();
        sopro.type = 'sine';
        sf.type = 'bandpass'; sf.Q.value = 7;
        [sopro.frequency, sf.frequency].forEach(p => {
          p.setValueAtTime(1100, pega);
          p.exponentialRampToValueAtTime(5400, pega + subida);
        });
        sg.gain.setValueAtTime(0.0001, pega);
        sg.gain.exponentialRampToValueAtTime(0.04, pega + 0.7);
        sg.gain.exponentialRampToValueAtTime(0.0001, pega + subida + 0.12);
        sopro.connect(sf); sf.connect(sg); sg.connect(master);
        sopro.start(pega); sopro.stop(pega + subida + 0.2);

        // a válvula soltando a pressão, e o pneu cantando na saída
        const fim = t + dur - 0.55;
        estalo(fim, 0.17, 2800, 0.14);
        tom(70, fim, 0.2, 'sine', 0.09);
        derrapa(fim + 0.06, 0.52, 0.1);
      },

      /** marcha lenta de fundo, em laço */
      motor() {
        if (!acorda() || motorNode) return;
        motorNode = ctx.createBufferSource();
        motorNode.buffer = ruido; motorNode.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 130; f.Q.value = 0.8;
        const g = ctx.createGain(); g.gain.value = 0.026;
        // o leve tremor do motor parado: sem isso o laço vira só um chiado
        const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
        lfo.type = 'sine'; lfo.frequency.value = 7.5;
        lfoG.gain.value = 0.009;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        lfo.start();
        motorNode.connect(f); f.connect(g); g.connect(master);
        motorNode.start();
      },

      alterna() {
        on = !on;
        save('vgd.sfx', on ? '1' : '0');
        if (on) { acorda(); ctx?.resume?.(); this.motor(); }
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
    if (SFX.on) SFX.motor();
    removeEventListener('pointerdown', liberar);
    removeEventListener('keydown', liberar);
  };
  addEventListener('pointerdown', liberar);
  addEventListener('keydown', liberar);

  // ========================================================= texto decodificando
  const LIXO = '▚▞█▓▒░#@%&$/\\|<>=+-*01¤§';

  function decodifica(node, texto, ms = 420) {
    const fim = () => { node.textContent = texto; };
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
      if (p < 1) requestAnimationFrame(passo); else fim();
    };
    requestAnimationFrame(passo);
  }

  // ========================================================= linha de rádio
  const ETAPAS = ['sintonizando a frequência', 'conferindo a escuta', 'liberando o eixo',
    'checando telemetria', 'abrindo o canal da unidade', 'confirmando posição'];
  let bootSeq = 0;

  function bootLine(rotulo) {
    const box = q('#boot-line');
    if (!box) return;
    const meu = ++bootSeq;
    const txt = `> ${ETAPAS[(Math.random() * ETAPAS.length) | 0]}......... ${String(rotulo).toUpperCase()} :: NA ESCUTA`;
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

  // ========================================================= painel lateral
  function hud() {
    const cl = q('#hud-clock'), st = q('#hud-stat'), bar = q('#hud-bar');
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

    const linha = (rot, val, cls) => {
      const d = document.createElement('div');
      d.append(mk(rot + ': '));
      const v = mk(val); v.className = 'v ' + (cls || '');
      d.append(v);
      st.append(d);
      return v;
    };
    const vVel = linha('VEL', '0 km/h');
    const vRpm = linha('RPM', '1.2k');
    const vMar = linha('MAR', 'N');
    const vTmp = linha('TEMP', '82°', 'ok');

    // O painel não mede nada de verdade — é cenário. O que ele faz é não
    // mentir de forma grosseira: a marcha acompanha a faixa de velocidade e o
    // giro acompanha a marcha, então o conjunto nunca mostra 2ª a 240 km/h.
    const mexe = () => {
      const vel = 40 + Math.floor(Math.random() * 230);
      const marcha = vel < 60 ? 2 : vel < 110 ? 3 : vel < 170 ? 4 : vel < 220 ? 5 : 6;
      const giro = 2.2 + (vel % 60) / 60 * 5.4;
      const temp = 78 + Math.floor(Math.random() * 28);
      vVel.textContent = vel + ' km/h';
      vRpm.textContent = giro.toFixed(1) + 'k';
      vMar.textContent = String(marcha);
      vTmp.textContent = temp + '°';
      vTmp.className = 'v ' + (temp > 98 ? 'alerta' : 'ok');
      if (bar) bar.style.width = Math.min(100, giro / 8 * 100).toFixed(0) + '%';
    };
    mexe();
    setInterval(mexe, 2600);
  }

  // ========================================================= a estrada
  /**
   * Fica só na tela de acesso: atrás dos informes ela disputaria atenção com o
   * texto. É uma estrada em perspectiva com um carro que escolhe sozinho a
   * faixa livre — quando um obstáculo aparece na dele, ele desvia.
   *
   * A projeção é a de sempre: quanto maior a distância `z`, menor tudo fica.
   * Cada ponto a uma distância z cai em `horizonte + K/z`, e a meia-largura da
   * pista ali é `W/z`. Com isso a pista nasce num ponto no horizonte e se abre
   * até a borda de baixo, sem nenhuma conta de câmera de verdade.
   */
  function estrada() {
    const cv = q('#road');
    if (!cv) return null;
    if (calmo()) { cv.remove(); return null; }
    const ctx = cv.getContext('2d');
    if (!ctx) { cv.remove(); return null; }

    const FAIXAS = [-1, 0, 1];
    // Z_PERTO fica um pouco abaixo da borda de baixo: a pista sai da tela em
    // vez de terminar numa linha reta atravessada no rodapé.
    const Z_LONGE = 9, Z_CARRO = 1.08, Z_PERTO = 0.92;

    let w = 0, h = 0, cx = 0, horizonte = 0, K = 0, W = 0;
    let ativa = true, turbo = 0;
    let rolagem = 0;                       // anda com o tempo: é o que dá o movimento
    let obstaculos = [];                   // { faixa, z }
    let faixaCarro = 0, faixaAlvo = 0;     // a primeira persegue a segunda

    // ---- volante nas mãos de quem olha ----
    // Sozinho o carro desvia; clicando fora do cartão de acesso, quem dirige é
    // o visitante. Clicar de volta no cartão devolve o volante ao piloto
    // automático, para a página não ficar engolindo teclas de quem só quer
    // digitar a senha.
    let manual = false, impulso = 0, batida = 0;
    const teclas = new Set();
    const LATERAL = 2.4;                   // faixas por segundo, no volante
    const DIGITANDO = n => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);

    addEventListener('pointerdown', e => {
      const noCartao = !!e.target.closest?.('.card, #modal, #app');
      if (noCartao === !manual) return;    // já está no modo certo
      manual = !noCartao;
      if (!manual) { teclas.clear(); impulso = 0; faixaAlvo = faixaCarro; }
    });

    addEventListener('keydown', e => {
      if (!manual || DIGITANDO(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!'wasd'.includes(k) && !k.startsWith('arrow')) return;
      teclas.add(k);
      e.preventDefault();                  // senão as setas rolam a página
    });
    addEventListener('keyup', e => teclas.delete(e.key.toLowerCase()));
    addEventListener('blur', () => teclas.clear());

    const medir = () => {
      w = cv.width = innerWidth;
      h = cv.height = innerHeight;
      cx = w / 2;
      // Horizonte baixo de propósito. Com ele lá em cima, o trecho de pista
      // que interessa — o carro e os cones que ele desvia — cai exatamente
      // atrás do cartão de acesso, que fica no meio da tela: dava para ver a
      // estrada e não dava para ver nada acontecer nela. Jogando o horizonte
      // para baixo, a ação acontece na faixa livre embaixo do cartão.
      horizonte = h * 0.58;
      K = h - horizonte;
      // meia-largura da pista a uma distância z é W/z
      W = w * 0.22;
    };
    medir();
    addEventListener('resize', medir);

    const telaY = z => horizonte + K / z;
    const meia = z => W / z;
    const telaX = (faixa, z) => cx + faixa * (meia(z) * 0.62);

    /** Escolhe a faixa mais próxima que esteja limpa daqui a alguns metros. */
    function decide() {
      const perigo = new Set(
        obstaculos.filter(o => o.z > Z_CARRO && o.z < Z_CARRO + 3.6).map(o => o.faixa));
      if (!perigo.has(faixaAlvo)) return;
      const livres = FAIXAS.filter(f => !perigo.has(f));
      if (!livres.length) return;
      livres.sort((a, b) => Math.abs(a - faixaAlvo) - Math.abs(b - faixaAlvo));
      faixaAlvo = livres[0];
    }

    /**
     * No volante não existe desvio automático, então o cone tem de significar
     * alguma coisa: encostar nele derruba o cone, canta pneu e deixa a lataria
     * piscando. Sem placar e sem punição — é enfeite de tela de login, não um
     * jogo a ser vencido.
     */
    function confere() {
      obstaculos = obstaculos.filter(o => {
        const perto = o.z < Z_CARRO + 0.3 && o.z > Z_CARRO - 0.25;
        if (!perto || Math.abs(o.faixa - faixaCarro) > 0.5) return true;
        batida = 0.5;
        SFX.raspada();
        return false;
      });
    }

    /** Lembrete discreto de quem está com o volante. */
    function dica() {
      ctx.font = "11px 'JetBrains Mono',monospace";
      ctx.fillStyle = 'rgba(255,157,46,.75)';
      ctx.fillText('WASD  ·  clique no cartão para soltar o volante', 16, h - 16);
    }

    function nasce() {
      // nunca fecha as três faixas de uma vez: o carro tem de ter para onde ir
      const ocupadas = obstaculos.filter(o => o.z > Z_LONGE - 2.4).map(o => o.faixa);
      const livres = FAIXAS.filter(f => !ocupadas.includes(f));
      if (livres.length <= 1) return;
      obstaculos.push({ faixa: livres[(Math.random() * livres.length) | 0], z: Z_LONGE });
    }

    function pista() {
      // asfalto
      ctx.beginPath();
      ctx.moveTo(cx - meia(Z_LONGE), telaY(Z_LONGE));
      ctx.lineTo(cx + meia(Z_LONGE), telaY(Z_LONGE));
      ctx.lineTo(cx + meia(Z_PERTO), telaY(Z_PERTO));
      ctx.lineTo(cx - meia(Z_PERTO), telaY(Z_PERTO));
      ctx.closePath();
      ctx.fillStyle = '#1d1309';
      ctx.fill();

      // bordas
      ctx.strokeStyle = '#ff9d2e';
      ctx.lineWidth = 2;
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(cx + s * meia(Z_LONGE), telaY(Z_LONGE));
        ctx.lineTo(cx + s * meia(Z_PERTO), telaY(Z_PERTO));
        ctx.stroke();
      });

      // tracejado das duas divisórias, em perspectiva: cada traço é um trecho
      // entre duas distâncias, e o padrão inteiro caminha com a rolagem
      ctx.fillStyle = '#ffe6cc';
      for (let i = 0; i < 20; i++) {
        const base = (i * 0.8 + (rolagem % 0.8));
        const z1 = Z_LONGE - base, z2 = z1 - 0.38;
        if (z2 < Z_PERTO) continue;
        [-0.34, 0.34].forEach(off => {
          const x1 = cx + off * meia(z1) * 1.9, x2 = cx + off * meia(z2) * 1.9;
          const e1 = Math.max(0.6, meia(z1) * 0.012), e2 = Math.max(0.8, meia(z2) * 0.012);
          ctx.beginPath();
          ctx.moveTo(x1 - e1, telaY(z1)); ctx.lineTo(x1 + e1, telaY(z1));
          ctx.lineTo(x2 + e2, telaY(z2)); ctx.lineTo(x2 - e2, telaY(z2));
          ctx.closePath(); ctx.fill();
        });
      }
    }

    function cone(o) {
      const y = telaY(o.z), x = telaX(o.faixa, o.z);
      const s = Math.max(3, meia(o.z) * 0.085);
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.7);
      ctx.lineTo(x + s * 0.8, y);
      ctx.lineTo(x - s * 0.8, y);
      ctx.closePath();
      ctx.fillStyle = '#ff5c1a';
      ctx.fill();
      ctx.fillStyle = '#ffe6cc';
      ctx.fillRect(x - s * 0.5, y - s * 0.95, s, Math.max(1, s * 0.26));
    }

    /**
     * O carro é visto por trás, subindo a pista: o que aparece é a traseira,
     * com as lanternas acesas, e o facho dos faróis varrendo o asfalto lá na
     * frente. Tudo em quadriláteros de quatro pontos, em vez de retângulos —
     * é o que dá à lataria a forma que afunila para cima.
     */
    function carro() {
      const z = Z_CARRO, y = telaY(z), x = telaX(faixaCarro, z);
      const s = meia(z) * 0.075;
      const quad = (pontos, cor) => {
        ctx.fillStyle = cor;
        ctx.beginPath();
        ctx.moveTo(x + pontos[0] * s, y + pontos[1] * s);
        for (let i = 2; i < pontos.length; i += 2) ctx.lineTo(x + pontos[i] * s, y + pontos[i + 1] * s);
        ctx.closePath();
        ctx.fill();
      };

      // sombra no asfalto, para ele não parecer colado na tela
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.45, s * 2.7, s * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // o facho vai antes, para a lataria ficar por cima dele
      const facho = ctx.createLinearGradient(x, y - s * 11, x, y);
      facho.addColorStop(0, 'rgba(74,217,255,0)');
      facho.addColorStop(1, 'rgba(74,217,255,.17)');
      quad([-1.2, -1.4, -5, -11, 5, -11, 1.2, -1.4], facho);

      ctx.fillStyle = '#120b05';                                   // rodas
      ctx.fillRect(x - s * 2.6, y - s * 1.1, s * 0.75, s * 1.4);
      ctx.fillRect(x + s * 1.85, y - s * 1.1, s * 0.75, s * 1.4);

      // a lataria pisca quando raspa num cone
      const lata = batida > 0 && Math.floor(batida * 14) % 2 ? '#ff3b5c' : '#ff7a2e';
      quad([-1.9, -1.9, 1.9, -1.9, 2.3, 0.2, -2.3, 0.2], lata);        // carroceria
      quad([-1.25, -3.2, 1.25, -3.2, 1.7, -1.9, -1.7, -1.9], '#1d1309'); // cabine
      quad([-1, -3, 1, -3, 1.35, -2.15, -1.35, -2.15], 'rgba(74,217,255,.5)'); // vidro

      ctx.fillStyle = '#ff3b5c';                                   // lanternas
      ctx.fillRect(x - s * 2.05, y - s * 1.45, s * 0.95, s * 0.5);
      ctx.fillRect(x + s * 1.1, y - s * 1.45, s * 0.95, s * 0.5);
    }

    // O laço para de verdade quando a estrada sai de cena. Antes ele seguiria
    // pedindo quadro para sempre só para desistir dentro do callback: não
    // desenharia nada, mas manteria a página "animando" e nunca deixaria o
    // navegador dormir.
    const raiz = document.documentElement;
    let ultimo = 0, rodando = false;

    const quadro = t => {
      if (!ativa) { rodando = false; return; }
      requestAnimationFrame(quadro);
      if (document.hidden || raiz.classList.contains('no-crt') || t - ultimo < 55) return;
      const dt = Math.min(0.12, (t - ultimo) / 1000);
      ultimo = t;

      // No volante, W e S mexem no acelerador; o impulso é perseguido em vez
      // de aplicado de uma vez, senão o carro liga e desliga a cada toque.
      const querImpulso = manual
        ? (teclas.has('w') || teclas.has('arrowup') ? 1 : 0)
          - (teclas.has('s') || teclas.has('arrowdown') ? 0.6 : 0)
        : 0;
      impulso += (querImpulso - impulso) * Math.min(1, dt * 3);

      const vel = (3.1 + turbo * 7) * (1 + impulso);
      rolagem += vel * dt;
      obstaculos.forEach(o => o.z -= vel * dt);
      obstaculos = obstaculos.filter(o => o.z > Z_PERTO);
      if (Math.random() < 0.055 + turbo * 0.06) nasce();

      if (manual) {
        const lado = (teclas.has('d') || teclas.has('arrowright') ? 1 : 0)
                   - (teclas.has('a') || teclas.has('arrowleft') ? 1 : 0);
        faixaCarro = Math.max(-1.15, Math.min(1.15, faixaCarro + lado * LATERAL * dt));
        faixaAlvo = faixaCarro;            // para a volta ao automático não dar solavanco
        confere();
      } else {
        decide();
        faixaCarro += (faixaAlvo - faixaCarro) * Math.min(1, dt * 7);
      }

      ctx.fillStyle = '#0a0704';
      ctx.fillRect(0, 0, w, h);
      pista();
      // de trás para a frente: o que está perto tem de cobrir o que está longe
      obstaculos.slice().sort((a, b) => b.z - a.z).forEach(cone);
      carro();
      if (manual) dica();

      if (turbo > 0) turbo = Math.max(0, turbo - dt * 0.5);
      if (batida > 0) batida = Math.max(0, batida - dt);
    };

    const liga = () => { if (!rodando) { rodando = true; requestAnimationFrame(quadro); } };
    liga();

    return {
      visivel(v) {
        ativa = !!v;
        cv.classList.toggle('hide', !v);
        if (v) { medir(); liga(); }
      },
      acelera(seg) { turbo = 1; setTimeout(() => { turbo = 0; }, seg * 1000); },
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
      bc.classList.toggle('off', pref('vgd.crt', '1') === '0');
      bc.onclick = () => bc.classList.toggle('off', !window.CRT?.toggle());
    }
  }

  // ========================================================= tela barrada
  /**
   * A tela inteira pisca em vermelho. A camada é criada uma vez e fica inerte;
   * reiniciar a animação exige tirar a classe, forçar o navegador a recalcular
   * o estilo e pôr de volta — sem isso, dois erros seguidos só animariam o
   * primeiro.
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

  // ========================================================= 🐯 turbo
  // Três cliques seguidos no tigre: o motor dá a partida e um carro atravessa
  // a tela de lado, em drift.
  const NITRO = 3400;
  let nitrando = false;
  let pista_;

  /**
   * O carro do easter egg, visto de cima, cruzando a tela em drift. Vai numa
   * camada criada na hora, e não na estrada do fundo: assim o segredo vale em
   * qualquer tela do site, inclusive depois de entrar, onde a estrada nem está
   * desenhada.
   *
   * O truque do drift é o ângulo não acompanhar o movimento. O carro anda para
   * a direita o tempo todo, mas aponta para cima e para a esquerda no meio da
   * travessia — é esse descolamento entre para onde ele olha e para onde ele
   * vai que o olho lê como traseira saindo.
   */
  function driftada(ms) {
    const cv = document.createElement('canvas');
    cv.id = 'drift';
    cv.setAttribute('aria-hidden', 'true');
    document.body.append(cv);
    const c = cv.getContext('2d');
    if (!c) { cv.remove(); return; }

    const w = cv.width = innerWidth, h = cv.height = innerHeight;
    const s = Math.max(11, Math.min(24, w / 58));    // unidade do desenho
    const y0 = h * 0.62;
    const marcas = [], fumaca = [];
    let antes = null;                                // rodas traseiras no quadro anterior
    const ini = performance.now();

    const caixa = (x, y, lar, alt, r, cor) => {
      c.fillStyle = cor;
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, lar, alt, r); else c.rect(x, y, lar, alt);
      c.fill();
    };

    function desenha(x, y, ang) {
      c.save();
      c.translate(x, y);
      c.rotate(ang);
      c.fillStyle = 'rgba(0,0,0,.42)';
      c.beginPath(); c.ellipse(0, s * 0.45, s * 3, s * 1.25, 0, 0, Math.PI * 2); c.fill();
      [[-1.95, -1.3], [-1.95, 0.75], [1.15, -1.3], [1.15, 0.75]]
        .forEach(([rx, ry]) => caixa(rx * s, ry * s, s * 0.9, s * 0.55, s * 0.2, '#120b05'));
      caixa(-s * 2.6, -s, s * 5.2, s * 2, s * 0.5, '#ff7a2e');          // lataria
      caixa(-s * 0.95, -s * 0.74, s * 2.2, s * 1.48, s * 0.3, '#1d1309'); // teto
      caixa(-s * 0.6, -s * 0.58, s * 0.5, s * 1.16, s * 0.12, 'rgba(74,217,255,.55)');
      caixa(s * 2.28, -s * 0.8, s * 0.32, s * 0.5, s * 0.1, '#fff3d0');  // faróis
      caixa(s * 2.28, s * 0.3, s * 0.32, s * 0.5, s * 0.1, '#fff3d0');
      caixa(-s * 2.6, -s * 0.8, s * 0.28, s * 0.5, s * 0.1, '#ff3b5c');  // lanternas
      caixa(-s * 2.6, s * 0.3, s * 0.28, s * 0.5, s * 0.1, '#ff3b5c');
      c.restore();
    }

    const quadro = t => {
      const p = (t - ini) / ms;
      if (p >= 1) { cv.remove(); return; }
      requestAnimationFrame(quadro);

      const x = -w * 0.2 + p * w * 1.4;
      const y = y0 - Math.sin(p * Math.PI) * h * 0.1;
      const ang = -0.62 * Math.sin(p * Math.PI) - 0.05;

      // os pneus de trás são os que marcam e fumegam. A marca é o segmento
      // entre onde a roda estava e onde ela está: marcar só o ponto de cada
      // quadro deixaria um tracejado de bolinhas, porque a cada 16 ms o carro
      // já andou mais que a largura do pneu.
      const tras = -2 * s, cos = Math.cos(ang), sen = Math.sin(ang);
      const rodas = [-1, 1].map(lado => ({
        x: x + cos * tras - sen * lado * s,
        y: y + sen * tras + cos * lado * s,
      }));
      if (antes) rodas.forEach((r, i) => marcas.push({ de: antes[i], ate: r, a: 1 }));
      antes = rodas;
      if (Math.random() < 0.5) fumaca.push({
        x: x + cos * tras + (Math.random() - 0.5) * s * 1.6,
        y: y + sen * tras + (Math.random() - 0.5) * s * 1.6,
        r: s * 0.26, a: 0.26,
      });

      c.clearRect(0, 0, w, h);

      // Marca de pneu em âmbar apagado, e não em preto: a página é quase
      // preta, e borracha preta sobre asfalto preto simplesmente não existe
      // na tela. O tom quente lê como asfalto raspado sob luz de neon.
      c.strokeStyle = '#ff9d2e';
      c.lineWidth = s * 0.42;
      c.lineCap = 'round';
      marcas.forEach(m => {
        m.a -= 0.005;
        if (m.a <= 0) return;
        c.globalAlpha = m.a * 0.14;
        c.beginPath(); c.moveTo(m.de.x, m.de.y); c.lineTo(m.ate.x, m.ate.y); c.stroke();
      });

      c.fillStyle = '#cdbaa6';
      fumaca.forEach(f => {
        f.r += s * 0.05; f.a -= 0.013;
        if (f.a <= 0) return;
        c.globalAlpha = f.a;
        c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
      });

      c.globalAlpha = 1;
      desenha(x, y, ang);
    };
    requestAnimationFrame(quadro);
  }

  function nitro() {
    if (nitrando || calmo()) return;
    nitrando = true;
    const tela = document.createElement('div');
    tela.id = 'nitro';
    tela.setAttribute('aria-hidden', 'true');
    tela.innerHTML = '<div class="linhas"></div><div class="clarao"></div>';
    document.body.append(tela);
    void tela.offsetWidth;                  // deixa o fade de entrada pegar
    tela.classList.add('on');
    SFX.turbo(NITRO / 1000);
    pista_?.acelera(NITRO / 1000);
    // o carro entra depois do arranque, junto com o motor pegando
    setTimeout(() => driftada(1700), 620);

    setTimeout(() => tela.classList.remove('on'), NITRO);
    setTimeout(() => { tela.remove(); nitrando = false; }, NITRO + 350);
  }

  (() => {
    let n = 0, ultimo = 0;
    const bateu = () => {
      const agora = performance.now();
      n = agora - ultimo < 600 ? n + 1 : 1;   // tem de ser rápido, senão reinicia
      ultimo = agora;
      if (n >= 3) { n = 0; nitro(); }
    };
    document.querySelectorAll('.logo').forEach(l => l.addEventListener('click', bateu));
  })();

  hud(); cursor(); botoes();
  pista_ = estrada();

  window.FX = { decodifica, bootLine, som: SFX, road: pista_, negaTela };
})();
