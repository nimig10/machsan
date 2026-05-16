# HANDOFF — PR #15 לוח הפקות (Productions Board)

> מסמך זה מתעד את הפיצ'ר שפותח ב-branch `claude/productions-board`.
> מטרה: לאפשר להתחיל סשן עבודה חדש מאפס ולהבין מה בוצע, איפה לבדוק, ומה נותר.
> **חובה: לקרוא את `CLAUDE.md` לפני הכל** — הוא מכיל את חוקי הזהב על dev/prod, את כל המבנה של ה-DB ואת ה-anti-regressions.

---

## 🚦 מצב נוכחי

| פריט | סטטוס |
|------|--------|
| Branch | `claude/productions-board` (מ-`main`, 4 commits) |
| PR | https://github.com/nimig10/machsan/pull/15 — **draft, DO NOT MERGE** |
| Dev DB | `mhvujejdlmtowypjdhjd` — 11 מיגרציות הוחלו ועברו 6/6 בדיקות regression |
| Prod DB | `wxkyqgwwraojnbmyyfco` — **לא נגעתי בו בכלל** |
| Build | עובר (`npm run build`) |
| Lint | קליין על קבצים חדשים; טעויות קיימות בקבצים אחרים לא מקשורות |
| GitHub branch | מסונכרן עם `origin/claude/productions-board` |

---

## 🎬 מה הפיצ'ר עושה — תרחיש משתמש

1. **סטודנט מתחבר** (password gate הקיים, ללא שינוי) → נוחת ב-**StudentHub** חדש עם 2 כרטיסים: "מערכת הפניות" ו"לוח הפקות".
2. סטודנט/ית בוחר/ת "לוח הפקות" → מסך מלא עם 3 לשוניות: **לוח** (כל ההפקות המפורסמות) / **שלי** (במאי+צוות) / **בקשות** (Inbox של הבמאי).
3. **יצירת הפקה**: כפתור "+ הפקה חדשה" → modal עם כותרת + תיאור (עד 800 תווים, מונה חי) + תאריכי צילום מרובים + צוות (5 תפקידים: צלם, סאונדמן, עוזר צלם, עוזר במאי, מפיק). צלם וסאונדמן **חייבים** להיות סטודנט רשום (FK + טריגר ב-DB).
4. **פרסום**: "פרסם" → status='published', מופיע לכל המשתמשים בלשונית "לוח".
5. **בקשת הצטרפות**: סטודנט אחר רואה הפקה ב-"לוח" → "אני רוצה להצטרף" → בוחר תפקיד → הבקשה מגיעה ל-"בקשות" של הבמאי.
6. **אישור צוות**: בלחיצה על "אשר" — RPC `production_approve_crew_v1` בודקת אם הסטודנט/ית כבר משובץ/ת להפקה אחרת בחפיפת זמנים. אם כן — שגיאה. אחרת — מאושר.
7. **השאלת ציוד להפקה**: הבמאי לוחץ "השאלת ציוד להפקה" → המערכת מחזירה אותו ל-PublicForm → לשונית "השאלת ציוד" → step 2 → `loan_type="הפקה"` ו-`project_name=שם ההפקה` כבר ממולאים.
8. **שינוי צוות אחרי השאלה**: אם הבמאי מחליף צלם/סאונדמן והרצרבציות שכבר אושרו דורשות הסמכה שלצוות החדש אין — הן חוזרות אוטומטית למצב `ממתין` (טריגר DB + פונקציית recheck).
9. **מחיקת הפקה**: RPC `production_delete_v1` → כל הרצרבציות המקושרות מבוטלות אוטומטית (עם email) → המחיקה היא הרסנית; הרצרבציות נשמרות עם `production_id=NULL`.

---

## 🗄️ DB Layer — 11 מיגרציות חדשות

הקבצים נמצאים ב-`supabase/migrations/` עם prefix `20260515*`. הוחלו כבר על dev DB. **לא להריץ שוב אלא אם הולכים ל-prod**.

