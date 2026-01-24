document.addEventListener("DOMContentLoaded", () => {

  if (!window.solanaWeb3) {
    console.error("solanaWeb3 not loaded");
    return;
  }
  if (!window.nacl) {
    console.error("tweetnacl not loaded");
    return;
  }

  const nacl = window.nacl;

  /* =====================================================
     MINIMAL BASE58 DECODER (INLINE, NO DEPENDENCIES)
     Supports Solana keys perfectly
  ===================================================== */
  const BASE58_ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const BASE58_MAP = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    BASE58_MAP[BASE58_ALPHABET[i]] = i;
  }

  function base58Decode(str) {
    let bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (!(c in BASE58_MAP)) {
        throw new Error("Invalid Base58 character");
      }
      let carry = BASE58_MAP[c];
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

    // handle leading zeros
    for (let i = 0; i < str.length && str[i] === "1"; i++) {
      bytes.push(0);
    }

    return Uint8Array.from(bytes.reverse());
  }

  /* =====================================================
     GLOBALS & CONNECTION
  ===================================================== */
  const walletList = document.getElementById("walletList");
  const addWalletBtn = document.getElementById("addWalletBtn");
  const walletCount = document.getElementById("walletCount");
  const buyBtn = document.getElementById("buyBtn");
  const totalCost = document.getElementById("totalCost");
  const mintInput = document.getElementById("mintAddress");
  const tickerInput = document.getElementById("tokenTicker");
  const logoPreview = document.getElementById("logoPreview");
  const logoText = document.getElementById("logoText");

  const connection = new solanaWeb3.Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed"
  );

  let wallets = [];
  const quoteTimers = new WeakMap();

  /* =====================================================
     SOL BALANCE
  ===================================================== */
  async function fetchSolBalance(pubkey) {
    try {
      const lamports = await connection.getBalance(pubkey);
      return lamports / 1e9;
    } catch {
      return 0;
    }
  }

  /* =====================================================
     WALLETS
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

      <div class="field amount-row">
        <div>
          <label class="sol-balance-label">Balance: -- SOL</label>
          <input type="number" step="0.0001" min="0" />
        </div>
        <div>
          <label>Est. ${tickerInput.value || "Token"}</label>
          <input type="text" readonly />
        </div>
      </div>
    `;

    const pkInput = div.querySelector(".secret-input");
    const solInput = div.querySelector("input[type='number']");
    const balanceLabel = div.querySelector(".sol-balance-label");

    pkInput.addEventListener("blur", async () => {
      let secret = pkInput.value.trim();
      if (!secret) return;

      try {
        let secretKey;

        if (secret.startsWith("[")) {
          const arr = JSON.parse(secret);
          if (!Array.isArray(arr) || arr.length !== 64) {
            throw new Error("Invalid JSON key");
          }
          secretKey = Uint8Array.from(arr);
        } else {
          const decoded = base58Decode(secret);

          if (decoded.length === 32) {
            secretKey = nacl.sign.keyPair.fromSeed(decoded).secretKey;
          } else if (decoded.length === 64) {
            secretKey = decoded;
          } else {
            throw new Error("Invalid key length");
          }
        }

        const kp = solanaWeb3.Keypair.fromSecretKey(secretKey);
        const sol = await fetchSolBalance(kp.publicKey);
        balanceLabel.textContent = `Balance: ${sol.toFixed(4)} SOL`;
      } catch (e) {
        console.error(e);
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
    if (wallets.length >= 16) return;
    wallets.push({});
    renderWallets();
  };

  wallets.push({});
  renderWallets();
});
