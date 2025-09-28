// src/walletBet.ts
import { Buffer } from 'buffer';
import process from 'process';
import * as nodeCrypto from 'crypto-browserify';
(globalThis as any).Buffer  ||= Buffer;
(globalThis as any).process ||= process;
(globalThis as any).__nodeCrypto = nodeCrypto;

const KEY='kk_wallet_v1', IV='kk_wallet_iv_v1';

async function getSdk() {
  return await import('nexa-wallet-sdk'); // vite alias points to browser ESM build
}
function getWalletCtor(mod: any) {
  return mod?.Wallet ?? mod?.default?.Wallet;
}

async function loadWallet(pass: string){
  const rawB64 = localStorage.getItem(KEY);
  const ivB64  = localStorage.getItem(IV);
  if (!rawB64 || !ivB64) throw new Error('No local wallet. Visit Connect.');

  const raw = atob(rawB64);
  const ivb = atob(ivB64);
  const iv  = new Uint8Array([...ivb].map(c=>c.charCodeAt(0)));
  const ct  = new Uint8Array([...raw].map(c=>c.charCodeAt(0)));

  const h   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass));
  const key = await crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['decrypt']);
  const pt  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt));

  const sdk = await getSdk();
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error('Wallet export missing');

  const wallet  = new WalletCtor(seed, net);  // sign-only, no provider
  await wallet.initialize();
  const account = wallet.accountStore.getAccount('2.0');
  if (!account) throw new Error('DApp account (2.0) not found.');
  const address = account.getPrimaryAddressKey().address;

  return { wallet, account, address, network: net };
}

async function csrf() {
  if ((window as any).csrfToken) return (window as any).csrfToken;
  const r = await fetch('/api/csrf', { credentials:'include' });
  const j = await r.json();
  (window as any).csrfToken = j.csrfToken;
  return j.csrfToken;
}

export async function placeBet({ passphrase, kiblAmount, tokenIdHex, feeNexa }: {
  passphrase: string; kiblAmount: number; tokenIdHex: string; feeNexa: number;
}) {
  if (!passphrase || passphrase.length < 8) throw new Error('Password required (8+ chars).');

  const { wallet, account, address, network } = await loadWallet(passphrase);
  const CSRF = await csrf();

  // 1) Build unsigned via your server (server talks to Rostrum)
  const r = await fetch('/api/bet/build-unsigned', {
    method:'POST',
    credentials:'include',
    headers:{ 'Content-Type':'application/json', 'x-csrf-token': CSRF },
    body: JSON.stringify({ fromAddress: address, kiblAmount, feeNexa })
  });
  const j = await r.json().catch(()=> ({} as any));
  if (!r.ok || !j.ok) throw new Error(j?.error || 'build_unsigned_failed');

  // 2) Sign in browser
  const signedHex = await wallet.newTransaction(account, j.unsignedTx).sign().build();

  // 3) Broadcast via server
  const br = await fetch('/api/tx/broadcast', {
    method:'POST',
    credentials:'include',
    headers:{ 'Content-Type':'application/json', 'x-csrf-token': CSRF },
    body: JSON.stringify({ hex: signedHex })
  });
  const bj = await br.json().catch(()=> ({} as any));
  if (!br.ok || !bj.ok) throw new Error(bj?.error || 'broadcast_failed');

  return { txId: bj.txid, network, address, house: j.house };
}
