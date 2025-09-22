import { b as bufferExports, p as process, $ as $8265cc68049fe82c$export$2e2bcd8739ae039, a as $884ce55f1db7e177$export$eaa49f0478d81b9d } from "./chunks/index.web-CiXhaaXU.js";
globalThis.Buffer ||= bufferExports.Buffer;
globalThis.process ||= process;
const KEY = "kk_wallet_v1";
const IV = "kk_wallet_iv_v1";
function normalizeSeed(raw) {
  return (raw || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}
function require12Words(seed) {
  const words = seed.split(" ");
  if (words.length !== 12) {
    throw new Error(`Seed must be exactly 12 words (got ${words.length}).`);
  }
  return seed;
}
async function aesKey(pass) {
  const raw = new TextEncoder().encode(pass);
  const h = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function enc(pass, data) {
  const key = await aesKey(pass);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(data));
  localStorage.setItem(IV, btoa(String.fromCharCode(...iv)));
  localStorage.setItem(KEY, btoa(String.fromCharCode(...new Uint8Array(ct))));
}
async function dec(pass) {
  const key = await aesKey(pass);
  const ivb = atob(localStorage.getItem(IV) || "");
  const iv = new Uint8Array([...ivb].map((c) => c.charCodeAt(0)));
  const ctb = atob(localStorage.getItem(KEY) || "");
  const ct = new Uint8Array([...ctb].map((c) => c.charCodeAt(0)));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
async function init() {
  const netSel = document.getElementById("net");
  const passEl = document.getElementById("pass");
  const btnCreate = document.getElementById("btnCreate");
  document.getElementById("btnImport");
  document.getElementById("importArea");
  const seedIn = document.getElementById("seedIn");
  const btnDoImport = document.getElementById("btnDoImport");
  const linked = document.getElementById("linked");
  const addrText = document.getElementById("addr");
  const btnLink = document.getElementById("btnLink");
  let wallet = null;
  let account = null;
  let address = null;
  async function connectNetwork() {
    const net = netSel.value === "mainnet" ? "mainnet" : "testnet";
    await $884ce55f1db7e177$export$eaa49f0478d81b9d.connect(net);
  }
  async function bootFromSeed(seed, net) {
    await connectNetwork();
    wallet = new $8265cc68049fe82c$export$2e2bcd8739ae039(seed, net);
    await wallet.initialize();
    account = wallet.accountStore.getAccount("2.0");
    const k = account.getPrimaryAddressKey();
    address = k.address;
    addrText.textContent = `Linked address (${net}): ${address}`;
    linked.hidden = false;
  }
  btnCreate?.addEventListener("click", async () => {
    const pass = passEl.value || "";
    const net = netSel.value;
    const w = $8265cc68049fe82c$export$2e2bcd8739ae039.create();
    const seed = w.export().phrase;
    await enc(pass, JSON.stringify({ seed, net }));
    await bootFromSeed(seed, net);
    alert("New wallet created. Write down your seed!");
  });
  btnDoImport?.addEventListener("click", async () => {
    try {
      const pass = passEl.value || "";
      const net = netSel.value;
      const seed = require12Words(normalizeSeed(seedIn.value));
      await enc(pass, JSON.stringify({ seed, net }));
      await bootFromSeed(seed, net);
      alert("Imported wallet. Seed stored encrypted locally.");
    } catch (e) {
      alert(e?.message || "Failed to import seed. Please check the 12 words and try again.");
    }
  });
  btnLink?.addEventListener("click", async () => {
    const res = await fetch("/api/wallet/link", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
      body: JSON.stringify({ address, network: netSel.value })
    });
    const j = await res.json();
    if (!j.ok) return alert("Link failed: " + (j.error || "unknown"));
    alert("Wallet linked!");
    location.href = "/play.html";
  });
  passEl?.addEventListener("change", async () => {
    try {
      if (!localStorage.getItem(KEY)) return;
      const { seed, net } = JSON.parse(await dec(passEl.value || ""));
      netSel.value = net;
      await bootFromSeed(seed, net);
    } catch {
    }
  });
}
addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=connect.bundle.js.map
