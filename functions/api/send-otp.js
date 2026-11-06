// Cloudflare Pages Function: POST /api/send-otp
// بتولّد رمز تحقق من 6 أرقام، بتخزّنه مؤقتاً، وبتبعته SMS على رقم الزبون.
//
// الربط المطلوب:
//   KV Namespace باسم  OTP   (Settings → Functions → KV namespace bindings)
//   Environment variables:
//     SMS_PROVIDER     — "taqnyat" أو "unifonic" أو "custom"
//     SMS_SENDER       — اسم المُرسِل المعتمد (Sender ID)
//     TAQNYAT_TOKEN    — لو زودك taqnyat
//     UNIFONIC_APPSID  — لو زودك unifonic
//     SMS_CUSTOM_URL   — لو custom: رابط بيستقبل POST {to, text} (اختياري SMS_CUSTOM_AUTH)
//
// ملاحظة: الرمز بينخزّن مهشّر (SHA-256)، فحتى لو تسرّب التخزين ما بيبيّن الرمز.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendSms(env, to, text) {
  const p = (env.SMS_PROVIDER || "").toLowerCase();
  if (p === "taqnyat") {
    const r = await fetch("https://api.taqnyat.sa/v1/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.TAQNYAT_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: [to], body: text, sender: env.SMS_SENDER }),
    });
    return r.ok;
  }
  if (p === "unifonic") {
    const body = new URLSearchParams({
      AppSid: env.UNIFONIC_APPSID, SenderID: env.SMS_SENDER || "", Recipient: to, Body: text,
    });
    const r = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    return r.ok;
  }
  if (p === "custom" && env.SMS_CUSTOM_URL) {
    const r = await fetch(env.SMS_CUSTOM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.SMS_CUSTOM_AUTH ? { Authorization: env.SMS_CUSTOM_AUTH } : {}) },
      body: JSON.stringify({ to, text }),
    });
    return r.ok;
  }
  return false; // ما في مزوّد مضبوط
}

export async function onRequestPost({ request, env }) {
  if (!env.OTP) return json({ ok: false, message: "التحقق غير مُفعّل على الخادم." }, 500);

  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const phone = String(d.phone || "").replace(/\D/g, "");       // 5XXXXXXXX
  if (!/^5\d{8}$/.test(phone)) return json({ ok: false, message: "رقم جوال غير صحيح." }, 422);
  const intl = "966" + phone;

  // منع الإزعاج: لا أكثر من طلب كل 45 ثانية، ولا أكثر من 5 طلبات بالساعة
  const now = Date.now();
  const rlKey = "rl:" + phone;
  const rl = JSON.parse((await env.OTP.get(rlKey)) || '{"c":0,"last":0}');
  if (now - rl.last < 45_000) return json({ ok: false, message: "انتظر شوي قبل ما تطلب رمز جديد." }, 429);
  if (rl.c >= 5) return json({ ok: false, message: "طلبت رموز كثير. حاول بعد شوي." }, 429);

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 أرقام
  const hash = await sha256(intl + ":" + code);

  // صلاحية 10 دقائق، و5 محاولات تحقق كحد أقصى
  await env.OTP.put("otp:" + phone, JSON.stringify({ hash, tries: 0, exp: now + 10 * 60_000 }), {
    expirationTtl: 660,
  });
  await env.OTP.put(rlKey, JSON.stringify({ c: rl.c + 1, last: now }), { expirationTtl: 3600 });

  const text = `Velora: رمز التحقق ${code}. صالح 10 دقائق. لا تشاركه مع أحد.`;
  const sent = await sendSms(env, intl, text);
  if (!sent) return json({ ok: false, message: "تعذّر إرسال الرمز حالياً." }, 502);

  return json({ ok: true });
}
