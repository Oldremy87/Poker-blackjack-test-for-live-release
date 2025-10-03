import { B as Buffer$1, p as process$1, n as nodeCrypto } from "./chunks/index-B2SI0-L8.js";
globalThis.Buffer ||= Buffer$1;
globalThis.process ||= process$1;
globalThis.__nodeCrypto = nodeCrypto;
async function sdk() {
  return await import("./chunks/index.web-BXlmGF_y.js");
}
const KEY = "kk_wallet_v1";
const IV = "kk_wallet_iv_v1";
async function ensureCsrf() {
  if (window.csrfToken) return window.csrfToken;
  const r = await fetch("/api/csrf", { credentials: "include" });
  if (!r.ok) throw new Error(`CSRF fetch failed: ${r.status}`);
  const { csrfToken } = await r.json();
  window.csrfToken = csrfToken;
  return csrfToken;
}
async function postJSON(url, body) {
  const csrf = await ensureCsrf();
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "CSRF-Token": csrf },
    body: JSON.stringify(body)
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
  }
  if (!r.ok || j && j.ok === false) {
    const msg = j?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
}
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
  if (!pass || pass.length < 8) throw new Error("Password must be 8+ characters.");
  const key = await aesKey(pass);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(data));
  localStorage.setItem(IV, btoa(String.fromCharCode(...iv)));
  localStorage.setItem(KEY, btoa(String.fromCharCode(...new Uint8Array(ct))));
  localStorage.setItem("kk_has_pass", "1");
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
  const passEl2 = document.getElementById("pass");
  const btnCreate2 = document.getElementById("btnCreate");
  const btnImport2 = document.getElementById("btnImport");
  const importArea = document.getElementById("importArea");
  const seedIn = document.getElementById("seedIn");
  const btnDoImport = document.getElementById("btnDoImport");
  const linked = document.getElementById("linked");
  const addrText = document.getElementById("addr");
  const btnLink = document.getElementById("btnLink");
  let address = null;
  async function bootFromSeed(seed, net) {
    const { Wallet } = await sdk();
    const wallet2 = new Wallet(seed, net);
    await wallet2.initialize();
    const account3 = wallet2.accountStore.getAccount("2.0");
    const k = account3.getPrimaryAddressKey();
    const kiblBalance = account3.tokenBalances[process$1.env.KIBL_TOKEN_ID_HEX]?.confirmed || 0;
    const nexaBalance = account3.balance.confirmed || 0;
    return { wallet: wallet2, account: account3, address: k.address, kiblBalance, nexaBalance };
  }
  btnCreate2?.addEventListener("click", async () => {
    try {
      const pass = passEl2.value || "";
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
  btnImport2?.addEventListener("click", () => {
    importArea.hidden = !importArea.hidden;
  });
  btnDoImport?.addEventListener("click", async () => {
    try {
      const pass = passEl2.value || "";
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
      if (!address) return alert("No address yet.");
      const net = netSel.value === "mainnet";
      const j = await postJSON("/api/wallet/link", { address, network: net });
      alert("Wallet linked!");
      location.href = "/play.html";
    } catch (e) {
      alert("Link failed: " + (e?.message || "unknown"));
    }
  });
  addEventListener("DOMContentLoaded", () => {
    ensureCsrf().catch(() => {
    });
  });
  passEl2?.addEventListener("change", async () => {
    try {
      if (!localStorage.getItem(KEY)) return;
      const { seed, net } = JSON.parse(await dec(passEl2.value || ""));
      netSel.value = net;
      const r = await bootFromSeed(seed, net);
      address = r.address;
      addrText.textContent = `Linked address (${net}): ${address}`;
      linked.hidden = false;
    } catch {
    }
  });
}
function passOk(p, p2) {
  return (p?.length ?? 0) >= 8 && p === p2;
}
try {
  const bal = await account.tokenBalances[process$1.env.KIBL_TOKEN_ID_HEX]?.confirmed || 0;
  const balEl = document.getElementById("kiblBalance");
  if (balEl) balEl.textContent = `KIBL: ${bal.kibl} (${bal.kiblMinor} minor)`;
} catch {
}
const passEl = document.getElementById("pass");
const pass2El = document.getElementById("pass2");
const btnCreate = document.getElementById("btnCreate");
const btnImport = document.getElementById("btnImport");
const passHint = document.getElementById("passHint");
function refreshPassUI() {
  const ok = passOk(passEl.value, pass2El.value);
  btnCreate.disabled = btnImport.disabled = !ok;
  passHint.hidden = ok;
}
passEl.addEventListener("input", refreshPassUI);
pass2El.addEventListener("input", refreshPassUI);
refreshPassUI();
addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=connect.bundle.js.map
