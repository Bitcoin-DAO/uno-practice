// The DAO's chain gateway (docs/chain-gateway.md).
//
// A Worker between the app and public chain services. Pages of the DAO's site may read it (CORS), so
// a service that refuses web pages (Zelcore's Blockbook) becomes usable. It answers in each source's
// own format, so the app needs nothing new:
//
//   blockbook:https://<gateway>/bb       Blockbook API under /bb/api/v2/…, explorer pages under /bb/…
//   https://<gateway>/esplora/api        Esplora API under /esplora/api/…, explorer pages under /esplora/…
//
// It never holds keys and cannot move coins: it only reads, caches and passes signed transactions on.


export interface Env {
  ALLOWED_ORIGINS: string;
  BLOCKBOOK: string;
  ESPLORA: string;
  RATE_PER_MIN?: string;
}

type Kind = 'bb' | 'esplora';

const TIMEOUT_MS = 12_000;
const UA = 'btc-dao-gateway (+https://github.com/Bitcoin-DAO/btc-dao)';
const list = (s?: string) => (s ?? '').split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean);
const explorerOf = (kind: Kind, base: string) => (kind === 'esplora' ? base.replace(/\/api$/, '') : base);

// ---- state kept per Worker instance (approximate across instances, which is enough here) ----

interface Cached { until: number; status: number; body: string; type: string }
const cache = new Map<string, Cached>();
const hits = new Map<string, { start: number; n: number }>();
const health = new Map<string, { ok: boolean; at: number; error?: string }>();

/** For tests. */
export function reset() {
  cache.clear();
  hits.clear();
  health.clear();
}

// ---- which requests are passed on ----

const ADDR = '[a-zA-Z0-9]{14,90}';
const TXID = '[0-9a-f]{64}';
const GET_PATHS: Record<Kind, RegExp[]> = {
  bb: [
    new RegExp(`^/api/v2/address/${ADDR}$`),
    new RegExp(`^/api/v2/utxo/${ADDR}$`),
    new RegExp(`^/api/v2/tx/${TXID}$`),
    /^\/api\/v2\/estimatefee\/\d{1,3}$/,
  ],
  esplora: [
    new RegExp(`^/address/${ADDR}$`),
    new RegExp(`^/address/${ADDR}/txs$`),
    new RegExp(`^/address/${ADDR}/utxo$`),
    new RegExp(`^/tx/${TXID}$`),
    new RegExp(`^/tx/${TXID}/status$`),
    /^\/v1\/fees\/recommended$/,
    /^\/fee-estimates$/,
    /^\/blocks\/tip\/height$/,
  ],
};
/** Blockbook query parameters the app uses; anything else is dropped. */
const BB_QUERY = ['details', 'pageSize', 'page', 'from', 'to'];

/** How long an answer may be reused, in seconds: settled transactions for an hour, fees for a minute, the rest briefly. */
function ttl(kind: Kind, path: string, body: string): number {
  if (/estimatefee|fees|fee-estimates/.test(path)) return 60;
  if (/\/tx\//.test(path)) {
    try {
      const j = JSON.parse(body);
      const confirmed = kind === 'bb' ? (j.confirmations ?? 0) > 0 : (j.confirmed ?? j.status?.confirmed) === true;
      return confirmed ? 3600 : 5; // an unconfirmed answer is the one that changes
    } catch {
      return 5;
    }
  }
  return 10;
}

// ---- helpers ----

function cors(req: Request, env: Env): Record<string, string> | 'refused' {
  const origin = req.headers.get('Origin');
  if (!origin) return {}; // a page opened directly, or a non-browser client
  const ok = list(env.ALLOWED_ORIGINS).includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return 'refused';
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

function reply(status: number, body: string, type: string, headers: Record<string, string>): Response {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers } });
}

