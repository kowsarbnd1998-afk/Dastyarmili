# دستیار هوشمند HSED — راه‌اندازی روی Vercel

ساختار:
- `public/index.html` صفحهٔ چت
- `api/chat.js` بک‌اند (آدرس `/api/chat`)
- `vercel.json` و `package.json` تنظیمات

مراحل:
1. پوشه را در یک repo روی GitHub بگذارید (یا با `npx vercel` دیپلوی کنید).
2. در Vercel پروژه را Import کنید (Framework: Other، بدون Build Command).
3. در Settings ← Environment Variables این‌ها را بسازید: `GROQ_API_KEY` و `OPENROUTER_API_KEY` (حداقل یکی).
4. Redeploy کنید.
5. تست: `curl -X POST https://YOUR-APP.vercel.app/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"سلام"}],"provider":"auto"}'`

اجرای محلی: `npx vercel dev` (فایل `.env.local` را از روی `.env.example` بسازید).

نکته‌ها:
- شناسهٔ مدل‌ها (به‌ویژه DeepSeek و مدل رایگان OpenRouter) ممکن است تغییر کند؛ از متغیرهای اختیاری `.env.example` استفاده کنید.
- محدودیت ۲۰ درخواست در دقیقه فقط محافظت پایه است. اگر صفحه عمومی است، احراز هویت (مثلاً رمز ورود) اضافه کنید.
