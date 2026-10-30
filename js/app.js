/* Dark Fantasy Chess — Main Game UI Controller & Orchestrator */
(function() {
  'use strict';

  const { Chess, sqName, parseSq, isWhite, VAL } = window.ChessLib;
  const { analyseMove, QUALITY, MOTIFS, fmtScore, ruSan, hangingPieces, SIDE, GEN } = window.Insight;
  const { PIECE_RULES, CODEX, LESSONS } = window.Knowledge;
  const { pieceSVG, NAMES } = window.Pieces;

  class GameController {
    constructor() {
      this.game = new Chess();
      this.engine = createEngine();
      this.audio = new window.SoundFX();
      this.network = null;

      // Game Modes: 'ai', 'pass_and_play', 'multiplayer', 'academy'
      this.mode = 'ai';
      this.aiSide = 'b'; // AI plays black
      this.aiDepth = 4;
      this.learnerMode = true; // Shows hints, warnings, insights

      // Board State
      this.flipped = false;
      this.selectedSq = null;
      this.validMoves = [];
      this.lastMove = null;
      this.sanHistory = [];
      this.prevFen = this.game.fen();
      this.pendingPromoMove = null;

      // Academy state
      this.activeLesson = null;
      this.lessonStep = 0;
      this.lessonStarsRemaining = [];
      this.lessonBusy = false; // opponent reply / wrong-move rollback in progress
      this.lessonDone = false;

      // Bumped on reset/undo so stale engine results are dropped.
      this.epoch = 0;

      // Online state
      this.myNetColor = 'w';

      // Battlefield: 'cutin' (close-up battle scene on captures) | 'board' | 'off'
      this.battleMode = 'cutin';
      this.animating = false;

      this.initDOMElements();
      this.field = new window.Battlefield(this.boardEl);
      this.initEvents();
      this.renderBoard();
      this.updateStatus();

      // Check URL for join link: #join=dfc-xyz
      this.checkUrlHash();
    }

    initDOMElements() {
      this.boardEl = document.getElementById('board');
      this.evalWhiteEl = document.getElementById('evalWhite');
      this.evalTextEl = document.getElementById('evalText');
      this.topPlayerEl = document.getElementById('topPlayer');
      this.bottomPlayerEl = document.getElementById('bottomPlayer');
      this.topPlayerNameEl = document.getElementById('topPlayerName');
      this.bottomPlayerNameEl = document.getElementById('bottomPlayerName');
      this.topCapturedEl = document.getElementById('topCaptured');
      this.bottomCapturedEl = document.getElementById('bottomCaptured');

      this.moveLogEl = document.getElementById('moveLog');
      this.insightCardEl = document.getElementById('insightCard');
      this.chroniclesBoxEl = document.getElementById('chroniclesBox');
      this.learnerAlertEl = document.getElementById('learnerAlert');
      this.insightDefaultHtml = this.insightCardEl.innerHTML;

      // Modals
      this.promoDialog = document.getElementById('promoDialog');
      this.promoOptsEl = document.getElementById('promoOpts');
      this.settingsDialog = document.getElementById('settingsDialog');
      this.codexDialog = document.getElementById('codexDialog');
      this.shareDialog = document.getElementById('shareDialog');
    }

    initEvents() {
      // Board clicks
      // 'click', not 'pointerdown': the battlefield turns a drag into camera rotation and swallows its click.
      this.boardEl.addEventListener('click', (e) => this.handleBoardClick(e));

      // Header buttons
      document.getElementById('btnNewGame').addEventListener('click', () => {
        // "Новая" leaves the Academy and returns to the mode chosen in settings.
        if (this.mode === 'academy') this.mode = document.getElementById('optMode').value;
        this.resetGame();
      });
      document.getElementById('btnFlip').addEventListener('click', () => {
        this.flipped = !this.flipped;
        this.renderBoard();
      });
      document.getElementById('btnSettings').addEventListener('click', () => this.settingsDialog.showModal());
      document.getElementById('btnCodex').addEventListener('click', () => this.openCodex());
      document.getElementById('btnShare').addEventListener('click', () => this.openShareModal());

      // Tabs
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          const tabId = btn.dataset.tab;
          document.getElementById(tabId).classList.add('active');
          if (tabId === 'tabAcademy') this.renderLessonsList();
        });
      });

      // Settings inputs
      document.getElementById('optMode').addEventListener('change', (e) => {
        this.mode = e.target.value;
        this.resetGame();
      });
      document.getElementById('optAiDiff').addEventListener('change', (e) => {
        this.aiDepth = parseInt(e.target.value, 10);
      });
      document.getElementById('optLearner').addEventListener('change', (e) => {
        this.learnerMode = e.target.checked;
        this.renderBoard();
      });
      document.getElementById('optSound').addEventListener('change', (e) => {
        this.audio.enabled = e.target.checked;
      });
      document.getElementById('optBattle').addEventListener('change', (e) => {
        this.battleMode = e.target.value;
      });

      // Promotion pick
      this.promoOptsEl.addEventListener('click', (e) => {
        const opt = e.target.closest('.promo-opt');
        if (!opt || !this.pendingPromoMove) return;
        const promoPiece = opt.dataset.piece;
        this.pendingPromoMove.promotion = promoPiece;
        const m = this.pendingPromoMove;
        this.pendingPromoMove = null;
        this.selectedSq = null;
        this.validMoves = [];
        this.promoDialog.close();
        this.executeMove(m);
      });
    }

    resetGame(fen = null) {
      this.game = new Chess(fen);
      this.selectedSq = null;
      this.validMoves = [];
      this.lastMove = null;
      this.sanHistory = [];
      this.prevFen = this.game.fen();
      this.moveLogEl.innerHTML = '';
      this.activeLesson = null;
      this.lessonStep = 0;
      this.lessonBusy = false;
      this.lessonDone = false;
      this.epoch++;

      this.insightCardEl.innerHTML = this.insightDefaultHtml;
      this.chroniclesBoxEl.style.display = 'none';
      this.learnerAlertEl.style.display = 'none';
      this.updateEvalBar(0);

      this.updateStatus();
      this.renderBoard();

      if (this.mode === 'ai' && this.game.turn === this.aiSide) {
        this.triggerAiMove();
      }
    }

    renderBoard() {
      const b = this.game.board;
      const stars = this.activeLesson && this.activeLesson.stars
        ? this.lessonStarsRemaining.map((n) => parseSq(n)) : [];
      this.field.setFlipped(this.flipped);
      this.field.render({
        board: b,
        selected: this.selectedSq,
        lastMove: this.lastMove,
        checkSq: this.game.inCheck() ? this.game.kingSq(this.game.turn) : -1,
        hanging: (this.learnerMode && this.mode !== 'academy') ? hangingPieces(this.game, this.game.turn) : [],
        hints: this.validMoves.map((m) => ({ to: m.to, capture: !!b[m.to] || m.flags === 'e' })),
        stars,
      });
    }

    handleBoardClick(e) {
      if (this.animating) return;
      if (this.mode === 'multiplayer' && this.game.turn !== this.myNetColor) return;
      if (this.mode === 'ai' && this.game.turn === this.aiSide) return;
      if (this.mode === 'academy' && (this.lessonBusy || this.lessonDone)) return;

      // Squares and the units standing on them both carry data-sq.
      const target = e.target.closest('[data-sq]');
      if (!target) return;
      const sq = parseInt(target.dataset.sq, 10);
      const piece = this.game.board[sq];

      // If a piece was already selected
      if (this.selectedSq !== null) {
        const move = this.validMoves.find(m => m.to === sq);
        if (move) {
          // Pawn promotion check
          const p = this.game.board[this.selectedSq];
          if (p.toLowerCase() === 'p' && (sq >> 3 === 0 || sq >> 3 === 7)) {
            this.promptPromotion(move);
            return;
          }
          this.executeMove(move);
          this.selectedSq = null;
          this.validMoves = [];
          return;
        }
      }

      // Select piece of current player
      if (piece && isWhite(piece) === (this.game.turn === 'w')) {
        this.selectedSq = sq;
        this.validMoves = this.game.moves({ square: sq });

        // Show rule popup if in learner mode (in the Academy the banner belongs to the lesson)
        if (this.learnerMode && this.mode !== 'academy' && PIECE_RULES[piece.toLowerCase()]) {
          this.showLearnerNotice(NAMES[piece.toLowerCase()], PIECE_RULES[piece.toLowerCase()]);
        }
      } else {
        this.selectedSq = null;
        this.validMoves = [];
      }

      this.renderBoard();
    }

    promptPromotion(move) {
      this.pendingPromoMove = move;
      const color = this.game.turn;
      const pieces = color === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
      this.promoOptsEl.innerHTML = '';
      pieces.forEach(p => {
        const opt = document.createElement('div');
        opt.className = 'promo-opt';
        opt.dataset.piece = p.toLowerCase();
        opt.innerHTML = pieceSVG(p);
        this.promoOptsEl.appendChild(opt);
      });
      this.promoDialog.showModal();
    }

    /** Star lessons have pieces of one side only: no opponent, no game-over rules. */
    isStarLesson() {
      return this.mode === 'academy' && !!this.activeLesson && this.activeLesson.type === 'stars';
    }

    /** Whose moves get the full Oracle breakdown (the other side only moves the eval bar). */
    isHumanMove(color) {
      if (this.mode === 'ai') return color !== this.aiSide;
      if (this.mode === 'multiplayer') return color === this.myNetColor;
      return true;
    }

    async executeMove(move, opts = {}) {
      const fenBefore = this.game.fen();
      const mover = this.game.turn;
      const san = this.game.san(move);
      const isCap = !!move.captured;

      // Play the move on the battlefield first; the capture sound lands with the blow.
      if (!isCap) this.audio.playMove();
      this.selectedSq = null;
      this.validMoves = [];
      this.renderBoard(); // drop selection/hint marks before the units start moving
      this.animating = true;
      const epoch = this.epoch;
      try {
        await this.field.playMove(move, this.battleMode, { onImpact: () => this.audio.playCapture() });
      } catch (err) {
        console.warn('Battle animation failed:', err);
      }
      this.animating = false;
      if (epoch !== this.epoch) return; // the game was reset while the fight played out
      if (isCap && this.battleMode === 'off') this.audio.playCapture();

      this.game.play(move);
      // Star lessons: pass the turn straight back to the student.
      if (this.isStarLesson()) this.game.makeNull();
      this.lastMove = move;
      this.sanHistory.push(san);
      this.appendMoveLog(san);

      // Send to online peer if multiplayer
      if (this.mode === 'multiplayer' && this.network) {
        this.network.sendMove(move);
      }

      // Check / Mate sounds
      if (!this.isStarLesson() && this.game.status().over) {
        this.audio.playMate();
      } else if (this.game.inCheck()) {
        this.audio.playCheck();
      }

      // Academy handling (scripted opponent replies are not the student's moves)
      if (this.mode === 'academy' && this.activeLesson && !opts.lessonReply) {
        this.handleLessonStep(move, san);
      }

      this.renderBoard();
      this.updateStatus();

      // Insight Analysis. Skipped in the Academy: the Oracle would spoil puzzle solutions.
      if (this.mode !== 'academy') this.runPostMoveAnalysis(fenBefore, move, mover);

      if (this.mode === 'ai' && !this.game.status().over && this.game.turn === this.aiSide) {
        setTimeout(() => this.triggerAiMove(), 300);
      }
    }

    async runPostMoveAnalysis(fenBefore, move, mover) {
      // Snapshot now: by the time the engine answers, the AI may already have replied.
      const epoch = this.epoch;
      const sanHist = this.sanHistory.slice();
      const fenAfter = this.game.fen();
      const human = this.isHumanMove(mover);
      try {
        // Both requests are queued together so the AI's own search can't slip in between.
        const [evalBefore, evalAfter] = await Promise.all([
          human ? this.engine.search(fenBefore, { depth: 2, time: 200 }) : null,
          this.engine.search(fenAfter, { depth: 2, time: 200 }),
        ]);
        if (epoch !== this.epoch) return;
        this.updateEvalBar(evalAfter.score);

        if (human) {
          const insight = analyseMove(fenBefore, move, sanHist, { before: evalBefore, after: evalAfter });
          this.renderInsight(insight, evalAfter.score);
        } else {
          // Keep the student's move on the card; just note the reply under it.
          const replyEl = this.insightCardEl.querySelector('.opp-reply');
          if (replyEl) replyEl.innerHTML = `Ответ противника: <strong>${ruSan(sanHist[sanHist.length - 1])}</strong>`;
        }
      } catch (err) {
        console.warn('Engine analysis skipped:', err);
      }
    }

    renderInsight(insight, score) {
      const q = insight.quality ? QUALITY[insight.quality] : null;
      const sanRu = ruSan(insight.san);

      let motifsHtml = '';
      if (insight.motifs && insight.motifs.length) {
        motifsHtml = insight.motifs.map(m => {
          const k = MOTIFS[m.id];
          const icon = k ? k.icon : '⚔️';
          // Some motif texts already open with their title ("Развитие: ...") — don't repeat it.
          const label = k && !m.text.startsWith(k.title) ? `<strong>${k.title}:</strong> ` : '';
          return `<div class="motif-item">
            <span class="motif-icon">${icon}</span>
            <div>${label}${m.text}</div>
          </div>`;
        }).join('');
      } else {
        motifsHtml = '<div style="color:var(--text-muted);font-size:0.85rem;">Позиционный ход без резких тактических ударов.</div>';
      }

      let chroniclesHtml = '';
      const primaryMotif = insight.motifs.find(m => MOTIFS[m.id] && MOTIFS[m.id].masters);
      if (primaryMotif) {
        const data = MOTIFS[primaryMotif.id];
        const mstr = data.masters[0];
        chroniclesHtml = `
          <div class="chronicles-title">📜 Летопись мастеров: ${data.title}</div>
          <div class="chronicles-event">${mstr.who} (${mstr.event})</div>
          <div>${mstr.text}</div>
        `;
        this.chroniclesBoxEl.style.display = 'block';
        this.chroniclesBoxEl.innerHTML = chroniclesHtml;
      } else if (insight.opening) {
        chroniclesHtml = `
          <div class="chronicles-title">📖 Дебют: ${insight.opening.name}</div>
          <div>${insight.opening.text}</div>
        `;
        this.chroniclesBoxEl.style.display = 'block';
        this.chroniclesBoxEl.innerHTML = chroniclesHtml;
      } else {
        this.chroniclesBoxEl.style.display = 'none';
      }

      this.insightCardEl.innerHTML = `
        <div class="move-banner">
          <span class="move-san">${sanRu}</span>
          ${q ? `<span class="quality-tag ${q.cls}">${q.mark} ${q.label}</span>` : ''}
        </div>
        ${insight.better ? `<div class="better-move">💡 Сильнее было: <strong>${ruSan(insight.better.san)}</strong> (${fmtScore(insight.better.score)})</div>` : ''}
        <div class="motif-list">${motifsHtml}</div>
        <div class="opp-reply"></div>
      `;
    }

    updateEvalBar(score) {
      if (score === undefined || score === null) return;
      const clamped = Math.max(-1000, Math.min(1000, score));
      // Win percentage calculation (logistic formula)
      const winPct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * clamped)) - 1);
      this.evalWhiteEl.style.height = `${winPct}%`;
      this.evalTextEl.textContent = fmtScore(score);
    }

    updateStatus() {
      const status = this.game.status();
      const turn = this.game.turn;

      this.topPlayerEl.classList.toggle('active', this.flipped ? turn === 'w' : turn === 'b');
      this.bottomPlayerEl.classList.toggle('active', this.flipped ? turn === 'b' : turn === 'w');

      // In the Academy the lesson itself reports the outcome.
      if (status.over && this.mode !== 'academy') {
        let msg = '';
        if (status.reason === 'checkmate') msg = `Мат! Победили ${status.result === '1-0' ? 'Белые' : 'Чёрные'}`;
        else if (status.reason === 'stalemate') msg = 'Пат! Ничья.';
        else msg = 'Ничья!';
        this.showLearnerNotice('Партия окончена', msg);
      }
    }

    appendMoveLog(san) {
      const ply = this.sanHistory.length;
      const moveNum = Math.ceil(ply / 2);
      if (ply % 2 === 1) {
        const row = document.createElement('div');
        row.className = 'move-log-row';
        row.innerHTML = `<span class="move-num">${moveNum}.</span><span class="move-white">${ruSan(san)}</span><span class="move-black"></span>`;
        this.moveLogEl.appendChild(row);
      } else {
        const lastRow = this.moveLogEl.lastElementChild;
        if (lastRow) {
          lastRow.querySelector('.move-black').textContent = ruSan(san);
        }
      }
      this.moveLogEl.scrollTop = this.moveLogEl.scrollHeight;
    }

    showLearnerNotice(title, text) {
      this.learnerAlertEl.innerHTML = `<strong>${title}:</strong> ${text}`;
      this.learnerAlertEl.style.display = 'block';
    }

    async triggerAiMove() {
      const fen = this.game.fen();
      const epoch = this.epoch;
      const res = await this.engine.search(fen, { depth: this.aiDepth, time: 1000 });
      if (epoch !== this.epoch || this.game.fen() !== fen) return; // game was reset meanwhile
      if (res && res.best) {
        const move = this.game.findMove(res.best.from, res.best.to, res.best.promotion);
        if (move) this.executeMove(move);
      }
    }

    /* ---------- Academy & Lessons ---------- */
    renderLessonsList() {
      const listEl = document.getElementById('academyList');
      listEl.innerHTML = '';
      LESSONS.forEach((les, idx) => {
        const card = document.createElement('div');
        card.className = `lesson-card ${this.activeLesson && this.activeLesson.id === les.id ? 'active' : ''}`;
        card.innerHTML = `
          <div>
            <strong>${idx + 1}. ${les.title}</strong>
            <div style="font-size:0.75rem;color:var(--text-muted);">${les.type === 'stars' ? 'Сбор огоньков' : 'Тактическая задача'}</div>
          </div>
          <span class="lesson-badge">${les.type}</span>
        `;
        card.addEventListener('click', () => this.startLesson(les));
        listEl.appendChild(card);
      });
    }

    startLesson(les) {
      this.mode = 'academy';
      this.resetGame(les.fen); // clears the previous lesson, so set the new one after it
      this.activeLesson = les;
      this.lessonStarsRemaining = les.stars ? [...les.stars] : [];
      this.flipped = false;
      this.showLearnerNotice(les.title, les.intro);
      this.renderBoard();
      this.renderLessonsList();
    }

    /**
     * Lesson solution format: arrays are the student's accepted moves (SAN alternatives),
     * strings are scripted opponent replies. `any: true` accepts every legal move.
     */
    handleLessonStep(move, san) {
      const les = this.activeLesson;
      if (les.type === 'stars') {
        const idx = this.lessonStarsRemaining.indexOf(sqName(move.to));
        if (idx !== -1) this.lessonStarsRemaining.splice(idx, 1);
        if (!this.lessonStarsRemaining.length) this.finishLesson('Отлично! Все огоньки собраны.');
        return;
      }

      if (les.any || !les.solution) {
        this.finishLesson(les.success ? les.success(san) : 'Отличный ход!');
        return;
      }

      const clean = (s) => s.replace(/[+#!?]/g, '');
      const accepted = les.solution[this.lessonStep] || [];
      if (!accepted.map(clean).includes(clean(san))) {
        this.showLearnerNotice('Не то', `${ruSan(san)} — это не решение. Фигура вернётся, попробуй ещё раз.`);
        this.lessonBusy = true;
        setTimeout(() => this.undoLessonMove(), 900);
        return;
      }

      this.lessonStep++;
      const reply = les.solution[this.lessonStep];
      if (typeof reply === 'string') {
        this.lessonStep++;
        this.lessonBusy = true;
        this.showLearnerNotice('Верно!', 'Противник отвечает…');
        setTimeout(() => {
          this.lessonBusy = false;
          const m = this.game.moveFromSan(reply);
          if (m) this.executeMove(m, { lessonReply: true });
          this.showLearnerNotice('Верно!', `Противник ответил ${ruSan(reply)}. Твой ход — доведи идею до конца.`);
        }, 700);
        return;
      }

      if (this.lessonStep >= les.solution.length) this.finishLesson(les.success ? les.success(san) : 'Отличный ход!');
    }

    /** Take back the student's wrong move in a puzzle. */
    undoLessonMove() {
      this.game.undo();
      this.sanHistory.pop();
      const h = this.game.hist[this.game.hist.length - 1];
      this.lastMove = h ? h.m : null;
      this.moveLogEl.innerHTML = '';
      const sans = this.sanHistory;
      this.sanHistory = [];
      for (const s of sans) { this.sanHistory.push(s); this.appendMoveLog(s); }
      this.lessonBusy = false;
      this.renderBoard();
      this.updateStatus();
    }

    finishLesson(text) {
      this.lessonDone = true;
      this.showLearnerNotice('Урок пройден!', `${text} Выбери следующий урок в Академии или нажми «Новая» для обычной партии.`);
      // A mating solution already rang the mate bell in executeMove.
      if (this.isStarLesson() || !this.game.status().over) this.audio.playMate();
    }

    /* ---------- Codex Dialog ---------- */
    openCodex() {
      const codexContent = document.getElementById('codexContent');
      codexContent.innerHTML = CODEX.map(c => `
        <div style="margin-bottom:12px;">
          <h4 style="color:var(--border-gold);font-family:var(--font-serif);margin-bottom:4px;">${c.title}</h4>
          <p style="font-size:0.85rem;line-height:1.4;">${c.body}</p>
        </div>
      `).join('');
      this.codexDialog.showModal();
    }

    /* ---------- Multiplayer / Share Link ---------- */
    async openShareModal() {
      if (!this.network) {
        this.network = new window.PeerMultiplayer(
          (remoteMove) => {
            const m = this.game.findMove(remoteMove.from, remoteMove.to, remoteMove.promotion);
            if (m) this.executeMove(m);
          },
          (status, data) => this.handleNetworkStatus(status, data)
        );
      }

      const roomId = await this.network.init();
      const url = `${window.location.origin}${window.location.pathname}#join=${roomId}`;
      document.getElementById('shareUrlInput').value = url;
      this.shareDialog.showModal();
    }

    handleNetworkStatus(status, data) {
      const netStatusEl = document.getElementById('netStatusText');
      if (status === 'connected') {
        this.mode = 'multiplayer';
        this.myNetColor = data && data.isHost ? 'w' : 'b';
        this.flipped = this.myNetColor === 'b';
        if (netStatusEl) netStatusEl.textContent = `Подключено! Вы играете за: ${this.myNetColor === 'w' ? 'Белых' : 'Чёрных'}`;
        this.renderBoard();
        this.shareDialog.close();
      } else if (status === 'connecting') {
        if (netStatusEl) netStatusEl.textContent = 'Подключение к другу...';
      }
    }

    checkUrlHash() {
      const hash = window.location.hash;
      if (hash && hash.includes('#join=')) {
        const remoteId = hash.replace('#join=', '');
        this.network = new window.PeerMultiplayer(
          (remoteMove) => {
            const m = this.game.findMove(remoteMove.from, remoteMove.to, remoteMove.promotion);
            if (m) this.executeMove(m);
          },
          (status, data) => this.handleNetworkStatus(status, data)
        );
        this.network.init().then(() => {
          this.network.connectTo(remoteId);
        });
      }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.app = new GameController();
  });
})();
