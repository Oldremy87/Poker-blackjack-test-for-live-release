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
const MAINNET = {
  scheme: 'wss' as const,
  host: 'electrum.nexa.org',
  port: 20004,
};
async function connectMainnet(rostrumProvider: any) {
  // reuse a global flag to avoid duplicate connects across hot reloads
  if ((globalThis as any).__kk_rostrum_mainnet_ok) return;
  await rostrumProvider.connect(MAINNET); // explicit mainnet endpoint
  (globalThis as any).__kk_rostrum_mainnet_ok = true;
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
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt)); // 'mainnet'|'testnet'

  // --- SDK + provider
  const sdk = await getSdk();
  const { rostrumProvider } = sdk;

await connectMainnet(rostrumProvider);

  // --- wallet + account
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error('Wallet export missing');

  const wallet  = new WalletCtor(seed, net);
  await wallet.initialize();

  const account = wallet.accountStore.getAccount('2.0');
  if (!account) throw new Error('DApp account (2.0) not found.');
  const address = account.getPrimaryAddressKey().address; // nexa:...

  // ✅ Use account aggregates (no UTXO math)
  const nexaMinor = Number(account.balance?.confirmed || 0);
  const kiblMinor = Number(account.tokenBalances?.[KIBL_GROUP_ADDR]?.confirmed || 0);

  const DEC = 2;
  const balances = {
    kiblMinor,
    kibl: (kiblMinor / 10 ** DEC),
    nexaMinor,
    nexa: (nexaMinor / 10 ** DEC),
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

function cleanNexa(addr: string): string {
  const m = String(addr || '').match(/^(nexa:[a-z0-9]+)/i);
  return m ? m[1] : '';
}

export async function placeBet({
  passphrase,
  kiblAmount,   // minor units (e.g. 10000 = 100.00 KIBL)
  tokenIdHex,   // you can ignore this if you already have KIBL_GROUP_ADDR
  feeNexa       // minor units (e.g. 600 = 6.00 NEXA, if 2 decimals)
}: {
  passphrase: string; kiblAmount: number; tokenIdHex: string; feeNexa: number;
}) {
  if (!passphrase || passphrase.length < 8) throw new Error('Password required (8+ chars).');

  // Load wallet + ensure provider connectivity (same endpoint as server)
  const net = 'mainnet';
  const sdk = await getSdk();
  const { rostrumProvider } = sdk;
await connectMainnet(rostrumProvider);


  const { wallet, account, address, network } = await loadWallet(passphrase);
  const from = cleanNexa(address);

  // House/token constants (bech32 token id for sendToToken)
  const HOUSE_ADDR = 'nexa:nqtsq5g5pvucuzm2kh92kqtxy5s3zfutq3xgnhh5src65fc3';
  const TOKEN_ID   = KIBL_GROUP_ADDR; // SDK accepts bech32 token id

  // Quick pre-checks (authoritative aggregates)
  const nexaMinor = Number(account.balance?.confirmed || 0);
  const kiblMinor = Number(account.tokenBalances?.[KIBL_GROUP_ADDR]?.confirmed || 0);
  if (kiblMinor < kiblAmount) throw new Error('Insufficient KIBL');
  if (nexaMinor < feeNexa)    throw new Error('Insufficient NEXA');

  // ✅ Build + sign entirely on client
  // - UTXOs selected from the user's own address set
  // - change forced back to user's address
  const signedHex = await wallet.newTransaction()
    .sendTo(HOUSE_ADDR, String(feeNexa))                  // NEXA (minor units)
    .sendToToken(HOUSE_ADDR, String(kiblAmount), TOKEN_ID) // KIBL (minor units)
    .populate()
    .sign()
    .build();

  // Broadcast via your server (keeps your CSRF, logs, etc.)
  const CSRF = await csrf();
  const br = await fetch('/api/tx/broadcast', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
    body: JSON.stringify({ hex: signedHex })
  });
  const bj = await br.json().catch(() => ({} as any));
  if (!br.ok || !bj.ok) throw new Error(bj?.error || 'broadcast_failed');

  return { txId: bj.txid, network, address: from, house: HOUSE_ADDR };
}