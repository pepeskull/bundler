import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  VersionedTransaction
} from "@solana/web3.js";

import {
  getAssociatedTokenAddress,
  createBurnInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";

import bs58 from "bs58";
import fetch from "node-fetch";

const REQUIRED_SOL = 0.0001;

const connection = new Connection(process.env.SOLANA_RPC, "confirmed");

const MAIN_WALLET = new PublicKey(process.env.MAIN_WALLET_ADDRESS);
const MAIN_WALLET_KP = Keypair.fromSecretKey(
  bs58.decode(process.env.MAIN_WALLET_PRIVATE.trim())
);

const SPL_MINT = new PublicKey(process.env.SPL_MINT);
const SOL_MINT = "So11111111111111111111111111111111111111112";

async function getTokenProgramId(mint) {
  const info = await connection.getAccountInfo(mint);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

export default async function handler(req, res) {
  try {
    const { token } = req.body;
    const entry = global.__PAYMENTS__?.get(token);
    if (!entry || entry.done) return res.json({ paid: false });

    const depositKP = Keypair.fromSecretKey(
      Uint8Array.from(entry.secretKey)
    );

    const balance = await connection.getBalance(depositKP.publicKey);
    if (balance < REQUIRED_SOL * LAMPORTS_PER_SOL) {
      return res.json({ paid: false });
    }

    // -----------------------------
    // 1️⃣ SWEEP SOL → MAIN WALLET
    // -----------------------------
    const { blockhash } = await connection.getLatestBlockhash();

    const feeMsg = new Transaction({
      feePayer: depositKP.publicKey,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey: depositKP.publicKey,
        toPubkey: MAIN_WALLET,
        lamports: balance
      })
    ).compileMessage();

    const fee = (await connection.getFeeForMessage(feeMsg)).value || 5000;
    const sendLamports = balance - fee;

    const sweepTx = new Transaction({
      feePayer: depositKP.publicKey,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey: depositKP.publicKey,
        toPubkey: MAIN_WALLET,
        lamports: sendLamports
      })
    );

    await connection.sendTransaction(sweepTx, [depositKP]);

    // -----------------------------
    // 2️⃣ BUY SPL WITH 50%
    // -----------------------------
    const buyLamports = Math.floor(sendLamports * 0.5);

    const quote = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${SPL_MINT}&amount=${buyLamports}&slippageBps=200`
    ).then(r => r.json());

    const swap = await fetch(
      "https://lite-api.jup.ag/swap/v1/swap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: MAIN_WALLET.toBase58(),
          dynamicComputeUnitLimit: true
        })
      }
    ).then(r => r.json());

    const tx = VersionedTransaction.deserialize(
      Buffer.from(swap.swapTransaction, "base64")
    );

    tx.sign([MAIN_WALLET_KP]);
    await connection.sendRawTransaction(tx.serialize());

    // -----------------------------
    // 3️⃣ BURN SPL
    // -----------------------------
    const tokenProgram = await getTokenProgramId(SPL_MINT);
    const ata = await getAssociatedTokenAddress(
      SPL_MINT,
      MAIN_WALLET,
      false,
      tokenProgram
    );

    const bal = await connection.getTokenAccountBalance(ata);
    const burnAmount = BigInt(bal.value.amount);

    if (burnAmount > 0n) {
      const burnTx = new Transaction().add(
        createBurnInstruction(
          ata,
          SPL_MINT,
          MAIN_WALLET,
          Number(burnAmount),
          [],
          tokenProgram
        )
      );

      await connection.sendTransaction(burnTx, [MAIN_WALLET_KP]);
    }

    entry.done = true;
    global.__PAYMENTS__.set(token, entry);

    return res.json({ paid: true, access: "ok" });

  } catch (err) {
    console.error("VERIFY ERROR:", err);
    return res.json({ paid: false });
  }
}
