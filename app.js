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
let tokenDecimals = 0;
let mintTimer;
const quoteTimers = new WeakMap();

/* ---------------- TOKEN METADATA ---------------- */

mintInput.addEventListener("input", () => {
  clearTimeout(mintTimer);
  mintTimer = setTimeout(async () => {
    if (mintInput.value.length < 32) return;
    const meta = await fetchTokenMetadata(mintInput.value.trim());
    if (!meta) return;

    tickerInput.value = meta.symbol || "";
    tokenDecimals = meta.decimals || 0;
    logoPreview.src = meta.image || "";
    logoText.style.display = meta.image ? "none" : "block";

    refreshAllQuotes();
  }, 600);
});

async function fetchTokenMetadata(mint) {
  try {
    const r = await fetch(`https://token.jup.ag/strict/${mint}`);
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    return null;
  }
}

/* ---------------- JUPITER QUOTE ---------------- */

async function getQuote(solAmount) {
  const mint = mintInput.value.trim();
  if (!mint || solAmount <= 0) return null;

  const lamports = Math.floor(solAmount * 1e9);

  try {
    const r = await fetch(
      `https://quote-api.jup.ag/v6/quote` +
      `?inputMint=So11111111111111111111111111111111111111112` +
      `&outputMint=${mint}` +
      `&amount=${lamports}` +
      `&slippageBps=50`
    );

    const q = await r.json();
    if (!q?.outAmount) return null;

    return q.outAmount / 10 ** q.outputDecimals;
  } catch {
    return null;
  }
}

/* ---------------- WALLETS ---------------- */

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
      <input type="password" placeholder="Base58 or JSON secret key" />
    </div>

    <div class="field amount-row">
      <div>
        <label>Buy Amount (SOL)</label>
        <input type="number" step="0.0001" min="0" placeholder="0.1" />
      </div>
      <div>
        <label>Est. ${tickerInput.value || "Token"}</label>
        <input type="text" readonly placeholder="0.00" />
      </div>
    </div>

    <p class="muted">Balance: 0.00 SOL</p>
  `;

  const solInput = div.querySelector("input[type='number']");
  const outInput = div.querySelector("input[readonly]");

  solInput.addEventListener("input", () => {
    updateTotalCost();
    debounceQuote(div, solInput, outInput);
  });

  div.querySelector(".danger").onclick = () => {
    wallets.splice(index, 1);
    renderWallets();
    updateTotalCost();
  };

  return div;
}

function debounceQuote(walletEl, solInput, outInput) {
  if (quoteTimers.has(walletEl)) {
    clearTimeout(quoteTimers.get(walletEl));
  }

  outInput.value = "…";

  const t = setTimeout(async () => {
    const sol = parseFloat(solInput.value);
    const q = await getQuote(sol);
    outInput.value = q ? q.toFixed(4) : "0.00";
  }, 500);

  quoteTimers.set(walletEl, t);
}

/* ---------------- TOTAL ---------------- */

function updateTotalCost() {
  let total = 0;
  document.querySelectorAll(".wallet input[type='number']").forEach(i => {
    const v = parseFloat(i.value);
    if (!isNaN(v) && v > 0) total += v;
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

/* ---------------- INIT ---------------- */

function renderWallets() {
  walletList.innerHTML = "";
  wallets.forEach((_, i) => walletList.appendChild(createWallet(i)));
  walletCount.textContent = wallets.length;
}

addWalletBtn.onclick = () => {
  if (wallets.length >= 16) return;
  wallets.push({});
  renderWallets();
};

wallets.push({});
renderWallets();
updateTotalCost();
