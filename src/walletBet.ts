// src/walletBet.ts
import { Buffer } from 'buffer';
import process from 'process';
import * as nodeCrypto from 'crypto-browserify';

// Polyfills
(globalThis as any).Buffer  ||= Buffer;
(globalThis as any).process ||= process;
(globalThis as any).__nodeCrypto = nodeCrypto;

const KEY='kk_wallet_v1', IV='kk_wallet_iv_v1';

// Constants
const KIBL_GROUP_ADDR = 'nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt';
const KIBL_TOKEN_HEX  = '656bfefce8a0885acba5c809c5afcfbfa62589417d84d54108e6bb42a6f30000';
const HOUSE_ADDRESS   = 'nexa:nqtsq5g5pvucuzm2kh92kqtxy5s3zfutq3xgnhh5src65fc3';
const KIBL_TOKEN_ID   = 'nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt';

// --- NODES ---
const PRIVATE_NODE = { scheme: 'wss' as const, host: 'node.remy-dev.com', port: 443 };
const PUBLIC_NODE  = { scheme: 'wss' as const, host: 'electrum.nexa.org', port: 20004 };

// --- CACHE STATE ---
let cachedSession: {
  wallet: any;
  account: any;
  address: any;
  network: any;
  balances: any;
  sdk: any;
  // We store these so we can "Soft Repair" without asking for password
  seed: any; 
  net: any;
} | null = null;

// --- FIX 1: CONNECTION LOCK ---
// This promise holds the active reconnection attempt.
// If 5 bets come in while reconnecting, they all await this one promise.
let reconnectLock: Promise<void> | null = null;

async function getSdk() {
  return await import('nexa-wallet-sdk');
}

function getWalletCtor(mod: any) {
  return mod?.Wallet ?? mod?.default?.Wallet;
}

// Helper: Tries to connect a provider, handles the "undefined" crash
async function safeConnect(provider: any) {
  // If we can't even check isConnected, the object is bricked.
  if (!provider) throw new Error('Provider is null');

  // If already connected, we are good.
  try {
      if (provider.isConnected) return true;
  } catch (e) {
      // This catches the specific "cannot read properties of undefined" error
      // which happens when the internal socket is null.
      console.warn('[Client] Provider is in zombie state. Needs repair.');
      return false; 
  }

  console.log('[Client] Connecting network...');
  try {
    await provider.connect(PRIVATE_NODE);
    console.log('✅ Connected: Private Node');
    return true;
  } catch (e) {
    console.warn('⚠️ Private node unreachable, trying public...');
  }

  try {
    await provider.connect(PUBLIC_NODE);
    console.log('⚠️ Connected: Public Node');
    return true;
  } catch (e) {
    console.error('❌ Connection failed');
    return false;
  }
}

// --- FIX 2: REPAIR ROUTINE ---
// If the connection is dead/zombie, we create a NEW one using cached credentials.
// This is fast (ms) because we don't re-decrypt the password.
async function repairSession() {
  if (!cachedSession) return; // Can't repair what doesn't exist

  console.log('[Client] Repairing session (Soft Reset)...');
  
  const { seed, net, sdk } = cachedSession;
  const WalletCtor = getWalletCtor(sdk);

  // 1. Create a FRESH Wallet Instance (Fast)
  const newWallet = new WalletCtor(seed, net);
  
  // 2. Extract the NEW, healthy provider
  const newProvider = newWallet.rostrumProvider || newWallet.provider;

  // 3. Connect the NEW provider
  const connected = await safeConnect(newProvider);
  if (!connected) throw new Error('Could not reconnect to any node.');

  // 4. Initialize (Scan) - Unavoidable on reconnect, but necessary for sync
  console.log('[Client] Syncing...');
  await newWallet.initialize();

  // 5. Update Cache with the healthy objects
  const newAccount = newWallet.accountStore.getAccount('2.0');
  cachedSession.wallet = newWallet;
  cachedSession.account = newAccount;
  
  console.log('[Client] Session repaired.');
}

export async function loadWallet(pass: string) {
  // 1. Existing Session? Check health.
  if (cachedSession) {
    // If locked, wait for the repair to finish
    if (reconnectLock) {
        await reconnectLock;
        return cachedSession;
    }

    const { wallet } = cachedSession;
    const provider = wallet.rostrumProvider || wallet.provider;

    // Check if we need to repair
    let isHealthy = false;
    try { isHealthy = provider && provider.isConnected; } catch {}

    if (isHealthy) {
        return cachedSession; // FAST PATH (Instant)
    }

    // SLOW PATH (Repairing dropped connection)
    reconnectLock = (async () => {
        try {
            // Try simple reconnect first
            const revived = await safeConnect(provider);
            if (!revived) {
                // If simple reconnect fails (zombie state), do full repair
                await repairSession();
            }
        } finally {
            reconnectLock = null;
        }
    })();

    await reconnectLock;
    return cachedSession;
  }

  // 2. Initial Load (Decrypt from Storage)
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
  
  // Store raw seed/net for future repairs
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt)); 

  const sdk = await getSdk();
  const WalletCtor = getWalletCtor(sdk);
  
  const wallet = new WalletCtor(seed, net);
  const provider = wallet.rostrumProvider || wallet.provider;
  
  // Initial Connect
  await safeConnect(provider);
  
  console.log('[Client] Initializing Wallet (Scanning UTXOs)...');
  await wallet.initialize(); 

  const account = wallet.accountStore.getAccount('2.0');
  const address = account.getPrimaryAddressKey().address; 

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

  // Save to Cache (Including seed for repairs)
  cachedSession = { wallet, account, address, network: net, balances, sdk, seed, net };
  return cachedSession;
}

export async function placeBet({
  passphrase,
  kiblAmount,   
  tokenIdHex,   
  feeNexa       
}: {
  passphrase: string; kiblAmount: number; tokenIdHex: string; feeNexa: number;
}) {
  if (!cachedSession && (!passphrase || passphrase.length < 8)) {
     throw new Error('Password required (8+ chars).');
  }
  
  // This will now auto-repair the connection if needed
  const { wallet, account, address, network } = await loadWallet(passphrase);
  
  console.log('[Client] Building Transaction...');

  const signedTx = await wallet.newTransaction(account)
    .onNetwork('mainnet')
    .sendTo(HOUSE_ADDRESS, feeNexa.toString())
    .sendToToken(HOUSE_ADDRESS, kiblAmount.toString(), KIBL_TOKEN_ID)
    .populate()
    .sign()
    .build();
  
  const txId = await wallet.sendTransaction(signedTx);
  console.log('[Client] Bet Sent! TxId:', txId);

  return { txId, network, address, house: HOUSE_ADDRESS };
}