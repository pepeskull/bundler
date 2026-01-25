document.addEventListener("DOMContentLoaded", () => {
  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing dependencies");
    return;
  }

  const nacl = window.nacl;

  /* =====================================================
     SOLSCAN ICON
  ===================================================== */
  const SOLSCAN_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
    xmlns="http://www.w3.org/2000/svg">
    <path fill-rule="evenodd"
      d="M14.516 6.743c-.41-.368-.443-1-.077-1.41a.99.99 0 0 1 1.405-.078l5.487 4.948A2.047 2.047 0 0 1 22 11.721a2.06 2.06 0 0 1-.662 1.51l-5.584 5.09a.99.99 0 0 1-1.404-.07 1.003 1.003 0 0 1 .068-1.412l5.578-5.082a.05.05 0 0 0 0-.072l-5.48-4.942ZM7.973 15.942v-.42a4.168 4.168 0 0 0-2.715 2.415 1.685 1.685 0 0 1-3.252-.684V15.88c0-3.77 2.526-7.039 5.967-7.573V7.57a1.957 1.957 0 0 1 3.146-1.654l5.08 4.248a2.1 2.1 0 0 1-.023 3.17l-5.08 4.25a1.957 1.957 0 0 1-3.123-1.394Z"
      clip-rule="evenodd"/>
  </svg>`;

  /* =====================================================
     BASE58
  ===================================================== */
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const MAP = {};
  for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET[i]] = i;

  function base58Decode(str) {
    let bytes = [0];
    for (let c of str) {
      const v = MAP[c];
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
    for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
    return Uint8Array.from(bytes.reverse());
  }

  function parseSecretKey(secret) {
    if (secret.startsWith("[")) return Uint8Array.from(JSON.parse(secret));
    const d = base58Decode(secret);
    if (d.length === 32) return nacl.sign.keyPair.fromSeed(d).secretKey;
    if (d.length === 64) return d;
    throw new Error("Invalid secret key");
  }

  function base64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

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

  const txModal = document.getElementById("txModal");
  const txList = document.getElementById("txList");
  const closeModal = document.getElementById("closeModal");
  closeModal.onclick = () => txModal.classList.add("hidden");

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

      const r = await fetch(`/api/new-address?mode=tokenMetadata&mint=${mint}`);
      const j = await r.json();
      if (!j.ok) return;

      tickerInput.value = j.symbol || "";
      logoPreview.src = j.image || "";
      logoText.style.display = j.image ? "none" : "block";
      tokenDecimals = j.decimals ?? null;

      refreshAllQuotes();
    }, 400);
  });

  async function fetchSolBalance(pubkey) {
    const r = await fetch(`/api/sol-balance?pubkey=${pubkey}`);
    const j = await r.json();
    return j.lamports / 1e9;
  }

  async function getQuote(solAmount) {
    if (!tokenDecimals || solAmount <= 0) return null;
    const lamports = Math.floor(solAmount * 1e9);
    const q = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mintInput.value}&amount=${lamports}&slippageBps=50`
    ).then(r => r.json());
    if (!q?.outAmount) return null;
    return Number(q.outAmount) / 10 ** tokenDecimals;
  }

  async function executeSwap(secretKey, solAmount) {
    const lamports = Math.floor(solAmount * 1e9);
    const kp = solanaWeb3.Keypair.fromSecretKey(secretKey);

    const quote = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mintInput.value}&amount=${lamports}&slippageBps=50`
    ).then(r => r.json());

    const swap = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: kp.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: "auto"
      })
    }).then(r => r.json());

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

    return res.signature;
  }

  /* =====================================================
     WALLET UI
  ===================================================== */
  function renderWallets() {
    walletList.innerHTML = "";

    wallets.forEach((w, i) => {
      const div = document.createElement("div");
      div.className = "wallet";
      if (i !== 0) div.classList.add("collapsed");

      div.innerHTML = `
        <div class="wallet-header collapsible">
          <span class="wallet-title">Wallet ${i + 1}</span>
          <span class="wallet-summary">
            ${w.balance !== "Balance: -- SOL" ? w.balance.replace("Balance: ", "") : ""}
            ${w.lastStatus || ""}
          </span>
          <button class="danger delete-wallet">✕</button>
          <span class="chevron">▾</span>
        </div>

        <div class="wallet-body">
          <label>Private Key</label>
          <input class="secret-input" value="${w.secret}" />

          <div class="amount-row">
            <div>
              <label class="sol-balance-label">${w.balance}</label>
              <input type="number" step="0.0001" min="0" value="${w.sol}" />
            </div>

            <div>
              <label class="quote">Quote</label>
              <input type="text" readonly value="${w.quote}" />
            </div>
          </div>
        </div>
      `;

      const header = div.querySelector(".wallet-header");
      header.onclick = () => {
        document.querySelectorAll(".wallet").forEach(el => {
          if (el !== div) el.classList.add("collapsed");
        });
        div.classList.toggle("collapsed");
      };

      div.querySelector(".delete-wallet").onclick = e => {
        e.stopPropagation();
        wallets.splice(i, 1);
        renderWallets();
        updateTotalCost();
      };

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
          renderWallets();
        } catch {
          balanceLabel.textContent = "Balance: Invalid key";
        }
      };

      solInput.oninput = () => {
        w.sol = solInput.value;
        updateTotalCost();
        debounceQuote(div, w, solInput, quoteInput);
      };

      walletList.appendChild(div);
    });

    walletCount.textContent = wallets.length;
  }

  function debounceQuote(walletEl, wallet, solInput, outInput) {
    if (quoteTimers.has(walletEl)) clearTimeout(quoteTimers.get(walletEl));
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
     BUY BUNDLE
  ===================================================== */
  buyBtn.onclick = async () => {
    const active = wallets.filter(w => w.sk && w.sol);
    if (!active.length) return;

    openTxModal(active.length);

    active.forEach((w, i) => {
      setTxStatus(i, "sending", "Sending");
      w.lastStatus = "⏳";
      renderWallets();

      setTimeout(async () => {
        try {
          setTxStatus(i, "pending", "Pending");
          const sig = await executeSwap(w.sk, Number(w.sol));
          setTxStatus(i, "success", "Transaction successful", sig);
          w.lastStatus = "✅";
          renderWallets();
        } catch {
          setTxStatus(i, "failed", "Failed");
          w.lastStatus = "❌";
          renderWallets();
        }
      }, i * 75);
    });
  };

  /* =====================================================
     TX MODAL
  ===================================================== */
  function openTxModal(count) {
    txList.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const row = document.createElement("div");
      row.className = "tx-row";
      row.innerHTML = `
        <span>Wallet ${i + 1}</span>
        <span class="tx-status queued" id="tx-status-${i}">Queued</span>
      `;
      txList.appendChild(row);
    }
    txModal.classList.remove("hidden");
  }

  function setTxStatus(i, cls, text, sig = null) {
    const el = document.getElementById(`tx-status-${i}`);
    if (!el) return;
    el.className = `tx-status ${cls}`;

    if (cls === "success" && sig) {
      el.innerHTML = `
        <span>${text}</span>
        <a class="tx-link" href="https://solscan.io/tx/${sig}" target="_blank">
          ${SOLSCAN_ICON}
        </a>`;
    } else {
      el.textContent = text;
    }
  }

  /* =====================================================
     INIT
  ===================================================== */
  wallets.unshift({
    secret: "",
    sk: null,
    sol: "",
    quote: "--",
    balance: "Balance: -- SOL",
    lastStatus: ""
  });

  renderWallets();
  updateTotalCost();

  addWalletBtn.onclick = () => {
    if (wallets.length >= 16) return;
    wallets.unshift({
      secret: "",
      sk: null,
      sol: "",
      quote: "--",
      balance: "Balance: -- SOL",
      lastStatus: ""
    });
    renderWallets();
  };
});
