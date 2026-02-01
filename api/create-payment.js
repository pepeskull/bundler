// /api/create-payment.js
import { Keypair } from "@solana/web3.js";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

export default async function handler(req, res) {
  try {
    const kp = Keypair.generate();
    const token = crypto.randomUUID();

    // Store deposit wallet for 30 minutes
    await redis.set(
      `payment:${token}`,
      {
        secretKey: Array.from(kp.secretKey),
        pubkey: kp.publicKey.toBase58(),
        done: false
      },
      { ex: 60 * 30 }
    );

    return res.json({
      pubkey: kp.publicKey.toBase58(),
      token
    });
  } catch (err) {
    console.error("CREATE PAYMENT ERROR:", err);
    res.status(500).json({ error: "create-payment failed" });
  }
}
