/* Dark Fantasy Chess — rules engine.
 * Wrapped in a function so the same source can be injected into a Web Worker (Blob URL),
 * which is required because workers can't be loaded from file:// directly. */
function ChessCore() {
  'use strict';
  const FILES = 'abcdefgh';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  // Square index: 0 = a8 ... 63 = h1 (FEN order). row = sq>>3 (0 = rank 8), col = sq&7.
  const sqName = (s) => FILES[s & 7] + (8 - (s >> 3));
  const parseSq = (n) => (8 - parseInt(n[1], 10)) * 8 + FILES.indexOf(n[0]);
  const isWhite = (p) => p < 'a';

  // Precomputed attack tables.
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]; // 0-3 orthogonal, 4-7 diagonal
  const KN = [], KG = [], RAY = DIRS.map(() => []);
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, f = s & 7;
    KN[s] = []; KG[s] = [];
    for (const [dr, df] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      const nr = r + dr, nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) KN[s].push(nr * 8 + nf);
    }
    DIRS.forEach(([dr, df], d) => {
      const nr = r + dr, nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) KG[s].push(nr * 8 + nf);
      const ray = [];
      let rr = r + dr, ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) { ray.push(rr * 8 + ff); rr += dr; ff += df; }
      RAY[d][s] = ray;
    });
  }
  const SLIDE_DIRS = { b: [4, 5, 6, 7], r: [0, 1, 2, 3], q: [0, 1, 2, 3, 4, 5, 6, 7] };

  class Chess {
    constructor(fen) { this.load(fen || START); }

    load(fen) {
      let [pos, turn, cas, ep, half, full] = fen.trim().split(/\s+/);
      this.board = new Array(64).fill(null);
      let s = 0;
      for (const ch of pos) {
        if (ch === '/') continue;
        if (/\d/.test(ch)) s += +ch; else this.board[s++] = ch;
      }
      this.turn = turn || 'w';
      cas = cas || '-';
      this.castle = { K: cas.includes('K'), Q: cas.includes('Q'), k: cas.includes('k'), q: cas.includes('q') };
      this.ep = ep && ep !== '-' ? parseSq(ep) : -1;
      this.half = +half || 0;
      this.full = +full || 1;
      this.hist = [];
      this.repKeys = [this.key()];
    }

    clone() { const c = new Chess(this.fen()); return c; }

    placement() {
      let s = '';
      for (let r = 0; r < 8; r++) {
        let e = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 8 + f];
          if (!p) e++; else { if (e) { s += e; e = 0; } s += p; }
        }
        if (e) s += e;
        if (r < 7) s += '/';
      }
      return s;
    }
    castleStr() {
      const c = this.castle;
      return (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '') || '-';
    }
    key() { return this.placement() + ' ' + this.turn + ' ' + this.castleStr() + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-'); }
    fen() { return this.key() + ' ' + this.half + ' ' + this.full; }

    kingSq(color) {
      const k = color === 'w' ? 'K' : 'k';
      return this.board.indexOf(k);
    }

    /** Is square `sq` attacked by side `by`? */
    attacked(sq, by) {
      const b = this.board, r = sq >> 3, f = sq & 7;
      if (by === 'w') {
        if (r < 7) { if (f > 0 && b[sq + 7] === 'P') return true; if (f < 7 && b[sq + 9] === 'P') return true; }
      } else if (r > 0) {
        if (f > 0 && b[sq - 9] === 'p') return true; if (f < 7 && b[sq - 7] === 'p') return true;
      }
      const w = by === 'w';
      const N = w ? 'N' : 'n', K = w ? 'K' : 'k', Q = w ? 'Q' : 'q', R = w ? 'R' : 'r', B = w ? 'B' : 'b';
      for (const t of KN[sq]) if (b[t] === N) return true;
      for (const t of KG[sq]) if (b[t] === K) return true;
      for (let d = 0; d < 8; d++) {
        const S = d < 4 ? R : B;
        for (const t of RAY[d][sq]) {
          const p = b[t];
          if (p) { if (p === S || p === Q) return true; break; }
        }
      }
      return false;
    }

    /** All squares attacked by the piece standing on `sq` (ignores pins). */
    attacksFrom(sq) {
      const b = this.board, p = b[sq];
      if (!p) return [];
      const t = p.toLowerCase(), r = sq >> 3, f = sq & 7, out = [];
      if (t === 'p') {
        const dr = isWhite(p) ? -1 : 1, nr = r + dr;
        if (nr >= 0 && nr < 8) { if (f > 0) out.push(nr * 8 + f - 1); if (f < 7) out.push(nr * 8 + f + 1); }
      } else if (t === 'n') out.push(...KN[sq]);
      else if (t === 'k') out.push(...KG[sq]);
      else for (const d of SLIDE_DIRS[t]) for (const s of RAY[d][sq]) { out.push(s); if (b[s]) break; }
      return out;
    }

    /** Squares of pieces of side `by` attacking `sq`. */
    attackersOf(sq, by) {
      const out = [];
      for (let s = 0; s < 64; s++) {
        const p = this.board[s];
        if (p && (isWhite(p) ? 'w' : 'b') === by && this.attacksFrom(s).includes(sq)) out.push(s);
      }
      return out;
    }

    inCheck(color = this.turn) {
      const k = this.kingSq(color);
      return k >= 0 && this.attacked(k, color === 'w' ? 'b' : 'w');
    }

    pseudo(onlyCaptures) {
      const moves = [], b = this.board, white = this.turn === 'w';
      const enemy = (q) => q && isWhite(q) !== white;
      for (let s = 0; s < 64; s++) {
        const p = b[s];
        if (!p || isWhite(p) !== white) continue;
        const t = p.toLowerCase();
        if (t === 'p') {
          const dir = white ? -8 : 8, startR = white ? 6 : 1, promoR = white ? 0 : 7, r = s >> 3, f = s & 7;
          const one = s + dir;
          const addPawn = (to, cap, flags) => {
            if ((to >> 3) === promoR) {
              for (const pr of ['q', 'r', 'b', 'n']) {
                if (onlyCaptures && !cap && pr !== 'q') continue;
                moves.push({ from: s, to, piece: p, captured: cap, promotion: pr, flags });
              }
            } else if (!onlyCaptures || cap) moves.push({ from: s, to, piece: p, captured: cap, flags });
          };
          if (one >= 0 && one < 64 && !b[one]) {
            addPawn(one, null, 'n');
            if (!onlyCaptures && r === startR && !b[one + dir]) moves.push({ from: s, to: one + dir, piece: p, captured: null, flags: 'b' });
          }
          for (const df of [-1, 1]) {
            const nf = f + df;
            if (nf < 0 || nf > 7 || one < 0 || one > 63) continue;
            const to = one + df;
            if (enemy(b[to])) addPawn(to, b[to], 'c');
            else if (to === this.ep && !b[to]) moves.push({ from: s, to, piece: p, captured: white ? 'p' : 'P', flags: 'e' });
          }
        } else if (t === 'n' || t === 'k') {
          for (const to of (t === 'n' ? KN : KG)[s]) {
            const q = b[to];
            if (!q) { if (!onlyCaptures) moves.push({ from: s, to, piece: p, captured: null, flags: 'n' }); }
            else if (enemy(q)) moves.push({ from: s, to, piece: p, captured: q, flags: 'c' });
          }
          if (t === 'k' && !onlyCaptures) this._castles(s, p, moves);
        } else {
          for (const d of SLIDE_DIRS[t]) {
            for (const to of RAY[d][s]) {
              const q = b[to];
              if (!q) { if (!onlyCaptures) moves.push({ from: s, to, piece: p, captured: null, flags: 'n' }); }
              else { if (enemy(q)) moves.push({ from: s, to, piece: p, captured: q, flags: 'c' }); break; }
            }
          }
        }
      }
      return moves;
    }

    _castles(s, p, moves) {
      const b = this.board, c = this.castle;
      if (p === 'K' && s === 60) {
        if (c.K && !b[61] && !b[62] && b[63] === 'R' && !this.attacked(60, 'b') && !this.attacked(61, 'b') && !this.attacked(62, 'b'))
          moves.push({ from: 60, to: 62, piece: p, captured: null, flags: 'k' });
        if (c.Q && !b[59] && !b[58] && !b[57] && b[56] === 'R' && !this.attacked(60, 'b') && !this.attacked(59, 'b') && !this.attacked(58, 'b'))
          moves.push({ from: 60, to: 58, piece: p, captured: null, flags: 'q' });
      } else if (p === 'k' && s === 4) {
        if (c.k && !b[5] && !b[6] && b[7] === 'r' && !this.attacked(4, 'w') && !this.attacked(5, 'w') && !this.attacked(6, 'w'))
          moves.push({ from: 4, to: 6, piece: p, captured: null, flags: 'k' });
        if (c.q && !b[3] && !b[2] && !b[1] && b[0] === 'r' && !this.attacked(4, 'w') && !this.attacked(3, 'w') && !this.attacked(2, 'w'))
          moves.push({ from: 4, to: 2, piece: p, captured: null, flags: 'q' });
      }
    }

    make(m) {
      const b = this.board, p = b[m.from], white = isWhite(p);
      let cap = b[m.to];
      if (m.flags === 'e') { const cs = m.to + (white ? 8 : -8); cap = b[cs]; b[cs] = null; }
      this.hist.push({ m, cap, castle: { ...this.castle }, ep: this.ep, half: this.half, full: this.full, rep: false });
      b[m.to] = m.promotion ? (white ? m.promotion.toUpperCase() : m.promotion) : p;
      b[m.from] = null;
      if (m.flags === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
      else if (m.flags === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
      const c = this.castle;
      if (p === 'K') { c.K = c.Q = false; } else if (p === 'k') { c.k = c.q = false; }
      for (const sq of [m.from, m.to]) {
        if (sq === 63) c.K = false; else if (sq === 56) c.Q = false; else if (sq === 7) c.k = false; else if (sq === 0) c.q = false;
      }
      this.ep = m.flags === 'b' ? (m.from + m.to) >> 1 : -1;
      this.half = (p === 'P' || p === 'p' || cap) ? 0 : this.half + 1;
      if (!white) this.full++;
      this.turn = white ? 'b' : 'w';
    }

    undo() {
      const h = this.hist.pop();
      if (!h) return null;
      const m = h.m, b = this.board, p = b[m.to], white = isWhite(p);
      b[m.from] = m.promotion ? (white ? 'P' : 'p') : p;
      if (m.flags === 'e') { b[m.to] = null; b[m.to + (white ? 8 : -8)] = h.cap; }
      else b[m.to] = h.cap || null;
      if (m.flags === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
      else if (m.flags === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
      this.castle = h.castle; this.ep = h.ep; this.half = h.half; this.full = h.full;
      this.turn = white ? 'w' : 'b';
      if (h.rep) this.repKeys.pop();
      return m;
    }

    /** Game-level move: also tracks repetition keys. */
    play(m) {
      this.make(m);
      this.hist[this.hist.length - 1].rep = true;
      this.repKeys.push(this.key());
    }

    /** Null move (pass) — used for threat detection. Undo with undo(). */
    makeNull() {
      this.hist.push({ m: null, cap: null, castle: { ...this.castle }, ep: this.ep, half: this.half, full: this.full, rep: false, nul: true });
      this.ep = -1;
      this.turn = this.turn === 'w' ? 'b' : 'w';
    }
    undoNull() {
      const h = this.hist.pop();
      this.castle = h.castle; this.ep = h.ep; this.half = h.half; this.full = h.full;
      this.turn = this.turn === 'w' ? 'b' : 'w';
    }

    moves(opts = {}) {
      const us = this.turn, out = [];
      for (const m of this.pseudo(opts.captures)) {
        if (opts.square !== undefined && m.from !== opts.square) continue;
        this.make(m);
        if (!this.inCheck(us)) out.push(m);
        this.undo();
      }
      return out;
    }

    findMove(from, to, promotion) {
      return this.moves({ square: from }).find((m) => m.to === to && (!m.promotion || m.promotion === (promotion || 'q')));
    }

    san(m, legal) {
      let s;
      const b = this.board;
      if (m.flags === 'k') s = 'O-O';
      else if (m.flags === 'q') s = 'O-O-O';
      else {
        const p = b[m.from], t = p.toLowerCase();
        const cap = m.flags === 'c' || m.flags === 'e';
        if (t === 'p') {
          s = (cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
          if (m.promotion) s += '=' + m.promotion.toUpperCase();
        } else {
          s = t.toUpperCase();
          legal = legal || this.moves();
          const amb = legal.filter((o) => o.to === m.to && o.from !== m.from && b[o.from] === p);
          if (amb.length) {
            const sameFile = amb.some((o) => (o.from & 7) === (m.from & 7));
            const sameRank = amb.some((o) => (o.from >> 3) === (m.from >> 3));
            if (!sameFile) s += FILES[m.from & 7];
            else if (!sameRank) s += 8 - (m.from >> 3);
            else s += sqName(m.from);
          }
          s += (cap ? 'x' : '') + sqName(m.to);
        }
      }
      this.make(m);
      if (this.inCheck(this.turn)) s += this.moves().length ? '+' : '#';
      this.undo();
      return s;
    }

    moveFromSan(san) {
      const clean = (x) => x.replace(/[+#!?]/g, '');
      const legal = this.moves();
      return legal.find((m) => clean(this.san(m, legal)) === clean(san)) || null;
    }

    insufficient() {
      const minors = [];
      for (let s = 0; s < 64; s++) {
        const p = this.board[s];
        if (!p || p === 'K' || p === 'k') continue;
        const t = p.toLowerCase();
        if (t === 'p' || t === 'r' || t === 'q') return false;
        minors.push({ t, color: ((s >> 3) + (s & 7)) & 1 });
      }
      if (minors.length <= 1) return true;
      if (minors.every((m) => m.t === 'b')) return minors.every((m) => m.color === minors[0].color);
      return false;
    }

    status() {
      const ms = this.moves(), chk = this.inCheck();
      if (!ms.length) return chk
        ? { over: true, result: this.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', check: true }
        : { over: true, result: '1/2-1/2', reason: 'stalemate' };
      if (this.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty' };
      if (this.insufficient()) return { over: true, result: '1/2-1/2', reason: 'insufficient' };
      const k = this.key();
      if (this.repKeys.filter((x) => x === k).length >= 3) return { over: true, result: '1/2-1/2', reason: 'repetition' };
      return { over: false, check: chk };
    }
  }

  return { Chess, START, VAL, sqName, parseSq, isWhite, FILES };
}
if (typeof window !== 'undefined') window.ChessLib = ChessCore();
