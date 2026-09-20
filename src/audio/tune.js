/**
 * 背景音乐：《Clarinet Polka》（波兰传统民谣，公有领域）
 * ------------------------------------------------------------------
 * 音符不是凭记忆写的，是从原版录屏的音轨里扒出来的：
 * 对每个十六分音符窗口做 FFT 取主频，再投票去噪、修正八度错判
 * （见 tools/ 里的分析过程）。录屏音轨只有 -35 dBFS，直接拿来用
 * 会又糊又有杂音，所以转成音符数据在本地合成，干净、能无缝循环、
 * 而且一个字节的音频文件都不用带。
 *
 * 曲速 125 BPM，2/4 拍，一步 = 十六分音符 = 0.12 秒。
 */

/** 音名 → MIDI 号 */
const N = {
  B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71,
  C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83, C6: 84, D6: 86
};

/**
 * 主旋律：[MIDI 音高, 持续几步]
 * 对应录屏里 0.42s ~ 8.46s 那一整个乐句，首尾相接正好循环。
 */
export const MELODY = [
  [N.C5, 1], [N.E5, 1], [N.C5, 1], [N.E5, 1], [N.C5, 1], [N.G5, 1], [N.C5, 2],
  [N.E5, 2], [N.C5, 1], [N.E5, 1], [N.C5, 4],
  [N.E5, 1], [N.C5, 1], [N.E5, 1], [N.D5, 1], [N.F5, 1], [N.D5, 1], [N.F5, 1], [N.E5, 1],
  [N.G5, 1], [N.E5, 1], [N.G5, 5], [N.D6, 1],
  [N.D5, 1], [N.B4, 3], [N.F5 + 1, 1], [N.B4, 1], [N.F5 + 1, 1], [N.D5, 3],
  [N.B4, 1], [N.G5, 1], [N.B4, 1], [N.D5, 1], [N.B4, 1], [N.D6, 1], [N.B4, 1], [N.D5, 1],
  [N.C5, 1], [N.G5, 1], [N.C5, 2], [N.D5, 1], [N.F5, 2], [N.D5, 1],
  [N.D6, 1], [N.G5, 1], [N.F5, 2], [N.C5, 10]
];

/** 每小节（8 步）的和弦，用来铺「蹦嚓」伴奏 */
export const CHORDS = [
  { root: N.C4, notes: [N.C4, N.E4, N.G4] },          // C
  { root: N.C4, notes: [N.C4, N.E4, N.G4] },          // C
  { root: N.F4, notes: [N.F4, N.A4, N.C5] },          // F
  { root: N.C4, notes: [N.C4, N.E4, N.G4] },          // C
  { root: N.G4, notes: [N.G4, N.B4, N.D5] },          // G
  { root: N.G4, notes: [N.G4, N.B4, N.D5] },          // G
  { root: N.C4, notes: [N.C4, N.E4, N.G4] },          // C
  { root: N.G4, notes: [N.G4, N.B4, N.D5, N.F5] },    // G7
  { root: N.C4, notes: [N.C4, N.E4, N.G4] }           // C
];

/** 一步（十六分音符）多少秒 */
export const STEP = 0.12;
/** 一小节多少步 */
export const STEPS_PER_BAR = 8;
/** 整段循环的总步数 */
export const TOTAL_STEPS = MELODY.reduce((a, m) => a + m[1], 0);

/** MIDI 号 → 频率 */
export const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * 章节变奏：不同章节用不同移调与音色，避免一首曲子听一百关。
 * 移调单位是半音。
 */
export const CHAPTER_STYLE = {
  dusk:  { shift: 0,  wave: 'square',   bright: 2600, name: '原调' },
  candy: { shift: 2,  wave: 'square',   bright: 3000, name: '升两度' },
  frost: { shift: -3, wave: 'triangle', bright: 2200, name: '降小三度' },
  flame: { shift: 5,  wave: 'sawtooth', bright: 2400, name: '升四度' },
  night: { shift: -5, wave: 'triangle', bright: 2000, name: '降四度' },
  abyss: { shift: -7, wave: 'square',   bright: 1800, name: '降五度' }
};
