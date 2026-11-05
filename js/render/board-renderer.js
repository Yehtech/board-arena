/**
 * Classic Board Arena — 2x Retina Tactile Board & Piece Renderer
 * Inspired by PlayOK clarity × Gomoku.com warm tactile realism.
 *
 * Highlights on piece click (Xiangqi, Chess, Shogi, Draughts, Backgammon):
 *   - Selected piece: Golden radial halo + elevated 3D shadow
 *   - Legal empty destination: High-contrast Emerald Jade guide dot (#22c55e / #bbf7d0)
 *   - Legal capture destination: Vivid Crimson 4-corner tactical reticle (#ef4444) around enemy piece
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const SHOGI_KANJI = {
    K1: '王將',
    K2: '玉將',
    R: '飛車',
    '+R': '龍王',
    B: '角行',
    '+B': '龍馬',
    G: '金將',
    S: '銀將',
    '+S': '成銀',
    N: '桂馬',
    '+N': '成桂',
    L: '香車',
    '+L': '成香',
    P: '步兵',
    '+P': 'と'
  };

  const XIANGQI_KANJI = {
    1: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    2: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' }
  };

  const CHESS_GLYPHS = {
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
    P: '♙',
    k: '♚',
    q: '♛',
    r: '♜',
    b: '♝',
    n: '♞',
    p: '♟'
  };

  // Cached offscreen procedural surface patterns
  const patternCache = Object.create(null);

  function getWoodPattern(ctx, key, baseHex, streakHex, grainDensity) {
    if (patternCache[key]) return patternCache[key];
    if (typeof document === 'undefined') return baseHex;
    const off = document.createElement('canvas');
    off.width = 256;
    off.height = 256;
    const octx = off.getContext('2d');
    octx.fillStyle = baseHex;
    octx.fillRect(0, 0, 256, 256);

    const rng = BoardArena.createRng(key);
    octx.strokeStyle = streakHex;
    const lines = grainDensity || 75;
    for (let i = 0; i < lines; i++) {
      octx.globalAlpha = 0.04 + rng.nextFloat() * 0.08;
      octx.lineWidth = 0.8 + rng.nextFloat() * 2.1;
      const y = rng.nextFloat() * 256;
      octx.beginPath();
      octx.moveTo(0, y);
      octx.bezierCurveTo(85, y + (rng.nextFloat() - 0.5) * 10, 170, y + (rng.nextFloat() - 0.5) * 10, 256, y);
      octx.stroke();
    }
    patternCache[key] = ctx.createPattern(off, 'repeat');
    return patternCache[key];
  }

  function getFeltPattern(ctx) {
    if (patternCache.felt) return patternCache.felt;
    if (typeof document === 'undefined') return '#146c43';
    const off = document.createElement('canvas');
    off.width = 128;
    off.height = 128;
    const octx = off.getContext('2d');
    octx.fillStyle = '#156f44';
    octx.fillRect(0, 0, 128, 128);
    const rng = BoardArena.createRng('baize_felt');
    for (let i = 0; i < 900; i++) {
      const x = rng.nextInt(0, 127);
      const y = rng.nextInt(0, 127);
      octx.fillStyle = rng.nextFloat() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      octx.fillRect(x, y, 2, 2);
    }
    patternCache.felt = ctx.createPattern(off, 'repeat');
    return patternCache.felt;
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let lastLayout = null;

    function setupLogicalCanvas(logicalW, logicalH) {
      const dpr = Math.min(2.5, Math.max(1, global.devicePixelRatio || 1));
      const targetW = Math.round(logicalW * dpr);
      const targetH = Math.round(logicalH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      canvas.style.aspectRatio = logicalW + ' / ' + logicalH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, logicalW, logicalH);
    }

    function drawOuterFrame(x, y, w, h, outerColor, trimColor) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 8;
      roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = outerColor;
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 10);
      ctx.strokeStyle = trimColor || 'rgba(251,191,36,0.42)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    function drawLegalDestinationDot(cx, cy, radius, isHovered) {
      ctx.save();
      const r = isHovered ? radius * 1.28 : radius;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 78, 59, 0.72)';
      ctx.fill();

      const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 1, cx, cy, r + 1);
      grad.addColorStop(0, '#bbf7d0');
      grad.addColorStop(0.55, '#22c55e');
      grad.addColorStop(1, '#15803d');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    function drawCaptureReticle(cx, cy, radius, isHovered) {
      ctx.save();
      const r = isHovered ? radius * 1.08 : radius;

      // Translucent crimson danger aura
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.96)';
      ctx.lineWidth = 3.2;
      ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 4 tactical corner brackets
      const b = r + 6;
      const len = Math.max(7, r * 0.42);
      ctx.strokeStyle = '#fef2f2';
      ctx.lineWidth = 2.6;
      const corners = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ];
      for (let i = 0; i < 4; i++) {
        const sx = corners[i][0];
        const sy = corners[i][1];
        ctx.beginPath();
        ctx.moveTo(cx + sx * b, cy + sy * (b - len));
        ctx.lineTo(cx + sx * b, cy + sy * b);
        ctx.lineTo(cx + sx * (b - len), cy + sy * b);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawSelectedHalo(cx, cy, radius) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.restore();
    }

    function drawGoStone(cx, cy, radius, owner, alpha) {
      ctx.save();
      if (typeof alpha === 'number') ctx.globalAlpha = alpha;
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = radius * 0.35;
      ctx.shadowOffsetX = 1.5;
      ctx.shadowOffsetY = 2.8;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (owner === 1) {
        // Nachi Black Slate Stone
        const g = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.35, radius * 0.08, cx, cy, radius);
        g.addColorStop(0, '#52525b');
        g.addColorStop(0.35, '#1f2937');
        g.addColorStop(1, '#09090b');
        ctx.fillStyle = g;
      } else {
        // Hyuga Clamshell White Stone
        const g = ctx.createRadialGradient(cx - radius * 0.32, cy - radius * 0.35, radius * 0.1, cx, cy, radius);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.68, '#f1f5f9');
        g.addColorStop(1, '#cbd5e1');
        ctx.fillStyle = g;
      }
      ctx.fill();
      ctx.restore();

      // Subtle clamshell striations on white stones
      if (owner === 2 && (!alpha || alpha > 0.8)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = 'rgba(148,163,184,0.18)';
        ctx.lineWidth = 0.8;
        for (let off = -radius; off <= radius; off += 3.5) {
          ctx.beginPath();
          ctx.moveTo(cx - radius, cy + off);
          ctx.lineTo(cx + radius, cy + off - 2.5);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* =====================================================================
     * 1. OTHELLO (8x8 Tournament Green Baize Felt)
     * ===================================================================== */
    function renderOthello(state, ui) {
      const W = 680;
      const H = 680;
      setupLogicalCanvas(W, H);

      const pad = 54;
      const boardSize = W - pad * 2;
      const cell = boardSize / 8;

      // Mahogany outer casing + green baize surface
      drawOuterFrame(8, 8, W - 16, H - 16, '#3b1d0e', '#d97706');
      ctx.fillStyle = getFeltPattern(ctx);
      roundRect(ctx, pad - 6, pad - 6, boardSize + 12, boardSize + 12, 6);
      ctx.fill();

      // Grid lines
      ctx.strokeStyle = '#062c19';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 8; i++) {
        const pos = pad + i * cell;
        ctx.beginPath();
        ctx.moveTo(pad, pos);
        ctx.lineTo(pad + boardSize, pos);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos, pad);
        ctx.lineTo(pos, pad + boardSize);
        ctx.stroke();
      }

      // 4 guide pips at (2,2), (2,6), (6,2), (6,6)
      const pips = [
        [2, 2],
        [2, 6],
        [6, 2],
        [6, 6]
      ];
      ctx.fillStyle = '#052e16';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(pad + pips[i][1] * cell, pad + pips[i][0] * cell, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Brass coordinates
      ctx.fillStyle = '#fde68a';
      ctx.font = '700 14px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 8; i++) {
        ctx.fillText('ABCDEFGH'[i], pad + (i + 0.5) * cell, 30);
        ctx.fillText('ABCDEFGH'[i], pad + (i + 0.5) * cell, H - 28);
        ctx.fillText(String(i + 1), 28, pad + (i + 0.5) * cell);
        ctx.fillText(String(i + 1), W - 28, pad + (i + 0.5) * cell);
      }

      // Hovered flip preview map
      const flipPreview = Object.create(null);
      const legalMoves = ui.allLegalMoves || [];
      let hoveredMove = null;
      if (ui.hoverTarget && ui.hoverTarget.type === 'cell') {
        for (let i = 0; i < legalMoves.length; i++) {
          const m = legalMoves[i];
          if (m.to && m.to.r === ui.hoverTarget.r && m.to.c === ui.hoverTarget.c) {
            hoveredMove = m;
            if (Array.isArray(m.captures)) {
              for (let k = 0; k < m.captures.length; k++) {
                flipPreview[m.captures[k].r + ',' + m.captures[k].c] = true;
              }
            }
            break;
          }
        }
      }

      // Draw discs
      const discR = cell * 0.41;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const v = state.board[r][c];
          const cx = pad + (c + 0.5) * cell;
          const cy = pad + (r + 0.5) * cell;
          if (v !== 0) {
            // Dual-layer 3D Othello disc (shows opposite color thin rim at bottom!)
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy + 3, discR, 0, Math.PI * 2);
            ctx.fillStyle = v === 1 ? '#e2e8f0' : '#1e293b';
            ctx.fill();
            ctx.restore();

            drawGoStone(cx, cy, discR, v, 1);

            if (state.lastMove && state.lastMove.to && state.lastMove.to.r === r && state.lastMove.to.c === c) {
              ctx.fillStyle = '#f59e0b';
              ctx.beginPath();
              ctx.arc(cx, cy, 4.8, 0, Math.PI * 2);
              ctx.fill();
            }
            if (flipPreview[r + ',' + c]) {
              ctx.strokeStyle = '#fde047';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(cx, cy, discR - 3, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }

      // Legal placement dots
      if (ui.interactive) {
        for (let i = 0; i < legalMoves.length; i++) {
          const m = legalMoves[i];
          if (!m.to) continue;
          const cx = pad + (m.to.c + 0.5) * cell;
          const cy = pad + (m.to.r + 0.5) * cell;
          const isHov = hoveredMove === m;
          if (isHov) {
            drawGoStone(cx, cy, discR, state.currentPlayer, 0.48);
          }
          drawLegalDestinationDot(cx, cy, 6.5, isHov);
        }
      }

      drawHintsOverlay(ui.hints, function (pt) {
        return { x: pad + (pt.c + 0.5) * cell, y: pad + (pt.r + 0.5) * cell };
      });
      drawMentorComparisonOverlay(ui.mentorComparison, function (pt) {
        return pt && typeof pt.r === 'number' ? { x: pad + (pt.c + 0.5) * cell, y: pad + (pt.r + 0.5) * cell } : null;
      });

      lastLayout = {
        gameId: 'othello',
        hitTest: function (x, y) {
          const c = Math.floor((x - pad) / cell);
          const r = Math.floor((y - pad) / cell);
          if (r >= 0 && r < 8 && c >= 0 && c < 8) return { type: 'cell', r: r, c: c };
          return null;
        }
      };
    }

    /* =====================================================================
     * 2. GOMOKU (15x15 Modern Gomoku.com Kaya Wood) & 3. GO (9/13/19 Goban)
     * ===================================================================== */
    function renderIntersectionGrid(gameId, state, ui) {
      const size = gameId === 'gomoku' ? 15 : state.size || 19;
      const W = 680;
      const H = 680;
      setupLogicalCanvas(W, H);

      const pad = size === 19 ? 44 : 52;
      const span = W - pad * 2;
      const step = span / (size - 1);

      // Warm Honey Kaya wood board
      drawOuterFrame(8, 8, W - 16, H - 16, '#78350f', '#fbbf24');
      ctx.fillStyle = getWoodPattern(ctx, 'kaya_' + gameId, gameId === 'gomoku' ? '#dfb16b' : '#d6a156', '#92400e', 85);
      roundRect(ctx, 16, 16, W - 32, H - 32, 8);
      ctx.fill();

      // Grid lines
      ctx.strokeStyle = '#271709';
      for (let i = 0; i < size; i++) {
        ctx.lineWidth = i === 0 || i === size - 1 ? 2.1 : 1.15;
        const p = pad + i * step;
        ctx.beginPath();
        ctx.moveTo(pad, p);
        ctx.lineTo(pad + span, p);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p, pad);
        ctx.lineTo(p, pad + span);
        ctx.stroke();
      }

      // Star points (Hoshi)
      const stars =
        size === 15
          ? [
              [3, 3],
              [3, 11],
              [7, 7],
              [11, 3],
              [11, 11]
            ]
          : size === 9
          ? [
              [2, 2],
              [2, 6],
              [4, 4],
              [6, 2],
              [6, 6]
            ]
          : size === 13
          ? [
              [3, 3],
              [3, 9],
              [6, 6],
              [9, 3],
              [9, 9]
            ]
          : [
              [3, 3],
              [3, 9],
              [3, 15],
              [9, 3],
              [9, 9],
              [9, 15],
              [15, 3],
              [15, 9],
              [15, 15]
            ];

      ctx.fillStyle = '#1c1008';
      for (let i = 0; i < stars.length; i++) {
        ctx.beginPath();
        ctx.arc(pad + stars[i][1] * step, pad + stars[i][0] * step, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Coordinates (skip 'I' on 19x19 Go per international Go convention, A-O on Gomoku)
      const letters = gameId === 'go' ? 'ABCDEFGHJKLMNOPQRST' : 'ABCDEFGHIJKLMNO';
      ctx.fillStyle = '#3b1d0a';
      ctx.font = '700 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < size; i++) {
        ctx.fillText(letters[i], pad + i * step, 27);
        ctx.fillText(letters[i], pad + i * step, H - 25);
        ctx.fillText(String(size - i), 25, pad + i * step);
        ctx.fillText(String(size - i), W - 25, pad + i * step);
      }

      // Go Ko / forbidden point markers
      if (gameId === 'go' && Array.isArray(state.forbiddenPoints)) {
        for (let i = 0; i < state.forbiddenPoints.length; i++) {
          const fp = state.forbiddenPoints[i];
          const fx = pad + fp.c * step;
          const fy = pad + fp.r * step;
          ctx.save();
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(fx - 5, fy - 5);
          ctx.lineTo(fx + 5, fy + 5);
          ctx.moveTo(fx + 5, fy - 5);
          ctx.lineTo(fx - 5, fy + 5);
          ctx.stroke();
          ctx.restore();
        }
      } else if (gameId === 'go' && state.koPoint) {
        const kx = pad + state.koPoint.c * step;
        const ky = pad + state.koPoint.r * step;
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(kx - 5, ky - 5, 10, 10);
      }

      // Stones
      const stoneR = Math.min(22, step * 0.455);
      const deadMap = (state && state.deadStones) || {};
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const v = state.board[r][c];
          if (v !== 0) {
            const cx = pad + c * step;
            const cy = pad + r * step;
            const isDead = !!deadMap[r + ',' + c];
            drawGoStone(cx, cy, stoneR, v, isDead ? 0.36 : 1);
            if (isDead) {
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 2.4;
              ctx.beginPath();
              ctx.moveTo(cx - 6, cy - 6);
              ctx.lineTo(cx + 6, cy + 6);
              ctx.moveTo(cx + 6, cy - 6);
              ctx.lineTo(cx - 6, cy + 6);
              ctx.stroke();
            }
            if (state.lastMove && state.lastMove.to && state.lastMove.to.r === r && state.lastMove.to.c === c) {
              ctx.strokeStyle = v === 1 ? '#fde047' : '#dc2626';
              ctx.lineWidth = 2.4;
              ctx.beginPath();
              ctx.arc(cx, cy, stoneR * 0.42, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }

      // Winning 5-in-a-row line in Gomoku
      if (gameId === 'gomoku' && Array.isArray(state.winningLine) && state.winningLine.length >= 2) {
        const first = state.winningLine[0];
        const last = state.winningLine[state.winningLine.length - 1];
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(pad + first.c * step, pad + first.r * step);
        ctx.lineTo(pad + last.c * step, pad + last.r * step);
        ctx.stroke();
        ctx.restore();
      }

      // Ghost hover stone on legal intersection
      if (ui.interactive && state.status === 'playing' && ui.hoverTarget && ui.hoverTarget.type === 'cell') {
        const hr = ui.hoverTarget.r;
        const hc = ui.hoverTarget.c;
        const isLegal = (ui.allLegalMoves || []).some(function (m) {
          return m.to && m.to.r === hr && m.to.c === hc;
        });
        if (isLegal) {
          drawGoStone(pad + hc * step, pad + hr * step, stoneR, state.currentPlayer, 0.45);
          drawLegalDestinationDot(pad + hc * step, pad + hr * step, 4.5, true);
        }
      }

      drawHintsOverlay(ui.hints, function (pt) {
        return { x: pad + pt.c * step, y: pad + pt.r * step };
      });
      drawMentorComparisonOverlay(ui.mentorComparison, function (pt) {
        return pt && typeof pt.r === 'number' ? { x: pad + pt.c * step, y: pad + pt.r * step } : null;
      });

      lastLayout = {
        gameId: gameId,
        hitTest: function (x, y) {
          const c = Math.round((x - pad) / step);
          const r = Math.round((y - pad) / step);
          if (r >= 0 && r < size && c >= 0 && c < size) {
            const dx = x - (pad + c * step);
            const dy = y - (pad + r * step);
            if (Math.sqrt(dx * dx + dy * dy) <= step * 0.48) {
              return { type: 'cell', r: r, c: c };
            }
          }
          return null;
        }
      };
    }

    /* =====================================================================
     * 4. XIANGQI (9x10 Carved Rosewood + Chu River + Legal Move/Capture Guides)
     * ===================================================================== */
    function renderXiangqi(state, ui) {
      const W = 660;
      const H = 720;
      setupLogicalCanvas(W, H);

      const padX = 62;
      const padY = 58;
      const stepX = (W - padX * 2) / 8;
      const stepY = (H - padY * 2) / 9;

      drawOuterFrame(8, 8, W - 16, H - 16, '#451a03', '#f59e0b');
      ctx.fillStyle = getWoodPattern(ctx, 'xiangqi_rosewood', '#c88a4b', '#78350f', 90);
      roundRect(ctx, 18, 18, W - 36, H - 36, 8);
      ctx.fill();

      // Inner double border around grid
      ctx.strokeStyle = '#3b1806';
      ctx.lineWidth = 3;
      ctx.strokeRect(padX - 6, padY - 6, stepX * 8 + 12, stepY * 9 + 12);

      // Horizontal lines
      ctx.lineWidth = 1.65;
      for (let r = 0; r < 10; r++) {
        const y = padY + r * stepY;
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(padX + 8 * stepX, y);
        ctx.stroke();
      }

      // Vertical lines (split across Chu River r=4..5 except outer files 0 & 8)
      for (let c = 0; c < 9; c++) {
        const x = padX + c * stepX;
        if (c === 0 || c === 8) {
          ctx.beginPath();
          ctx.moveTo(x, padY);
          ctx.lineTo(x, padY + 9 * stepY);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(x, padY);
          ctx.lineTo(x, padY + 4 * stepY);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, padY + 5 * stepY);
          ctx.lineTo(x, padY + 9 * stepY);
          ctx.stroke();
        }
      }

      // Nine-Palace diagonal lines
      ctx.beginPath();
      ctx.moveTo(padX + 3 * stepX, padY);
      ctx.lineTo(padX + 5 * stepX, padY + 2 * stepY);
      ctx.moveTo(padX + 5 * stepX, padY);
      ctx.lineTo(padX + 3 * stepX, padY + 2 * stepY);
      ctx.moveTo(padX + 3 * stepX, padY + 7 * stepY);
      ctx.lineTo(padX + 5 * stepX, padY + 9 * stepY);
      ctx.moveTo(padX + 5 * stepX, padY + 7 * stepY);
      ctx.lineTo(padX + 3 * stepX, padY + 9 * stepY);
      ctx.stroke();

      // Fiducial L-marks on Cannon & Soldier points
      const marks = [
        [2, 1],
        [2, 7],
        [7, 1],
        [7, 7],
        [3, 0],
        [3, 2],
        [3, 4],
        [3, 6],
        [3, 8],
        [6, 0],
        [6, 2],
        [6, 4],
        [6, 6],
        [6, 8]
      ];
      for (let i = 0; i < marks.length; i++) {
        drawXiangqiCrossMark(padX + marks[i][1] * stepX, padY + marks[i][0] * stepY, marks[i][1]);
      }

      // Chu River & Han Border calligraphy
      ctx.save();
      ctx.fillStyle = 'rgba(59, 24, 6, 0.82)';
      ctx.font = '800 26px "DFKai-SB", "BiauKai", "Kaiti TC", "Microsoft JhengHei", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('楚 河', padX + 2 * stepX, padY + 4.5 * stepY);
      ctx.fillText('漢 界', padX + 6 * stepX, padY + 4.5 * stepY);
      ctx.restore();

      // File numbers (Top Black 1..9, Bottom Red 九..一)
      const redNums = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
      ctx.fillStyle = '#3b1806';
      ctx.font = '700 13px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      for (let c = 0; c < 9; c++) {
        ctx.fillText(String(c + 1), padX + c * stepX, 31);
        ctx.fillText(redNums[c], padX + c * stepX, H - 27);
      }

      // Last move origin & trajectory line
      if (state.lastMove && state.lastMove.from && state.lastMove.to) {
        const fx = padX + state.lastMove.from.c * stepX;
        const fy = padY + state.lastMove.from.r * stepY;
        const tx = padX + state.lastMove.to.c * stepX;
        const ty = padY + state.lastMove.to.r * stepY;
        ctx.save();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = 'rgba(250, 204, 21, 0.85)';
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Pieces
      const pieceR = Math.min(stepX, stepY) * 0.44;
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = state.board[r][c];
          if (!p) continue;
          const cx = padX + c * stepX;
          const cy = padY + r * stepY;
          const isSelected =
            ui.selectedSource && ui.selectedSource.r === r && ui.selectedSource.c === c;

          if (isSelected) {
            drawSelectedHalo(cx, cy - 3, pieceR);
          }
          if (p.type === 'K' && state.inCheck === p.owner) {
            drawCaptureReticle(cx, cy, pieceR + 2, false);
          }

          drawXiangqiPiece(cx, isSelected ? cy - 3 : cy, pieceR, p.owner, XIANGQI_KANJI[p.owner][p.type]);
        }
      }

      // SELECTED PIECE LEGAL MOVES & CAPTURES OVERLAY
      const selMoves = ui.legalMovesForSelected || [];
      for (let i = 0; i < selMoves.length; i++) {
        const m = selMoves[i];
        if (!m.to) continue;
        const tx = padX + m.to.c * stepX;
        const ty = padY + m.to.r * stepY;
        const isHov =
          ui.hoverTarget && ui.hoverTarget.type === 'cell' && ui.hoverTarget.r === m.to.r && ui.hoverTarget.c === m.to.c;
        if (m.isCapture) {
          drawCaptureReticle(tx, ty, pieceR, isHov);
        } else {
          drawLegalDestinationDot(tx, ty, 8.5, isHov);
        }
      }

      drawHintsOverlay(ui.hints, function (pt) {
        return { x: padX + pt.c * stepX, y: padY + pt.r * stepY };
      });
      drawMentorComparisonOverlay(ui.mentorComparison, function (pt) {
        return pt && typeof pt.r === 'number' ? { x: padX + pt.c * stepX, y: padY + pt.r * stepY } : null;
      });

      lastLayout = {
        gameId: 'xiangqi',
        hitTest: function (x, y) {
          const c = Math.round((x - padX) / stepX);
          const r = Math.round((y - padY) / stepY);
          if (r >= 0 && r < 10 && c >= 0 && c < 9) {
            const dx = x - (padX + c * stepX);
            const dy = y - (padY + r * stepY);
            if (Math.sqrt(dx * dx + dy * dy) <= Math.min(stepX, stepY) * 0.49) {
              return { type: 'cell', r: r, c: c };
            }
          }
          return null;
        }
      };
    }

    function drawXiangqiCrossMark(cx, cy, col) {
      const g = 4;
      const l = 9;
      ctx.strokeStyle = '#3b1806';
      ctx.lineWidth = 1.4;
      const sides = [];
      if (col > 0) sides.push([-1, -1], [-1, 1]);
      if (col < 8) sides.push([1, -1], [1, 1]);
      for (let i = 0; i < sides.length; i++) {
        const sx = sides[i][0];
        const sy = sides[i][1];
        ctx.beginPath();
        ctx.moveTo(cx + sx * g, cy + sy * (g + l));
        ctx.lineTo(cx + sx * g, cy + sy * g);
        ctx.lineTo(cx + sx * (g + l), cy + sy * g);
        ctx.stroke();
      }
    }

    function drawXiangqiPiece(cx, cy, r, owner, label) {
      ctx.save();
      // 3D wooden cylinder base
      ctx.shadowColor = 'rgba(0,0,0,0.48)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 4;
      ctx.beginPath();
      ctx.arc(cx, cy + 2.5, r, 0, Math.PI * 2);
      ctx.fillStyle = '#78350f';
      ctx.fill();
      ctx.restore();

      // Top turned Boxwood face
      const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      grad.addColorStop(0, '#fef3c7');
      grad.addColorStop(0.7, '#f3d092');
      grad.addColorStop(1, '#c28e46');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Engraved inner lacquer ring
      const ink = owner === 1 ? '#b91c1c' : '#111827';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.81, 0, Math.PI * 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Engraved traditional calligraphy
      ctx.fillStyle = ink;
      ctx.font = '900 ' + Math.round(r * 1.05) + 'px "DFKai-SB", "BiauKai", "Kaiti TC", "PMingLiU", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + 1.5);
    }

    /* =====================================================================
     * 5. CHESS (8x8 Staunton Walnut/Maple) & 6. DRAUGHTS (10x10 FMJD)
     * ===================================================================== */
    function renderCheckeredBoard(gameId, state, ui) {
      const n = gameId === 'draughts' ? 10 : 8;
      const W = 680;
      const H = 680;
      setupLogicalCanvas(W, H);

      const pad = 48;
      const boardW = W - pad * 2;
      const cell = boardW / n;

      drawOuterFrame(8, 8, W - 16, H - 16, '#2e1608', '#d97706');

      const lightPat = getWoodPattern(ctx, 'maple_light', '#f1d9b5', '#d4b483', 45);
      const darkPat = getWoodPattern(ctx, 'walnut_dark', '#8b5a2b', '#4a2c11', 65);

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const x = pad + c * cell;
          const y = pad + r * cell;
          const isDark = (r + c) % 2 === 1;
          ctx.fillStyle = isDark ? darkPat : lightPat;
          ctx.fillRect(x, y, cell, cell);

          // Highlight last move squares
          if (
            state.lastMove &&
            ((state.lastMove.from && state.lastMove.from.r === r && state.lastMove.from.c === c) ||
              (state.lastMove.to && state.lastMove.to.r === r && state.lastMove.to.c === c))
          ) {
            ctx.fillStyle = 'rgba(250, 204, 21, 0.36)';
            ctx.fillRect(x, y, cell, cell);
          }
        }
      }

      ctx.strokeStyle = '#1f0e05';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(pad, pad, boardW, boardW);

      // Coordinates
      ctx.fillStyle = '#fde68a';
      ctx.font = '700 13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const colLbl = 'abcdefghij'[i];
        ctx.fillText(colLbl, pad + (i + 0.5) * cell, 26);
        ctx.fillText(colLbl, pad + (i + 0.5) * cell, H - 26);
        ctx.fillText(String(n - i), 26, pad + (i + 0.5) * cell);
        ctx.fillText(String(n - i), W - 26, pad + (i + 0.5) * cell);
      }

      // Pieces
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const p = state.board[r][c];
          if (!p) continue;
          const cx = pad + (c + 0.5) * cell;
          const cy = pad + (r + 0.5) * cell;
          const isSelected = ui.selectedSource && ui.selectedSource.r === r && ui.selectedSource.c === c;

          if (isSelected) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.42)';
            ctx.fillRect(pad + c * cell, pad + r * cell, cell, cell);
            drawSelectedHalo(cx, cy - 2, cell * 0.4);
          }

          if (gameId === 'chess') {
            if (p.type === 'K' && state.inCheck === p.owner) {
              drawCaptureReticle(cx, cy, cell * 0.42, false);
            }
            drawStauntonChessPiece(cx, isSelected ? cy - 3 : cy, cell * 0.42, p.owner, p.type);
          } else {
            drawDraughtsChecker(cx, isSelected ? cy - 3 : cy, cell * 0.39, p.owner, !!p.king);
          }
        }
      }

      // Selected piece legal moves & captures!
      const selMoves = ui.legalMovesForSelected || [];
      const drawnTargets = Object.create(null);
      for (let i = 0; i < selMoves.length; i++) {
        const m = selMoves[i];
        if (!m.to) continue;
        const key = m.to.r + ',' + m.to.c;
        if (drawnTargets[key]) continue;
        drawnTargets[key] = true;

        const tx = pad + (m.to.c + 0.5) * cell;
        const ty = pad + (m.to.r + 0.5) * cell;
        const isHov =
          ui.hoverTarget && ui.hoverTarget.type === 'cell' && ui.hoverTarget.r === m.to.r && ui.hoverTarget.c === m.to.c;
        if (m.isCapture) {
          drawCaptureReticle(tx, ty, cell * 0.41, isHov);
        } else {
          drawLegalDestinationDot(tx, ty, Math.max(7, cell * 0.14), isHov);
        }
      }

      drawHintsOverlay(ui.hints, function (pt) {
        return { x: pad + (pt.c + 0.5) * cell, y: pad + (pt.r + 0.5) * cell };
      });
      drawMentorComparisonOverlay(ui.mentorComparison, function (pt) {
        return pt && typeof pt.r === 'number' ? { x: pad + (pt.c + 0.5) * cell, y: pad + (pt.r + 0.5) * cell } : null;
      });

      lastLayout = {
        gameId: gameId,
        hitTest: function (x, y) {
          const c = Math.floor((x - pad) / cell);
          const r = Math.floor((y - pad) / cell);
          if (r >= 0 && r < n && c >= 0 && c < n) return { type: 'cell', r: r, c: c };
          return null;
        }
      };
    }

    function drawStauntonChessPiece(cx, cy, radius, owner, type) {
      ctx.save();
      // Tactile 3D pedestal disc + crisp Staunton emblem so pieces never suffer OS font issues
      ctx.shadowColor = 'rgba(0,0,0,0.52)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 3;

      const grad = ctx.createRadialGradient(cx - radius * 0.28, cy - radius * 0.28, 2, cx, cy, radius);
      if (owner === 1) {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.75, '#f5efe6');
        grad.addColorStop(1, '#cbd5e1');
      } else {
        grad.addColorStop(0, '#475569');
        grad.addColorStop(0.65, '#1e293b');
        grad.addColorStop(1, '#090d16');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = owner === 1 ? '#334155' : '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.stroke();

      const glyph = CHESS_GLYPHS[type.toLowerCase()] || type;
      ctx.fillStyle = owner === 1 ? '#0f172a' : '#f8fafc';
      ctx.font = Math.round(radius * 1.48) + 'px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, cx, cy + 1.5);
      ctx.restore();
    }

    function drawDraughtsChecker(cx, cy, r, owner, isKing) {
      ctx.save();
      const stack = isKing ? 2 : 1;
      for (let s = 0; s < stack; s++) {
        const sy = cy - s * 5;
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;

        ctx.beginPath();
        ctx.arc(cx, sy + 2.5, r, 0, Math.PI * 2);
        ctx.fillStyle = owner === 1 ? '#94a3b8' : '#090d16';
        ctx.fill();

        const g = ctx.createRadialGradient(cx - r * 0.3, sy - r * 0.3, 2, cx, sy, r);
        if (owner === 1) {
          g.addColorStop(0, '#fffbeb');
          g.addColorStop(0.75, '#f3e8d2');
          g.addColorStop(1, '#d6c3a5');
        } else {
          g.addColorStop(0, '#451a03');
          g.addColorStop(0.65, '#1c1917');
          g.addColorStop(1, '#0c0a09');
        }
        ctx.beginPath();
        ctx.arc(cx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = owner === 1 ? '#78716c' : '#a8a29e';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Concentric turned wood ridge
        ctx.beginPath();
        ctx.arc(cx, sy, r * 0.68, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isKing) {
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1;
        ctx.font = '900 ' + Math.round(r * 0.95) + 'px "Segoe UI Symbol", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♛', cx, cy - 4);
      }
      ctx.restore();
    }

    /* =====================================================================
     * 7. SHOGI (9x9 Japanese Kaya Shogiban + Wedge Koma + Dual Komadai Stands)
     * ===================================================================== */
    function renderShogi(state, ui) {
      const W = 680;
      const H = 760;
      setupLogicalCanvas(W, H);

      drawOuterFrame(6, 6, W - 12, H - 12, '#3b1d0e', '#fbbf24');

      // Top Komadai (Gote ☖ Hand) & Bottom Komadai (Sente ☗ Hand)
      const handH = 66;
      const padX = 68;
      const boardTop = 94;
      const boardW = W - padX * 2;
      const boardH = boardW * 1.06;
      const cellW = boardW / 9;
      const cellH = boardH / 9;

      const komadaiRects = [];
      drawKomadaiStand(padX, 16, boardW, handH, 2, state.hands && state.hands[2], ui, komadaiRects);
      drawKomadaiStand(padX, boardTop + boardH + 22, boardW, handH, 1, state.hands && state.hands[1], ui, komadaiRects);

      // Kaya Shogiban
      ctx.fillStyle = getWoodPattern(ctx, 'shogi_kaya', '#e3b46e', '#92400e', 80);
      roundRect(ctx, padX - 10, boardTop - 10, boardW + 20, boardH + 20, 5);
      ctx.fill();

      ctx.strokeStyle = '#1f1206';
      ctx.lineWidth = 1.6;
      for (let i = 0; i <= 9; i++) {
        ctx.beginPath();
        ctx.moveTo(padX, boardTop + i * cellH);
        ctx.lineTo(padX + boardW, boardTop + i * cellH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(padX + i * cellW, boardTop);
        ctx.lineTo(padX + i * cellW, boardTop + boardH);
        ctx.stroke();
      }

      // 4 star dots
      const sDots = [
        [3, 3],
        [3, 6],
        [6, 3],
        [6, 6]
      ];
      ctx.fillStyle = '#1f1206';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(padX + sDots[i][1] * cellW, boardTop + sDots[i][0] * cellH, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Shogi coordinates: Top 9..1, Right 一..九
      const jpRanks = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
      ctx.fillStyle = '#fde68a';
      ctx.font = '700 13px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 9; i++) {
        ctx.fillText(String(9 - i), padX + (i + 0.5) * cellW, boardTop - 20);
        ctx.fillText(jpRanks[i], padX + boardW + 22, boardTop + (i + 0.5) * cellH);
      }

      // Board pieces (Pentagonal Wedge Koma)
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const x = padX + c * cellW;
          const y = boardTop + r * cellH;
          if (
            state.lastMove &&
            state.lastMove.to &&
            state.lastMove.to.r === r &&
            state.lastMove.to.c === c
          ) {
            ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
            ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
          }

          const p = state.board[r][c];
          if (!p) continue;
          const cx = x + cellW * 0.5;
          const cy = y + cellH * 0.5;
          const isSelected = ui.selectedSource && ui.selectedSource.r === r && ui.selectedSource.c === c;
          if (isSelected) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.45)';
            ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
          }
          if (p.type === 'K' && state.inCheck === p.owner) {
            drawCaptureReticle(cx, cy, cellW * 0.42, false);
          }

          const key = p.type === 'K' ? 'K' + p.owner : (p.promoted ? '+' : '') + p.type;
          drawShogiKoma(cx, isSelected ? cy - 2 : cy, cellW * 0.82, cellH * 0.84, p.owner, SHOGI_KANJI[key] || p.type, !!p.promoted);
        }
      }

      // Legal moves / drops & captures for selected piece or hand piece
      const selMoves = ui.legalMovesForSelected || [];
      const seen = Object.create(null);
      for (let i = 0; i < selMoves.length; i++) {
        const m = selMoves[i];
        if (!m.to) continue;
        const k = m.to.r + ',' + m.to.c;
        if (seen[k]) continue;
        seen[k] = true;
        const tx = padX + (m.to.c + 0.5) * cellW;
        const ty = boardTop + (m.to.r + 0.5) * cellH;
        const isHov =
          ui.hoverTarget && ui.hoverTarget.type === 'cell' && ui.hoverTarget.r === m.to.r && ui.hoverTarget.c === m.to.c;
        if (m.isCapture) {
          drawCaptureReticle(tx, ty, cellW * 0.41, isHov);
        } else {
          drawLegalDestinationDot(tx, ty, 7.5, isHov);
        }
      }

      drawHintsOverlay(ui.hints, function (pt) {
        return { x: padX + (pt.c + 0.5) * cellW, y: boardTop + (pt.r + 0.5) * cellH };
      });
      drawMentorComparisonOverlay(ui.mentorComparison, function (pt) {
        return pt && typeof pt.r === 'number' ? { x: padX + (pt.c + 0.5) * cellW, y: boardTop + (pt.r + 0.5) * cellH } : null;
      });

      lastLayout = {
        gameId: 'shogi',
        hitTest: function (x, y) {
          for (let i = 0; i < komadaiRects.length; i++) {
            const kr = komadaiRects[i];
            if (x >= kr.x && x <= kr.x + kr.w && y >= kr.y && y <= kr.y + kr.h) {
              return { type: 'hand', owner: kr.owner, piece: kr.piece };
            }
          }
          const c = Math.floor((x - padX) / cellW);
          const r = Math.floor((y - boardTop) / cellH);
          if (r >= 0 && r < 9 && c >= 0 && c < 9) return { type: 'cell', r: r, c: c };
          return null;
        }
      };
    }

    function drawKomadaiStand(x, y, w, h, owner, handObj, ui, outRects) {
      ctx.save();
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = '#5c2d10';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251,191,36,0.5)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = '#fde68a';
      ctx.font = '700 13px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const title = owner === 1 ? '☗ 先手駒台 (點擊持駒打入)' : '☖ 後手駒台';
      ctx.fillText(title, x + 12, y + h / 2);

      const order = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
      let slotX = x + 190;
      const slotW = 48;
      for (let i = 0; i < order.length; i++) {
        const pt = order[i];
        const cnt = (handObj && handObj[pt]) || 0;
        const isSel =
          ui.selectedSource &&
          ui.selectedSource.zone === 'hand' &&
          ui.selectedSource.owner === owner &&
          ui.selectedSource.piece === pt;

        ctx.save();
        if (cnt === 0) ctx.globalAlpha = 0.25;
        if (isSel) {
          roundRect(ctx, slotX - 3, y + 6, slotW + 6, h - 12, 6);
          ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
          ctx.fill();
        }
        drawShogiKoma(slotX + slotW / 2, y + h / 2 + 1, 38, 44, owner, SHOGI_KANJI[pt], false);
        if (cnt > 0) {
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(slotX + slotW - 4, y + 14, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#052e16';
          ctx.font = '800 11px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(cnt), slotX + slotW - 4, y + 14.5);

          outRects.push({ x: slotX, y: y + 4, w: slotW, h: h - 8, owner: owner, piece: pt });
        }
        ctx.restore();
        slotX += slotW + 6;
      }
      ctx.restore();
    }

    function drawShogiKoma(cx, cy, w, h, owner, label, isPromoted) {
      ctx.save();
      ctx.translate(cx, cy);
      if (owner === 2) ctx.rotate(Math.PI); // Gote points downward!

      ctx.shadowColor = 'rgba(0,0,0,0.42)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = owner === 2 ? -2 : 2.5;

      // Traditional 5-sided Shogi wedge polygon
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.49);
      ctx.lineTo(w * 0.38, -h * 0.26);
      ctx.lineTo(w * 0.45, h * 0.47);
      ctx.lineTo(-w * 0.45, h * 0.47);
      ctx.lineTo(-w * 0.38, -h * 0.26);
      ctx.closePath();

      const g = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
      g.addColorStop(0, '#fef3c7');
      g.addColorStop(1, '#e6b973');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#5c2d10';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.fillStyle = isPromoted ? '#dc2626' : '#111827';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (label.length >= 2) {
        ctx.font = '900 ' + Math.round(h * 0.31) + 'px "DFKai-SB", "Yu Mincho", "Microsoft JhengHei", serif';
        ctx.fillText(label[0], 0, -h * 0.12);
        ctx.fillText(label[1], 0, h * 0.21);
      } else {
        ctx.font = '900 ' + Math.round(h * 0.44) + 'px "DFKai-SB", "Yu Mincho", "Microsoft JhengHei", serif';
        ctx.fillText(label, 0, h * 0.05);
      }
      ctx.restore();
    }

    /* =====================================================================
     * 8. BACKGAMMON (24-Point Leather & Mahogany Attaché + 3D Dice + Bar + Trays)
     * ===================================================================== */
    function renderBackgammon(state, ui) {
      const W = 760;
      const H = 620;
      setupLogicalCanvas(W, H);

      drawOuterFrame(6, 6, W - 12, H - 12, '#3a1a0c', '#d97706');

      const margin = 32;
      const trayW = 62;
      const barW = 48;
      const playW = W - margin * 2 - trayW - 12;
      const halfW = (playW - barW) / 2;
      const ptW = halfW / 6;
      const fieldH = H - margin * 2;
      const triH = fieldH * 0.42;

      // Left & Right stitched leather playing fields
      const leftX = margin;
      const barX = margin + halfW;
      const rightX = barX + barW;
      const trayX = rightX + halfW + 12;

      ctx.fillStyle = '#264635';
      roundRect(ctx, leftX, margin, halfW, fieldH, 4);
      ctx.fill();
      roundRect(ctx, rightX, margin, halfW, fieldH, 4);
      ctx.fill();

      // Central Mahogany Bar with brass hinges
      ctx.fillStyle = '#4a200d';
      ctx.fillRect(barX, margin - 4, barW, fieldH + 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(barX + 10, margin + 22, barW - 20, 12);
      ctx.fillRect(barX + 10, margin + fieldH - 34, barW - 20, 12);

      const hitBoxes = [];

      // Map index 0..23 -> screen x & top/bottom:
      // Top row left->right: indices 12..17 (left field), 18..23 (right field)
      // Bottom row right->left: indices 0..5 (right field, P1 Home), 6..11 (left field)
      function getPointGeometry(idx) {
        let x;
        let isTop;
        if (idx >= 12) {
          isTop = true;
          const pos = idx - 12; // 0..11 left to right
          x = pos < 6 ? leftX + pos * ptW : rightX + (pos - 6) * ptW;
        } else {
          isTop = false;
          const pos = 11 - idx; // idx 11 is leftmost, idx 0 is rightmost!
          x = pos < 6 ? leftX + pos * ptW : rightX + (pos - 6) * ptW;
        }
        return { x: x, isTop: isTop, yBase: isTop ? margin : margin + fieldH };
      }

      // Draw 24 Triangles
      for (let idx = 0; idx < 24; idx++) {
        const g = getPointGeometry(idx);
        const dir = g.isTop ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(g.x + 2, g.yBase);
        ctx.lineTo(g.x + ptW - 2, g.yBase);
        ctx.lineTo(g.x + ptW / 2, g.yBase + dir * triH);
        ctx.closePath();
        ctx.fillStyle = idx % 2 === 0 ? '#991b1b' : '#e7d8c1';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Point number label (1..24)
        ctx.fillStyle = '#fde68a';
        ctx.font = '700 11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(idx + 1), g.x + ptW / 2, g.isTop ? margin - 12 : margin + fieldH + 14);

        hitBoxes.push({
          x: g.x,
          y: g.isTop ? margin : margin + fieldH - triH - 18,
          w: ptW,
          h: triH + 18,
          target: { type: 'point', zone: 'point', index: idx }
        });
      }

      // Draw Checkers on 24 Points
      const chkR = Math.min(20, ptW * 0.43);
      for (let idx = 0; idx < 24; idx++) {
        const pt = state.points[idx];
        if (!pt || pt.count <= 0) continue;
        const g = getPointGeometry(idx);
        const dir = g.isTop ? 1 : -1;
        const visible = Math.min(5, pt.count);
        const step = Math.min(chkR * 1.92, (triH - chkR) / Math.max(1, visible - 0.5));
        const isSel =
          ui.selectedSource && ui.selectedSource.zone === 'point' && ui.selectedSource.index === idx;

        for (let k = 0; k < visible; k++) {
          const cx = g.x + ptW / 2;
          const cy = g.yBase + dir * (chkR + 3 + k * step);
          if (isSel && k === visible - 1) {
            drawSelectedHalo(cx, cy, chkR);
          }
          drawDraughtsChecker(cx, cy, chkR, pt.owner, false);
          if (k === visible - 1 && pt.count > 5) {
            ctx.fillStyle = pt.owner === 1 ? '#0f172a' : '#fde047';
            ctx.font = '900 13px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('×' + pt.count, cx, cy);
          }
        }
      }

      // Central Bar Checkers (P2 top half, P1 bottom half)
      const barOwners = [
        { owner: 2, y: margin + fieldH * 0.28 },
        { owner: 1, y: margin + fieldH * 0.72 }
      ];
      for (let b = 0; b < 2; b++) {
        const bo = barOwners[b];
        const cnt = (state.bar && state.bar[bo.owner]) || 0;
        const bx = barX + barW / 2;
        if (cnt > 0) {
          const isSel =
            ui.selectedSource && ui.selectedSource.zone === 'bar' && ui.selectedSource.owner === bo.owner;
          if (isSel) drawSelectedHalo(bx, bo.y, chkR);
          drawDraughtsChecker(bx, bo.y, chkR, bo.owner, false);
          if (cnt > 1) {
            ctx.fillStyle = bo.owner === 1 ? '#0f172a' : '#fde047';
            ctx.font = '900 13px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('×' + cnt, bx, bo.y);
          }
          hitBoxes.unshift({
            x: barX,
            y: bo.y - chkR - 8,
            w: barW,
            h: chkR * 2 + 16,
            target: { type: 'bar', zone: 'bar', owner: bo.owner }
          });
        }
      }

      // Bear-Off Trays (Top = Black P2, Bottom = White P1) + Doubling Cube in middle
      const trayTopY = margin;
      const trayBotY = margin + fieldH * 0.56;
      const traySubH = fieldH * 0.44;
      drawBearOffTray(trayX, trayTopY, trayW, traySubH, 2, (state.borneOff && state.borneOff[2]) || 0);
      drawBearOffTray(trayX, trayBotY, trayW, traySubH, 1, (state.borneOff && state.borneOff[1]) || 0);
      hitBoxes.push({ x: trayX, y: trayTopY, w: trayW, h: traySubH, target: { type: 'off', zone: 'off', owner: 2 } });
      hitBoxes.push({ x: trayX, y: trayBotY, w: trayW, h: traySubH, target: { type: 'off', zone: 'off', owner: 1 } });

      // Doubling Cube
      drawDoublingCube(trayX + trayW / 2, margin + fieldH * 0.5, state.cubeValue || 1);

      // 3D Dice Display in center lane
      if (Array.isArray(state.dice) && state.dice.length === 2) {
        const diceCX = state.currentPlayer === 1 ? rightX + halfW * 0.5 : leftX + halfW * 0.5;
        const diceCY = margin + fieldH * 0.5;
        const leftCopy = (state.diceLeft || []).slice();
        for (let d = 0; d < 2; d++) {
          const val = state.dice[d];
          const idxInLeft = leftCopy.indexOf(val);
          const isAvail = idxInLeft >= 0;
          if (isAvail) leftCopy.splice(idxInLeft, 1);
          draw3DDie(diceCX + (d === 0 ? -28 : 28), diceCY, 40, val, state.currentPlayer, isAvail);
        }
      }

      // Highlight Legal Destinations & Blot Captures for Selected Checker!
      const selMoves = ui.legalMovesForSelected || [];
      const seenDest = Object.create(null);
      for (let i = 0; i < selMoves.length; i++) {
        const m = selMoves[i];
        if (!m.to) continue;
        if (m.to.zone === 'point') {
          const k = 'pt:' + m.to.index;
          if (seenDest[k]) continue;
          seenDest[k] = true;
          const g = getPointGeometry(m.to.index);
          const dir = g.isTop ? 1 : -1;
          const pt = state.points[m.to.index];
          const stackCnt = pt ? Math.min(5, pt.count) : 0;
          const cy = g.yBase + dir * (chkR + 8 + stackCnt * 22);
          if (m.isCapture) {
            drawCaptureReticle(g.x + ptW / 2, g.yBase + dir * (chkR + 3), chkR + 2, false);
          } else {
            drawLegalDestinationDot(g.x + ptW / 2, cy, 9, false);
          }
        } else if (m.to.zone === 'off') {
          const ty = m.to.owner === 2 ? trayTopY + traySubH / 2 : trayBotY + traySubH / 2;
          drawLegalDestinationDot(trayX + trayW / 2, ty, 11, true);
        }
      }

      function mapBackgammonCoord(loc) {
        if (!loc) return null;
        if (loc.zone === 'point' && typeof loc.index === 'number') {
          const g = getPointGeometry(loc.index);
          const dir = g.isTop ? 1 : -1;
          return { x: g.x + ptW / 2, y: g.yBase + dir * (chkR + 28) };
        }
        if (loc.zone === 'bar') {
          return { x: barX + barW / 2, y: margin + fieldH * (loc.owner === 2 ? 0.28 : 0.72) };
        }
        if (loc.zone === 'off') {
          return { x: trayX + trayW / 2, y: loc.owner === 2 ? trayTopY + traySubH / 2 : trayBotY + traySubH / 2 };
        }
        return null;
      }

      drawHintsOverlay(ui.hints, mapBackgammonCoord);
      drawMentorComparisonOverlay(ui.mentorComparison, mapBackgammonCoord);

      lastLayout = {
        gameId: 'backgammon',
        hitTest: function (x, y) {
          for (let i = 0; i < hitBoxes.length; i++) {
            const hb = hitBoxes[i];
            if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) {
              return hb.target;
            }
          }
          return null;
        }
      };
    }

    function drawBearOffTray(x, y, w, h, owner, count) {
      ctx.save();
      roundRect(ctx, x, y, w, h, 6);
      ctx.fillStyle = '#1f0e06';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251,191,36,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fde68a';
      ctx.font = '700 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((owner === 1 ? '白收 ' : '黑收 ') + count, x + w / 2, y + 16);

      const barH = Math.min(12, (h - 34) / 15);
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = owner === 1 ? '#f5efe6' : '#451a03';
        ctx.strokeStyle = owner === 1 ? '#64748b' : '#d6d3d1';
        const ry = y + 26 + i * barH;
        ctx.fillRect(x + 8, ry, w - 16, barH - 1.5);
        ctx.strokeRect(x + 8, ry, w - 16, barH - 1.5);
      }
      ctx.restore();
    }

    function drawDoublingCube(cx, cy, val) {
      ctx.save();
      const s = 34;
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 6);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#fffbeb';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = '#1e1b4b';
      ctx.font = '900 14px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(val === 1 ? '64' : String(val), cx, cy + 1);
      ctx.restore();
    }

    function draw3DDie(cx, cy, size, val, owner, isAvailable) {
      ctx.save();
      if (!isAvailable) ctx.globalAlpha = 0.38;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;

      roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 8);
      ctx.fillStyle = owner === 1 ? '#fffbeb' : '#991b1b';
      ctx.fill();
      ctx.strokeStyle = owner === 1 ? '#cbd5e1' : '#fca5a5';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const pipColor = owner === 1 ? '#111827' : '#ffffff';
      ctx.fillStyle = pipColor;
      const o = size * 0.25;
      const pipCoords = {
        1: [[0, 0]],
        2: [
          [-o, -o],
          [o, o]
        ],
        3: [
          [-o, -o],
          [0, 0],
          [o, o]
        ],
        4: [
          [-o, -o],
          [o, -o],
          [-o, o],
          [o, o]
        ],
        5: [
          [-o, -o],
          [o, -o],
          [0, 0],
          [-o, o],
          [o, o]
        ],
        6: [
          [-o, -o],
          [o, -o],
          [-o, 0],
          [o, 0],
          [-o, o],
          [o, o]
        ]
      }[val] || [[0, 0]];

      for (let i = 0; i < pipCoords.length; i++) {
        ctx.beginPath();
        ctx.arc(cx + pipCoords[i][0], cy + pipCoords[i][1], 3.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawHintsOverlay(hints, mapCoord) {
      if (!Array.isArray(hints) || hints.length === 0) return;
      ctx.save();
      for (let i = hints.length - 1; i >= 0; i--) {
        const h = hints[i];
        const mv = h.move;
        if (!mv || !mv.to) continue;
        const dst = mapCoord(mv.to);
        if (!dst) continue;
        if (mv.from) {
          const src = mapCoord(mv.from);
          if (src) {
            ctx.strokeStyle = i === 0 ? '#fde047' : '#38bdf8';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(dst.x, dst.y);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(dst.x, dst.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#f59e0b' : '#0284c7';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('#' + (i + 1), dst.x, dst.y + 0.5);
      }
      ctx.restore();
    }

    function drawArrowSegment(x1, y1, x2, y2, strokeColor, dashed) {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;
      ctx.lineWidth = 4;
      if (dashed) ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 11;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawMentorComparisonOverlay(comp, mapCoord) {
      if (!comp) return;
      ctx.save();

      // 1. Draw Actual Played Move (if different from Best Move)
      const actual = comp.actualMove;
      const best = comp.bestMove;
      const isDifferent =
        actual &&
        best &&
        actual.id !== best.id &&
        (actual.notation || actual.id) !== (best.notation || best.id);

      if (actual && actual.to && isDifferent) {
        const aDst = mapCoord(actual.to);
        const aSrc = actual.from ? mapCoord(actual.from) : null;
        if (aDst) {
          if (aSrc) {
            drawArrowSegment(aSrc.x, aSrc.y, aDst.x, aDst.y, '#f87171', true);
          }
          ctx.beginPath();
          ctx.arc(aDst.x, aDst.y, 15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
          ctx.fill();
          ctx.strokeStyle = '#fef2f2';
          ctx.lineWidth = 2.2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = '900 10.5px "Microsoft JhengHei", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('實戰', aDst.x, aDst.y + 0.5);
        }
      }

      // 2. Draw Mentor Best Move (#1 Recommended)
      if (best && best.to) {
        const bDst = mapCoord(best.to);
        const bSrc = best.from ? mapCoord(best.from) : null;
        if (bDst) {
          if (bSrc) {
            drawArrowSegment(bSrc.x, bSrc.y, bDst.x, bDst.y, '#22c55e', false);
          }
          ctx.shadowColor = 'rgba(34, 197, 94, 0.8)';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(bDst.x, bDst.y, 16, 0, Math.PI * 2);
          ctx.fillStyle = '#16a34a';
          ctx.fill();
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 2.6;
          ctx.stroke();
          ctx.shadowBlur = 0;

          ctx.fillStyle = '#ffffff';
          ctx.font = '900 10.5px "Microsoft JhengHei", "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('★正解', bDst.x, bDst.y + 0.5);
        }
      }

      ctx.restore();
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    return {
      render: function (gameId, state, uiState) {
        const ui = uiState || {};
        if (!state) return;
        if (gameId === 'othello') return renderOthello(state, ui);
        if (gameId === 'gomoku' || gameId === 'go') return renderIntersectionGrid(gameId, state, ui);
        if (gameId === 'xiangqi') return renderXiangqi(state, ui);
        if (gameId === 'chess' || gameId === 'draughts') return renderCheckeredBoard(gameId, state, ui);
        if (gameId === 'shogi') return renderShogi(state, ui);
        if (gameId === 'backgammon') return renderBackgammon(state, ui);
      },
      hitTest: function (clientX, clientY) {
        if (!lastLayout) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const dpr = Math.min(2.5, Math.max(1, global.devicePixelRatio || 1));
        const logicalW = canvas.width / dpr;
        const logicalH = canvas.height / dpr;
        const x = ((clientX - rect.left) / rect.width) * logicalW;
        const y = ((clientY - rect.top) / rect.height) * logicalH;
        return lastLayout.hitTest(x, y);
      }
    };
  }

  BoardArena.createRenderer = createRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
