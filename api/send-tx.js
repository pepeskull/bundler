import { Connection } from "@solana/web3.js";

const connection = new Connection(
  process.env.SOLANA_RPC,
  "confirmed"
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { rawTx } = req.body;

    if (!rawTx) {
      return res.status(400).json({ error: "Missing rawTx" });
    }

    // rawTx is base64 from client
    const txBuffer = Buffer.from(rawTx, "base64");

    const sig = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      maxRetries: 3
    });

    await connection.confirmTransaction(sig, "confirmed");

    res.json({ ok: true, signature: sig });
  } catch (err) {
    console.error("SEND TX ERROR:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Transaction failed"
    });
  }
}
