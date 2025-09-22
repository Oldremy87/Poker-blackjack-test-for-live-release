import { b as S, $ as f, a as C } from "./chunks/polyfills-LAyUubzC.js";
globalThis.Buffer || (globalThis.Buffer = S.Buffer);
globalThis.global || (globalThis.global = globalThis);
globalThis.process || (globalThis.process = { env: {} });
const w = "kk_wallet_v1", k = "kk_wallet_iv_v1";
async function E(t) {
  const n = new TextEncoder().encode(t), o = await crypto.subtle.digest("SHA-256", n);
  return crypto.subtle.importKey("raw", o, "AES-GCM", !1, ["encrypt", "decrypt"]);
}
async function b(t, n) {
  const o = await E(t), c = crypto.getRandomValues(new Uint8Array(12)), r = await crypto.subtle.encrypt({ name: "AES-GCM", iv: c }, o, new TextEncoder().encode(n));
  localStorage.setItem(k, btoa(String.fromCharCode(...c))), localStorage.setItem(w, btoa(String.fromCharCode(...new Uint8Array(r))));
}
async function T(t) {
  const n = await E(t), o = atob(localStorage.getItem(k) || ""), c = new Uint8Array([...o].map((s) => s.charCodeAt(0))), r = atob(localStorage.getItem(w) || ""), d = new Uint8Array([...r].map((s) => s.charCodeAt(0))), i = await crypto.subtle.decrypt({ name: "AES-GCM", iv: c }, n, d);
  return new TextDecoder().decode(i);
}
async function A() {
  const t = document.getElementById("net"), n = document.getElementById("pass"), o = document.getElementById("btnCreate"), c = document.getElementById("btnImport"), r = document.getElementById("importArea"), d = document.getElementById("seedIn"), i = document.getElementById("btnDoImport"), s = document.getElementById("linked"), h = document.getElementById("addr"), I = document.getElementById("btnLink");
  let m = null, p = null, y = null;
  async function v() {
    const a = t.value === "mainnet" ? "mainnet" : "testnet";
    await C.connect(a);
  }
  async function u(a, e) {
    await v(), m = new f(a, e), await m.initialize(), p = m.accountStore.getAccount("2.0"), y = p.getPrimaryAddressKey().address, h.textContent = `Linked address (${e}): ${y}`, s.hidden = !1;
  }
  o?.addEventListener("click", async () => {
    const a = n.value || "", e = t.value, g = f.create().export().phrase;
    await b(a, JSON.stringify({ seed: g, net: e })), await u(g, e), alert("New wallet created. Write down your seed!");
  }), c?.addEventListener("click", () => {
    r.hidden = !r.hidden;
  }), i?.addEventListener("click", async () => {
    const a = n.value || "", e = t.value, l = (d.value || "").trim();
    if (!l) return alert("Enter a 12-word seed");
    await b(a, JSON.stringify({ seed: l, net: e })), await u(l, e), alert("Imported wallet. Seed stored encrypted locally.");
  }), I?.addEventListener("click", async () => {
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
      const { seed: a, net: e } = JSON.parse(await T(n.value || ""));
      t.value = e, await u(a, e);
    } catch {
    }
  });
}
addEventListener("DOMContentLoaded", A);
