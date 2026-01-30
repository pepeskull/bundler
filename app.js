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
        <span>No executable wallets</span>
        <span class="tx-status failed">
          Check balance / private key
        </span>
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

function setTxStatus(i, status, sig) {
  const el = document.getElementById(`tx-${i}`);
  if (!el) return;

  if (status === "success") {
    el.innerHTML = `
      <span>Success</span>
      <a
        href="https://solscan.io/tx/${sig}"
        target="_blank"
        rel="noopener"
        class="tx-link"
      >
        ${SOLSCAN_ICON}
      </a>
    `;
    el.className = "tx-status success";
  } 
  else if (status === "pending") {
    el.textContent = "Pending";
    el.className = "tx-status pending";
  } 
  else {
    el.textContent = "Failed";
    el.className = "tx-status failed";
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

      if (j.image) {
        logoPreview.src = j.image;
        logoPreview.style.display = "block";
      } else {
        logoPreview.style.display = "none";
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

  function render() {
    renderActiveWallet();
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
    div.dataset.index = i;

    div.innerHTML = `
    <div class="stack-wallet-content">
  
      <div class="stack-wallet-title">
        <strong>Wallet ${i + 1}</strong>
      </div>
  
      <div class="stack-wallet-meta">
        <span class="drag-handle" title="Drag to reorder">☰</span>
        <span class="stack-wallet-amount">
          ${w.sol ? `${Number(w.sol).toFixed(4)} SOL` : "--"}
          ${w.quote ? `→ ${w.quote}` : ""}
        </span>
      </div>
  
      <div class="stack-wallet-balance">
        ${w.balance || ""}
      </div>
  
      <button class="delete-wallet" title="Delete wallet">
        ${TRASH_ICON}
      </button>
  
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
    empty.textContent = "Empty Slot";
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
    const idx = Number(node.dataset.index);
    newOrder.push(wallets[idx]);
  });

  const active = wallets[activeWalletIndex];

  wallets = [...newOrder, active];
  activeWalletIndex = wallets.length - 1;

  render();
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

buyBtn.onclick = async () => {
  const stackWallets = wallets.slice(0, wallets.length - 1);
  const activeWallet = wallets[wallets.length - 1];

  const executionList = [...stackWallets, activeWallet]
    .filter(w => w.sk && Number(w.sol) > 0);

  // Always open modal
  if (typeof openTxModal === "function") {
    openTxModal(executionList.length);
  }

  if (!executionList.length) return;

  executionList.forEach((w, i) => {
    // Optional: mark as queued/pending visually
    if (typeof setTxStatus === "function") {
      setTxStatus(i, "pending");
    }

    // STAGGERED execution (CRITICAL)
    setTimeout(async () => {
      try {
        const sig = await executeSwap(w.sk, Number(w.sol));

        if (typeof setTxStatus === "function") {
          setTxStatus(i, "success", sig);
        }
      } catch (err) {
        console.warn("RPC error, tx may still succeed:", err);

        // Treat RPC errors as pending, not failed
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

  wallets.push({
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
  secret: "",
  sk: null,
  sol: "",
  quote: "",
  balance: "Balance: "
});

render();
updateTotalCost();
});

