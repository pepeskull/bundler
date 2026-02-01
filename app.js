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
  </svg>`;

  const TRASH_ICON = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    xmlns="http://www.w3.org/2000/svg">
    <path stroke="currentColor" stroke-linecap="round"
      stroke-linejoin="round" stroke-width="2"
      d="M5 7h14m-9 3v8m4-8v8M10
      3h4a1 1 0 0 1 1 1v3H9V4
      a1 1 0 0 1 1-1ZM6 7h12v13
      a1 1 0 0 1-1 1H7a1 1 0
      0 1-1-1V7Z"/>
  </svg>`;

  /* ================= PAGE TOGGLE ================= */

const accessPage = document.getElementById("access-page");
const bundlePage = document.getElementById("bundle-page");

function showAccess() {
  accessPage.classList.remove("hidden");
  bundlePage.classList.add("hidden");
}

function showBundle() {
  accessPage.classList.add("hidden");
  bundlePage.classList.remove("hidden");
}

/* ================= ACCESS GUARD ================= */

function enforceAccess() {
  const hasAccess = sessionStorage.getItem("accessToken");
  if (!hasAccess) {
    showAccess();
    return false;
  }
  showBundle();
  return true;
}

/* ================= PAYMENT CONFIG ================= */

const REQUIRED_SOL = 0.001; // testing value

const qrCanvas = document.getElementById("qr-canvas");
const addressInput = document.getElementById("receive-address");
const copyBtn = document.getElementById("copy-receive-address");
const continueBtn = document.getElementById("continue-btn");

let paymentToken = null;

/* ================= BUTTON STATE ================= */

function setContinueState(state) {
  continueBtn.classList.remove("waiting", "detected", "processing", "ready");

  switch (state) {
    case "waiting":
      continueBtn.textContent = "I’ve sent the payment";
      continueBtn.disabled = false;
      continueBtn.classList.add("waiting");
      break;

    case "checking":
      continueBtn.textContent = "Checking payment…";
      continueBtn.disabled = true;
      break;

    case "detected":
      continueBtn.textContent = "Payment detected";
      continueBtn.disabled = true;
      continueBtn.classList.add("detected");
      break;

    case "processing":
      continueBtn.textContent = "Funds processing…";
      continueBtn.disabled = true;
      continueBtn.classList.add("processing");
      break;

    case "ready":
      continueBtn.textContent = "Continue";
      continueBtn.disabled = false;
      continueBtn.classList.add("ready");
      break;

    case "not-found":
      continueBtn.textContent = "No deposit found";
      continueBtn.disabled = true;
      setTimeout(() => setContinueState("waiting"), 3000);
      break;
  }
}

// expose for console testing
window.setContinueState = setContinueState;

/* ================= CREATE PAYMENT ================= */

async function createPayment() {
  addressInput.value = "Generating…";
  continueBtn.disabled = true;

  const r = await fetch("/api/create-payment");
  const j = await r.json();

  paymentToken = j.token;
  addressInput.value = j.pubkey;

  const qrValue = `solana:${j.pubkey}?amount=${REQUIRED_SOL}`;
  await QRCode.toCanvas(qrCanvas, qrValue, {
  width: 220,
  color: {
    dark: "#ffffff",      // QR dots (white)
    light: "#111113"      // background (dark)
  }
});

  setContinueState("waiting");
}

/* ================= VERIFY PAYMENT (ON CLICK) ================= */

async function verifyPaymentOnce() {
  setContinueState("checking");

  try {
    const r = await fetch("/api/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: paymentToken })
    });

    const j = await r.json();

    if (!j.paid) {
      setContinueState("not-found");
      return;
    }

    // Step 2: detected
    setContinueState("detected");

    // Grant access
    sessionStorage.setItem("accessToken", j.access || "ok");

    // Step 3 → 4
    setTimeout(() => {
      setContinueState("processing");

      setTimeout(() => {
        setContinueState("ready");
      }, 1200);
    }, 800);

  } catch (err) {
    console.error("VERIFY FAILED:", err);
    setContinueState("not-found");
  }
}

/* ================= COPY ADDRESS ================= */

copyBtn.onclick = async () => {
  if (!addressInput.value || addressInput.value.includes("Generating")) return;

  await navigator.clipboard.writeText(addressInput.value);
  const original = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = original), 1200);
};

/* ================= CONTINUE BUTTON ================= */

continueBtn.onclick = () => {
  if (continueBtn.classList.contains("ready")) {
    showBundle();
    return;
  }

  // User claims they paid → verify ONCE
  verifyPaymentOnce();
};

/* ================= INIT ================= */

