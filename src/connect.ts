// src/connect.ts
import { Buffer } from 'buffer';
import process from 'process';
import * as nodeCrypto from 'crypto-browserify';
(globalThis as any).Buffer  ||= Buffer;
(globalThis as any).process ||= process;
(globalThis as any).__nodeCrypto = nodeCrypto;


const KEY = 'kk_wallet_v1';
const IV  = 'kk_wallet_iv_v1';

async function ensureCsrf(): Promise<string> {
  if ((window as any).csrfToken) return (window as any).csrfToken;
  const r = await fetch('/api/csrf', { credentials: 'include' }); // sets _csrf cookie + returns token
  if (!r.ok) throw new Error(`CSRF fetch failed: ${r.status}`);
  const { csrfToken } = await r.json();
  (window as any).csrfToken = csrfToken;
  return csrfToken;
}

async function postJSON(url: string, body: any) {
  const csrf = await ensureCsrf();
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrf },
    body: JSON.stringify(body),
  });
  let j: any = null;
  try { j = await r.json(); } catch {}
  if (!r.ok || (j && j.ok === false)) {
    const msg = j?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
}

function normalizeSeed(raw: string): string {
  // lowercase, strip non-letters, collapse whitespace
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function require12Words(seed: string): string {
  const words = seed.split(' ');
  if (words.length !== 12) {
    throw new Error(`Seed must be exactly 12 words (got ${words.length}).`);
  }
  return seed;
}

async function aesKey(pass: string) {
  const raw = new TextEncoder().encode(pass);
  const h   = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function enc(pass: string, data: string) {
    if (!pass || pass.length < 8) throw new Error('Password must be 8+ characters.');
  const key = await aesKey(pass);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(data));
  localStorage.setItem(IV,  btoa(String.fromCharCode(...iv)));
  localStorage.setItem(KEY, btoa(String.fromCharCode(...new Uint8Array(ct))));
   localStorage.setItem('kk_has_pass', '1');
}
async function dec(pass: string) {
  const key = await aesKey(pass);
  const ivb = atob(localStorage.getItem(IV) || '');
  const iv  = new Uint8Array([...ivb].map(c=>c.charCodeAt(0)));
  const ctb = atob(localStorage.getItem(KEY) || '');
  const ct  = new Uint8Array([...ctb].map(c=>c.charCodeAt(0)));
  const pt  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function init() {
  const netSel     = document.getElementById('net')        as HTMLSelectElement;
  const passEl     = document.getElementById('pass')       as HTMLInputElement;
  const btnCreate  = document.getElementById('btnCreate')  as HTMLButtonElement;
  const btnImport  = document.getElementById('btnImport')  as HTMLButtonElement;
  const importArea = document.getElementById('importArea') as HTMLElement;
  const seedIn     = document.getElementById('seedIn')     as HTMLTextAreaElement;
  const btnDoImport= document.getElementById('btnDoImport')as HTMLButtonElement;
  const linked     = document.getElementById('linked')     as HTMLElement;
  const addrText   = document.getElementById('addr')       as HTMLElement;
  const btnLink    = document.getElementById('btnLink')    as HTMLButtonElement;

  let wallet: any = null;
  let account: any = null;
  let address: string | null = null;

async function bootFromSeed(seed: string, net: 'mainnet'|'testnet') {
  const wallet = new Wallet(seed, net);
  await wallet.initialize();
  const account = wallet.accountStore.getAccount('2.0');
  const k = account.getPrimaryAddressKey();
  return { wallet, account, address: k.address };
}

  btnCreate?.addEventListener('click', async () => {
    try {
      const pass = passEl.value || '';
      const net  = (netSel.value === 'mainnet' );
      const w = Wallet.create();
      const seed = w.export().phrase;
      await enc(pass, JSON.stringify({ seed, net }));
      const r = await bootFromSeed(seed, 'mainnet');
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
      alert('New wallet created. Write down your seed!');
    } catch (e:any) {
      alert(e?.message || 'Failed to create wallet.');
    }
  });

  btnImport?.addEventListener('click', () => { importArea.hidden = !importArea.hidden; });

  btnDoImport?.addEventListener('click', async () => {
    try {
      const pass = passEl.value || '';
      const net  = (netSel.value === 'mainnet');
      const seed = require12Words(normalizeSeed(seedIn.value));
      await enc(pass, JSON.stringify({ seed, net }));
      const r = await bootFromSeed(seed, 'mainnet');
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
      alert('Imported wallet. Seed stored encrypted locally.');
    } catch (e:any) {
      alert(e?.message || 'Failed to import seed.');
    }
  });

btnLink?.addEventListener('click', async () => {
  try {
    if (!address) return alert('No address yet.');
    const net = (netSel.value === 'mainnet' ? 'mainnet' : 'testnet');
    const j = await postJSON('/api/wallet/link', { address, network: net });
    alert('Wallet linked!');
    location.href = '/play.html';
  } catch (e:any) {
    alert('Link failed: ' + (e?.message || 'unknown'));
  }
});

// and on load, prime CSRF (optional but nice)
addEventListener('DOMContentLoaded', () => { ensureCsrf().catch(()=>{}); });
  // auto-load from storage on pass change
  passEl?.addEventListener('change', async () => {
    try {
      if (!localStorage.getItem(KEY)) return;
      const { seed, net } = JSON.parse(await dec(passEl.value || ''));
      netSel.value = net;
      const r = await bootFromSeed(seed, net as any);
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
    } catch {}
  });
}
function passOk(p: string, p2: string) {
  return (p?.length ?? 0) >= 8 && p === p2;
}
async function loadKiblBalance(address: string, net: string) {
  const r = await fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}&network=${encodeURIComponent(net)}`, { credentials:'include' });
  if (!r.ok) throw new Error('balance_http');
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'balance_api');
  return j; // { kiblMinor, kibl, ... }
}

// after you set addrText & linked.hidden=false:
try {
  const bal = await loadKiblBalance(address!, 'mainnet');
  const balEl = document.getElementById('kiblBalance');
  if (balEl) balEl.textContent = `KIBL: ${bal.kibl} (${bal.kiblMinor} minor)`;
} catch { /* ignore; can retry with a refresh button */ }


const passEl  = document.getElementById('pass')  as HTMLInputElement;
const pass2El = document.getElementById('pass2') as HTMLInputElement;
const btnCreate = document.getElementById('btnCreate') as HTMLButtonElement;
const btnImport = document.getElementById('btnImport') as HTMLButtonElement;
const passHint  = document.getElementById('passHint')  as HTMLElement;

function refreshPassUI() {
  const ok = passOk(passEl.value, pass2El.value);
  btnCreate.disabled = btnImport.disabled = !ok;
  passHint.hidden = ok;
}
passEl.addEventListener('input', refreshPassUI);
pass2El.addEventListener('input', refreshPassUI);
refreshPassUI();


addEventListener('DOMContentLoaded', init);