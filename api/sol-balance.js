import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection(
  process.env.SOLANA_RPC,
  "confirmed"
);

export default async function handler(req, res) {
  try {
    const { pubkey } = req.query;

    if (!pubkey) {
      return res.status(400).json({ error: "Missing pubkey" });
    }

    let pk;
    try {
      pk = new PublicKey(pubkey);
    } catch {
      return res.status(400).json({ error: "Invalid pubkey" });
    }

    const lamports = await connection.getBalance(pk);
    res.json({ lamports });
  } catch (err) {
    console.error("RPC ERROR:", err);
    res.status(500).json({ error: "RPC failure" });
  }
}
