import fetch from "node-fetch";
import { PublicKey } from "@solana/web3.js";

export default async function handler(req, res) {
  try {
    const { mode, mint } = req.query;

    if (mode !== "tokenMetadata") {
      return res.status(400).json({ ok: false, error: "Invalid mode" });
    }

    if (!mint) {
      return res.status(400).json({ ok: false, error: "Missing mint" });
    }

    try {
      new PublicKey(mint);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid mint" });
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
      const text = await r.text();
      console.error("SolanaTracker error:", text);
      return res.status(500).json({ ok: false, error: "Tracker fetch failed" });
    }

    const json = await r.json();
    const token = json?.token;

    if (!token) {
      return res.status(404).json({ ok: false, error: "Token not found" });
    }

    return res.json({
      ok: true,
      symbol: token.symbol,
      name: token.name,
      image: token.image,
      decimals: token.decimals
    });

  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}
