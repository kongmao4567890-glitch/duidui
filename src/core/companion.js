/**
 * 看板娘 / 小狗的聊天气泡
 * ------------------------------------------------------------------
 * 原版右侧是联众大厅的聊天框、右下角是一只装饰用的小狗。
 * 这里把它做成会根据战况说话的陪玩角色，纯演出，不影响玩法。
 */

export class Companion {
  constructor({ mascot, rng, bus }) {
    this.mascot = mascot;
    this.rng = rng;
    this.bus = bus;
    this.messages = [];      // {who, text, time}
    this.cooldown = 2600;
    this.idleTimer = 6000 + this.rng.int(5000);
    this.puppyTimer = 11000 + this.rng.int(9000);
  }

  /** 推一条聊天记录 */
  push(who, text, face) {
    this.messages.push({ who, text, face, time: Date.now() });
    if (this.messages.length > 40) this.messages.shift();
    this.bus.emit('chat:say', { who, text, face });
  }

  say(text) {
    this.push(this.mascot.name, text, this.mascot.face);
    this.cooldown = 2600;
  }

  puppy(text) {
    this.push('旺财', text, '🐶');
  }

  system(text) {
    this.push('系统', text, '📜');
  }

  /** 根据一次消除的结果给出反应 */
  onRemove(size, score) {
    if (this.cooldown > 0) return;
    if (size >= 12) this.say(this.rng.pick(['哇——这一下太狠了！', `${size} 连！我看呆了……`, '这就是传说中的一击吧！']));
    else if (size >= 8) this.say(this.rng.pick(['漂亮！一大坨！', `${size} 个一起走，赚了！`, '这波不亏！']));
    else if (size >= 6) this.say(this.rng.pick(['不错不错～', '手感来了！', `${score} 分到手。`]));
  }

  onMissionDone(mission) {
    this.say(`任务达成：${mission.text}！`);
  }

  onNoMoves(passed) {
    this.say(passed ? '漂亮，这关过了！' : '没得点了……再来一次吧！');
  }

  onStageStart(stage) {
    this.system(`${stage.label} · ${stage.chapter.name}`);
    this.say(this.rng.pick(this.mascot.lines));
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    this.idleTimer -= dt;
    this.puppyTimer -= dt;

    if (this.idleTimer <= 0) {
      this.idleTimer = 9000 + this.rng.int(9000);
      if (this.cooldown <= 0) this.say(this.rng.pick(this.mascot.lines));
    }
    if (this.puppyTimer <= 0) {
      this.puppyTimer = 14000 + this.rng.int(12000);
      this.puppy(this.rng.pick(['汪！', '汪汪～', '（歪头）', '（摇尾巴）', '（打了个哈欠）', '（用爪子拍了拍屏幕）']));
    }
  }
}
