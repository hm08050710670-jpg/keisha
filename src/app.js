/* GOLF GUTS PUTT LAB — 画面・センサー・メトロノーム */
(function () {
  'use strict';

  var P = PuttPhysics, YD = P.YD, DEG = Math.PI / 180;
  var $ = function (id) { return document.getElementById(id); };
  var C = {
    chalk: '#f3f7ee', dim: '#abc3b1', faint: '#7a9a85', volt: '#e4ff1a', ink: '#131f06', pin: '#ff5b3a',
    t950: '#05150d', t900: '#0a2417', t800: '#0f3321', t700: '#16442d', t600: '#21603f', t500: '#2f7d52'
  };

  /* ---------- 保存（端末内のみ。使えない環境でも動く） ---------- */
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('ggpl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('ggpl.' + k, JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ } }
  };

  var CAL_CM = [10, 20, 30];
  var state = {
    slope: null,                                   // {fwd, side, source:'sensor'|'manual'}
    dist: clamp(Number(store.get('dist', 3)) || 3, 0.5, 20),
    stimp: clamp(Number(store.get('stimp', 9)) || 9, 7, 13),
    cal: sanitizeCal(store.get('cal', [])),
    zero: sanitizeZero(store.get('zero', null)),
    strokeCm: 21
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function sanitizeCal(c) {
    if (!Array.isArray(c)) return [];
    return c.filter(function (p) { return p && p.cm > 0 && Array.isArray(p.yd); })
      .map(function (p) { return { cm: +p.cm, yd: p.yd.map(Number).filter(function (d) { return d > 0 && d < 60; }), stimp: +p.stimp || 9 }; })
      .filter(function (p) { return p.yd.length; });
  }
  function sanitizeZero(z) {
    return (z && isFinite(z.fwd) && isFinite(z.side)) ? { fwd: +z.fwd, side: +z.side } : null;
  }

  /* ---------- 表示用の言葉 ---------- */
  var FLAT = 0.2; // これ未満は「ほぼ平坦」
  function fwdText(f) { return Math.abs(f) < FLAT ? 'ほぼ平坦' : (f > 0 ? '上り ' : '下り ') + Math.abs(f).toFixed(1) + '°'; }
  function sideText(s) { return Math.abs(s) < FLAT ? 'ほぼ平坦' : (s > 0 ? '右下がり ' : '左下がり ') + Math.abs(s).toFixed(1) + '°'; }
  function pct(a) { return (Math.tan(Math.abs(a) * DEG) * 100).toFixed(1) + '%'; }
  function totalSlope(sl) { return Math.atan(Math.sqrt(Math.pow(Math.tan(sl.fwd * DEG), 2) + Math.pow(Math.tan(sl.side * DEG), 2))) / DEG; }
  function strength(t) { return t < 0.3 ? 'ほぼ平坦' : t < 2 ? '緩やか' : t < 3.5 ? '中くらい' : '強い'; }
  function half(v) { return Math.round(v * 2) / 2; }
  function numTxt(v) { return (Math.round(v * 10) / 10).toString(); }
  function lenTxt(m) { return m >= 1 ? (Math.round(m * 10) / 10) + 'm' : Math.round(m * 100) + 'cm'; }

  /* ---------- 画面切り替え ---------- */
  var SCREENS = ['scr-start', 'scr-measure', 'scr-result', 'scr-main'];
  function show(id) {
    SCREENS.forEach(function (s) { $(s).hidden = s !== id; });
    if (id !== 'scr-main') Metro.stop();
    $('toast').hidden = true;
    window.scrollTo(0, 0);
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* =====================================================================
     立体イラスト（傾いたグリーンの板）
     ===================================================================== */
  function plateSVG(o) {
    var W = 340, H = 240, S = 96, cx = 164, cy = 114, yaw = -22 * DEG, el = 33 * DEG;
    var tf = Math.tan((o.fwd || 0) * DEG), ts = Math.tan((o.side || 0) * DEG);
    var k = Math.min(10, 0.36 / Math.max(1e-6, Math.abs(tf) + Math.abs(ts))); // 高さの強調（最大10倍）
    var cyw = Math.cos(yaw), syw = Math.sin(yaw), sel = Math.sin(el), cel = Math.cos(el), ZB = -0.56;
    function z(x, y) { return k * (y * tf - x * ts); }
    var minY = 1e9, maxY = -1e9;
    function pr(x, y, zz) {
      var xr = x * cyw - y * syw, yr = x * syw + y * cyw, sy = cy - (yr * sel + zz * cel) * S;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      return [cx + xr * S, sy];
    }
    function on(x, y, dz) { return pr(x, y, z(x, y) + (dz || 0)); }
    function pts(a) { return a.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
    function rrect(x0, y0, hw, hl, r, dz) {
      var out = [], cs = [[x0 + hw - r, y0 + hl - r, 0], [x0 - hw + r, y0 + hl - r, 90], [x0 - hw + r, y0 - hl + r, 180], [x0 + hw - r, y0 - hl + r, 270]];
      cs.forEach(function (c) {
        for (var i = 0; i <= 6; i++) { var a = (c[2] + i * 15) * DEG; out.push(on(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), dz)); }
      });
      return out;
    }
    var A = [-1, -1], B = [1, -1], Cc = [1, 1], D = [-1, 1], s = '';
    s += '<defs><linearGradient id="' + o.id + 'g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + C.t500 + '"/><stop offset="1" stop-color="' + C.t600 + '"/></linearGradient></defs>';
    // 側面（手前・右）
    s += '<polygon points="' + pts([on(A[0], A[1]), on(B[0], B[1]), pr(B[0], B[1], ZB), pr(A[0], A[1], ZB)]) + '" fill="' + C.t950 + '"/>';
    s += '<polygon points="' + pts([on(B[0], B[1]), on(Cc[0], Cc[1]), pr(Cc[0], Cc[1], ZB), pr(B[0], B[1], ZB)]) + '" fill="#081c12"/>';
    // 上面
    s += '<polygon points="' + pts([on(A[0], A[1]), on(B[0], B[1]), on(Cc[0], Cc[1]), on(D[0], D[1])]) + '" fill="url(#' + o.id + 'g)" stroke="' + C.chalk + '" stroke-opacity=".5" stroke-width="1.2" stroke-linejoin="round"/>';
    [-0.5, 0, 0.5].forEach(function (t) {
      var a = on(t, -1), b = on(t, 1), c = on(-1, t), d = on(1, t);
      s += '<path d="M' + pts([a]) + 'L' + pts([b]) + 'M' + pts([c]) + 'L' + pts([d]) + '" stroke="' + C.chalk + '" stroke-opacity=".13" stroke-width="1" fill="none"/>';
    });
    // 測定中の波紋
    if (o.pulse) {
      var ring = [];
      for (var i = 0; i < 36; i++) ring.push(on(0.78 * Math.cos(i * 10 * DEG), -0.12 + 0.78 * Math.sin(i * 10 * DEG)));
      s += '<polygon class="pulse" points="' + pts(ring) + '" fill="none" stroke="' + C.volt + '" stroke-width="2.5"/>';
    }
    // カップと旗
    var cyc = 0.62, cup = [];
    for (var j = 0; j < 24; j++) cup.push(on(0.085 * Math.cos(j * 15 * DEG), cyc + 0.085 * Math.sin(j * 15 * DEG)));
    var base = on(0, cyc), top = on(0, cyc, 0.62);
    s += '<polygon points="' + pts(cup) + '" fill="' + C.t950 + '" stroke="' + C.chalk + '" stroke-opacity=".7" stroke-width="1"/>';
    s += '<line x1="' + base[0] + '" y1="' + base[1] + '" x2="' + top[0] + '" y2="' + top[1] + '" stroke="' + C.chalk + '" stroke-width="2" stroke-linecap="round"/>';
    s += '<polygon points="' + pts([top, [top[0] + 27, top[1] + 9], [top[0], top[1] + 18]]) + '" fill="' + C.pin + '"/>';
    s += '<text x="' + (top[0] + 32) + '" y="' + (top[1] + 14) + '" font-size="12" font-weight="700" fill="' + C.chalk + '">カップ</text>';

    if (o.phone) {
      // スマホ（上側がカップ向き）
      var py = -0.2;
      s += '<polygon points="' + pts(rrect(0, py, 0.215, 0.43, 0.07, 0)) + '" fill="#020705" opacity=".55" transform="translate(3,4)"/>';
      s += '<polygon points="' + pts(rrect(0, py, 0.215, 0.43, 0.07, 0.045)) + '" fill="#0c100e" stroke="' + C.chalk + '" stroke-width="1.6" stroke-linejoin="round"/>';
      s += '<polygon points="' + pts(rrect(0, py, 0.18, 0.395, 0.05, 0.047)) + '" fill="' + C.t800 + '" stroke="' + C.chalk + '" stroke-opacity=".25" stroke-width="1"/>';
      s += '<polygon points="' + pts(rrect(0, py + 0.345, 0.05, 0.012, 0.011, 0.048)) + '" fill="' + C.chalk + '" opacity=".7"/>';
      s += '<polygon points="' + pts([on(0, py + 0.27, 0.048), on(-0.085, py + 0.1, 0.048), on(0.085, py + 0.1, 0.048)]) + '" fill="' + C.volt + '"/>';
      s += '<polygon points="' + pts(rrect(0, py - 0.1, 0.022, 0.16, 0.02, 0.048)) + '" fill="' + C.volt + '"/>';
      // スマホ上側 → カップ の矢印
      var a0 = on(0, py + 0.49), a1 = on(0, cyc - 0.16), hd = arrowHead(a0, a1, 9);
      s += '<line x1="' + a0[0] + '" y1="' + a0[1] + '" x2="' + a1[0] + '" y2="' + a1[1] + '" stroke="' + C.volt + '" stroke-width="3" stroke-dasharray="5 5" stroke-linecap="round"/>';
      s += '<polygon points="' + pts(hd) + '" fill="' + C.volt + '"/>';
      if (o.labels) {
        var lp = on(0.3, py + 0.36, 0.05);
        s += '<text x="' + (lp[0] + 4) + '" y="' + (lp[1] + 4) + '" font-size="12" font-weight="700" fill="' + C.volt + '">スマホの上側</text>';
      }
    } else {
      // ボール
      var bs = on(0, -0.62), bp = on(0, -0.62, 0.07);
      s += '<ellipse cx="' + (bs[0] + 2) + '" cy="' + (bs[1] + 1) + '" rx="9" ry="4" fill="#020705" opacity=".45"/>';
      s += '<circle cx="' + bp[0] + '" cy="' + bp[1] + '" r="7.5" fill="' + C.chalk + '"/>';
    }

    // 低い方を示す矢印
    var mag = Math.sqrt(tf * tf + ts * ts);
    if (o.arrow && mag > Math.tan(FLAT * DEG)) {
      var dx = ts / mag, dy = -tf / mag, ox = o.phone ? 0.62 : 0, oy = 0, L = o.phone ? 0.3 : 0.4;
      var t0 = on(ox - dx * L, oy - dy * L, 0.01), t1 = on(ox + dx * L, oy + dy * L, 0.01), h2 = arrowHead(t0, t1, 13);
      s += '<line x1="' + t0[0] + '" y1="' + t0[1] + '" x2="' + t1[0] + '" y2="' + t1[1] + '" stroke="' + C.volt + '" stroke-width="6" stroke-linecap="round"/>';
      s += '<polygon points="' + pts(h2) + '" fill="' + C.volt + '"/>';
      var right = t1[0] >= t0[0], lx = clamp(h2[0][0] + (right ? 8 : -8), right ? 6 : 50, right ? W - 50 : W - 6), ly = h2[0][1] + (t1[1] >= t0[1] ? 16 : -8);
      s += '<text x="' + lx + '" y="' + ly + '" text-anchor="' + (right ? 'start' : 'end') + '" font-size="13" font-weight="900" fill="' + C.volt + '" stroke="' + C.t900 + '" stroke-width="3.5" paint-order="stroke">低い方</text>';
    }
    s += '</svg>';
    var y0 = o.fixed ? 0 : Math.floor(minY - 8), vh = o.fixed ? H : Math.ceil(maxY + 8) - y0;
    return '<svg viewBox="0 ' + y0 + ' ' + W + ' ' + vh + '" xmlns="http://www.w3.org/2000/svg">' + s;
  }
  /** 線分 a→b の先に矢じりを付ける（先端, 左, 右） */
  function arrowHead(a, b, size) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1; dx /= len; dy /= len;
    var tip = [b[0] + dx * size, b[1] + dy * size];
    return [tip, [b[0] - dy * size * 0.75, b[1] + dx * size * 0.75], [b[0] + dy * size * 0.75, b[1] - dx * size * 0.75]];
  }

  /* =====================================================================
     センサー（DeviceOrientation）
     beta  > 0 … 端末の上側が持ち上がる ＝ カップに向かって上り
     gamma > 0 … 端末の右側が下がる     ＝ 右下がり
     ===================================================================== */
  var Sensor = {
    on: false, last: null, lastT: 0, acc: { f: 0, s: 0, n: 0 },
    handler: function (e) {
      if (e.beta == null || e.gamma == null) return;
      var b = e.beta * DEG, g = e.gamma * DEG;
      Sensor.last = {
        fwd: e.beta,
        side: Math.asin(clamp(Math.cos(b) * Math.sin(g), -1, 1)) / DEG, // 右辺が水平から下がっている角度
        faceUp: Math.abs(e.beta) < 90
      };
      Sensor.acc.f += Sensor.last.fwd; Sensor.acc.s += Sensor.last.side; Sensor.acc.n++;
      Sensor.lastT = Date.now();
    },
    /** 前回の呼び出し以降に届いた値の平均（ノイズを減らす） */
    take: function () {
      var a = Sensor.acc, out = a.n ? { fwd: a.f / a.n, side: a.s / a.n } : null;
      Sensor.acc = { f: 0, s: 0, n: 0 };
      return out;
    },
    /** タップ操作の中から呼ぶこと（iOS は許可ダイアログが必要） */
    enable: function () {
      if (Sensor.on && Date.now() - Sensor.lastT < 1500) return Promise.resolve('ok');
      if (typeof window.DeviceOrientationEvent === 'undefined') return Promise.resolve('unsupported');
      try { // 埋め込み表示などでセンサーが禁止されている場合は、待たずに手動入力へ
        var fp = document.featurePolicy || document.permissionsPolicy;
        if (fp && fp.allowsFeature && (!fp.allowsFeature('accelerometer') || !fp.allowsFeature('gyroscope'))) return Promise.resolve('blocked');
      } catch (e) { /* 判定できなければ通常どおり試す */ }
      var ask = Promise.resolve('granted');
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { ask = DeviceOrientationEvent.requestPermission(); } catch (e) { ask = Promise.resolve('blocked'); }
      }
      return ask.then(function (res) {
        if (res !== 'granted') return res === 'denied' ? 'denied' : 'blocked';
        if (!Sensor.on) { window.addEventListener('deviceorientation', Sensor.handler); Sensor.on = true; }
        Sensor.last = null;
        return new Promise(function (resolve) {
          var t0 = Date.now(), iv = setInterval(function () {
            if (Sensor.last) { clearInterval(iv); resolve('ok'); }
            else if (Date.now() - t0 > 2500) { clearInterval(iv); resolve('noevents'); }
          }, 80);
        });
      }, function () { return 'blocked'; });
    }
  };
  var EMBED = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  function sensorMsg(res) {
    if (EMBED && res !== 'denied') return 'このプレビュー画面では傾きセンサーを使えません（HTMLファイルを https のサイトに置いて開くと使えます）。';
    return SENSOR_MSG[res];
  }
  var SENSOR_MSG = {
    unsupported: 'このブラウザは傾きセンサーに対応していません。',
    denied: 'センサーの利用が許可されませんでした。ブラウザを開き直すと、もう一度許可を選べます。',
    blocked: 'この表示環境では傾きセンサーを使えません。',
    noevents: 'センサーの値を受け取れませんでした。https で開いているか、センサー付きのスマホかを確認してください。'
  };

  /* ---------- 測定（平滑化 → 安定判定 → 確定） ---------- */
  var HOLD_MS = 2500, WINDOW_MS = 1000, STABLE_RANGE = 0.4, MAX_TILT = 15, TIMEOUT_MS = 30000;
  var Measure = { timer: null, mode: 'slope', first: null };

  function startMeasure(mode) {
    Measure.mode = mode;
    $('ms-mode').textContent = mode === 'slope' ? '傾斜を測定' : (mode === 'zero1' ? 'ゼロ点補正 1/2' : 'ゼロ点補正 2/2');
    $('ms-next').hidden = true; $('ms-manual').hidden = true;
    $('ms-title').innerHTML = '準備中<span class="dots"></span>';
    $('ms-hint').textContent = 'センサーを確認しています。';
    $('ms-fwd').textContent = '—'; $('ms-side').textContent = '—';
    setProgress(0);
    $('ms-illust').innerHTML = plateSVG({ id: 'ms', phone: true, pulse: true, fixed: true });
    show('scr-measure');
    Sensor.enable().then(function (res) {
      if ($('scr-measure').hidden) return;
      if (res !== 'ok') return sensorFailed(res);
      runMeasure();
    });
  }

  function sensorFailed(res) {
    stopMeasure();
    if (Measure.mode !== 'slope') {
      show(state.slope ? 'scr-main' : 'scr-start');
      toast(sensorMsg(res) + ' ゼロ点補正はセンサーが使えるときに行ってください。');
      return;
    }
    show(state.slope ? 'scr-main' : 'scr-start');
    openManual(sensorMsg(res) + ' 傾斜を手動で入力してください。');
  }

  function setProgress(p) {
    $('ms-bar').style.width = Math.round(p * 100) + '%';
    $('ms-prog').setAttribute('aria-valuenow', Math.round(p * 100));
  }
  function stopMeasure() { clearInterval(Measure.timer); Measure.timer = null; releaseWake(); }

  function runMeasure() {
    var buf = [], ema = null, stableSince = 0, started = Date.now(), lastDraw = 0;
    var raw = Measure.mode !== 'slope'; // ゼロ点補正中は補正前の値を使う
    $('ms-title').innerHTML = '測定中<span class="dots"></span>';
    Sensor.take();
    requestWake();
    clearInterval(Measure.timer);
    Measure.timer = setInterval(function () {
      var now = Date.now(), cur = Sensor.last;
      if (!cur || now - Sensor.lastT > 1500) { $('ms-hint').textContent = 'センサーの値を待っています。'; return; }
      var avg = Sensor.take() || cur;
      var f = avg.fwd - (raw || !state.zero ? 0 : state.zero.fwd), s = avg.side - (raw || !state.zero ? 0 : state.zero.side);
      buf.push({ t: now, f: f, s: s });
      while (buf.length && now - buf[0].t > HOLD_MS + 500) buf.shift();
      ema = ema ? { f: ema.f + (f - ema.f) * 0.25, s: ema.s + (s - ema.s) * 0.25 } : { f: f, s: s }; // 表示用の平滑化
      $('ms-fwd').textContent = fwdText(ema.f); $('ms-side').textContent = sideText(ema.s);
      if (now - lastDraw > 180) {
        lastDraw = now;
        $('ms-illust').innerHTML = plateSVG({ id: 'ms', fwd: clamp(ema.f, -8, 8), side: clamp(ema.s, -8, 8), phone: true, pulse: true, fixed: true });
      }

      var flat = cur.faceUp && Math.abs(f) < MAX_TILT && Math.abs(s) < MAX_TILT;
      var win = buf.filter(function (b) { return now - b.t <= WINDOW_MS; });
      var stable = flat && win.length >= 6 && range(win, 'f') < STABLE_RANGE && range(win, 's') < STABLE_RANGE;
      if (!stable) {
        stableSince = 0; setProgress(0);
        $('ms-hint').textContent = !flat ? '画面を上にして、平らに置いてください。' : 'スマホを置いて、手を離してください。';
      } else {
        if (!stableSince) stableSince = now - WINDOW_MS / 2;
        var p = clamp((now - stableSince) / HOLD_MS, 0, 1);
        setProgress(p);
        $('ms-hint').textContent = 'そのまま動かさないでください。';
        if (p >= 1) {
          var hold = buf.filter(function (b) { return b.t >= stableSince; });
          if (range(hold, 'f') < STABLE_RANGE * 1.5 && range(hold, 's') < STABLE_RANGE * 1.5) {
            stopMeasure();
            return finishMeasure({ fwd: mean(hold, 'f'), side: mean(hold, 's') });
          }
          stableSince = 0;
        }
      }
      if (now - started > TIMEOUT_MS) {
        stopMeasure();
        $('ms-title').textContent = '安定しませんでした';
        $('ms-hint').textContent = 'スマホが揺れています。平らな場所に置き直して、もう一度お試しください。';
        $('ms-next').hidden = false; $('ms-next').firstChild.textContent = 'もう一度測定する ';
        $('ms-next').onclick = function () { startMeasure(Measure.mode); };
        $('ms-manual').hidden = Measure.mode !== 'slope';
      }
    }, 100);
  }
  function range(a, k) { var lo = Infinity, hi = -Infinity; a.forEach(function (v) { if (v[k] < lo) lo = v[k]; if (v[k] > hi) hi = v[k]; }); return hi - lo; }
  function mean(a, k) { return a.reduce(function (s, v) { return s + v[k]; }, 0) / a.length; }

  function finishMeasure(m) {
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* 無くてもよい */ } }
    if (Measure.mode === 'slope') {
      setSlope(r1(m.fwd), r1(m.side), 'sensor');
      return;
    }
    if (Measure.mode === 'zero1') {
      Measure.first = m;
      setProgress(1);
      $('ms-title').textContent = '1回目が終わりました';
      $('ms-hint').textContent = '同じ場所で、スマホを180°回して置き直してください。';
      $('ms-next').hidden = false; $('ms-next').firstChild.textContent = '置き直したら次へ ';
      $('ms-next').onclick = function () { startMeasure('zero2'); };
      return;
    }
    // 180°回すと本当の傾斜は符号が反転し、端末固有のズレだけが残る
    state.zero = { fwd: (Measure.first.fwd + m.fwd) / 2, side: (Measure.first.side + m.side) / 2 };
    store.set('zero', state.zero);
    renderSettings();
    show(state.slope ? 'scr-main' : 'scr-start');
    toast('ゼロ点補正を保存しました。次の測定から反映されます。');
  }

  var wake = null;
  function requestWake() {
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () { }); } catch (e) { /* 任意機能 */ }
  }
  function releaseWake() { try { if (wake) { wake.release(); wake = null; } } catch (e) { /* 任意機能 */ } }

  /* ---------- 測定完了 ---------- */
  function setSlope(fwd, side, source) {
    state.slope = { fwd: fwd, side: side, source: source };
    var tot = totalSlope(state.slope);
    $('rs-eyebrow').textContent = source === 'sensor' ? '測定完了！' : '手動入力';
    $('rs-title').innerHTML = source === 'sensor' ? '傾斜の測定が<br>完了しました！' : '傾斜を<br>設定しました';
    $('rs-illust').innerHTML = plateSVG({ id: 'rs', fwd: fwd, side: side, arrow: true });
    $('rs-illust').setAttribute('aria-label', 'グリーンの傾き：前後は' + fwdText(fwd) + '、左右は' + sideText(side));
    $('rs-fwd').innerHTML = fwdText(fwd) + (Math.abs(fwd) >= FLAT ? '<small>勾配 ' + pct(fwd) + '</small>' : '');
    $('rs-side').innerHTML = sideText(side) + (Math.abs(side) >= FLAT ? '<small>勾配 ' + pct(side) + '</small>' : '');
    $('rs-strength').innerHTML = strength(tot) + '<small>合計 ' + tot.toFixed(1) + '°</small>';
    show('scr-result');
  }

  /* ---------- 手動入力 ---------- */
  function openManual(msg) {
    $('mi-msg').textContent = msg || 'カップに向かって立ったときの傾斜を入力します。';
    $('mi-fwd').value = state.slope ? state.slope.fwd : 0;
    $('mi-side').value = state.slope ? state.slope.side : 0;
    renderManual();
    $('sheet-settings').hidden = true;
    $('sheet-manual').hidden = false;
    $('sheet-manual').scrollTop = 0;
  }
  function renderManual() {
    var f = +$('mi-fwd').value, s = +$('mi-side').value;
    $('mi-fwd-out').textContent = fwdText(f); $('mi-side-out').textContent = sideText(s);
    $('mi-illust').innerHTML = plateSVG({ id: 'mi', fwd: f, side: s, arrow: true });
  }

  /* =====================================================================
     メイン画面
     ===================================================================== */
  var DIST_CHIPS = [1, 2, 3, 5, 7, 10];
  function setDist(v, from) {
    if (!isFinite(v)) return;
    state.dist = clamp(Math.round(v * 10) / 10, 0.5, 20);
    store.set('dist', state.dist);
    if (from !== 'num') $('dist-num').value = numTxt(state.dist);
    if (from !== 'range') $('dist-range').value = state.dist;
    renderMain();
  }

  function renderMain() {
    var sl = state.slope; if (!sl) return;
    $('mn-src').textContent = sl.source === 'sensor' ? '測定した傾斜' : '手動で入力した傾斜';
    $('mn-fwd').textContent = Math.abs(sl.fwd) < FLAT ? '前後 ほぼ平坦' : fwdText(sl.fwd);
    $('mn-side').textContent = Math.abs(sl.side) < FLAT ? '左右 ほぼ平坦' : sideText(sl.side);
    $('dist-m').textContent = '約' + (state.dist * YD).toFixed(1) + 'm';
    Array.prototype.forEach.call($('dist-chips').children, function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.v === state.dist));
    });

    var D = state.dist * YD, sol = P.solve(D, sl.fwd, sl.side, state.stimp);
    if (!sol.ok) {
      $('line-view').innerHTML = lineSVG(null, sl, D).svg;
      $('line-scale').hidden = true;
      $('call').innerHTML = '<p class="warn">この条件（合計 ' + totalSlope(sl).toFixed(1) + '°・' + numTxt(state.dist) + 'yd）では、カップに届くラインを求められませんでした。傾斜を測り直すか、距離を確認してください。</p>';
      $('stroke-block').hidden = true;
      return;
    }
    $('stroke-block').hidden = false;

    // ライン
    var lv = lineSVG(sol, sl, D);
    $('line-view').innerHTML = lv.svg;
    $('line-scale').hidden = lv.k === 1;
    $('line-scale').textContent = lv.k > 1 ? '※ 図は横方向を約' + numTxt(lv.k) + '倍に強調しています' : '※ 図は横方向を縮めています';

    // 曲がる方向と狙い（カップ中心基準）。曲がる方向と狙う方向は逆になる
    var cups = sol.cups >= 10 ? Math.round(sol.cups) : half(sol.cups), html = '';
    if (cups < 0.5) {
      html += '<p class="call-break">' + curveIcon(0) + 'ほぼまっすぐ</p>';
      html += '<p class="call-aim">カップの中心を狙う</p>';
      html += '<p class="call-sub">' + (Math.abs(sol.aim) < 0.005 ? '傾斜による曲がりはほとんどありません。' : '曲がりは約' + lenTxt(Math.abs(sol.aim)) + 'で、カップの幅に収まる見込みです。') + '</p>';
      $('line-view').setAttribute('aria-label', 'ほぼまっすぐ。カップの中心を狙う');
    } else {
      var brk = sol.aim > 0 ? '左' : '右', aimSide = sol.aim > 0 ? '右' : '左';
      html += '<p class="call-break">' + curveIcon(sol.aim > 0 ? -1 : 1) + brk + 'に曲がります</p>';
      html += '<p class="call-aim' + (numTxt(cups).length > 3 ? ' long' : '') + '">カップの' + aimSide + '<b>' + numTxt(cups) + '</b>個分</p>';
      html += '<p class="call-sub">' + (cups === 0.5 ? 'カップの' + aimSide + 'フチが目安です（中心から' + aimSide + 'へ ' + lenTxt(Math.abs(sol.aim)) + '・推定）' : 'カップの中心から' + aimSide + 'へ ' + lenTxt(Math.abs(sol.aim)) + ' を狙う（推定）') + '</p>';
      $('line-view').setAttribute('aria-label', brk + 'に曲がる。カップの' + aimSide + ' ' + numTxt(cups) + '個分を狙う');
    }
    // 急な傾斜でも計算はするが、前提が変わることを伝える
    if (sol.runaway) {
      html += '<p class="caution"><b>下りが急です（合計 ' + totalSlope(sl).toFixed(1) + '°）</b>軽く触れるだけでもカップまで転がり、カップを外すと止まりません。振り幅は最小限にしてください。</p>';
    } else if (sol.steep) {
      html += '<p class="caution"><b>傾斜が急です（合計 ' + totalSlope(sl).toFixed(1) + '°）</b>' + (sol.canRest ? '' : 'この傾斜ではボールが斜面の途中で止まれないため、') + '「カップに届く強さ」で計算しています。カップを外すと大きく転がります。カップ周りの傾斜は一般に2〜3°以下なので、スマホの置き方も確認してください。</p>';
    }
    $('call').innerHTML = html;

    // 振り幅
    var model = P.strokeModel(state.cal), cm = model.stroke(sol.v0);
    state.strokeCm = cm;
    if (sol.runaway) { cm = 1; state.strokeCm = 1; }
    $('st-cm').textContent = Math.max(1, Math.round(cm));
    var eq = sol.flatEq / YD, parts = [];
    if (sol.runaway) parts.push('最小限のタッチ（1cm以下）で届きます');
    else if (Math.abs(sl.fwd) >= FLAT) parts.push(fwdText(sl.fwd) + 'のぶん、平坦な ' + numTxt(eq) + 'yd と同じ強さ');
    else parts.push('平坦な ' + numTxt(eq) + 'yd の強さ');
    if (!sol.runaway) parts.push(sol.steep ? 'カップに届く強さで計算（急傾斜のため）' : 'カップを約30cm過ぎて止まる強さで計算');
    $('st-sub').innerHTML = parts.join('<br>');
    $('stroke-view').hidden = !!sol.runaway;
    $('stroke-view').innerHTML = sol.runaway ? '' : strokeRows(cm);
    var note = model.source === 'default'
      ? '仮の基準（振り幅20cmで3yd転がる）で計算しています。設定の「振り幅のキャリブレーション」で自分の距離感を登録すると、あなたに合った値になります。'
      : 'あなたのキャリブレーション（' + model.points.length + '点）をもとに計算しています。';
    if (cm > 60) note = '振り幅が60cmを超えています。ここまで大きいと推定の精度が下がります。' + note;
    $('st-note').textContent = note;
    Metro.layout();
  }

  function curveIcon(dir) { // dir: -1 左へ曲がる / 1 右へ曲がる / 0 まっすぐ
    var d = dir === 0 ? 'M17 30V6' : (dir < 0 ? 'M24 30C24 18 20 10 9 8' : 'M10 30C10 18 14 10 25 8');
    var h = dir === 0 ? 'M10 13l7-8 7 8' : (dir < 0 ? 'M16 3l-8 5 6 8' : 'M18 3l8 5-6 8');
    return '<svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/><path d="' + h + '"/></svg>';
  }

  /* ---------- パッティングライン（真上から見た図） ---------- */
  function lineSVG(sol, sl, D) {
    var W = 340, H = 330, bx = 170, by = 290, cyp = 58, pxm = (by - cyp) / D, k = 1, s = '';
    if (sol) {
      // カップ1個分が画面上で約20pxになるよう、横方向だけ段階的に強調する（収まらなければ弱める）
      var maxLat = Math.max(Math.abs(sol.aim), Math.abs(sol.maxDev), P.CUP), want = 20 / (P.CUP * pxm), KS = [1, 1.5, 2, 3, 4, 5, 6, 8], ki = 0;
      KS.forEach(function (v, i) { if (Math.abs(v - want) < Math.abs(KS[ki] - want)) ki = i; });
      if (want <= 1) ki = 0;
      while (ki > 0 && maxLat * pxm * KS[ki] > 118) ki--;
      k = KS[ki];
      if (maxLat * pxm * k > 118) k = 118 / (maxLat * pxm);
      if (half(sol.cups) < 0.5) k = 1; // ほぼまっすぐのときは強調しない
    }
    function X(y) { return bx + y * pxm * k; }
    function Y(x) { return by - x * pxm; }
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    for (var i = 0; i < 6; i++) if (i % 2 === 0) s += '<rect x="0" y="' + (i * 55) + '" width="' + W + '" height="55" fill="' + C.t600 + '" opacity=".34"/>';

    // 低い方の向き
    var tf = Math.tan(sl.fwd * DEG), ts = Math.tan(sl.side * DEG), mag = Math.sqrt(tf * tf + ts * ts), dcx = 40, dcy = H - 68;
    s += '<circle cx="' + dcx + '" cy="' + dcy + '" r="25" fill="' + C.t900 + '" opacity=".72"/>';
    if (mag > Math.tan(FLAT * DEG)) {
      var ux = ts / mag, uy = tf / mag, a = [dcx - ux * 12, dcy - uy * 12], b = [dcx + ux * 7, dcy + uy * 7], hd = arrowHead(a, b, 9);
      s += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="' + C.chalk + '" stroke-width="4" stroke-linecap="round"/>';
      s += '<polygon points="' + hd.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="' + C.chalk + '"/>';
      s += '<text x="' + dcx + '" y="' + (dcy + 41) + '" text-anchor="middle" font-size="12" font-weight="700" fill="' + C.chalk + '">低い方</text>';
    } else {
      s += '<text x="' + dcx + '" y="' + (dcy + 4.5) + '" text-anchor="middle" font-size="13" font-weight="900" fill="' + C.chalk + '">平坦</text>';
    }

    var cupR = Math.max(3.5, (P.CUP / 2) * pxm * k), ballR = clamp(0.02135 * pxm * k, 4, 9);
    if (sol) {
      var ax = X(sol.aim), right = sol.aim > 0, straight = half(sol.cups) < 0.5, unit = P.CUP * pxm * k, n = Math.floor(half(sol.cups));
      // カップ何個分かの目盛り
      if (!straight && !(unit >= 10 && n <= 12)) {
        s += '<path d="M' + bx + ' ' + cyp + 'H' + ax + '" stroke="' + C.chalk + '" stroke-opacity=".5" stroke-width="1.4" stroke-dasharray="2 3"/>';
      }
      if (!straight && unit >= 10 && n <= 12) {
        for (var c = 1; c <= n; c++) s += '<circle cx="' + (bx + (right ? 1 : -1) * c * unit) + '" cy="' + cyp + '" r="' + Math.max(2.5, unit / 2 - 0.8) + '" fill="none" stroke="' + C.chalk + '" stroke-opacity=".5" stroke-width="1.2" stroke-dasharray="3 2.5"/>';
      }
      // 打ち出す方向（点線）
      s += '<line x1="' + bx + '" y1="' + by + '" x2="' + ax + '" y2="' + cyp + '" stroke="' + C.chalk + '" stroke-width="2.4" stroke-dasharray="7 6" stroke-linecap="round"/>';
      // カップ
      s += '<circle cx="' + bx + '" cy="' + cyp + '" r="' + cupR + '" fill="' + C.t950 + '" stroke="' + C.chalk + '" stroke-width="1.6"/>';
      // 予想ライン（実線）
      s += '<polyline points="' + sol.path.map(function (p) { return X(p[1]).toFixed(1) + ',' + Y(p[0]).toFixed(1); }).join(' ') + '" fill="none" stroke="' + C.volt + '" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>';
      // 狙い点
      if (!straight) {
        s += '<circle cx="' + ax + '" cy="' + cyp + '" r="6" fill="' + C.t700 + '" stroke="' + C.chalk + '" stroke-width="2.2"/>';
        s += '<path d="M' + (ax - 11) + ' ' + cyp + 'h22M' + ax + ' ' + (cyp - 11) + 'v22" stroke="' + C.chalk + '" stroke-width="1.6"/>';
        var tx = clamp(ax, 40, W - 40);
        s += '<text x="' + tx + '" y="' + (cyp - 22) + '" text-anchor="middle" font-size="13" font-weight="900" fill="' + C.chalk + '" stroke="' + C.t700 + '" stroke-width="4" paint-order="stroke">ここを狙う</text>';
        s += '<text x="' + (bx + (right ? -1 : 1) * (cupR + 8)) + '" y="' + (cyp + 4.5) + '" text-anchor="' + (right ? 'end' : 'start') + '" font-size="12" font-weight="700" fill="' + C.dim + '">カップ</text>';
      } else {
        s += '<text x="' + (bx + cupR + 8) + '" y="' + (cyp + 4.5) + '" font-size="12" font-weight="700" fill="' + C.dim + '">カップ</text>';
      }
    } else {
      s += '<circle cx="' + bx + '" cy="' + cyp + '" r="' + cupR + '" fill="' + C.t950 + '" stroke="' + C.chalk + '" stroke-width="1.6"/>';
    }
    s += '<circle cx="' + bx + '" cy="' + by + '" r="' + ballR + '" fill="' + C.chalk + '"/>';
    s += '<text x="' + bx + '" y="' + (by + 24) + '" text-anchor="middle" font-size="12" font-weight="700" fill="' + C.dim + '">ボール</text>';
    s += '</svg>';
    return { svg: s, k: k };
  }

  /* ---------- 振り幅の図（卵・りんご・ペットボトルを同じ縮尺で並べる） ---------- */
  var ITEMS = [
    { key: 'egg', name: '卵', cm: 6, unit: '個', h: 30 },
    { key: 'apple', name: 'りんご', cm: 8, unit: '個', h: 44 },
    { key: 'bottle', name: 'ペットボトル', cm: 20, unit: '本', h: 36 }
  ];
  function strokeRows(L) {
    var W = 230, x0 = 30, s = Math.min(4, (W - x0 - 12) / Math.max(L, 5)), x1 = x0 + L * s, out = '';
    function guides(h) {
      return '<path d="M' + x0 + ' 0V' + h + 'M' + x1.toFixed(1) + ' 0V' + h + '" stroke="' + C.chalk + '" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 3"/>';
    }
    // パター（アドレスとトップ）
    var gy = 46, hh = 2.8 * s, hw = 3 * s, br = Math.max(4, 2.13 * s);
    function putter(x, ghost) {
      var st = ghost ? ' fill="none" stroke="' + C.chalk + '" stroke-opacity=".75" stroke-width="1.4" stroke-dasharray="3 2.5"' : ' fill="' + C.chalk + '"';
      return '<rect x="' + x.toFixed(1) + '" y="' + (gy - hh).toFixed(1) + '" width="' + hw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5"' + st + '/>' +
        '<line x1="' + (x + hw * 0.4).toFixed(1) + '" y1="' + (gy - hh).toFixed(1) + '" x2="' + (x + hw * 0.4 + 2).toFixed(1) + '" y2="2" stroke="' + C.chalk + '" stroke-width="' + (ghost ? 1.4 : 2.4) + '"' + (ghost ? ' stroke-opacity=".75" stroke-dasharray="3 2.5"' : '') + ' stroke-linecap="round"/>';
    }
    var p = '<svg viewBox="0 0 ' + W + ' 76" xmlns="http://www.w3.org/2000/svg">' + guides(76);
    p += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="' + C.t500 + '" stroke-width="2"/>';
    p += '<circle cx="' + (x0 - br - 1).toFixed(1) + '" cy="' + (gy - br).toFixed(1) + '" r="' + br.toFixed(1) + '" fill="' + C.chalk + '"/>';
    p += putter(x1, true) + putter(x0, false);
    var a = arrowHead([x0 + 10, 57], [x1 - 7, 57], 7), b = arrowHead([x1 - 10, 57], [x0 + 7, 57], 7);
    function poly(h) { return '<polygon points="' + h.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '" fill="' + C.volt + '"/>'; }
    p += '<line x1="' + (x0 + 7) + '" y1="57" x2="' + (x1 - 7).toFixed(1) + '" y2="57" stroke="' + C.volt + '" stroke-width="2"/>' + poly(a) + poly(b);
    p += '<text x="' + (x0 + 9) + '" y="72" text-anchor="end" font-size="10" font-weight="700" fill="' + C.dim + '">アドレス</text>';
    var topEnd = x1 + 24 > W; // 右端に近いときは、文字が切れないよう右寄せにする
    p += '<text x="' + (topEnd ? W - 1 : x1 - 9).toFixed(1) + '" y="72"' + (topEnd ? ' text-anchor="end"' : '') + ' font-size="10" font-weight="700" fill="' + C.dim + '">トップ</text></svg>';
    out += '<div class="stroke-row"><div class="lab"><span>パターを引く幅</span><b><em>' + Math.round(L) + '</em>cm</b></div>' + p + '</div>';

    ITEMS.forEach(function (it) {
      var cnt = L / it.cm, n = Math.ceil(cnt - 1e-6), g = it.h - 3, v = '<svg viewBox="0 0 ' + W + ' ' + it.h + '" xmlns="http://www.w3.org/2000/svg">';
      v += '<defs><clipPath id="clip-' + it.key + '"><rect x="' + x0 + '" y="0" width="' + (x1 - x0).toFixed(1) + '" height="' + it.h + '"/></clipPath></defs>' + guides(it.h);
      v += '<line x1="0" y1="' + g + '" x2="' + W + '" y2="' + g + '" stroke="' + C.t500 + '" stroke-width="2"/><g clip-path="url(#clip-' + it.key + ')">';
      for (var i = 0; i < n; i++) v += drawItem(it.key, x0 + i * it.cm * s, g, s);
      v += '</g></svg>';
      var shown = it.key === 'bottle' ? numTxt(Math.round(cnt * 10) / 10) : numTxt(Math.max(0.5, half(cnt)));
      out += '<div class="stroke-row"><div class="lab"><span>' + it.name + '</span><b>約<em>' + shown + '</em>' + it.unit + '分</b></div>' + v + '</div>';
    });
    return out;
  }
  function drawItem(key, x, g, s) {
    if (key === 'egg') {
      return '<ellipse cx="' + (x + 3 * s) + '" cy="' + (g - 2.2 * s) + '" rx="' + (3 * s - 0.6) + '" ry="' + (2.2 * s) + '" fill="#f6e8cf" stroke="#c9b48c" stroke-width="1"/>';
    }
    if (key === 'apple') {
      var cx = x + 4 * s, cy = g - 3.7 * s;
      return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (4 * s - 0.6) + '" ry="' + (3.7 * s) + '" fill="#e5483a" stroke="#a82d22" stroke-width="1"/>' +
        '<path d="M' + cx + ' ' + (cy - 3.3 * s) + 'q' + (0.3 * s) + ' ' + (-1.4 * s) + ' ' + (1.2 * s) + ' ' + (-2 * s) + '" stroke="#6b4a2a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="' + (cx + 2.1 * s) + '" cy="' + (cy - 4.3 * s) + '" rx="' + (1.5 * s) + '" ry="' + (0.7 * s) + '" fill="#7cc35a" transform="rotate(-25 ' + (cx + 2.1 * s) + ' ' + (cy - 4.3 * s) + ')"/>';
    }
    // ペットボトル（横倒し・全長20cm）
    var t = g - 6.5 * s;
    return '<path d="M' + (x + 1.2 * s) + ' ' + t + 'H' + (x + 14.2 * s) + 'L' + (x + 17.6 * s) + ' ' + (t + 1.8 * s) + 'V' + (g - 1.8 * s) + 'L' + (x + 14.2 * s) + ' ' + g + 'H' + (x + 1.2 * s) + 'Q' + (x + 0.3) + ' ' + g + ' ' + (x + 0.3) + ' ' + (g - 1.2 * s) + 'V' + (t + 1.2 * s) + 'Q' + (x + 0.3) + ' ' + t + ' ' + (x + 1.2 * s) + ' ' + t + 'Z" fill="#bfe6ff" fill-opacity=".3" stroke="#cfeeff" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<rect x="' + (x + 5 * s) + '" y="' + t + '" width="' + (5.5 * s) + '" height="' + (6.5 * s) + '" fill="#f3f7ee" fill-opacity=".8"/>' +
      '<rect x="' + (x + 17.6 * s) + '" y="' + (t + 1.6 * s) + '" width="' + (2.4 * s - 0.6) + '" height="' + (3.3 * s) + '" rx="1.2" fill="#f3f7ee"/>';
  }

  /* =====================================================================
     メトロノーム（90 BPM・3/4拍子）
     音は Web Audio の時計で先に予約し、描画はその時計を読むだけにして分離する。
     1小節 = 2.000秒: 始動 0.000 / トップ 0.667 / インパクト 1.000 / フォロー 1.333
     ===================================================================== */
  var BEAT = 60 / 90, BAR = BEAT * 3, T_TOP = BEAT, T_HIT = BEAT * 1.5, T_FOL = BEAT * 2;
  var Metro = {
    ctx: null, playing: false, timer: null, raf: 0, t0: 0, nextBeat: 0, beatNo: 0, perf0: 0, useAudio: false, px: 3, els: null,

    layout: function () {
      var L = state.strokeCm, W = 340, H = 128, gx = 176, gy = 98;
      this.px = Math.min(3.2, 104 / Math.max(L, 5));
      var reach = L * this.px, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
      s += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="' + C.t500 + '" stroke-width="2"/>';
      [[gx, '始動'], [gx + reach, 'トップ'], [gx - reach, 'フォロー']].forEach(function (m, i) {
        s += '<line x1="' + m[0].toFixed(1) + '" y1="' + (gy + 2) + '" x2="' + m[0].toFixed(1) + '" y2="' + (gy + 10) + '" stroke="' + (i === 0 ? C.volt : C.chalk) + '" stroke-width="2" stroke-opacity="' + (i === 0 ? 1 : .6) + '"/>';
      });
      if (reach > 46) {
        s += '<text x="' + (gx + reach).toFixed(1) + '" y="' + (gy + 23) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.dim + '">トップ</text>';
        s += '<text x="' + (gx - reach).toFixed(1) + '" y="' + (gy + 23) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.dim + '">フォロー</text>';
      }
      s += '<text x="' + gx + '" y="' + (gy + 23) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.volt + '">インパクト</text>';
      s += '<circle id="mt-flash" cx="' + (gx - 8) + '" cy="' + (gy - 7) + '" r="8" fill="none" stroke="' + C.volt + '" stroke-width="3" opacity="0"/>';
      s += '<circle id="mt-ball" cx="' + (gx - 8) + '" cy="' + (gy - 7) + '" r="6.5" fill="' + C.chalk + '"/>';
      s += '<g id="mt-putter"><line x1="' + (gx + 5) + '" y1="' + (gy - 13) + '" x2="' + (gx + 5) + '" y2="-40" stroke="' + C.chalk + '" stroke-width="3" stroke-linecap="round"/>';
      s += '<rect x="' + gx + '" y="' + (gy - 14) + '" width="12" height="13" rx="2" fill="' + C.chalk + '"/></g></svg>';
      $('metro-stage').innerHTML = s;
      this.els = { putter: $('mt-putter'), ball: $('mt-ball'), flash: $('mt-flash'), gx: gx, gy: gy, reach: reach };
      this.draw(this.playing ? this.phase() : 0);
    },

    /** 小節内の時刻(秒) → ヘッドの位置（アドレス基準。トップ側が正、1.0 = 振り幅ぶん） */
    head: function (t) {
      if (t < T_TOP) return (1 - Math.cos(Math.PI * t / T_TOP)) / 2;                      // バックスイング
      if (t < T_HIT) return Math.cos((Math.PI / 2) * (t - T_TOP) / (T_HIT - T_TOP));      // ダウン → インパクト
      if (t < T_FOL) return -Math.sin((Math.PI / 2) * (t - T_HIT) / (T_FOL - T_HIT));     // インパクト → フォロー
      var u = clamp((t - T_FOL - 0.2) / 0.3, 0, 1);                                       // 構え直し
      return -1 + u * u * (3 - 2 * u);
    },

    draw: function (t) {
      var e = this.els; if (!e) return;
      var dx = this.head(t) * e.reach, R = e.gy + 300, ang = -Math.asin(clamp(dx / R, -1, 1)) / DEG;
      e.putter.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' ' + (e.gx + 5) + ' -300)');
      var bx = e.gx - 8, op = 1;
      if (this.playing && t >= T_HIT) {
        var u = clamp((t - T_HIT) / 0.55, 0, 1);
        bx -= 150 * (1 - Math.pow(1 - u, 2));
        op = t < T_HIT + 0.3 ? 1 : clamp(1 - (t - T_HIT - 0.3) / 0.25, 0, 1);
        if (t > BAR - 0.14) { bx = e.gx - 8; op = clamp((t - (BAR - 0.14)) / 0.1, 0, 1); }
      }
      e.ball.setAttribute('cx', bx.toFixed(1)); e.ball.setAttribute('opacity', op.toFixed(2));
      var fl = this.playing && t >= T_HIT && t < T_HIT + 0.22 ? (t - T_HIT) / 0.22 : -1;
      e.flash.setAttribute('opacity', fl < 0 ? 0 : (1 - fl).toFixed(2));
      e.flash.setAttribute('r', fl < 0 ? 8 : (8 + fl * 22).toFixed(1));
      $('metro-stage').classList.toggle('hit', fl >= 0 && fl < 0.6);

      var beats = $('beats').children, ph = $('phases').children, on = this.playing;
      for (var i = 0; i < 3; i++) {
        var lit = on && t >= i * BEAT && t < i * BEAT + 0.2;
        beats[i].className = lit ? (i === 0 ? 'on accent' : 'on') : '';
      }
      var cur = !on ? -1 : t < T_TOP ? 0 : t < T_HIT ? 1 : t < T_FOL ? 2 : 3;
      for (var j = 0; j < 4; j++) ph[j].classList.toggle('on', j === cur);
    },

    now: function () {
      if (this.useAudio) return this.ctx.currentTime - (this.ctx.outputLatency || 0);
      return performance.now() / 1000;
    },
    phase: function () { var t = this.now() - this.t0; return t < 0 ? 0 : t % BAR; },

    click: function (when, accent) {
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = accent ? 1568 : 1047;       // 1拍目だけ高く・強く
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + (accent ? 0.09 : 0.06));
      o.connect(g); g.connect(c.destination); o.start(when); o.stop(when + 0.12);
    },
    schedule: function () {
      while (this.nextBeat < this.ctx.currentTime + 0.15) {
        this.click(this.nextBeat, this.beatNo % 3 === 0);
        this.nextBeat += BEAT; this.beatNo++;
      }
    },

    start: function () {
      if (this.playing) return;
      var AC = window.AudioContext || window.webkitAudioContext, self = this;
      this.useAudio = false;
      if (AC) {
        try {
          if (!this.ctx) this.ctx = new AC();
          // iPhone の消音スイッチでも鳴るようにする（対応端末のみ）
          try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 任意 */ }
          if (this.ctx.state !== 'running') this.ctx.resume();
          this.useAudio = true;
        } catch (e) { this.useAudio = false; }
      }
      this.playing = true; this.beatNo = 0;
      if (this.useAudio) {
        this.nextBeat = this.ctx.currentTime + 0.12;
        this.t0 = this.nextBeat;
        this.schedule();
        this.timer = setInterval(function () { self.schedule(); }, 25);
      } else {
        this.t0 = performance.now() / 1000 + 0.12;
      }
      var loop = function () { if (!self.playing) return; self.draw(self.phase()); self.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
      requestWake();
      $('metro-btn').textContent = '停止する'; $('metro-btn').setAttribute('aria-pressed', 'true');
    },
    stop: function () {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer); cancelAnimationFrame(this.raf);
      if (this.ctx) { try { this.ctx.suspend(); } catch (e) { /* 無視 */ } }
      releaseWake();
      this.draw(0);
      $('metro-btn').textContent = '再生する'; $('metro-btn').setAttribute('aria-pressed', 'false');
    }
  };

  /* =====================================================================
     設定
     ===================================================================== */
  var STIMPS = [[8, '遅い'], [9, 'ふつう'], [10, '速い'], [11, '高速']];
  function setStimp(v) {
    state.stimp = clamp(v, 7, 13); store.set('stimp', state.stimp);
    renderSettings(); renderMain();
  }
  function calInputs() {
    return CAL_CM.map(function (cm) {
      var yd = [0, 1, 2].map(function (i) { return parseFloat($('cal-' + cm + '-' + i).value); }).filter(function (d) { return d > 0 && d < 60; });
      return { cm: cm, yd: yd };
    });
  }
  function renderCalAvg() {
    calInputs().forEach(function (r) {
      $('cal-avg-' + r.cm).textContent = r.yd.length ? (r.yd.reduce(function (a, b) { return a + b; }, 0) / r.yd.length).toFixed(1) + 'yd' : '—';
    });
  }
  function renderSettings() {
    Array.prototype.forEach.call($('stimp-chips').children, function (b) { b.setAttribute('aria-pressed', String(+b.dataset.v === state.stimp)); });
    $('stimp-range').value = state.stimp;
    $('stimp-out').textContent = state.stimp.toFixed(1) + ' ft';

    var m = P.strokeModel(state.cal), guide = CAL_CM.map(function (cm) { return cm + 'cm → ' + m.rollYd(cm, state.stimp).toFixed(1) + 'yd'; }).join(' ／ ');
    var head = m.source === 'default' ? '未登録（仮の基準：振り幅20cmで3yd）'
      : m.source === 'single' ? '登録済み：1点（' + m.points[0].cm + 'cm で平均 ' + m.points[0].meanYd.toFixed(1) + 'yd）'
        : '登録済み：' + m.points.length + '点の距離曲線';
    $('cal-status').innerHTML = head + '<small>いまのグリーンの速さ（' + state.stimp.toFixed(1) + 'ft）での目安：' + guide + '</small>';

    $('zero-status').innerHTML = state.zero
      ? '補正あり<small>前後 ' + signed(state.zero.fwd) + '° ／ 左右 ' + signed(state.zero.side) + '° を差し引いて測定します</small>'
      : '補正なし';
    $('zero-clear').disabled = !state.zero;
  }
  function signed(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); }
  function fillCalInputs() {
    CAL_CM.forEach(function (cm) {
      var pt = state.cal.filter(function (p) { return p.cm === cm; })[0];
      [0, 1, 2].forEach(function (i) { $('cal-' + cm + '-' + i).value = pt && pt.yd[i] != null ? pt.yd[i] : ''; });
    });
    renderCalAvg();
  }

  /* =====================================================================
     起動
     ===================================================================== */
  function init() {
    $('start-illust').innerHTML = plateSVG({ id: 'st', phone: true, labels: true });

    // 距離チップ・速さチップ・キャリブレーション表を組み立てる
    $('dist-chips').innerHTML = DIST_CHIPS.map(function (v) { return '<button class="chip" type="button" data-v="' + v + '" aria-pressed="false">' + v + '<small>yd</small></button>'; }).join('');
    $('stimp-chips').innerHTML = STIMPS.map(function (v) { return '<button class="chip" type="button" data-v="' + v[0] + '" aria-pressed="false">' + v[0] + '<small>' + v[1] + '</small></button>'; }).join('');
    var g = '<span class="hd">振り幅</span><span class="hd">1球目</span><span class="hd">2球目</span><span class="hd">3球目</span><span class="hd">平均</span>';
    CAL_CM.forEach(function (cm) {
      g += '<span class="cm">' + cm + '<small>cm</small></span>';
      [0, 1, 2].forEach(function (i) { g += '<input id="cal-' + cm + '-' + i + '" type="number" inputmode="decimal" min="0" max="60" step="0.1" placeholder="yd" aria-label="振り幅' + cm + 'cm ' + (i + 1) + '球目の距離（ヤード）">'; });
      g += '<span class="avg" id="cal-avg-' + cm + '">—</span>';
    });
    $('cal-grid').innerHTML = g;

    // スタート
    $('btn-measure').addEventListener('click', function () { startMeasure('slope'); });
    $('btn-manual').addEventListener('click', function () { openManual(); });
    // 測定
    $('ms-cancel').addEventListener('click', function () { stopMeasure(); show(state.slope ? 'scr-main' : 'scr-start'); });
    $('ms-manual').addEventListener('click', function () { stopMeasure(); show(state.slope ? 'scr-main' : 'scr-start'); openManual(); });
    // 測定完了
    $('rs-go').addEventListener('click', function () { show('scr-main'); $('dist-num').value = numTxt(state.dist); $('dist-range').value = state.dist; renderMain(); });
    $('rs-redo').addEventListener('click', function () { if (state.slope && state.slope.source === 'manual') openManual(); else startMeasure('slope'); });
    // 手動入力
    $('mi-fwd').addEventListener('input', renderManual); $('mi-side').addEventListener('input', renderManual);
    $('mi-close').addEventListener('click', function () { $('sheet-manual').hidden = true; });
    $('mi-ok').addEventListener('click', function () { $('sheet-manual').hidden = true; setSlope(+$('mi-fwd').value, +$('mi-side').value, 'manual'); });
    // メイン
    $('mn-remeasure').addEventListener('click', function () { startMeasure('slope'); });
    $('dist-minus').addEventListener('click', function () { setDist(state.dist - 0.5); });
    $('dist-plus').addEventListener('click', function () { setDist(state.dist + 0.5); });
    $('dist-num').addEventListener('input', function () { var v = parseFloat(this.value); if (v >= 0.5 && v <= 20) setDist(v, 'num'); });
    $('dist-num').addEventListener('change', function () { var v = parseFloat(this.value); setDist(isFinite(v) ? v : state.dist); });
    $('dist-range').addEventListener('input', function () { setDist(+this.value, 'range'); });
    $('dist-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setDist(+b.dataset.v); });
    $('metro-btn').addEventListener('click', function () { if (Metro.playing) Metro.stop(); else Metro.start(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) Metro.stop(); });
    // 設定
    $('mn-settings').addEventListener('click', function () { Metro.stop(); fillCalInputs(); renderSettings(); $('sheet-settings').hidden = false; $('sheet-settings').scrollTop = 0; });
    $('set-close').addEventListener('click', function () { $('sheet-settings').hidden = true; });
    $('stimp-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setStimp(+b.dataset.v); });
    $('stimp-range').addEventListener('input', function () { setStimp(+this.value); });
    $('cal-grid').addEventListener('input', renderCalAvg);
    $('cal-save').addEventListener('click', function () {
      var rows = calInputs().filter(function (r) { return r.yd.length; });
      if (!rows.length) { toast('距離が入力されていません。少なくとも1つの振り幅に、転がった距離を入力してください。'); return; }
      state.cal = rows.map(function (r) { return { cm: r.cm, yd: r.yd, stimp: state.stimp }; });
      store.set('cal', state.cal); renderSettings(); renderMain();
      toast('キャリブレーションを保存しました（' + rows.length + '点）。');
    });
    $('cal-clear').addEventListener('click', function () {
      state.cal = []; store.set('cal', []); fillCalInputs(); renderSettings(); renderMain();
      toast('登録を消しました。仮の基準に戻ります。');
    });
    $('zero-start').addEventListener('click', function () { $('sheet-settings').hidden = true; startMeasure('zero1'); });
    $('zero-clear').addEventListener('click', function () { state.zero = null; store.set('zero', null); renderSettings(); toast('ゼロ点補正を消しました。'); });
    $('set-manual').addEventListener('click', function () { openManual(); });

    show('scr-start');
  }

  init();
})();
