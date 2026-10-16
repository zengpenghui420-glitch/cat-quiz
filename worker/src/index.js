const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function norm(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function randomCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function ns(env) {
  return env.MANTLE_NS || 'catquiz-zph420-codes';
}

async function mantleGet(env, code) {
  const r = await fetch(`https://mantledb.sh/v2/${ns(env)}/c/${code}`, {
    headers: { 'X-Mantle-Key': env.MANTLE_KEY },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('mantle ' + r.status);
  return r.json();
}

async function mantleInc(env, code, by) {
  const r = await fetch(`https://mantledb.sh/v2/increment/${ns(env)}/c/${code}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mantle-Key': env.MANTLE_KEY },
    body: JSON.stringify({ key: 'remaining', by }),
  });
  if (!r.ok) throw new Error('mantle ' + r.status);
  return r.json();
}

async function mantlePut(env, code, body) {
  const r = await fetch(`https://mantledb.sh/v2/${ns(env)}/c/${code}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mantle-Key': env.MANTLE_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('mantle ' + r.status);
  return r.json();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'POST' && path === '/redeem') {
        const { code: raw } = await request.json().catch(() => ({}));
        const code = norm(raw);
        if (!code) return json({ ok: false, reason: 'invalid' }, 400);
        const data = await mantleGet(env, code);
        if (!data || typeof data.remaining !== 'number') {
          return json({ ok: false, reason: 'invalid' });
        }
        if (data.remaining <= 0) return json({ ok: false, reason: 'exhausted' });
        const after = await mantleInc(env, code, -1);
        if (typeof after.remaining !== 'number' || after.remaining < 0) {
          await mantleInc(env, code, 1);
          return json({ ok: false, reason: 'exhausted' });
        }
        return json({ ok: true, remaining: after.remaining, max: data.max || 3 });
      }

      if (request.method === 'POST' && path === '/admin/mint') {
        if (request.headers.get('X-Admin-Secret') !== env.ADMIN_SECRET) {
          return json({ ok: false, reason: 'unauthorized' }, 401);
        }
        const body = await request.json().catch(() => ({}));
        const count = Math.min(Math.max(Number(body.count) || 1, 1), 50);
        const max = Number(body.max) || 3;
        const codes = [];
        for (let i = 0; i < count; i++) {
          const code = randomCode();
          await mantlePut(env, code, {
            remaining: max,
            max,
            created: new Date().toISOString(),
          });
          codes.push(code);
        }
        return json({ ok: true, codes, max });
      }

      return json({ ok: true, service: 'cat-quiz-codes' });
    } catch (e) {
      return json({ ok: false, reason: 'error', message: String(e.message || e) }, 500);
    }
  },
};
