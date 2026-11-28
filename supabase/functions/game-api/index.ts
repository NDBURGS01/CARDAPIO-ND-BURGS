import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return reply({ error: "Faça login para continuar." }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authData.user) return reply({ error: "Sessão inválida. Entre novamente." }, 401);
  const user = authData.user;

  try {
    const body = await req.json();
    const action = String(body.action || "");
    if (action === "profile") {
      const { data, error } = await admin.from("game_profiles").select("user_id,phone,display_name,points,xp,level,best_score,games_played").eq("user_id", user.id).single();
      if (error) throw error;
      const [coupons, skins, ledger] = await Promise.all([
        admin.from("loyalty_coupons").select("code,discount_percent,status,expires_at,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
        admin.from("skin_unlocks").select("skin_id").eq("user_id", user.id),
        admin.from("points_ledger").select("amount,kind,description,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
      ]);
      if (coupons.error || skins.error || ledger.error) throw coupons.error || skins.error || ledger.error;
      return reply({ profile: data, coupons: coupons.data, skins: skins.data, ledger: ledger.data });
    }
    if (action === "rename") {
      const name = String(body.display_name || "").trim().slice(0, 35);
      if (name.length < 2) return reply({ error: "Informe um nome com pelo menos 2 caracteres." }, 400);
      const { data, error } = await admin.from("game_profiles").update({ display_name: name, updated_at: new Date().toISOString() }).eq("user_id", user.id).select().single();
      if (error) throw error;
      return reply({ profile: data });
    }
    if (action === "start") {
      const { data, error } = await admin.rpc("nd_start_game", { p_user_id: user.id });
      if (error) throw error;
      return reply({ session_id: data });
    }
    if (action === "finish") {
      const sessionId = String(body.session_id || "");
      const score = Number(body.score);
      const caught = Number(body.caught);
      if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !Number.isInteger(score) || !Number.isInteger(caught)) {
        return reply({ error: "Dados da partida inválidos." }, 400);
      }
      const { data, error } = await admin.rpc("nd_finish_game", {
        p_user_id: user.id, p_session_id: sessionId, p_score: score, p_caught: caught,
      });
      if (error) throw error;
      return reply({ result: data });
    }
    if (action === "redeem") {
      const percent = Number(body.discount_percent);
      const { data, error } = await admin.rpc("nd_redeem_coupon", { p_user_id: user.id, p_percent: percent });
      if (error) throw error;
      return reply({ coupon: data });
    }
    if (action === "validate_coupon") {
      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return reply({ error: "Informe o código do cupom." }, 400);
      const { data, error } = await admin.rpc("nd_validate_coupon", { p_code: code, p_admin_id: user.id });
      if (error) throw error;
      return reply({ validation: data });
    }
    if (action === "leaderboard") {
      const { data, error } = await admin.from("game_profiles")
        .select("display_name,best_score,level,games_played")
        .order("best_score", { ascending: false }).order("level", { ascending: false }).limit(50);
      if (error) throw error;
      return reply({ ranking: data });
    }
    return reply({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Erro interno do servidor." }, 400);
  }
});
