import { B as Buffer$1, p as process$1, n as nodeCrypto } from "./chunks/index-C_zbkbH-.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
globalThis.__nodeCrypto = nodeCrypto;
const KEY = "kk_wallet_v1", IV = "kk_wallet_iv_v1";
const KIBL_GROUP_ADDR = "nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt";
const KIBL_TOKEN_HEX = "656bfefce8a0885acba5c809c5afcfbfa62589417d84d54108e6bb42a6f30000";
async function getSdk() {
  return await import("./chunks/index.web-Does7zZT.js");
}
const MAINNET = {
  scheme: "wss",
  host: "electrum.nexa.org",
  port: 20004
};
async function connectMainnet(rostrumProvider) {
  if (globalThis.__kk_rostrum_mainnet_ok) return;
  await rostrumProvider.connect(MAINNET);
  globalThis.__kk_rostrum_mainnet_ok = true;
}
function getWalletCtor(mod) {
  return mod?.Wallet ?? mod?.default?.Wallet;
}
async function loadWallet(pass) {
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
  const { rostrumProvider } = sdk;
  await connectMainnet(rostrumProvider);
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error("Wallet export missing");
  const wallet = new WalletCtor(seed, net);
  await wallet.initialize();
  const account = wallet.accountStore.getAccount("2.0");
  if (!account) throw new Error("DApp account (2.0) not found.");
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
  return { wallet, account, address, network: net, balances };
}
async function csrf() {
  if (window.csrfToken) return window.csrfToken;
  const r = await fetch("/api/csrf", { credentials: "include" });
  const j = await r.json();
  window.csrfToken = j.csrfToken;
  return j.csrfToken;
}
function cleanNexa(addr) {
  const m = String(addr || "").match(/^(nexa:[a-z0-9]+)/i);
  return m ? m[1] : "";
}
async function placeBet({
  passphrase,
  kiblAmount,
  // minor units (e.g. 10000 = 100.00 KIBL)
  tokenIdHex,
  // you can ignore this if you already have KIBL_GROUP_ADDR
  feeNexa
  // minor units (e.g. 600 = 6.00 NEXA, if 2 decimals)
}) {
  if (!passphrase || passphrase.length < 8) throw new Error("Password required (8+ chars).");
  const sdk = await getSdk();
  const { rostrumProvider } = sdk;
  await connectMainnet(rostrumProvider);
  const { wallet, account, address, network } = await loadWallet(passphrase);
  const from = cleanNexa(address);
  const HOUSE_ADDR = "nexa:nqtsq5g5pvucuzm2kh92kqtxy5s3zfutq3xgnhh5src65fc3";
  const TOKEN_ID = KIBL_GROUP_ADDR;
  const nexaMinor = Number(account.balance?.confirmed || 0);
  const kiblMinor = Number(account.tokenBalances?.[KIBL_GROUP_ADDR]?.confirmed || 0);
  if (kiblMinor < kiblAmount) throw new Error("Insufficient KIBL");
  if (nexaMinor < feeNexa) throw new Error("Insufficient NEXA");
  const signedHex = await wallet.newTransaction().sendTo(HOUSE_ADDR, String(feeNexa)).sendToToken(HOUSE_ADDR, String(kiblAmount), TOKEN_ID).populate().sign().build();
  const CSRF = await csrf();
  const br = await fetch("/api/tx/broadcast", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "CSRF-Token": CSRF },
    body: JSON.stringify({ hex: signedHex })
  });
  const bj = await br.json().catch(() => ({}));
  if (!br.ok || !bj.ok) throw new Error(bj?.error || "broadcast_failed");
  return { txId: bj.txid, network, address: from, house: HOUSE_ADDR };
}
export {
  loadWallet,
  placeBet
};
//# sourceMappingURL=walletBet.bundle.js.map
