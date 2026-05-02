# 📋 Handoff — המשך עבודה על המחשב החדש

> **תאריך:** 2026-05-02
> **Last commit on main:** `8473b32` — `fix(api): two security/UX fixes from external code review`
> **מטרה:** לסיים את הקשחת האבטחה אחרי ביקורת חיצונית. תיקוני קוד כבר ב־main; נשאר טיפול בסיסמת Gmail דלופה.

---

## 🚀 צעד 0 — להתחיל בדיוק מאותה נקודה

על המחשב החדש:

```bash
cd /path/to/machsan          # או clone אם הריפו עוד לא שם
git checkout main
git pull origin main          # חובה — להביא את commit 8473b32
git log --oneline -3          # לוודא: 8473b32 fix(api)... → 6083bc8 chore(blob-cleanup)... → 9998eb0 fix(auth)...
```

אם המשתמשי git status מראה משהו מקומי, תוודא שהמחשב הנוכחי במצב נקי.

**Project paths:**
- Repo: `nimig10/machsan` ב־GitHub (פרטי)
- Vercel project: `machsan` → `app.camera.org.il`
- Supabase project: `wxkyqgwwraojnbmyyfco` (MACHSAN CAMERA)

---

## ✅ מה כבר נעשה (אל תיגע)

### 1. Bug fix ב־`api/auth.js` (`update-student-credentials`)
- שורות 570–576 (לפני) החזירו משתנים לא מוגדרים (`updatedStudent`, `students`, `meIdx`) → 500 אחרי שהעדכון בDB עבר.
- תוקן: בנוי response מ־`me` + `nextName/nextEmail/nextPhone` שכבר בסקופ.

### 2. Ownership check ב־`api/staff-schedule.js` (`upsert-preference`)
- חסרה הייתה בדיקה ש־`staffId === callerStaffId` עבור עובד שאינו admin (בעוד `delete-preference` כן בדקה).
- תוקן: הוספה הבדיקה הזהה.

שני התיקונים ב־commit `8473b32`, נדחפו ל־main, Vercel deploy אוטומטי.

### 3. ניקוי שאריות עידן ה־blob (commits `6083bc8` + מיגרציה ב־prod)
- RPC `sync_reservations_from_json` נמחק מ־DB.
- COMMENT של `sync_equipment_from_json` עודכן.
- הערות "dual-write mirror" / "blob" מטעות נוקו ב־5 קבצים.
- CLAUDE.md עודכן.

---

## 🔴 מה נשאר — דחוף, מחר

### 🚨 הדליפה: Gmail App Password ב־`server.cjs`

**התגלה בביקורת:** הקובץ `server.cjs` (root של ה־riPo) מכיל:
```js
const GMAIL_USER = "camera.obscura.media@gmail.com";
const GMAIL_PASS = "ajwj isti gmel oabo";   // ← App Password אמיתי, hardcoded
```

הסיסמה הזאת נמצאת ב־git history (commits `40b58e9c` + `f21fea78`) וגם ב־`context/codebase.xml` ו־`repomix-output.xml` (קבצי dump). **חובה לסבב.**

**Resend** — בדקתי: לא בשימוש בפרודקשיין. `API MAIL.txt` הוא שאריות מ־commit `10eb0fdd` שננטש. אופציונלי לנקות.

---

## 📝 הצעדים שלך מחר

### שלב A — סיבוב Gmail App Password (אצלך, ~5 דק)

1. הכנס ל־[https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) **מחובר ל־`camera.obscura.media@gmail.com`**.
2. מחק את ה־App Password הקיים ("Mail" או איך שקראת לו).
3. צור App Password חדש (16 תווים, ייראה כמו `xxxx xxxx xxxx xxxx`).
4. **שמור אותו זמנית.**
5. כנס ל־Vercel:
   - Project `machsan` → Settings → Environment Variables
   - מצא את `GMAIL_PASS` → Edit
   - עדכן ל־App Password החדש (Production + Preview + Development — שלושתם)
   - Save
