/* Dark Fantasy Chess — Insight: move classification and tactical-motif detection. */
(function () {
  'use strict';
  const { Chess, VAL, sqName, isWhite } = window.ChessLib;
  const { MOTIFS, OPENINGS } = window.Knowledge;
  const NAMES = window.Pieces.NAMES;
  const GEN = { p: 'пешку', n: 'коня', b: 'слона', r: 'ладью', q: 'ферзя', k: 'короля' }; // accusative
  const colorOf = (p) => (isWhite(p) ? 'w' : 'b');
  const SIDE = { w: 'Белые', b: 'Чёрные' };
  const MATE = 100000;

  // Russian figurine letters for SAN display.
  const RU = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' };
  const ruSan = (san) => san.replace(/^[KQRBN]/, (c) => RU[c]).replace(/=([QRBN])/, (_, c) => '=' + RU[c]);

  function fmtScore(s) {
    if (s === undefined || s === null) return '';
    if (Math.abs(s) > MATE - 1000) {
      const n = Math.ceil((MATE - Math.abs(s)) / 2);
      return (s > 0 ? '+' : '−') + 'M' + n;
    }
    const v = (s / 100).toFixed(1);
    return s > 0 ? '+' + v : s < 0 ? '−' + Math.abs(v).toFixed(1) : '0.0';
  }

  /** Cheap defence check: is `sq` defended by side `by`? */
  const defended = (g, sq, by) => g.attackersOf(sq, by).length > 0;
  /** Lowest-value attacker of `sq` belonging to `by` (value), or Infinity. */
  function minAttacker(g, sq, by) {
    let min = Infinity;
    for (const s of g.attackersOf(sq, by)) min = Math.min(min, VAL[g.board[s].toLowerCase()] || 10000);
    return min;
  }

  /** Is the piece on sq "en prise" for its owner (attacked & insufficiently defended)? */
  function enPrise(g, sq) {
    const p = g.board[sq];
    if (!p || p.toLowerCase() === 'k') return false;
    const me = colorOf(p), them = me === 'w' ? 'b' : 'w';
    if (!g.attacked(sq, them)) return false;
    const v = VAL[p.toLowerCase()];
    if (minAttacker(g, sq, them) < v) return true;
    return !defended(g, sq, me);
  }

  /** Pins & skewers created by side `by` (list of {kind, front, back, by:slider}). */
  function linePatterns(g, by) {
    const out = [];
    const dirs = { b: [[-1, -1], [-1, 1], [1, -1], [1, 1]], r: [[-1, 0], [1, 0], [0, -1], [0, 1]] };
    dirs.q = dirs.b.concat(dirs.r);
    for (let s = 0; s < 64; s++) {
      const p = g.board[s];
      if (!p || colorOf(p) !== by) continue;
      const t = p.toLowerCase();
      if (!dirs[t]) continue;
      for (const [dr, df] of dirs[t]) {
        let r = (s >> 3) + dr, f = (s & 7) + df, first = -1;
        while (r >= 0 && r < 8 && f >= 0 && f < 8) {
          const sq = r * 8 + f, q = g.board[sq];
          if (q) {
            if (colorOf(q) === by) break;
            if (first < 0) first = sq;
            else {
              const a = g.board[first].toLowerCase(), b = q.toLowerCase();
              const va = a === 'k' ? 10000 : VAL[a], vb = b === 'k' ? 10000 : VAL[b];
              const vs = VAL[t];
              if (vb > va && (b === 'k' || vb > vs)) out.push({ kind: 'pin', front: first, back: sq, slider: s });
              else if (va > vb && a !== 'p' && (va > vs || a === 'k') && (b !== 'p') && (!defended(g, sq, colorOf(q)) || vb > vs))
                out.push({ kind: 'skewer', front: first, back: sq, slider: s });
              break;
            }
          }
          r += dr; f += df;
        }
      }
    }
    return out;
  }

  const describePiece = (p, sq) => `${NAMES[p.toLowerCase()]} ${sqName(sq)}`;

  /**
   * Analyse a just-played move.
   * @param {string} fenBefore  position before the move
   * @param {object} m          move object (from Chess.moves)
   * @param {string[]} sanHist  SAN list including this move
   * @param {object} evals      {before:{score,lines}, after:{score}} engine data (White-relative), optional
   */
  function analyseMove(fenBefore, m, sanHist, evals) {
    const before = new Chess(fenBefore);
    const legalBefore = before.moves();
    const san = before.san(m, legalBefore);
    const mover = before.turn, them = mover === 'w' ? 'b' : 'w';
    const after = before.clone();
    after.make(m);
    const motifs = [];
    const add = (id, text, sq) => motifs.push({ id, text, sq });
    const ply = sanHist.length;
    const pt = m.piece.toLowerCase();

    // --- Status ---
    const afterMoves = after.moves();
    const inChk = after.inCheck();
    const checkers = inChk ? after.attackersOf(after.kingSq(them), mover) : [];
    if (inChk && !afterMoves.length) add('mate', 'Мат! Король повержен — защиты нет.');
    else if (!inChk && !afterMoves.length) add('stalemate', 'Пат: у соперника нет ходов, но нет и шаха. Ничья.');
    if (inChk && afterMoves.length) {
      if (checkers.length >= 2) add('doubleCheck', 'Двойной шах! Защититься можно только уходом короля.');
      else if (!checkers.includes(m.to) && m.flags !== 'k' && m.flags !== 'q') add('discoveredCheck', `Вскрытый шах: ${NAMES[after.board[checkers[0]].toLowerCase()]} ${sqName(checkers[0])} открыт отходом фигуры.`);
      else add('check', 'Шах королю.');
    }

    // --- Special moves ---
    if (m.flags === 'k') add('castle', 'Короткая рокировка: король укрыт, ладья в игре.');
    if (m.flags === 'q') add('longCastle', 'Длинная рокировка: ладья сразу на центральной линии.');
    if (m.flags === 'e') add('enPassant', 'Взятие на проходе!');
    if (m.promotion) {
      if (m.promotion === 'q') add('promotion', 'Пешка переродилась в ферзя!');
      else add('underpromotion', `Пешка превратилась в ${GEN[m.promotion]} — недопревращение.`);
    }

    // --- Captures / material ---
    const movedEnPrise = enPrise(after, m.to);
    if (m.captured) {
      const cv = VAL[m.captured.toLowerCase()], mv = VAL[pt] || 0;
      const recapt = after.attacked(m.to, them);
      if (!recapt || cv > mv) add('winMaterial', `Взят${m.captured.toLowerCase() === 'p' ? 'а' : ''} ${GEN[m.captured.toLowerCase()]} на ${sqName(m.to)}${!recapt ? ' — бесплатно' : ''}.`, m.to);
      else if (cv === mv) add('trade', `Размен: ${NAMES[pt]} за ${GEN[m.captured.toLowerCase()]}.`, m.to);
    }

    // --- Fork: moved piece attacks 2+ valuable targets ---
    if (pt !== 'k') {
      const mvVal = VAL[after.board[m.to].toLowerCase()];
      const targets = after.attacksFrom(m.to).filter((s) => {
        const q = after.board[s];
        if (!q || colorOf(q) !== them) return false;
        const tq = q.toLowerCase();
        return tq === 'k' || VAL[tq] > mvVal || (!defended(after, s, them) && tq !== 'p');
      });
      const safe = !movedEnPrise || inChk;
      if (targets.length >= 2 && safe) {
        const names = targets.map((s) => describePiece(after.board[s], s)).join(' и ');
        add('fork', `Вилка! ${NAMES[pt][0].toUpperCase() + NAMES[pt].slice(1)} нападает сразу на: ${names}.`, m.to);
      }
    }

    // --- Pins / skewers created by this move ---
    const key = (x) => x.kind + x.front + '-' + x.back;
    const prevLines = new Set(linePatterns(before, mover).map(key));
    for (const lp of linePatterns(after, mover)) {
      if (prevLines.has(key(lp))) continue;
      if (lp.slider !== m.to && !inChk) continue;
      const fr = after.board[lp.front], bk = after.board[lp.back];
      if (lp.kind === 'pin') add('pin', `Связка: ${describePiece(fr, lp.front)} не может уйти — за ним ${describePiece(bk, lp.back)}.`, lp.front);
      else add('skewer', `Сквозной удар: ${describePiece(fr, lp.front)} должен уйти, и откроется ${describePiece(bk, lp.back)}.`, lp.front);
      break;
    }

    // --- Discovered attack (not check) on a big piece ---
    if (!inChk) {
      for (let s = 0; s < 64; s++) {
        const p = after.board[s];
        if (!p || colorOf(p) !== mover || s === m.to) continue;
        const newT = after.attacksFrom(s).filter((t) => after.board[t] && colorOf(after.board[t]) === them && 'qr'.includes(after.board[t].toLowerCase()));
        const oldT = before.attacksFrom(s);
        const fresh = newT.filter((t) => !oldT.includes(t) && VAL[after.board[t].toLowerCase()] > VAL[p.toLowerCase()]);
        if (fresh.length) { add('discoveredAttack', `Вскрытое нападение: ${describePiece(p, s)} теперь бьёт ${GEN[after.board[fresh[0]].toLowerCase()]} ${sqName(fresh[0])}.`, fresh[0]); break; }
      }
    }

    // --- Hanging / sacrifice ---
    if (movedEnPrise && !afterMoves.length === false && !(inChk && !afterMoves.length)) {
      const v = VAL[after.board[m.to].toLowerCase()];
      const gain = m.captured ? VAL[m.captured.toLowerCase()] : 0;
      if (v - gain >= 200) add('hanging', `${describePiece(after.board[m.to], m.to)} под боем и недостаточно защищён.`, m.to);
    }
    // Other own pieces left hanging (only big ones, to avoid noise).
    for (let s = 0; s < 64; s++) {
      const p = after.board[s];
      if (!p || colorOf(p) !== mover || s === m.to || 'pk'.includes(p.toLowerCase())) continue;
      if (enPrise(after, s) && !enPrise(before, s)) { add('hanging', `Осторожно: ${describePiece(p, s)} остался без защиты.`, s); break; }
    }

    // --- Opening principles (first ~10 moves each) ---
    if (ply <= 20) {
      if (pt === 'p' && [27, 28, 35, 36].includes(m.to)) add('center', 'Пешка заняла центр.');
      const homeRank = mover === 'w' ? 7 : 0;
      if ('nb'.includes(pt) && (m.from >> 3) === homeRank) add('develop', `Развитие: ${NAMES[pt]} вступил в игру.`);
      if (pt === 'q' && ply <= 10) {
        const minorsHome = [1, 2, 5, 6].map((f) => homeRank * 8 + f).filter((s) => after.board[s] && 'nb'.includes(after.board[s].toLowerCase()) && colorOf(after.board[s]) === mover).length;
        if (minorsHome >= 3) add('earlyQueen', 'Ферзь вышел рано — соперник получит темпы, нападая на него.');
      }
      if (pt === 'k' && m.flags !== 'k' && m.flags !== 'q' && ply <= 24) {
        const c = before.castle;
        if (mover === 'w' ? (c.K || c.Q) : (c.k || c.q)) add('kingWalk', 'Король сделал ход и потерял право рокировки.');
      }
      if (pt === 'p' && ['f', 'g'].includes(sqName(m.from)[0]) && ply <= 12 && !m.captured) {
        const kf = sqName(before.kingSq(mover))[0];
        if ('efgh'.includes(kf)) add('weakKing', 'Пешка перед королём сдвинута — диагональ к королю ослаблена.');
      }
      if (ply <= 16 && !m.captured && !inChk && pt !== 'p' && pt !== 'k') {
        // Same piece moved twice: look at own earlier moves' destination == this from.
        const g2 = new Chess();
        let movedBefore = false;
        for (let i = 0; i < sanHist.length - 1; i++) {
          const mm = g2.moveFromSan(sanHist[i]);
          if (!mm) break;
          if (g2.turn === mover && mm.to === m.from) movedBefore = true;
          g2.make(mm);
        }
        if (movedBefore) add('samePiece', 'Эта фигура ходит второй раз в дебюте — темп потерян?');
      }
    }

    // --- Positional notes ---
    if (pt === 'p' && !m.promotion) {
      const f = m.to & 7, r = m.to >> 3, w = mover === 'w';
      let passed = true;
      for (let rr = w ? r - 1 : r + 1; w ? rr >= 0 : rr < 8; rr += w ? -1 : 1)
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++)
          if (after.board[rr * 8 + ff] === (w ? 'p' : 'P')) passed = false;
      const rel = w ? 7 - r : r;
      if (passed && rel >= 3) add('passedPawn', `Проходная пешка на ${sqName(m.to)} — её может остановить только фигура.`, m.to);
    }
    if (pt === 'r' && (m.from & 7) !== (m.to & 7)) {
      const f = m.to & 7;
      let open = true;
      for (let r = 0; r < 8; r++) if (after.board[r * 8 + f] && after.board[r * 8 + f].toLowerCase() === 'p') open = false;
      if (open) add('openFile', `Ладья заняла открытую вертикаль ${'abcdefgh'[f]}.`);
    }
    if (m.captured && m.captured.toLowerCase() === 'b') {
      const count = (g, c) => g.board.filter((p) => p === (c === 'w' ? 'B' : 'b')).length;
      if (count(after, mover) === 2 && count(after, them) <= 1) add('bishopPair', `${SIDE[mover]} сохранили двуслонье.`);
    }

    // --- Threats the mover now creates (null-move idea) ---
    const threats = [];
    if (!inChk) {
      for (let s = 0; s < 64; s++) {
        const p = after.board[s];
        if (!p || colorOf(p) !== them || p.toLowerCase() === 'k') continue;
        if (enPrise(after, s) && !enPrise(before.clone(), s)) threats.push(s);
      }
    }

    // --- Opening name ---
    let opening = null;
    for (const o of OPENINGS) {
      if (o.seq.length === ply && o.seq.every((x, i) => x.replace(/[+#]/g, '') === (sanHist[i] || '').replace(/[+#]/g, ''))) opening = o;
    }

    // --- Quality via engine ---
    let quality = null, loss = null, better = null;
    if (evals && evals.before && evals.after) {
      const s = mover === 'w' ? 1 : -1;
      const b = evals.before.score, a = evals.after.score;
      const clamp = (x) => Math.max(-3000, Math.min(3000, x));
      loss = Math.max(0, s * (clamp(b) - clamp(a)));
      const bestLine = evals.before.lines && evals.before.lines[0];
      const isBest = bestLine && bestLine.from === m.from && bestLine.to === m.to;
      const sacrificed = movedEnPrise && !m.captured && VAL[pt] >= 300 || (m.captured && VAL[pt] - VAL[m.captured.toLowerCase()] >= 200 && movedEnPrise);
      if (inChk && !afterMoves.length) quality = 'brilliant';
      else if (sacrificed && loss <= 40 && s * a > -100) quality = 'brilliant';
      else if (isBest || loss <= 15) quality = 'best';
      else if (loss <= 60) quality = 'good';
      else if (loss <= 140) quality = 'inaccuracy';
      else if (loss <= 300) quality = 'mistake';
      else quality = 'blunder';
      if (quality === 'brilliant' && sacrificed) add('sacrifice', 'Жертва! Материал отдан, но позиция держится.', m.to);
      if (bestLine && !isBest && ['inaccuracy', 'mistake', 'blunder'].includes(quality)) {
        const mv = before.findMove(bestLine.from, bestLine.to, bestLine.promotion);
        if (mv) better = { san: before.san(mv, legalBefore), from: bestLine.from, to: bestLine.to, score: bestLine.score };
      }
    }

    return { san, mover, motifs, threats, opening, quality, loss, better, inCheck: inChk };
  }

  const QUALITY = {
    brilliant: { mark: '!!', label: 'Блестящий ход', cls: 'q-brilliant' },
    best: { mark: '!', label: 'Лучший ход', cls: 'q-best' },
    good: { mark: '', label: 'Хороший ход', cls: 'q-good' },
    inaccuracy: { mark: '?!', label: 'Неточность', cls: 'q-inacc' },
    mistake: { mark: '?', label: 'Ошибка', cls: 'q-mistake' },
    blunder: { mark: '??', label: 'Зевок', cls: 'q-blunder' },
  };

  /** Pieces of `side` currently hanging (for learner warnings). */
  function hangingPieces(g, side) {
    const out = [];
    for (let s = 0; s < 64; s++) {
      const p = g.board[s];
      if (p && colorOf(p) === side && p.toLowerCase() !== 'k' && enPrise(g, s)) out.push(s);
    }
    return out;
  }

  window.Insight = { analyseMove, QUALITY, MOTIFS, fmtScore, ruSan, hangingPieces, SIDE, GEN };
})();
