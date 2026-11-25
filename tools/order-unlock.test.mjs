/**
 * Synthetic-order browser checks for cat-quiz order unlock.
 * Fetch is mocked. This file never calls the production API or Mantle.
 * Run: npm install --prefix /tmp/pw playwright-core
 *      ln -sfn /tmp/pw/node_modules ./node_modules
 *      node tools/order-unlock.test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ORDER = 'P738291046518273649';
const CODE = 'CAT7K2';
const SHOTS = '/tmp/cat-quiz-proof';
fs.mkdirSync(SHOTS, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function json(route, status, obj) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify(obj),
  });
}

function listen() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url !== '/' && url !== '/index.html') {
      res.writeHead(404);
      res.end('no');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(ROOT, 'index.html')));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function answerAll(page) {
  for (let i = 1; i <= 15; i++) {
    await page.waitForFunction((n) => {
      const prog = document.getElementById('qprog');
      const quiz = document.getElementById('quiz');
      return quiz && quiz.classList.contains('active') && prog && prog.textContent.startsWith(n + ' /');
    }, i);
    await page.locator('#opts .opt').first().click();
  }
  await page.waitForSelector('#result.active', { timeout: 8000 });
}

async function launch(browser, server, hooks) {
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}/`;
  const context = await browser.newContext({
    viewport: hooks.viewport || { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes('mantledb.sh')) return hooks.mantle(route, req);
    if (url.includes('snappy-tundra') || url.includes('/order/')) return hooks.order(route, req);
    hooks.blocked.push(url);
    return route.abort();
  });
  hooks.blocked = hooks.blocked || [];
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  return { page, context, errors, origin };
}

function orderApi() {
  const orders = new Map();
  const calls = [];
  let hangFirstPost = false;
  async function order(route, req) {
    const url = new URL(req.url());
    const method = req.method();
    const bodyText = req.postData();
    calls.push({ method, path: url.pathname, search: url.search, body: bodyText });
    if (method === 'GET' && url.pathname === '/order/get') {
      const quiz = url.searchParams.get('quiz');
      const orderId = url.searchParams.get('orderId');
      const row = orders.get(orderId);
      if (!row) return json(route, 404, { ok: false, error: 'not_found' });
      if (row.quiz !== quiz) return json(route, 409, { ok: false, error: 'bound_other_quiz' });
      return json(route, 200, {
        ok: true, quiz, orderId, uses: row.uses, remaining: row.max - row.uses, max: row.max,
      });
    }
    if (method === 'POST' && url.pathname === '/order/redeem') {
      const body = JSON.parse(bodyText || '{}');
      if (body.quiz !== 'cat' || typeof body.orderId !== 'string') {
        return json(route, 400, { ok: false, error: 'invalid' });
      }
      let row = orders.get(body.orderId);
      if (!row) row = { uses: 0, max: 3, quiz: body.quiz };
      else if (row.quiz !== body.quiz) return json(route, 409, { ok: false, error: 'bound_other_quiz' });
      if (row.forceExhausted) return json(route, 200, { ok: false, error: 'exhausted', remaining: 0, max: row.max, uses: row.uses });
      if (row.uses >= row.max) return json(route, 200, { ok: false, error: 'exhausted', remaining: 0, max: row.max, uses: row.uses });
      row.uses += 1;
      orders.set(body.orderId, row);
      const payload = { ok: true, quiz: 'cat', orderId: body.orderId, uses: row.uses, remaining: row.max - row.uses, max: row.max };
      if (hangFirstPost && calls.filter((c) => c.path === '/order/redeem').length === 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      try { return await json(route, 200, payload); } catch (e) { return null; }
    }
    return json(route, 500, { ok: false, error: 'unexpected' });
  }
  return {
    order,
    calls,
    orders,
    set hangFirstPost(v) { hangFirstPost = v; },
    redeems() { return this.calls.filter((c) => c.path === '/order/redeem'); },
    gets() { return this.calls.filter((c) => c.path === '/order/get'); },
  };
}

function mantleApi() {
  const codes = new Map();
  const calls = [];
  let mode = 'ok';
  async function mantle(route, req) {
    const url = req.url();
    const method = req.method();
    calls.push({ method, url, body: req.postData() });
    if (!url.includes('/v2/catquiz-zph420-codes/c/') && !url.includes('/v2/increment/catquiz-zph420-codes/c/')) {
      return json(route, 500, { ok: false, error: 'wrong-mantle-path' });
    }
    if (url.includes('/bz/')) return json(route, 500, { ok: false, error: 'bz-path' });
    const code = decodeURIComponent(url.split('/c/')[1].split('?')[0]);
    if (method === 'GET') {
      if (mode === 'missing' || !codes.has(code)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return json(route, 200, { remaining: codes.get(code).remaining, max: 3 });
    }
    const body = JSON.parse(req.postData() || '{}');
    const row = codes.get(code) || { remaining: 0 };
    if (mode === 'rollback' && body.by === -1) {
      return json(route, 200, { remaining: -1, max: 3 });
    }
    row.remaining += body.by;
    codes.set(code, row);
    return json(route, 200, { remaining: row.remaining, max: 3 });
  }
  return { mantle, calls, codes, setMode(v) { mode = v; } };
}

async function submit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.fill('#codeInput', value);
  await page.click('#btnCodeOk');
}

async function main() {
  const server = await listen();
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log('PASS', name);
    } catch (e) {
      results.push({ name, ok: false, error: e.stack || String(e) });
      console.error('FAIL', name, e);
    }
  }

  await test('gate stays before questions and copy is order-only', async () => {
    const api = orderApi();
    const legacy = mantleApi();
    const blocked = [];
    const { page, errors } = await launch(browser, server, {
      viewport: { width: 390, height: 844 },
      order: api.order,
      mantle: legacy.mantle,
      blocked,
    });
    const state = await page.evaluate(() => ({
      start: document.getElementById('start').classList.contains('active'),
      quiz: document.getElementById('quiz').classList.contains('active'),
      qtext: document.getElementById('qtext').textContent,
      h3: document.querySelector('.code-panel h3').textContent,
      hint: document.querySelector('.code-hint').innerText,
      placeholder: document.getElementById('codeInput').placeholder,
      html: document.body.innerText,
    }));
    assert(state.start && !state.quiz, 'start screen is the free entry');
    assert(state.qtext === '', 'questions are not shown before unlock');
    assert(state.h3 === '输入订单号', state.h3);
    assert(state.hint.includes('小红书「我的订单」') && state.hint.includes('3 次'), state.hint);
    assert(state.placeholder === '订单号', state.placeholder);
    assert(!state.html.includes('验证码') && !state.html.includes('旧'), 'UI must not advertise legacy codes');
    assert(await page.evaluate(() => typeof redeemCode === 'function' && typeof mantleGet === 'function'), 'mantle helpers still exist');
    await page.click('#btnStart');
    await page.waitForSelector('#codeMask.show');
    assert(!(await page.$('#quiz.active')), 'opening the gate does not start the quiz');
    const box = await page.locator('.code-panel').boundingBox();
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    assert(box.x >= -1 && box.x + box.width <= 391, JSON.stringify(box));
    assert(overflow.sw <= overflow.cw + 1, JSON.stringify(overflow));
    await page.screenshot({ path: path.join(SHOTS, 'mobile-390-modal.png') });
    assert(errors.length === 0, errors.join('\n'));
    assert(api.calls.length === 0 && legacy.calls.length === 0, 'modal alone must not redeem');
    await page.context().close();
  });

  await test('narrow 320 layout keeps the order form on screen', async () => {
    const api = orderApi();
    const legacy = mantleApi();
    const { page } = await launch(browser, server, {
      viewport: { width: 320, height: 700 },
      order: api.order,
      mantle: legacy.mantle,
      blocked: [],
    });
    await page.click('#btnStart');
    await page.waitForSelector('#codeMask.show');
    await page.fill('#codeInput', ORDER);
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector('.code-panel');
      const r = panel.getBoundingClientRect();
      return {
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        left: r.left,
        right: r.right,
        hint: document.querySelector('.code-hint').innerText,
      };
    });
    assert(metrics.sw <= metrics.cw + 1, JSON.stringify(metrics));
    assert(metrics.left >= -1 && metrics.right <= 321, JSON.stringify(metrics));
    await page.screenshot({ path: path.join(SHOTS, 'mobile-320-modal.png') });
    await page.context().close();
  });

  await test('first unlock, refresh does not charge, retry charges, fourth is refused', async () => {
    const api = orderApi();
    const legacy = mantleApi();
    const blocked = [];
    const { page, errors } = await launch(browser, server, {
      viewport: { width: 390, height: 844 },
      order: api.order,
      mantle: legacy.mantle,
      blocked,
    });
    const bad = await page.evaluate(() => orderFormatError('P738291046518273649'));
    assert(bad === '', 'synthetic order should pass local format checks');
    await submit(page, 'p7382 910465-18273649');
    await page.waitForSelector('#quiz.active', { timeout: 8000 });
    assert(api.redeems().length === 1, 'first submit redeems once');
    assert(api.redeems()[0].body === JSON.stringify({ quiz: 'cat', orderId: ORDER }), api.redeems()[0].body);
    assert(api.gets().length === 1, 'redeem peeks once first');
    assert(api.gets()[0].search === '?quiz=cat&orderId=' + ORDER, api.gets()[0].search);
    assert(legacy.calls.length === 0, 'order path must not touch Mantle');
    const q1 = await page.locator('#qtext').innerText();
    assert(q1.includes('作息'), q1);

    const redeemsMid = api.redeems().length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#start.active');
    assert(!(await page.$('#quiz.active')));
    assert(api.redeems().length === redeemsMid, 'refresh mid-quiz must not redeem');
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(api.redeems().length === redeemsMid, 'resume after refresh must not redeem');

    await answerAll(page);
    const name = await page.locator('.bname').innerText();
    const why = await page.locator('.st').first().innerText();
    assert(name.length > 0, 'result has a cat');
    assert(why.includes('适合你的理由'), why);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-390-result.png') });
    const resultOverflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    assert(resultOverflow.sw <= resultOverflow.cw + 1, JSON.stringify(resultOverflow));

    const beforeReloadRedeems = api.redeems().length;
    const beforeReloadGets = api.gets().length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#result.active', { timeout: 8000 });
    assert((await page.locator('.bname').innerText()) === name, 'refresh restores the same result');
    assert(api.redeems().length === beforeReloadRedeems, 'result refresh must not redeem');
    assert(api.gets().length > beforeReloadGets, 'result refresh peeks');
    assert(api.orders.get(ORDER).uses === 1, 'uses stay at 1 after refresh');

    await page.click('#btnRetry');
    await page.waitForSelector('#start.active');
    assert(api.orders.get(ORDER).uses === 2, '再测一次 consumes the next use');
    assert(api.redeems().length === beforeReloadRedeems + 1, 'retry posts one redeem');
    const afterRetry = api.redeems().length;
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(api.redeems().length === afterRetry, 'starting the paid retry must not redeem again');
    await answerAll(page);
    await page.click('#btnRetry');
    await page.waitForSelector('#start.active');
    assert(api.orders.get(ORDER).uses === 3, 'third use is the last success');
    await page.click('#btnStart');
    await answerAll(page);
    const usesBeforeFourth = api.orders.get(ORDER).uses;
    const redeemsBeforeFourth = api.redeems().length;
    await page.click('#btnRetry');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('3 次'));
    const stillResult = await page.$('#result.active');
    assert(stillResult, 'fourth attempt stays on the existing result');
    assert(!(await page.$('#quiz.active')), 'fourth attempt does not start a quiz');
    assert(api.orders.get(ORDER).uses === usesBeforeFourth, 'fourth attempt does not consume another use');
    assert(api.redeems().length === redeemsBeforeFourth, 'exhausted peek does not post a fourth redeem');
    assert(legacy.calls.length === 0, 'order flow never called Mantle');
    assert(blocked.length === 0, 'unexpected network: ' + blocked.join(','));
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('server exhausted and bound-other and bad format', async () => {
    const api = orderApi();
    api.orders.set('P738291046518273640', { uses: 0, max: 3, quiz: 'cat', forceExhausted: true });
    api.orders.set('P738291046518273641', { uses: 1, max: 3, quiz: 'bazi' });
    const legacy = mantleApi();
    const { page, errors } = await launch(browser, server, {
      order: api.order,
      mantle: legacy.mantle,
      blocked: [],
    });
    await submit(page, 'P111111111111111111');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
    assert(api.calls.length === 0, 'invalid pattern must not hit the API');
    assert(!(await page.$('#quiz.active')));
    await page.fill('#codeInput', 'P738291046518273640');
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('3 次已经用完'));
    assert(!(await page.$('#quiz.active')), 'exhausted redeem does not unlock');
    await page.fill('#codeInput', 'P738291046518273641');
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('别的测试'));
    assert(!(await page.$('#quiz.active')));
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('legacy mantle path still redeems once and retry or refresh does not', async () => {
    const api = orderApi();
    const legacy = mantleApi();
    legacy.codes.set(CODE, { remaining: 3 });
    const blocked = [];
    const { page, errors } = await launch(browser, server, {
      order: api.order,
      mantle: legacy.mantle,
      blocked,
    });
    await submit(page, 'cat7k2');
    await page.waitForSelector('#quiz.active');
    assert(api.calls.length === 0, 'legacy code must not call the order API');
    const gets = legacy.calls.filter((c) => c.method === 'GET');
    const decrs = legacy.calls.filter((c) => c.method === 'POST' && c.body && c.body.includes('-1'));
    assert(gets.length === 1 && gets[0].url.includes('/v2/catquiz-zph420-codes/c/' + CODE), gets[0] && gets[0].url);
    assert(decrs.length === 1 && decrs[0].url.includes('/v2/increment/catquiz-zph420-codes/c/' + CODE), 'one decrement');
    assert(!legacy.calls.some((c) => c.url.includes('/bz/')), 'must keep this repo /c/ path');
    assert(legacy.codes.get(CODE).remaining === 2, 'one use consumed');
    await answerAll(page);
    const callsAfter = legacy.calls.length;
    await page.click('#btnRetry');
    await page.waitForSelector('#start.active');
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(legacy.calls.length === callsAfter, 'legacy 再测一次 does not decrement again');
    assert(legacy.codes.get(CODE).remaining === 2, 'remaining unchanged on retry');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#start.active');
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(legacy.calls.length === callsAfter, 'legacy refresh does not decrement');
    assert(api.calls.length === 0, 'legacy session must not peek orders');
    assert(blocked.length === 0, blocked.join(','));
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('legacy invalid, exhausted, and negative rollback stay on mantle', async () => {
    const api = orderApi();
    const legacy = mantleApi();
    legacy.setMode('missing');
    const { page, errors } = await launch(browser, server, {
      order: api.order,
      mantle: legacy.mantle,
      blocked: [],
    });
    await submit(page, 'NOCODE');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号不对'));
    assert(!(await page.$('#quiz.active')));
    assert(legacy.calls.every((c) => c.method === 'GET'), 'unknown code is not incremented');
    legacy.codes.set('LEFT01', { remaining: 0 });
    legacy.setMode('ok');
    await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.classList.remove('show'); });
    await page.fill('#codeInput', 'LEFT01');
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完了') && !document.getElementById('btnCodeOk').disabled);
    assert(legacy.calls.filter((c) => c.method === 'POST').length === 0, 'zero remaining does not decrement');
    legacy.codes.set('ROLL01', { remaining: 1 });
    legacy.setMode('rollback');
    await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.classList.remove('show'); });
    await page.fill('#codeInput', 'ROLL01');
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完了') && !document.getElementById('btnCodeOk').disabled);
    const posts = legacy.calls.filter((c) => c.url.includes('ROLL01') && c.method === 'POST');
    assert(posts.some((c) => c.body && c.body.includes('-1')) && posts.some((c) => c.body && /"by":1(?!\d)/.test(c.body)), 'negative remaining is rolled back ' + JSON.stringify(posts));
    assert(!(await page.$('#quiz.active')));
    assert(api.calls.length === 0);
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('timed-out redeem is accepted from peek and not posted twice', async () => {
    const api = orderApi();
    api.hangFirstPost = true;
    const legacy = mantleApi();
    const { page, errors } = await launch(browser, server, {
      order: api.order,
      mantle: legacy.mantle,
      blocked: [],
    });
    await page.evaluate(() => {
      globalThis.__ORDER_TIMEOUT_MS = 350;
      globalThis.__ORDER_RECONCILE_MS = 20;
    });
    await submit(page, ORDER);
    await page.waitForSelector('#quiz.active', { timeout: 8000 });
    assert(api.redeems().length === 1, 'timeout reconcile must not redeem twice, got ' + api.redeems().length);
    assert(api.orders.get(ORDER).uses === 1, 'server use count increased once');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
