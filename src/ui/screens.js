/**
 * 弹层管理
 * ------------------------------------------------------------------
 * 标题页、关卡选择、开场、暂停、结算、救场、玩法说明、设置。
 * 所有文案均为中文，按钮文字也按当前情境动态生成。
 */

import { $, el, clear, setText, show, hide } from './dom.js';
import { formatScore } from '../core/util.js';
import { BOARD_PRESETS, SCORE, ITEM_META } from '../core/config.js';
import { CHAPTERS, makeStage } from '../core/stage.js';
import { Board } from '../core/board.js';

export class Screens {
  /**
   * @param {object} deps { game, storage, audio, hud, on }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.stack = [];
    this.node = {
      title: $('screenTitle'),
      stages: $('screenStages'),
      intro: $('screenIntro'),
      pause: $('screenPause'),
      result: $('screenResult'),
      rescue: $('screenRescue'),
      help: $('screenHelp'),
      settings: $('screenSettings')
    };
    this.selectedChapter = 0;
  }

  // ==================== 通用 ====================

  open(name) {
    const n = this.node[name];
    if (!n) return;
    n.hidden = false;
    if (!this.stack.includes(name)) this.stack.push(name);
  }

  close(name) {
    const n = this.node[name];
    if (!n) return;
    n.hidden = true;
    this.stack = this.stack.filter((x) => x !== name);
  }

  closeAll() {
    for (const k of Object.keys(this.node)) this.close(k);
  }

  get top() { return this.stack[this.stack.length - 1] || null; }
  isOpen(name) { return this.node[name] && !this.node[name].hidden; }
  get anyOpen() { return Object.keys(this.node).some((k) => this.isOpen(k)); }

  // ==================== 标题页 ====================

  showTitle() {
    this.closeAll();
    this.open('title');
    const p = this.storage.progress;
    setText($('titleProgress'), `最高纪录：第 ${Math.max(1, p.maxStage)} 关`);
    const btnPlay = $('btnPlay');
    if (btnPlay) {
      btnPlay.textContent = p.maxStage > 1 ? `继续第 ${p.maxStage} 关` : '开始游戏';
    }
  }

  // ==================== 关卡选择 ====================

  showStageSelect() {
    this.open('stages');
    const maxStage = this.storage.progress.maxStage;
    // 默认定位到当前进度所在章节
    const idx = CHAPTERS.findIndex((c) => maxStage >= c.from && maxStage <= c.to);
    this.selectedChapter = idx < 0 ? 0 : idx;
    this._renderChapters();
    this._renderStageGrid();
  }

  _renderChapters() {
    const box = $('chapterTabs');
    if (!box) return;
    clear(box);
    const maxStage = this.storage.progress.maxStage;
    CHAPTERS.forEach((c, i) => {
      const locked = maxStage < c.from;
      const tab = el('button', 'chapter-tab' + (i === this.selectedChapter ? ' active' : '') + (locked ? ' locked' : ''), c.name);
      tab.type = 'button';
      if (!locked) {
        tab.addEventListener('click', () => {
          this.audio.click();
          this.selectedChapter = i;
          this._renderChapters();
          this._renderStageGrid();
        });
      }
      box.appendChild(tab);
    });
  }

  _renderStageGrid() {
    const box = $('stageGrid');
    if (!box) return;
    clear(box);
    const ch = CHAPTERS[this.selectedChapter];
    const p = this.storage.progress;
    // 最后一章是开放式的，只展示已解锁附近的 60 关
    const to = Math.min(ch.to, ch.from + 59, Math.max(ch.from + 11, p.maxStage + 8));

    for (let n = ch.from; n <= to; n++) {
      const locked = n > p.maxStage;
      const stars = p.stars[n] || 0;
      const cell = el('button', 'stage-cell');
      cell.type = 'button';
      if (locked) cell.classList.add('locked');
      else if (stars > 0) cell.classList.add('cleared');
      if (n === p.maxStage) cell.classList.add('current');

      if (locked) {
        cell.appendChild(el('span', 'stage-cell-lock', '🔒'));
      } else {
        cell.appendChild(el('span', 'stage-cell-num', String(n)));
        cell.appendChild(el('span', 'stage-cell-stars', '★'.repeat(stars)));
        const best = p.bestScore[n];
        cell.title = best ? `第 ${n} 关　最高分 ${formatScore(best)}` : `第 ${n} 关`;
        cell.addEventListener('click', () => {
          this.audio.click();
          this.close('stages');
          this.on('startStage', n);
        });
      }
      box.appendChild(cell);
    }
  }

  // ==================== 关卡开场 ====================

  showIntro(stage, ms = 1800) {
    setText($('introChapter'), stage.chapter.name);
    setText($('introStage'), stage.label);
    setText($('introTarget'), formatScore(stage.target));
    setText($('introTip'), stage.brief);

    const box = $('introMissions');
    clear(box);
    for (const m of stage.missions || []) {
      box.appendChild(el('div', 'intro-mission', `任务：${m.text}`));
    }
    this.open('intro');
    clearTimeout(this._introTimer);
    this._introTimer = setTimeout(() => this.close('intro'), ms);
  }

  // ==================== 暂停 ====================

  showPause() {
    const g = this.game;
    const box = $('pauseStats');
    clear(box);
    const rows = [
      ['当前分数', formatScore(g.score)],
      ['过关分数', formatScore(g.stage.target)],
      ['剩余方块', g.board.remaining],
      ['已消除', `${g.stats.blocksCleared} 个 / ${g.stats.groupCount} 组`],
      ['最大一组', `${g.stats.maxGroup} 个`]
    ];
    for (const [k, v] of rows) {
      const line = el('div', 'result-line');
      line.append(el('span', null, k), el('b', null, String(v)));
      box.appendChild(line);
    }
    this.open('pause');
  }

  // ==================== 结算 ====================

  showResult(payload, win) {
    const ribbon = $('resultRibbon');
    ribbon.textContent = win
      ? (payload.perfect ? '完美清场！' : '过关！')
      : '本局结束';
    ribbon.classList.toggle('lose', !win);

    // 星星
    const starBox = $('resultStars');
    clear(starBox);
    for (let i = 0; i < 3; i++) {
      const s = el('span', 'result-star' + (i < payload.stars ? '' : ' off'), '★');
      s.style.animationDelay = `${i * 0.16}s`;
      starBox.appendChild(s);
    }

    setText($('resultScore'), formatScore(payload.score));

    // 明细
    const bd = $('resultBreakdown');
    clear(bd);
    const base = payload.score - payload.clearBonus - payload.missionBonus;
    const rows = [
      ['消除得分', `${formatScore(base)}`],
      ['清场奖励', payload.clearBonus > 0 ? `+${formatScore(payload.clearBonus)}` : '—'],
      ['任务奖励', payload.missionBonus > 0 ? `+${formatScore(payload.missionBonus)}` : '—'],
      ['剩余方块', `${payload.remaining} 个`],
      ['最大一组', `${payload.stats.maxGroup} 个`]
    ];
    for (const [k, v] of rows) {
      const line = el('div', 'result-line');
      line.append(el('span', null, k), el('b', null, v));
      bd.appendChild(line);
    }
    const total = el('div', 'result-line total');
    total.append(
      el('span', null, win ? '本关得分' : `目标 ${formatScore(payload.stage.target)}`),
      el('b', null, formatScore(payload.score))
    );
    bd.appendChild(total);

    // 任务完成情况
    const mb = $('resultMissions');
    clear(mb);
    for (const m of payload.missions || []) {
      mb.appendChild(el('div', 'result-mission ' + (m.done ? 'done' : 'fail'),
        `${m.done ? '✓' : '✗'} ${m.text}`));
    }

    // 按钮：按胜负给不同选项
    const actions = $('resultActions');
    clear(actions);
    if (win) {
      const next = el('button', 'btn btn-primary', '下一关');
      next.type = 'button';
      next.addEventListener('click', () => { this.audio.click(); this.close('result'); this.on('nextStage'); });
      const again = el('button', 'btn', '再玩一次');
      again.type = 'button';
      again.addEventListener('click', () => { this.audio.click(); this.close('result'); this.on('retryStage'); });
      const back = el('button', 'btn', '返回标题');
      back.type = 'button';
      back.addEventListener('click', () => { this.audio.click(); this.close('result'); this.on('quit'); });
      actions.append(next, again, back);
    } else {
      const again = el('button', 'btn btn-primary', '再来一次');
      again.type = 'button';
      again.addEventListener('click', () => { this.audio.click(); this.close('result'); this.on('retryStage'); });
      const select = el('button', 'btn', '选择关卡');
      select.type = 'button';
      select.addEventListener('click', () => { this.audio.click(); this.close('result'); this.on('quit'); this.showStageSelect(); });
      const back = el('button', 'btn', '返回标题');
      back.type = 'button';
      back.addEventListener('click', () => { this.audio.click(); this.close('result'); this.on('quit'); });
      actions.append(again, select, back);
    }

    this.open('result');
  }

  // ==================== 救场 ====================

  showRescue(info) {
    const g = this.game;
    const text = $('rescueText');
    clear(text);
    text.append(
      document.createTextNode('棋盘上还剩 '),
      el('b', null, String(info.remaining)),
      document.createTextNode(' 个方块，但已经没有相连的同色组合了。')
    );

    const actions = $('rescueActions');
    clear(actions);

    for (const key of ['hammer', 'transform']) {
      const n = g.items[key] || 0;
      const btn = el('button', 'btn' + (key === 'hammer' ? ' btn-primary' : ''),
        `${ITEM_META[key].icon} 用${ITEM_META[key].name}（剩 ${n}）`);
      btn.type = 'button';
      btn.disabled = n <= 0;
      btn.addEventListener('click', () => {
        this.audio.click();
        this.close('rescue');
        this.on('armItem', key);
      });
      actions.appendChild(btn);
    }

    const finish = el('button', 'btn btn-danger', '就到这里，结算');
    finish.type = 'button';
    finish.addEventListener('click', () => {
      this.audio.click();
      this.close('rescue');
      this.on('giveUp');
    });
    actions.appendChild(finish);

    this.open('rescue');
  }

  // ==================== 玩法说明 ====================

  showHelp() {
    // 用当前的计分公式现场生成分值表，改了配置这里也会跟着变
    const table = $('helpScoreTable');
    if (table && !table.dataset.built) {
      clear(table);
      const head = el('tr');
      head.append(el('th', null, '一次消除'), el('th', null, '得分'), el('th', null, '相当于'));
      table.appendChild(head);
      const f = SCORE.groupFactor;
      for (const n of [2, 3, 4, 6, 8, 10, 12, 15]) {
        const s = Board.groupScore(n, f);
        const pairs = Board.groupScore(2, f);
        const tr = el('tr');
        tr.append(
          el('td', null, `${n} 个`),
          el('td', null, formatScore(s)),
          el('td', null, n === 2 ? '基准' : `${Math.round(s / pairs)} 次两连`)
        );
        table.appendChild(tr);
      }
      table.dataset.built = '1';
    }
    this.open('help');
  }

  // ==================== 设置 ====================

  showSettings() {
    const s = this.storage.settings;
    const bind = (id, key) => {
      const node = $(id);
      if (!node) return;
      node.checked = !!s[key];
    };
    bind('setConfirmTap', 'confirmTap');
    bind('setShowCount', 'showCount');
    bind('setVibrate', 'vibrate');
    bind('setShowGrid', 'showGrid');
    bind('setParticles', 'particles');
    bind('setColorMark', 'colorMark');
    bind('setSound', 'sound');
    bind('setMusic', 'music');

    const viewSel = $('setView');
    if (viewSel) viewSel.value = s.view || 'auto';

    const sel = $('setBoard');
    if (sel && !sel.dataset.built) {
      clear(sel);
      for (const [key, preset] of Object.entries(BOARD_PRESETS)) {
        const opt = el('option', null, preset.label);
        opt.value = key;
        sel.appendChild(opt);
      }
      sel.dataset.built = '1';
    }
    if (sel) sel.value = s.board;

    // 统计
    const box = $('settingStats');
    clear(box);
    const p = this.storage.progress;
    const rows = [
      ['最高关卡', `第 ${p.maxStage} 关`],
      ['累计得分', formatScore(p.totalScore)],
      ['累计消除', `${formatScore(p.totalBlocks)} 个方块`],
      ['历史最大一组', `${p.bestGroup} 个`],
      ['完美清场', `${p.perfectClears} 次`],
      ['总局数', `${p.totalGames} 局`]
    ];
    for (const [k, v] of rows) {
      const line = el('div', 'setting-stat');
      line.append(el('span', null, k), el('b', null, v));
      box.appendChild(line);
    }

    this.open('settings');
  }
}
