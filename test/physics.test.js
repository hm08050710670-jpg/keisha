const P = require('../src/physics.js');
const assert = require('assert');
const YD = P.YD;
const fmt = (n, d = 2) => (n == null ? '-' : n.toFixed(d));
let pass = 0;
function ok(name, cond, extra) { assert(cond, name + ' ' + (extra || '')); pass++; console.log('  ok  ' + name + (extra ? '  [' + extra + ']' : '')); }

// 1. 平坦: まっすぐ・転がり距離が解析解と一致
{
  const s = P.solve(3 * YD, 0, 0, 9);
  const a = P.decel(9);
  const expectV = Math.sqrt(2 * a * (3 * YD + P.PAST));
  ok('flat: aim = 0', Math.abs(s.aim) < 1e-3, 'aim=' + fmt(s.aim * 100) + 'cm');
  ok('flat: v0 matches closed form', Math.abs(s.v0 - expectV) < 0.01, `v0=${fmt(s.v0, 3)} expect=${fmt(expectV, 3)}`);
  // スティンプ9ft で放球速度 1.83m/s → 9ft 転がる
  const r = P.simulate({ v0: 1.83, phi: 0, gx: 0, gy: 0, a, D: 100 });
  ok('stimp: 1.83m/s rolls 9ft', Math.abs(r.stop[0] - 9 * P.FT) < 0.01, 'roll=' + fmt(r.stop[0], 3) + 'm');
}

// 2. 曲がる向きと狙う向き
{
  const r = P.solve(3 * YD, 0, 1.0, 9);   // 右下がり
  ok('right-down: breaks right', r.breakDir === 'right');
  ok('right-down: aim left of cup', r.aim < 0, 'aim=' + fmt(r.aim * 100) + 'cm cups=' + fmt(r.cups));
  const l = P.solve(3 * YD, 0, -1.0, 9);  // 左下がり
  ok('left-down: breaks left', l.breakDir === 'left');
  ok('left-down: aim right of cup', l.aim > 0);
  ok('mirror symmetry', Math.abs(l.aim + r.aim) < 1e-3);
  // 実際にその狙いで打つとカップ中心を通る
  const g = P.slopeAccel(0, 1.0);
  const sim = P.simulate({ v0: r.v0, phi: r.phi, gx: g.gx, gy: g.gy, a: r.decel, D: 3 * YD });
  ok('solution passes cup centre', Math.abs(sim.yCross) < 0.002, 'miss=' + fmt(sim.yCross * 1000, 1) + 'mm');
  ok('stops ~30cm past', Math.abs(sim.past - P.PAST) < 0.02, 'past=' + fmt(sim.past * 100, 1) + 'cm');
}

// 3. 上り・下り
{
  const flat = P.solve(3 * YD, 0, 0, 9), up = P.solve(3 * YD, 1.5, 0, 9), down = P.solve(3 * YD, -1.5, 0, 9);
  ok('uphill needs more speed', up.v0 > flat.v0 && flat.v0 > down.v0, `up=${fmt(up.v0)} flat=${fmt(flat.v0)} down=${fmt(down.v0)}`);
  // 上りの解析解: 減速 = a + (5/7) g sinθ
  const a = P.decel(9) + (5 / 7) * P.G * Math.sin(1.5 * Math.PI / 180);
  ok('uphill closed form', Math.abs(up.v0 - Math.sqrt(2 * a * (3 * YD + P.PAST))) < 0.01);
}

// 4. 傾向: 距離・傾斜・速いグリーンで曲がりが増える
{
  const b = (d, s, st) => P.solve(d * YD, 0, s, st).cups;
  ok('more distance → more break', b(5, 1, 9) > b(3, 1, 9) && b(3, 1, 9) > b(1, 1, 9));
  ok('more slope → more break', b(3, 2, 9) > b(3, 1, 9));
  ok('faster green → more break', b(3, 1, 11) > b(3, 1, 9));
  const dn = P.solve(3 * YD, -1.5, 1, 9).cups, up = P.solve(3 * YD, 1.5, 1, 9).cups;
  ok('downhill breaks more than uphill', dn > up, `down=${fmt(dn)} up=${fmt(up)}`);
}

