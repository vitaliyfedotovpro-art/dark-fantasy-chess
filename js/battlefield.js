/* Dark Fantasy Chess — battlefield renderer.
 * A tilted board seen from the side (Light army on the left, Dark on the right), upright unit
 * sprites, move/capture animations and the close-up battle scene. Chess logic stays in app.js:
 * this module only draws a board array it is given and animates one move at a time.
 * Units without generated art fall back to the SVG pieces from pieces.js. */
(function () {
  'use strict';
  const { isWhite } = window.ChessLib;
  const { pieceSVG } = window.Pieces;
  const SPR = window.SPRITES || { units: {}, ground: 0.93 };
  const GROUND = SPR.ground || 0.93; // hoof/foot line inside a sprite frame
  // Camera-dependent sizes come from CSS (--bf-unit-scale, --bf-anchor-y) so the view can be tuned there.
  const SVG_SCALE = 0.5;             // fallback SVG piece size relative to the unit size
  const TYPE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const UNIT_NAMES = {
    light_pawn: 'Ополченец', light_knight: 'Рыцарь Солнца', light_bishop: 'Инквизитор',
    light_rook: 'Каменный голем', light_queen: 'Боевая жрица', light_king: 'Король-паладин',
    dark_pawn: 'Скелет', dark_knight: 'Всадник-кошмар', dark_bishop: 'Культист',
    dark_rook: 'Костяной колосс', dark_queen: 'Королева-лич', dark_king: 'Владыка демонов',
  };
  const EMBER = { light: [255, 214, 130], dark: [120, 255, 160] };

  const unitId = (p) => (isWhite(p) ? 'light_' : 'dark_') + TYPE[p.toLowerCase()];
  const sideOf = (p) => (isWhite(p) ? 'light' : 'dark');
  const spriteUrl = (id, frame) => `art/sprites/${id}/${frame}.webp`;
  const hasFrame = (id, frame) => !!(SPR.units[id] && SPR.units[id].frames.includes(frame));

  // Preload sprite frames once so frame switches never flash an empty image.
  const preloaded = new Set();
  function preload(id) {
    if (preloaded.has(id) || !SPR.units[id]) return;
    preloaded.add(id);
    for (const f of SPR.units[id].frames) { const im = new Image(); im.src = spriteUrl(id, f); }
  }

  class Battlefield {
    constructor(root) {
      this.root = root;
      this.flipped = false;
      this.units = new Map(); // square index -> unit
      this.particles = [];
      this.skip = false;
      root.classList.add('bf-stage');
      root.innerHTML = `
        <div class="bf-board-wrap"><div class="bf-board"></div></div>
        <div class="bf-units"></div>
        <div class="bf-cutin" hidden>
          <div class="bf-cut-slot bf-cut-left"></div>
          <div class="bf-cut-slot bf-cut-right"></div>
          <div class="bf-cut-names"></div>
        </div>
        <canvas class="bf-fx"></canvas>
        <div class="bf-cam">
          <button type="button" data-cam="left" title="Повернуть влево">⟲</button>
          <button type="button" data-cam="right" title="Повернуть вправо">⟳</button>
          <button type="button" data-cam="in" title="Приблизить">+</button>
          <button type="button" data-cam="out" title="Отдалить">−</button>
          <button type="button" data-cam="home" title="Вернуть вид">⌂</button>
          <button type="button" data-cam="full" title="На весь экран (Esc — выйти)">⛶</button>
        </div>`;
      this.boardEl = root.querySelector('.bf-board');
      this.unitsEl = root.querySelector('.bf-units');
      this.cutinEl = root.querySelector('.bf-cutin');
      this.fx = root.querySelector('.bf-fx');
      this.ctx = this.fx.getContext('2d');
      this.cutinEl.addEventListener('pointerdown', () => { this.skip = true; });
      this.lightFacesLeft = false;
      this.buildSquares();
      this.initCamera();
      this.layout();
      window.addEventListener('resize', () => this.layout());
      // The stage may get its final size only after fonts/layout settle.
      if (window.ResizeObserver) new ResizeObserver(() => this.layout()).observe(root);
    }

    /* ---------- geometry ---------- */

    /** Board turned 90°: rank -> column (rank 1 on the left), file -> depth row (a at the back). */
    buildSquares() {
      this.boardEl.innerHTML = '';
      this.squareEls = new Array(64);
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const file = this.flipped ? 7 - row : row;
          const rank = this.flipped ? 8 - col : col + 1;
          const sq = (8 - rank) * 8 + file;
          const el = document.createElement('div');
          el.className = 'square ' + (((sq >> 3) + (sq & 7)) % 2 === 0 ? 'sq-light' : 'sq-dark');
          el.dataset.sq = sq;
          el.dataset.row = row;
          el.dataset.col = col;
          // Show a different quarter of the texture on neighbouring squares.
          el.style.backgroundPosition = `${(row * 3 + col * 5) % 2 ? 0 : 100}% ${(row + col * 7) % 2 ? 0 : 100}%`;
          this.squareEls[sq] = el;
          this.boardEl.appendChild(el);
        }
      }
    }

    setFlipped(flipped) {
      if (flipped === this.flipped) return;
      this.flipped = flipped;
      this.buildSquares();
      for (const u of this.units.values()) this.applyFacing(u);
      this.layout();
    }

    /** Where a unit standing on `sq` touches the ground, and how big a square looks there. */
    anchor(sq) {
      const s = this.root.getBoundingClientRect(), r = this.squareEls[sq].getBoundingClientRect();
      return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height * this.anchorY, w: r.width };
    }

    layout() {
      const cs = getComputedStyle(this.root);
      this.unitScale = parseFloat(cs.getPropertyValue('--bf-unit-scale')) || 2.25;
      this.anchorY = parseFloat(cs.getPropertyValue('--bf-anchor-y')) || 0.6;
      const r = this.root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const fw = Math.round(r.width * dpr), fh = Math.round(r.height * dpr);
      if (this.fx.width !== fw || this.fx.height !== fh) {
        this.fx.width = fw;
        this.fx.height = fh;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      // Each army faces the other one as it appears on screen, whatever the camera turn.
      const L = this.rankCenter(1), D = this.rankCenter(8);
      if (Math.abs(D.x - L.x) > 4) this.lightFacesLeft = D.x < L.x;
      for (const u of this.units.values()) {
        this.applyFacing(u);
        if (!u.moving) this.placeAt(u, this.anchor(u.sq));
      }
    }

    rankCenter(rank) {
      let x = 0, y = 0;
      for (let f = 0; f < 8; f++) { const a = this.anchor((8 - rank) * 8 + f); x += a.x / 8; y += a.y / 8; }
      return { x, y };
    }

    /* ---------- camera: drag to turn/tilt, wheel or pinch to zoom ---------- */

    initCamera() {
      const cs = getComputedStyle(this.root);
      this.cam = { turn: parseFloat(cs.getPropertyValue('--bf-turn')) || 0, tilt: parseFloat(cs.getPropertyValue('--bf-tilt')) || 60, zoom: 1 };
      this.camHome = { ...this.cam };
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      const pts = new Map();
      let start = null;
      const restart = () => { start = pts.size ? { cam: { ...this.cam }, pts: new Map(pts) } : null; };
      this.root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.bf-cam, .bf-cutin')) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.dragged = false;
        restart();
      });
      this.root.addEventListener('pointermove', (e) => {
        if (!start || !pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) {
          const p0 = start.pts.get(e.pointerId);
          if (!p0) return;
          const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
          if (!this.dragged && Math.hypot(dx, dy) < 8) return; // below this it is still a tap on a square
          this.dragged = true;
          this.setCamera({ turn: start.cam.turn + dx * 0.4, tilt: clamp(start.cam.tilt - dy * 0.15, 40, 76) });
        } else if (pts.size === 2 && start.pts.size === 2) {
          const [a, b] = [...pts.values()], [a0, b0] = [...start.pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y), d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
          this.dragged = true;
          this.setCamera({ zoom: clamp(start.cam.zoom * d / d0, 0.7, 1.8) });
        }
      });
      const end = (e) => { pts.delete(e.pointerId); restart(); };
      this.root.addEventListener('pointerup', end);
      this.root.addEventListener('pointercancel', end);
      // A drag must not also count as a click on the square under the finger.
      this.root.addEventListener('click', (e) => {
        if (this.dragged) { e.stopPropagation(); e.preventDefault(); this.dragged = false; }
      }, true);
      this.root.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.setCamera({ zoom: clamp(this.cam.zoom * Math.exp(-e.deltaY * 0.0015), 0.7, 1.8) });
      }, { passive: false });
      this.root.querySelector('.bf-cam').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cam]');
        if (!b) return;
        const c = this.cam, act = b.dataset.cam;
        if (act === 'left') this.animateCamera({ turn: c.turn - 45 });
        else if (act === 'right') this.animateCamera({ turn: c.turn + 45 });
        else if (act === 'in') this.animateCamera({ zoom: clamp(c.zoom * 1.25, 0.7, 1.8) });
        else if (act === 'out') this.animateCamera({ zoom: clamp(c.zoom / 1.25, 0.7, 1.8) });
        else if (act === 'home') this.animateCamera({ ...this.camHome });
        else if (act === 'full') this.toggleFullscreen();
      });
      // The CSS fallback has no browser-provided exit, so Esc closes it too.
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.root.classList.contains('bf-full')) this.toggleFullscreen();
      });
    }

    /** Real fullscreen where the browser allows it; otherwise (iPhone Safari) stretch the stage over the window. */
    toggleFullscreen() {
      const el = this.root, fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === el) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (el.classList.contains('bf-full')) {
        el.classList.remove('bf-full');
      } else {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const fallback = () => el.classList.add('bf-full');
        if (!req) fallback();
        else {
          try { const r = req.call(el); if (r && r.catch) r.catch(fallback); } catch (_) { fallback(); }
        }
      }
      requestAnimationFrame(() => this.layout());
    }

    setCamera(c) {
      Object.assign(this.cam, c);
      this.root.style.setProperty('--bf-turn', this.cam.turn + 'deg');
      this.root.style.setProperty('--bf-tilt', this.cam.tilt + 'deg');
      this.root.style.setProperty('--bf-zoom', this.cam.zoom);
      if (this.layoutQueued) return;
      this.layoutQueued = true;
      requestAnimationFrame(() => { this.layoutQueued = false; this.layout(); });
    }

    animateCamera(target, ms = 320) {
      const from = { ...this.cam }, t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        const c = {};
        for (const key of Object.keys(target)) c[key] = from[key] + (target[key] - from[key]) * e;
        this.setCamera(c);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    placeAt(u, a) {
      const size = a.w * this.unitScale * (u.sprite ? 1 : SVG_SCALE);
      u.size = size;
      u.el.style.width = u.el.style.height = size + 'px';
      u.el.style.left = (a.x - size / 2) + 'px';
      u.el.style.top = (a.y - size * (u.sprite ? GROUND : 0.92)) + 'px';
      u.el.style.zIndex = Math.round(10 + a.y + (a.lift || 0)); // nearer the camera = lower on screen = in front
    }

    /* ---------- units ---------- */

    /** Art faces right; a unit turns left when the enemy army is to its left on screen. */
    facesLeft(u) { return u.side === 'light' ? this.lightFacesLeft : !this.lightFacesLeft; }
    applyFacing(u) { if (u.sprite) u.el.classList.toggle('bf-facing-left', this.facesLeft(u)); }

    makeUnit(piece, sq) {
      const id = unitId(piece), sprite = hasFrame(id, 'idle');
      const el = document.createElement('div');
      el.className = 'bf-unit' + (sprite ? '' : ' bf-svg-unit');
      el.innerHTML = '<div class="bf-shadow"></div><div class="bf-flip"></div><div class="bf-hit"></div>';
      const flip = el.querySelector('.bf-flip');
      let img = null;
      if (sprite) {
        preload(id);
        img = document.createElement('img');
        img.className = 'bf-sprite';
        img.alt = '';
        img.draggable = false;
        img.src = spriteUrl(id, 'idle');
        img.style.animationDelay = (-Math.random() * 3).toFixed(2) + 's';
        flip.appendChild(img);
      } else {
        flip.innerHTML = pieceSVG(piece);
      }
      el.querySelector('.bf-hit').dataset.sq = sq;
      this.unitsEl.appendChild(el);
      const u = { piece, id, side: sideOf(piece), sq, el, img, sprite, moving: false };
      this.applyFacing(u);
      this.placeAt(u, this.anchor(sq));
      return u;
    }

    removeUnit(u) {
      u.el.remove();
      if (this.units.get(u.sq) === u) this.units.delete(u.sq);
    }

    setFrame(u, frame) {
      if (u.sprite && hasFrame(u.id, frame)) u.img.src = spriteUrl(u.id, frame);
    }

    /* ---------- static render ---------- */

    /**
     * Draw the position. state: { board, selected, lastMove, checkSq, hanging[], hints[{to, capture}], stars[sq], coords }
     */
    render(state) {
      const hints = new Map((state.hints || []).map((h) => [h.to, h]));
      for (let sq = 0; sq < 64; sq++) {
        const el = this.squareEls[sq];
        el.classList.toggle('selected', state.selected === sq);
        el.classList.toggle('last-move', !!state.lastMove && (state.lastMove.from === sq || state.lastMove.to === sq));
        el.classList.toggle('in-check', state.checkSq === sq);
        el.classList.toggle('threatened', !!state.hanging && state.hanging.includes(sq));
        el.innerHTML = '';
        const h = hints.get(sq);
        if (h) {
          const d = document.createElement('div');
          d.className = h.capture ? 'hint-capture' : 'hint-dot';
          el.appendChild(d);
        }
        if (state.stars && state.stars.includes(sq)) {
          const s = document.createElement('div');
          s.className = 'star-token';
          el.appendChild(s);
        }
        const row = +el.dataset.row, col = +el.dataset.col;
        if (row === 7) el.insertAdjacentHTML('beforeend', `<span class="coord coord-file">${this.flipped ? 8 - col : col + 1}</span>`);
        if (col === 0) el.insertAdjacentHTML('beforeend', `<span class="coord coord-rank">${'abcdefgh'[sq & 7]}</span>`);
      }

      // Reconcile units with the board array.
      const board = state.board;
      for (const [sq, u] of [...this.units]) if (board[sq] !== u.piece) this.removeUnit(u);
      for (let sq = 0; sq < 64; sq++) {
        if (board[sq] && !this.units.has(sq)) this.units.set(sq, this.makeUnit(board[sq], sq));
      }
      for (const u of this.units.values()) {
        u.el.classList.toggle('bf-selected', state.selected === u.sq);
        if (!u.moving) this.placeAt(u, this.anchor(u.sq));
      }
    }

    /* ---------- animation helpers ---------- */

    sleep(ms) { return new Promise((r) => setTimeout(r, this.skip ? 0 : ms)); }

    slide(u, fromA, toA, ms, arc = 0) {
      return new Promise((resolve) => {
        u.moving = true;
        const t0 = performance.now(), dur = this.skip ? 0 : ms;
        const step = (t) => {
          const k = dur ? Math.min(1, (t - t0) / dur) : 1;
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          this.placeAt(u, {
            x: fromA.x + (toA.x - fromA.x) * e,
            y: fromA.y + (toA.y - fromA.y) * e - Math.sin(Math.PI * e) * arc,
            w: fromA.w + (toA.w - fromA.w) * e,
            lift: 40, // the moving unit stays in front of everyone it passes
          });
          if (k < 1) requestAnimationFrame(step); else { u.moving = false; resolve(); }
        };
        requestAnimationFrame(step);
      });
    }

    shake() {
      this.root.classList.remove('bf-shake');
      void this.root.offsetWidth;
      this.root.classList.add('bf-shake');
    }

    flash(el) {
      el.classList.add('bf-hit-flash');
      setTimeout(() => el.classList.remove('bf-hit-flash'), 110);
    }

    /* ---------- particles ---------- */

    kick() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        const r = this.root.getBoundingClientRect();
        this.ctx.clearRect(0, 0, r.width, r.height);
        this.particles = this.particles.filter((p) => p.age < p.life);
        for (const p of this.particles) {
          p.age += 16;
          if (p.age < 0) continue;
          p.x += p.vx; p.y += p.vy; p.vy -= p.lift; p.vx *= 0.99;
          const a = 1 - p.age / p.life;
          this.ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
          this.ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${(a * p.alpha).toFixed(3)})`;
          this.ctx.fillRect(p.x, p.y, p.s, p.s);
        }
        this.ctx.globalCompositeOperation = 'source-over';
        if (this.particles.length) requestAnimationFrame(loop); else { this.running = false; this.ctx.clearRect(0, 0, r.width, r.height); }
      };
      requestAnimationFrame(loop);
    }

    sparks(x, y, side) {
      const c = EMBER[side];
      for (let i = 0; i < 26; i++) {
        const ang = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3.5;
        this.particles.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 1, lift: -0.08, age: 0, life: 260 + Math.random() * 260, s: 2.5, c, alpha: 1, glow: true });
      }
      this.kick();
    }

    /**
     * Turn a unit into drifting ash + embers. `el` is the element to fade; `img` (optional) is
     * sampled for colours; `box` is its rect in stage coordinates; `mirror` matches its facing.
     */
    dissolve(el, img, box, side, mirror) {
      const size = Math.max(8, Math.round(box.w));
      let data = null;
      if (img) {
        const off = document.createElement('canvas');
        off.width = off.height = size;
        const o = off.getContext('2d');
        if (mirror) { o.translate(size, 0); o.scale(-1, 1); }
        try { o.drawImage(img, 0, 0, size, size); data = o.getImageData(0, 0, size, size).data; } catch (_) { data = null; /* file:// taints the canvas */ }
      }
      // Fine sampling with small specks reads as ash; big squares read as pixels.
      const step = Math.max(2, Math.round(size / 160)), speck = Math.min(step + 1, 3.5), ember = EMBER[side];
      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          let c;
          if (data) {
            const i = (y * size + x) * 4;
            if (data[i + 3] < 140) continue;
            c = [data[i], data[i + 1], data[i + 2]];
          } else {
            if (y < size * 0.35 || x < size * 0.25 || x > size * 0.75 || Math.random() > 0.3) continue;
            c = side === 'dark' ? [60, 52, 60] : [190, 170, 130];
          }
          const glow = Math.random() < 0.18;
          this.particles.push({
            x: box.x + x, y: box.y + y,
            vx: (Math.random() - 0.5) * 0.8 + (side === 'dark' ? 0.3 : -0.3),
            vy: -0.2 - Math.random() * 0.6, lift: 0.02 + Math.random() * 0.03,
            age: -((size - y) / size) * 380 - Math.random() * 180, // the dissolve sweeps from the ground up
            life: 900 + Math.random() * 900, s: speck,
            c: glow ? ember : c.map((v) => Math.round(v * 0.55 + 150 * 0.45)), alpha: glow ? 1 : 0.8, glow,
          });
        }
      }
      this.kick();
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.skip ? 120 : 420, fill: 'forwards' });
    }

    unitBox(u) {
      return { x: parseFloat(u.el.style.left), y: parseFloat(u.el.style.top), w: u.size };
    }

    /* ---------- moves ---------- */

    /**
     * Animate one move on the position currently drawn. Resolves when the board can be redrawn.
     * mode: 'cutin' (close-up battle scene on captures) | 'board' (fight on the board) | 'off'.
     * hooks.onImpact() fires at the moment a blow lands (for the capture sound).
     */
    async playMove(move, mode = 'cutin', hooks = {}) {
      this.skip = false;
      const mover = this.units.get(move.from);
      if (!mover || mode === 'off') return;
      const from = this.anchor(move.from), to = this.anchor(move.to);
      const jumps = move.piece && move.piece.toLowerCase() === 'n';
      const capSq = move.flags === 'e' ? move.to + (isWhite(move.piece) ? 8 : -8) : (move.captured ? move.to : null);
      const victim = capSq !== null ? this.units.get(capSq) : null;

      const extra = [];
      if (move.flags === 'k' || move.flags === 'q') { // castling: the rook walks too
        const rFrom = move.flags === 'k' ? move.to + 1 : move.to - 2, rTo = move.flags === 'k' ? move.to - 1 : move.to + 1;
        const rook = this.units.get(rFrom);
        if (rook) extra.push(this.slide(rook, this.anchor(rFrom), this.anchor(rTo), 380).then(() => this.rekey(rook, rTo)));
      }

      if (victim) {
        if (mode === 'cutin') await this.battleScene(mover, victim, hooks);
        else await this.boardFight(mover, victim, from, this.anchor(capSq), hooks);
        // On the board the defeated unit crumbles while the victor takes the square.
        this.dissolve(victim.el, victim.img, this.unitBox(victim), victim.side, victim.sprite && this.facesLeft(victim));
        await this.slide(mover, mode === 'cutin' ? from : this.strikePoint(from, this.anchor(capSq)), to, 320, jumps ? to.w * 0.6 : 0);
        this.removeUnit(victim);
      } else {
        await this.slide(mover, from, to, jumps ? 420 : 360, jumps ? to.w * 0.9 : 0);
      }
      await Promise.all(extra);
      this.rekey(mover, move.to);
      if (move.promotion) this.sparks(to.x, to.y - to.w, mover.side);
    }

    rekey(u, sq) {
      if (this.units.get(u.sq) === u) this.units.delete(u.sq);
      u.sq = sq;
      u.el.querySelector('.bf-hit').dataset.sq = sq;
      this.units.set(sq, u);
    }

    strikePoint(a, b) {
      return { x: a.x + (b.x - a.x) * 0.55, y: a.y + (b.y - a.y) * 0.55, w: a.w + (b.w - a.w) * 0.55, lift: 40 };
    }

    /** The fight played out on the board itself (no close-up). */
    async boardFight(att, vic, from, to, hooks) {
      const sp = this.strikePoint(from, to);
      att.el.classList.add('bf-acting');
      await this.slide(att, from, sp, 420, att.piece.toLowerCase() === 'n' ? to.w * 0.5 : 0);
      this.setFrame(att, 'attack_1'); await this.sleep(260);
      this.setFrame(att, 'attack_2');
      vic.el.classList.add('bf-acting');
      this.flash(vic.el); this.shake();
      if (hooks.onImpact) hooks.onImpact();
      this.sparks(to.x - (to.x - from.x) * 0.15, to.y - to.w * 0.9, att.side);
      await this.sleep(110);
      this.setFrame(vic, 'death_1'); await this.sleep(160);
      this.setFrame(att, 'attack_3'); await this.sleep(280);
      this.setFrame(vic, 'death_2'); await this.sleep(300);
      this.setFrame(att, 'idle');
      att.el.classList.remove('bf-acting');
    }

    /** Close-up battle scene: both units large, attacker strikes, defender falls to ash. Tap skips. */
    async battleScene(att, vic, hooks) {
      const leftSide = this.lightFacesLeft ? 'dark' : 'light'; // same sides as on the board right now
      const slots = { [leftSide]: this.cutinEl.querySelector('.bf-cut-left'), [leftSide === 'light' ? 'dark' : 'light']: this.cutinEl.querySelector('.bf-cut-right') };
      const make = (u) => {
        const slot = slots[u.side];
        slot.innerHTML = '';
        slot.classList.toggle('bf-facing-left', slot.classList.contains('bf-cut-right') && u.sprite);
        const fig = document.createElement('div');
        fig.className = 'bf-cut-fig';
        if (u.sprite) {
          const im = document.createElement('img');
          im.src = spriteUrl(u.id, 'idle');
          im.alt = '';
          fig.appendChild(im);
          fig.img = im;
        } else {
          fig.innerHTML = pieceSVG(u.piece);
        }
        slot.appendChild(fig);
        return { u, slot, fig, set: (f) => { if (u.sprite && hasFrame(u.id, f)) fig.img.src = spriteUrl(u.id, f); } };
      };
      const A = make(att), V = make(vic);
      this.cutinEl.querySelector('.bf-cut-names').textContent = `${UNIT_NAMES[att.id] || ''}  ⚔  ${UNIT_NAMES[vic.id] || ''}`;
      this.cutinEl.hidden = false;
      this.cutinEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' });
      await this.sleep(260);

      // Lunge towards the enemy; inside a mirrored slot "forward" is +X as well.
      const dir = A.slot.classList.contains('bf-cut-left') || A.slot.classList.contains('bf-facing-left') ? 1 : -1;
      A.set('attack_1'); await this.sleep(300);
      A.fig.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dir * 14}%)` }], { duration: this.skip ? 0 : 120, fill: 'forwards' });
      A.set('attack_2');
      await this.sleep(110);
      this.flash(V.fig); this.shake();
      if (hooks.onImpact) hooks.onImpact();
      const vr = V.fig.getBoundingClientRect(), sr = this.root.getBoundingClientRect();
      this.sparks(vr.left - sr.left + vr.width * (dir > 0 ? 0.35 : 0.65), vr.top - sr.top + vr.height * 0.45, att.side);
      V.set('death_1'); await this.sleep(200);
      A.set('attack_3'); await this.sleep(240);
      V.set('death_2'); await this.sleep(320);
      const box = { x: vr.left - sr.left, y: vr.top - sr.top, w: vr.width };
      this.dissolve(V.fig, V.fig.img || null, box, vic.side, V.slot.classList.contains('bf-facing-left'));
      await this.sleep(650);
      const fade = this.cutinEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.skip ? 60 : 220, fill: 'forwards' });
      await fade.finished;
      this.cutinEl.hidden = true;
      A.slot.innerHTML = V.slot.innerHTML = '';
    }
  }

  window.Battlefield = Battlefield;
})();
