const baseUrl = () =>
  (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(
    /\/+$/,
    "",
  );
const voiceHeaders = () => ({
  "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
});

export function voiceConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    console.error("Voice service request failed:", error.message);
    throw Object.assign(new Error("Voice service unavailable."), {
      status: 502,
    });
  }
  if (!response.ok) {
    const body = await response.text();
    const key = process.env.ELEVENLABS_API_KEY;
    console.error(
      "Voice service error:",
      response.status,
      key ? body.replaceAll(key, "[redacted]") : body,
    );
    throw Object.assign(new Error("Voice service unavailable."), {
      status: 502,
    });
  }
  return response;
}

export async function synthesize(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
  const response = await request(
    `${baseUrl()}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { ...voiceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: modelId }),
    },
  );
  return Buffer.from(await response.arrayBuffer());
}

export async function transcribe(buffer, mimeType) {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", new Blob([buffer], { type: mimeType }), "recording");
  const response = await request(`${baseUrl()}/v1/speech-to-text`, {
    method: "POST",
    headers: voiceHeaders(),
    body: form,
  });
  const data = await response.json();
  return typeof data.text === "string" ? data.text.trim() : "";
}
