# מחסן קמרה — Machsan

מערכת ניהול פנימית לבית הספר לקולנוע וסאונד **"קמרה אובסקורה"**. אפליקציית ווב בעברית (RTL) המשמשת סטודנטים, מרצים, צוות המחסן והנהלת המכללה.

> **Internal management system for a film & sound school.** Hebrew/RTL web app covering equipment loans, studio bookings, courses, certifications and a student production board.

## מה המערכת עושה

| תחום | תיאור |
|------|-------|
| **מחסן ציוד** | קטלוג ציוד + יחידות, טפסי השאלה ציבוריים, אישור מחסן, מעקב איחורים, ערכות (kits), הגבלת השאלת-חוץ |
| **אולפנים** | הזמנת חדרי הקלטה/מיקס ע"י סטודנטים וצוות, כולל קביעות לילה, עם הגנה אטומית מפני חפיפה |
| **לימודים** | מסלולים, קורסים ומפגשים (N מרצים / N כיתות למפגש), ייבוא Excel, תעודות גמר |
| **לוח הפקות** | סטודנט-במאי מקים הפקה, משבץ צוות ומגיש רשימת ציוד לכל טווח צילום |
| **תפעול** | לוז עובדים, משימות יומיות, דשבורד, ארכיון, תצוגת קיוסק (`/daily-table`) |

## סטאק

- **Frontend** — React 19 + Vite, PWA (`vite-plugin-pwa`), ללא framework CSS (inline styles + CSS vars)
- **Backend** — Vercel Serverless Functions (`api/`, Node 20) + Supabase (Postgres, Auth, RLS, Realtime)
- **מיילים** — Gmail SMTP דרך nodemailer
- **פריסה** — Vercel → `app.camera.org.il`

הלוגיקה הקריטית (זמינות ציוד, חפיפות, הרשאות) נאכפת ב-**Postgres RPCs** ולא רק בקליינט — ראו `supabase/migrations/`.

## התקנה מקומית

```bash
npm install
npm run dev          # http://localhost:5174
```

צרו קובץ `.env.local` בשורש. **שמות המשתנים בלבד — הערכים מגיעים מבעל הפרויקט:**

```dotenv
# Client (נחשף ב-bundle — public by design; RLS הוא שמגן על הדאטה)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=

# Server (סודי — לעולם לא ב-client)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_EXPECTED_PROJECT_REF=
GMAIL_USER=
GMAIL_PASS=
CRON_SECRET=
APP_URL=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

בפיתוח מקומי נתיבי `/api/*` מוגשים in-process ע"י plugin של Vite — אין צורך ב-`vercel dev`.

## סקריפטים

| פקודה | תיאור |
|-------|-------|
| `npm run dev` | שרת פיתוח (port 5174, נעול) |
| `npm run build` | בניית production + Service Worker |
| `npm run lint` | ESLint — **חייב 0 errors** (`no-undef` ו-`react-hooks/rules-of-hooks` הם error) |
| `npm run test:db` | smoke ל-DB — 33 תרחישי RPC (חפיפות, זמינות, הפקות). רץ מול **dev** בלבד |

## ⚠️ שני מסדי נתונים

| סביבה | מתי |
|-------|-----|
| **Development** | localhost + Vercel Preview של feature branches |
| **Production** | רק `main` שרץ ב-`app.camera.org.il` |

**כל מיגרציה/בדיקה רצה קודם על dev.** גישה ל-prod רק אחרי אימות מפורש. `npm run test:db` מסרב לרוץ אם ה-hostname אינו פרויקט ה-dev.

## Cron jobs (Vercel)

| נתיב | תזמון (UTC) |
|------|-------------|
| `/api/productions-archive` | `0 3 * * *` — ארכוב הפקות שהסתיימו |
| `/api/notify-course-end-7days` | `0 9 * * *` — תזכורת סיום קורס למרצה |
| `/api/production-deadline-reminder` | `0 9 * * *` — תזכורת דדליין רשימת ציוד לבמאי |

## תרומה לקוד

**[`CLAUDE.md`](CLAUDE.md) הוא מקור-האמת** לארכיטקטורה, למבנה ה-DB, ולרשימת ה-anti-regressions. קראו אותו לפני כל שינוי — הוא מתעד כללי-ברזל שהופרו בעבר וגרמו לתקלות בפרודקשן (למשל: אילו סטטוסים חוסמים מלאי, ולמה אסור להחזיר את `navigator.locks` ל-default).

זרימת עבודה: feature branch → PR → CI (lint + build + DB smoke) → Vercel Preview → בדיקה ידנית → merge. אין push ישיר ל-`main`.
