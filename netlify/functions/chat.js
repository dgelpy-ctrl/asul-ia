// Backend de Asul IA (versión gratuita con Gemini de Google).
const SYSTEM =
  "Eres Asul IA, el asistente de inteligencia artificial de Asul Academy, una academia de idiomas. " +
  "Responde en el idioma del usuario (por defecto español), de forma clara, amable y útil. " +
  "Ayuda con idiomas, tareas, redacción, programación y dudas generales. Usa formato Markdown sencillo.";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MAX_MSGS_PER_HOUR = 30;
const MAX_INPUT_CHARS = 4000;
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_MSGS_PER_HOUR;
}

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido" });
  if (!process.env.GEMINI_API_KEY) return json(500, { error: "Falta configurar la API key en Netlify." });

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "x";
  if (limited(ip)) return json(429, { error: "Llegaste al límite de mensajes por hora. Intenta más tarde." });

  let messages;
  try {
    messages = JSON.parse(event.body).messages;
  } catch {
    return json(400, { error: "Solicitud inválida" });
  }
  if (!Array.isArray(messages) || !messages.length) return json(400, { error: "Sin mensajes" });

  messages = messages
    .slice(-20)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_INPUT_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user")
    return json(400, { error: "Conversación inválida" });

  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: 1000 },
        }),
      }
    );
    const data = await r.json();
    if (r.status === 429) return json(429, { error: "La IA está muy ocupada ahora. Intenta en un minuto." });
    if (!r.ok) return json(502, { error: "La IA no pudo responder ahora mismo." });
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("");
    return json(200, { text: text || "No tengo respuesta para eso. Prueba con otra pregunta." });
  } catch {
    return json(502, { error: "No se pudo conectar con la IA." });
  }
};
