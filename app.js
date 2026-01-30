document.addEventListener("DOMContentLoaded", () => {
  if (!window.solanaWeb3 || !window.nacl) {
    console.error("Missing dependencies");
    return;
  }

  const nacl = window.nacl;

  /* ================= ICONS ================= */

  const SOLSCAN_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#e5e7eb"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M18,10.82a1,1,0,0,0-1,1V19a1,1,0,0,1-1,1H5
      a1,1,0,0,1-1-1V8A1,1,0,0,1,5,7h7.18
      a1,1,0,0,0,0-2H5A3,3,0,0,0,2,8V19
      a3,3,0,0,0,3,3H16a3,3,0,0,0,3-3V11.82
      A1,1,0,0,0,18,10.82Z"/>
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

  /* ================= HELPERS ================= */

  function formatQuote(n) {
    if (!n) return "--";
    if (n < 1_000) return Math.floor(n).toString();
    if (n < 1_000_000) return Math.floor(n / 1_000) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
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
      try {
        const sk = nacl.sign.keyPair.fromSeed(
          Uint8Array.from(JSON.parse(pk.value))
        ).secretKey;
        w.secret = pk.value;
        w.sk = sk;
        w.balance = "Balance: OK";
        bal.textContent = w.balance;
      } catch {
        bal.textContent = "Balance: Invalid key";
      }
    };

    sol.oninput = () => {
      w.sol = sol.value;
      updateTotalCost();
      refreshActiveQuote();
    };
  }

  function renderStack() {
  walletStackEl.innerHTML = "";

  wallets.forEach((w, i) => {
    if (i === activeWalletIndex) return;

    const div = document.createElement("div");
    div.className = "stack-item stack-wallet";
    div.style.animation = "slideInRight 0.2s ease";

    div.innerHTML = `
      <div class="stack-wallet-content">
        <div class="stack-wallet-header">
          <strong>Wallet ${i + 1}</strong>

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

    // Activate wallet on click
    div.onclick = () => activateWallet(i);

    // Delete button
    div.querySelector(".delete-wallet").onclick = e => {
      e.stopPropagation();
      deleteWallet(i);
    };

    walletStackEl.appendChild(div);
  });

  // Empty placeholders (up to 16)
  const empty = MAX_WALLETS - wallets.length;
  for (let i = 0; i < empty; i++) {
    const div = document.createElement("div");
    div.className = "stack-item stack-empty";
    div.textContent = "Empty Slot";
    walletStackEl.appendChild(div);
  }
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

  /* ================= ACTIONS ================= */

  function activateWallet(i) {
    activeWalletIndex = i;
    render();
  }

  function deleteWallet(i) {
    wallets.splice(i, 1);
    if (activeWalletIndex >= wallets.length) {
      activeWalletIndex = wallets.length - 1;
    }
    render();
    updateTotalCost();
  }

  function updateTotalCost() {
    const total = wallets.reduce(
      (s, w) => s + (Number(w.sol) || 0),
      0
    );
    totalCost.textContent = total.toFixed(4) + " SOL";
    buyBtn.disabled = total <= 0;
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
});
