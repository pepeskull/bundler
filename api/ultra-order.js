const ULTRA_BASE_URL = "https://api.jup.ag/ultra/v1";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.JUPITER_ULTRA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "JUPITER_ULTRA_API_KEY missing" });
    }

    const {
      inputMint,
      outputMint,
      amount,
      taker,
      receiver,
      payer,
      closeAuthority,
      referralAccount,
      referralFee,
      excludeRouters,
      excludeDexes
    } = req.query;

    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount
    });

    if (taker) params.set("taker", taker);
    if (receiver) params.set("receiver", receiver);
    if (payer) params.set("payer", payer);
    if (closeAuthority) params.set("closeAuthority", closeAuthority);
    if (referralAccount) params.set("referralAccount", referralAccount);
    if (referralFee) params.set("referralFee", referralFee);
    if (excludeRouters) params.set("excludeRouters", excludeRouters);
    if (excludeDexes) params.set("excludeDexes", excludeDexes);

    const response = await fetch(
      `${ULTRA_BASE_URL}/order?${params.toString()}`,
      {
        headers: {
          "x-api-key": apiKey
        }
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error || "Ultra order failed"
      });
    }

    return res.json(data);
  } catch (err) {
    console.error("ULTRA ORDER ERROR:", err);
    return res.status(500).json({
      error: err.message || "Ultra order failed"
    });
  }
}
