// Cloudflare Pages Function: POST /api/verify-otp
// بتتحقق من الرمز اللي كتبه الزبون مقابل المخزّن (المهشّر)، مع عدّ المحاولات.
// نجاح → بترجّع توكِن قصير العمر ممكن تمرّره لصفحة الدفع كإثبات إنه الرقم متأكّد.
//
// الربط المطلوب:
//   KV Namespace باسم  OTP   (نفس اللي بـ send-otp)
//   Environment variable (اختياري): OTP_TOKEN_SECRET — سر لتوقيع التوكِن

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function signToken(secret, payload) {
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, "");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return body + "." + b64;
}

export async function onRequestPost({ request, env }) {
  if (!env.OTP) return json({ ok: false, message: "التحقق غير مُفعّل على الخادم." }, 500);

  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const phone = String(d.phone || "").replace(/\D/g, "");
  const code = String(d.code || "").replace(/\D/g, "");
  if (!/^5\d{8}$/.test(phone) || code.length !== 6)
    return json({ ok: false, message: "بيانات غير مكتملة." }, 422);

  const key = "otp:" + phone;
  const raw = await env.OTP.get(key);
  if (!raw) return json({ ok: true, verified: false, message: "الرمز منتهي. اطلب رمز جديد." });

  const rec = JSON.parse(raw);
  if (Date.now() > rec.exp) {
    await env.OTP.delete(key);
    return json({ ok: true, verified: false, message: "الرمز منتهي. اطلب رمز جديد." });
  }
  if (rec.tries >= 5) {
    await env.OTP.delete(key);
    return json({ ok: true, verified: false, message: "محاولات كثيرة. اطلب رمز جديد." });
  }

  const hash = await sha256("966" + phone + ":" + code);
  if (hash !== rec.hash) {
    rec.tries++;
    await env.OTP.put(key, JSON.stringify(rec), { expirationTtl: Math.max(1, Math.round((rec.exp - Date.now()) / 1000)) });
    return json({ ok: true, verified: false, message: `رمز غير صحيح. باقي ${5 - rec.tries} محاولات.` });
  }

  // نجاح: نحذف الرمز عشان ما ينعاد استخدامه
  await env.OTP.delete(key);

  let token;
  if (env.OTP_TOKEN_SECRET) {
    token = await signToken(env.OTP_TOKEN_SECRET, { ph: phone, ref: String(d.ref || "").slice(0, 20), exp: Date.now() + 15 * 60_000 });
  }
  return json({ ok: true, verified: true, token });
}
