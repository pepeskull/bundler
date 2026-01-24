document.addEventListener("DOMContentLoaded", () => {

  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing dependencies");
    return;
  }

  const nacl = window.nacl;

  /* =====================================================
     BASE58 DECODER
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

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
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
  let tokenDecimals = null;

  /* =====================================================
     TOKEN METADATA
  ===================================================== */
  mintInput.addEventListener("input", () => {
    clearTimeout(mintTimer);
    mintTimer = setTimeout(async () => {
      const mint = mintInput.value.trim();
      if (mint.length < 32) return;

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
    }, 500);
  });

  /* =====================================================
     JUPITER SWAP (REAL)
  ===================================================== */
  async function executeJupiterSwap(secretKeyBytes, solAmount) {
    const mint = mintInput.value.trim();
    const lamports = Math.floor(solAmount * 1e9);

    const quote = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote` +
      `?inputMint=So11111111111111111111111111111111111111112` +
      `&outputMint=${mint}` +
      `&amount=${lamports}` +
      `&slippageBps=50`
    ).then(r => r.json());

    if (!quote?.outAmount) throw new Error("No Jupiter route");

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
          prioritizationFeeLamports: "auto"
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

    // 🔒 SEND VIA BACKEND (RPC HIDDEN)
    const res = await fetch("/api/send-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawTx: btoa(
          String.fromCharCode(...tx.serialize())
        )
      })
    }).then(r => r.json());

    if (!res.ok) throw new Error(res.error);

    return res.signature;
  }

  /* =====================================================
     BUY BUNDLE
  ===================================================== */
  buyBtn.onclick = async () => {
    const jobs = [];

    document.querySelectorAll(".wallet").forEach(w => {
      const sol = Number(w.querySelector("input[type='number']").value);
      const secret = w.querySelector(".secret-input").value.trim();
      if (!sol || !secret) return;

      let sk;
      if (secret.startsWith("[")) {
        sk = Uint8Array.from(JSON.parse(secret));
      } else {
        const d = base58Decode(secret);
        sk = d.length === 32
          ? nacl.sign.keyPair.fromSeed(d).secretKey
          : d;
      }

      jobs.push({ sol, sk });
    });

    if (!jobs.length) return;

    const results = await Promise.allSettled(
      jobs.map(j => executeJupiterSwap(j.sk, j.sol))
    );

    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        console.log(`Wallet ${i + 1} TX:`, r.value);
      } else {
        console.error(`Wallet ${i + 1} FAILED:`, r.reason);
      }
    });
  };

  /* =====================================================
     UI HELPERS (unchanged)
  ===================================================== */
  function debounceQuote(walletEl, solInput, outInput) {
    if (quoteTimers.has(walletEl)) {
      clearTimeout(quoteTimers.get(walletEl));
    }
    outInput.value = "…";
    const t = setTimeout(async () => {
      const q = await getQuote(Number(solInput.value));
      outInput.value =
        typeof q === "number" ? q.toFixed(4) : "--";
    }, 400);
    quoteTimers.set(walletEl, t);
  }

  async function getQuote(solAmount) {
    if (!tokenDecimals || solAmount <= 0) return null;
    const lamports = Math.floor(solAmount * 1e9);
    const q = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote` +
      `?inputMint=So11111111111111111111111111111111111111112` +
      `&outputMint=${mintInput.value}` +
      `&amount=${lamports}` +
      `&slippageBps=50`
    ).then(r => r.json());
    if (!q?.outAmount) return null;
    return Number(q.outAmount) / 10 ** tokenDecimals;
  }

  function updateTotalCost() {
    let total = 0;
    document.querySelectorAll(".wallet input[type='number']").forEach(i => {
      total += Number(i.value) || 0;
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

  function renderWallets() {
    walletList.innerHTML = "";
    wallets.forEach((_, i) => walletList.appendChild(createWallet(i)));
    walletCount.textContent = wallets.length;
  }

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
        <input class="secret-input" />
      </div>
      <div class="field amount-row">
        <input type="number" step="0.0001" />
        <input type="text" readonly />
      </div>
    `;
    div.querySelector("input[type='number']").oninput = () => {
      updateTotalCost();
      debounceQuote(div,
        div.querySelector("input[type='number']"),
        div.querySelector("input[readonly]")
      );
    };
    return div;
  }

  addWalletBtn.onclick = () => {
    wallets.push({});
    renderWallets();
  };

  wallets.push({});
  renderWallets();
});
