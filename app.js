document.addEventListener("DOMContentLoaded", () => {

  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing dependencies");
    return;
  }

  const nacl = window.nacl;

  /* =====================================================
     INLINE BASE58 DECODER
  ===================================================== */
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const MAP = {};
  for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET[i]] = i;

  function base58Decode(str) {
    let bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const val = MAP[str[i]];
      if (val === undefined) throw new Error("Invalid Base58");
      let carry = val;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (let i = 0; i < str.length && str[i] === "1"; i++) {
      bytes.push(0);
    }
    return Uint8Array.from(bytes.reverse());
  }

  /* =====================================================
     DOM
  ===================================================== */
  const walletList = document.getElementById("walletList");
  const addWalletBtn = document.getElementById("addWalletBtn");
  const walletCount = document.getElementById("walletCount");

  let wallets = [];

  /* =====================================================
     SERVER BALANCE FETCH (ENV-SAFE)
  ===================================================== */
  async function fetchSolBalance(pubkey) {
    try {
      const r = await fetch(`/api/sol-balance?pubkey=${pubkey}`);
      const j = await r.json();
      if (!r.ok) throw j;
      return j.lamports / 1e9;
    } catch (e) {
      console.error("Balance fetch failed:", e);
      return 0;
    }
  }

  /* =====================================================
     WALLET UI
  ===================================================== */
  function createWallet(index) {
    const div = document.createElement("div");
    div.className = "wallet";
    div.innerHTML = `
      <div class="wallet-header">
        <span>Wallet ${index + 1}</span>
        <button class="danger">✕</button>
      </div>

      <div class="field">
        <label>Private Key</label>
        <input class="secret-input" placeholder="Base58 seed / full key / JSON" />
      </div>

      <div class="field">
        <label class="sol-balance-label">Balance: -- SOL</label>
      </div>
    `;

    const pkInput = div.querySelector(".secret-input");
    const balanceLabel = div.querySelector(".sol-balance-label");

    pkInput.addEventListener("blur", async () => {
      const secret = pkInput.value.trim();
      if (!secret) return;

      try {
        let secretKey;

        if (secret.startsWith("[")) {
          const arr = JSON.parse(secret);
          if (!Array.isArray(arr) || arr.length !== 64) throw 0;
          secretKey = Uint8Array.from(arr);
        } else {
          const decoded = base58Decode(secret);
          if (decoded.length === 32) {
            secretKey = nacl.sign.keyPair.fromSeed(decoded).secretKey;
          } else if (decoded.length === 64) {
            secretKey = decoded;
          } else {
            throw 0;
          }
        }

        const kp = solanaWeb3.Keypair.fromSecretKey(secretKey);
        const sol = await fetchSolBalance(kp.publicKey.toBase58());
        balanceLabel.textContent = `Balance: ${sol.toFixed(4)} SOL`;
      } catch {
        balanceLabel.textContent = "Balance: Invalid private key";
      }
    });

    div.querySelector(".danger").onclick = () => {
      wallets.splice(index, 1);
      renderWallets();
    };

    return div;
  }

  function renderWallets() {
    walletList.innerHTML = "";
    wallets.forEach((_, i) => walletList.appendChild(createWallet(i)));
    walletCount.textContent = wallets.length;
  }

  addWalletBtn.onclick = () => {
    wallets.push({});
    renderWallets();
  };

  wallets.push({});
  renderWallets();
});
