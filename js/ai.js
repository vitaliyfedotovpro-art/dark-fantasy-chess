/* Dark Fantasy Chess — AI (alpha-beta + quiescence + iterative deepening).
 * Runs inside a Web Worker built from a Blob (see createEngine), so file:// works without a server. */
function AICore(lib) {
  'use strict';
  const { Chess, VAL } = lib;

  // Piece-square tables from White's perspective, index 0 = a8 (FEN order).
  const PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    ke: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
  };
  const MATE = 100000;

  /** Static evaluation from White's point of view (centipawns). */
  function evaluate(g) {
    const b = g.board;
    let mg = 0, nonPawn = 0, wb = 0, bb = 0;
    const wPawnFiles = new Array(8).fill(0), bPawnFiles = new Array(8).fill(0);
    let wk = -1, bk = -1;
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p) continue;
      const t = p.toLowerCase(), w = p < 'a';
      if (t !== 'p' && t !== 'k') nonPawn += VAL[t];
      if (t === 'b') { if (w) wb++; else bb++; }
      if (t === 'p') (w ? wPawnFiles : bPawnFiles)[s & 7]++;
      if (t === 'k') { if (w) wk = s; else bk = s; continue; }
      const idx = w ? s : (7 - (s >> 3)) * 8 + (s & 7);
      mg += (w ? 1 : -1) * (VAL[t] + PST[t][idx]);
    }
    const endgame = nonPawn <= 2600;
    const kt = endgame ? PST.ke : PST.k;
    if (wk >= 0) mg += kt[wk];
    if (bk >= 0) mg -= kt[(7 - (bk >> 3)) * 8 + (bk & 7)];
    if (wb >= 2) mg += 30; if (bb >= 2) mg -= 30;
    // Pawn structure: doubled & isolated.
    for (let f = 0; f < 8; f++) {
      if (wPawnFiles[f] > 1) mg -= 12 * (wPawnFiles[f] - 1);
      if (bPawnFiles[f] > 1) mg += 12 * (bPawnFiles[f] - 1);
      const wIso = wPawnFiles[f] && !(wPawnFiles[f - 1] || wPawnFiles[f + 1]);
      const bIso = bPawnFiles[f] && !(bPawnFiles[f - 1] || bPawnFiles[f + 1]);
      if (wIso) mg -= 10; if (bIso) mg += 10;
    }
    // Passed pawns.
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (p !== 'P' && p !== 'p') continue;
      const f = s & 7, r = s >> 3, w = p === 'P';
      let passed = true;
      for (let rr = w ? r - 1 : r + 1; w ? rr >= 0 : rr < 8; rr += w ? -1 : 1) {
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
          if (b[rr * 8 + ff] === (w ? 'p' : 'P')) { passed = false; break; }
        }
        if (!passed) break;
      }
      if (passed) { const adv = w ? 6 - r : r - 1; mg += (w ? 1 : -1) * (10 + adv * adv * (endgame ? 8 : 4)); }
    }
    return mg;
  }

  function orderScore(m, killers, ply) {
    if (m.captured) return 10000 + VAL[m.captured.toLowerCase()] * 10 - VAL[m.piece.toLowerCase()] / 10;
    if (m.promotion) return 9000;
    const k = killers[ply];
    if (k && k.some((x) => x && x.from === m.from && x.to === m.to)) return 8000;
    return 0;
  }

  function search(fen, opts) {
    const g = new Chess(fen);
    if (opts.history) g.repKeys = opts.history.slice();
    const maxDepth = opts.depth || 4, deadline = Date.now() + (opts.time || 2000);
    const killers = [];
    let nodes = 0, stop = false;
    const tt = new Map();

    function quiesce(alpha, beta, ply) {
      nodes++;
      const stand = (g.turn === 'w' ? 1 : -1) * evaluate(g);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (ply > 8) return alpha;
      const ms = g.moves({ captures: true });
      ms.sort((a, b) => orderScore(b, killers, 0) - orderScore(a, killers, 0));
      for (const m of ms) {
        g.make(m);
        const sc = -quiesce(-beta, -alpha, ply + 1);
        g.undo();
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
      }
      return alpha;
    }

    function ab(depth, alpha, beta, ply) {
      if ((nodes & 2047) === 0 && Date.now() > deadline) stop = true;
      if (stop) return 0;
      nodes++;
      if (ply > 0) {
        const key = g.key();
        // Any repetition (of game history or within the search path) is scored as a draw.
        if (g.half >= 100 || g.repKeys.includes(key) || pathKeys.indexOf(key) < pathKeys.length - 1) return 0;
      }
      const chk = g.inCheck();
      if (chk) depth++;
      if (depth <= 0) return quiesce(alpha, beta, 0);
      const key = g.key();
      const hit = tt.get(key);
      const ms = g.moves();
      if (!ms.length) return chk ? -MATE + ply : 0;
      ms.sort((a, b) => {
        const ha = hit && hit.from === a.from && hit.to === a.to ? 1e6 : 0;
        const hb = hit && hit.from === b.from && hit.to === b.to ? 1e6 : 0;
        return hb + orderScore(b, killers, ply) - ha - orderScore(a, killers, ply);
      });
      let best = -Infinity, bestM = null;
      for (const m of ms) {
        g.make(m); pathKeys.push(g.key());
        const sc = -ab(depth - 1, -beta, -alpha, ply + 1);
        pathKeys.pop(); g.undo();
        if (stop) return 0;
        if (sc > best) { best = sc; bestM = m; }
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) {
          if (!m.captured) { killers[ply] = killers[ply] || []; killers[ply].unshift(m); killers[ply].length = 2; }
          break;
        }
      }
      if (bestM) tt.set(key, { from: bestM.from, to: bestM.to });
      return best;
    }
    const pathKeys = [];

    // Root with multi-PV style scoring so we can report alternatives.
    let rootMoves = g.moves();
    if (!rootMoves.length) return { best: null, score: 0, lines: [] };
    let results = rootMoves.map((m) => ({ m, score: 0 }));
    let completedDepth = 0;
    for (let d = 1; d <= maxDepth; d++) {
      const cur = [];
      for (const r of results) {
        g.make(r.m); pathKeys.push(g.key());
        const sc = -ab(d - 1, -MATE - 1, MATE + 1, 1);
        pathKeys.pop(); g.undo();
        if (stop) break;
        cur.push({ m: r.m, score: sc });
      }
      if (stop && cur.length < results.length) {
        // Merge partial results: keep searched moves first if they beat the old best.
        if (cur.length) { const ids = new Set(cur.map((c) => c.m)); results = cur.concat(results.filter((r) => !ids.has(r.m))); results.sort((a, b) => b.score - a.score); }
        break;
      }
      results = cur.sort((a, b) => b.score - a.score);
      completedDepth = d;
      if (Math.abs(results[0].score) > MATE - 100) break;
      if (Date.now() > deadline) break;
    }

    // Difficulty: pick among near-best moves with some randomness.
    let chosen = results[0];
    if (opts.blunder && results.length > 1) {
      const margin = opts.blunder;
      const pool = results.filter((r) => r.score >= results[0].score - margin);
      chosen = pool[Math.floor(Math.random() * pool.length)];
    }
    const sign = g.turn === 'w' ? 1 : -1;
    return {
      best: { from: chosen.m.from, to: chosen.m.to, promotion: chosen.m.promotion },
      score: sign * chosen.score, // White-relative
      topScore: sign * results[0].score,
      lines: results.slice(0, opts.multi || 3).map((r) => ({ from: r.m.from, to: r.m.to, promotion: r.m.promotion, score: sign * r.score })),
      depth: completedDepth, nodes,
    };
  }

  return { search, evaluate, MATE };
}

/* Worker bootstrap — only executed inside the worker. */
function workerMain() {
  const lib = ChessCore();
  const ai = AICore(lib);
  self.onmessage = (e) => {
    const { id, fen, opts } = e.data;
    try { self.postMessage({ id, res: ai.search(fen, opts || {}) }); }
    catch (err) { self.postMessage({ id, error: String(err && err.stack || err) }); }
  };
}

/** Create the engine. Uses a Blob worker; falls back to main thread if workers are unavailable. */
function createEngine() {
  let worker = null, seq = 0;
  const pending = new Map();
  try {
    const src = ChessCore.toString() + '\n' + AICore.toString() + '\n(' + workerMain.toString() + ')();';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.res);
    };
  } catch (_) { worker = null; }
  const local = AICore(window.ChessLib); // used for static eval on the main thread, and as fallback search
  return {
    search(fen, opts) {
      if (!worker) return new Promise((r) => setTimeout(() => r(local.search(fen, opts)), 10));
      const id = ++seq;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, fen, opts }); });
    },
    evaluate: (g) => local.evaluate(g),
    MATE: local.MATE,
  };
}
