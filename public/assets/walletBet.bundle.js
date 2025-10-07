import { B as Buffer$1, p as process$1, n as nodeCrypto } from "./chunks/index-B2SI0-L8.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
globalThis.__nodeCrypto = nodeCrypto;
const KEY = "kk_wallet_v1", IV = "kk_wallet_iv_v1";
const KIBL_GROUP_ADDR = "nexa:tpjkhlhuazsgskkt5hyqn3d0e7l6vfvfg97cf42pprntks4x7vqqqcavzypmt";
const KIBL_TOKEN_HEX = "656bfefce8a0885acba5c809c5afcfbfa62589417d84d54108e6bb42a6f30000";
async function getSdk() {
  return await import("./chunks/index.web-DTpKA-Oa.js");
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
  const { seed } = JSON.parse(new TextDecoder().decode(pt));
  const net = "mainnet";
  const sdk = await getSdk();
  const { rostrumProvider } = sdk;
  await rostrumProvider.connect();
  const WalletCtor = getWalletCtor(sdk);
  if (!WalletCtor) throw new Error("Wallet export missing");
  const wallet = new WalletCtor(seed, net);
  await wallet.initialize();
  const account = wallet.accountStore.getAccount("2.0");
  if (!account) throw new Error("DApp account (2.0) not found.");
  const address = account.getPrimaryAddressKey().address;
  const nexaMinor = account.balance?.confirmed || 0;
  const kiblMinor = account.tokenBalances?.[KIBL_GROUP_ADDR]?.confirmed || 0;
  const nexa = (nexaMinor / 100).toFixed(2);
  const kibl = (kiblMinor / 100).toFixed(2);
  let tokenUtxoCount = 0;
  let nexaUtxoCount = 0;
  try {
    const [tokenUtxos, nexaUtxos] = await Promise.all([
      rostrumProvider.getTokenUtxos(address, KIBL_GROUP_ADDR),
      rostrumProvider.getNexaUtxos(address)
    ]);
    for (const u of tokenUtxos || []) ;
    for (const u of nexaUtxos || []) ;
    tokenUtxoCount = (tokenUtxos || []).length;
    nexaUtxoCount = (nexaUtxos || []).length;
    const kiblEl = document.getElementById("kiblBalance");
    if (kiblEl) kiblEl.textContent = `KIBL: ${kibl}`;
    const nexaEl = document.getElementById("nexaBalance");
    if (nexaEl) nexaEl.textContent = `NEXA: ${nexa}`;
  } catch (e) {
    console.warn("[loadWallet] balance fetch failed", e);
  }
  const balances = {
    nexaMinor,
    nexa,
    kiblMinor,
    kibl,
    nexaUtxoCount,
    // Handy ids for callers:
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
  const { wallet, account, address, network } = await loadWallet(passphrase);
  const CSRF = await csrf();
  const r = await fetch("/api/bet/build-unsigned", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "CSRF-Token": CSRF },
    body: JSON.stringify({ fromAddress: address, kiblAmount, tokenIdHex, feeNexa })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j?.error || "build_unsigned_failed");
  const signedTx = await wallet.newTransaction(account, j.unsignedTx).build();
  const br = await fetch("/api/tx/broadcast", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "CSRF-Token": CSRF },
    body: JSON.stringify({ hex: signedTx })
  });
  const bj = await br.json().catch(() => ({}));
  console.log("[placeBet] broadcast ok?", br.ok, "payload", bj);
  if (!br.ok || !bj.ok) throw new Error(bj?.error || "broadcast_failed");
  return { txId: bj.txid, network, address, house: j.house };
}
export {
  loadWallet,
  placeBet
};
//# sourceMappingURL=walletBet.bundle.js.map
