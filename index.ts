// Edge Function: cria pedido público sem expor a service_role no site.
// Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nos secrets do Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  try {
    const body = await req.json();
    const required = ["customer_name", "items", "payment_method"];
    for (const key of required) if (!body[key]) return Response.json({ error: `Campo obrigatório: ${key}` }, { status: 400, headers: cors });
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40) {
      return Response.json({ error: "Itens do pedido inválidos." }, { status: 400, headers: cors });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const delivery = String(body.delivery_type || "ENTREGA").toUpperCase();
    let deliveryFee = 0;
    if (delivery === "ENTREGA") {
      if (!body.street_name) return Response.json({ error: "Informe a rua para entrega." }, { status: 400, headers: cors });
      const { data: feeRow } = await admin.from("delivery_fees").select("fee,active,street_name").eq("street_name", body.street_name).eq("active", true).maybeSingle();
      if (!feeRow) return Response.json({ error: "Endereço não encontrado na tabela de entregas." }, { status: 422, headers: cors });
      deliveryFee = Number(feeRow.fee);
    }
    const items = body.items.map((it: any) => ({
      product_name: String(it.product_name || it.name || "").slice(0, 180),
      quantity: Math.max(1, Math.min(99, Number(it.quantity || 1))),
      unit_price: Math.max(0, Number(it.unit_price ?? it.price ?? 0)),
      notes: String(it.notes || "").slice(0, 1000),
    }));
    if (items.some((i: any) => !i.product_name || !Number.isFinite(i.unit_price))) throw new Error("Produto inválido.");
    const subtotal = items.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0);
    const total = subtotal + deliveryFee;
    const payload = {
      source: "site",
      customer_name: String(body.customer_name).slice(0, 120),
      phone: String(body.phone || "").slice(0, 30),
      address: String(body.address || "").slice(0, 300),
      street_name: body.street_name || null,
      street_number: String(body.street_number || "").slice(0, 30),
      region: String(body.region || "").slice(0, 100),
      complement: String(body.complement || "").slice(0, 150),
      delivery_type: delivery,
      delivery_fee: deliveryFee,
      subtotal, total,
      payment_method: String(body.payment_method).slice(0, 30),
      change_for: body.change_for ? Number(body.change_for) : null,
      notes: String(body.notes || "").slice(0, 1000),
      status: "received",
    };
    const { data: order, error } = await admin.from("orders").insert(payload).select("id,order_number,total,delivery_fee").single();
    if (error) throw error;
    const { error: itemError } = await admin.from("order_items").insert(items.map((i: any) => ({ ...i, order_id: order.id })));
    if (itemError) {
      await admin.from("orders").delete().eq("id", order.id);
      throw itemError;
    }
    return Response.json({ ok: true, order }, { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ error: e?.message || "Erro ao cadastrar pedido." }, { status: 400, headers: cors });
  }
});