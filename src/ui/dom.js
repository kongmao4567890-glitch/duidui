/** 极简 DOM 辅助函数 */

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

export function show(node) { if (node) node.hidden = false; }
export function hide(node) { if (node) node.hidden = true; }

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

/** 设置文本，内容没变就不动 DOM，省去无谓的重排 */
export function setText(node, text) {
  if (node && node.textContent !== String(text)) node.textContent = text;
}

/** 轻微震动（安卓支持，iOS 忽略） */
export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* 忽略 */ }
}
