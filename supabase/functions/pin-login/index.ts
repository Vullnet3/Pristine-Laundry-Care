// Worker sign-in with a PIN. Runs on Supabase (Edge Function), never in the browser.
// 1. Refuse if this worker had too many wrong PINs recently.
// 2. Check the PIN against its hash in the database.
// 3. Log the attempt (good or bad) with IP and device.
// 4. On success, return a one-time token the browser exchanges for a session.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let userId = "";
  let pin = "";
  try {
    const body = await req.json();
    userId = String(body.user_id ?? "");
    pin = String(body.pin ?? "");
  } catch {
    return reply(400, { error: "Kërkesë e pavlefshme" });
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9]{4,6}$/.test(pin)) {
    return reply(400, { error: "PIN i pavlefshëm" });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300);

  const { data: profile } = await db
    .from("profiles").select("id, role, active").eq("id", userId).maybeSingle();
  // Only log with a user_id that really exists (the log references profiles).
  const knownUser = profile ? userId : null;
  const log = (success: boolean, detail: string) =>
    db.from("login_log").insert({
      user_id: knownUser, method: "pin", success, detail, ip, user_agent: userAgent,
    });

  if (!profile || !profile.active || profile.role !== "worker") {
    await log(false, "unknown or inactive worker");
    return reply(401, { error: "PIN i gabuar" });
  }

  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { count } = await db
    .from("login_log").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("method", "pin").eq("success", false).gte("created_at", since);
  if ((count ?? 0) >= MAX_FAILS) {
    await log(false, "locked: too many wrong PINs");
    return reply(429, { error: `Shumë tentime të gabuara. Provoni pas ${LOCK_MINUTES} minutash.` });
  }

  const { data: ok, error: pinError } = await db.rpc("check_worker_pin", {
    p_user_id: userId, p_pin: pin,
  });
  if (pinError) return reply(500, { error: "Gabim në server" });
  if (!ok) {
    await log(false, "wrong PIN");
    return reply(401, { error: "PIN i gabuar" });
  }

  const { data: user } = await db.auth.admin.getUserById(userId);
  const email = user?.user?.email;
  if (!email) return reply(500, { error: "Gabim në server" });

  // Creates a one-time sign-in token without sending any email.
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink", email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    return reply(500, { error: "Gabim në server" });
  }

  await log(true, "ok");
  return reply(200, { token_hash: link.properties.hashed_token });
});