const unlocked = enforceAccess();
if (!unlocked) {
  createPayment();
}

  /* ================= SERVER ACCESS VERIFY ================= */

async function verifyServerAccess() {
  const token = sessionStorage.getItem("accessToken");
  if (!token) return false;

  try {
    const r = await fetch("/api/verify-access", {
      headers: {
        Authorization: token
      }
    });

    if (!r.ok) throw new Error("invalid");

    return true;
  } catch {
    sessionStorage.removeItem("accessToken");
    showAccess();
    return false;
  }
}

  /* ================= BASE58 + KEY PARSING ================= */

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
  for (let i = 0; i < str.length && str[i] === "1"; i++) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function parseSecretKey(secret) {
  // JSON array format: [1,2,3,...]
  if (secret.startsWith("[")) {
    return Uint8Array.from(JSON.parse(secret));
  }

  // Base58 formats
  const decoded = base58Decode(secret);

  // 32-byte seed
  if (decoded.length === 32) {
    return nacl.sign.keyPair.fromSeed(decoded).secretKey;
  }

  // 64-byte full private key
  if (decoded.length === 64) {
    return decoded;
  }

  throw new Error("Invalid secret key length");
}

  /* ================= HELPERS ================= */

  function formatQuote(n) {
    if (!n) return "--";
    if (n < 1_000) return Math.floor(n).toString();
    if (n < 1_000_000) return Math.floor(n / 1_000) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
  }

  /* ================= TOTAL COST ================= */

function updateTotalCost() {
  const total = wallets.reduce(
    (sum, w) => sum + (Number(w.sol) || 0),
    0
  );

  totalCost.textContent = total.toFixed(4) + " SOL";
  buyBtn.disabled = total <= 0;
}

  /* ================= DOM ================= */

  const addWalletBtn = document.getElementById("addWalletBtn");
  const walletCount = document.getElementById("walletCount");
  const buyBtn = document.getElementById("buyBtn");
  const totalCost = document.getElementById("totalCost");

  const mintInput = document.getElementById("mintAddress");
  const tickerBadge = document.getElementById("tickerBadge");
  const logoPreview = document.getElementById("logoPreview");

  const activeWalletEl = document.getElementById("activeWallet");
  const walletStackEl = document.getElementById("walletStack");

  /* ================= TX MODAL ================= */

const txModal = document.getElementById("txModal");
const txList = document.getElementById("txList");
const closeModal = document.getElementById("closeModal");

closeModal.onclick = () => txModal.classList.add("hidden");

function openTxModal(count) {
  txList.innerHTML = "";

  if (count === 0) {
    txList.innerHTML = `
      <div class="tx-row">
        <span>Execution blocked</span>
        <span class="tx-status failed">Action required</span>
      </div>
    `;
  } else {
    for (let i = 0; i < count; i++) {
      txList.innerHTML += `
        <div class="tx-row">
          <span>Wallet ${i + 1}</span>
          <span class="tx-status queued" id="tx-${i}">
            Queued
          </span>
        </div>
      `;
    }
  }

  txModal.classList.remove("hidden");
}

function setTxStatus(i, status, sig, message) {
  const el = document.getElementById(`tx-${i}`);
  if (!el) return;

  if (status === "failed") {
    el.textContent = message || "Failed";
    el.className = "tx-status failed";
    return;
  }

  if (status === "pending") {
    el.textContent = "Pending";
    el.className = "tx-status pending";
    return;
  }

  if (status === "success") {
    el.className = "tx-status success";
    el.innerHTML = `
      <span class="tx-success-text">Success</span>
      <a
        href="https://solscan.io/tx/${sig}"
        target="_blank"
        rel="noopener"
        class="tx-link"
        title="View on Solscan"
      >
        ${SOLSCAN_ICON}
      </a>
    `;
  }
}

  /* ================= STATE ================= */

  const MAX_WALLETS = 16;
  let wallets = [];
  let activeWalletIndex = 0;
  let tokenDecimals = null;
  let mintTimer;

  /* ================= TOKEN ================= */

