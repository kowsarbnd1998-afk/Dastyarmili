// Vercel Serverless Function: POST /api/chat
// کلیدها فقط از Environment Variables خوانده می‌شوند و هرگز به مرورگر نمی‌رسند.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `تو «دستیار هوشمند واحد HSED» گروه شرکت‌های پرس (PTB GROUP) و شرکت‌های تهران کانتینر (TCT) و کانشیپ (CONSHIP) هستی.
حوزهٔ تخصص تو بهداشت، ایمنی، محیط زیست و امنیت در عملیات ترمینال کانتینری است: ارزیابی ریسک و JSA، تحلیل حوادث و شبه‌حوادث (علت ریشه‌ای و اقدام اصلاحی)، آموزش و Toolbox Talk، دستورالعمل و فرم‌های HSE.
قواعد پاسخ:
- به فارسی روان و حرفه‌ای پاسخ بده، مگر کاربر زبان دیگری بخواهد.
- پاسخ را ساختاردار و کاربردی بنویس (مرحله‌ها، جدول متنی ساده، چک‌لیست).
- اگر به استاندارد یا قانونی اشاره می‌کنی (مثل ISO 45001 و ISO 14001) فقط موارد مطمئن را نام ببر؛ شمارهٔ ماده یا بند را حدس نزن.
- اگر اطلاعات کافی نیست، فرض‌هایت را صریح بگو یا یک سؤال کوتاه بپرس.
- در موارد خطر جانی، توقف کار و اطلاع به سرپرست و مسئول HSE را در اولویت بگذار.
- پاسخ تو جایگزین تصمیم مسئول HSE یا مقررات رسمی سازمان نیست.`;

const MAX_MESSAGES = 20;
const MAX_CHARS = 8000;
const TIMEOUT_MS = 30000;
const RATE_LIMIT = 20; // درخواست در دقیقه برای هر IP (در حافظهٔ هر instance؛ فقط محافظت پایه)

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return list.length > RATE_LIMIT;
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

function getTargets() {
  const e = process.env;
  return {
    "groq-20b": { name: "Groq", url: GROQ_URL, key: e.GROQ_API_KEY, model: e.GROQ_MODEL_20B || "openai/gpt-oss-20b" },
    "groq-120b": { name: "Groq", url: GROQ_URL, key: e.GROQ_API_KEY, model: e.GROQ_MODEL_120B || "openai/gpt-oss-120b" },
    deepseek: { name: "OpenRouter", url: OPENROUTER_URL, key: e.OPENROUTER_API_KEY, model: e.DEEPSEEK_MODEL || "deepseek/deepseek-chat" },
    "openrouter-free": { name: "OpenRouter", url: OPENROUTER_URL, key: e.OPENROUTER_API_KEY, model: e.OPENROUTER_FREE_MODEL || "openrouter/free" },
  };
}

async function callModel(t, messages) {
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + t.key };
  if (t.name === "OpenRouter") {
    headers["X-Title"] = "HSED Assistant"; // فقط ASCII
    if (process.env.SITE_URL) headers["HTTP-Referer"] = process.env.SITE_URL;
  }
  const r = await fetch(t.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: t.model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
      max_tokens: 2500,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await r.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!r.ok) throw new Error("خطا " + r.status + (data.error && data.error.message ? " - " + String(data.error.message).slice(0, 120) : ""));
  const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!reply || !reply.trim()) throw new Error("پاسخ خالی");
  return reply.trim();
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "فقط روش POST مجاز است." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "پیام معتبر ارسال نشده است." });
  }

  const targets = getTargets();
  const order = targets[body.provider] ? [body.provider] : ["groq-20b", "openrouter-free"];
  const errors = [];

  for (const id of order) {
    const t = targets[id];
    if (!t.key) { errors.push(t.name + ": کلید API تنظیم نشده است"); continue; }
    try {
      const reply = await callModel(t, messages);
      return res.status(200).json({ reply, provider: t.name, model: t.model });
    } catch (err) {
      errors.push(t.name + ": " + (err.name === "TimeoutError" ? "زمان پاسخ تمام شد" : err.message));
    }
  }
  console.error("HSED chat failed:", errors);
  return res.status(502).json({ error: "پاسخی از مدل‌ها دریافت نشد. " + errors.join(" | ") });
};
