document.addEventListener("DOMContentLoaded", () => {
  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing dependencies");
    return;
  }

  const nacl = window.nacl;

  /* =====================================================
     BASE58
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
      return Uint8Array.from(JSON.parse(secret));
    }
    const d = base58Decode(secret);
    return d.length === 32
      ? nacl.sign.keyPair.fromSeed(d).secretKey
      : d;
  }

  function base64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  /* =====================================================
     FORMAT QUOTE (YOUR RULES)
  ===================================================== */
  function formatQuote(n) {
    if (n < 1000) return Math.floor(n).toString();
    if (n < 1_000_000) return Math.floor(n / 1000) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
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
  let tokenDecimals = null;
  let mintTimer;
  const quoteTimers = new WeakMap();

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
    }, 400);
  });

  /* =====================================================
     SOL BALANCE (BACKEND)
  ===================================================== */
  async function fetchSolBalance(pubkey) {
    try {
      const r = await fetch(`/api/sol-balance?pubkey=${pubkey}`);
      const j = await r.json();
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

  /* =====================================================
     JUPITER SWAP (REAL)
  ===================================================== */
  async function executeSwap(secretKey, solAmount) {
    const lamports = Math.floor(solAmount * 1e9);
    const kp = solanaWeb3.Keypair.fromSecretKey(secretKey);

    const quote = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote` +
      `?inputMint=So11111111111111111111111111111111111111112` +
      `&outputMint=${mintInput.value}` +
      `&amount=${lamports}` +
      `&slippageBps=50`
    ).then(r => r.json());

    const swap = await fetch(
      "https://lite-api.jup.ag/swap/v1/swap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: kp.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: "auto"
        })
      }
    ).then(r => r.json());

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

    console.log("TX:", res.signature);
    console.log("Solscan:", `https://solscan.io/tx/${res.signature}`);
  }

  /* =====================================================
     WALLET UI
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

        <label>Private Key</label>
        <input class="secret-input" value="${w.secret}" />

        <label class="sol-balance-label">${w.balance}</label>
        <input type="number" step="0.0001" min="0" value="${w.sol}" />

        <label class="quote">Quote</label>
        <input type="text" readonly value="${w.quote}" />
      `;

      const pkInput = div.querySelector(".secret-input");
      const solInput = div.querySelector("input[type='number']");
      const quoteInput = div.querySelector("input[readonly]");
      const balanceLabel = div.querySelector(".sol-balance-label");

      pkInput.onblur = async () => {
        try {
          const sk = parseSecretKey(pkInput.value.trim());
          const kp = solanaWeb3.Keypair.fromSecretKey(sk);
          const sol = await fetchSolBalance(kp.publicKey.toBase58());

          w.secret = pkInput.value;
          w.sk = sk;
          w.balance = `Balance: ${sol.toFixed(4)} SOL`;
          balanceLabel.textContent = w.balance;
        } catch {
          balanceLabel.textContent = "Balance: Invalid key";
        }
      };

      solInput.oninput = () => {
        w.sol = solInput.value;
        updateTotalCost();
        debounceQuote(div, w, solInput, quoteInput);
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

  function debounceQuote(walletEl, wallet, solInput, outInput) {
    if (quoteTimers.has(walletEl)) {
      clearTimeout(quoteTimers.get(walletEl));
    }
    outInput.value = "…";
    const t = setTimeout(async () => {
      const q = await getQuote(Number(solInput.value));
      wallet.quote = q ? formatQuote(q) : "--";
      outInput.value = wallet.quote;
    }, 400);
    quoteTimers.set(walletEl, t);
  }

  function refreshAllQuotes() {
    document.querySelectorAll(".wallet").forEach((el, i) => {
      const w = wallets[i];
      const sol = el.querySelector("input[type='number']");
      const out = el.querySelector("input[readonly]");
      if (Number(sol.value) > 0) debounceQuote(el, w, sol, out);
    });
  }

  function updateTotalCost() {
    let total = 0;
    wallets.forEach(w => total += Number(w.sol) || 0);
    totalCost.textContent = total.toFixed(4) + " SOL";
    buyBtn.disabled = total <= 0;
  }

  /* =====================================================
     BUY BUNDLE (SIMPLE, SAFE)
  ===================================================== */
  buyBtn.onclick = async () => {
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      if (!w.sk || !w.sol) continue;

      setTimeout(() => {
        executeSwap(w.sk, Number(w.sol))
          .catch(e => console.error(e.message));
      }, i * 75); // small jitter, simple
    }
  };

  /* =====================================================
     INIT
  ===================================================== */
  wallets.push({
    secret: "",
    sk: null,
    sol: "",
    quote: "--",
    balance: "Balance: -- SOL"
  });

  renderWallets();
  updateTotalCost();

  addWalletBtn.onclick = () => {
    if (wallets.length >= 16) return;
    wallets.push({
      secret: "",
      sk: null,
      sol: "",
      quote: "--",
      balance: "Balance: -- SOL"
    });
    renderWallets();
  };
});
