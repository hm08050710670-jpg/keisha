// メトロノーム音（sound.js）の性質を確認する
const S = require('../src/sound.js');
const assert = require('assert');
let pass = 0;
function ok(name, cond, extra) { assert(cond, name + ' ' + (extra || '')); pass++; console.log('  ok  ' + name + (extra ? '  [' + extra + ']' : '')); }
const peak = a => a.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
// ある周波数の成分の強さ（先頭 n サンプル）
function power(a, sr, f, n) { let re = 0, im = 0; for (let i = 0; i < n; i++) { re += a[i] * Math.cos(2 * Math.PI * f * i / sr); im += a[i] * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im) / n; }

for (const sr of [44100, 48000]) {
  const m = S.make(sr), m2 = S.make(sr);
  ok(`${sr}Hz: 長さ 1拍目0.3秒 / 2・3拍目0.06秒`, m.accent.length === Math.round(0.3 * sr) && m.click.length === Math.round(0.06 * sr));
  ok(`${sr}Hz: 1拍目のピーク 0.9`, Math.abs(peak(m.accent) - 0.9) < 1e-6, peak(m.accent).toFixed(4));
  ok(`${sr}Hz: 2・3拍目は1拍目より小さい`, peak(m.click) < peak(m.accent) && peak(m.click) > 0.3, peak(m.click).toFixed(4));
  ok(`${sr}Hz: 毎回同じ波形`, m.accent.every((v, i) => v === m2.accent[i]) && m.click.every((v, i) => v === m2.click[i]));
  ok(`${sr}Hz: 値はすべて有限で ±1 以内`, [...m.accent, ...m.click].every(v => Number.isFinite(v) && Math.abs(v) <= 1));
  const n = Math.round(0.05 * sr), pA = power(m.accent, sr, 1962, n), pC = power(m.click, sr, 1962, Math.min(n, m.click.length));
  ok(`${sr}Hz: 1拍目だけ 1962Hz の「ピッ」が入っている`, pA > 8 * pC, `accent ${pA.toFixed(4)} vs click ${pC.toFixed(4)}`);
  ok(`${sr}Hz: 音の終わりは無音に戻る`, Math.abs(m.accent[m.accent.length - 1]) < 1e-6 && Math.abs(m.click[m.click.length - 1]) < 1e-6);
}
console.log('\n' + pass + ' checks passed');
