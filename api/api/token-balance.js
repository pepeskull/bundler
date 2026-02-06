import { Connection, PublicKey } from "@solana/web3.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { owner, mint } = req.query;
    if (!owner || !mint) {
      return res.status(400).json({ error: "Missing owner or mint" });
    }

    const rpc = process.env.SOLANA_RPC;
    if (!rpc) {
      throw new Error("SOLANA_RPC env missing");
    }

    const connection = new Connection(rpc, "confirmed");
    const ownerKey = new PublicKey(owner);
    const mintKey = new PublicKey(mint);

    const accounts = await connection.getParsedTokenAccountsByOwner(ownerKey, {
      mint: mintKey
    });

    const amount = accounts.value.reduce((sum, account) => {
      const uiAmount = account.account.data.parsed.info.tokenAmount.uiAmount;
      return sum + (typeof uiAmount === "number" ? uiAmount : 0);
    }, 0);

    return res.json({ amount });
  } catch (err) {
    console.error("TOKEN BALANCE ERROR:", err);
    return res.status(500).json({
      error: err.message || "token-balance failed"
    });
  }
}
