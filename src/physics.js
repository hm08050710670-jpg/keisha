/* GOLF GUTS PUTT LAB — 計算ロジック（画面とは独立。Node でも単体テストできる）
 *
 * 座標系: x = ボール→カップ方向（m）, y = カップに向かって右（m）
 * 傾斜:   fwd  > 0 … カップに向かって上り（度）
 *         side > 0 … 右下がり（度）＝ボールは右へ曲がる
 * 仮定:   測定地点の傾斜がカップまで一定（平面）。転がり抵抗はスティンプ値から求めた一定の減速。
 */
var PuttPhysics = (function () {
  'use strict';

  var G = 9.80665;          // 重力加速度 m/s²
  var ROLL = 5 / 7;         // 転がる球にかかる斜面方向の重力の係数（球の慣性モーメント分）
  var STIMP_V0 = 1.83;      // スティンプメーターの放球速度 m/s
  var FT = 0.3048, YD = 0.9144;
  var CUP = 0.108;          // カップ直径 m
  var PAST = 0.30;          // カップを過ぎて止まる目標距離 m（カップ付近の目標速度の代わり）
  var DEG = Math.PI / 180;

  /** スティンプ値(ft) → 平坦なグリーンでの減速 m/s² */
  function decel(stimpFt) {
    return (STIMP_V0 * STIMP_V0) / (2 * stimpFt * FT);
  }

  /** 傾斜による面内の加速度 */
  function slopeAccel(fwdDeg, sideDeg) {
    return {
      gx: -ROLL * G * Math.sin(fwdDeg * DEG),
      gy: ROLL * G * Math.sin(sideDeg * DEG)
    };
  }

  /** ボール1球ぶんの転がりを数値積分する */
  function simulate(p) {
    var dt = p.dt || 0.004;
    var x = 0, y = 0;
    var vx = p.v0 * Math.cos(p.phi), vy = p.v0 * Math.sin(p.phi);
    var t = 0, n = 0, crossed = false;
    var yCross = null, vCross = null, tCross = null, dirCross = null, past = 0;
    var path = p.wantPath ? [[0, 0]] : null;

    while (t < 40) {
      var s = Math.sqrt(vx * vx + vy * vy);
      if (s < 1e-4) break;
      var ax = p.gx - p.a * vx / s, ay = p.gy - p.a * vy / s;
      var nvx = vx + ax * dt, nvy = vy + ay * dt;
      if (nvx * vx + nvy * vy <= 0) {
        // このステップの途中で止まる
        var f0 = Math.min(1, s / (Math.sqrt(ax * ax + ay * ay) * dt));
        var ex = vx * dt * f0 * 0.5, ey = vy * dt * f0 * 0.5;
        if (!crossed && x + ex >= p.D) {
          crossed = true; yCross = y; vCross = 0; tCross = t;
        } else if (crossed) {
          past += Math.sqrt(ex * ex + ey * ey);
        }
        x += ex; y += ey; t += dt * f0;
        break;
      }
      var dx = (vx + nvx) * 0.5 * dt, dy = (vy + nvy) * 0.5 * dt;
      var step = Math.sqrt(dx * dx + dy * dy);
      if (!crossed && x + dx >= p.D) {
        var f = (p.D - x) / dx;
        yCross = y + dy * f;
        vCross = s + (Math.sqrt(nvx * nvx + nvy * nvy) - s) * f;
        tCross = t + dt * f;
        crossed = true;
        dirCross = [dx / step, dy / step];
        past += step * (1 - f);
        if (path) path.push([p.D, yCross]);
        if (p.stopAtCup) { x = p.D; y = yCross; t = tCross; break; }
      } else if (crossed) {
        past += step;
      }
      x += dx; y += dy; vx = nvx; vy = nvy; t += dt;
      if (path && (++n % 4 === 0) && !crossed) path.push([x, y]);
    }
    return {
      reached: crossed, yCross: yCross, vCross: vCross, tCross: tCross, dirCross: dirCross,
      past: past, stop: [x, y], time: t, path: path
    };
  }

  /** 与えた初速で、カップ中心を通る打ち出し方向を探す */
  function aimFor(v0, env, stopAtCup) {
    var phi = 0, r = null, ok = false;
    for (var i = 0; i < 60; i++) {
      r = simulate({ v0: v0, phi: phi, gx: env.gx, gy: env.gy, a: env.a, D: env.D, stopAtCup: stopAtCup });
      if (!r.reached) return { reached: false };
      if (Math.abs(r.yCross) < 0.0004) { ok = true; break; }
      phi -= Math.atan2(r.yCross, env.D);
      if (Math.abs(phi) > 1.2) return { reached: false };
    }
    if (!ok) return { reached: false };
    return { reached: true, phi: phi, past: r.past, vCross: r.vCross, dirCross: r.dirCross };
  }

  /**
   * 急な傾斜で使う「カップに届いたときの目標速度」。
   * ゆるい傾斜での基準（カップを30cm過ぎて止まる）と同じ速さになるように、
   * カップ地点での実際の減速（転がり抵抗 ＋ 進行方向の傾斜）から決める。
   * 下りが急で減速がほとんど無い場合は、下限（平坦の2割の減速に相当）を使う。
   */
  function cupSpeed(env, dir) {
    var along = env.gx * dir[0] + env.gy * dir[1];           // 進行方向の重力（正＝加速）
    return Math.sqrt(2 * Math.max(env.a - along, 0.2 * env.a) * PAST);
  }

  /**
   * ラインと必要な初速を求める
   * @param {number} distM   カップまでの距離 m
   * @param {number} fwdDeg  前後傾斜（上りが正）
   * @param {number} sideDeg 左右傾斜（右下がりが正）
   * @param {number} stimpFt グリーン速度（スティンプ値 ft）
   */
  function solve(distM, fwdDeg, sideDeg, stimpFt) {
    var a = decel(stimpFt);
    var g = slopeAccel(fwdDeg, sideDeg);
    var gmag = Math.sqrt(g.gx * g.gx + g.gy * g.gy);
    if (!(distM > 0)) return { ok: false, reason: 'distance' };

    // 傾斜がゆるい間は「カップを30cm過ぎて止まる強さ」。
    // 急な傾斜ではボールが斜面で止まれないので、「カップに届く強さ（届いたときの速さで合わせる）」に切り替える。
    var steep = gmag > 0.8 * a;
    var env = { gx: g.gx, gy: g.gy, a: a, D: distM };
    var V_MIN = 0.02, lo = V_MIN, hi = 14, best = null;
    for (var i = 0; i < 44; i++) {
      var v = (lo + hi) / 2;
      var r = aimFor(v, env, steep);
      var enough = r.reached && (steep ? r.vCross >= cupSpeed(env, r.dirCross) : r.past >= PAST);
      if (!enough) { lo = v; }
      else { hi = v; best = { v0: v, phi: r.phi }; }
    }
    if (!best) return { ok: false, reason: 'unreachable' };

    var fin = simulate({
      v0: best.v0, phi: best.phi, gx: g.gx, gy: g.gy, a: a, D: distM, wantPath: true, stopAtCup: steep
    });
    // 下りが急すぎて、ほんの少し触れただけでもカップを通り過ぎる速さになる場合
    var runaway = steep && best.v0 < V_MIN * 2.5;
    var aim = distM * Math.tan(best.phi);           // カップ中心から見た狙い点（右が正）
    var maxDev = 0;
    for (var k = 0; k < fin.path.length; k++) {
      if (Math.abs(fin.path[k][1]) > Math.abs(maxDev)) maxDev = fin.path[k][1];
    }
    return {
      ok: true,
      v0: best.v0,
      phi: best.phi,
      aim: aim,
      cups: Math.abs(aim) / CUP,
      breakDir: aim > 0 ? 'left' : 'right',         // ボールが曲がる方向（狙いの逆）
      path: fin.path,
      maxDev: maxDev,
      timeToCup: fin.tCross,
      flatEq: (best.v0 * best.v0) / (2 * a),        // 同じ強さで平坦なら転がる距離 m
      decel: a,
      steep: steep,                                 // 急傾斜（カップを外すと止まりにくい）
      canRest: gmag < a,                            // 斜面の途中でボールが止まっていられるか
      runaway: runaway,                             // 触れるだけで届いてしまい、強さを加減できない
      cupV: fin.vCross
    };
  }

  /* ---- 振り幅モデル（90BPM固定なので、振り幅がほぼそのまま初速を決める） ---- */

  // 仮の基準: 20cm の振り幅で、スティンプ9ftの平坦なグリーンを 3yd 転がる
  var DEFAULT_REF = { cm: 20, yd: 3, stimp: 9 };

  function speedForRoll(distM, stimpFt) {
    return Math.sqrt(2 * decel(stimpFt) * distM);
  }

  /**
   * キャリブレーション点から「振り幅(cm) → 初速(m/s)」のモデルを作る
   * points: [{cm, yd:[...], stimp}]
   *   0点 … 仮の基準（比例）
   *   1点 … その点を通る比例
   *   2点以上 … 両対数の最小二乗で v = c·L^p（p は 0.6〜1.4 に制限）
   */
  function strokeModel(points) {
    var pts = [];
    (points || []).forEach(function (pt) {
      var ds = (pt.yd || []).filter(function (d) { return d > 0; });
      if (!ds.length || !(pt.cm > 0)) return;
      var mean = ds.reduce(function (s, d) { return s + d; }, 0) / ds.length;
      pts.push({ cm: pt.cm, meanYd: mean, v: speedForRoll(mean * YD, pt.stimp || 9) });
    });
    var c, p = 1, source;
    if (!pts.length) {
      c = speedForRoll(DEFAULT_REF.yd * YD, DEFAULT_REF.stimp) / DEFAULT_REF.cm;
      source = 'default';
    } else if (pts.length === 1) {
      c = pts[0].v / pts[0].cm;
      source = 'single';
    } else {
      var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      pts.forEach(function (q) {
        var lx = Math.log(q.cm), ly = Math.log(q.v);
        sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly;
      });
      var den = n * sxx - sx * sx;
      p = den > 1e-9 ? (n * sxy - sx * sy) / den : 1;
      p = Math.max(0.6, Math.min(1.4, p));
      c = Math.exp((sy - p * sx) / n);
      source = 'curve';
    }
    return {
      c: c, p: p, source: source, points: pts,
      speed: function (cm) { return c * Math.pow(cm, p); },
      stroke: function (v) { return Math.pow(v / c, 1 / p); },
      /** その振り幅で平坦なグリーンを転がる距離 yd */
      rollYd: function (cm, stimpFt) {
        var v = c * Math.pow(cm, p);
        return (v * v) / (2 * decel(stimpFt)) / YD;
      }
    };
  }

  return {
    G: G, YD: YD, FT: FT, CUP: CUP, PAST: PAST, DEFAULT_REF: DEFAULT_REF,
    decel: decel, slopeAccel: slopeAccel, simulate: simulate, solve: solve,
    strokeModel: strokeModel, speedForRoll: speedForRoll
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PuttPhysics;
