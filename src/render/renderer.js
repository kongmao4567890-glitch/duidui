/**
 * 棋盘渲染器
 * ------------------------------------------------------------------
 * 负责把 Board 的数据画到 Canvas 上：棋盘框、格子底纹、方块、
 * 选中高亮、提示闪烁、道具光标、粒子与飘字。
 *
 * 所有绘制都按「设备像素比」缩放，在高清屏上不会糊。
 */

import { getSprite, roundRect, clearSpriteCache } from './sprites.js';
import { getImage } from './assets.js';
import { ParticleSystem } from './particles.js';
import { GEM_COLORS, BLOCK_KIND } from '../core/config.js';
import { clamp, easeOutCubic } from '../core/util.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.particles = new ParticleSystem();

    this.cell = 40;
    this.originX = 0;
    this.originY = 0;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;

    this.time = 0;
    this.showGrid = opts.showGrid !== false;
    this.showCount = opts.showCount !== false;
    this.colorMark = opts.colorMark !== false;
    this.theme = opts.theme || { sky: ['#0d1b2f', '#1b3350'], accent: '#7ee787', lamp: '#ffd166' };

    this.shakeTime = 0;
    this.shakeMag = 0;

    /**
     * 'padded' = 自己画金色外框、四周留边（手机版式用）
     * 'exact'  = 棋盘精确铺满画布、不画外框也不画底纹
     *            （原版还原舞台用：外框与底纹都已经画在底板图上了）
     */
    this.fitMode = 'padded';
  }

  /** 切换画布（在两套版式之间切换时用） */
  setCanvas(canvas) {
    if (!canvas || canvas === this.canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    clearSpriteCache();
  }

  /** 屏幕震动（大消除时的打击感） */
  shake(mag = 6, dur = 260) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, dur);
  }

  setTheme(theme) { this.theme = theme; }

  setOptions({ showGrid, showCount, colorMark, particles }) {
    if (showGrid !== undefined) this.showGrid = showGrid;
    if (showCount !== undefined) this.showCount = showCount;
    if (colorMark !== undefined && colorMark !== this.colorMark) {
      this.colorMark = colorMark;
      clearSpriteCache();
    }
    if (particles !== undefined) this.particles.enabled = particles;
  }

  /**
   * 根据容器尺寸重算画布与格子大小。
   * @param {import('../core/board.js').Board} board
   */
  resize(board) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      clearSpriteCache();
    }
    this.dpr = dpr;
    this.width = w;
    this.height = h;

    if (!board) return;

    if (this.fitMode === 'exact') {
      // 画布尺寸就是棋盘尺寸，精确对齐底板上的棋盘位置
      this.cell = Math.min(w / board.cols, h / board.rows);
      this.originX = (w - this.cell * board.cols) / 2;
      this.originY = (h - this.cell * board.rows) / 2;
      this.frame = 0;
      return;
    }

    // 棋盘外框留出一圈边距
    const frame = Math.max(6, Math.min(w, h) * 0.022);
    const availW = w - frame * 2;
    const availH = h - frame * 2;
    const cell = Math.floor(Math.min(availW / board.cols, availH / board.rows));
    this.cell = Math.max(10, cell);
    this.originX = Math.round((w - this.cell * board.cols) / 2);
    this.originY = Math.round((h - this.cell * board.rows) / 2);
    this.frame = frame;
  }

  /** 格子索引 → 画布像素坐标（左上角） */
  cellPos(col, row) {
    return { x: this.originX + col * this.cell, y: this.originY + row * this.cell };
  }

  /** 格子中心像素坐标 */
  cellCenter(col, row) {
    return {
      x: this.originX + (col + 0.5) * this.cell,
      y: this.originY + (row + 0.5) * this.cell
    };
  }

  /**
   * 画布坐标 → 格子索引
   * @returns {number} 索引；落在棋盘外返回 -1
   */
  hitTest(px, py, board) {
    if (!board) return -1;
    const c = Math.floor((px - this.originX) / this.cell);
    const r = Math.floor((py - this.originY) / this.cell);
    if (c < 0 || c >= board.cols || r < 0 || r >= board.rows) return -1;
    return board.index(c, r);
  }

  // ==================== 主绘制 ====================

  /**
   * @param {object} game Game 实例
   * @param {number} dt 帧间隔
   */
  draw(game, dt) {
    const ctx = this.ctx;
    const board = game.board;
    this.time += dt;
    this.particles.update(dt);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.width, this.height);

    // 震动
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = clamp(this.shakeTime / 260, 0, 1);
      const m = this.shakeMag * k;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }

    if (!board) { ctx.restore(); return; }

    if (this.fitMode !== 'exact') {
      this._drawFrame(board);
      this._drawCells(board);
    }
    this._drawBlocks(game, board);
    this._drawSelection(game, board);
    this._drawHint(board);
    this._drawItemCursor(game, board);
    this.particles.draw(ctx);
    this._drawFloatTexts(game);

    ctx.restore();
  }

  /** 棋盘外框：深色底 + 金色描边，还原原版的框感 */
  _drawFrame(board) {
    const ctx = this.ctx;
    const x = this.originX, y = this.originY;
    const w = this.cell * board.cols, h = this.cell * board.rows;
    const pad = Math.max(4, this.cell * 0.18);
    const r = Math.max(6, this.cell * 0.3);

    ctx.save();
    // 外发光
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = pad * 2.2;
    ctx.shadowOffsetY = pad * 0.4;
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, r);
    const bg = ctx.createLinearGradient(0, y - pad, 0, y + h + pad);
    bg.addColorStop(0, 'rgba(10,8,22,0.92)');
    bg.addColorStop(1, 'rgba(4,3,12,0.96)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();

    // 金色描边
    ctx.save();
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, r);
    const gold = ctx.createLinearGradient(x, y - pad, x + w, y + h);
    gold.addColorStop(0, '#f6d365');
    gold.addColorStop(0.4, '#b4874a');
    gold.addColorStop(0.75, '#f6d365');
    gold.addColorStop(1, '#8a5f2e');
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(2, pad * 0.42);
    ctx.stroke();
    ctx.restore();

    // 内侧暗边，增加凹陷感
    ctx.save();
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, r * 0.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /** 格子底纹：优先用从原版抠出来的空格贴图，没有就画深浅交错的棋盘格 */
  _drawCells(board) {
    if (!this.showGrid) return;
    const ctx = this.ctx;
    const tile = getImage('empty');
    ctx.save();
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const { x, y } = this.cellPos(c, r);
        if (tile) {
          ctx.drawImage(tile, x, y, this.cell, this.cell);
        } else {
          ctx.fillStyle = (c + r) % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.016)';
          ctx.fillRect(x, y, this.cell, this.cell);
        }
      }
    }
    ctx.restore();
  }

  /** 所有方块 */
  _drawBlocks(game, board) {
    const ctx = this.ctx;
    const cell = this.cell;
    const selected = board.selection ? new Set(board.selection.cells) : null;

    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const i = board.index(c, r);
        const b = board.grid[i];
        if (!b || b.alpha <= 0.01 || b.scale <= 0.01) continue;

        const px = this.originX + (c + b.ox + 0.5) * cell;
        const py = this.originY + (r + b.oy + 0.5) * cell;

        let scale = b.scale;
        // 选中的方块轻微放大并抖动，提示「点一下就消」
        if (selected && selected.has(i) && b.isNormal) {
          scale *= 1.06 + Math.sin(this.time / 90 + (c + r) * 0.6) * 0.035;
        }
        // 魔术方块常驻呼吸效果
        if (b.isMagic) scale *= 1 + Math.sin(this.time / 260 + i) * 0.03;

        const sprite = getSprite(b.type < 0 ? 0 : b.type, b.kind, cell, this.colorMark);
        const size = cell * scale;

        ctx.save();
        ctx.globalAlpha = b.alpha;
        ctx.translate(px, py);
        if (b.spin) ctx.rotate(b.spin);
        // 魔术方块换色时做 Y 轴翻转
        if (b.anim && b.anim.type === 'flip') {
          const p = clamp(b.anim.t / b.anim.dur, 0, 1);
          ctx.scale(Math.abs(Math.cos(p * Math.PI)) * 0.9 + 0.1, 1);
        }
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
  }

  /** 选中高亮：整组描边 + 数量与预估得分徽章 */
  _drawSelection(game, board) {
    const sel = board.selection;
    if (!sel || !sel.cells.length) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const pulse = 0.55 + Math.sin(this.time / 130) * 0.28;
    const isMagic = sel.special === BLOCK_KIND.MAGIC;
    const color = sel.type >= 0 ? (GEM_COLORS[sel.type]?.glow || '#fff') : '#ffffff';

    // 描出整组的外轮廓：只画「邻居不在组里」的那几条边
    const inGroup = new Set(sel.cells);
    ctx.save();
    ctx.strokeStyle = isMagic ? '#ffffff' : color;
    ctx.lineWidth = Math.max(2, cell * 0.075);
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = cell * 0.4 * pulse;
    ctx.globalAlpha = 0.55 + pulse * 0.45;
    ctx.beginPath();
    for (const i of sel.cells) {
      const c = board.colOf(i), r = board.rowOf(i);
      const { x, y } = this.cellPos(c, r);
      const inset = cell * 0.06;
      if (!inGroup.has(board.index(c, r - 1)) || r === 0) {
        ctx.moveTo(x + inset, y + inset); ctx.lineTo(x + cell - inset, y + inset);
      }
      if (!inGroup.has(board.index(c, r + 1)) || r === board.rows - 1) {
        ctx.moveTo(x + inset, y + cell - inset); ctx.lineTo(x + cell - inset, y + cell - inset);
      }
      if (c === 0 || !inGroup.has(board.index(c - 1, r))) {
        ctx.moveTo(x + inset, y + inset); ctx.lineTo(x + inset, y + cell - inset);
      }
      if (c === board.cols - 1 || !inGroup.has(board.index(c + 1, r))) {
        ctx.moveTo(x + cell - inset, y + inset); ctx.lineTo(x + cell - inset, y + cell - inset);
      }
    }
    ctx.stroke();
    ctx.restore();

    if (!this.showCount) return;

    // 徽章：显示「N 个 +分数」，跟着最上面那格
    let topIdx = sel.cells[0];
    for (const i of sel.cells) if (i < topIdx) topIdx = i;
    const bc = board.colOf(topIdx), br = board.rowOf(topIdx);
    const { x, y } = this.cellCenter(bc, br);

    const label = isMagic
      ? '点我换色'
      : `${sel.size} 个  +${Math.round(gameGroupScore(game, sel.size))}`;

    ctx.save();
    ctx.font = `600 ${Math.round(cell * 0.32)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const bw = tw + cell * 0.36;
    const bh = cell * 0.5;
    const bx = clamp(x - bw / 2, this.originX, this.originX + board.cols * cell - bw);
    const by = Math.max(this.originY - bh * 0.7, y - cell * 0.78);

    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(12,10,26,0.88)';
    ctx.fill();
    ctx.strokeStyle = isMagic ? 'rgba(255,255,255,0.8)' : color;
    ctx.lineWidth = Math.max(1, cell * 0.028);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
  }

  /** 提示：让被提示的一组轮流跳动 */
  _drawHint(board) {
    if (!board.hint || !board.hint.length) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const t = (this.time % 900) / 900;
    const pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;

    ctx.save();
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = Math.max(2, cell * 0.07);
    ctx.shadowColor = '#ffd43b';
    ctx.shadowBlur = cell * 0.35;
    for (const i of board.hint) {
      const c = board.colOf(i), r = board.rowOf(i);
      const { x, y } = this.cellPos(c, r);
      const g = cell * (0.1 + pulse * 0.05);
      roundRect(ctx, x + g, y + g, cell - g * 2, cell - g * 2, cell * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 道具激活时的光标提示 */
  _drawItemCursor(game, board) {
    if (!game.armedItem) return;
    const ctx = this.ctx;
    const cell = this.cell;
    const pulse = 0.5 + Math.sin(this.time / 160) * 0.5;

    // 整个棋盘压一层暗色，突出「现在是在用道具」
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.16 + pulse * 0.06})`;
    ctx.fillRect(this.originX, this.originY, cell * board.cols, cell * board.rows);

    const label = game.armedItem === 'hammer' ? '🔨 点击要敲掉的方块' : '🎨 点击要变换的位置';
    ctx.font = `700 ${Math.round(cell * 0.38)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const bw = tw + cell * 0.7, bh = cell * 0.78;
    const bx = this.originX + (cell * board.cols - bw) / 2;
    const by = this.originY + cell * board.rows * 0.5 - bh / 2;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = `rgba(20,16,40,${0.82 + pulse * 0.1})`;
    ctx.fill();
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = Math.max(1.5, cell * 0.035);
    ctx.stroke();
    ctx.fillStyle = '#ffe066';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
  }

  /** 飘字 */
  _drawFloatTexts(game) {
    const ctx = this.ctx;
    const cell = this.cell;
    for (const f of game.floatTexts) {
      const p = f.life / f.dur;
      const { x, y } = this.cellCenter(f.col, f.row);
      const fy = y - easeOutCubic(p) * cell * 1.5;
      ctx.save();
      ctx.globalAlpha = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.6) / 0.4);
      ctx.translate(x, fy);
      const s = (p < 0.2 ? 0.6 + (p / 0.2) * 0.5 : 1.1 - p * 0.1) * f.scale;
      ctx.scale(s, s);
      ctx.font = `800 ${Math.round(cell * 0.42)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }

  // ==================== 特效触发 ====================

  /** 响应一次消除：迸发粒子 + 冲击波 + 震屏 */
  onRemove(info, board) {
    if (!this.particles.enabled) return;
    const strength = clamp(info.size / 5, 0.7, 2.4);
    for (const r of info.removed) {
      const { x, y } = this.cellCenter(r.col, r.row);
      this.particles.burst(x, y, r.type < 0 ? 0 : r.type, this.cell, strength);
      if (r.kind === BLOCK_KIND.MAGIC) {
        this.particles.sparkle(x, y, this.cell, '#ffffff', 14);
      }
    }
    if (info.size >= 5) {
      const o = this.cellCenter(board.colOf(info.origin), board.rowOf(info.origin));
      this.particles.shock(o.x, o.y, this.cell * (1 + info.size * 0.22));
    }
    if (info.size >= 8) this.shake(Math.min(14, 4 + info.size * 0.6), 280);
  }

  /** 魔术方块换色的星光 */
  onMagic(index, board) {
    const { x, y } = this.cellCenter(board.colOf(index), board.rowOf(index));
    this.particles.sparkle(x, y, this.cell, '#ffffff', 16);
  }

  /** 变换道具的重排特效：每格按自己的颜色迸出星光 */
  onTransform(cells, board) {
    for (const i of cells) {
      const b = board.grid[i];
      const c = GEM_COLORS[b && b.type >= 0 ? b.type : 0] || GEM_COLORS[0];
      const { x, y } = this.cellCenter(board.colOf(i), board.rowOf(i));
      this.particles.sparkle(x, y, this.cell, c.light, 10);
    }
  }

  reset() {
    this.particles.clear();
    this.time = 0;
    this.shakeTime = 0;
  }
}

/** 预估一组的得分，用于选中徽章 */
function gameGroupScore(game, n) {
  const factor = game.scoreFactor || 25;
  let s = factor * (n - 1) * (n - 1);
  return s;
}
