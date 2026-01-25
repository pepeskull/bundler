// /api/send-tx.js
import { Connection } from "@solana/web3.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { rawTx } = req.body;

    if (!rawTx) {
      return res.status(400).json({ error: "Missing rawTx" });
    }

    const rpc = process.env.SOLANA_RPC;
    if (!rpc) {
      throw new Error("SOLANA_RPC env missing");
    }

    const connection = new Connection(rpc, "confirmed");

    // IMPORTANT: base64 decode
    const txBuffer = Buffer.from(rawTx, "base64");

    const signature = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3
    });

    return res.json({ signature });

  } catch (err) {
    console.error("SEND TX ERROR:", err);
    return res.status(500).json({
      error: err.message || "send-tx failed"
    });
  }
}
