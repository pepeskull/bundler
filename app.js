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
  const walletList = document.getElementById("walletList");
  const addWalletBtn = document.getElementById("addWalletBtn");
  const walletCount = document.getElementById("walletCount");
  const buyBtn = document.getElementById("buyBtn");
  const totalCost = document.getElementById("totalCost");

  const mintInput = document.getElementById("mintAddress");
  const tickerBadge = document.getElementById("tickerBadge");
  const logoPreview = document.getElementById("logoPreview");

  const txModal = document.getElementById("txModal");
  const txList = document.getElementById("txList");
  const closeModal = document.getElementById("closeModal");
  closeModal.onclick = () => txModal.classList.add("hidden");

  let wallets = [];
  let tokenDecimals = null;
  let mintTimer;
  const quoteTimers = new WeakMap();

  /* ================= TOKEN METADATA ================= */
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

    // Ticker
    tickerBadge.textContent = j.symbol || "—";

    // Logo (image only, no text fallback)
    if (j.image) {
      logoPreview.src = j.image;
      logoPreview.style.display = "block";
    } else {
      logoPreview.style.display = "none";
      logoPreview.src = "";
    }

    // Decimals for quoting
    tokenDecimals = j.decimals ?? null;

    // Recalculate all wallet quotes
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

 /* ================= WALLET STATE ================= */

const MAX_WALLETS = 16;
let activeWalletIndex = 0;

const activeWalletEl = document.getElementById("activeWallet");
const walletStackEl = document.getElementById("walletStack");

/* ================= RENDER ================= */

function render() {
  renderActiveWallet();
  renderStack();
  walletCount.textContent = wallets.length;
}

/* ACTIVE WALLET */

function renderActiveWallet() {
  const w = wallets[activeWalletIndex];
  if (!w) return;

  activeWalletEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "wallet active-wallet";

  div.innerHTML = `
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
  `;

  const pk = div.querySelector(".secret-input");
  const sol = div.querySelector("input[type='number']");

  pk.onblur = async () => {
    try {
      const sk = parseSecretKey(pk.value.trim());
      const kp = solanaWeb3.Keypair.fromSecretKey(sk);
      const bal = await fetchSolBalance(kp.publicKey.toBase58());
      w.secret = pk.value;
      w.sk = sk;
      w.balance = `Balance: ${bal.toFixed(4)} SOL`;
      render();
    } catch {
      w.balance = "Balance: Invalid key";
      render();
    }
  };

  sol.oninput = () => {
    w.sol = sol.value;
    updateTotalCost();
  };

  activeWalletEl.appendChild(div);
}

/* STACK */

function renderStack() {
  walletStackEl.innerHTML = "";

  const stackWallets = wallets
    .map((w, i) => ({ w, i }))
    .filter(x => x.i !== activeWalletIndex);

  // Render wallets
  stackWallets.forEach(({ w, i }) => {
    const div = document.createElement("div");
    div.className = "stack-item stack-wallet";
    div.style.animation = "slideInRight 0.2s ease";

    div.innerHTML = `
      <div>
        <strong>Wallet ${i + 1}</strong><br/>
        ${w.balance || ""}
      </div>
    `;

    div.onclick = () => activateWallet(i);
    walletStackEl.appendChild(div);
  });

  // Empty slots
  const empty = MAX_WALLETS - wallets.length;
  for (let i = 0; i < empty; i++) {
    const div = document.createElement("div");
    div.className = "stack-item stack-empty";
    div.textContent = "Empty Slot";
    walletStackEl.appendChild(div);
  }
}

/* ================= ACTIONS ================= */

function activateWallet(index) {
  if (index === activeWalletIndex) return;

  const prev = activeWalletIndex;
  activeWalletIndex = index;
  render();
}

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





