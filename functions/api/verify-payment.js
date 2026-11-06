// Cloudflare Pages Function: GET /api/verify-payment?id=<moyasar_payment_id>
// بعد ما يرجع الزبون من صفحة الدفع، هالدالة بتسأل Moyasar مباشرة عن حالة العملية
// (ما بنثق بالـstatus اللي بالرابط لأنه ممكن ينعدّل)، وإذا مدفوعة بتبعت إشعار لتيليجرام.
//
// المتغيرات المطلوبة (Settings → Environment variables):
//   MOYASAR_SECRET_KEY  — المفتاح السري من لوحة Moyasar (sk_test_... أو sk_live_...)
//   DEPOSIT_SAR         — قيمة العربون بالريال (مثلاً 200) لازم تطابق pay.html
//   TELEGRAM_BOT_TOKEN  — نفس اللي بـ lead.js
//   TELEGRAM_CHAT_ID    — نفس اللي بـ lead.js
//
// ملاحظة: بيانات البطاقة ما بتوصل هون أبداً. Moyasar بيرجع فقط آخر 4 أرقام ونوع البطاقة.

const esc = (s = "") =>
  String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9-]{10,64}$/.test(id)) return json({ ok: false, error: "bad_id" }, 400);

  const r = await fetch(`https://api.moyasar.com/v1/payments/${id}`, {
    headers: { Authorization: "Basic " + btoa(env.MOYASAR_SECRET_KEY + ":") },
  });
  if (!r.ok) return json({ ok: false, error: "not_found", message: "ما لقينا عملية الدفع." }, 404);
  const p = await r.json();

  const expected = Math.round(Number(env.DEPOSIT_SAR || 0) * 100);
  const md = p.metadata || {};
  const ref = String(md.ref || "").slice(0, 20);

  if (p.status !== "paid") {
    const msg = (p.source && p.source.message) || "ما تمّت العملية، وما انخصم منك أي مبلغ.";
    return json({ ok: true, status: p.status, ref, message: msg });
  }
  // حماية من التلاعب بالمبلغ أو العملة من المتصفح
  if (p.currency !== "SAR" || (expected && p.amount !== expected)) {
    return json({ ok: false, status: "mismatch", message: "مبلغ العملية غير مطابق. تواصل معنا." }, 409);
  }

  const src = p.source || {};
  const last4 = String(src.number || "").replace(/\D/g, "").slice(-4);
  const when = new Date(p.created_at || Date.now()).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });

  const text =
    `💳 <b>تم دفع عربون</b>${ref ? ` · طلب #${esc(ref)}` : ""}\n` +
    `👤 الاسم: ${esc(md.name || src.name || "—")}\n` +
    `💉 الخدمة: ${esc(md.service || "—")}\n` +
    `💰 المبلغ: ${(p.amount / 100).toFixed(2)} ريال\n` +
    `🏦 البطاقة: ${esc(src.company || src.type || "—")}${last4 ? ` •••• ${last4}` : ""}\n` +
    `🧾 رقم العملية: <code>${esc(p.id)}</code>\n` +
    `🕒 ${when}`;

  // الإشعار ما بيوقف نجاح الدفع لو تيليجرام فشل
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {}

  return json({ ok: true, status: "paid", ref: ref || p.id });
}
