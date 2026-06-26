// RainGuard — broadcast an SMS alert to every opted-in registered number via TextBee.
//
// The static dashboard can't send SMS itself (a gateway API key must never ship in client
// JS), so the admin/device browser calls this Edge Function right after it writes a
// critical/emergency alert. The function:
//   1. verifies the caller is an authenticated admin,
//   2. looks up opted-in recipients server-side with the service-role key,
//   3. relays the message through the TextBee Android SMS gateway.
//
// Deploy:  supabase functions deploy send-sms
// Secrets: supabase secrets set TEXTBEE_API_KEY=... TEXTBEE_DEVICE_ID=...
//          (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
//
// Swapping providers later is a one-spot change: replace the TextBee fetch block below.
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

  // ── 1. Verify the caller is an authenticated admin ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "missing auth token" }, 401);

  const asUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await asUser.auth.getUser(token);
  if (userErr || !user) return json({ error: "invalid session" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!me || me.role !== "admin") return json({ error: "forbidden — admin only" }, 403);

  // ── 2. Build the message ──
  let payload: { title?: string; message?: string } = {};
  try { payload = await req.json(); } catch { /* empty body ok */ }
  const title = String(payload.title || "RainGuard Alert").slice(0, 120);
  const message = String(payload.message || "").slice(0, 400);
  const text = `RainGuard ALERT\n${title}\n${message}`.trim().slice(0, 480);

  // ── 3. Recipients: opted-in profiles that have a number ──
  const { data: rows, error: qErr } = await admin
    .from("profiles")
    .select("phone")
    .eq("sms_opt_in", true)
    .not("phone", "is", null);
  if (qErr) return json({ error: "recipient lookup failed: " + qErr.message }, 500);

  const recipients = [...new Set((rows || []).map((r) => r.phone).filter(Boolean))];
  if (recipients.length === 0) {
    return json({ sent: 0, total: 0, note: "no opted-in numbers" });
  }

  // ── 4. Relay through TextBee (batched; gateway accepts many recipients per call) ──
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
