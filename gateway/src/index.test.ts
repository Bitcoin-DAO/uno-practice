import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RawTx } from '@scure/btc-signer';
import worker, { reset, txidOf, type Env } from './index';

const env: Env = {
  ALLOWED_ORIGINS: 'https://bitcoin-dao.github.io',
  BLOCKBOOK: 'https://bb.example',
  ESPLORA: 'https://es1.example/testnet4/api,https://es2.example/api',
  RATE_PER_MIN: '1000',
};
const GW = 'https://gw.example';
const SITE = 'https://bitcoin-dao.github.io';
const A = 'tb1qkm0skv9ylrn49r6lxcqt7eajq4q5qv5fhch645u4rkdgx90hrpjq5mzp82';

// A small valid transaction (one input, one output), as a hex string, and its id.
const raw = RawTx.encode({
  version: 2,
  segwitFlag: false,
  inputs: [{ txid: new Uint8Array(32).fill(1), index: 0, finalScriptSig: new Uint8Array(), sequence: 0xfffffffd }],
  outputs: [{ amount: 1000n, script: new Uint8Array([0x00, 0x14, ...new Uint8Array(20).fill(2)]) }],
  witnesses: [],
  lockTime: 0,
});
const HEX = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');

const get = (path: string, origin: string | null = SITE, ip = '1.1.1.1') =>
  worker.fetch(new Request(GW + path, { headers: { ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip } }), env);
const post = (path: string, body: string) =>
  worker.fetch(new Request(GW + path, { method: 'POST', body, headers: { Origin: SITE, 'Content-Type': 'text/plain' } }), env);

let calls: string[];
let route: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  reset();
  calls = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return route(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

const json = (v: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } }));

