document.addEventListener("DOMContentLoaded", () => {
  const nacl = window.nacl;
  if (!nacl) {
    console.error("tweetnacl not loaded");
    return;
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
    "https://mainnet.helius-rpc.com/?api-key=51e57348-eaad-440e-8403-7d7cf1aa34e3",
    "confirmed"
  );

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
      const meta = await fetchTokenMetadata(mint);
      if (!meta) return;
      tickerInput.value = meta.symbol || "";
      logoPreview.src = meta.image || "";
      logoText.style.display = meta.image ? "none" : "block";
      refreshAllQuotes();
    }, 500);
  });

  async function fetchTokenMetadata(mint) {
    try {
      const res = await fetch(
        `/api/new-address?mode=tokenMetadata&mint=${mint}`
      );
      const json = await res.json();
      if (!json.ok) return null;
      return json;
    } catch (err) {
      console.error("Metadata error:", err);
      return null;
    }
  }

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
    } catch (err) {
      console.error("Quote error:", err);
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
        <input
          type="text"
          class="secret-input"
          placeholder="Base58 (usually 88 chars) or JSON array"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          inputmode="none"
        />
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

    /* ---- Fetch SOL balance when private key is entered ---- */
    pkInput.addEventListener("blur", async () => {
      let secret = pkInput.value.trim();
      if (!secret) {
        balanceLabel.textContent = "Balance: -- SOL";
        return;
      }
    
      try {
        // Cleanup: remove any non-Base58 chars (fixes paste issues)
        secret = secret.replace(/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/g, '');
    
        console.log("[DEBUG] Cleaned length:", secret.length);
        console.log("[DEBUG] Cleaned string:", secret);
    
        // For full key: 88 chars is standard; allow 87–89 to catch edge cases
        if (secret.length < 86 || secret.length > 90) {
          throw new Error(
            `Key length after cleanup is ${secret.length} chars.\n` +
            `Expected ~88 chars for Solana full private key.\n` +
            `Re-export and copy exactly from wallet.`
          );
        }
    
        if (secret.length !== 88) {
          console.warn(`[WARN] Length ${secret.length} (not 88) – trying anyway`);
        }
    
        let secretKeyBytes;
    
        // JSON array case
        if (secret.startsWith("[")) {
          const arr = JSON.parse(secret);
          if (!Array.isArray(arr) || arr.length !== 64) throw new Error("JSON must be 64 numbers");
          secretKeyBytes = Uint8Array.from(arr);
        } 
        // Base58 case – use standalone bs58
        else {
          let decoded;
          try {
            decoded = bs58.decode(secret);  // ← standalone bs58
            console.log("[DEBUG] Decoded bytes length:", decoded.length);
          } catch (e) {
            console.error("[bs58 error]", e);
            throw new Error("Base58 decode failed – likely invalid/incomplete key string");
          }
    
          if (decoded.length === 64) {
            secretKeyBytes = decoded;
          } else if (decoded.length === 32) {
            const naclKp = nacl.sign.keyPair.fromSeed(decoded);
            secretKeyBytes = naclKp.secretKey;
          } else {
            throw new Error(`Wrong decoded size: ${decoded.length} bytes`);
          }
        }
    
        if (secretKeyBytes.length !== 64) {
          throw new Error(`Final secret key not 64 bytes (got ${secretKeyBytes.length})`);
        }
    
        const keypair = solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);
        console.log("[SUCCESS] Public key:", keypair.publicKey.toBase58());
    
        const sol = await fetchSolBalance(keypair.publicKey);
        balanceLabel.textContent = `Balance: ${sol.toFixed(4)} SOL`;
      } catch (err) {
        console.error("[PARSE FAIL]", err.message || err);
        balanceLabel.textContent = "Balance: Invalid private key – see console";
      }
    });

    /* ---- Quote + total cost ---- */
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
     QUOTE DEBOUNCE
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

  /* =====================================================
     TOTAL COST
  ===================================================== */
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

  // Start with one empty wallet
  wallets.push({});
  renderWallets();
  updateTotalCost();
});




