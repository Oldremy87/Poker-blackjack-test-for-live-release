import { loadWallet } from '/assets/walletBet.bundle.js';

let _cachedPass = null;
let _unlockTime = 0;
const SESSION_DURATION = 15 * 60 * 1000; // 15 minutes

export async function getSigner() {
  // 1. Return cached password if session is valid
  if (_cachedPass && (Date.now() - _unlockTime < SESSION_DURATION)) {
    return _cachedPass;
  }

  // 2. Otherwise, open the modal
  _cachedPass = null;
  return new Promise((resolve, reject) => {
    showModal(async (pass) => {
      if (!pass) return reject(new Error('Cancelled'));
      try {
        // Verify password by attempting a load
        await loadWallet(pass);
        _cachedPass = pass;
        _unlockTime = Date.now();
        resolve(pass);
      } catch (e) {
        alert('Incorrect password');
        reject(new Error('Auth failed'));
      }
    });
  });
}

function showModal(callback) {
  if (!document.getElementById('kk-wallet-modal')) {
    const div = document.createElement('div');
    div.id = 'kk-wallet-modal';
    div.innerHTML = `
      <style>
        #kk-wallet-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 10000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); }
        .kk-modal-box { background: #111827; border: 1px solid #3af5d9; padding: 24px; border-radius: 16px; width: 320px; text-align: center; box-shadow: 0 0 30px rgba(58,245,217,0.15); }
        .kk-modal-box h3 { margin: 0 0 12px; color: #00ffc6; font-family: sans-serif; }
        .kk-modal-box input { width: 100%; padding: 12px; margin-bottom: 16px; background: #05070d; border: 1px solid #333; color: #fff; border-radius: 8px; font-size: 16px; }
        .kk-modal-btn { width: 100%; padding: 12px; background: #ffcc00; color: #000; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; }
        .kk-modal-close { margin-top: 16px; background: none; border: none; color: #666; cursor: pointer; font-size: 13px; text-decoration: underline; }
      </style>
      <div class="kk-modal-box">
        <h3>Unlock Wallet</h3>
        <p style="font-size:13px; color:#888; margin-bottom:16px;">Enter password to enable betting for 15 minutes.</p>
        <input type="password" id="kk-wallet-pass" placeholder="Wallet Password" autofocus>
        <button id="kk-wallet-confirm" class="kk-modal-btn">Unlock Session</button>
        <button id="kk-wallet-cancel" class="kk-modal-close">Cancel</button>
      </div>
    `;
    document.body.appendChild(div);
  }

  const modal = document.getElementById('kk-wallet-modal');
  const inp = document.getElementById('kk-wallet-pass');
  const btn = document.getElementById('kk-wallet-confirm');
  const close = document.getElementById('kk-wallet-cancel');

  modal.style.display = 'flex';
  inp.value = '';
  inp.focus();

  const finish = (val) => {
    modal.style.display = 'none';
    cleanup();
    callback(val);
  };

  const onEnter = (e) => { if(e.key === 'Enter') finish(inp.value); };
  const onBtn = () => finish(inp.value);
  const onCancel = () => finish(null);

  const cleanup = () => {
    btn.removeEventListener('click', onBtn);
    close.removeEventListener('click', onCancel);
    inp.removeEventListener('keydown', onEnter);
  };

  btn.addEventListener('click', onBtn);
  close.addEventListener('click', onCancel);
  inp.addEventListener('keydown', onEnter);
}