# Chain gateway

**Status:** v1 built 8 November 2026 (`gateway/`). Testnet4 only.

## Why

The app reads the treasury and broadcasts payouts through public chain services. UNO's practice run (6–8 November 2026) showed the limits:

- mempool.space's testnet4 service stopped answering for hours at a time;
- Zelcore's testnet4 Blockbook answers browsers but does not let web pages read its API (no CORS header), so the app could never use it;
- public services throttle bursts, and every open page of every member reads the treasury.

With no source the app could read, UNO's closing round could not be prepared (finding 25 in `MAINNET-READINESS.md`).

## What

One small Cloudflare Worker per DAO, next to the DAO's relay: the **chain gateway**. The app talks to the DAO's own gateway first. What sits behind the gateway can change without touching the app.

```
member's phone (app) ──► DAO's chain gateway (Cloudflare Worker, free plan)
                              │  lets the DAO's site read it (CORS)
                              │  asks sources in order, caches, rate-limits
                              │  sends broadcasts to every source
                              ▼
   v1 (now):   public services read server-side: Zelcore's Blockbook, mempool.space, testnetscan.com
   v2 (later): a pruned Bitcoin Core node with a watch-only wallet for the DAO's descriptor,
               behind a Cloudflare Tunnel, first in the list; public services as fallback
```

Like the relay, it is a self-managed tool per DAO, deployable from the kit, on a free tier. How to deploy it: `gateway/README.md`.

## Why v1 needs no provider

Node providers were considered first. QuickNode's address index (its Blockbook add-on) costs $75 a month, and its plain Bitcoin calls do not include `scantxoutset`, so a free plan cannot find the treasury's coins. But the services that failed the app on 8 November were not down: Zelcore's Blockbook was in sync throughout, and only refused **web pages**. A server may read it freely. So the gateway reads the public services itself and passes the answers on with the permission browsers need.

## The app's side

No new code. The gateway answers each source in its own format, which the app already reads:

```json
"chainApi": [
  "blockbook:https://btc-dao-gateway.<account>.workers.dev/bb",
  "https://btc-dao-gateway.<account>.workers.dev/esplora/api",
  "https://mempool.space/testnet4/api"
]
```

mempool.space directly stays last, in case the gateway itself is down. A source shows data but never moves coins: every payment is still checked against the treasury's descriptor on each phone.

## Rules

- **Only the app's requests:** address activity, transactions and coins, transaction status, fee estimates, the chain tip and broadcast. Anything else is refused without asking a source.
- **Only the DAO's site** (and localhost) may read it from a web page; other sites' pages are refused.
- **Per-visitor limit**, generous for members (120 requests a minute by default).
- **Cache:** unconfirmed transactions 5 s, addresses and coins 10 s, fees 60 s, confirmed transactions an hour. Several open pages share one reading; a broadcast clears the cache.
- **Broadcast to every source**, so a transaction reaches several nodes; a source answering "already known" counts as accepted. The transaction id is computed by the gateway and checked against each source's answer.
- **No keys, no spending:** the gateway never holds anything that can sign.

Not in v1: refusing addresses outside the DAO's treasury. Deriving the treasury's addresses from the descriptor costs more processor time than the free plan allows per request; the site-only rule and the limit keep the load on the public services small. It comes with v2, where the node's watch-only wallet knows the treasury's addresses anyway.

## Later

- **v2, own node behind the same gateway:** pruned Bitcoin Core (about 2–3 GB on testnet4), watch-only wallet loaded with the DAO's descriptor at founding, reached through a Cloudflare Tunnel. The gateway uses it first and the public services as a fallback.
- **Mainnet:** the same design; the own node grows to 10–15 GB and days of sync. Relying on free public services is fine for testnet4 but not for a mainnet DAO: v2 comes first.
