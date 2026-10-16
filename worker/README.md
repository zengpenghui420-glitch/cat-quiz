# Cloudflare Worker (optional upgrade)

The live site currently redeems codes via **MantleDB** from the browser.
For stronger security (keep write key off the client), deploy this Worker and
set `API_BASE` in `index.html` to the Worker URL.

## Setup
1. `npx wrangler login`
2. Create KV namespace: `npx wrangler kv namespace create CODES`
3. Put binding id into `wrangler.toml`
4. `npx wrangler secret put ADMIN_SECRET`
5. `npx wrangler secret put MANTLE_KEY` (or migrate fully to KV)
6. `npx wrangler deploy`

Endpoints:
- `POST /redeem` `{"code":"XXXXXX"}` → `{ok, remaining}`
- `POST /admin/mint` header `X-Admin-Secret` `{"count":10}` → new codes
