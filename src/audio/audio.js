/**
 * 音频系统
 * ------------------------------------------------------------------
 * 全部用 Web Audio API 实时合成，不依赖任何音频文件 ——
 * 安装包里一个 mp3 都没有，也就没有加载等待和版权问题。
 *
 * 手机浏览器要求「用户第一次触摸之后」才能播放声音，
 * 所以这里做了 unlock()，由第一次点击触发。
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.unlocked = false;
    this.soundOn = true;
    this.musicOn = true;
    this.musicTimer = null;
    this.musicStep = 0;
    this.currentScale = null;
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
      this.sfxGain.gain.value = this.soundOn ? 0.75 : 0;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 0.2 : 0;
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
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.75 : 0;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.2 : 0;
    if (on) this.startMusic(); else this.stopMusic();
  }

  // ==================== 基础发声单元 ====================

  /**
   * 一个带包络的振荡器音符
   * @param {object} o
   */
  _tone({ freq = 440, dur = 0.18, type = 'sine', gain = 0.3, delay = 0, slide = 0, dest = null }) {
    if (!this.unlocked || !this.soundOn) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 一段噪声（用于碎裂、敲击） */
  _noise({ dur = 0.12, gain = 0.2, delay = 0, filter = 1800, type = 'lowpass' }) {
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
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bq); bq.connect(g); g.connect(this.sfxGain);
    src.start(t0);
  }

  // ==================== 游戏音效 ====================

  /** 选中一组 */
  select(size = 2) {
    const base = 520 + Math.min(12, size) * 26;
    this._tone({ freq: base, dur: 0.07, type: 'triangle', gain: 0.22 });
  }

  /** 点到无法消除的方块 */
  deny() {
    this._tone({ freq: 190, dur: 0.11, type: 'square', gain: 0.12, slide: 0.7 });
  }

  /**
   * 消除：组越大，音阶爬得越高、越热闹
   * @param {number} size 这一组的方块数
   */
  remove(size) {
    const n = Math.min(10, Math.max(2, size));
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const root = 392;   // G4
    for (let i = 0; i < Math.min(n, 6); i++) {
      const semi = scale[Math.min(scale.length - 1, i + Math.max(0, n - 4))];
      this._tone({
        freq: root * Math.pow(2, semi / 12),
        dur: 0.16 + i * 0.012,
        type: 'triangle',
        gain: 0.2 - i * 0.018,
        delay: i * 0.035
      });
    }
    this._noise({ dur: 0.1 + n * 0.012, gain: 0.1 + n * 0.012, filter: 1200 + n * 260 });
    if (n >= 8) {
      // 大消除额外补一记低音，给足打击感
      this._tone({ freq: 98, dur: 0.34, type: 'sine', gain: 0.3, delay: 0.04, slide: 0.6 });
    }
  }

  /** 魔术方块换色 */
  magic() {
    for (let i = 0; i < 4; i++) {
      this._tone({
        freq: 660 * Math.pow(2, i / 12 * 2),
        dur: 0.12, type: 'sine', gain: 0.14, delay: i * 0.03
      });
    }
  }

  /** 榔头敲击 */
  hammer() {
    this._noise({ dur: 0.18, gain: 0.34, filter: 700 });
    this._tone({ freq: 140, dur: 0.16, type: 'square', gain: 0.22, slide: 0.45 });
  }

  /** 变换道具 */
  transform() {
    for (let i = 0; i < 6; i++) {
      this._tone({ freq: 440 + i * 90, dur: 0.1, type: 'sine', gain: 0.12, delay: i * 0.025 });
    }
  }

  /** 任务达成 */
  mission() {
    [0, 4, 7, 12].forEach((s, i) => {
      this._tone({ freq: 523.25 * Math.pow(2, s / 12), dur: 0.26, type: 'triangle', gain: 0.2, delay: i * 0.08 });
    });
  }

  /** 按钮 */
  click() {
    this._tone({ freq: 760, dur: 0.05, type: 'square', gain: 0.1 });
  }

  /** 过关 */
  win() {
    const notes = [0, 4, 7, 12, 16, 19];
    notes.forEach((s, i) => {
      this._tone({ freq: 392 * Math.pow(2, s / 12), dur: 0.42, type: 'triangle', gain: 0.24, delay: i * 0.1 });
    });
  }

  /** 失败 */
  lose() {
    [0, -2, -5, -9].forEach((s, i) => {
      this._tone({ freq: 392 * Math.pow(2, s / 12), dur: 0.42, type: 'sine', gain: 0.2, delay: i * 0.15, slide: 0.9 });
    });
  }

  /** 倒数 / 警告 */
  warn() {
    this._tone({ freq: 880, dur: 0.1, type: 'square', gain: 0.14 });
  }

  // ==================== 背景音乐 ====================

  /**
   * 极简程序化 BGM：在一个音阶上随机漫步的琶音，
   * 配上低音铺底，循环但不容易听腻。
   * @param {string} chapterId 章节 id，决定调式与音色
   */
  startMusic(chapterId = 'forest') {
    if (!this.unlocked || !this.musicOn) return;
    this.stopMusic();

    // 不同章节用不同调式，营造气氛差异
    const SCALES = {
      forest: { root: 261.63, steps: [0, 2, 3, 5, 7, 8, 10], wave: 'triangle' },   // 自然小调
      candy:  { root: 293.66, steps: [0, 2, 4, 7, 9], wave: 'sine' },              // 大调五声
      frost:  { root: 246.94, steps: [0, 2, 3, 7, 8], wave: 'sine' },              // 空灵
      flame:  { root: 220.00, steps: [0, 1, 4, 5, 7, 8, 11], wave: 'sawtooth' },   // 和声小调
      sky:    { root: 329.63, steps: [0, 2, 4, 6, 7, 9, 11], wave: 'triangle' },   // 利底亚
      abyss:  { root: 196.00, steps: [0, 1, 3, 6, 8, 10], wave: 'sine' }           // 阴暗
    };
    const scale = SCALES[chapterId] || SCALES.forest;
    this.currentScale = scale;
    this.musicStep = 0;

    const beat = 340;   // 毫秒
    this.musicTimer = setInterval(() => {
      if (!this.musicOn || !this.unlocked) return;
      const s = this.musicStep++;
      const deg = scale.steps[Math.floor(Math.random() * scale.steps.length)];
      const oct = Math.random() < 0.25 ? 1 : 0;
      const freq = scale.root * Math.pow(2, deg / 12 + oct);

      this._musicNote(freq, 0.5, scale.wave, 0.16);
      // 每四拍来一次低音
      if (s % 4 === 0) this._musicNote(scale.root / 2, 0.85, 'sine', 0.2);
      // 偶尔加一个五度和声
      if (s % 8 === 3) this._musicNote(freq * 1.5, 0.4, scale.wave, 0.09);
    }, beat);
  }

  _musicNote(freq, dur, type, gain) {
    if (!this.unlocked) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp); lp.connect(g); g.connect(this.musicGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** 页面切到后台时静音，回来再恢复 */
  setPageActive(active) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(active ? 0.9 : 0, this.ctx.currentTime, 0.1);
    if (active) this.resume();
  }
}

export const audio = new AudioEngine();
