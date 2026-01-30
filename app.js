document.addEventListener("DOMContentLoaded", () => {
  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing dependencies");
    return;
  }

  const nacl = window.nacl;

  /* ================= ICONS ================= */
const SOLSCAN_ICON = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="#e5e7eb" xmlns="http://www.w3.org/2000/svg">
  <path d="M18,10.82a1,1,0,0,0-1,1V19a1,1,0,0,1-1,1H5a1,1,0,0,1-1-1V8A1,1,0,0,1,5,7h7.18a1,1,0,0,0,0-2H5A3,3,0,0,0,2,8V19a3,3,0,0,0,3,3H16a3,3,0,0,0,3-3V11.82A1,1,0,0,0,18,10.82Zm3.92-8.2a1,1,0,0,0-.54-.54A1,1,0,0,0,21,2H15a1,1,0,0,0,0,2h3.59L8.29,14.29a1,1,0,0,0,0,1.42,1,1,0,0,0,1.42,0L20,5.41V9a1,1,0,0,0,2,0V3A1,1,0,0,0,21.92,2.62Z"/>
</svg>
`;


  const TRASH_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    xmlns="http://www.w3.org/2000/svg">
    <path stroke="currentColor" stroke-linecap="round"
      stroke-linejoin="round" stroke-width="2"
      d="M5 7h14m-9 3v8m4-8v8M10
      3h4a1 1 0 0 1 1 1v3H9V4
      a1 1 0 0 1 1-1ZM6 7h12v13
      a1 1 0 0 1-1 1H7a1 1 0
      0 1-1-1V7Z"/>
  </svg>`;

  /* ================= BASE58 ================= */
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

  function formatQuote(n) {
    if (!n) return "--";
    if (n < 1000) return Math.floor(n).toString();
    if (n < 1_000_000) return Math.floor(n / 1000) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
  }

  /* ================= DOM ================= */
  const activeWalletEl = document.getElementById("activeWallet");
  const walletHistoryEl = document.getElementById("walletHistory");
  const addWalletBtn = document.getElementById("addWalletBtn");
  const walletCount = document.getElementById("walletCount");
  const buyBtn = document.getElementById("buyBtn");
  const totalCost = document.getElementById("totalCost");

  const mintInput = document.getElementById("mintAddress");
  const tickerBadge = document.getElementById("tickerBadge");
  const logoPreview = document.getElementById("logoPreview");
  const logoText = document.getElementById("logoText");

  const txModal = document.getElementById("txModal");
  const txList = document.getElementById("txList");
  const closeModal = document.getElementById("closeModal");
  closeModal.onclick = () => txModal.classList.add("hidden");

  let wallets = [];
  let activeIndex = 0;
  let tokenDecimals = null;
  let mintTimer;
  const quoteTimers = new WeakMap();

  /* ================= TOKEN METADATA ================= */
  mintInput.addEventListener("input", () => {
    clearTimeout(mintTimer);
    mintTimer = setTimeout(async () => {
      const mint = mintInput.value.trim();
      if (mint.length < 32) return;

      const r = await fetch(`/api/new-address?mode=tokenMetadata&mint=${mint}`);
      const j = await r.json();
      if (!j.ok) return;

      tickerBadge.textContent = j.symbol || "—";

      if (j.image) {
        logoPreview.src = j.image;
        logoPreview.style.display = "block";
        logoText.style.display = "none";
      } else {
        logoPreview.style.display = "none";
        logoText.style.display = "block";
      }
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
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mintInput.value}&amount=${lamports}&slippageBps=300`
    ).then(r => r.json());
    if (!q?.outAmount) return null;
    return Number(q.outAmount) / 10 ** tokenDecimals;
  }

  async function executeSwap(secretKey, solAmount) {
  const lamports = Math.floor(solAmount * 1e9);
  const kp = solanaWeb3.Keypair.fromSecretKey(secretKey);

  // 1️⃣ Get quote
  const quote = await fetch(
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mintInput.value}&amount=${lamports}&slippageBps=300`
  ).then(r => r.json());

  if (!quote || quote.error) {
    console.error("JUPITER QUOTE ERROR:", quote);
    throw new Error(quote?.error || "Quote failed");
  }

  // 2️⃣ Request swap transaction
  const swap = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: "auto",
      dynamicComputeUnitLimit: true
    })
  }).then(r => r.json());

  // 🔴 THIS IS THE CRITICAL FIX
  if (!swap || !swap.swapTransaction) {
    console.error("JUPITER SWAP ERROR:", swap);
    throw new Error(swap?.error || "Jupiter swap failed");
  }

  // 3️⃣ Deserialize transaction
  const tx = solanaWeb3.VersionedTransaction.deserialize(
    Uint8Array.from(
      atob(swap.swapTransaction),
      c => c.charCodeAt(0)
    )
  );

  // 4️⃣ Sign transaction
  tx.sign([kp]);

  // 5️⃣ Send via backend (browser-safe base64)
  const rawTxBase64 = btoa(
    String.fromCharCode(...tx.serialize())
  );

  const res = await fetch("/api/send-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawTx: rawTxBase64 })
  }).then(r => r.json());

  if (!res.signature) {
    console.error("SEND TX ERROR:", res);
    throw new Error("RPC send failed");
  }

  return res.signature;
}

  /* ================= WALLET UI ================= */
  function renderWallets() {
  activeWalletEl.innerHTML = "";
  walletHistoryEl.innerHTML = "";

  const active = wallets[activeIndex];

  /* -------- ACTIVE WALLET -------- */
  const div = document.createElement("div");
  div.className = "wallet";
  div.style.height = "230px";

  div.innerHTML = `
    <div class="wallet-header">
      <span class="wallet-title">
        Wallet ${activeIndex + 1}
        <button class="delete-wallet">${TRASH_ICON}</button>
      </span>
      <span>${active.lastStatus || ""}</span>
    </div>

    <div class="wallet-body">
      <label>Private Key</label>
      <input class="secret-input" value="${active.secret}" />

      <div class="amount-row">
        <div>
          <label class="sol-balance-label">${active.balance}</label>
          <input type="number" step="0.0001" min="0" value="${active.sol}" />
        </div>
        <div>
          <label>Quote</label>
          <input type="text" readonly value="${active.quote}" />
        </div>
      </div>
    </div>
  `;

  activeWalletEl.appendChild(div);

  /* -------- ACTIVE EVENTS -------- */
  const pkInput = div.querySelector(".secret-input");
  const solInput = div.querySelector("input[type='number']");
  const quoteInput = div.querySelector("input[readonly]");
  const balanceLabel = div.querySelector(".sol-balance-label");

  pkInput.onblur = async () => {
    try {
      const sk = parseSecretKey(pkInput.value.trim());
      const kp = solanaWeb3.Keypair.fromSecretKey(sk);
      const sol = await fetchSolBalance(kp.publicKey.toBase58());
      active.secret = pkInput.value;
      active.sk = sk;
      active.balance = `Balance: ${sol.toFixed(4)} SOL`;
      balanceLabel.textContent = active.balance;
    } catch {
      balanceLabel.textContent = "Balance: Invalid key";
    }
  };

  solInput.oninput = () => {
    active.sol = solInput.value;
    updateTotalCost();
    debounceQuote(div, active, solInput, quoteInput);
  };

  div.querySelector(".delete-wallet").onclick = () => {
    wallets.splice(activeIndex, 1);
    activeIndex = Math.max(0, activeIndex - 1);
    renderWallets();
    updateTotalCost();
  };

  /* -------- HISTORY LIST -------- */
  wallets.forEach((w, i) => {
    if (i === activeIndex) return;

    const mini = document.createElement("div");
    mini.className = "wallet-mini";
    mini.innerHTML = `
      <span>Wallet ${i + 1}</span>
      <span class="status">${w.lastStatus || ""}</span>
    `;

    mini.onclick = () => {
      activeIndex = i;
      renderWallets();
    };

    walletHistoryEl.appendChild(mini);
  });

  walletCount.textContent = wallets.length;
}

  function debounceQuote(walletEl, wallet, solInput, outInput) {
    if (quoteTimers.has(walletEl)) clearTimeout(quoteTimers.get(walletEl));
    outInput.value = "…";
    const t = setTimeout(async () => {
      const q = await getQuote(Number(solInput.value));
      wallet.quote = formatQuote(q);
      outInput.value = wallet.quote;
    }, 400);
    quoteTimers.set(walletEl, t);
  }

  function refreshAllQuotes() {
    document.querySelectorAll(".wallet").forEach((el, i) => {
      const sol = el.querySelector("input[type='number']");
      const out = el.querySelector("input[readonly]");
      if (Number(sol.value) > 0) debounceQuote(el, wallets[i], sol, out);
    });
  }

  function updateTotalCost() {
    const total = wallets.reduce((s, w) => s + (Number(w.sol) || 0), 0);
    totalCost.textContent = total.toFixed(4) + " SOL";
    buyBtn.disabled = total <= 0;
  }

  /* ================= BUY ================= */
  buyBtn.onclick = async () => {
    const active = wallets.filter(w => w.sk && w.sol);
    if (!active.length) return;

    openTxModal(active.length);

    active.forEach((w, i) => {
      w.lastStatus = "⏳";
      renderWallets();

      setTimeout(async () => {
        try {
          const sig = await executeSwap(w.sk, Number(w.sol));
          setTxStatus(i, "success", sig);
          w.lastStatus = "✅";
        } catch {
          setTxStatus(i, "failed");
          w.lastStatus = "❌";
        }
        renderWallets();
      }, i * 250);
    });
  };

  /* ================= MODAL ================= */
  function openTxModal(count) {
    txList.innerHTML = "";
    for (let i = 0; i < count; i++) {
      txList.innerHTML += `
        <div class="tx-row">
          <span>Wallet ${i + 1}</span>
          <span class="tx-status queued" id="tx-${i}">Queued</span>
        </div>`;
    }
    txModal.classList.remove("hidden");
  }

function setTxStatus(i, status, sig) {
  const el = document.getElementById(`tx-${i}`);
  if (status === "success") {
    el.innerHTML = `
      <span class="tx-success-text">Success</span>
      <a
        href="https://solscan.io/tx/${sig}"
        target="_blank"
        rel="noopener"
        class="tx-link"
        aria-label="View on Solscan"
      >
        ${SOLSCAN_ICON}
      </a>
    `;
    el.className = "tx-status success";
  } else {
    el.textContent = "Failed";
    el.className = "tx-status failed";
  }
}

  /* ================= INIT ================= */
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
