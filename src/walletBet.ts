// src/walletBet.ts
import { Buffer } from 'buffer';
import process from 'process';
import * as nodeCrypto from 'crypto-browserify';
(globalThis as any).Buffer  ||= Buffer;
(globalThis as any).process ||= process;
(globalThis as any).__nodeCrypto = nodeCrypto;
async function sdk() {
  return await import('nexa-wallet-sdk'); // aliased to browser ESM
}
const KEY='kk_wallet_v1', IV='kk_wallet_iv_v1';

async function loadWallet(pass: string){
  const rawB64 = localStorage.getItem(KEY) || '';
  if (!rawB64) throw new Error('No local wallet. Visit Connect.');
  const ivB64  = localStorage.getItem(IV)  || '';

  const raw = atob(rawB64);
  const ivb = atob(ivB64);
  const iv  = new Uint8Array([...ivb].map(c=>c.charCodeAt(0)));
  const ct  = new Uint8Array([...raw].map(c=>c.charCodeAt(0)));

  const h   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass));
  const key = await crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['decrypt']);
  const pt  = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);

  const { seed, net } = JSON.parse(new TextDecoder().decode(pt));
  const { Wallet, rostrumProvider } = await sdk();
  await rostrumProvider.connect(net);
  const w = new Wallet(seed, net);
  await w.initialize();
  const acct = w.accountStore.getAccount('2.0');
  if (!acct) throw new Error('DApp account (2.0) not found. Open Connect and (re)create/import your wallet.');
  const addr = acct.getPrimaryAddressKey().address;
  return { wallet: w, account: acct, address: addr, network: net };
}

export async function placeBet({ passphrase, kiblAmount, tokenIdHex, feeNexa }:{
  passphrase: string; kiblAmount: number; tokenIdHex: string; feeNexa: number;
}){
  const { wallet, account, address, network } = await loadWallet(passphrase);
  const {rostrumProvider} =await sdk();
  await rostrumProvider.connect('mainnet');
  const r = await fetch('/api/bet/build-unsigned', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'CSRF-Token': (window as any).csrfToken || '' },
    body: JSON.stringify({ fromAddress: address, kiblAmount, tokenIdHex, feeNexa })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'build_unsigned_failed');

  const signed = await wallet.newTransaction(account, j.unsignedTx).sign().build();
  const txId   = await wallet.sendTransaction(signed);

  return { txId, network, address, house: j.house };
}
