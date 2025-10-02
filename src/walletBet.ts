// src/walletBet.ts
import { Buffer } from 'buffer';
import process from 'process';
import * as nodeCrypto from 'crypto-browserify';
(globalThis as any).Buffer  ||= Buffer;
(globalThis as any).process ||= process;
(globalThis as any).__nodeCrypto = nodeCrypto;

const KEY='kk_wallet_v1', IV='kk_wallet_iv_v1';

// Fill these from your config / env / window:
const KIBL_GROUP_ADDR = 'nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt';
const KIBL_TOKEN_HEX  = '656bfefce8a0885acba5c809c5afcfbfa62589417d84d54108e6bb42a6f30000';

async function getSdk() {
  return await import('nexa-wallet-sdk'); // vite alias -> browser ESM build
}
function getWalletCtor(mod: any) {
  return mod?.Wallet ?? mod?.default?.Wallet;
}
function toFixedFromMinor(minorBn: bigint, decimals: number): string {
  const s = minorBn.toString();
  if (decimals === 0) return s;
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  const pad = Math.max(0, decimals - digits.length);
  const left = digits.length > decimals ? digits.slice(0, -decimals) : '0';
  const right = (pad ? '0'.repeat(pad) : '') + digits.slice(-decimals).padStart(decimals, '0');
  return (neg ? '-' : '') + `${left}.${right}`;
}

export async function loadWallet(pass: string) {
  // --- decrypt local keystore
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
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt)); // net: 'mainnet'|'testnet'

  // --- SDK + provider
  const sdk = await getSdk();
  const { rostrumProvider } = sdk;

  // connect once (guard against duplicate connects)
  try {
    const host = net === 'mainnet' ? 'electrum.nexa.org' : 'testnet-electrum.nexa.org';
    const port = net === 'mainnet' ? 20004 : 30004;
    const scheme = 'wss';
    await rostrumProvider.connect?.({ host, port, scheme });
  } catch (_) {
    // ignore if already connected or if connect() isn't idempotent
  }

  // --- wallet + account
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error('Wallet export missing');

  const wallet  = new WalletCtor(seed, net);
  await wallet.initialize();

  const account = wallet.accountStore.getAccount('2.0');
  if (!account) throw new Error('DApp account (2.0) not found.');
  const address = account.getPrimaryAddressKey().address; // nexa:...

  // --- balances via rostrum UTXOs (authoritative)
  // KIBL has 2 decimals; NEXA has 8 decimals
  let kiblMinor = 0n;
  let nexaMinor = 0n;
  let tokenUtxoCount = 0;
  let nexaUtxoCount = 0;

  try {
    const [tokenUtxos, nexaUtxos] = await Promise.all([
      rostrumProvider.getTokenUtxos(address, KIBL_TOKEN_HEX),
      rostrumProvider.getNexaUtxos(address),
    ]);

    for (const u of tokenUtxos || []) kiblMinor += BigInt(u?.value || 0);
    for (const u of nexaUtxos || [])  nexaMinor += BigInt(u?.value || 0);

    tokenUtxoCount = (tokenUtxos || []).length;
    nexaUtxoCount  = (nexaUtxos  || []).length;
  } catch (e) {
    // If this fails, keep going — caller can decide how to handle unknown balances
    console.warn('[loadWallet] balance fetch failed', e);
  }

  const balances = {
    kiblMinor: kiblMinor,
    kibl: toFixedFromMinor(kiblMinor, 2),
    tokenUtxoCount,
    nexaMinor: nexaMinor,
    nexa: toFixedFromMinor(nexaMinor, 8),
    nexaUtxoCount,
    // Handy ids for callers:
    tokenHex: KIBL_TOKEN_HEX,
    tokenGroup: KIBL_GROUP_ADDR,
  };

  return { wallet, account, address, network: net, balances };
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
  console.log('[placeBet] from', address, 'kiblAmount', kiblAmount, 'tokenIdHex', tokenIdHex, 'feeNexa', feeNexa);
  const r = await fetch('/api/bet/build-unsigned', {
    method:'POST',
    credentials:'include',
    headers:{ 'Content-Type':'application/json', 'CSRF-Token': CSRF },
    body: JSON.stringify({ fromAddress: address, kiblAmount, tokenIdHex, feeNexa })
  });
  const j = await r.json().catch(()=> ({} as any));
  console.log('[placeBet] build-unsigned response ok?', r.ok, 'payload keys', Object.keys(j || {}));
  if (!r.ok || !j.ok) throw new Error(j?.error || 'build_unsigned_failed');

  // 2) Sign in browser
  console.log('[placeBet] signing…');
  const signedTx = await wallet.newTransaction(account, j.unsignedTx).sign().build();
  console.log('[placeBet] signedHex len', signedTx?.length);

  // 3) Broadcast via server
  const br = await fetch('/api/tx/broadcast', {
    method:'POST',
    credentials:'include',
    headers:{ 'Content-Type':'application/json', 'CSRF-Token': CSRF },
    body: JSON.stringify({ hex: signedTx })
  });
  const bj = await br.json().catch(()=> ({} as any));
  console.log('[placeBet] broadcast ok?', br.ok, 'payload', bj);
  if (!br.ok || !bj.ok) throw new Error(bj?.error || 'broadcast_failed');

  return { txId: bj.txid, network, address, house: j.house };
}