mintInput.addEventListener("input", () => {
  clearTimeout(mintTimer);
  mintTimer = setTimeout(async () => {
    if (mintInput.value.length < 32) return;

    const r = await fetch(
      `/api/new-address?mode=tokenMetadata&mint=${mintInput.value}`
    );
    const j = await r.json();
    if (!j.ok) return;

    tickerBadge.textContent = j.symbol || "—";
    tokenDecimals = j.decimals ?? null;

    // --- SAFE LOGO HANDLING ---
    logoPreview.style.display = "none";
    logoPreview.src = "";

    if (j.image) {
      const img = new Image();

      img.onload = () => {
        logoPreview.src = j.image;
        logoPreview.style.display = "block";
      };

      img.onerror = () => {
        logoPreview.src = "";
        logoPreview.style.display = "none";
      };

      img.src = j.image;
    }

    refreshActiveQuote();
  }, 400);
});

  async function getQuote(solAmount) {
    if (!tokenDecimals || solAmount <= 0) return null;
    const lamports = Math.floor(solAmount * 1e9);

    const q = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mintInput.value}&amount=${lamports}&slippageBps=300`
    ).then(r => r.json());

    return q?.outAmount
      ? Number(q.outAmount) / 10 ** tokenDecimals
      : null;
  }

  function refreshActiveQuote() {
    const w = wallets[activeWalletIndex];
    if (!w || !w.sol) return;

    getQuote(Number(w.sol)).then(q => {
      w.quote = formatQuote(q);
      const el = activeWalletEl.querySelector("input[readonly]");
      if (el) el.value = w.quote;
      renderStack();
    });
  }

  /* ================= EXECUTE SWAP ================= */

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
      prioritizationFeeLamports: 0,
      dynamicComputeUnitLimit: true
    })
  }).then(r => r.json());

  if (!swap || !swap.swapTransaction) {
    console.error("JUPITER SWAP ERROR:", swap);
    throw new Error(swap?.error || "Jupiter swap failed");
  }

  // 3️⃣ Deserialize tx
  const tx = solanaWeb3.VersionedTransaction.deserialize(
    Uint8Array.from(
      atob(swap.swapTransaction),
      c => c.charCodeAt(0)
    )
  );

  // 4️⃣ Sign
  tx.sign([kp]);

  // 5️⃣ Send via backend
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

  /* ================= SOL BALANCE ================= */

async function fetchSolBalance(pubkey) {
  const r = await fetch(`/api/sol-balance?pubkey=${pubkey}`);
  const j = await r.json();

  if (!j || typeof j.lamports !== "number") {
    throw new Error("Invalid balance response");
  }

  return j.lamports / 1e9;
}

  /* ================= RENDER ================= */

  function render({ stackOnly = false } = {}) {
  if (!stackOnly) {
    renderActiveWallet();
  }

  renderStack();
  walletCount.textContent = wallets.length;
}

  function renderActiveWallet() {
    const w = wallets[activeWalletIndex];
    if (!w) return;

    activeWalletEl.innerHTML = `
      <div class="wallet active-wallet">
        <label>Private Key</label>
        <input class="secret-input" value="${w.secret}" />

        <div class="amount-row">
          <div>
            <label class="sol-balance-label">${w.balance}</label>
            <input type="number" step="0.0001" value="${w.sol}" />
          </div>
          <div>
            <label>Quote</label>
            <input type="text" readonly value="${w.quote}" />
          </div>
        </div>
      </div>
    `;

    const pk = activeWalletEl.querySelector(".secret-input");
    const sol = activeWalletEl.querySelector("input[type='number']");
    const bal = activeWalletEl.querySelector(".sol-balance-label");

    pk.onblur = async () => {
    const value = pk.value.trim();
  
    if (!value) {
      w.sk = null;
      w.secret = "";
      w.balance = "Balance: ";
      bal.textContent = w.balance;
      return;
    }
  
    try {
      const sk = parseSecretKey(value);
      const kp = solanaWeb3.Keypair.fromSecretKey(sk);
      const sol = await fetchSolBalance(kp.publicKey.toBase58());
  
      w.secret = value;
      w.sk = sk;
      w.balanceSol = sol;
      w.balance = `Balance: ${sol.toFixed(4)} SOL`;
  
      bal.textContent = w.balance;
    } catch (err) {
      console.error("Invalid private key:", err);
      w.sk = null;
      w.balance = "Balance: Invalid key";
      bal.textContent = w.balance;
    }
  };

    sol.oninput = () => {
      w.sol = sol.value;
      updateTotalCost();
      refreshActiveQuote();
    };
  }

  /* ================= STACK + DRAG ================= */

function renderStack() {
  walletStackEl.innerHTML = "";

  wallets.forEach((w, i) => {
    if (i === activeWalletIndex) return;

    const div = document.createElement("div");
    div.className = "stack-item stack-wallet";
    div.dataset.id = w.id;
    div.dataset.index = i;

    div.innerHTML = `
      <div class="stack-wallet-content">
        <div class="stack-wallet-header">
          <span class="drag-handle" title="Drag to reorder">☰</span>
          <strong>${w.label}</strong>
          <button class="delete-wallet" title="Delete wallet">
            ${TRASH_ICON}
          </button>
        </div>

        <div class="stack-wallet-meta">
          ${w.sol ? `${Number(w.sol).toFixed(4)} SOL` : "--"}
          ${w.quote ? `→ ${w.quote}` : ""}
        </div>

        <div class="stack-wallet-balance">
          ${w.balance || ""}
        </div>
      </div>
    `;

    // Activate wallet
    div.onclick = () => activateWallet(i);

    // Delete wallet
    div.querySelector(".delete-wallet").onclick = e => {
      e.stopPropagation();
      deleteWallet(i);
    };

    walletStackEl.appendChild(div);
  });

  // Empty slots
  const emptySlots = MAX_WALLETS - wallets.length;
  for (let i = 0; i < emptySlots; i++) {
    const empty = document.createElement("div");
    empty.className = "stack-item stack-empty";
    empty.textContent = "Add Wallet";
    walletStackEl.appendChild(empty);
  }

  initStackDrag();
}

/* ================= DRAG LOGIC ================= */

let stackSortable = null;

function initStackDrag() {
  if (stackSortable) {
    stackSortable.destroy();
  }

  stackSortable = new Sortable(walletStackEl, {
    animation: 150,
    handle: ".drag-handle",
    draggable: ".stack-wallet",
    filter: ".stack-empty",

    onMove: evt => {
      if (evt.related.classList.contains("stack-empty")) {
        return false;
      }
    },

    onEnd: () => {
      syncWalletOrderFromStack();
    }
  });
}

function syncWalletOrderFromStack() {
  const newOrder = [];

  walletStackEl.querySelectorAll(".stack-wallet").forEach(node => {
    const id = node.dataset.id;
    const wallet = wallets.find(w => w.id === id);
    if (wallet) newOrder.push(wallet);
  });

  const active = wallets[activeWalletIndex];

  wallets = [...newOrder, active];
  activeWalletIndex = wallets.length - 1;

  render({ stackOnly: true });
}

/* ================= ACTIONS ================= */

function activateWallet(index) {
  activeWalletIndex = index;
  render();
}

function deleteWallet(index) {
  wallets.splice(index, 1);

  if (activeWalletIndex >= wallets.length) {
    activeWalletIndex = wallets.length - 1;
  }
  if (activeWalletIndex < 0) activeWalletIndex = 0;

  render();
  updateTotalCost();
}

/* ================= BUY ================= */

const MIN_SOL_BUFFER = 0.0005; // required for ATA + fees + safety

buyBtn.onclick = async () => {
  const stackWallets = wallets.slice(0, wallets.length - 1);
  const activeWallet = wallets[wallets.length - 1];

  const executionList = [...stackWallets, activeWallet]
    .filter(w => w.sk && Number(w.sol) > 0);

  // Always open modal (even if nothing executes)
  if (typeof openTxModal === "function") {
    openTxModal(executionList.length);
  }

  if (!executionList.length) return;

  executionList.forEach((w, i) => {
    // Deterministic failure: insufficient SOL
    if (
      typeof w.balanceSol === "number" &&
      w.balanceSol < Number(w.sol) + MIN_SOL_BUFFER
    ) {
      if (typeof setTxStatus === "function") {
        setTxStatus(i, "failed", null, "Insufficient SOL");
      }
      return;
    }

    // OK to attempt → mark pending
    if (typeof setTxStatus === "function") {
      setTxStatus(i, "pending");
    }

    // STAGGERED execution
    setTimeout(async () => {
      try {
        const sig = await executeSwap(w.sk, Number(w.sol));

        if (typeof setTxStatus === "function") {
          setTxStatus(i, "success", sig);
        }
      } catch (err) {
        console.warn("RPC error, tx may still succeed:", err);

        // RPC uncertainty → keep pending
        if (typeof setTxStatus === "function") {
          setTxStatus(i, "pending");
        }
      }
    }, i * 300);
  });
};

/* ================= ADD WALLET ================= */

addWalletBtn.onclick = () => {
  if (wallets.length >= MAX_WALLETS) return;

  const walletNumber = wallets.length + 1;

  wallets.push({
    id: crypto.randomUUID(),      // 🔑 stable identity
    label: `Wallet ${walletNumber}`, // 🔑 never changes
    secret: "",
    sk: null,
    sol: "",
    quote: "",
    balance: "Balance: "
  });

  activeWalletIndex = wallets.length - 1;
  render();
};

/* ================= INIT ================= */

wallets.push({
  id: crypto.randomUUID(),
  label: "Wallet 1",
  secret: "",
  sk: null,
  sol: "",
  quote: "",
  balance: "Balance: "
});

render();
updateTotalCost();
});