// 5. 急な傾斜でも計算する（カップに届く強さ）
{
  // ユーザーの実測ケース: 上り8.6°・右下がり3.4°・19.5yd
  const r = P.solve(19.5 * YD, 8.6, 3.4, 9);
  ok('steep uphill: solvable', r.ok && r.steep && !r.runaway, `v0=${fmt(r.v0)} aim=${fmt(r.aim)}m cupV=${fmt(r.cupV)}`);
  const g = P.slopeAccel(8.6, 3.4);
  const sim = P.simulate({ v0: r.v0, phi: r.phi, gx: g.gx, gy: g.gy, a: r.decel, D: 19.5 * YD, stopAtCup: true });
  ok('steep uphill: passes cup centre', sim.reached && Math.abs(sim.yCross) < 0.002, 'miss=' + fmt(sim.yCross * 1000, 1) + 'mm');
  ok('steep uphill: breaks right, aim left', r.aim < 0 && r.breakDir === 'right');
  // 純粋な上り: 解析解 v0² = vc² + 2(a+g)D,  vc² = 2(a+g)·0.3  →  30cm過ぎて止まる基準と一致
  const up = P.solve(5 * YD, 8, 0, 9), aa = P.decel(9) + (5 / 7) * P.G * Math.sin(8 * Math.PI / 180);
  ok('steep pure uphill closed form', Math.abs(up.v0 - Math.sqrt(2 * aa * (5 * YD + P.PAST))) < 0.02, `v0=${fmt(up.v0, 3)} expect=${fmt(Math.sqrt(2 * aa * (5 * YD + P.PAST)), 3)}`);
  // 切り替え点（0.8a）の前後で値が飛ばない
  const thr = Math.asin(0.8 * P.decel(9) / ((5 / 7) * P.G)) * 180 / Math.PI;
  for (const [name, f, s] of [['uphill', 1, 0], ['downhill', -1, 0], ['side', 0, 1], ['diag', -0.7, 0.7]]) {
    const m = Math.hypot(f, s), lo = P.solve(3 * YD, f / m * (thr - 0.02), s / m * (thr - 0.02), 9), hi = P.solve(3 * YD, f / m * (thr + 0.02), s / m * (thr + 0.02), 9);
    const dv = Math.abs(hi.v0 - lo.v0) / lo.v0, da = Math.abs(hi.aim - lo.aim);
    ok(`continuous at threshold (${name})`, lo.ok && hi.ok && !lo.steep && hi.steep && dv < 0.04 && da < 0.12, `v0 ${fmt(lo.v0, 3)}→${fmt(hi.v0, 3)}  aim ${fmt(lo.aim, 3)}→${fmt(hi.aim, 3)}m`);
  }
  // 下りが急すぎる: 触れるだけで届く → runaway として返す
  const dn = P.solve(3 * YD, -8, 0, 9);
  ok('steep downhill: runaway flagged', dn.ok && dn.runaway && !dn.canRest, `v0=${fmt(dn.v0, 3)} cupV=${fmt(dn.cupV)}`);
  ok('moderate slope unchanged', P.solve(3 * YD, -3, 2, 9).ok === true && !P.solve(3 * YD, -3, 2, 9).steep);

  // 全域チェック: どの傾斜・距離でも答えが出て、その答えは実際にカップ中心を通る
  let n = 0, bad = [], worst = 0, tmax = 0;
  for (const st of [7, 9, 11, 13]) for (const d of [0.5, 1, 3, 7, 12, 20]) for (let f = -15; f <= 15; f += 2.5) for (let s2 = -15; s2 <= 15; s2 += 2.5) {
    const t0 = process.hrtime.bigint();
    const q = P.solve(d * YD, f, s2, st);
    tmax = Math.max(tmax, Number(process.hrtime.bigint() - t0) / 1e6);
    n++;
    if (!q.ok) { bad.push(`${st}/${d}/${f}/${s2}:${q.reason}`); continue; }
    const gg = P.slopeAccel(f, s2);
    const c = P.simulate({ v0: q.v0, phi: q.phi, gx: gg.gx, gy: gg.gy, a: q.decel, D: d * YD, stopAtCup: true });
    if (!c.reached || Math.abs(c.yCross) > 0.003 || !isFinite(q.aim) || !(q.v0 > 0)) bad.push(`${st}/${d}/${f}/${s2}:miss ${c.yCross}`);
    else worst = Math.max(worst, Math.abs(c.yCross));
  }
  ok(`grid: every slope/distance solvable (${n} cases)`, bad.length === 0, bad.length ? bad.length + ' bad e.g. ' + bad.slice(0, 6).join(' | ') : `worst miss ${fmt(worst * 1000, 2)}mm, slowest ${fmt(tmax, 0)}ms`);
}

