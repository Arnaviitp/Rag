export default function handler(req, res) {
  res.status(200).json({ groqConfigured: Boolean(process.env.GROQ_API_KEY) });
}
