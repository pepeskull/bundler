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
      const v = MAP[str[i]];
      if (v === undefined) throw new Error("Invalid Base58");
      let carry = v;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry) {
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
  const buyBtn = document.getElementById("buyBtn");
  const totalCost = document.getElementById("totalCost");

  const mintInput = document.getElementById("mintAddress");
  const tickerInput = document.getElementById("tokenTicker");
  const logoPreview = document.getElementById("logoPreview");
  const logoText = document.getElementById("logoText");

  let wallets = [];
  let mintTimer;
  const quoteTimers = new WeakMap();

  /* =====================================================
     TOKEN METADATA (BACKEND PROXY)
  ===================================================== */
  mintInput.addEventListener("input", () => {
    clearTimeout(mintTimer);
    mintTimer = setTimeout(async () => {
      const mint = mintInput.value.trim();
      if (mint.length < 32) return;

      try {
        const r = await fetch(
          `/api/new-address?mode=tokenMetadata&mint=${mint}`
        );
        const j = await r.json();
        if (!j.ok) return;

        tickerInput.value = j.symbol || "";
        logoPreview.src = j.image || "";
        logoText.style.display = j.image ? "none" : "block";
        refreshAllQuotes();
      } catch (e) {
        console.error("Metadata error:", e);
      }
    }, 500);
  });

  /* =====================================================
     SOL BALANCE (BACKEND RPC)
  ===================================================== */
  async function fetchSolBalance(pubkey) {
    try {
      const r = await fetch(`/api/sol-balance?pubkey=${pubkey}`);
      const j = await r.json();
      if (!r.ok) throw j;
      return j.lamports / 1e9;
    } catch {
      return 0;
    }
  }

  /* =====================================================
     JUPITER QUOTE (LITE API)
  ===================================================== */
  async function getQuote(solAmount) {
    const mint = mintInput.value.trim();
    if (!mint || solAmount <= 0) return null;

    const lamports = Math.floor(solAmount * 1e9);

    try {
      const r = await fetch(
        `https://lite-api.jup.ag/swap/v1/quote` +
        `?inputMint=So11111111111111111111111111111111111111112` +
        `&outputMint=${mint}` +
        `&amount=${lamports}` +
        `&slippageBps=50`
      );
      const q = await r.json();
      if (!q?.outAmount) return null;
      return q.outAmount / 10 ** q.outputDecimals;
    } catch {
      return null;
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
          <input type="number" step="0.0001" min="0" placeholder="0.1" />
        </div>
        <div>
          <label>Est. ${tickerInput.value || "Token"}</label>
          <input type="text" readonly placeholder="0.00" />
        </div>
      </div>
    `;

    const pkInput = div.querySelector(".secret-input");
    const solInput = div.querySelector("input[type='number']");
    const outInput = div.querySelector("input[readonly]");
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

    solInput.addEventListener("input", () => {
      updateTotalCost();
      debounceQuote(div, solInput, outInput);
    });

    div.querySelector(".danger").onclick = () => {
      wallets.splice(index, 1);
      renderWallets();
      updateTotalCost();
    };

    return div;
  }

  /* =====================================================
     QUOTES + TOTALS
  ===================================================== */
  function debounceQuote(walletEl, solInput, outInput) {
    if (quoteTimers.has(walletEl)) {
      clearTimeout(quoteTimers.get(walletEl));
    }
    outInput.value = "…";
    const t = setTimeout(async () => {
      const q = await getQuote(Number(solInput.value));
      outInput.value = q ? q.toFixed(4) : "0.00";
    }, 400);
    quoteTimers.set(walletEl, t);
  }

  function updateTotalCost() {
    let total = 0;
    document.querySelectorAll(".wallet input[type='number']").forEach(i => {
      const v = Number(i.value);
      if (v > 0) total += v;
    });
    totalCost.textContent = total.toFixed(4) + " SOL";
    buyBtn.disabled = total <= 0;
  }

  function refreshAllQuotes() {
    document.querySelectorAll(".wallet").forEach(w => {
      const sol = w.querySelector("input[type='number']");
      const out = w.querySelector("input[readonly]");
      if (sol.value > 0) debounceQuote(w, sol, out);
    });
  }

  /* =====================================================
     INIT
  ===================================================== */
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
  updateTotalCost();
});