// 6. 振り幅モデル
{
  const m0 = P.strokeModel([]);
  ok('default: 20cm → 3yd on stimp 9', Math.abs(m0.rollYd(20, 9) - 3) < 1e-6);
  const v = P.solve(3 * YD, 0, 0, 9).v0;
  const L = m0.stroke(v);
  ok('default: 3yd flat ≈ 21cm (30cm past cup)', L > 20 && L < 22.5, 'L=' + fmt(L, 1) + 'cm');
  const m1 = P.strokeModel([{ cm: 20, yd: [3.8, 4.0, 4.2], stimp: 9 }]);
  ok('single point: reproduces mean', Math.abs(m1.rollYd(20, 9) - 4) < 1e-6);
  const m3 = P.strokeModel([{ cm: 10, yd: [1, 1.1], stimp: 9 }, { cm: 20, yd: [3.4], stimp: 9 }, { cm: 30, yd: [7] , stimp: 9 }]);
  ok('curve: monotonic', m3.speed(30) > m3.speed(20) && m3.speed(20) > m3.speed(10), 'p=' + fmt(m3.p));
  ok('curve: inverse', Math.abs(m3.stroke(m3.speed(17)) - 17) < 1e-6);
  ok('ignores empty rows', P.strokeModel([{ cm: 10, yd: [], stimp: 9 }]).source === 'default');
}

// 参考表
console.log('\n距離yd / 前後 / 左右 / stimp → 狙い(cm, カップ), 初速, 振り幅(仮基準), 平坦換算yd, 到達s');
const m = P.strokeModel([]);
for (const [d, f, s, st] of [[1,0,1,9],[3,0,1,9],[3,1,0,9],[3,1.5,-1,9],[3,-1.5,-1,9],[5,0,1,9],[5,0,2,9],[10,0,1,9],[10,1,1.5,10],[20,0,2,11],[0.5,0,3,9],[3,0,0.1,9],[19.5,8.6,3.4,9],[3,-8,0,9],[3,0,6,9],[5,6,-6,9]]) {
  const t0 = process.hrtime.bigint();
  const r = P.solve(d * YD, f, s, st);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!r.ok) { console.log(d, f, s, st, '→', r.reason); continue; }
  console.log(`${d}yd f=${f} s=${s} st=${st} → ${fmt(r.aim * 100, 1)}cm (${fmt(r.cups, 1)}個, ${r.breakDir}) v0=${fmt(r.v0)} L=${fmt(m.stroke(r.v0), 1)}cm eq=${fmt(r.flatEq / YD, 1)}yd t=${fmt(r.timeToCup, 1)}s  [${fmt(ms, 1)}ms, path ${r.path.length}pt]`);
}
console.log('\n' + pass + ' checks passed');
