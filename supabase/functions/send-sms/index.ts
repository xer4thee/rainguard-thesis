// RainGuard — send SMS via the TextBee Android gateway.
//
// Two modes (the gateway API key never ships in client JS — it stays a server secret):
//   • broadcast (default): ADMIN only. Texts every opted-in registered number. Fired by
//     the admin/device browser right after a critical/emergency alert is written.
//   • self ({ mode: "self" }): ANY authenticated user. Texts only the CALLER'S OWN
//     registered number — used by the "Send Test SMS" button on the account page.
//
// Deploy:  supabase functions deploy send-sms
// Secrets: supabase secrets set TEXTBEE_API_KEY=... TEXTBEE_DEVICE_ID=...
//          (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TEXTBEE_API_KEY = Deno.env.get("TEXTBEE_API_KEY");
  const TEXTBEE_DEVICE_ID = Deno.env.get("TEXTBEE_DEVICE_ID");
  if (!TEXTBEE_API_KEY || !TEXTBEE_DEVICE_ID) {
    return json(
      { error: "SMS gateway not configured — set TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID secrets." },
      500,
    );
  }

  // ── Verify the caller is authenticated ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "missing auth token" }, 401);

  const asUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await asUser.auth.getUser(token);
  if (userErr || !user) return json({ error: "invalid session" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE);

  // ── Parse body ──
  let payload: { mode?: string; title?: string; message?: string } = {};
  try { payload = await req.json(); } catch { /* empty body ok */ }
  const mode = payload.mode === "self" ? "self" : "broadcast";
  const title = String(payload.title || "RainGuard Alert").slice(0, 120);
  const message = String(payload.message || "").slice(0, 400);

  // ── Resolve recipients + message per mode ──
  let recipients: string[];
  let text: string;

  if (mode === "self") {
    // Any authenticated user → text only their own registered number.
    const { data: me } = await admin.from("profiles").select("phone").eq("id", user.id).single();
    if (!me?.phone) return json({ sent: 0, total: 0, note: "no number on file" });
    recipients = [me.phone];
    text = `RainGuard\n${message || "Test message — your number is set up for alerts."}`.slice(0, 480);
  } else {
    // Broadcast → admin only, every opted-in number.
    const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!me || me.role !== "admin") return json({ error: "forbidden — admin only" }, 403);
    const { data: rows, error: qErr } = await admin
      .from("profiles")
      .select("phone")
      .eq("sms_opt_in", true)
      .not("phone", "is", null);
    if (qErr) return json({ error: "recipient lookup failed: " + qErr.message }, 500);
    recipients = [...new Set((rows || []).map((r) => r.phone).filter(Boolean))];
    text = `RainGuard ALERT\n${title}\n${message}`.trim().slice(0, 480);
  }

  if (recipients.length === 0) return json({ sent: 0, total: 0, note: "no recipients" });

  // ── Relay through TextBee (batched; gateway accepts many recipients per call) ──
  const endpoint =
    `https://api.textbee.dev/api/v1/gateway/devices/${TEXTBEE_DEVICE_ID}/send-sms`;
  const batches: string[][] = [];
  for (let i = 0; i < recipients.length; i += 50) batches.push(recipients.slice(i, i + 50));

  let sent = 0;
  const errors: string[] = [];
  for (const batch of batches) {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "x-api-key": TEXTBEE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: batch, message: text }),
      });
      if (r.ok) sent += batch.length;
      else errors.push(`${r.status}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      errors.push(String(e).slice(0, 200));
    }
  }

  return json({ sent, total: recipients.length, errors });
});
