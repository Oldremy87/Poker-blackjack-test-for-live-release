import { B as Buffer$1, p as process$1, n as nodeCrypto } from "./chunks/index-B2SI0-L8.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
globalThis.__nodeCrypto = nodeCrypto;
const KEY = "kk_wallet_v1", IV = "kk_wallet_iv_v1";
async function loadWallet(pass) {
  const rawB64 = localStorage.getItem(KEY) || "";
  const ivB64 = localStorage.getItem(IV) || "";
  if (!rawB64 || !ivB64) throw new Error("No local wallet. Visit Connect.");
  const raw = atob(rawB64);
  const ivb = atob(ivB64);
  const iv = new Uint8Array([...ivb].map((c) => c.charCodeAt(0)));
  const ct = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pass));
  const key = await crypto.subtle.importKey("raw", h, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const { seed, net } = JSON.parse(new TextDecoder().decode(pt));
  const { Wallet } = await import("./chunks/index.web-wporebpY.js");
  const wallet = new Wallet(seed, net);
  await wallet.initialize();
  const account = wallet.accountStore.getAccount("2.0");
  if (!account) throw new Error("DApp account (2.0) not found.");
  const address = account.getPrimaryAddressKey().address;
  return { wallet, account, address, network: net };
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
    body: JSON.stringify({ fromAddress: address, kiblAmount, feeNexa })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j?.error || "build_unsigned_failed");
  const signedHex = await wallet.newTransaction(account, j.unsignedTx).sign().build();
  const br = await fetch("/api/tx/broadcast", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "CSRF-Token": CSRF },
    body: JSON.stringify({ hex: signedHex })
  });
  const bj = await br.json().catch(() => ({}));
  if (!br.ok || !bj.ok) throw new Error(bj?.error || "broadcast_failed");
  return { txId: bj.txid, network, address, house: j.house };
}
export {
  placeBet
};
//# sourceMappingURL=walletBet.bundle.js.map
