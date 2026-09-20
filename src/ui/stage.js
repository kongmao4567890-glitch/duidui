/**
 * 原版还原舞台
 * ------------------------------------------------------------------
 * 底板 assets/stage/stage-bg.png 是从原版录屏里抠出来的整块界面，
 * 会变的数字都已擦掉；这里把数值按量好的原坐标叠回原位，
 * 整块舞台固定 680×580，等比缩放到当前视口。
 */

import { $, el, clear, setText } from './dom.js';
import { formatScore } from '../core/util.js';

/** 原版的数字不带千分位，直接整数显示 */
const plain = (n) => String(Math.max(0, Math.round(n)));
import { GEM_COLORS, SCORE, ITEM_META } from '../core/config.js';

/** 底板的原生尺寸（坐标直接用底图像素，不做换算） */
export const STAGE_W = 1318;
export const STAGE_H = 1079;

export class StageView {
  constructor(game) {
    this.game = game;
    this.n = {
      wrap: $('stageWrap'),
      stage: $('stage'),
      canvas: $('stageBoard'),
      banner: $('stageBanner'),
      counter: $('stCounter'),
      level: $('stLevel'),
      score: $('stScore'),
      target: $('stTarget'),
      missions: $('stMissions'),
      reward: $('stReward'),
      toolDelete: $('stToolDelete'),
      toolTransform: $('stToolTransform'),
      countDelete: $('stCountDelete'),
      countTransform: $('stCountTransform'),
      countHint: $('stCountHint')
    };
    this.ccNodes = [];
    this.missionNodes = [];
    this._lastScore = -1;
    this._lastCounts = null;
    this._bannerTimer = null;
  }

  get active() { return document.body.classList.contains('mode-stage'); }

  /** 等比缩放到当前视口 */
  layout() {
    const wrap = this.n.wrap, stage = this.n.stage;
    if (!wrap || !stage) return;
    const side = wrap.querySelector('.stage-side');
    const gap = 10;
    const pad = 8;
    const vertical = getComputedStyle(wrap).flexDirection === 'column';

    const sideW = side ? side.getBoundingClientRect().width : 0;
    const sideH = side ? side.getBoundingClientRect().height : 0;
    const availW = wrap.clientWidth - pad * 2 - (vertical ? 0 : sideW + gap);
    const availH = wrap.clientHeight - pad * 2 - (vertical ? sideH + gap : 0);

    const k = Math.max(0.2, Math.min(availW / STAGE_W, availH / STAGE_H));
    stage.style.transform = `scale(${k})`;
    // transform 不影响布局盒子，这里用负 margin 把占位收回来，避免出现滚动条
    stage.style.margin = `${(STAGE_H * (k - 1)) / 2}px ${(STAGE_W * (k - 1)) / 2}px`;
    this.scale = k;
  }

  /** 关卡开始时重建 */
  onStageStart() {
    const g = this.game;
    setText(this.n.level, String(g.stage.n).padStart(2, '0'));
    setText(this.n.target, plain(g.stage.target));
    this._buildCounter();
    this._buildMissions();
    this._lastScore = -1;
    this.updateItems();
    this.layout();
  }

  _buildCounter() {
    const box = this.n.counter;
    if (!box) return;
    clear(box);
    this.ccNodes = [];
    this._lastCounts = null;
    const colors = this.game.board ? this.game.board.colors : 5;
    for (let t = 0; t < colors; t++) {
      const item = el('div', 'cc-item');
      const chip = el('span', 'cc-chip');
      const c = GEM_COLORS[t];
      chip.style.background = `linear-gradient(180deg, ${c.light}, ${c.main} 45%, ${c.dark})`;
      const num = el('span', 'cc-num', '0');
      item.append(chip, num);
      item.title = `${c.name}色方块剩余数量`;
      box.appendChild(item);
      this.ccNodes.push({ item, num });
    }
  }

  _buildMissions() {
    const box = this.n.missions;
    if (!box) return;
    clear(box);
    this.missionNodes = [];
    const list = this.game.missionState;

    if (!list.length) {
      box.appendChild(el('div', 'st-mission-text', '无'));
      setText(this.n.reward, '0');
      if (this.n.reward) this.n.reward.style.visibility = 'hidden';
      return;
    }
    if (this.n.reward) this.n.reward.style.visibility = '';
    setText(this.n.reward, plain(list.length * SCORE.missionBonus));

    for (const m of list) {
      const node = el('div', 'st-mission');
      if (m.type === 'color' && GEM_COLORS[m.color]) {
        const chip = el('span', 'cc-chip');
        const c = GEM_COLORS[m.color];
        chip.style.background = `linear-gradient(180deg, ${c.light}, ${c.main} 45%, ${c.dark})`;
        node.appendChild(chip);
        node.appendChild(el('span', 'st-mission-num', String(m.need)));
      } else {
        node.appendChild(el('span', 'st-mission-text', m.text));
      }
      node.title = m.text;
      box.appendChild(node);
      this.missionNodes.push({ node, mission: m });
    }
  }

  /** 每帧刷新 */
  update() {
    const g = this.game;
    if (!g.board) return;

    const shown = Math.round(g.displayScore);
    if (shown !== this._lastScore) {
      setText(this.n.score, plain(shown));
      this._lastScore = shown;
      if (this.n.score) {
        this.n.score.classList.remove('bump');
        void this.n.score.offsetWidth;
        this.n.score.classList.add('bump');
      }
    }

    const counts = g.board.colorCounts();
    if (!this._lastCounts || counts.some((v, i) => v !== this._lastCounts[i])) {
      this._lastCounts = counts;
      this.ccNodes.forEach((n, i) => {
        const v = counts[i] || 0;
        setText(n.num, v);
        n.item.classList.toggle('gone', v === 0);
      });
    }

    for (const m of this.missionNodes) {
      m.node.classList.toggle('done', m.mission.done);
    }
  }

  updateItems() {
    const g = this.game;
    const pairs = [
      ['hammer', this.n.toolDelete, this.n.countDelete],
      ['transform', this.n.toolTransform, this.n.countTransform]
    ];
    for (const [key, btn, count] of pairs) {
      if (!btn) continue;
      const n = g.items[key] || 0;
      setText(count, n);
      btn.classList.toggle('empty', n <= 0);
      btn.classList.toggle('armed', g.armedItem === key);
      btn.title = `${ITEM_META[key].name}（剩 ${n}）：${ITEM_META[key].desc}`;
    }
    setText(this.n.countHint, g.items.hint || 0);
  }

  banner(text, ms = 1100) {
    const b = this.n.banner;
    if (!b) return;
    b.textContent = text;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
  }
}
