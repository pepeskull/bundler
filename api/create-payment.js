// /api/create-payment.js
import { Keypair } from "@solana/web3.js";
import crypto from "crypto";

// In-memory store (resets on deploy / cold start)
global.__PAYMENTS__ ||= new Map();

export default async function handler(req, res) {
  try {
    const kp = Keypair.generate();

    const token = crypto.randomUUID();

    global.__PAYMENTS__.set(token, {
      secretKey: Array.from(kp.secretKey),
      createdAt: Date.now(),
      swept: false
    });

    return res.json({
      pubkey: kp.publicKey.toBase58(),
      token
    });
  } catch (err) {
    console.error("CREATE PAYMENT ERROR:", err);
    res.status(500).json({ error: "create-payment failed" });
  }
}
