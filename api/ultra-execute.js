const ULTRA_BASE_URL = "https://api.jup.ag/ultra/v1";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.JUPITER_ULTRA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "JUPITER_ULTRA_API_KEY missing" });
    }

    const { signedTransaction, requestId } = req.body || {};

    if (!signedTransaction || !requestId) {
      return res.status(400).json({ error: "Missing signedTransaction or requestId" });
    }

    const response = await fetch(`${ULTRA_BASE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({ signedTransaction, requestId })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error || "Ultra execute failed",
        code: data?.code
      });
    }

    return res.json(data);
  } catch (err) {
    console.error("ULTRA EXECUTE ERROR:", err);
    return res.status(500).json({
      error: err.message || "Ultra execute failed"
    });
  }
}
