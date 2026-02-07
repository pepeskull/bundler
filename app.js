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
const accessTimer = document.getElementById("access-timer");
const topupBanner = document.getElementById("topup-banner");
const topupModal = document.getElementById("topupModal");
const ACCESS_DURATION_MS = 30 * 60 * 1000;
const TOPUP_THRESHOLD_MS = 3 * 60 * 1000;
let accessTimerInterval = null;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;

let tradeMode = "buy";
let currentSymbol = "TOKEN";
let tokenSupply = null;

function formatTimer(msRemaining) {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clearAccessTimer() {
  if (accessTimerInterval) {
    clearInterval(accessTimerInterval);
    accessTimerInterval = null;
  }
}

function startAccessTimer() {
  if (!accessTimer) return;

  if (!sessionStorage.getItem("accessGrantedAt")) {
    sessionStorage.setItem("accessGrantedAt", Date.now().toString());
  }

  accessTimer.removeAttribute("hidden");
  clearAccessTimer();

  const tick = () => {
    const startedAt = Number(sessionStorage.getItem("accessGrantedAt"));
    const elapsed = Date.now() - startedAt;
    const remaining = ACCESS_DURATION_MS - elapsed;

    if (remaining <= 0) {
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("accessGrantedAt");
      accessTimer.setAttribute("hidden", "");
      if (topupBanner) {
        topupBanner.classList.add("hidden");
      }
      clearAccessTimer();
      showAccess();
      return;
    }

    accessTimer.textContent = formatTimer(remaining);
    if (topupBanner) {
      if (remaining <= TOPUP_THRESHOLD_MS) {
        topupBanner.classList.remove("hidden");
      } else {
        topupBanner.classList.add("hidden");
      }
    }
  };

  tick();
  accessTimerInterval = setInterval(tick, 1000);
}

function showAccess() {
  accessPage.classList.remove("hidden");
  bundlePage.classList.add("hidden");
  accessPage.removeAttribute("hidden");
  bundlePage.setAttribute("hidden", "");
  bundlePage.setAttribute("inert", "");
  if (accessTimer) {
    accessTimer.setAttribute("hidden", "");
  }
  if (topupBanner) {
    topupBanner.classList.add("hidden");
  }
  if (topupModal) {
    topupModal.classList.add("hidden");
  }
  clearAccessTimer();
}

function showBundle() {
  accessPage.classList.add("hidden");
  bundlePage.classList.remove("hidden");
  accessPage.setAttribute("hidden", "");
  bundlePage.removeAttribute("hidden");
  bundlePage.removeAttribute("inert");
  startAccessTimer();
}

/* ================= ACCESS GUARD ================= */

function enforceAccess() {
  const hasAccess = sessionStorage.getItem("accessToken");
  const accessGrantedAt = Number(sessionStorage.getItem("accessGrantedAt"));
  const accessExpired = accessGrantedAt
    ? Date.now() - accessGrantedAt > ACCESS_DURATION_MS
    : false;

  if (!hasAccess || accessExpired) {
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("accessGrantedAt");
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

const topupQrCanvas = document.getElementById("topup-qr-canvas");
const topupAddressInput = document.getElementById("topup-receive-address");
const topupCopyBtn = document.getElementById("topup-copy-receive-address");
const topupContinueBtn = document.getElementById("topup-continue-btn");
const topupCloseBtn = document.getElementById("topup-close-btn");
const topupBtn = document.getElementById("topup-btn");

let accessPaymentToken = null;
let topupPaymentToken = null;

/* ================= BUTTON STATE ================= */

function setButtonState(button, state) {
  if (!button) return;
  button.classList.remove("waiting", "detected", "processing", "ready");

  switch (state) {
    case "waiting":
      button.textContent = "I’ve sent the payment";
      button.disabled = false;
      button.classList.add("waiting");
      break;

    case "checking":
      button.textContent = "Checking payment…";
      button.disabled = true;
      break;

    case "detected":
      button.textContent = "Payment detected";
      button.disabled = true;
      button.classList.add("detected");
      break;

    case "processing":
      button.textContent = "Funds processing…";
      button.disabled = true;
      button.classList.add("processing");
      break;

    case "ready":
      button.textContent = "Continue";
      button.disabled = false;
      button.classList.add("ready");
      break;

    case "not-found":
      button.textContent = "No deposit found";
      button.disabled = true;
      setTimeout(() => setButtonState(button, "waiting"), 3000);
      break;
  }
}

// expose for console testing
window.setContinueState = state => setButtonState(continueBtn, state);

/* ================= CREATE PAYMENT ================= */

async function createPayment({ canvas, addressField, button, setToken }) {
  addressField.value = "Generating…";
  button.disabled = true;

  const r = await fetch("/api/create-payment");
  const j = await r.json();

  setToken(j.token);
  addressField.value = j.pubkey;

  const qrValue = `solana:${j.pubkey}?amount=${REQUIRED_SOL}`;
  await QRCode.toCanvas(canvas, qrValue, {
    width: 220,
    color: {
      dark: "#1a1c20",      // QR dots (white)
      light: "#ffffff"      // background (dark)
    }
  });

  setButtonState(button, "waiting");
}

/* ================= VERIFY PAYMENT (ON CLICK) ================= */

async function verifyPaymentOnce({ token, button, onSuccess }) {
  setButtonState(button, "checking");

  try {
    const r = await fetch("/api/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const j = await r.json();

    if (!j.paid) {
      setButtonState(button, "not-found");
      return;
    }

    // Step 2: detected
    setButtonState(button, "detected");

    if (typeof onSuccess === "function") {
      onSuccess(j);
    }

    // Step 3 → 4
    setTimeout(() => {
      setButtonState(button, "processing");

      setTimeout(() => {
        setButtonState(button, "ready");
      }, 1200);
    }, 800);

  } catch (err) {
    console.error("VERIFY FAILED:", err);
    setButtonState(button, "not-found");
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

if (topupCopyBtn) {
  topupCopyBtn.onclick = async () => {
    if (!topupAddressInput.value || topupAddressInput.value.includes("Generating")) return;

    await navigator.clipboard.writeText(topupAddressInput.value);
    const original = topupCopyBtn.textContent;
    topupCopyBtn.textContent = "Copied!";
    setTimeout(() => (topupCopyBtn.textContent = original), 1200);
  };
}

if (topupBtn) {
  topupBtn.onclick = () => {
    if (!topupModal) return;
    topupModal.classList.remove("hidden");
    createPayment({
      canvas: topupQrCanvas,
      addressField: topupAddressInput,
      button: topupContinueBtn,
      setToken: token => {
        topupPaymentToken = token;
      }
    });
  };
}

if (topupCloseBtn) {
  topupCloseBtn.onclick = () => {
    if (!topupModal) return;
    topupModal.classList.add("hidden");
  };
}

if (topupContinueBtn) {
  topupContinueBtn.onclick = () => {
    if (topupContinueBtn.classList.contains("ready")) {
      if (topupModal) topupModal.classList.add("hidden");
      setButtonState(topupContinueBtn, "waiting");
      return;
    }

    verifyPaymentOnce({
      token: topupPaymentToken,
      button: topupContinueBtn,
      onSuccess: () => {
        sessionStorage.setItem("accessGrantedAt", Date.now().toString());
        startAccessTimer();
        if (topupBanner) {
          topupBanner.classList.add("hidden");
        }
        setTimeout(() => {
          if (topupModal) topupModal.classList.add("hidden");
          setButtonState(topupContinueBtn, "waiting");
        }, 2500);
      }
    });
  };
}

/* ================= CONTINUE BUTTON ================= */

continueBtn.onclick = () => {
  if (continueBtn.classList.contains("ready")) {
    showBundle();
    return;
  }

  // User claims they paid → verify ONCE
  verifyPaymentOnce({
    token: accessPaymentToken,
    button: continueBtn,
    onSuccess: j => {
      sessionStorage.setItem("accessToken", j.access || "ok");
      sessionStorage.setItem("accessGrantedAt", Date.now().toString());
    }
  });
};

/* ================= INIT ================= */

const unlocked = enforceAccess();
if (!unlocked) {
  createPayment({
    canvas: qrCanvas,
    addressField: addressInput,
    button: continueBtn,
    setToken: token => {
      accessPaymentToken = token;
    }
  });
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

  const JUPITER_API_BASES = [
    "https://quote-api.jup.ag/v6",
    "https://lite-api.jup.ag/swap/v1"
  ];
  const ULTRA_ORDER_ENDPOINT = "/api/ultra-order";
  const ULTRA_EXECUTE_ENDPOINT = "/api/ultra-execute";

  function buildQuoteUrl(base, inputMint, outputMint, amountLamports) {
    if (base.includes("/swap/v1")) {
      return `${base}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=300`;
    }
    return `${base}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=300&swapMode=ExactIn`;
  }

  function buildSwapUrl(base) {
    if (base.includes("/swap/v1")) {
      return `${base}/swap`;
    }
    return `${base}/swap`;
  }

  function formatQuote(n) {
    if (n === null || n === undefined) return "--";
    if (n <= 0) return "0";
    if (n < 1) return n.toFixed(6);
    if (n < 1_000) return n.toFixed(4);
    if (n < 1_000_000) return Math.floor(n / 1_000) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
  }

  /* ================= TOTAL COST ================= */

function updateTotalCost() {
  const totalInput = wallets.reduce(
    (sum, w) => sum + (Number(w.sol) || 0),
    0
  );
  const totalQuote = wallets.reduce(
    (sum, w) => sum + (typeof w.quoteValue === "number" ? w.quoteValue : 0),
    0
  );

  if (tradeMode === "sell") {
    totalLabel.textContent = "Total";
    totalCost.textContent = `${totalQuote.toFixed(4)} SOL`;
  } else {
    totalLabel.textContent = "Total Cost";
    const percent = tokenSupply
      ? (totalQuote / tokenSupply) * 100
      : 0;
    totalCost.textContent = `${percent.toFixed(4)}% ${currentSymbol || "TOKEN"}`;
  }

  buyBtn.disabled = totalInput <= 0;
}

  /* ================= DOM ================= */

  const addWalletBtn = document.getElementById("addWalletBtn");
  const walletCount = document.getElementById("walletCount");
  const buyBtn = document.getElementById("buyBtn");
  const totalCost = document.getElementById("totalCost");
  const totalLabel = document.getElementById("totalLabel");
  const buyToggleBtn = document.getElementById("buyspl");
  const sellToggleBtn = document.getElementById("sellspl");

  const mintInput = document.getElementById("mintAddress");
  const tickerBadge = document.getElementById("tickerBadge");
  const logoPreview = document.getElementById("logoPreview");

  const activeWalletEl = document.getElementById("activeWallet");
  const walletStackEl = document.getElementById("walletStack");
  const warningText = document.getElementById("warning-text");

  const defaultWarningText = warningText?.textContent || "";

  function setWarning(text) {
    if (!warningText) return;
    warningText.textContent = text || defaultWarningText;
  }

  function setTradeMode(mode) {
    tradeMode = mode;
    if (buyToggleBtn) buyToggleBtn.disabled = mode === "buy";
    if (sellToggleBtn) sellToggleBtn.disabled = mode === "sell";
    buyBtn.textContent = mode === "sell" ? "Sell Bundle" : "Buy Bundle";
    buyBtn.style.background = mode === "sell" ? "#ef8686" : "";
    wallets.forEach(w => {
      w.quote = "";
      w.quoteValue = null;
      w.balance = "Balance: ";
    });
    render();
    updateTotalCost();
    refreshActiveQuote();
    refreshWalletBalances();
  }

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

    currentSymbol = j.symbol || "TOKEN";
    tickerBadge.textContent = currentSymbol || "—";
    tokenDecimals = j.decimals ?? null;
    tokenSupply = await fetchTokenSupply(mintInput.value).catch(() => null);

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
    updateTotalCost();
    refreshWalletBalances();
  }, 400);
});

  async function getQuote(inputAmount) {
    if (!tokenDecimals || Number(inputAmount) <= 0) return null;
    if (!mintInput.value) return null;

    const amountBase = tradeMode === "sell"
      ? Math.floor(Number(inputAmount) * 10 ** tokenDecimals)
      : Math.floor(Number(inputAmount) * 10 ** SOL_DECIMALS);
    const inputMint = tradeMode === "sell" ? mintInput.value : SOL_MINT;
    const outputMint = tradeMode === "sell" ? SOL_MINT : mintInput.value;
    const outputDecimals = tradeMode === "sell" ? SOL_DECIMALS : tokenDecimals;

    try {
      const ultraUrl = `${ULTRA_ORDER_ENDPOINT}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountBase}`;
      const ultraResponse = await fetch(ultraUrl);
      if (ultraResponse.ok) {
        const ultra = await ultraResponse.json();
        if (ultra?.outAmount) {
          setWarning("");
          return Number(ultra.outAmount) / 10 ** outputDecimals;
        }
      }
    } catch (err) {
      console.warn("ULTRA QUOTE ERROR:", err);
    }

    for (const base of JUPITER_API_BASES) {
      const url = buildQuoteUrl(base, inputMint, outputMint, amountBase);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          console.warn("JUPITER QUOTE ERROR:", err || response.statusText);
          continue;
        }

        const q = await response.json();
        if (!q?.outAmount) {
          continue;
        }

        setWarning("");
        return Number(q.outAmount) / 10 ** outputDecimals;
      } catch (err) {
        console.error("JUPITER QUOTE ERROR:", err);
      }
    }

    setWarning("Unable to fetch a quote right now.");
    return null;
  }

function refreshActiveQuote() {
  const w = wallets[activeWalletIndex];
  if (!w || !w.sol) return;

  getQuote(Number(w.sol)).then(q => {
    w.quoteValue = typeof q === "number" ? q : null;
    w.quote = formatQuote(q);
    const el = activeWalletEl.querySelector("input[readonly]");
    if (el) el.value = w.quote;
    renderStack();
    updateTotalCost();
  });
}

  /* ================= EXECUTE SWAP ================= */

async function executeSwap(secretKey, inputAmount) {
  const lamports = Math.floor(Number(inputAmount) * 1e9);
  const kp = solanaWeb3.Keypair.fromSecretKey(secretKey);

  try {
    const amountBase = tradeMode === "sell"
      ? Math.floor(Number(inputAmount) * 10 ** tokenDecimals)
      : Math.floor(Number(inputAmount) * 10 ** SOL_DECIMALS);
    const inputMint = tradeMode === "sell" ? mintInput.value : SOL_MINT;
    const outputMint = tradeMode === "sell" ? SOL_MINT : mintInput.value;
    const ultraUrl = `${ULTRA_ORDER_ENDPOINT}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountBase}&taker=${kp.publicKey.toBase58()}`;
    const ultraResponse = await fetch(ultraUrl);

    if (!ultraResponse.ok) {
      const err = await ultraResponse.json().catch(() => null);
      throw new Error(err?.error || "Ultra order failed");
    }

    const ultraOrder = await ultraResponse.json();
    if (!ultraOrder?.transaction || !ultraOrder?.requestId) {
      throw new Error("Ultra order missing transaction");
    }

    const tx = solanaWeb3.VersionedTransaction.deserialize(
      Uint8Array.from(
        atob(ultraOrder.transaction),
        c => c.charCodeAt(0)
      )
    );

    tx.sign([kp]);

    const signedTxBase64 = btoa(
      String.fromCharCode(...tx.serialize())
    );

    const executeResponse = await fetch(ULTRA_EXECUTE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedTransaction: signedTxBase64,
        requestId: ultraOrder.requestId
      })
    });

    if (!executeResponse.ok) {
      const err = await executeResponse.json().catch(() => null);
      throw new Error(err?.error || "Ultra execute failed");
    }

    const execute = await executeResponse.json();
    if (execute?.status !== "Success" || !execute?.signature) {
      throw new Error(execute?.error || "Ultra execution failed");
    }

    return execute.signature;
  } catch (err) {
    console.warn("ULTRA SWAP FAILED:", err);
  }

  // 1️⃣ Get quote
  const inputMint = tradeMode === "sell" ? mintInput.value : SOL_MINT;
  const outputMint = tradeMode === "sell" ? SOL_MINT : mintInput.value;
  const amountBase = tradeMode === "sell"
    ? Math.floor(Number(inputAmount) * 10 ** tokenDecimals)
    : Math.floor(Number(inputAmount) * 10 ** SOL_DECIMALS);
  let quote = null;
  let lastError = null;
  let quoteBase = JUPITER_API_BASES[0];

  for (const base of JUPITER_API_BASES) {
    const url = buildQuoteUrl(base, inputMint, outputMint, amountBase);
    try {
      const quoteResponse = await fetch(url);
      if (!quoteResponse.ok) {
        const err = await quoteResponse.json().catch(() => null);
        lastError = err || quoteResponse.statusText;
        console.error("JUPITER QUOTE ERROR:", lastError);
        continue;
      }

      quote = await quoteResponse.json();
      if (quote?.outAmount) {
        quoteBase = base;
        break;
      }
    } catch (err) {
      lastError = err;
      console.error("JUPITER QUOTE ERROR:", err);
    }
  }

  if (!quote?.outAmount) {
    throw new Error(lastError?.error || "Quote failed");
  }

  if (!quote || quote.error) {
    console.error("JUPITER QUOTE ERROR:", quote);
    throw new Error(quote?.error || "Quote failed");
  }

  // 2️⃣ Request swap transaction
  const swap = await fetch(buildSwapUrl(quoteBase), {
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

async function fetchTokenSupply(mint) {
  const r = await fetch(`/api/token-supply?mint=${mint}`);
  const j = await r.json();

  if (!j || typeof j.supply !== "number") {
    throw new Error("Invalid token supply response");
  }

  return j.supply;
}

async function fetchTokenBalance(owner, mint) {
  const r = await fetch(`/api/token-balance?owner=${owner}&mint=${mint}`);
  const j = await r.json();

  if (!j || typeof j.amount !== "number") {
    throw new Error("Invalid token balance response");
  }

  return j.amount;
}

async function refreshWalletBalances() {
  const updates = wallets.map(async w => {
    if (!w.sk) return;
    const kp = solanaWeb3.Keypair.fromSecretKey(w.sk);
    const owner = kp.publicKey.toBase58();

    if (tradeMode === "sell") {
      if (!mintInput.value || !tokenDecimals) {
        w.balance = "Balance: Set a mint first";
        return;
      }
      const tokenBalance = await fetchTokenBalance(owner, mintInput.value);
      w.balanceToken = tokenBalance;
      w.balance = `Balance: ${tokenBalance.toFixed(4)} ${currentSymbol || "TOKEN"}`;
      return;
    }

    const sol = await fetchSolBalance(owner);
    w.balanceSol = sol;
    w.balance = `Balance: ${sol.toFixed(4)} SOL`;
  });

  await Promise.all(updates);
  render();
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
      const owner = kp.publicKey.toBase58();

      w.secret = value;
      w.sk = sk;

      if (tradeMode === "sell") {
        if (!mintInput.value || !tokenDecimals) {
          w.balance = "Balance: Set a mint first";
          bal.textContent = w.balance;
          return;
        }

        const tokenBalance = await fetchTokenBalance(owner, mintInput.value);
        w.balanceToken = tokenBalance;
        w.balance = `Balance: ${tokenBalance.toFixed(4)} ${currentSymbol || "TOKEN"}`;
      } else {
        const sol = await fetchSolBalance(owner);
        w.balanceSol = sol;
        w.balance = `Balance: ${sol.toFixed(4)} SOL`;
      }

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
      w.quoteValue = null;
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
          ${w.sol ? `${Number(w.sol).toFixed(4)} ${tradeMode === "sell" ? (currentSymbol || "TOKEN") : "SOL"}` : "--"}
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
  if (tradeMode === "sell" && (!mintInput.value || !tokenDecimals)) {
    setWarning("Set a token mint before selling.");
    return;
  }

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
    // Deterministic failure: insufficient balance
    if (tradeMode === "sell") {
      if (
        typeof w.balanceToken === "number" &&
        w.balanceToken < Number(w.sol)
      ) {
        if (typeof setTxStatus === "function") {
          setTxStatus(i, "failed", null, "Insufficient token");
        }
        return;
      }
    } else if (
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
    quoteValue: null,
    balance: "Balance: "
  });

  activeWalletIndex = wallets.length - 1;
  render();
};

if (buyToggleBtn) {
  buyToggleBtn.onclick = () => setTradeMode("buy");
}

if (sellToggleBtn) {
  sellToggleBtn.onclick = () => setTradeMode("sell");
}

/* ================= INIT ================= */

wallets.push({
  id: crypto.randomUUID(),
  label: "Wallet 1",
  secret: "",
  sk: null,
  sol: "",
  quote: "",
  quoteValue: null,
  balance: "Balance: "
});

setTradeMode("buy");
});












