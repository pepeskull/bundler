export default function handler(req, res) {
  const token = req.headers.authorization;

  if (!token || token !== "ok") {
    return res.status(401).json({ ok: false });
  }

  return res.json({ ok: true });
}
