const MAX_BODY_BYTES = 4096;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

function validString(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function confirmationHtml(event) {
  const date = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(event.startsAt));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Anmeldung: ${escapeHtml(event.title)}</title></head><body><p>Hallo,</p><p>deine Anmeldung für <strong>${escapeHtml(event.title)}</strong> ist eingegangen.</p><p>${escapeHtml(date)}<br>${escapeHtml(event.location)}</p><p>Bei Fragen: <a href="mailto:${escapeHtml(event.contact)}">${escapeHtml(event.contact)}</a></p></body></html>`;
}

export async function handleRegistration(request, env, options = {}) {
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "Methode nicht erlaubt" });
  }

  const event = options.event;
  if (!event || event.registrationMode !== "live") {
    return json(503, { ok: false, error: "Anmeldungen sind derzeit nicht geöffnet" });
  }
  if (!env?.DB || !env.RESEND_API_KEY || !env.REGISTRATION_FROM) {
    return json(503, { ok: false, error: "Anmeldung vorübergehend nicht verfügbar" });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "Anfrage zu groß" });
  }
  let raw;
  try {
    raw = await request.text();
  } catch {
    return json(400, { ok: false, error: "Ungültige Anfrage" });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "Anfrage zu groß" });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "Ungültiges JSON" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { ok: false, error: "Ungültige Anfrage" });
  }
  if (body.eventId !== event.id) {
    return json(400, { ok: false, error: "Unbekannte Veranstaltung" });
  }

  const errors = {};
  if (!validString(body.vorname, 80)) errors.vorname = "Bitte gib deinen Vornamen ein (max. 80 Zeichen).";
  if (!validString(body.nachname, 80)) errors.nachname = "Bitte gib deinen Nachnamen ein (max. 80 Zeichen).";
  if (!validString(body.email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    errors.email = "Bitte gib eine gültige E-Mail-Adresse ein.";
  }
  if (typeof body.botcheck !== "string" || body.botcheck.trim() !== "") errors.botcheck = "Ungültige Anfrage.";
  const startedAt = body.startedAt;
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 3000 || elapsed > MAX_AGE_MS) {
    errors.startedAt = "Bitte lade das Formular neu und versuche es erneut.";
  }
  if (Object.keys(errors).length) return json(400, { ok: false, errors });

  const email = body.email.trim().toLowerCase();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO registrations (id, event_id, vorname, nachname, email) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, event.id, body.vorname.trim(), body.nachname.trim(), email).run();

    const registration = await env.DB.prepare(
      "SELECT id, email_sent_at FROM registrations WHERE event_id = ? AND email = ?",
    ).bind(event.id, email).first();
    if (!registration) return json(503, { ok: false, error: "Anmeldung vorübergehend nicht verfügbar" });
    if (registration.email_sent_at) return json(409, { ok: false, error: "Du stehst schon auf der Liste" });

    const send = options.fetch ?? fetch;
    const result = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `registration-${registration.id}`,
      },
      body: JSON.stringify({
        from: env.REGISTRATION_FROM,
        to: [email],
        subject: `Deine Anmeldung: ${event.title}`,
        html: confirmationHtml(event),
      }),
    });
    if (!result.ok) return json(502, { ok: false, error: "Bestätigungsmail konnte nicht versendet werden" });

    await env.DB.prepare(
      "UPDATE registrations SET email_sent_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(registration.id).run();
    return json(200, { ok: true });
  } catch {
    return json(503, { ok: false, error: "Anmeldung vorübergehend nicht verfügbar" });
  }
}
