const { chromium } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, '..', 'shots');
async function feedSlope(page, fwd, side) {
  const beta = side, sRight = -fwd;
  const gamma = Math.asin(Math.sin(sRight * Math.PI / 180) / Math.cos(beta * Math.PI / 180)) * 180 / Math.PI;
  await page.evaluate(([b, g]) => { clearInterval(window.__feed); window.__feed = setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b + (Math.random() - .5) * .1, gamma: g + (Math.random() - .5) * .1 })), 33); }, [beta, gamma]);
}
(async () => {
  const browser = await chromium.launch();
  for (const [w, h, tag] of [[844, 390, 'l844'], [667, 375, 'l667']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('http://localhost:8765/golf-guts-putt-lab.html'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/${tag}-1-start.png`, fullPage: true });
    await feedSlope(page, 1.5, -1.0); await page.click('#btn-measure'); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/${tag}-2-measure.png`, fullPage: true });
    await page.waitForSelector('#scr-result:not([hidden])', { timeout: 8000 }); await page.evaluate(() => clearInterval(window.__feed));
    await page.screenshot({ path: `${shots}/${tag}-3-result.png`, fullPage: true });
    await page.click('#rs-go'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/${tag}-4-main.png`, fullPage: true });
    await page.click('#mn-settings'); await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/${tag}-5-settings.png`, fullPage: true });
    await page.click('#set-manual'); await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/${tag}-6-manual.png`, fullPage: true });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(tag, 'overflow', ov);
    await ctx.close();
  }
  // portrait without the flag: rotate prompt
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); await page.goto('http://localhost:8765/golf-guts-putt-lab.html'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/p-rotate.png` });
  await browser.close();
})();
