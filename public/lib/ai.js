// Was die Seite nach jedem Aufruf von /api/step tut, als reine Funktion, damit
// testbar. Nur eine 200-Antwort mit items-Liste wird verwendet. Alles andere
// ist ein Fehler mit Meldung, und der Schritt bleibt, wie er war.

// Bremse je Sitzung, nur im Speicher. Neu laden setzt sie zurück, das ist
// bewusst: der Limiter im Worker und das Free-Kontingent bleiben trotzdem.
export const MAX_AI_CALLS_PER_SESSION = 30;

// Muss zur Grenze für /api/step in src/index.ts passen (Test prüft das).
export const MAX_STEP_BODY_BYTES = 40_000;

export const AI_UNAVAILABLE = "Workers AI not available (free daily quota used up or outage). Nothing was generated.";

/**
 * @param {{ status: number, body?: unknown } | null} res null = Netzfehler
 * @returns {"use" | string} "use" oder eine Fehlermeldung
 */
export function aiResult(res) {
  if (!res) return AI_UNAVAILABLE;
  const body = /** @type {{ items?: unknown, error?: unknown } | null} */ (res.body ?? null);
  if (res.status === 200) return Array.isArray(body?.items) ? "use" : AI_UNAVAILABLE;
  if (res.status === 429) return "Too many requests. Wait a minute and try again. Nothing was generated.";
  if (res.status === 403) return "AI is off. Start with npm run dev:ai.";
  if (res.status === 413) return "Request is too large (over 40 000 bytes). Nothing was generated.";
  if (res.status === 400) return typeof body?.error === "string" ? body.error : "The step could not be sent. Nothing was generated.";
  return typeof body?.error === "string" && res.status === 502 ? body.error : AI_UNAVAILABLE;
}

/**
 * Vor dem Senden prüfen, damit ein zu großer Kontext keinen AI-Aufruf kostet.
 * @param {unknown} ctx Ergebnis von buildContext()
 * @returns {string | null} Meldung oder null
 */
export function contextTooLarge(ctx) {
  const bytes = new TextEncoder().encode(JSON.stringify(ctx)).length;
  if (bytes <= MAX_STEP_BODY_BYTES) return null;
  return `This step would send ${bytes.toLocaleString("en-US")} bytes, the limit is ${MAX_STEP_BODY_BYTES.toLocaleString("en-US")}. Shorten or delete entries in the earlier steps, then try again. Nothing was sent.`;
}
