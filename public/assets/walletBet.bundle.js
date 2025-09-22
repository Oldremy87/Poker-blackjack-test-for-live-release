import { a as b, $ as g } from "./chunks/polyfills-C-FrwHBI.js";
const m = "kk_wallet_v1", h = "kk_wallet_iv_v1";
async function A(r) {
  const e = localStorage.getItem(m) || "";
  if (!e) throw new Error("No local wallet. Visit Connect.");
  const c = localStorage.getItem(h) || "", s = atob(e), n = atob(c), i = new Uint8Array([...n].map((u) => u.charCodeAt(0))), o = new Uint8Array([...s].map((u) => u.charCodeAt(0))), d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r)), y = await crypto.subtle.importKey("raw", d, "AES-GCM", !1, ["decrypt"]), t = await crypto.subtle.decrypt({ name: "AES-GCM", iv: i }, y, o), { seed: w, net: a } = JSON.parse(new TextDecoder().decode(t));
  await b.connect(a);
  const l = new g(w, a);
  await l.initialize();
  const p = l.accountStore.getAccount("2.0");
  if (!p) throw new Error("DApp account (2.0) not found. Open Connect and (re)create/import your wallet.");
  const f = p.getPrimaryAddressKey().address;
  return { wallet: l, account: p, address: f, network: a };
}
async function S({ passphrase: r, kiblAmount: e, tokenIdHex: c, feeNexa: s }) {
  const { wallet: n, account: i, address: o, network: d } = await A(r), t = await (await fetch("/api/bet/build-unsigned", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
    body: JSON.stringify({ fromAddress: o, kiblAmount: e, tokenIdHex: c, feeNexa: s })
  })).json();
  if (!t.ok) throw new Error(t.error || "build_unsigned_failed");
  const w = await n.newTransaction(i, t.unsignedTx).sign().build();
  return { txId: await n.sendTransaction(w), network: d, address: o, house: t.house };
}
export {
  S as placeBet
};