| # | Filename | מה זה עושה |
|---|----------|------------|
| 1 | `20260515110000_create_productions_table.sql` | טבלת `productions` עם RLS owner-scoped ע"י `lower(director_email) = lower(auth.jwt() ->> 'email')` |
| 2 | `20260515110100_create_production_dates_table.sql` | טבלת `production_dates` (תאריכי צילום, CHECK שסיום > התחלה) |
| 3 | `20260515110200_create_production_crew_table.sql` | טבלת `production_crew` + טריגר שכופה student_id לתפקיד photographer/sound + RLS לself-enroll/self-withdraw |
| 4 | `20260515110300_add_production_fk_to_reservations.sql` | 2 עמודות nullable ל-`reservations_new`: `production_id` + `production_date_id` + index חלקי |
| 5 | `20260515110400_create_reservation_v2_with_production_columns.sql` | מרחיב את `create_reservation_v2` רק ב-INSERT column list — **כל ה-FIFO וה-overlap math נשארו byte-identical** |
| 6 | `20260515110500_crew_is_certified_for_equipment_helper.sql` | פונקציה `crew_is_certified_for_equipment(photog_id, sound_id, eq_id)` — port SQL של `crewIsCertifiedForEq` מ-`PublicForm.jsx` |
| 7 | `20260515110600_production_check_crew_conflict_rpc.sql` | RPC `production_check_crew_conflict_v1(student_id, production_id)` — מחזיר `{ok, conflicts: [...]}` |
| 8 | `20260515110700_production_crew_change_recheck_rpc.sql` | RPC `production_crew_change_recheck_v1(production_id)` + AFTER UPDATE/DELETE triggers על `production_crew` |
| 9 | `20260515110800_production_approve_crew_rpc.sql` | RPC `production_approve_crew_v1(crew_id, decision)` — director-only + conflict guard + recheck |
| 10 | `20260515110900_production_delete_rpc.sql` | RPC `production_delete_v1(production_id)` — מבטל רצרבציות + hard-delete + audit log |
| 11 | `20260515111000_production_regression_tests.sql` | פונקציה `run_productions_regression_tests()` עם 6 תרחישים — **כולן ירוקות** |

### הרצת בדיקות ה-regression מקומית (mode: dev DB)

ב-Supabase MCP, או ב-SQL Editor של ה-dev project:

```sql
SELECT * FROM public.run_productions_regression_tests();
```

מצופה:
| # | scenario | passed |
|---|----------|--------|
| 1 | conflict check raises on overlapping crew | ✅ |
| 2 | no conflict when dates do not overlap | ✅ |
| 3 | cert-recheck flips reservation to ממתין | ✅ |
| 4a | production_dates cascade-deleted on parent delete | ✅ |
| 4b | reservation production_id SET NULL on parent delete | ✅ |
| 5 | create_reservation_v2 regression (no production) | ✅ |

---

## 💻 Frontend — קבצים חדשים ומשתנים

### קבצים חדשים

- **`src/utils/productionsApi.js`** (305 שורות) — singleton supabase client, blob↔row converters, `listProductions/getProduction/upsertProduction/publishProduction/deleteProduction/requestJoinProduction/withdrawJoinRequest/approveCrewMember/rejectCrewMember/removeCrewMember/checkCrewConflict`
- **`src/components/ProductionsPage.jsx`** (270 שורות) — 3 לשוניות (board/mine/inbox), card grid, detail modal, JoinRequestDialog
- **`src/components/ProductionEditor.jsx`** (255 שורות) — modal עריכה: כותרת, תיאור עם מונה, תאריכי צילום (date+time start/end + note), צוות (role+student picker), delete confirm
- **`src/components/StudentHub.jsx`** (175 שורות) — landing screen אחרי login, 2 כרטיסים, badge על pending requests, install PWA, user guide, logout

### קבצים שעודכנו