6. Vercel → Deployments → אחרון → Redeploy (כדי שהbuild החדש יקבל את ה־env)
7. **Smoke test:** היכנס ל־`app.camera.org.il`, פתח טופס השאלה ציבורי, הגש בקשה דמה. תקבל מייל "התקבלה בקשה חדשה"? = הסיסמה החדשה עובדת ✓
8. **רק אחרי שזה עובד** — חזור ל־Google App Passwords, מחק את הישנה (היא הדלופה).

⚠️ **אם החדש לא עובד** — אל תמחק את הישן ב־Google. עדכן את `GMAIL_PASS` ב־Vercel חזרה לישן + לבדוק מה השתבש.

### שלב B — ניקוי הקוד (אני, אם נדבר)

מתי שתחזור לסשן איתי, תגיד "סיבוב Gmail בוצע" ואני:

1. אערוך את `server.cjs` להחליף את ה־hardcoded ב־`process.env.GMAIL_USER` / `process.env.GMAIL_PASS`
2. `git rm "API MAIL.txt"` — קובץ Resend מיותר
3. `git rm repomix-output.xml` — dump ענק עם הסיסמה
4. `git rm context/codebase.xml` — אותו דבר
5. עדכון `.gitignore`:
   ```
   API MAIL.txt
   *.api-key
   *.secret
   secrets/
   repomix-output.xml
   context/codebase.xml
   ```
6. עדכון `repomix.config.json` להוסיף ל־`customPatterns`: `"API MAIL.txt"`, `"*.api-key"`, `"*.secret"`
7. lint + build + commit + push

(אפשר לעשות גם את זה לבד אם נוח לך — הצעדים מפורטים כאן, אבל יותר מהיר אם אני אעשה.)

### שלב C (אופציונלי) — Resend cleanup

אם יש לך חשבון ב־Resend מהניסיון הישן:
- היכנס ל־[https://resend.com](https://resend.com) → API Keys
- מחק את המפתח הישן (מנוטרל גם אם דלף)

---

## 🎯 מה דחית במפורש (לסבב הבא)

הביקורת מצאה גם בעיות שלא חמורות מספיק כדי לטפל בהן עכשיו:
- **`/api/create-reservation` over-permissive** — מקבל `status`, `loan_type`, `lesson_auto`, `email` מהלקוח בלי allowlist או `requireUser`
- **`/api/send-email` recipient hardening** — אנונימי יכול לשלוח מיילים ל־`to` חופשי (סוגי `new`, `team_notify`, `dept_head_notify`)
- **Rate limiting** ל־public endpoints
- **בדיקות אוטומטיות** ל־API routes

אם תרצה לטפל גם בזה — תפתח שיחה עם ההנחיה "תמשיך ל־iteration השני של ההקשחה: create-reservation + send-email + rate limit".

---

## 🛠️ קישורים שימושיים

- **GitHub:** https://github.com/nimig10/machsan
- **Vercel:** https://vercel.com/nimig10s-projects/machsan
- **Supabase:** https://supabase.com/dashboard/project/wxkyqgwwraojnbmyyfco
- **Resend:** https://resend.com (אם רלוונטי)
- **Google App Passwords:** https://myaccount.google.com/apppasswords

---

## 📞 איך לפתוח את הסשן מחר

על המחשב החדש, אחרי `git pull`:

```
שלום, ממשיך עבודה אחרי handoff. תקרא את HANDOFF.md ב־root של הriPo. סיימתי את שלב A (סיבוב Gmail). תמשיך משלב B.
```

או אם רק רוצה לוודא הכל לפני התחלה:

```
תקרא את HANDOFF.md ותגיד לי איפה אנחנו עומדים.
```

---

## 🗑️ אחרי שמסיימים

הקובץ הזה (`HANDOFF.md`) זמני. אחרי ששלב B נסגר ונעשה push, אפשר:
```bash
git rm HANDOFF.md
git commit -m "chore: remove handoff doc"
git push
```

---

**לילה טוב 🌙** הקוד שעלה היום בטוח. הסיכון שמישהו ינצל את הסיסמה הדלופה הלילה מינימלי כי ה־riPo פרטי. רק אל תהפוך אותו לpublic ואל תוסיף collaborators עד שתסבב.
