import fs from 'node:fs';

export function loadServerEnv() {
  if (!fs.existsSync('.env')) return;

  const envText = fs.readFileSync('.env', 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export async function proxyGroqRequest(payload) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      status: 503,
      body: { error: 'Groq API key is not configured on the server.' },
    };
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: payload.messages,
      response_format: payload.response_format,
      temperature: payload.temperature ?? 0.15,
    }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text || 'Unexpected Groq response.' };
  }

  return { status: response.status, body };
}