function limited(req: Request, env: Env): boolean {
  const who = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const per = Number(env.RATE_PER_MIN ?? 120) || 120;
  const now = Date.now();
  const h = hits.get(who);
  if (!h || now - h.start > 60_000) {
    hits.set(who, { start: now, n: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n++;
  return h.n > per;
}

async function upstream(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

const why = (e: unknown) => ((e as Error)?.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000} s` : String((e as Error)?.message ?? e));
const hostOf = (u: string) => new URL(u).host;

// ---- reading: ask each source of the kind in turn ----

async function read(kind: Kind, sources: string[], path: string, search: string, h: Record<string, string>): Promise<Response> {
  const key = `${kind}${path}${search}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return reply(hit.status, hit.body, hit.type, { ...h, 'X-Gateway-Cache': 'hit' });

  let last: { status: number; body: string; type: string } | undefined;
  const errors: string[] = [];
  for (const base of sources) {
    try {
      const r = await upstream(base + path + search);
      const body = await r.text();
      const type = r.headers.get('Content-Type') ?? 'application/json';
      if (r.ok) {
        health.set(base, { ok: true, at: Date.now() });
        cache.set(key, { until: Date.now() + ttl(kind, path, body) * 1000, status: r.status, body, type });
        if (cache.size > 2000) cache.clear();
        return reply(r.status, body, type, { ...h, 'X-Gateway-Source': hostOf(base) });
      }
      // A real "no" (not found, bad request) is an answer; a refusal or failure is a reason to ask the next one.
      health.set(base, { ok: r.status < 500 && r.status !== 429, at: Date.now(), error: `${r.status}` });
      errors.push(`${hostOf(base)}: ${r.status}`);
      last = { status: r.status, body, type };
    } catch (e) {
      health.set(base, { ok: false, at: Date.now(), error: why(e) });
      errors.push(`${hostOf(base)}: ${why(e)}`);
    }
  }
  if (last && last.status !== 429 && last.status < 500) return reply(last.status, last.body, last.type, h);
  return reply(502, JSON.stringify({ error: `no source answered: ${errors.join(' · ') || 'none configured'}` }), 'application/json', h);
}

// ---- broadcasting: send to every source, so the transaction reaches several nodes ----

const ALREADY = /already|txn-already|known|exists|in block ?chain|missing ?inputs.*confirmed/i;

async function broadcast(kind: Kind, env: Env, hex: string, h: Record<string, string>): Promise<Response> {
  let txid: string;
  try {
    txid = await txidOf(hexToBytes(hex.trim()));
  } catch {
    return kind === 'bb'
      ? reply(400, JSON.stringify({ error: 'not a signed transaction' }), 'application/json', h)
      : reply(400, 'not a signed transaction', 'text/plain', h);
  }
  const sends = [
    ...list(env.BLOCKBOOK).map(async base => {
      const r = await upstream(`${base}/api/v2/sendtx/`, { method: 'POST', body: hex.trim(), headers: { 'Content-Type': 'text/plain' } });
      const j = (await r.json().catch(() => ({}))) as { result?: string; error?: string | { message?: string } };
      if (r.ok && j.result?.trim() === txid) return { base, ok: true };
      const msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? `${r.status}`);
      return { base, ok: ALREADY.test(msg), msg };
    }),
    ...list(env.ESPLORA).map(async base => {
      const r = await upstream(`${base}/tx`, { method: 'POST', body: hex.trim(), headers: { 'Content-Type': 'text/plain' } });
      const text = (await r.text()).trim();
      if (r.ok && text === txid) return { base, ok: true };
      return { base, ok: ALREADY.test(text), msg: r.ok ? 'unexpected answer' : text.slice(0, 200) || `${r.status}` };
    }),
  ];
  const results = await Promise.allSettled(sends);
  const accepted = results.some(x => x.status === 'fulfilled' && x.value.ok);
  const reasons = results.map((x, i) => {
    const base = [...list(env.BLOCKBOOK), ...list(env.ESPLORA)][i];
    return `${hostOf(base)}: ${x.status === 'fulfilled' ? (x.value.ok ? 'accepted' : x.value.msg) : why(x.reason)}`;
  });
  if (accepted) {
    cache.clear(); // balances and statuses change
    return kind === 'bb'
      ? reply(200, JSON.stringify({ result: txid }), 'application/json', { ...h, 'X-Gateway-Broadcast': reasons.join(' · ') })
      : reply(200, txid, 'text/plain', { ...h, 'X-Gateway-Broadcast': reasons.join(' · ') });
  }
  const msg = `no source accepted it: ${reasons.join(' · ')}`;
  return kind === 'bb' ? reply(400, JSON.stringify({ error: msg }), 'application/json', h) : reply(400, msg, 'text/plain', h);
}

/**
 * A transaction's id: double SHA-256 of its serialisation without witnesses, byte-reversed.
 * Parsing it also refuses anything that is not a whole transaction.
 */
export async function txidOf(tx: Uint8Array): Promise<string> {
  let i = 0;
  const take = (n: number) => {
    if (i + n > tx.length) throw new Error('short');
    const out = tx.subarray(i, i + n);
    i += n;
    return out;
  };
  const varint = () => {
    const first = take(1)[0];
    if (first < 0xfd) return first;
    const b = take(first === 0xfd ? 2 : first === 0xfe ? 4 : 8);
    let v = 0;
    for (let k = b.length - 1; k >= 0; k--) v = v * 256 + b[k];
    return v;
  };
  const parts: Uint8Array[] = [take(4)]; // version
  const segwit = tx[i] === 0 && tx[i + 1] === 1;
  if (segwit) i += 2;
  const start = i;
  const nIn = varint();
  if (nIn === 0 || nIn > 10_000) throw new Error('inputs');
  for (let k = 0; k < nIn; k++) {
    take(36);
    take(varint());
    take(4);
  }
  const nOut = varint();
  if (nOut === 0 || nOut > 10_000) throw new Error('outputs');
  for (let k = 0; k < nOut; k++) {
    take(8);
    take(varint());
  }
  parts.push(tx.subarray(start, i));
  if (segwit) for (let k = 0; k < nIn; k++) for (let n = varint(); n > 0; n--) take(varint());
  parts.push(take(4)); // lock time
  if (i !== tx.length) throw new Error('trailing bytes');
  const body = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of parts) (body.set(b, o), (o += b.length));
  const once = await crypto.subtle.digest('SHA-256', body);
  const twice = new Uint8Array(await crypto.subtle.digest('SHA-256', once));
  return Array.from(twice.reverse(), b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error('hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

// ---- the Worker ----

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/{2,}/g, '/');
    const h = cors(req, env);
    if (h === 'refused') return reply(403, JSON.stringify({ error: 'this site may not use the gateway' }), 'application/json', {});
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'Access-Control-Max-Age': '86400' } });
    if (limited(req, env)) return reply(429, JSON.stringify({ error: 'too many requests' }), 'application/json', h);

    const bb = list(env.BLOCKBOOK);
    const es = list(env.ESPLORA);

    if (p === '/' || p === '/status') {
      const sources = [...bb.map(b => ({ kind: 'blockbook', base: b })), ...es.map(b => ({ kind: 'esplora', base: b }))].map(s => ({
        ...s,
        ...(health.get(s.base) ?? { ok: null, at: null }),
      }));
      return reply(200, JSON.stringify({ gateway: 'btc-dao', use: { blockbook: `blockbook:${url.origin}/bb`, esplora: `${url.origin}/esplora/api` }, sources }, null, 2), 'application/json', h);
    }

    // Explorer pages and broadcast pages: the app links to them through its first source.
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/bb\/(tx|address)\/([0-9a-zA-Z]+)$/)) && bb[0]) return Response.redirect(`${explorerOf('bb', bb[0])}/${m[1]}/${m[2]}`, 302);
    if (p === '/bb/sendtx' && bb[0]) return Response.redirect(`${explorerOf('bb', bb[0])}/sendtx`, 302);
    if ((m = p.match(/^\/esplora\/(tx|address)\/([0-9a-zA-Z]+)$/)) && es[0]) return Response.redirect(`${explorerOf('esplora', es[0])}/${m[1]}/${m[2]}`, 302);
    if (p === '/esplora/tx/push' && es[0]) return Response.redirect(`${explorerOf('esplora', es[0])}/tx/push`, 302);

    // The APIs.
    const kind: Kind | undefined = p.startsWith('/bb/api/') ? 'bb' : p.startsWith('/esplora/api/') ? 'esplora' : undefined;
    if (!kind) return reply(404, JSON.stringify({ error: 'not found' }), 'application/json', h);
    const path = kind === 'bb' ? p.slice('/bb'.length) : p.slice('/esplora/api'.length);

    if (req.method === 'POST') {
      if ((kind === 'bb' && /^\/api\/v2\/sendtx\/?$/.test(path)) || (kind === 'esplora' && path === '/tx')) {
        const hex = await req.text();
        if (hex.length > 400_000) return reply(413, JSON.stringify({ error: 'too large' }), 'application/json', h);
        return broadcast(kind, env, hex, h);
      }
      return reply(404, JSON.stringify({ error: 'not found' }), 'application/json', h);
    }
    if (req.method !== 'GET') return reply(405, JSON.stringify({ error: 'method not allowed' }), 'application/json', h);
    if (!GET_PATHS[kind].some(r => r.test(path))) return reply(404, JSON.stringify({ error: 'not found' }), 'application/json', h);

    let search = '';
    if (kind === 'bb') {
      const q = new URLSearchParams();
      for (const k of BB_QUERY) {
        const v = url.searchParams.get(k);
        if (v !== null && /^[a-z0-9]{1,12}$/i.test(v)) q.set(k, v);
      }
      search = q.size ? `?${q}` : '';
    }
    return read(kind, kind === 'bb' ? bb : es, path, search, h);
  },
};
