/* GOLF GUTS PUTT LAB — メトロノームの音
 *
 * 「GOLF GUTS METRONOME」と同じ音を、同じ計算で作る（波形は毎回まったく同じ）。
 *   1拍目   …「ピッ」: 1962Hz の矩形波系トーン（約40msで減衰）＋クリック
 *   2・3拍目 …「カッ」: 約5msの短いクリック（1拍目より約3dB小さい）
 * 画面とは独立しているので、Node でも単体テストできる。
 */
var MetroSound = (function () {
  'use strict';

  /** サンプリング周波数 sr(Hz) → { accent: Float32Array, click: Float32Array } */
  function make(sr) {
    function bp(x, f0, Q) {
      var w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * Q);
      var a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al, b0 = al, b2 = -al;
      var y = new Float32Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (var i = 0; i < x.length; i++) {
        var v = x[i], o = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
      }
      return y;
    }
    function lp(x, fc) {
      var a = Math.exp(-2 * Math.PI * fc / sr), p = 0;
      for (var i = 0; i < x.length; i++) { p = (1 - a) * x[i] + a * p; x[i] = p; }
      return x;
    }
    var i, t, v, m, e;

    // クリック（毎回まったく同じ波形になるよう固定シードのノイズ）
    var nC = Math.round(0.06 * sr), click = new Float32Array(nC);
    var s = 7, nz = new Float32Array(nC);
    for (i = 0; i < nC; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; nz[i] = s / 0x3fffffff - 1; }
    var nf = bp(nz, 2000, 0.45);
    var modes = [[1144, 0.7, 0], [1239, 1, 1.0], [1372, 0.8, 2.0], [2563, 0.9, 0.5], [2621, 0.7, 2.5], [850, 0.35, 0.3]];
    for (i = 0; i < nC; i++) {
      t = i / sr; v = 0;
      if (t < 0.04) {
        e = Math.exp(-t / 0.0032);
        for (m = 0; m < modes.length; m++) v += modes[m][1] * Math.sin(2 * Math.PI * modes[m][0] * t + modes[m][2]) * e;
        v += 3 * nf[i] * Math.exp(-t / 0.002);
      }
      v += 0.09 * Math.sin(2 * Math.PI * 1239 * t) * Math.exp(-t / 0.016);
      click[i] = v;
    }
    lp(click, 9000);

    // 1拍目のトーン
    var nT = Math.round(0.3 * sr), accent = new Float32Array(nT);
    var harm = [[1, 1], [3, 0.3], [5, 0.15], [7, 0.114], [9, 0.067]];
    for (i = 0; i < nT; i++) {
      t = i / sr; v = 0;
      for (m = 0; m < harm.length; m++) v += harm[m][1] * Math.sin(2 * Math.PI * 1962 * harm[m][0] * t);
      accent[i] = 0.4 * v * Math.min(t / 0.0008, 1) * Math.exp(-t / 0.04) + (i < nC ? click[i] : 0);
    }

    // 音量をそろえる（1拍目のピークを 0.9 に）
    var pk = 0;
    for (i = 0; i < nT; i++) pk = Math.max(pk, Math.abs(accent[i]));
    var k = 0.9 / pk;
    for (i = 0; i < nT; i++) accent[i] *= k;
    for (i = 0; i < nC; i++) click[i] *= k;
    var clickOnly = new Float32Array(nC);
    for (i = 0; i < nC; i++) clickOnly[i] = click[i] * 0.73;   // 2・3拍目は1拍目より約3dB小さい

    // 終わりをなめらかに
    [accent, clickOnly].forEach(function (arr) {
      var f = Math.round(0.004 * sr);
      for (var j = 0; j < f; j++) arr[arr.length - 1 - j] *= j / f;
    });
    return { accent: accent, click: clickOnly };
  }

  return { make: make, ACCENT_HZ: 1962 };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MetroSound;
