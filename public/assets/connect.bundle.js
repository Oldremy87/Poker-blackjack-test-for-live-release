import { b as h, p as C, $ as g, a as A } from "./chunks/index.web-CQ47b9dX.js";
globalThis.Buffer ||= h.Buffer;
globalThis.process ||= C;
const w = "kk_wallet_v1", k = "kk_wallet_iv_v1";
async function E(t) {
  const n = new TextEncoder().encode(t), o = await crypto.subtle.digest("SHA-256", n);
  return crypto.subtle.importKey("raw", o, "AES-GCM", !1, ["encrypt", "decrypt"]);
}
async function b(t, n) {
  const o = await E(t), c = crypto.getRandomValues(new Uint8Array(12)), r = await crypto.subtle.encrypt({ name: "AES-GCM", iv: c }, o, new TextEncoder().encode(n));
  localStorage.setItem(k, btoa(String.fromCharCode(...c))), localStorage.setItem(w, btoa(String.fromCharCode(...new Uint8Array(r))));
}
async function B(t) {
  const n = await E(t), o = atob(localStorage.getItem(k) || ""), c = new Uint8Array([...o].map((s) => s.charCodeAt(0))), r = atob(localStorage.getItem(w) || ""), l = new Uint8Array([...r].map((s) => s.charCodeAt(0))), i = await crypto.subtle.decrypt({ name: "AES-GCM", iv: c }, n, l);
  return new TextDecoder().decode(i);
}
async function L() {
  const t = document.getElementById("net"), n = document.getElementById("pass"), o = document.getElementById("btnCreate"), c = document.getElementById("btnImport"), r = document.getElementById("importArea"), l = document.getElementById("seedIn"), i = document.getElementById("btnDoImport"), s = document.getElementById("linked"), I = document.getElementById("addr"), v = document.getElementById("btnLink");
  let m = null, p = null, y = null;
  async function S() {
    const a = t.value === "mainnet" ? "mainnet" : "testnet";
    await A.connect(a);
  }
  async function u(a, e) {
    await S(), m = new g(a, e), await m.initialize(), p = m.accountStore.getAccount("2.0"), y = p.getPrimaryAddressKey().address, I.textContent = `Linked address (${e}): ${y}`, s.hidden = !1;
  }
  o?.addEventListener("click", async () => {
    const a = n.value || "", e = t.value, f = g.create().export().phrase;
    await b(a, JSON.stringify({ seed: f, net: e })), await u(f, e), alert("New wallet created. Write down your seed!");
  }), c?.addEventListener("click", () => {
    r.hidden = !r.hidden;
  }), i?.addEventListener("click", async () => {
    const a = n.value || "", e = t.value, d = (l.value || "").trim();
    if (!d) return alert("Enter a 12-word seed");
    await b(a, JSON.stringify({ seed: d, net: e })), await u(d, e), alert("Imported wallet. Seed stored encrypted locally.");
  }), v?.addEventListener("click", async () => {
    const e = await (await fetch("/api/wallet/link", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
      body: JSON.stringify({ address: y, network: t.value })
    })).json();
    if (!e.ok) return alert("Link failed: " + (e.error || "unknown"));
    alert("Wallet linked!"), location.href = "/play.html";
  }), n?.addEventListener("change", async () => {
    try {
      if (!localStorage.getItem(w)) return;
      const { seed: a, net: e } = JSON.parse(await B(n.value || ""));
      t.value = e, await u(a, e);
    } catch {
    }
  });
}
addEventListener("DOMContentLoaded", L);