- **`src/App.jsx`** —
  - import חדש: `productionsApi`, `ProductionsPage`
  - `loadProductionsWrapped()` ליד `loadKitsWrapped`
  - state חדש: `productions`, `productionsRef`, `setProductions`
  - `"productions"` נוסף ל-`ADMIN_NAV_PAGES`/`SECRETARY_NAV_PAGES`/`WAREHOUSE_NAV_PAGES`
  - 3 listeners realtime חדשים על `productions`/`production_dates`/`production_crew`
  - פריט סיידבר חדש "לוח הפקות" בwarehouse view
  - page render block ב-warehouse view
  - props חדשים ל-`<PublicForm>`: `productions`, `refreshProductions`
- **`src/components/PublicForm.jsx`** —
  - imports חדשים: `ProductionsPage`, `StudentHub`
  - props חדשים: `productions=[]`, `refreshProductions=async()=>{}`
  - state חדש: `studentApp` (`"hub"|"forms"|"productions"`) עם sessionStorage
  - 2 early-returns: hub כשstudentApp==="hub", productions full-screen כשstudentApp==="productions"
  - כפתור "← תפריט ראשי" קטן ב-header של ה-forms view
  - bridge מ-"השאלת ציוד להפקה" → `setStudentApp("forms") + setPublicView("equipment") + setStep(2) + form.loan_type="הפקה" + form.project_name=production.title`

---

## 🧪 איך להתחיל לבדוק לוקלית

### דרישות מקדימות

```bash
# 1. ודא שאתה ב-branch הנכון
git fetch origin
git checkout claude/productions-board
git pull origin claude/productions-board

# 2. ודא שה-.env.local מצביע על dev DB (mhvujejdlmtowypjdhjd)
cat .env.local | grep SUPABASE
# חייב להיות mhvujejdlmtowypjdhjd, לא wxkyqgwwraojnbmyyfco

# 3. dependencies
npm install

# 4. dev server (port נעול ב-vite.config.js)
npm run dev
# פתח http://localhost:5174
```

### תרחישי בדיקה (לבדוק כל אחד בנפרד)

#### A. StudentHub
1. התחבר כסטודנט קיים → צריך לראות מסך נחיתה עם 2 כרטיסים
2. רענן את הדף → אמור לחזור לאותה אפליקציה (sessionStorage)
3. לחץ "התנתק" → סשן מתנקה
4. התחבר שוב → נוחת שוב על ה-Hub

#### B. יצירת הפקה (כסטודנט)
1. Hub → "לוח הפקות" → "+ הפקה חדשה"
2. מלא כותרת + תיאור (בדוק שהמונה עובד עד 800)
3. הוסף 2 תאריכים שונים — שמור
4. הוסף צלם (חובה סטודנט) + עוזר במאי (יכול להיות טקסט חופשי)
5. "פרסם" → אמור להופיע ב-"לוח"
6. רענן בטאב אחר (סטודנט אחר) → ההפקה שם בלשונית "לוח" תוך ~1 שנייה (realtime)

#### C. הצטרפות לצוות
1. סטודנט שלא במאי → לוחץ על הכרטיס → "אני רוצה להצטרף" → בוחר עוזר צלם → שולח
2. הבמאי רואה badge על כרטיס "לוח הפקות" ב-Hub
3. במאי → לשונית "בקשות" → "אשר" → אמור להתעדכן ל-status='approved'

#### D. Conflict detect
1. צור הפקה A: 2027-04-01 09:00–12:00 עם סטודנט X כצלם (מאושר)
2. צור הפקה B: 2027-04-01 10:00–14:00 (חופף!)
3. נסה לאשר את X כצלם בהפקה B → אמור לקבל שגיאה "student is already approved on another production with overlapping dates"

#### E. Cert recheck
1. צור הפקה עם צלם A (מוסמך לציוד "X")
2. השאל את "X" דרך טופס ההשאלה → אשר ידנית מ-admin
3. שנה את הצלם של ההפקה ל-B (שאינו מוסמך) דרך editor → שמור
4. רענן עמוד "ניהול בקשות" → הרצרבציה צריכה להיות חזרה ב-`ממתין`

#### F. Delete production
1. צור הפקה + השאל אליה ציוד + אשר אותה
2. בעורך — "מחיקה" → אמור להופיע confirm עם רשימת הרצרבציות
3. אשר → הפקה נמחקה + הרצרבציות מבוטלות אוטומטית (status=`בוטל`) + email יוצא

