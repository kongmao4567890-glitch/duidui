/**
 * 粒子特效系统
 * ------------------------------------------------------------------
 * 消除时的碎片飞溅、星光、冲击波，全部程序化绘制。
 * 用对象池复用粒子，避免频繁 GC 造成掉帧。
 */

import { GEM_COLORS } from '../core/config.js';

const POOL_SIZE = 900;

export class ParticleSystem {
  constructor() {
    this.pool = [];
    this.active = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
        size: 0, color: '#fff', kind: 'shard', rot: 0, vr: 0, gravity: 1
      });
    }
    this.shockwaves = [];
    this.enabled = true;
  }

  _take() {
    return this.pool.pop() || null;
  }

  _release(p) {
    if (this.pool.length < POOL_SIZE) this.pool.push(p);
  }

  /**
   * 方块碎裂：向四周迸出彩色碎片
   * @param {number} x 像素坐标（格中心）
   * @param {number} y
   * @param {number} type 颜色索引
   * @param {number} cell 格子边长，用来决定粒子大小
   * @param {number} strength 强度倍率（一次消得越多越夸张）
   */
  burst(x, y, type, cell, strength = 1) {
    if (!this.enabled) return;
    const color = GEM_COLORS[type] || GEM_COLORS[0];
    const count = Math.round((7 + Math.random() * 5) * Math.min(2.2, strength));
    for (let i = 0; i < count; i++) {
      const p = this._take();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.9 + Math.random() * 2.4) * cell * 0.055 * strength;
      p.x = x + (Math.random() - 0.5) * cell * 0.4;
      p.y = y + (Math.random() - 0.5) * cell * 0.4;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - cell * 0.045;
      p.maxLife = p.life = 430 + Math.random() * 360;
      p.size = cell * (0.08 + Math.random() * 0.16);
      p.color = Math.random() < 0.3 ? color.light : color.main;
      p.kind = 'shard';
      p.rot = Math.random() * Math.PI;
      p.vr = (Math.random() - 0.5) * 0.02;
      p.gravity = 1;
      this.active.push(p);
    }
  }

  /** 星光：用于魔术方块换色、任务达成等 */
  sparkle(x, y, cell, color = '#ffffff', count = 10) {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const p = this._take();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.3) * cell * 0.05;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.maxLife = p.life = 500 + Math.random() * 400;
      p.size = cell * (0.05 + Math.random() * 0.09);
      p.color = color;
      p.kind = 'star';
      p.rot = Math.random() * Math.PI;
      p.vr = (Math.random() - 0.5) * 0.05;
      p.gravity = 0.12;
      this.active.push(p);
    }
  }

  /** 冲击波圆环 */
  shock(x, y, radius, color = 'rgba(255,255,255,0.8)') {
    if (!this.enabled) return;
    this.shockwaves.push({ x, y, r: radius * 0.2, max: radius, life: 0, dur: 380, color });
    if (this.shockwaves.length > 12) this.shockwaves.shift();
  }

  update(dt) {
    const step = dt / 16.667;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.active.splice(i, 1);
        this._release(p);
        continue;
      }
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy += 0.42 * step * p.gravity;
      p.vx *= 0.985;
      p.rot += p.vr * step;
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life += dt;
      if (s.life >= s.dur) { this.shockwaves.splice(i, 1); continue; }
      const t = s.life / s.dur;
      s.r = s.max * (0.2 + 0.8 * (1 - Math.pow(1 - t, 3)));
    }
  }

  draw(ctx) {
    // 冲击波
    for (const s of this.shockwaves) {
      const t = s.life / s.dur;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.max * 0.08 * (1 - t));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 粒子
    for (const p of this.active) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === 'star') {
        const r = p.size * (0.6 + t * 0.6);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const rad = i % 2 === 0 ? r : r * 0.4;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        const s = p.size * (0.5 + t * 0.7);
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
  }

  clear() {
    for (const p of this.active) this._release(p);
    this.active.length = 0;
    this.shockwaves.length = 0;
  }

  get count() { return this.active.length; }
}
