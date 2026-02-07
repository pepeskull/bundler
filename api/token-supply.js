import { Connection, PublicKey } from "@solana/web3.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { mint } = req.query;
    if (!mint) {
      return res.status(400).json({ error: "Missing mint" });
    }

    const rpc = process.env.SOLANA_RPC;
    if (!rpc) {
      throw new Error("SOLANA_RPC env missing");
    }

    const connection = new Connection(rpc, "confirmed");
    const mintKey = new PublicKey(mint);

    const supply = await connection.getTokenSupply(mintKey);
    const uiAmount = supply?.value?.uiAmount;

    if (typeof uiAmount !== "number") {
      throw new Error("Invalid supply response");
    }

    return res.json({ supply: uiAmount });
  } catch (err) {
    console.error("TOKEN SUPPLY ERROR:", err);
    return res.status(500).json({
      error: err.message || "token-supply failed"
    });
  }
}
