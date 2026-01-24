document.addEventListener("DOMContentLoaded", () => {
  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing solanaWeb3 or nacl");
    return;
  }

  const nacl = window.nacl;

  /* =====================================================
     BASE58 + HELPERS
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

  function parseSecretKey(secret) {
    if (secret.startsWith("[")) {
      const arr = JSON.parse(secret);
      if (!Array.isArray(arr) || arr.length !== 64) {
        throw new Error("Invalid JSON key");
      }
      return Uint8Array.from(arr);
    }

    const decoded = base58Decode(secret);
    if (decoded.length === 32) {
      return nacl.sign.keyPair.fromSeed(decoded).secretKey;
    }
    if (decoded.length === 64) {
      return decoded;
    }
    throw new Error("Invalid secret key");
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
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

  // Delay / fee controls (add inputs in HTML)
  const delayBaseInput = document.getElementById("delayBase");
  const delayJitterInput = document.getElementById("delayJitter");
  const maxFeeInput = document.getElementById("maxFee");

  let wallets = [];
  let mintTimer;
  let tokenDecimals = null;
  const quoteTimers = new WeakMap();

  /* =====================================================
     TOKEN METADATA (BACKEND)
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
        tokenDecimals = j.decimals ?? null;

        refreshAllQuotes();
      } catch (e) {
        console.error("Metadata error:", e);
      }
    }, 400);
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
     JUPITER QUOTE
  ===================================================== */
  async function getQuote(solAmount) {
    if (!tokenDecimals || solAmount <= 0) return null;

    const lamports = Math.floor(solAmount * 1e9);
    try {
      const q = await fetch(
        `https://lite-api.jup.ag/swap/v1/quote` +
        `?inputMint=So11111111111111111111111111111111111111112` +
        `&outputMint=${mintInput.value}` +
        `&amount=${lamports}` +
        `&slippageBps=50`
      ).then(r => r.json());

      if (!q?.outAmount) return null;
      return Number(q.outAmount) / 10 ** tokenDecimals;
    } catch {
      return null;
    }
  }

  /* =====================================================
     JUPITER SWAP (REAL)
  ===================================================== */
  async function executeJupiterSwap(secretKeyBytes, solAmount, priorityFee) {
    const mint = mintInput.value.trim();
    const lamports = Math.floor(solAmount * 1e9);

    const quote = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote` +
      `?inputMint=So11111111111111111111111111111111111111112` +
      `&outputMint=${mint}` +
      `&amount=${lamports}` +
      `&slippageBps=50`
    ).then(r => r.json());

    if (!quote?.outAmount) {
      throw new Error("No Jupiter route");
    }

    const kp = solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);

    const swap = await fetch(
      "https://lite-api.jup.ag/swap/v1/swap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: kp.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: priorityFee || "auto"
        })
      }
    ).then(r => r.json());

    if (!swap?.swapTransaction) {
      throw new Error("No swap transaction");
    }

    const tx = solanaWeb3.VersionedTransaction.deserialize(
      base64ToBytes(swap.swapTransaction)
    );
    tx.sign([kp]);

    const res = await fetch("/api/send-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawTx: btoa(String.fromCharCode(...tx.serialize()))
      })
    }).then(r => r.json());

    if (!res.ok) throw new Error(res.error);
    return res.signature;
  }

  /* =====================================================
     WALLET UI (STATEFUL)
  ===================================================== */
  function renderWallets() {
    walletList.innerHTML = "";

    wallets.forEach((w, i) => {
      const div = document.createElement("div");
      div.className = "wallet";

      div.innerHTML = `
        <div class="wallet-header">
          <span>Wallet ${i + 1}</span>
          <button class="danger">✕</button>
        </div>

        <div class="field">
          <label>Private Key</label>
          <input class="secret-input" value="${w.secret}" />
        </div>

        <div class="field amount-row">
          <div>
            <label class="sol-balance-label">${w.balance}</label>
            <input type="number" step="0.0001" min="0" value="${w.solAmount}" />
          </div>
          <div>
            <label class="quote">Quote</label>
            <input type="text" readonly value="${w.quote}" />
          </div>
        </div>
      `;

      const pkInput = div.querySelector(".secret-input");
      const solInput = div.querySelector("input[type='number']");
      const outInput = div.querySelector("input[readonly]");
      const balanceLabel = div.querySelector(".sol-balance-label");

      pkInput.oninput = e => {
        w.secret = e.target.value;
      };

      pkInput.onblur = async () => {
        try {
          const sk = parseSecretKey(w.secret);
          const kp = solanaWeb3.Keypair.fromSecretKey(sk);
          const sol = await fetchSolBalance(kp.publicKey.toBase58());
          w.balance = `Balance: ${sol.toFixed(4)} SOL`;
          balanceLabel.textContent = w.balance;
        } catch {
          w.balance = "Balance: Invalid key";
          balanceLabel.textContent = w.balance;
        }
      };

      solInput.oninput = () => {
        w.solAmount = solInput.value;
        updateTotalCost();
        debounceQuote(div, w, solInput, outInput);
      };

      div.querySelector(".danger").onclick = () => {
        wallets.splice(i, 1);
        renderWallets();
        updateTotalCost();
      };

      walletList.appendChild(div);
    });

    walletCount.textContent = wallets.length;
  }

  /* =====================================================
     QUOTE HELPERS
  ===================================================== */
  function debounceQuote(walletEl, wallet, solInput, outInput) {
    if (quoteTimers.has(walletEl)) {
      clearTimeout(quoteTimers.get(walletEl));
    }

    outInput.value = "…";
    const t = setTimeout(async () => {
      const q = await getQuote(Number(solInput.value));
      wallet.quote =
        typeof q === "number" ? q.toFixed(4) : "--";
      outInput.value = wallet.quote;
    }, 400);

    quoteTimers.set(walletEl, t);
  }

  function refreshAllQuotes() {
    document.querySelectorAll(".wallet").forEach((el, i) => {
      const w = wallets[i];
      const sol = el.querySelector("input[type='number']");
      const out = el.querySelector("input[readonly]");
      if (Number(sol.value) > 0) {
        debounceQuote(el, w, sol, out);
      }
    });
  }

  /* =====================================================
     TOTAL COST
  ===================================================== */
  function updateTotalCost() {
    let total = 0;
    wallets.forEach(w => {
      total += Number(w.solAmount) || 0;
    });
    totalCost.textContent = total.toFixed(4) + " SOL";
    buyBtn.disabled = total <= 0;
  }

  /* =====================================================
     BUY BUNDLE (DELAY + FEE JITTER)
  ===================================================== */
  buyBtn.onclick = async () => {
    const baseDelay = Number(delayBaseInput?.value) || 0;
    const jitter = Number(delayJitterInput?.value) || 0;
    const maxFee = Number(maxFeeInput?.value) || 0;

    const jobs = wallets
      .map(w => {
        if (!w.secret || !w.solAmount) return null;
        try {
          return {
            sol: Number(w.solAmount),
            sk: parseSecretKey(w.secret)
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    for (let i = 0; i < jobs.length; i++) {
      const delay =
        baseDelay + Math.floor(Math.random() * jitter);
      const fee =
        maxFee > 0
          ? Math.floor(Math.random() * maxFee)
          : "auto";

      setTimeout(async () => {
        try {
          const sig = await executeJupiterSwap(
            jobs[i].sk,
            jobs[i].sol,
            fee
          );
          console.log(`Wallet ${i + 1} SUCCESS:`, sig);
        } catch (e) {
          console.error(`Wallet ${i + 1} FAILED:`, e.message);
        }
      }, delay * i);
    }
  };

  /* =====================================================
     INIT
  ===================================================== */
  wallets.push({
    secret: "",
    solAmount: "",
    quote: "--",
    balance: "Balance: -- SOL"
  });

  renderWallets();
  updateTotalCost();

  addWalletBtn.onclick = () => {
    if (wallets.length >= 16) return;
    wallets.push({
      secret: "",
      solAmount: "",
      quote: "--",
      balance: "Balance: -- SOL"
    });
    renderWallets();
  };
});
