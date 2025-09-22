import { b as g, a as h, $ as y } from "./chunks/polyfills-LAyUubzC.js";
globalThis.Buffer || (globalThis.Buffer = g.Buffer);
globalThis.global || (globalThis.global = globalThis);
globalThis.process || (globalThis.process = { env: {} });
const T = "kk_wallet_v1", m = "kk_wallet_iv_v1";
async function A(r) {
  const e = localStorage.getItem(T) || "";
  if (!e) throw new Error("No local wallet. Visit Connect.");
  const s = localStorage.getItem(m) || "", c = atob(e), o = atob(s), i = new Uint8Array([...o].map((p) => p.charCodeAt(0))), a = new Uint8Array([...c].map((p) => p.charCodeAt(0))), l = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r)), u = await crypto.subtle.importKey("raw", l, "AES-GCM", !1, ["decrypt"]), t = await crypto.subtle.decrypt({ name: "AES-GCM", iv: i }, u, a), { seed: d, net: n } = JSON.parse(new TextDecoder().decode(t));
  await h.connect(n);
  const w = new y(d, n);
  await w.initialize();
  const f = w.accountStore.getAccount("2.0");
  if (!f) throw new Error("DApp account (2.0) not found. Open Connect and (re)create/import your wallet.");
  const b = f.getPrimaryAddressKey().address;
  return { wallet: w, account: f, address: b, network: n };
}
async function S({ passphrase: r, kiblAmount: e, tokenIdHex: s, feeNexa: c }) {
  const { wallet: o, account: i, address: a, network: l } = await A(r), t = await (await fetch("/api/bet/build-unsigned", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
    body: JSON.stringify({ fromAddress: a, kiblAmount: e, tokenIdHex: s, feeNexa: c })
  })).json();
  if (!t.ok) throw new Error(t.error || "build_unsigned_failed");
  const d = await o.newTransaction(i, t.unsignedTx).sign().build();
  return { txId: await o.sendTransaction(d), network: l, address: a, house: t.house };
}
export {
  S as placeBet
};
