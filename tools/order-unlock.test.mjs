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
const OTHER = 'P564738291056473829';
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

function vaultApi() {
  const calls = [];
  const unexpected = [];
  let mode = 'ok';
  async function vault(route, req) {
    const url = new URL(req.url());
    const entry = { method: req.method(), path: url.pathname, search: url.search, body: req.postData() };
    calls.push(entry);
    if (url.pathname.startsWith('/order') || url.pathname.includes('/orders')) {
      unexpected.push(entry);
      return route.abort();
    }
    if (mode === 'down') return route.abort();
    if (req.method() === 'POST' && url.pathname === '/redeem') {
      const body = JSON.parse(req.postData() || '{}');
      if (mode === 'not_found') return json(route, 404, { ok: false, error: 'not_found' });
      if (mode === 'exhausted') return json(route, 200, { ok: false, error: 'exhausted', remaining: 0, max: 3 });
      if (body.quiz !== 'cat' || typeof body.code !== 'string') return json(route, 400, { ok: false, error: 'invalid' });
      return json(route, 200, { ok: true, remaining: 2, max: 3 });
    }
    return json(route, 500, { ok: false, error: 'unexpected' });
  }
  return {
    vault,
    calls,
    unexpected,
    setMode(v) { mode = v; },
    posts() { return this.calls.filter((c) => c.path === '/redeem' && c.method === 'POST'); },
  };
}

function mantleApi() {
  const codes = new Map();
  const calls = [];
  const unexpected = [];
  let mode = 'ok';
  async function mantle(route, req) {
    const url = req.url();
    const method = req.method();
    calls.push({ method, url, body: req.postData() });
    if (url.includes('/orders/')) {
      unexpected.push(url);
      return route.abort();
    }
    if (!url.includes('/v2/catquiz-zph420-codes/c/') && !url.includes('/v2/increment/catquiz-zph420-codes/c/')) {
      unexpected.push(url);
      return json(route, 500, { ok: false, error: 'wrong-mantle-path' });
    }
    if (url.includes('/bz/') || url.includes('/sp/')) {
      unexpected.push(url);
      return json(route, 500, { ok: false, error: 'wrong-collection' });
    }
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
  return { mantle, calls, codes, unexpected, setMode(v) { mode = v; } };
}

async function arm(page, origin, hooks) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(origin)) return route.continue();
    hooks.network.push({ method: req.method(), url });
    if (url.includes('mantledb.sh')) return hooks.mantle.mantle(route, req);
    if (url.includes('vercel.app')) return hooks.vault.vault(route, req);
    hooks.blocked.push(url);
    return route.abort();
  });
  return errors;
}

