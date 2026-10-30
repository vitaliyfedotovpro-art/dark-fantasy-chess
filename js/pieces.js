/* Dark Fantasy Chess — hand-drawn SVG pieces (viewBox 0 0 100 100). */
(function () {
  'use strict';
  const BASE = '<path class="pc-body" d="M20 92 L80 92 L76 84 L24 84 Z"/><path class="pc-body" d="M27 84 L73 84 L69 77 L31 77 Z"/>';

  const SHAPES = {
    p: `<path class="pc-body" d="M35 77 C35 62 41 54 45 49 L55 49 C59 54 65 62 65 77 Z"/>
        <path class="pc-body" d="M39 49 L61 49 L58 44 L42 44 Z"/>
        <path class="pc-body" d="M50 20 C60 20 64 28 63 36 C62 42 57 45 50 45 C43 45 38 42 37 36 C36 28 40 20 50 20 Z"/>
        <path class="pc-detail" d="M43 33 C46 30 54 30 57 33 C55 38 45 38 43 33 Z"/>`,
    r: `<path class="pc-body" d="M31 77 L35 46 L65 46 L69 77 Z"/>
        <path class="pc-body" d="M27 46 L27 22 L36 22 L36 29 L45 29 L45 22 L55 22 L55 29 L64 29 L64 22 L73 22 L73 46 Z"/>
        <path class="pc-detail" d="M47 54 L53 54 L53 68 L47 68 Z"/>
        <path class="pc-detail" d="M33 38 L67 38 L67 41 L33 41 Z"/>`,
    n: `<path class="pc-body" d="M33 77 C33 67 37 61 43 57 C38 56 32 56 28 52 C23 47 25 41 30 38 L45 29 C46 23 49 17 54 12 L56 21 C66 21 74 31 74 45 C74 59 67 67 67 77 Z"/>
        <path class="pc-body" d="M56 21 L62 9 L63 20 Z"/>
        <path class="pc-detail" d="M57 22 L66 16 L64 26 L72 23 L68 33 L76 32 L71 42 L66 30 Z"/>
        <circle class="pc-eye" cx="47" cy="33" r="3.2"/>
        <path class="pc-detail" d="M29 46 C31 47 33 47 34 46" stroke-width="2" fill="none"/>`,
    b: `<path class="pc-body" d="M34 77 C34 65 40 59 44 55 L56 55 C60 59 66 65 66 77 Z"/>
        <path class="pc-body" d="M37 49 L63 49 L61 55 L39 55 Z"/>
        <path class="pc-body" d="M50 15 C63 27 67 37 61 49 L39 49 C33 37 37 27 50 15 Z"/>
        <circle class="pc-body" cx="50" cy="12" r="4.5"/>
        <path class="pc-detail" d="M43 27 L57 41 L54.5 43.5 L40.5 29.5 Z"/>`,
    q: `<path class="pc-body" d="M32 77 L38 51 L62 51 L68 77 Z"/>
        <path class="pc-body" d="M30 51 L24 22 L37 38 L41 14 L50 34 L59 14 L63 38 L76 22 L70 51 Z"/>
        <circle class="pc-gem" cx="24" cy="20" r="3.5"/><circle class="pc-gem" cx="41" cy="12" r="3.5"/>
        <circle class="pc-gem" cx="59" cy="12" r="3.5"/><circle class="pc-gem" cx="76" cy="20" r="3.5"/>
        <path class="pc-detail" d="M36 60 L64 60 L64 63 L36 63 Z"/>
        <circle class="pc-eye" cx="50" cy="44" r="3"/>`,
    k: `<path class="pc-body" d="M32 77 L37 49 L63 49 L68 77 Z"/>
        <path class="pc-body" d="M29 49 L27 29 L40 38 L50 26 L60 38 L73 29 L71 49 Z"/>
        <path class="pc-body" d="M47 6 L53 6 L53 12 L59 12 L59 18 L53 18 L53 27 L47 27 L47 18 L41 18 L41 12 L47 12 Z"/>
        <path class="pc-detail" d="M36 60 L64 60 L64 63 L36 63 Z"/>
        <circle class="pc-eye" cx="50" cy="42" r="3"/>`,
  };

  const NAMES = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };

  /** Returns SVG markup for a piece letter (FEN case = colour). */
  function pieceSVG(p) {
    const t = p.toLowerCase(), side = p < 'a' ? 'light' : 'dark';
    return `<svg viewBox="0 0 100 100" class="pc pc-${side}" aria-hidden="true">
      <defs>
        <linearGradient id="g-${side}-${t}" x1="0" y1="0" x2="1" y2="1">
          ${side === 'light'
            ? '<stop offset="0" stop-color="#fbf3dc"/><stop offset=".55" stop-color="#d8c9a3"/><stop offset="1" stop-color="#8f7d57"/>'
            : '<stop offset="0" stop-color="#4b4256"/><stop offset=".5" stop-color="#1d1824"/><stop offset="1" stop-color="#07060a"/>'}
        </linearGradient>
      </defs>
      <g fill="url(#g-${side}-${t})">${SHAPES[t]}${BASE}</g>
    </svg>`;
  }

  window.Pieces = { pieceSVG, NAMES };
})();
