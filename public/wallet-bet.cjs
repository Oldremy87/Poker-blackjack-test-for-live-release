// public/wallet-bet.cjs
import { Wallet, rostrumProvider } from 'nexa-wallet-sdk';

const KEY='kk_wallet_v1', IV='kk_wallet_iv_v1';

async function loadWallet(pass) {
  // decrypt from localStorage (same helpers as connect.js)
  const raw = atob(localStorage.getItem(KEY) || '');
  if (!raw) throw new Error('No local wallet. Visit Connect.');
  async function aesKey(pass) {
    const raw = new TextEncoder().encode(pass);
    const h   = await crypto.subtle.digest('SHA-256', raw);
    return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt','decrypt']);
  }
  const key = await (async()=>aesKey(pass))();
  const ivb = atob(localStorage.getItem(IV) || '');
  const iv  = new Uint8Array([...ivb].map(c=>c.charCodeAt(0)));
  const ct  = new Uint8Array([...raw].map(c=>c.charCodeAt(0)));
  const pt  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt));
  await rostrumProvider.connect(net);
  const w = new Wallet(seed, net);
  await w.initialize();
  const acct =  w.accountStore.getAccount('2.0');
  if (!acct) {
    throw new Error('DApp account (2.0) not found. Open Connect and (re)create/import your wallet.');
 }
  const addr = acct.getPrimaryAddressKey().address;
  return { wallet: w, account: acct, address: addr, network: net };
}

export async function placeBet({ passphrase, kiblAmount, tokenIdHex, feeNexa }) {
  const { wallet, account, address, network } = await loadWallet(passphrase);

  // ask server to build unsigned
  const r = await fetch('/api/bet/build-unsigned', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'CSRF-Token': window.csrfToken || '' },
    body: JSON.stringify({ fromAddress: address, kiblAmount, tokenIdHex, feeNexa })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'build_unsigned_failed');

  // sign + broadcast locally
  const signed = await wallet.newTransaction(account, j.unsignedTx).sign().build();
  const txId = await wallet.sendTransaction(signed);

  return { txId, network, address, house: j.house };
}
