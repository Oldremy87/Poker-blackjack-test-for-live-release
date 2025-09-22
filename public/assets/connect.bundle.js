import { B as Buffer$1, p as process$1 } from "./chunks/index-HBvxpDpP.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
async function sdk() {
  return await import("./chunks/index.web-Dgt6Mupw.js");
}
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
  const btnImport = document.getElementById("btnImport");
  const importArea = document.getElementById("importArea");
  const seedIn = document.getElementById("seedIn");
  const btnDoImport = document.getElementById("btnDoImport");
  const linked = document.getElementById("linked");
  const addrText = document.getElementById("addr");
  const btnLink = document.getElementById("btnLink");
  let address = null;
  async function connectNetwork(net) {
    const { rostrumProvider } = await sdk();
    await rostrumProvider.connect(net);
  }
  async function bootFromSeed(seed, net) {
    const { Wallet } = await sdk();
    await connectNetwork("mainnet");
    const wallet2 = new Wallet(seed, net);
    await wallet2.initialize();
    const account2 = wallet2.accountStore.getAccount("2.0");
    const k = account2.getPrimaryAddressKey();
    return { wallet: wallet2, account: account2, address: k.address };
  }
  btnCreate?.addEventListener("click", async () => {
    try {
      const pass = passEl.value || "";
      const net = netSel.value === "mainnet";
      const { Wallet } = await sdk();
      const w = Wallet.create();
      const seed = w.export().phrase;
      await enc(pass, JSON.stringify({ seed, net }));
      const r = await bootFromSeed(seed, "mainnet");
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
      alert("New wallet created. Write down your seed!");
    } catch (e) {
      alert(e?.message || "Failed to create wallet.");
    }
  });
  btnImport?.addEventListener("click", () => {
    importArea.hidden = !importArea.hidden;
  });
  btnDoImport?.addEventListener("click", async () => {
    try {
      const pass = passEl.value || "";
      const net = netSel.value === "mainnet";
      const seed = require12Words(normalizeSeed(seedIn.value));
      await enc(pass, JSON.stringify({ seed, net }));
      const r = await bootFromSeed(seed, "mainnet");
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
      alert("Imported wallet. Seed stored encrypted locally.");
    } catch (e) {
      alert(e?.message || "Failed to import seed.");
    }
  });
  btnLink?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/wallet/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": window.csrfToken || "" },
        body: JSON.stringify({ address, network: netSel.value })
      });
      const j = await res.json();
      if (!j.ok) return alert("Link failed: " + (j.error || "unknown"));
      alert("Wallet linked!");
      location.href = "/play.html";
    } catch (e) {
      alert(e?.message || "Link failed.");
    }
  });
  passEl?.addEventListener("change", async () => {
    try {
      if (!localStorage.getItem(KEY)) return;
      const { seed, net } = JSON.parse(await dec(passEl.value || ""));
      netSel.value = net;
      const r = await bootFromSeed(seed, net);
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
    } catch {
    }
  });
}
addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=connect.bundle.js.map
