// Cloudflare Pages Function: POST /api/lead
// تستقبل طلب الاستشارة من الموقع وتبعته لتيليجرام.
// المتغيرات المطلوبة (Settings → Environment variables):
//   TELEGRAM_BOT_TOKEN  — من @BotFather
//   TELEGRAM_CHAT_ID    — رقم محادثتك أو القروب

const esc = (s = "") =>
  String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  // فخ السبام: الحقل المخفي لازم يكون فاضي
  if (d.website) return json({ ok: true, id: "OK" });

  const name = String(d.name || "").trim().slice(0, 80);
  const phone = String(d.phone || "").replace(/\D/g, "");
  const city = String(d.city || "").slice(0, 40);
  const service = String(d.service || "").slice(0, 60);
  const contact = String(d.contact || "").slice(0, 20);
  const time = String(d.time || "").slice(0, 20);
  const notes = String(d.notes || "").trim().slice(0, 500);

  if (name.length < 2 || !/^5\d{8}$/.test(phone) || !city || !service) {
    return json({ ok: false, error: "invalid" }, 422);
  }

  const id = "VL-" + Date.now().toString(36).toUpperCase().slice(-6);
  const when = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const intl = "966" + phone;

  const text =
    `🆕 <b>طلب استشارة جديد</b> #${id}\n` +
    `👤 الاسم: ${esc(name)}\n` +
    `📱 الجوال: +${intl}\n` +
    `📍 المدينة: ${esc(city)}\n` +
    `💉 الخدمة: ${esc(service)}\n` +
    `💬 التواصل: ${esc(contact)} · ${esc(time)}\n` +
    `📝 ملاحظات: ${esc(notes) || "—"}\n` +
    `🕒 ${when}`;

  const msg = encodeURIComponent(`مرحبا ${name}، معك فريق فيلورا Velora بخصوص طلب الاستشارة #${id}`);

  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "💬 واتساب العميل", url: `https://wa.me/${intl}?text=${msg}` },
        ]],
      },
    }),
  });

  if (!tg.ok) return json({ ok: false, error: "telegram" }, 502);
  return json({ ok: true, id });
}