describe('reading', () => {
  it('passes a Blockbook request on and lets the DAO site read the answer', async () => {
    route = () => json({ address: A, balance: '4819', txs: 2 });
    const r = await get(`/bb/api/v2/address/${A}?details=basic&evil=<script>`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(await r.json()).toEqual({ address: A, balance: '4819', txs: 2 });
    expect(calls).toEqual([`GET https://bb.example/api/v2/address/${A}?details=basic`]); // unknown query dropped
  });

  it('asks the next Esplora source when one does not answer', async () => {
    route = url => (url.startsWith('https://es1') ? Promise.reject(new TypeError('Failed to fetch')) : json({ confirmed: false }));
    const r = await get(`/esplora/api/tx/${'ab'.repeat(32)}/status`);
    expect(await r.json()).toEqual({ confirmed: false });
    expect(r.headers.get('X-Gateway-Source')).toBe('es2.example');
    expect(calls).toHaveLength(2);
  });

  it('reuses an answer for a short while, so open pages share one reading', async () => {
    route = () => json({ address: A, balance: '0' });
    await get(`/bb/api/v2/address/${A}?details=basic`);
    const r = await get(`/bb/api/v2/address/${A}?details=basic`, SITE, '2.2.2.2');
    expect(r.headers.get('X-Gateway-Cache')).toBe('hit');
    expect(calls).toHaveLength(1);
  });

  it('returns a real "not found" as an answer, after asking every source', async () => {
    route = () => json({ error: 'txid not found' }, 400);
    const r = await get(`/bb/api/v2/tx/${'cd'.repeat(32)}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'txid not found' });
  });

  it('says which sources failed when none answers', async () => {
    route = url => (url.startsWith('https://es1') ? Promise.reject(new TypeError('Failed to fetch')) : json({}, 503));
    const r = await get(`/esplora/api/address/${A}`);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toMatch(/es1\.example: Failed to fetch · es2\.example: 503/);
  });

  it('passes on only the requests the app makes', async () => {
    route = () => json({});
    expect((await get('/bb/api/v2/xpub/tpubD6Nz')).status).toBe(404);
    expect((await get('/esplora/api/mempool/recent')).status).toBe(404);
    expect((await get('/somewhere')).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe('who may use it', () => {
  it('refuses pages of other sites, allows localhost and direct visits', async () => {
    route = () => json({ ok: 1 });
    expect((await get(`/bb/api/v2/utxo/${A}`, 'https://evil.example')).status).toBe(403);
    expect((await get(`/bb/api/v2/utxo/${A}`, 'http://localhost:5173')).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect((await get('/status', null)).status).toBe(200);
  });

  it('answers the browser preflight', async () => {
    const r = await worker.fetch(new Request(GW + '/bb/api/v2/sendtx/', { method: 'OPTIONS', headers: { Origin: SITE } }), env);
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('limits requests per visitor', async () => {
    route = () => json({});
    const tight = { ...env, RATE_PER_MIN: '2' };
    const one = () => worker.fetch(new Request(`${GW}/esplora/api/blocks/tip/height`, { headers: { Origin: SITE, 'CF-Connecting-IP': '9.9.9.9' } }), tight);
    expect((await one()).status).toBe(200);
    expect((await one()).status).toBe(200);
    const r = await one();
    expect(r.status).toBe(429);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(SITE); // so the app can read "too many requests"
  });
});

describe('broadcasting', () => {
  it('computes the id the same way as the transaction library, with and without witnesses', async () => {
    const { Transaction, p2wpkh } = await import('@scure/btc-signer');
    const key = new Uint8Array(32).fill(7);
    const { secp256k1 } = await import('@noble/curves/secp256k1');
    const pub = secp256k1.getPublicKey(key, true);
    const pay = p2wpkh(pub);
    const t = new Transaction();
    t.addInput({ txid: new Uint8Array(32).fill(3), index: 1, witnessUtxo: { script: pay.script, amount: 10_000n } });
    t.addOutput({ script: pay.script, amount: 9_000n });
    t.sign(key);
    t.finalize();
    expect(await txidOf(t.extract())).toBe(t.id);
    expect(await txidOf(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends to every source and succeeds if one accepts, in Blockbook format', async () => {
    const id = await txidOf(raw);
    route = async (url, init) => {
      expect(String(init?.body)).toBe(HEX);
      if (url === 'https://es2.example/api/tx') return new Response(id, { status: 200 });
      return new Response('error', { status: 400 });
    };
    const r = await post('/bb/api/v2/sendtx/', HEX);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ result: id });
    expect(calls.filter(c => c.startsWith('POST')).sort()).toEqual([
      'POST https://bb.example/api/v2/sendtx/',
      'POST https://es1.example/testnet4/api/tx',
      'POST https://es2.example/api/tx',
    ]);
  });

  it('says why when no source accepts', async () => {
    route = async () => new Response('min relay fee not met', { status: 400 });
    const r = await post('/bb/api/v2/sendtx/', HEX);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/no source accepted it: bb\.example: 400 · es1\.example: min relay fee not met · es2\.example: min relay fee not met/);
  });

  it('counts "already known" as accepted, and answers in Esplora format on the Esplora path', async () => {
    route = async () => new Response('sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}', { status: 400 });
    const r = await post('/esplora/api/tx', HEX);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(await txidOf(raw));
  });

  it('refuses something that is not a transaction without asking anyone', async () => {
    route = () => json({});
    const r = await post('/bb/api/v2/sendtx/', 'deadbeef');
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('explorer pages', () => {
  it('sends transaction links and the broadcast page to the first source\'s explorer', async () => {
    const t = 'ef'.repeat(32);
    expect((await get(`/bb/tx/${t}`)).headers.get('Location')).toBe(`https://bb.example/tx/${t}`);
    expect((await get('/bb/sendtx')).headers.get('Location')).toBe('https://bb.example/sendtx');
    expect((await get(`/esplora/tx/${t}`)).headers.get('Location')).toBe(`https://es1.example/testnet4/tx/${t}`);
    expect((await get('/esplora/tx/push')).headers.get('Location')).toBe('https://es1.example/testnet4/tx/push');
  });
});
