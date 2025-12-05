import { B as Buffer$1, p as process$1, n as nodeCrypto } from "./chunks/index-C_zbkbH-.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
globalThis.__nodeCrypto = nodeCrypto;
const KEY = "kk_wallet_v1", IV = "kk_wallet_iv_v1";
const KIBL_GROUP_ADDR = "nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt";
const KIBL_TOKEN_HEX = "656bfefce8a0885acba5c809c5afcfbfa62589417d84d54108e6bb42a6f30000";
const HOUSE_ADDRESS = "nexa:nqtsq5g5pvucuzm2kh92kqtxy5s3zfutq3xgnhh5src65fc3";
const KIBL_TOKEN_ID = "nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt";
const PRIVATE_NODE = { scheme: "wss", host: "node.remy-dev.com", port: 443 };
const PUBLIC_NODE = { scheme: "wss", host: "electrum.nexa.org", port: 20004 };
let cachedSession = null;
let reconnectLock = null;
async function getSdk() {
  return await import("./chunks/index.web-Does7zZT.js");
}
function getWalletCtor(mod) {
  return mod?.Wallet ?? mod?.default?.Wallet;
}
async function safeConnect(provider) {
  if (!provider) throw new Error("Provider is null");
  try {
    if (provider.isConnected) return true;
  } catch (e) {
    console.warn("[Client] Provider is in zombie state. Needs repair.");
    return false;
  }
  console.log("[Client] Connecting network...");
  try {
    await provider.connect(PRIVATE_NODE);
    console.log("✅ Connected: Private Node");
    return true;
  } catch (e) {
    console.warn("⚠️ Private node unreachable, trying public...");
  }
  try {
    await provider.connect(PUBLIC_NODE);
    console.log("⚠️ Connected: Public Node");
    return true;
  } catch (e) {
    console.error("❌ Connection failed");
    return false;
  }
}
async function repairSession() {
  if (!cachedSession) return;
  console.log("[Client] Repairing session (Soft Reset)...");
  const { seed, net, sdk } = cachedSession;
  const WalletCtor = getWalletCtor(sdk);
  const newWallet = new WalletCtor(seed, net);
  const newProvider = newWallet.rostrumProvider || newWallet.provider;
  const connected = await safeConnect(newProvider);
  if (!connected) throw new Error("Could not reconnect to any node.");
  console.log("[Client] Syncing...");
  await newWallet.initialize();
  const newAccount = newWallet.accountStore.getAccount("2.0");
  cachedSession.wallet = newWallet;
  cachedSession.account = newAccount;
  console.log("[Client] Session repaired.");
}
async function loadWallet(pass) {
  if (cachedSession) {
    if (reconnectLock) {
      await reconnectLock;
      return cachedSession;
    }
    const { wallet: wallet2 } = cachedSession;
    const provider2 = wallet2.rostrumProvider || wallet2.provider;
    let isHealthy = false;
    try {
      isHealthy = provider2 && provider2.isConnected;
    } catch {
    }
    if (isHealthy) {
      return cachedSession;
    }
    reconnectLock = (async () => {
      try {
        const revived = await safeConnect(provider2);
        if (!revived) {
          await repairSession();
        }
      } finally {
        reconnectLock = null;
      }
    })();
    await reconnectLock;
    return cachedSession;
  }
  const rawB64 = localStorage.getItem(KEY);
  const ivB64 = localStorage.getItem(IV);
  if (!rawB64 || !ivB64) throw new Error("No local wallet. Visit Connect.");
  const raw = atob(rawB64);
  const ivb = atob(ivB64);
  const iv = new Uint8Array([...ivb].map((c) => c.charCodeAt(0)));
  const ct = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pass));
  const key = await crypto.subtle.importKey("raw", h, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt));
  const sdk = await getSdk();
  const WalletCtor = getWalletCtor(sdk);
  const wallet = new WalletCtor(seed, net);
  const provider = wallet.rostrumProvider || wallet.provider;
  await safeConnect(provider);
  console.log("[Client] Initializing Wallet (Scanning UTXOs)...");
  await wallet.initialize();
  const account = wallet.accountStore.getAccount("2.0");
  const address = account.getPrimaryAddressKey().address;
  const nexaMinor = Number(account.balance?.confirmed || 0);
  const kiblMinor = Number(account.tokenBalances?.[KIBL_GROUP_ADDR]?.confirmed || 0);
  const DEC = 2;
  const balances = {
    kiblMinor,
    kibl: kiblMinor / 10 ** DEC,
    nexaMinor,
    nexa: nexaMinor / 10 ** DEC,
    tokenHex: KIBL_TOKEN_HEX,
    tokenGroup: KIBL_GROUP_ADDR
  };
  cachedSession = { wallet, account, address, network: net, balances, sdk, seed, net };
  return cachedSession;
}
async function placeBet({
  passphrase,
  kiblAmount,
  tokenIdHex,
  feeNexa
}) {
  if (!cachedSession && (!passphrase || passphrase.length < 8)) {
    throw new Error("Password required (8+ chars).");
  }
  const { wallet, account, address, network } = await loadWallet(passphrase);
  console.log("[Client] Building Transaction...");
  const signedTx = await wallet.newTransaction(account).onNetwork("mainnet").sendTo(HOUSE_ADDRESS, feeNexa.toString()).sendToToken(HOUSE_ADDRESS, kiblAmount.toString(), KIBL_TOKEN_ID).populate().sign().build();
  const txId = await wallet.sendTransaction(signedTx);
  console.log("[Client] Bet Sent! TxId:", txId);
  return { txId, network, address, house: HOUSE_ADDRESS };
}
export {
  loadWallet,
  placeBet
};
//# sourceMappingURL=walletBet.bundle.js.map
