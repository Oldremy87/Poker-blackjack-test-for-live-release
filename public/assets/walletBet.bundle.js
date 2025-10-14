import { B as Buffer$1, p as process$1, n as nodeCrypto } from "./chunks/index-B2SI0-L8.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
globalThis.__nodeCrypto = nodeCrypto;
const KEY = "kk_wallet_v1", IV = "kk_wallet_iv_v1";
const KIBL_GROUP_ADDR = "nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt";
const KIBL_TOKEN_HEX = "656bfefce8a0885acba5c809c5afcfbfa62589417d84d54108e6bb42a6f30000";
async function getSdk() {
  return await import("./chunks/index.web-BVpTD3m9.js");
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
  try {
    const host = net === "mainnet" ? "electrum.nexa.org" : "testnet-electrum.nexa.org";
    const port = net === "mainnet" ? 20004 : 30004;
    const scheme = "wss";
    await rostrumProvider.connect?.({ host, port, scheme });
  } catch (_) {
  }
  const toNum = (v) => typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v) : v;
  const DECIMALS = 2;
  const fromMinor = (n) => n / Math.pow(10, DECIMALS);
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error("Wallet export missing");
  const wallet = new WalletCtor(seed, net);
  await wallet.initialize();
  const account = wallet.accountStore.getAccount("2.0");
  if (!account) throw new Error("DApp account (2.0) not found.");
  const address = account.getPrimaryAddressKey().address;
  const kiblBal = await rostrumProvider.getTokensBalance(address, KIBL_TOKEN_HEX);
  const nexaBal = await rostrumProvider.getBalance(address);
  const kiblMinor = toNum(kiblBal.confirmed[KIBL_TOKEN_HEX]);
  const nexaMinor = toNum(nexaBal.confirmed);
  const balances = {
    kiblMinor,
    kibl: fromMinor(kiblMinor),
    nexaMinor,
    nexa: fromMinor(nexaMinor),
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
async function placeBet({ passphrase, kiblAmount, tokenIdHex, feeNexa }) {
  if (!passphrase || passphrase.length < 8) throw new Error("Password required (8+ chars).");
  const net = "mainnet";
  const sdk = await getSdk();
  const { rostrumProvider } = sdk;
  try {
    const host = net === "mainnet" ? "electrum.nexa.org" : "testnet-electrum.nexa.org";
    const port = net === "mainnet" ? 20004 : 30004;
    const scheme = "wss";
    await rostrumProvider.connect?.({ host, port, scheme });
  } catch (_) {
  }
  const { wallet, account, address, network } = await loadWallet(passphrase);
  await csrf();
  const house = "nexa:nqtsq5g5pvucuzm2kh92kqtxy5s3zfutq3xgnhh5src65fc3";
  const kiblBal = await rostrumProvider.getTokensBalance(address, tokenIdHex);
  const nexaBal = await rostrumProvider.getBalance(address);
  if (Number(kiblBal.confirmed[tokenIdHex] || 0) < kiblAmount) throw new Error("Insufficient KIBL");
  if (Number(nexaBal.confirmed || 0) < feeNexa) throw new Error("Insufficient NEXA");
  console.log("[placeBet] Building TX client-side from", address, "kiblAmount", kiblAmount, "tokenIdHex", tokenIdHex, "feeNexa", feeNexa);
  const tx = wallet.newTransaction(account);
  tx.onNetwork(network);
  tx.sendTo(house, feeNexa.toString());
  tx.sendToToken(house, kiblAmount.toString(), tokenIdHex);
  await tx.populate();
  const signedTx = await tx.sign().build();
  console.log("[placeBet] Signed HEX len", signedTx?.length);
  const txId = await wallet.sendTransaction(signedTx);
  console.log("Transaction ID:", txId);
  return { txId, network, address, house };
}
export {
  loadWallet,
  placeBet
};
//# sourceMappingURL=walletBet.bundle.js.map
