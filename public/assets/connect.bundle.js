import { b as h, p as I, $ as f, a as v } from "./chunks/index.web-CQ47b9dX.js";
globalThis.Buffer ||= h.Buffer;
globalThis.process ||= I;
const w = "kk_wallet_v1", k = "kk_wallet_iv_v1";
function C(e) {
  return (e || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}
function A(e) {
  const n = e.split(" ");
  if (n.length !== 12)
    throw new Error(`Seed must be exactly 12 words (got ${n.length}).`);
  return e;
}
async function E(e) {
  const n = new TextEncoder().encode(e), o = await crypto.subtle.digest("SHA-256", n);
  return crypto.subtle.importKey("raw", o, "AES-GCM", !1, ["encrypt", "decrypt"]);
}
async function b(e, n) {
  const o = await E(e), c = crypto.getRandomValues(new Uint8Array(12)), r = await crypto.subtle.encrypt({ name: "AES-GCM", iv: c }, o, new TextEncoder().encode(n));
  localStorage.setItem(k, btoa(String.fromCharCode(...c))), localStorage.setItem(w, btoa(String.fromCharCode(...new Uint8Array(r))));
}
async function B(e) {
  const n = await E(e), o = atob(localStorage.getItem(k) || ""), c = new Uint8Array([...o].map((s) => s.charCodeAt(0))), r = atob(localStorage.getItem(w) || ""), d = new Uint8Array([...r].map((s) => s.charCodeAt(0))), i = await crypto.subtle.decrypt({ name: "AES-GCM", iv: c }, n, d);
  return new TextDecoder().decode(i);
}
async function L() {
  const e = document.getElementById("net"), n = document.getElementById("pass"), o = document.getElementById("btnCreate");
  document.getElementById("btnImport"), document.getElementById("importArea");
  const c = document.getElementById("seedIn"), r = document.getElementById("btnDoImport"), d = document.getElementById("linked"), i = document.getElementById("addr"), s = document.getElementById("btnLink");
  let y = null, p = null, u = null;
  async function S() {
    const a = e.value === "mainnet" ? "mainnet" : "testnet";
    await v.connect(a);
  }
  async function m(a, t) {
    await S(), y = new f(a, t), await y.initialize(), p = y.accountStore.getAccount("2.0"), u = p.getPrimaryAddressKey().address, i.textContent = `Linked address (${t}): ${u}`, d.hidden = !1;
  }
  o?.addEventListener("click", async () => {
    const a = n.value || "", t = e.value, g = f.create().export().phrase;
    await b(a, JSON.stringify({ seed: g, net: t })), await m(g, t), alert("New wallet created. Write down your seed!");
  }), r?.addEventListener("click", async () => {
    try {
      const a = n.value || "", t = e.value, l = A(C(c.value));
      await b(a, JSON.stringify({ seed: l, net: t })), await m(l, t), alert("Imported wallet. Seed stored encrypted locally.");
    } catch (a) {
      alert(a?.message || "Failed to import seed. Please check the 12 words and try again.");
    }
  }), s?.addEventListener("click", async () => {
    const t = await (await fetch("/api/wallet/link", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
      body: JSON.stringify({ address: u, network: e.value })
    })).json();
    if (!t.ok) return alert("Link failed: " + (t.error || "unknown"));
    alert("Wallet linked!"), location.href = "/play.html";
  }), n?.addEventListener("change", async () => {
    try {
      if (!localStorage.getItem(w)) return;
      const { seed: a, net: t } = JSON.parse(await B(n.value || ""));
      e.value = t, await m(a, t);
    } catch {
    }
  });
}
addEventListener("DOMContentLoaded", L);
