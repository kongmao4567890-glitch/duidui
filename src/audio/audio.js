/**
 * 音频系统
 * ------------------------------------------------------------------
 * 全部用 Web Audio API 实时合成，安装包里一个音频文件都没有。
 *
 * 音效的参数不是拍脑袋调的 —— 是把原版录屏的音轨扒出来，
 * 减掉背景音乐后做频谱分析量出来的：
 *   · 消除音：242 / 308 / 362 Hz 的大三和弦（≈B3-D#4-F#4），
 *             中频占四成、高频占三成，起音极快、约 250ms 衰减
 *   · 点击音：3.4 kHz 的短促 tick
 * 背景音乐是《Clarinet Polka》，音符同样扒自录屏（见 tune.js）。
 *
 * 手机浏览器要求「用户第一次触摸之后」才能出声，所以有 unlock()。
 */

import { MELODY, CHORDS, STEP, STEPS_PER_BAR, TOTAL_STEPS, freq, CHAPTER_STYLE } from './tune.js';

/** 消除音效的和弦频率（实测值） */
const CLEAR_CHORD = [242, 308, 362];
/** 点击音的频率（实测值） */
const TICK_FREQ = 3426;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.unlocked = false;
    this.soundOn = true;
    this.musicOn = true;

    // 音乐调度
    this.playing = false;
    this.step = 0;              // 已排到第几步
    this.nextTime = 0;          // 下一步的绝对时间
    this.timer = null;
    this.style = CHAPTER_STYLE.dusk;
    this._noteIndex = 0;        // 旋律读到第几个音符
    this._noteLeft = 0;         // 当前音符还剩几步
  }

  /** 首次用户交互时调用，解锁音频上下文 */
  unlock() {
    if (this.unlocked) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.soundOn ? 0.8 : 0;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 0.17 : 0;
      this.musicGain.connect(this.master);

      this.unlocked = true;
    } catch (err) {
      console.warn('音频初始化失败：', err);
      return false;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setSound(on) {
    this.soundOn = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.8 : 0;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.17 : 0;
    if (on) this.startMusic(this._chapter); else this.stopMusic();
  }

  // ==================== 基础发声单元 ====================

  /**
   * 一个带包络的振荡器音符
   */
  _tone({ freq: f = 440, dur = 0.18, type = 'sine', gain = 0.3, delay = 0, slide = 0, dest = null, attack = 0.006 }) {
    if (!this.unlocked || (!this.soundOn && dest !== this.musicGain)) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(attack, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 一段噪声（用于消除时的高频瞬态与敲击） */
  _noise({ dur = 0.12, gain = 0.2, delay = 0, filter = 1800, type = 'bandpass', q = 1 }) {
    if (!this.unlocked || !this.soundOn) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = filter;
    bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bq); bq.connect(g); g.connect(this.sfxGain);
    src.start(t0);
  }

  // ==================== 游戏音效 ====================

  /** 选中一组：高频短 tick，越大的组音越高 */
  select(size = 2) {
    this._tone({
      freq: TICK_FREQ * (0.88 + Math.min(10, size) * 0.02),
      dur: 0.045, type: 'square', gain: 0.1, attack: 0.002
    });
    this._noise({ dur: 0.03, gain: 0.05, filter: 5200, q: 2 });
  }

  /** 点到无法消除的方块 */
  deny() {
    this._tone({ freq: 190, dur: 0.11, type: 'square', gain: 0.11, slide: 0.7 });
  }

  /**
   * 消除：实测的大三和弦，组越大整体移调越高、尾音越长
   * @param {number} size 这一组的方块数
   */
  remove(size) {
    const n = Math.min(14, Math.max(2, size));
    // 组越大越往上移调（每多 2 个升一个半音左右）
    const shift = Math.pow(2, (n - 2) / 24);
    const dur = 0.22 + Math.min(0.26, n * 0.02);

    CLEAR_CHORD.forEach((f, i) => {
      this._tone({
        freq: f * shift, dur: dur * (1 - i * 0.08),
        type: i === 0 ? 'triangle' : 'sine',
        gain: 0.26 - i * 0.05, attack: 0.004
      });
      // 每个音加一个八度泛音，还原原版那种亮闪闪的质感
      this._tone({
        freq: f * shift * 2, dur: dur * 0.55, type: 'sine',
        gain: 0.09 - i * 0.02, delay: 0.004, attack: 0.003
      });
    });

    // 高频瞬态：实测高频段占三成以上
    this._noise({ dur: 0.09 + n * 0.006, gain: 0.16, filter: 3200, type: 'bandpass', q: 0.8 });

    // 一次消很多时，补一记低音增加分量
    if (n >= 8) {
      this._tone({ freq: 121 * shift, dur: 0.34, type: 'sine', gain: 0.24, delay: 0.02, slide: 0.75 });
    }
    // 特大组再叠一串上行琶音
    if (n >= 11) {
      [0, 4, 7, 12].forEach((s, i) => {
        this._tone({
          freq: CLEAR_CHORD[0] * shift * 2 * Math.pow(2, s / 12),
          dur: 0.18, type: 'triangle', gain: 0.1, delay: 0.06 + i * 0.045
        });
      });
    }
  }

  /** 魔术方块换色 */
  magic() {
    for (let i = 0; i < 4; i++) {
      this._tone({ freq: 660 * Math.pow(2, i / 6), dur: 0.11, type: 'sine', gain: 0.12, delay: i * 0.028 });
    }
  }

  /** 删除道具 */
  hammer() {
    this._noise({ dur: 0.16, gain: 0.3, filter: 900, type: 'lowpass' });
    this._tone({ freq: 150, dur: 0.15, type: 'square', gain: 0.2, slide: 0.45 });
  }

  /** 变换道具 */
  transform() {
    for (let i = 0; i < 6; i++) {
      this._tone({ freq: 420 + i * 95, dur: 0.1, type: 'sine', gain: 0.11, delay: i * 0.024 });
    }
  }

  /** 任务达成 */
  mission() {
    [0, 4, 7, 12].forEach((s, i) => {
      this._tone({ freq: 523.25 * Math.pow(2, s / 12), dur: 0.26, type: 'triangle', gain: 0.18, delay: i * 0.08 });
    });
  }

  /** 按钮 */
  click() {
    this._tone({ freq: 760, dur: 0.045, type: 'square', gain: 0.09 });
  }

  /** 过关：用主题曲开头那几个音收尾，和 BGM 呼应 */
  win() {
    [72, 76, 79, 84, 88, 91].forEach((m, i) => {
      this._tone({ freq: freq(m), dur: 0.4, type: 'square', gain: 0.2, delay: i * 0.1 });
    });
  }

  /** 失败 */
  lose() {
    [67, 65, 62, 58].forEach((m, i) => {
      this._tone({ freq: freq(m), dur: 0.42, type: 'triangle', gain: 0.18, delay: i * 0.15, slide: 0.92 });
    });
  }

  warn() {
    this._tone({ freq: 880, dur: 0.1, type: 'square', gain: 0.13 });
  }

  // ==================== 背景音乐 ====================

  /**
   * 开始播放《Clarinet Polka》。
   * 用「预排队 + 前瞻」的方式调度：每 25ms 醒一次，把未来 120ms
   * 内该响的音符按绝对时间排好，这样节奏不会被主线程卡顿带跑。
   * @param {string} chapterId 章节 id，决定移调与音色
   */
  startMusic(chapterId = 'dusk') {
    this._chapter = chapterId;
    this.style = CHAPTER_STYLE[chapterId] || CHAPTER_STYLE.dusk;
    if (!this.unlocked || !this.musicOn) return;

    this.stopMusic();
    this.playing = true;
    this.step = 0;
    this._noteIndex = 0;
    this._noteLeft = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._schedule(), 25);
    this._schedule();
  }

  _schedule() {
    if (!this.playing || !this.unlocked) return;
    const ahead = this.ctx.currentTime + 0.12;
    let guard = 0;
    while (this.nextTime < ahead && guard++ < 64) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % TOTAL_STEPS;
      if (this.step === 0) { this._noteIndex = 0; this._noteLeft = 0; }
    }
  }

  /** 排一步：该起新音就起，顺便铺「蹦嚓」伴奏 */
  _playStep(step, when) {
    const shift = this.style.shift;

    // ── 主旋律
    if (this._noteLeft <= 0) {
      const note = MELODY[this._noteIndex % MELODY.length];
      this._noteIndex++;
      this._noteLeft = note[1];
      this._melodyNote(freq(note[0] + shift), note[1] * STEP, when);
    }
    this._noteLeft--;

    // ── 伴奏：每小节第 1 步低音，第 5 步和弦（波尔卡的「蹦—嚓」）
    const bar = Math.floor(step / STEPS_PER_BAR) % CHORDS.length;
    const inBar = step % STEPS_PER_BAR;
    const chord = CHORDS[bar];
    if (inBar === 0) {
      this._bassNote(freq(chord.root + shift - 12), STEP * 2.2, when);
    } else if (inBar === 4) {
      chord.notes.forEach((m, i) => {
        this._chordNote(freq(m + shift), STEP * 1.5, when, 0.055 - i * 0.008);
      });
    }
  }

  /** 单簧管味道的主旋律：方波过低通 + 轻微颤音 */
  _melodyNote(f, dur, when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.style.bright;
    osc.type = this.style.wave;
    osc.frequency.setValueAtTime(f, when);

    // 颤音：长音才加，短音加了反而糊
    if (dur > 0.3) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 5.2;
      lfoGain.gain.value = f * 0.006;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      lfo.start(when); lfo.stop(when + dur);
    }

    const hold = Math.max(0.05, dur * 0.85);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.14, when + 0.012);
    g.gain.setValueAtTime(0.14, when + hold * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, when + hold);

    osc.connect(lp); lp.connect(g); g.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + hold + 0.03);
  }

  /** 低音「蹦」 */
  _bassNote(f, dur, when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.19, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(when); osc.stop(when + dur + 0.02);
  }

  /** 和弦「嚓」 */
  _chordNote(f, dur, when, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2000;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.01, gain), when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(lp); lp.connect(g); g.connect(this.musicGain);
    osc.start(when); osc.stop(when + dur + 0.02);
  }

  stopMusic() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 页面切到后台时静音，回来再恢复 */
  setPageActive(active) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(active ? 0.9 : 0, this.ctx.currentTime, 0.1);
    if (active) this.resume();
  }
}

export const audio = new AudioEngine();
