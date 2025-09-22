import { b as y, p as g, a as h, $ as m } from "./chunks/index.web-CQ47b9dX.js";
globalThis.Buffer ||= y.Buffer;
globalThis.process ||= g;
const A = "kk_wallet_v1", T = "kk_wallet_iv_v1";
async function k(r) {
  const e = localStorage.getItem(A) || "";
  if (!e) throw new Error("No local wallet. Visit Connect.");
  const c = localStorage.getItem(T) || "", s = atob(e), o = atob(c), i = new Uint8Array([...o].map((u) => u.charCodeAt(0))), a = new Uint8Array([...s].map((u) => u.charCodeAt(0))), d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r)), f = await crypto.subtle.importKey("raw", d, "AES-GCM", !1, ["decrypt"]), t = await crypto.subtle.decrypt({ name: "AES-GCM", iv: i }, f, a), { seed: l, net: n } = JSON.parse(new TextDecoder().decode(t));
  await h.connect(n);
  const w = new m(l, n);
  await w.initialize();
  const p = w.accountStore.getAccount("2.0");
  if (!p) throw new Error("DApp account (2.0) not found. Open Connect and (re)create/import your wallet.");
  const b = p.getPrimaryAddressKey().address;
  return { wallet: w, account: p, address: b, network: n };
}
async function x({ passphrase: r, kiblAmount: e, tokenIdHex: c, feeNexa: s }) {
  const { wallet: o, account: i, address: a, network: d } = await k(r), t = await (await fetch("/api/bet/build-unsigned", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
    body: JSON.stringify({ fromAddress: a, kiblAmount: e, tokenIdHex: c, feeNexa: s })
  })).json();
  if (!t.ok) throw new Error(t.error || "build_unsigned_failed");
  const l = await o.newTransaction(i, t.unsignedTx).sign().build();
  return { txId: await o.sendTransaction(l), network: d, address: a, house: t.house };
}
export {
  x as placeBet
};
