import fetch from "node-fetch";
import { PublicKey } from "@solana/web3.js";

export default async function handler(req, res) {
  const { mode, mint } = req.query;

  /* ---------------- TOKEN METADATA ---------------- */
  if (mode === "tokenMetadata") {
    try {
      if (!mint) {
        return res.json({ ok: false, error: "Missing mint" });
      }

      try {
        new PublicKey(mint);
      } catch {
        return res.json({ ok: false, error: "Invalid mint" });
      }

      const r = await fetch(
        `https://data.solanatracker.io/tokens/${mint}`,
        {
          headers: {
            "x-api-key": process.env.SOLANATRACKER_API_KEY
          }
        }
      );

      if (!r.ok) {
        return res.json({ ok: false, error: "Token not found" });
      }

      const json = await r.json();
      const token = json?.token;

      if (!token) {
        return res.json({ ok: false, error: "No token data" });
      }

      return res.json({
        ok: true,
        symbol: token.symbol,
        name: token.name,
        image: token.image,
        decimals: token.decimals
      });

    } catch (err) {
      console.error("TOKEN METADATA ERROR:", err);
      return res.json({ ok: false });
    }
  }

  return res.status(400).json({ ok: false, error: "Invalid mode" });
}
