# Chain gateway

The DAO's chain gateway ([design](../docs/chain-gateway.md)): a Cloudflare Worker between the app and public chain services. It runs on Cloudflare's free Workers plan, with no database and no secrets.

**What it does**

- Reads public chain services on the app's behalf and lets the DAO's site read the answers (CORS). A service that refuses web pages, such as Zelcore's testnet4 Blockbook, becomes usable.
- Asks the sources in order and moves to the next when one fails; a real "not found" is passed back as an answer.
- Reuses answers briefly (unconfirmed transactions 5 s, addresses and coins 10 s, fees 60 s, confirmed transactions an hour), so several open pages share one reading.
- Sends every broadcast to **all** sources, so a transaction reaches several nodes. "Already known" counts as accepted.
- Answers only the requests the app makes, only to the DAO's site (and localhost), with a per-visitor limit.
- Holds no keys and cannot move coins.

**How the app uses it** (in `config/dao.json`):

```json
"chainApi": [
  "blockbook:https://btc-dao-gateway.<account>.workers.dev/bb",
  "https://btc-dao-gateway.<account>.workers.dev/esplora/api",
  "https://mempool.space/testnet4/api"
]
```

The `/bb` path answers in Blockbook's format from the Blockbook sources, the `/esplora/api` path in Esplora's format from the Esplora sources. mempool.space directly stays last, in case the gateway itself is down. Explorer links and the manual broadcast page are redirected to the first source's own pages.

**Settings** (`wrangler.toml`, `[vars]`)

| Variable | Meaning |
| --- | --- |
| `ALLOWED_ORIGINS` | The DAO's site origin(s), comma-separated, for example `https://bitcoin-dao.github.io` |
| `BLOCKBOOK` | Blockbook servers, in order |
| `ESPLORA` | Esplora APIs, in order |
| `RATE_PER_MIN` | Requests per visitor per minute (default 120) |

The page at the gateway's address (`/status`) shows the sources and whether each last answered.

## Deploying (Cloudflare dashboard, once)

Same as the relay, without a database:

1. Workers & Pages → Create → Import a repository → `btc-dao` (the Cloudflare app already has access, from the relay).
   - Project name: `btc-dao-gateway` (must match `name` in `wrangler.toml`)
   - Root directory (under Advanced): `gateway`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
2. Deploy, then open `https://btc-dao-gateway.<account>.workers.dev/status`: it lists the sources.
3. Open `https://btc-dao-gateway.<account>.workers.dev/bb/api/v2/estimatefee/3` in a browser: an answer means the gateway reaches Blockbook.
4. Add the gateway to `chainApi` in the DAO's config, as above, and publish the site.

## Tests

`npm install && npm test`: reading, falling back, caching, "not found", the request list, origins, the limit, broadcasting to every source, transaction ids, and the redirects. The app's end-to-end payout round also runs through the gateway: `CHAIN=gateway bash app/e2e/run.sh payouts`.

## Later

An own pruned node behind the same gateway, as the first source (see the design). The app does not change.