async function launch(browser, server, hooks, viewport) {
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}/`;
  const context = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = await arm(page, origin, hooks);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  return { page, context, errors, origin };
}

async function submit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.fill('#codeInput', value);
  await page.click('#btnCodeOk');
}

function freshHooks() {
  return { network: [], blocked: [], vault: vaultApi(), mantle: mantleApi() };
}

function assertQuietOrder(hooks, msg) {
  const urls = hooks.network.map((n) => n.method + ' ' + n.url);
  assert(hooks.network.length === 0, (msg || 'order network') + ' ' + urls.join(' | '));
  assert(hooks.vault.calls.length === 0 && hooks.vault.unexpected.length === 0, msg || 'vault');
  assert(hooks.mantle.calls.length === 0 && hooks.mantle.unexpected.length === 0, msg || 'mantle');
  assert(hooks.blocked.length === 0, (msg || 'blocked') + ' ' + hooks.blocked.join(','));
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
    const hooks = freshHooks();
    const { page, errors } = await launch(browser, server, hooks);
    const state = await page.evaluate(() => ({
      start: document.getElementById('start').classList.contains('active'),
      quiz: document.getElementById('quiz').classList.contains('active'),
      qtext: document.getElementById('qtext').textContent,
      h3: document.querySelector('.code-panel h3').textContent,
      hint: document.querySelector('.code-hint').innerText,
      placeholder: document.getElementById('codeInput').placeholder,
      html: document.body.innerText,
      viewHidden: document.getElementById('btnViewLast').hidden,
      helpers: typeof redeemCode === 'function' && typeof mantleGet === 'function' && typeof redeemAccess === 'function' && typeof redeemOrder === 'function' && typeof peekOrder === 'undefined',
    }));
    assert(state.start && !state.quiz, 'start screen is the free entry');
    assert(state.qtext === '', 'questions are not shown before unlock');
    assert(state.h3 === '输入订单号', state.h3);
    assert(state.hint.includes('小红书「我的订单」') && state.hint.includes('3 次'), state.hint);
    assert(state.placeholder === '订单号', state.placeholder);
    assert(!state.html.includes('验证码') && !state.html.includes('旧'), 'UI must not advertise legacy codes');
    assert(state.viewHidden, 'view-last stays hidden until a result exists');
    assert(state.helpers, 'redeem helpers');
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
    assertQuietOrder(hooks, 'modal alone must not redeem');
    await page.context().close();
  });

  await test('narrow 320 layout keeps the order form on screen', async () => {
    const hooks = freshHooks();
    const { page } = await launch(browser, server, hooks, { width: 320, height: 700 });
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

  await test('valid order starts on the device and side paths do not advance the display', async () => {
    const hooks = freshHooks();
    const { page, context, errors, origin } = await launch(browser, server, hooks);
    const bad = await page.evaluate((id) => orderFormatError(id), ORDER);
    assert(bad === '', 'synthetic order should pass local format checks');
    await submit(page, 'p7382 910465-18273649');
    await page.waitForSelector('#quiz.active', { timeout: 8000 });
    const first = await page.evaluate((id) => ({
      toast: document.getElementById('toast').textContent,
      q: document.getElementById('qtext').textContent,
      uses: shownOrderUses(id),
      map: JSON.parse(localStorage.getItem('catquiz_order_uses') || 'null'),
      soft: localStorage.getItem('soft_persimmon_order_uses'),
      paid: document.body.innerText.includes('paidVerified'),
    }), ORDER);
    assert(first.toast === '验证成功，还可以测 2 次', first.toast);
    assert(first.q.includes('作息'), first.q);
    assert(first.uses === 1 && first.map[ORDER] === 1, JSON.stringify(first.map));
    assert(first.soft == null, 'must not reuse the other quiz key');
    assert(first.paid === false, 'paidVerified is not shown');
    assertQuietOrder(hooks, 'first start');

    await page.locator('#opts .opt').first().click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#start.active');
    assert(!(await page.$('#quiz.active')));
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    const continued = await page.evaluate((id) => shownOrderUses(id), ORDER);
    assert(continued === 1, 'continue changed the display ' + continued);
    assertQuietOrder(hooks, 'continue');

    await answerAll(page);
    const name = await page.locator('.bname').innerText();
    assert(name.length > 0, 'result has a cat');
    await page.screenshot({ path: path.join(SHOTS, 'mobile-390-result.png') });
    const beforeReload = await page.evaluate((id) => shownOrderUses(id), ORDER);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#result.active', { timeout: 8000 });
    assert((await page.locator('.bname').innerText()) === name, 'refresh restores the same result');
    const restored = await page.evaluate((id) => shownOrderUses(id), ORDER);
    assert(restored === beforeReload && restored === 1, 'result restore changed the display');
    assertQuietOrder(hooks, 'result restore');

    const page2 = await context.newPage();
    const errors2 = await arm(page2, origin, hooks);
    await page2.goto(origin, { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('#btnViewLast:not([hidden])');
    await page2.click('#btnViewLast');
    await page2.waitForSelector('#result.active');
    await page2.waitForFunction(() => document.getElementById('toast').textContent.includes('已打开上次结果'));
    const viewed = await page2.evaluate((id) => shownOrderUses(id), ORDER);
    assert(viewed === 1, '查看上次结果 changed the display ' + viewed);
    assert((await page2.locator('.bname').innerText()) === name, 'view last showed a different result');
    assertQuietOrder(hooks, 'view last');
    assert(errors.length === 0 && errors2.length === 0, errors.concat(errors2).join('\n'));
    await context.close();
  });

  await test('再测一次 advances the display and a later entry still opens', async () => {
    const hooks = freshHooks();
    const { page, errors } = await launch(browser, server, hooks);
    await submit(page, ORDER);
    await page.waitForSelector('#quiz.active');
    await answerAll(page);
    await page.click('#btnRetry');
    await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功，还可以测 1 次');
    let uses = await page.evaluate((id) => shownOrderUses(id), ORDER);
    assert(uses === 2, 'second display ' + uses);
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 2, 'starting the next attempt changed the display again');
    await answerAll(page);
    await page.click('#btnRetry');
    await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功，这是最后一次');
    uses = await page.evaluate((id) => shownOrderUses(id), ORDER);
    assert(uses === 3, 'third display ' + uses);
    await page.click('#btnStart');
    await answerAll(page);
    await page.click('#btnRetry');
    await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
    const fourth = await page.evaluate((id) => ({
      toast: document.getElementById('toast').textContent,
      uses: shownOrderUses(id),
      start: document.getElementById('start').classList.contains('active'),
    }), ORDER);
    assert(fourth.toast === '验证成功', fourth.toast);
    assert(!fourth.toast.includes('用完') && !fourth.toast.includes('暂时验证不了'), fourth.toast);
    assert(fourth.uses === 4 && fourth.start, JSON.stringify(fourth));
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 4, 'entering after the toast changed the display again');
    assertQuietOrder(hooks, 'later entry');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('19-digit, repeating, and sequence ids are rejected on the device', async () => {
    const hooks = freshHooks();
    const { page, errors } = await launch(browser, server, hooks);
    const samples = [
      'P111111111111111111',
      'P012345678901234567',
      'P987654321098765432',
      'P7382910465182736491',
    ];
    for (const sample of samples) {
      if (!(await page.$('#codeMask.show'))) {
        await page.click('#btnStart');
        await page.waitForSelector('#codeMask.show');
      }
      await page.fill('#codeInput', '');
      await page.fill('#codeInput', sample);
      await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.classList.remove('show'); });
      await page.click('#btnCodeOk');
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
      assert(!(await page.$('#quiz.active')), sample + ' started the quiz');
      const stored = await page.evaluate((id) => shownOrderUses(id), sample);
      assert(stored === 0, sample + ' stored a display count');
    }
    assertQuietOrder(hooks, 'rejected ids');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('display counts are stored per order id', async () => {
    const hooks = freshHooks();
    const { page, errors } = await launch(browser, server, hooks);
    const formats = await page.evaluate((ids) => ids.map((id) => orderFormatError(id)), [ORDER, OTHER]);
    assert(formats[0] === '' && formats[1] === '', formats.join(','));
    await submit(page, ORDER);
    await page.waitForSelector('#quiz.active');
    await page.evaluate(() => { clearUnlock(); show('start'); });
    await submit(page, OTHER);
    await page.waitForSelector('#quiz.active');
    const counts = await page.evaluate((ids) => ({
      a: shownOrderUses(ids[0]),
      b: shownOrderUses(ids[1]),
      key: ORDER_USES_KEY,
    }), [ORDER, OTHER]);
    assert(counts.key === 'catquiz_order_uses', counts.key);
    assert(counts.a === 1 && counts.b === 1, JSON.stringify(counts));
    assertQuietOrder(hooks, 'second id');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('paidVerified stays false', async () => {
    const hooks = freshHooks();
    const { page, errors } = await launch(browser, server, hooks);
    const paid = await page.evaluate(() => {
      const id = 'P564738291056473820';
      const res = redeemOrder(id);
      const all = readOrderUseMap();
      delete all[id];
      localStorage.setItem(ORDER_USES_KEY, JSON.stringify(all));
      return { ok: res.ok, paid: res.paidVerified, shown: document.body.innerText.includes('paidVerified') };
    });
    assert(paid.ok === true && paid.paid === false && paid.shown === false, JSON.stringify(paid));
    assertQuietOrder(hooks, 'paidVerified check');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('vault hit redeems the access code once and retry or refresh does not', async () => {
    const hooks = freshHooks();
    const { page, errors } = await launch(browser, server, hooks);
    await submit(page, 'cat7k2');
    await page.waitForSelector('#quiz.active');
    assert(hooks.vault.posts().length === 1, 'vault redeem once');
    const body = JSON.parse(hooks.vault.posts()[0].body);
    assert(body.quiz === 'cat' && body.code === CODE && !('orderId' in body), JSON.stringify(body));
    assert(hooks.mantle.calls.length === 0, 'vault hit must not touch Mantle');
    assert(hooks.vault.unexpected.length === 0 && hooks.blocked.length === 0, 'unexpected order call');
    const toast = await page.locator('#toast').innerText();
    assert(toast === '验证成功，还可以测 2 次', toast);
    await answerAll(page);
    const callsAfter = hooks.vault.posts().length;
    await page.click('#btnRetry');
    await page.waitForSelector('#start.active');
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(hooks.vault.posts().length === callsAfter, 'code 再测一次 redeemed again');
    assert(hooks.mantle.calls.length === 0, 'retry touched Mantle');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#start.active');
    await page.click('#btnStart');
    await page.waitForSelector('#quiz.active');
    assert(hooks.vault.posts().length === callsAfter, 'code refresh redeemed again');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('vault miss falls back to Mantle and an exhausted vault code does not', async () => {
    const miss = freshHooks();
    miss.vault.setMode('not_found');
    miss.mantle.codes.set(CODE, { remaining: 3 });
    const opened = await launch(browser, server, miss);
    await submit(opened.page, CODE);
    await opened.page.waitForSelector('#quiz.active');
    const gets = miss.mantle.calls.filter((c) => c.method === 'GET');
    const decrs = miss.mantle.calls.filter((c) => c.method === 'POST' && c.body && c.body.includes('-1'));
    assert(miss.vault.posts().length === 1, 'vault was consulted');
    assert(gets.length === 1 && gets[0].url.includes('/v2/catquiz-zph420-codes/c/' + CODE), 'mantle get');
    assert(decrs.length === 1 && decrs[0].url.includes('/v2/increment/catquiz-zph420-codes/c/' + CODE), 'one decrement');
    assert(!miss.mantle.calls.some((c) => c.url.includes('/orders/') || c.url.includes('/sp/')), 'wrong collection');
    assert(miss.mantle.codes.get(CODE).remaining === 2, 'real remaining decreased once');
    assert(miss.vault.unexpected.length === 0, 'order endpoint on a code');
    const leftToast = await opened.page.locator('#toast').innerText();
    assert(leftToast === '验证成功，还可以测 2 次', leftToast);
    await opened.page.context().close();

    const done = freshHooks();
    done.vault.setMode('exhausted');
    done.mantle.codes.set(CODE, { remaining: 3 });
    const second = await launch(browser, server, done);
    await submit(second.page, CODE);
    await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完了'));
    assert(!(await second.page.$('#quiz.active')), 'exhausted vault unlocked');
    assert(done.mantle.calls.length === 0, 'exhausted vault fell through to Mantle');
    assert(done.mantle.codes.get(CODE).remaining === 3, 'mantle remaining changed');
    await second.page.context().close();
  });

  await test('vault outage falls back to Mantle, and a negative decrement rolls back', async () => {
    const down = freshHooks();
    down.vault.setMode('down');
    down.mantle.codes.set(CODE, { remaining: 3 });
    const opened = await launch(browser, server, down);
    await submit(opened.page, CODE);
    await opened.page.waitForSelector('#quiz.active');
    assert(down.vault.calls.some((c) => c.path === '/redeem'), 'outage should still try the vault');
    assert(down.mantle.codes.get(CODE).remaining === 2, 'outage still uses the Mantle count');
    await opened.page.context().close();

    const rollback = freshHooks();
    rollback.vault.setMode('not_found');
    rollback.mantle.codes.set('ROLL01', { remaining: 1 });
    rollback.mantle.setMode('rollback');
    const page2 = await launch(browser, server, rollback);
    await submit(page2.page, 'ROLL01');
    await page2.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完了') && !document.getElementById('btnCodeOk').disabled);
    const posts = rollback.mantle.calls.filter((c) => c.url.includes('ROLL01') && c.method === 'POST');
    assert(posts.some((c) => c.body && c.body.includes('-1')) && posts.some((c) => c.body && /"by":1(?!\d)/.test(c.body)), 'negative remaining is rolled back');
    assert(!(await page2.page.$('#quiz.active')));
    await page2.page.context().close();

    const both = freshHooks();
    both.vault.setMode('down');
    both.mantle.setMode('missing');
    const page3 = await launch(browser, server, both);
    await submit(page3.page, CODE);
    await page3.page.waitForFunction(() => document.getElementById('toast').textContent.includes('网络异常'));
    assert(!(await page3.page.$('#quiz.active')), 'network failure unlocked');
    await page3.page.context().close();
  });

  await test('unknown and zero-remaining codes do not increment Mantle', async () => {
    const hooks = freshHooks();
    hooks.vault.setMode('not_found');
    hooks.mantle.setMode('missing');
    const { page, errors } = await launch(browser, server, hooks);
    await submit(page, 'NOCODE');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号不对'));
    assert(!(await page.$('#quiz.active')));
    assert(hooks.vault.posts().length === 1, 'unknown code still asks the vault');
    assert(hooks.mantle.calls.every((c) => c.method === 'GET'), 'unknown code is not incremented');
    hooks.mantle.codes.set('LEFT01', { remaining: 0 });
    hooks.mantle.setMode('ok');
    await page.evaluate(() => { const t = document.getElementById('toast'); t.textContent = ''; t.classList.remove('show'); });
    await page.fill('#codeInput', 'LEFT01');
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完了') && !document.getElementById('btnCodeOk').disabled);
    assert(hooks.mantle.calls.filter((c) => c.method === 'POST').length === 0, 'zero remaining does not decrement');
    assert(errors.length === 0, errors.join('\n'));
    await page.context().close();
  });

  await test('query string starts an order locally and still redeems an access code', async () => {
    const order = freshHooks();
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}/`;
    const context = await browser.newContext();
    const page = await context.newPage();
    await arm(page, origin, order);
    await page.goto(origin + '?code=' + ORDER, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#quiz.active', { timeout: 8000 });
    assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 1, 'query order display');
    assertQuietOrder(order, 'query order');
    await context.close();

    const code = freshHooks();
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await arm(page2, origin, code);
    await page2.goto(origin + '?code=' + CODE, { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('#quiz.active', { timeout: 8000 });
    const body = JSON.parse(code.vault.posts()[0].body);
    assert(code.vault.posts().length === 1 && body.code === CODE && body.quiz === 'cat', 'query code');
    assert(code.mantle.calls.length === 0, 'query code hit Mantle on a vault hit');
    await context2.close();
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
