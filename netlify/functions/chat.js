// Backend de Asul IA (versión gratuita con Gemini de Google).
const SYSTEM =
  "Eres el asistente de los panitas. " +
  "Responde en el idioma del usuario (por defecto español), de forma clara, amable y útil. " +
  "Ayuda con idiomas, tareas, redacción, programación y dudas generales. Usa formato Markdown sencillo.";

// Si un modelo está saturado, prueba con el siguiente.
const MODELS = [
  process.env.GEMINI_MODEL || "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
].filter((m, i, a) => a.indexOf(m) === i);

const RETRY_STATUS = [404, 429, 500, 503, 504];
const MAX_MSGS_PER_HOUR = 30;
const MAX_INPUT_CHARS = 4000;
const hits = new Map();

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

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

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: 1000 },
  });

  for (let i = 0; i < MODELS.length; i++) {
    try {
      const r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + MODELS[i] + ":generateContent",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: payload,
        }
      );
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        const parts =
          (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
        const text = parts.map((p) => p.text || "").join("");
        return json(200, { text: text || "No tengo respuesta para eso. Prueba con otra pregunta." });
      }

      if (!RETRY_STATUS.includes(r.status)) {
        return json(502, {
          error: "La IA no pudo responder: " + ((data.error && data.error.message) || "código " + r.status),
        });
      }
    } catch {
      // error de red: se prueba con el siguiente modelo
    }
    if (i < MODELS.length - 1) await sleep(600);
  }

    return json(503, { error: "Los panitas están saturados ahora mismo, intenta de nuevo en un minuto." });
};
