// src/connect.ts
import { Wallet, rostrumProvider } from 'nexa-wallet-sdk';
// src/polyfills.ts
import { Buffer } from 'buffer';
if (!(globalThis as any).Buffer)  (globalThis as any).Buffer = Buffer;
if (!(globalThis as any).global)  (globalThis as any).global = globalThis;
if (!(globalThis as any).process) (globalThis as any).process = { env: {} } as any;
import './polyfills';
const KEY = 'kk_wallet_v1';
const IV  = 'kk_wallet_iv_v1';

async function aesKey(pass: string) {
  const raw = new TextEncoder().encode(pass);
  const h   = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function enc(pass: string, data: string) {
  const key = await aesKey(pass);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(data));
  localStorage.setItem(IV,  btoa(String.fromCharCode(...iv)));
  localStorage.setItem(KEY, btoa(String.fromCharCode(...new Uint8Array(ct))));
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

  async function connectNetwork() {
    const net = netSel.value === 'mainnet' ? 'mainnet' : 'testnet';
    await rostrumProvider.connect(net);
  }

  async function bootFromSeed(seed: string, net: string) {
    await connectNetwork();
    wallet = new Wallet(seed, net);
    await wallet.initialize();
    account = wallet.accountStore.getAccount('2.0');
    const k = account.getPrimaryAddressKey();
    address = k.address;
    addrText.textContent = `Linked address (${net}): ${address}`;
    linked.hidden = false;
  }

  btnCreate?.addEventListener('click', async () => {
    const pass = passEl.value || '';
    const net  = netSel.value;
    const w = Wallet.create();
    const seed = w.export().phrase;
    await enc(pass, JSON.stringify({ seed, net }));
    await bootFromSeed(seed, net);
    alert('New wallet created. Write down your seed!');
  });

  btnImport?.addEventListener('click', () => { importArea.hidden = !importArea.hidden; });
  btnDoImport?.addEventListener('click', async () => {
    const pass = passEl.value || '';
    const net  = netSel.value;
    const seed = (seedIn.value || '').trim();
    if (!seed) return alert('Enter a 12-word seed');
    await enc(pass, JSON.stringify({ seed, net }));
    await bootFromSeed(seed, net);
    alert('Imported wallet. Seed stored encrypted locally.');
  });

  btnLink?.addEventListener('click', async () => {
    const res = await fetch('/api/wallet/link', {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'CSRF-Token': (window as any).csrfToken || '' },
      body: JSON.stringify({ address, network: netSel.value })
    });
    const j = await res.json();
    if (!j.ok) return alert('Link failed: ' + (j.error || 'unknown'));
    alert('Wallet linked!');
    location.href = '/play.html';
  });

  passEl?.addEventListener('change', async () => {
    try {
      if (!localStorage.getItem(KEY)) return;
      const { seed, net } = JSON.parse(await dec(passEl.value || ''));
      netSel.value = net;
      await bootFromSeed(seed, net);
    } catch {}
  });
}
addEventListener('DOMContentLoaded', init);