#### G. Admin view
1. התחבר כadmin → סיידבר warehouse → "לוח הפקות"
2. אמורות להופיע כל ההפקות שיצרת
3. לא ניתן לערוך כי `currentStudent=null` (read-only)

#### H. Regression DB
1. ב-Supabase SQL editor של dev project:
```sql
SELECT * FROM public.run_productions_regression_tests();
```
2. כל ה-6 שורות אמורות להיות `passed=true`

---

## ⚠️ מה עוד לא נעשה (scope cuts)

הפיצ'ר עובד MVP. הבאים תועדו ב-PR description ומחכים לגלגול הבא:

1. **URL param `?production=ID`** — כרגע ה-bridge מהproductions ל-forms עובד דרך state, לא דרך URL
2. **Chip-picker של `production_dates`** בתוך step 2 של הטופס — כרגע הסטודנט/ית ממלאים תאריכים ידנית
3. **Multi-date submit loop** — אם להפקה יש 3 תאריכים, צריך לחלוקת רצרבציות אחת לכל תאריך; כרגע יוצרים רצרבציה אחת
4. **אינדיקטור ויזואלי של שדות נעולים** בטופס הציוד כשהוא pre-filled מהפקה
5. **באנר "X הפקות בתכנון בתקופה זו"** מעל ה-PublicMiniCalendar

---

## 🛡️ אזהרות חשובות

1. **לעולם לא להריץ את המיגרציות שוב על dev** — הן כבר הוחלו. רק אם צריך לאפס: `DROP TABLE productions, production_dates, production_crew CASCADE` + drop functions, ואז להריץ.

2. **לעולם לא להעלות את המיגרציות ל-prod (`wxkyqgwwraojnbmyyfco`) בלי אישור מפורש של נמרוד**. שיטת העבודה ב-`CLAUDE.md`: dev → preview → merge ל-main → ידני ל-prod.

3. **`auth.jwt() ->> 'email'`** ב-RLS — אם המשתמש לא מחובר, זה NULL, וכל הRLS dies שקטה. תמיד לבדוק שיש session לפני testing.

4. **`crew_is_certified_for_equipment` חייבת להישאר מסונכרנת** עם `crewIsCertifiedForEq` ב-`src/components/PublicForm.jsx:3168`. אם משנים אחד — לעדכן את השני.

5. **Email-first dedup** של מרצים (לקח מ-`CLAUDE.md`) — לא רלוונטי לנו ישירות, אבל יש לזכור שכל ישות עם UNIQUE על `lower(email)` חייבת dedup לפי email-first.

---

## 📂 איפה לחפש דברים

- **DB**: `supabase/migrations/20260515*`
- **API utils**: `src/utils/productionsApi.js`
- **Page components**: `src/components/ProductionsPage.jsx`, `src/components/ProductionEditor.jsx`, `src/components/StudentHub.jsx`
- **PublicForm wiring**: `src/components/PublicForm.jsx` — חפש `studentApp`, `<StudentHub`, `<ProductionsPage`
- **App.jsx wiring**: חפש `productions`, `_setProductions`, `productionsRef`, `loadProductionsWrapped`, `ADMIN_NAV_PAGES`

---

## ✅ Checklist להתחלת סשן חדש

- [ ] קרא את `CLAUDE.md` (חובה)
- [ ] `git checkout claude/productions-board`
- [ ] `git pull origin claude/productions-board`
- [ ] `npm install`
- [ ] בדוק ש-`.env.local` מצביע על **dev** DB (`mhvujejdlmtowypjdhjd`)
- [ ] `npm run dev` → http://localhost:5174
- [ ] רוץ את התרחישים A-H למעלה
- [ ] רוץ `SELECT * FROM public.run_productions_regression_tests();` ב-dev
- [ ] תיעד באגים שמצאת לפני שמתחילים לתקן

---

*מסמך זה נוצר אוטומטית בסוף סשן 1. PR #15 שמור כ-draft עד שתאשר אחרי בדיקות.*
