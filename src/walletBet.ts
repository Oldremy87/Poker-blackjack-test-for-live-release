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
const toNum = (v: string | number | bigint): number =>
  typeof v === 'bigint' ? Number(v) : typeof v === 'string' ? Number(v) : v;

// NOTE: adjust DECIMALS if your minor units aren't 2 d.p.
const DECIMALS = 2;
const fromMinor = (n: number) => n / Math.pow(10, DECIMALS);

  // --- wallet + account
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error('Wallet export missing');

  const wallet  = new WalletCtor(seed, net);
  await wallet.initialize();

  const account = wallet.accountStore.getAccount('2.0');
  if (!account) throw new Error('DApp account (2.0) not found.');
  const address = account.getPrimaryAddressKey().address; 
  const kiblBal = await rostrumProvider.getTokensBalance(address, KIBL_TOKEN_HEX);
  const nexaBal=  await rostrumProvider.getBalance (address);

const kiblMinor = toNum(kiblBal.confirmed[KIBL_TOKEN_HEX]);
const nexaMinor = toNum(nexaBal.confirmed);

  const balances = {
  kiblMinor,
  kibl: fromMinor(kiblMinor),

  nexaMinor,
  nexa: fromMinor(nexaMinor),

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
  const net = 'mainnet'
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
  const { wallet, account, address, network } = await loadWallet(passphrase);
  const CSRF = await csrf();

  const house = 'nexa:nqtsq5g5pvucuzm2kh92kqtxy5s3zfutq3xgnhh5src65fc3';  // Hardcode your house address

  // Pre-check balances client-side
  const kiblBal = await rostrumProvider.getTokensBalance(address, tokenIdHex);
  const nexaBal = await rostrumProvider.getBalance(address);
  if (Number(kiblBal.confirmed[tokenIdHex] || 0) < kiblAmount) throw new Error('Insufficient KIBL');
  if (Number(nexaBal.confirmed || 0) < feeNexa) throw new Error('Insufficient NEXA');

  console.log('[placeBet] Building TX client-side from', address, 'kiblAmount', kiblAmount, 'tokenIdHex', tokenIdHex, 'feeNexa', feeNexa);

  // Build, populate, sign, and build hex client-side
  const tx = wallet.newTransaction(account);  // Pass account if required by SDK
  tx.onNetwork(network);
  tx.sendTo(house, feeNexa.toString());  // NEXA to house (for fee)
  tx.sendToToken(house, kiblAmount.toString(), tokenIdHex);  // Tokens to house
  // tx.melt(tokenIdHex, kiblAmount.toString());  // Uncomment if burning is needed for bet commitment
  await tx.populate();  // Fetches and selects UTXOs client-side
  const signedTx = await tx.sign().build();  // Sign and get signed hex

  console.log('[placeBet] Signed HEX len', signedTx?.length);

  // Broadcast client-side
  const txId = await wallet.sendTransaction(signedTx)
  console.log('Transaction ID:', txId)

  return { txId, network, address, house };
}
