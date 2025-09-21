// public/connect.js  (ESM)
const SDK_URL = 'https://esm.sh/nexa-wallet-sdk@latest?bundle&target=es2022';

let Wallet, rostrumProvider, WatchOnlyWallet;
try {
  ({ Wallet, rostrumProvider, WatchOnlyWallet } = await import(SDK_URL));
} catch (e) {
  console.error('SDK load failed:', e);
  alert('Unable to load the Nexa wallet SDK. Check your network and CSP.');
}
// After the import try/catch
if (!Wallet || !rostrumProvider) {
  // Hard-disable the buttons so we don’t attach dead handlers
  addEventListener('DOMContentLoaded', () => {
    for (const id of ['btnCreate','btnImport','btnDoImport','btnLink']) {
      const b = document.getElementById(id);
      if (b) b.disabled = true;
    }
  });
  // Stop here (the alert above already told the user)
} else {
  // Only initialize if SDK is present
  addEventListener('DOMContentLoaded', init);
}

const KEY = 'kk_wallet_v1'; // localStorage blob (encrypted)
const IV  = 'kk_wallet_iv_v1';

async function aesKey(pass) {
  const raw = new TextEncoder().encode(pass);
  const h   = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function enc(pass, data) {
  const key = await aesKey(pass);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(data));
  localStorage.setItem(IV, btoa(String.fromCharCode(...iv)));
  localStorage.setItem(KEY, btoa(String.fromCharCode(...new Uint8Array(ct))));
}
async function dec(pass) {
  const key = await aesKey(pass);
  const ivb = atob(localStorage.getItem(IV) || '');
  const iv  = new Uint8Array([...ivb].map(c=>c.charCodeAt(0)));
  const ctb = atob(localStorage.getItem(KEY) || '');
  const ct  = new Uint8Array([...ctb].map(c=>c.charCodeAt(0)));
  const pt  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function init() {
  const netSel = document.getElementById('net');
  const passEl = document.getElementById('pass');
  const btnCreate = document.getElementById('btnCreate');
  const btnImport = document.getElementById('btnImport');
  const importArea= document.getElementById('importArea');
  const seedIn    = document.getElementById('seedIn');
  const btnDoImport = document.getElementById('btnDoImport');
  const linked    = document.getElementById('linked');
  const addrText  = document.getElementById('addr');
  const btnLink   = document.getElementById('btnLink');

  let wallet = null;
  let account = null;
  let address = null;

  async function connectNetwork() {
    const net = netSel.value === 'mainnet' ? 'mainnet' : 'testnet';
    await rostrumProvider.connect(net); // SDK supports browser bundle
  }

  async function bootFromSeed(seed, net) {
    await connectNetwork();
    wallet = new Wallet(seed, net);
    await wallet.initialize(); // discover accounts
    account =  wallet.accountStore.getAccount('2.0');
    const k = account.getPrimaryAddressKey();
    address = k.address;
    addrText.textContent = `Linked address (${net}): ${address}`;
    linked.hidden = false;
  }

  btnCreate.addEventListener('click', async () => {
    const pass = passEl.value || '';
    const net  = netSel.value;
    const w = Wallet.create();               // SDK create
    const seed = w.export().phrase;          // seed phrase
    await enc(pass, JSON.stringify({ seed, net }));
    await bootFromSeed(seed, net);
    alert('New wallet created. Write down your seed!');
  });

  btnImport.addEventListener('click', () => importArea.hidden = !importArea.hidden);
  btnDoImport.addEventListener('click', async () => {
    const pass = passEl.value || '';
    const net  = netSel.value;
    const seed = (seedIn.value || '').trim();
    if (!seed) return alert('Enter a 12-word seed');
    await enc(pass, JSON.stringify({ seed, net }));
    await bootFromSeed(seed, net);
    alert('Imported wallet. Seed stored encrypted locally.');
  });

  btnLink.addEventListener('click', async () => {
    const res = await fetch('/api/wallet/link', {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'CSRF-Token': window.csrfToken || '' },
      body: JSON.stringify({ address, network: netSel.value })
    });
    const j = await res.json();
    if (!j.ok) return alert('Link failed: ' + (j.error || 'unknown'));
    alert('Wallet linked!');
    location.href = '/play.html';
  });

  // Optional: auto-load from storage if present
  // Player enters pass → we decrypt & show address
  passEl.addEventListener('change', async () => {
    try {
      if (!localStorage.getItem(KEY)) return;
      const { seed, net } = JSON.parse(await dec(passEl.value || ''));
      netSel.value = net;
      await bootFromSeed(seed, net);
    } catch {}
  });
}
passEl.addEventListener('change', async () => {
  try {
    if (!localStorage.getItem(KEY)) return;
    const { seed, net } = JSON.parse(await dec(passEl.value || ''));
    netSel.value = net;
    await bootFromSeed(seed, net);
  } catch (e) {
    alert('Could not unlock local wallet. Check your passphrase.');
  }
});

addEventListener('DOMContentLoaded', init);