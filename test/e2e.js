const { chromium } = require('playwright');
const path = require('path');
const URL = 'http://localhost:8765/golf-guts-putt-lab.html';
const shots = path.join(__dirname, '..', 'shots');
const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }); console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); }

// 合成センサー: ページ内で deviceorientation を30Hzで流す
async function feed(page, beta, gamma, noise = 0.05) {
  await page.evaluate(([b, g, n]) => {
    clearInterval(window.__feed);
    window.__feed = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {
        alpha: 0, beta: b + (Math.random() - .5) * 2 * n, gamma: g + (Math.random() - .5) * 2 * n }));
    }, 33);
  }, [beta, gamma, noise]);
}
const stopFeed = (page) => page.evaluate(() => clearInterval(window.__feed));
// 欲しい「グリーンの傾き」(fwd: 上りが正, side: 右下がりが正) を、既定の置き方（横置き・上側が左）での端末の傾きに直して流す
//   fwd = -(右側が下がる角度)  →  gamma を負にすると上り / side = beta
function feedSlope(page, fwd, side, noise = 0.05, devOffset = [0, 0]) {
  const beta = side + devOffset[0];
  const sRight = -fwd + devOffset[1];
  const gamma = Math.asin(Math.sin(sRight * Math.PI / 180) / Math.cos(beta * Math.PI / 180)) * 180 / Math.PI;
  return feed(page, beta, gamma, noise);
}
const txt = (page, sel) => page.locator(sel).innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function setRange(page, sel, v) {
  await page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(w, h) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.addInitScript(() => {
      // メトロノームの予約時刻を記録する
      window.__clicks = [];
      const AC = window.AudioContext;
      const origStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when) {
        // 長さ1サンプルの無音（iPhone用の音出し準備）は拍として数えない
        if (this.buffer && this.buffer.duration > 0.01) window.__clicks.push({ when, dur: this.buffer.duration });
        return origStart.apply(this, arguments);
      };
      window.__osc = 0;
      const oStart = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function () { window.__osc++; return oStart.apply(this, arguments); };
    });
    await page.goto(URL);
    await page.waitForTimeout(400);
    return page;
  }

  // ===== A. スタート画面 =====
  let page = await newPage(390, 844);
  check('A1 起動時はスタート画面', await page.locator('#scr-start').isVisible() && !(await page.locator('#scr-main').isVisible()));
  check('A2 見出し', (await txt(page, '#scr-start h1')).replace(/\s/g, '') === 'まずはスマホでグリーンの傾斜を測定しましょう！');
  check('A3 横はみ出しなし', (await overflow(page)) <= 0, await overflow(page));
  const steps = await txt(page, '#start-steps');
  check('A4 手順は横置き（上側が左・長い辺をカップへ）', /横にして/.test(steps) && /上側（カメラ側）を左/.test(steps) && /長い辺をカップ/.test(steps), steps.replace(/\n/g, ' / '));
  const fonts = await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).filter((v, i, a) => a.indexOf(v) === i).join(',')));
  console.log('  (loaded web fonts: ' + (fonts || 'none — fallback fonts in use') + ')');
  await page.screenshot({ path: shots + '/01-start.png' });

  // ===== B. センサーなし → 手動入力へ =====
  await page.click('#btn-measure');
  await page.waitForTimeout(600);
  check('B1 測定画面に進む', await page.locator('#scr-measure').isVisible());
  await page.waitForSelector('#sheet-manual:not([hidden])', { timeout: 5000 });
  check('B2 センサーなしで手動入力に切り替わる', /手動で入力/.test(await txt(page, '#mi-msg')), await txt(page, '#mi-msg'));
  await setRange(page, '#mi-fwd', 1.5); await setRange(page, '#mi-side', -1.0);
  check('B3 手動スライダー表示', (await txt(page, '#mi-fwd-out')) === '上り 1.5°' && (await txt(page, '#mi-side-out')) === '左下がり 1.0°');
  await page.screenshot({ path: shots + '/02-manual.png' });
  await page.click('#mi-ok');
  check('B4 手動 → 完了画面', await page.locator('#scr-result').isVisible() && (await txt(page, '#rs-eyebrow')) === '手動入力');
  await page.close();

  // ===== C. センサー測定 =====
  page = await newPage(390, 844);
  await feedSlope(page, 1.5, -1.0);
  await page.click('#btn-measure');
  await page.waitForTimeout(1500);
  check('C1 測定中の表示', /測定中/.test(await txt(page, '#ms-title')), await txt(page, '#ms-title'));
  check('C2 ライブ値', (await txt(page, '#ms-fwd')) === '上り 1.5°', await txt(page, '#ms-fwd') + ' / ' + await txt(page, '#ms-side'));
  await page.screenshot({ path: shots + '/03-measuring.png' });
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 });
  await stopFeed(page);
  check('C3 完了見出し', (await txt(page, '#rs-title')).replace(/\s/g, '') === '傾斜の測定が完了しました！');
  check('C4 前後 上り1.5°', /^上り 1\.5°/.test(await txt(page, '#rs-fwd')), (await txt(page, '#rs-fwd')).replace(/\n/g, ' '));
  check('C5 左右 左下がり1.0°', /^左下がり 1\.0°/.test(await txt(page, '#rs-side')), (await txt(page, '#rs-side')).replace(/\n/g, ' '));
  check('C6 強度 緩やか', /^緩やか/.test(await txt(page, '#rs-strength')), (await txt(page, '#rs-strength')).replace(/\n/g, ' '));
  check('C7 勾配% (tan1.5°=2.6%)', /2\.6%/.test(await txt(page, '#rs-fwd')));
  await page.screenshot({ path: shots + '/04-result.png' });

  // ===== D. メイン画面 =====
  await page.click('#rs-go');
  await page.waitForTimeout(200);
  check('D1 メイン表示・傾斜引き継ぎ', (await txt(page, '#mn-fwd')) === '上り 1.5°' && (await txt(page, '#mn-side')) === '左下がり 1.0°');
  check('D2 初期距離 3yd', (await page.inputValue('#dist-num')) === '3');
  let call = (await txt(page, '#call')).replace(/\n/g, ' | ');
  check('D3 左下がり → 左に曲がる・カップの右を狙う', /左に曲がります/.test(call) && /カップ[\d.]+個分右/.test(call) && !/カップの右[\d.]/.test(call), call);
  check('D3b 表記は「カップ1.5個分右」', (await txt(page, '#call .call-aim')).replace(/\s/g, '') === 'カップ1.5個分右', await txt(page, '#call .call-aim'));
  check('D4 振り幅 24cm（3yd・上り1.5°・仮基準）', (await txt(page, '#st-cm')) === '24', await txt(page, '#st-cm'));
  const rows = (await txt(page, '#stroke-view')).replace(/\n/g, ' ');
  check('D5 卵4・りんご3・ボトル1.2', /卵 約4個分/.test(rows) && /りんご 約3個分/.test(rows) && /ペットボトル 約1\.2本分/.test(rows), rows);
  check('D6 横はみ出しなし', (await overflow(page)) <= 0, await overflow(page));
  await page.screenshot({ path: shots + '/05-main.png', fullPage: true });

  // 距離の入力手段
  await page.click('#dist-chips button[data-v="5"]');
  check('D7 チップ 5yd', (await page.inputValue('#dist-num')) === '5' && (await page.inputValue('#dist-range')) === '5' && (await page.getAttribute('#dist-chips button[data-v="5"]', 'aria-pressed')) === 'true');
  const c5 = await txt(page, '#call');
  await page.click('#dist-plus'); await page.click('#dist-plus');
  check('D8 ＋ボタン → 6yd', (await page.inputValue('#dist-num')) === '6');
  await page.click('#dist-minus');
  check('D9 −ボタン → 5.5yd', (await page.inputValue('#dist-num')) === '5.5');
  await setRange(page, '#dist-range', 10);
  check('D10 スライダー → 10yd', (await page.inputValue('#dist-num')) === '10' && (await txt(page, '#dist-m')) === '約9.1m');
  const c10 = await txt(page, '#call'), s10 = await txt(page, '#st-cm');
  check('D11 距離で再計算される', c5 !== c10, c10.replace(/\n/g, ' | ') + ' / ' + s10 + 'cm');
  await page.screenshot({ path: shots + '/06-main-10yd.png', fullPage: true });
  await page.fill('#dist-num', '2'); await page.locator('#dist-num').blur();
  check('D12 数値入力 → 2yd', (await page.inputValue('#dist-range')) === '2');
  await page.fill('#dist-num', '99'); await page.locator('#dist-num').blur();
  check('D13 範囲外は20ydに丸める', (await page.inputValue('#dist-num')) === '20', await page.inputValue('#dist-num'));
  await page.fill('#dist-num', ''); await page.locator('#dist-num').blur();
  check('D14 空欄は元の値に戻す', (await page.inputValue('#dist-num')) === '20');
  await page.click('#dist-chips button[data-v="3"]');

  // ===== E. メトロノーム =====
  await page.locator('#metro-btn').scrollIntoViewIfNeeded();
  await page.click('#metro-btn');
  check('E1 再生状態', (await txt(page, '#metro-btn')) === '停止する');
  // 1小節ぶん、状態を細かく記録
  const log = await page.evaluate(() => new Promise(res => {
    const out = [], t0 = performance.now();
    const iv = setInterval(() => {
      const beats = [...document.querySelectorAll('#beats span')].map(s => s.className.includes('on') ? 1 : 0).join('');
      const ph = [...document.querySelectorAll('#phases span')].findIndex(s => s.classList.contains('on'));
      const tr = document.querySelector('#mt-putter').getAttribute('transform');
      out.push({ t: performance.now() - t0, beats, ph, ang: parseFloat(tr.slice(7)) });
      if (performance.now() - t0 > 4300) { clearInterval(iv); res(out); }
    }, 20);
  }));
  await page.screenshot({ path: shots + '/07-metronome.png' });
  const clicks = await page.evaluate(() => window.__clicks);
  const iv = clicks.slice(1).map((c, i) => c.when - clicks[i].when);
  check('E2 拍の間隔 0.6667秒 (90BPM)', iv.length >= 5 && iv.every(d => Math.abs(d - 60 / 90) < 1e-6), iv.slice(0, 4).map(d => d.toFixed(4)).join(','));
  check('E3 3拍子・1拍目「ピッ」(0.3秒)／2・3拍目「カッ」(0.06秒)', clicks.slice(0, 6).map(c => c.dur > 0.2 ? 'A' : 'b').join('') === 'AbbAbb', clicks.slice(0, 6).map(c => c.dur.toFixed(2)).join(','));
  check('E3b 旧い電子音（発振器）は使っていない', (await page.evaluate(() => window.__osc)) === 0);
  const phSeq = log.map(l => l.ph).filter((v, i, a) => i === 0 || v !== a[i - 1]).join('');
  check('E4 始動→トップ→インパクト→フォロー の順', /0123(0123)?/.test(phSeq), phSeq);
  // フェーズの切り替わり間隔
  const tr = []; log.forEach((l, i) => { if (i && l.ph !== log[i - 1].ph) tr.push({ t: l.t, to: l.ph }); });
  const i0 = tr.findIndex(x => x.to === 0);
  if (i0 >= 0 && tr[i0 + 3]) {
    const d = [1, 2, 3].map(k => (tr[i0 + k].t - tr[i0].t) / 1000);
    check('E5 トップ0.667 / インパクト1.000 / フォロー1.333秒', Math.abs(d[0] - 0.667) < 0.06 && Math.abs(d[1] - 1.0) < 0.06 && Math.abs(d[2] - 1.333) < 0.06, d.map(x => x.toFixed(3)).join(' / '));
  } else check('E5 フェーズ時刻', false, JSON.stringify(tr));
  const angs = log.map(l => l.ang);
  check('E6 パターが両方向に動く', Math.min(...angs) < -5 && Math.max(...angs) > 5, 'min ' + Math.min(...angs).toFixed(1) + '° max ' + Math.max(...angs).toFixed(1) + '°');
  await page.click('#metro-btn');
  check('E7 停止', (await txt(page, '#metro-btn')) === '再生する');
  const n1 = (await page.evaluate(() => window.__clicks.length)); await page.waitForTimeout(900);
  check('E8 停止後は音を予約しない', (await page.evaluate(() => window.__clicks.length)) === n1);
  // 再生し直しても、1拍目から正しい間隔で始まる
  await page.click('#metro-btn'); await page.waitForTimeout(1600);
  const again = (await page.evaluate(() => window.__clicks)).slice(n1);
  const iv2 = again.slice(1).map((c, i) => c.when - again[i].when);
  check('E9 再生し直し: 1拍目から 0.6667秒間隔', again.length >= 3 && again[0].dur > 0.2 && iv2.every(d => Math.abs(d - 60 / 90) < 1e-6), again.slice(0, 4).map(c => c.dur.toFixed(2)).join(',') + ' / ' + iv2.slice(0, 3).map(d => d.toFixed(4)).join(','));
  await page.click('#metro-btn');

  // ===== F. 設定：グリーン速度・キャリブレーション =====
  const before = { call: await txt(page, '#call'), st: await txt(page, '#st-cm') };
  await page.click('#mn-settings');
  check('F1 設定が開く', await page.locator('#sheet-settings').isVisible());
  await page.screenshot({ path: shots + '/08-settings.png', fullPage: false });
  await page.click('#stimp-chips button[data-v="11"]');
  check('F2 速さ 11ft', (await txt(page, '#stimp-out')) === '11.0 ft');
  await page.click('#set-close');
  const fast = { call: await txt(page, '#call'), st: await txt(page, '#st-cm') };
  check('F3 速いグリーン: 振り幅が小さくなる', +fast.st < +before.st, before.st + ' → ' + fast.st + 'cm / ' + fast.call.replace(/\n/g, ' | '));
  await page.click('#mn-settings'); await page.click('#stimp-chips button[data-v="9"]');
  // キャリブレーション: 20cm で 4yd 平均
  await page.fill('#cal-20-0', '3.8'); await page.fill('#cal-20-1', '4.0'); await page.fill('#cal-20-2', '4.2');
  check('F4 平均表示', (await txt(page, '#cal-avg-20')) === '4.0yd');
  await page.click('#cal-save');
  check('F5 保存後の状態', /登録済み：1点/.test(await txt(page, '#cal-status')), (await txt(page, '#cal-status')).replace(/\n/g, ' '));
  await page.locator('#cal-status').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots + '/09-settings-cal.png' });
  await page.click('#set-close');
  const cal = await txt(page, '#st-cm');
  check('F6 よく転がる人は振り幅が小さくなる', +cal < +before.st, before.st + ' → ' + cal + 'cm');
  check('F7 注記が登録済みに変わる', /あなたのキャリブレーション（1点）/.test(await txt(page, '#st-note')));

  // 再読み込み後も保存されている／起動時はスタート画面に戻る
  await page.reload(); await page.waitForTimeout(300);
  check('F8 再読み込み後はスタート画面', await page.locator('#scr-start').isVisible());
  await feedSlope(page, 0.1, 2.0);
  await page.click('#btn-measure');
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 });
  await stopFeed(page);
  check('F9 前後ほぼ平坦・右下がり2.0°', (await txt(page, '#rs-fwd')) === 'ほぼ平坦' && /^右下がり 2\.0°/.test(await txt(page, '#rs-side')));
  await page.screenshot({ path: shots + '/10-result-right.png' });
  await page.click('#rs-go');
  call = (await txt(page, '#call')).replace(/\n/g, ' | ');
  check('F10 右下がり → 右に曲がる・カップの左を狙う', /右に曲がります/.test(call) && /カップ[\d.]+個分左/.test(call) && !/カップの左[\d.]/.test(call), call);
  await page.click('#mn-settings');
  check('F11 キャリブレーションが残っている', (await page.inputValue('#cal-20-1')) === '4' && /登録済み/.test(await txt(page, '#cal-status')));
  await page.click('#cal-clear');
  check('F12 登録を消す', /未登録/.test(await txt(page, '#cal-status')) && (await page.inputValue('#cal-20-0')) === '');

  // ===== G. ゼロ点補正（180°法） =====
  // 端末のズレ (+0.3, +0.3) / 本当の傾斜 (+1.5, -1.0) → 1回目 (1.8, -0.7), 180°回して (-1.2, 1.3)
  await feedSlope(page, 1.5, -1.0, 0.03, [0.3, 0.3]);
  await page.locator('#zero-start').scrollIntoViewIfNeeded();
  await page.click('#zero-start');
  await page.waitForSelector('#ms-next:not([hidden])', { timeout: 8000 });
  check('G1 1回目完了の案内', /180°/.test(await txt(page, '#ms-hint')), await txt(page, '#ms-hint'));
  await page.screenshot({ path: shots + '/11-zero.png' });
  await feedSlope(page, -1.5, 1.0, 0.03, [0.3, 0.3]);   // 180°回す: 本当の傾斜は反転、端末のズレは同じ
  await page.click('#ms-next');
  await page.waitForSelector('#scr-main:not([hidden])', { timeout: 8000 });
  await page.click('#mn-settings');
  const z = (await txt(page, '#zero-status')).replace(/\n/g, ' ');
  check('G2 ズレ +0.30 / +0.30 を検出', /上下 \+0\.(29|30|31)° ／ 左右 \+0\.(29|30|31)°/.test(z), z);
  await page.click('#set-close');
  await feedSlope(page, 1.5, -1.0, 0.03, [0.3, 0.3]);
  await page.click('#mn-remeasure');
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 });
  await stopFeed(page);
  check('G3 補正後は本当の傾斜 上り1.5°/左下がり1.0°', /^上り 1\.5°/.test(await txt(page, '#rs-fwd')) && /^左下がり 1\.0°/.test(await txt(page, '#rs-side')), (await txt(page, '#rs-fwd') + ' ' + await txt(page, '#rs-side')).replace(/\n/g, ' '));
  await page.click('#rs-go'); await page.click('#mn-settings');
  await page.locator('#zero-clear').scrollIntoViewIfNeeded(); await page.click('#zero-clear');
  check('G4 補正を消す', /補正なし/.test(await txt(page, '#zero-status')));
  await page.click('#set-close');

  // ===== M. 置き方の設定: 横置き・上側が右 と 縦置き でも正しく読み替える =====
  for (const [key, label, beta, gamma] of [['R', '横置き・上側が右', 1.0, 1.5], ['P', '縦置き', 1.5, -1.0]]) {
    await page.click('#mn-settings'); await page.locator('#orient-chips').scrollIntoViewIfNeeded();
    await page.click(`#orient-chips button[data-v="${key}"]`);
    check(`M ${label}: 選択できる`, (await page.getAttribute(`#orient-chips button[data-v="${key}"]`, 'aria-pressed')) === 'true');
    await page.click('#set-close');
    await feed(page, beta, gamma);            // 端末の生の傾き（置き方ごとに、上り1.5°・左下がり1.0°に相当する値）
    await page.click('#mn-remeasure');
    await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 });
    await stopFeed(page);
    check(`M ${label}: 上り1.5°・左下がり1.0° と読む`, /^上り 1\.5°/.test(await txt(page, '#rs-fwd')) && /^左下がり 1\.0°/.test(await txt(page, '#rs-side')), (await txt(page, '#rs-fwd') + ' ' + await txt(page, '#rs-side')).replace(/\n/g, ' '));
    await page.click('#rs-go');
  }
  await page.reload(); await page.waitForTimeout(300);
  check('M 置き方の設定は保存される（縦置きのまま）', /上側をカップに向ける/.test(await txt(page, '#start-steps')));
  await page.screenshot({ path: shots + '/40-start-portrait.png' });
  await page.click('#mn-settings').catch(() => {});
  await feedSlope(page, 0, 0); await page.click('#btn-measure'); await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 }); await stopFeed(page); await page.click('#rs-go');
  await page.click('#mn-settings'); await page.click('#orient-chips button[data-v="L"]'); await page.click('#set-close');

  // ===== H. 揺れている間は確定しない／平らでないと案内 =====
  await feedSlope(page, 1.0, 0.5, 1.2);      // 大きく揺れる
  await page.click('#mn-remeasure');
  await page.waitForTimeout(4500);
  check('H1 揺れている間は確定しない', await page.locator('#scr-measure').isVisible() && /手を離して/.test(await txt(page, '#ms-hint')), await txt(page, '#ms-hint'));
  await feed(page, 40, 3, 0.02);             // 立てかけている
  await page.waitForTimeout(700);
  check('H2 平らでないときの案内', /平らに置いて/.test(await txt(page, '#ms-hint')), await txt(page, '#ms-hint'));
  await page.click('#ms-cancel');
  check('H3 中止でメインへ戻る', await page.locator('#scr-main').isVisible());
  await stopFeed(page);

  // ===== I. 急傾斜の警告・まっすぐ・フチ狙い =====
  async function manual(f, s, d) {
    await page.click('#mn-settings'); await page.locator('#set-manual').scrollIntoViewIfNeeded(); await page.click('#set-manual');
    await setRange(page, '#mi-fwd', f); await setRange(page, '#mi-side', s); await page.click('#mi-ok'); await page.click('#rs-go');
    if (d) { await page.fill('#dist-num', String(d)); await page.locator('#dist-num').blur(); }
    return (await txt(page, '#call')).replace(/\n/g, ' | ');
  }
  call = await manual(-4, 3, 3);
  check('I1 急傾斜でも計算し、注意を添える', /右に曲がります/.test(call) && /カップ[\d.]+個分左/.test(call) && !/カップの左[\d.]/.test(call) && /傾斜が急です（合計 5\.0°）/.test(call) && (await page.locator('#stroke-block').isVisible()) && /カップに届く強さ/.test(await txt(page, '#st-sub')), call.slice(0, 60) + ' / ' + await txt(page, '#st-cm') + 'cm');
  await page.screenshot({ path: shots + '/12-steep.png', fullPage: true });
  call = await manual(0, 0, 3);
  check('I2 平坦 → ほぼまっすぐ・中心狙い', /ほぼまっすぐ/.test(call) && /カップの中心を狙う/.test(call), call);
  check('I3 平坦3yd → 21cm', (await txt(page, '#st-cm')) === '21', await txt(page, '#st-cm'));
  await page.screenshot({ path: shots + '/13-flat.png', fullPage: true });
  call = await manual(0, 1, 1);
  check('I4 1yd・右下がり1° → 左フチ', /カップ[\d.]+個分左/.test(call) && !/カップの左[\d.]/.test(call) && /0\.5/.test(call) && /左フチ/.test(call), call);
  await page.screenshot({ path: shots + '/14-1yd.png', fullPage: true });
  // 19.5yd の数字が欠けずに入る（実機で「19.!」に見えた不具合）
  await page.fill('#dist-num', '19.5'); await page.locator('#dist-num').blur();
  const fit = await page.evaluate(() => { const e = document.querySelector('#dist-num'); return [e.scrollWidth, e.clientWidth]; });
  check('I4b 19.5 が入力欄に収まる', fit[0] <= fit[1], fit.join(' <= '));
  call = await manual(-1.5, 2, 20);
  check('I5 20yd でも表示が崩れない', (await overflow(page)) <= 0, call + ' / ' + await txt(page, '#st-cm') + 'cm');
  await page.screenshot({ path: shots + '/15-20yd.png', fullPage: true });
  // ===== L. 実機で出たケース: 上り8.6°・右下がり3.4°・19.5yd（センサー測定で再現）=====
  await feedSlope(page, 8.6, 3.4, 0.03);
  await page.click('#mn-remeasure');
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 });
  await stopFeed(page);
  check('L1 測定値 上り8.6°/右下がり3.4°', /^上り 8\.6°/.test(await txt(page, '#rs-fwd')) && /^右下がり 3\.4°/.test(await txt(page, '#rs-side')));
  await page.click('#rs-go');
  await page.fill('#dist-num', '19.5'); await page.locator('#dist-num').blur();
  call = (await txt(page, '#call')).replace(/\n/g, ' | ');
  check('L2 計算結果が出る（右に曲がる・カップの左）', /右に曲がります/.test(call) && /カップ[\d.]+個分左/.test(call) && !/カップの左[\d.]/.test(call) && !/求められません/.test(call), call.slice(0, 70));
  check('L3 振り幅が出る', (await page.locator('#stroke-block').isVisible()) && +(await txt(page, '#st-cm')) > 60, await txt(page, '#st-cm') + 'cm / ' + (await txt(page, '#st-sub')).replace(/\n/g, ' '));
  check('L4 急傾斜の注意が出る', /傾斜が急です（合計 9\.2°）/.test(call));
  check('L5 横はみ出しなし', (await overflow(page)) <= 0);
  await page.screenshot({ path: shots + '/30-steep-up.png', fullPage: true });
  // 下りが急すぎる: 最小限のタッチとして表示
  await feedSlope(page, -9, 0, 0.03);
  await page.click('#mn-remeasure');
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 });
  await stopFeed(page);
  await page.click('#rs-go'); await page.click('#dist-chips button[data-v="3"]');
  call = (await txt(page, '#call')).replace(/\n/g, ' | ');
  check('L6 急な下り: 最小限のタッチと注意', /下りが急です/.test(call) && (await txt(page, '#st-cm')) === '1' && /最小限のタッチ/.test(await txt(page, '#st-sub')), call.slice(0, 60));
  await page.screenshot({ path: shots + '/31-steep-down.png', fullPage: true });
  await page.close();

  // ===== N. 常に横画面: 縦持ちでは90°回して表示、横持ちはそのまま =====
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage(); await pg.goto(URL); await pg.waitForTimeout(300);
    const rot = await pg.evaluate(() => ({ cls: document.documentElement.classList.contains('rot'), tf: getComputedStyle(document.getElementById('root')).transform, rw: getComputedStyle(document.documentElement).getPropertyValue('--rw').trim(), r: document.getElementById('root').getBoundingClientRect().toJSON() }));
    check('N1 縦持ち: 画面全体が90°回って横画面になる', rot.cls && rot.tf !== 'none' && rot.rw === '844px' && Math.round(rot.r.width) === 390 && Math.round(rot.r.height) === 844, JSON.stringify(rot));
    const st = await pg.locator('#start-steps').boundingBox(), bt = await pg.locator('#btn-measure').boundingBox();
    check('N2 縦持ち: 2列レイアウト（手順が上側＝横画面の左、ボタンが下側＝右）', st && bt && bt.y > st.y + st.height - 1 && !(await pg.locator('#start-illust').isVisible()) && (await pg.locator('#start-illust-l').isVisible()), JSON.stringify([st && Math.round(st.y), bt && Math.round(bt.y)]));
    await pg.click('#btn-manual'); await pg.click('#mi-ok'); await pg.click('#rs-go'); await pg.waitForTimeout(200);
    await pg.locator('#metro-btn').scrollIntoViewIfNeeded(); await pg.click('#metro-btn');
    check('N3 縦持ち: 回した画面でもスクロールと操作ができる', (await txt(pg, '#metro-btn')) === '停止する' && (await pg.evaluate(() => document.getElementById('root').scrollTop)) > 0);
    await pg.click('#metro-btn');
    await pg.click('#mn-settings'); await pg.waitForTimeout(200);
    const sh = await pg.locator('#sheet-settings').boundingBox();
    check('N4 縦持ち: 設定シートも回った画面いっぱいに出る', sh && Math.round(sh.width) === 390 && Math.round(sh.height) === 844, JSON.stringify(sh));
    await pg.click('#set-close');
    await pg.screenshot({ path: shots + '/50-portrait-rotated.png' });
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const lp = await ctx2.newPage(); await lp.goto(URL); await lp.waitForTimeout(300);
    check('N5 横持ち: 回さない', !(await lp.evaluate(() => document.documentElement.classList.contains('rot'))));
    const box = async (sel) => await lp.locator(sel).boundingBox();
    const st2 = await box('#start-steps'), il = await box('#start-illust-l'), bt2 = await box('#btn-measure');
    check('N6 スタート: 左に手順、右に図とボタン', il.x > st2.x + st2.width - 1 && bt2.x > st2.x + st2.width - 1);
    await lp.click('#btn-manual'); await lp.click('#mi-ok'); await lp.click('#rs-go'); await lp.waitForTimeout(200);
    const d = await box('#dist-range'), ln = await box('#line-view'), sk = await box('#stroke-block'), mt = await box('#metro-stage'), bb = await box('#beats');
    check('N7 メイン: 左に距離と振り幅、右にライン、下にメトロノーム2列', ln.x > d.x + d.width - 1 && Math.abs(sk.x - d.x) < 2 && sk.y > d.y && mt.y > sk.y && bb.x > mt.x + mt.width - 1);
    check('N8 ライン図は横画面の高さに収まる', ln.height <= 390 * 0.9, Math.round(ln.height) + 'px');
    await lp.click('#mn-remeasure'); await lp.waitForTimeout(600);
    const cb = await box('#ms-cancel'), mi = await box('#ms-illust-l');
    check('N9 測定: 中止ボタンは右の列', cb && mi && cb.x >= mi.x - 1);
    await ctx2.close();
  }

  // ===== J. 画面サイズ違い =====
  for (const [w, h] of [[320, 568], [360, 740], [430, 932], [768, 1024], [667, 375], [844, 390], [932, 430], [1024, 768]]) {
    page = await newPage(w, h);
    const ov = [await overflow(page)];
    const ctaBottom = await page.evaluate(() => document.querySelector('#btn-measure').getBoundingClientRect().bottom);
    await page.screenshot({ path: `${shots}/20-start-${w}.png`, fullPage: true });
    await feedSlope(page, -2.2, 1.4);
    await page.click('#btn-measure');
    await page.waitForTimeout(900); ov.push(await overflow(page));
    await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 }); ov.push(await overflow(page));
    await stopFeed(page);
    await page.screenshot({ path: `${shots}/21-result-${w}.png`, fullPage: true });
    await page.click('#rs-go'); await page.click('#dist-chips button[data-v="7"]'); ov.push(await overflow(page));
    await page.screenshot({ path: `${shots}/22-main-${w}.png`, fullPage: true });
    await page.click('#mn-settings'); ov.push(await overflow(page));
    await page.screenshot({ path: `${shots}/23-settings-${w}.png`, fullPage: false });
    // 文字のはみ出し（切れ）検査
    const clipped = await page.evaluate(() => [...document.querySelectorAll('button, .chip, .val, .lab b, .status, .cal-grid span')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.className + ':' + e.textContent.slice(0, 12)));
    await page.click('#set-close');
    // 1行のはずの要素が折り返していないか
    const wrapped = await page.evaluate(() => [...document.querySelectorAll('#scr-main .brand, #scr-main .btn-volt, .phases span, .slopebar .val, .call-aim, .chip')].filter(e => e.offsetParent).filter(e => { const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; const kids = e.querySelector('small') ? 2 : 1; return e.getClientRects().length > 1 || e.offsetHeight > Math.max(lh * kids * 1.9, e.classList.contains('call-aim') ? 100 : 80); }).map(e => e.className + ':' + e.textContent.slice(0, 10)));
    if (wrapped.length) clipped.push('WRAP ' + wrapped.join('|'));
    check(`J ${w}x${h} 横はみ出しなし・文字切れなし`, ov.every(v => v <= 0) && clipped.length === 0, 'overflow ' + ov.join(',') + (clipped.length ? ' clipped ' + clipped.join('|') : '') + ' / 開始ボタン下端 ' + Math.round(ctaBottom) + 'px');
    await page.close();
  }

  // ===== K. 別オリジンに埋め込まれた状態（公開プレビューと同じ条件）: センサー禁止 → すぐ手動入力へ =====
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const host = await ctx.newPage();
    await host.goto('http://127.0.0.1:8765/host.html');
    const fr = host.frameLocator('iframe');
    await fr.locator('#btn-measure').click();
    const t0 = Date.now();
    await fr.locator('#sheet-manual:not([hidden])').waitFor({ timeout: 5000 });
    const msg = await fr.locator('#mi-msg').innerText();
    check('K1 埋め込み時は手動入力に切り替わり、理由を表示', /プレビュー画面では傾きセンサーを使えません/.test(msg), (Date.now() - t0) + 'ms: ' + msg);
    await fr.locator('#mi-ok').click(); await fr.locator('#rs-go').click();
    check('K2 埋め込みでも計算画面まで進める', await fr.locator('#st-cm').isVisible());
    await fr.locator('#metro-btn').click(); await host.waitForTimeout(800);
    check('K3 埋め込みでもメトロノームが動く', (await fr.locator('#metro-btn').innerText()) === '停止する');
    await ctx.close();
  }

  check('Z コンソールエラーなし', errors.length === 0, errors.join(' || '));
  await browser.close();
  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} passed` + (fail.length ? '  FAILED: ' + fail.map(f => f.name).join(' ; ') : ''));
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
