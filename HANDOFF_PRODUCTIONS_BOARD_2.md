# HANDOFF #2 — PR #15 לוח הפקות (Productions Board)

> המשך ל-`HANDOFF_PRODUCTIONS_BOARD.md`. מסמך זה מתעד את **סשן 2** —
> איטרציות UX/DB מעל ה-MVP, כולל באג קריטי שתוקן ב-RPC הזמנות.
> **חובה: לקרוא קודם את `CLAUDE.md` ואת ה-HANDOFF הראשון** לפני שמתחילים לעבוד.

---

## 🚦 מצב נוכחי (סוף סשן 2)

| פריט | סטטוס |
|------|--------|
| Branch מקומי | `claude/productions` (HEAD = `claude/productions-board` ב-remote) |
| PR | https://github.com/nimig10/machsan/pull/15 — **draft, DO NOT MERGE** |
| Dev DB | `mhvujejdlmtowypjdhjd` — 8 מיגרציות חדשות מעבר לסשן 1, הוחלו |
| Prod DB | `wxkyqgwwraojnbmyyfco` — **לא נגעתי** |
| Build | עובר (`npm run build`) |
| Lint | אין שגיאות חדשות בקבצים שעריכנו |

---

## 🆕 מיגרציות שנוספו בסשן 2 (8)

כולן ב-`supabase/migrations/` עם prefix `20260516*`. הוחלו ידנית על dev DB דרך MCP.
**לא לפרוס לפרוד** בלי אישור מפורש.

| # | Filename | מה זה עושה |
|---|----------|------------|
| 12 | `20260516120000_add_drive_url_to_productions.sql` | עמודה `drive_url` ל-`productions` + CHECK שמתחיל ב-http(s):// |
| 13 | `20260516130000_production_dates_max_7_days.sql` | CHECK: `end_date - start_date ≤ 6` (חלון 7 ימי צילום) |
| 14 | `20260516140000_production_crew_custom_role.sql` | role='custom' + עמודה `role_label` ב-`production_crew` |
| 15 | `20260516150000_add_color_to_productions.sql` | עמודה `color` (#hex) — צבע ייעודי לכל הפקה |
| 16 | `20260516160000_create_reservation_v2_pending_not_blocking.sql` | **🚨 קריטי**: תיקון רגרסיה ב-RPC `create_reservation_v2` שכללה `ממתין` ברשימת הסטטוסים החוסמים — ראה למטה |
| 17 | `20260516170000_production_approve_crew_v1_student_can_respond.sql` | `production_approve_crew_v1` מקבל גם את הסטודנט המוזמן (לא רק את הבמאי) — נדרש כדי שסטודנט יאשר/ידחה הזמנה ישירה מבמאי |
| 18 | `20260516180000_create_production_slots_table.sql` | טבלת `production_slots` חדשה (role/role_label/quantity). **קיימת ב-DB אבל לא בשימוש מהקוד כרגע** — ראה "Slots — ניסיון שבוטל" |
| 19 | `20260516190000_production_crew_allow_empty_slot.sql` | הקלת CHECK + טריגר ב-`production_crew`: אפשר ששורה תהיה עם `student_id=NULL` וגם `free_text_name=NULL` (משבצת ריקה לאיוש עצמי) |

---

## ✨ פיצ'רים שהוספנו בסשן 2

### 1. **לוח שנה חודשי** (Phase B מהסשן הקודם)
- ב-`ProductionsPage`: שתי תת-לשוניות מתחת ל-"לוח הפקות" — **"לוח שנה"** (default) ו-**"רשימה"** (כרטיסים).
- `CalendarGrid` קיבל prop חדש `onBarClick(barRow)` — קליק על block מהפקה פותח ProductionDetail.
- תיקון render על תאי "ghost" של חודשי שכנים — שימוש ב-`effective` dates כדי שהפקות שחוצות גבול חודש מופיעות גם בתאים שמחוץ לחודש המוצג.

### 2. **PublicForm — Refactor של "השאלת הפקה"** (Phase C)
- בטופס ההשאלה, כאשר `loan_type="הפקה"`:
  - מוצג **dropdown** של הפקות שהמשתמש הוא הבמאי שלהן (יש לפחות צלם ראשי `approved`).
  - אחרי בחירת הפקה, השדות הידניים של צוות נסתרים. מוצג רק `👤 שם · email` כקובץ זהות.
  - בחירת תאריך בtep 2 הופכת ל-**chip picker** של `production_dates` (במקום קלט ידני).
  - על chip-click: `borrow_date`/`return_date`/`borrow_time`/`return_time` ו-`production_date_id` מתמלאים אוטומטית.
  - אם אין למשתמש הפקה מפורסמת עם צלם ראשי → CTA "צור הפקה קודם" עם מעבר ללוח.
- מינימום ימים = **8 (inclusive — היום נספר כיום 0)** עבור `loan_type="הפקה"`, מקביל למינימום בעורך ההפקה.

### 3. **עורך ההפקה (`ProductionEditor`)** — איטרציות רבות
- **6 צבעים** לבחירה (palette ייעודי): מציג border על הכרטיס + צבע ה-block בלוח השנה.
- **קישור לתסריט/Drive** — שדה אופציונלי, CHECK שמתחיל ב-http(s)://.
- **מונה תווים** לתיאור (עד 800), עם הרחבה אוטומטית של `textarea` לפי scrollHeight.
- **תפקידים** — `ROLE_LABELS` הוקטן ל-`{photographer, sound}` בלבד; כל השאר דרך **"תפקיד מותאם"** (custom + `roleLabel`).
- **התאמת מסלול** — בבחירת סטודנט: `photographer` רק `קולנוע`, `sound` רק `סאונד`, מותאם — כולם.
- **autocomplete** דרך `<datalist>` עם state `_typing` transient כדי שהקלט לא מתאפס בעת הקלדה.
- **חוק 1 סטודנט = 1 תפקיד בהפקה** — guard גם בעורך (toast מקומי) וגם ב-`requestJoinProduction` (DB pre-check).
- **באמצע הסשן ניסינו slots-only** — נדחה. ראה למטה.
- **משבצות ריקות מותרות** — הבמאי יכול לפרסם הפקה עם תפקידים ריקים (סטודנט = NULL); המגבלה היחידה: `role='custom'` חייב label. הקלת ה-DB constraint ב-מיגרציה 19.
- **נעילת תאריכים פר-טווח** — תאריך שכבר הוגשה עליו רשימת ציוד נעול לעריכה, אבל שאר הטווחים פתוחים. תווית ירוקה ✓ "🔒 הבטחת את מקומך" מוחלפת ב-deadline הצהוב.
- **dialog "תפקיד מותאם"** — Modal פנימי במקום `window.prompt` native.
- **לא מותר לבחור את הבמאי כצוות** — סינון לפי email.

### 4. **דף "בקשות הפקה" (inbox tab)** — מאוחד
לאחר איטרציה: יש סקציה אחת **"בקשות נכנסות"** שמכילה גם:
1. **הזמנות שקיבלת מבמאים** — תווית "הזמנה מבמאי" (אני הסטודנט שצריך לאשר/לדחות).
2. **בקשות הצטרפות להפקות שלך** — תווית "בקשת הצטרפות להפקה שלך" (אני הבמאי שצריך לאשר/לדחות).

מתחת — סקציית **"בקשות יוצאות"** (הבקשות שאני שלחתי), עם הצגה של pending + rejected.

JoinRequestDialog תומך ב:
- בחירת תפקיד מ-dropdown (photographer/sound/custom — מסונן לפי capacity לפי `dateCount`).
- הערה לבמאי (עד 250 תווים, counter).
- מצב עריכה (withdraw + recreate, כי RLS לא מתיר self-UPDATE).

### 5. **חוקים שנכפו על כל הזרימה**
- 9 ימי הודעה — inclusive (כולל היום). מינשוט = today + 8, עם דילוג שישי/שבת.
- שישי/שבת — חסום לתאריכי התחלה והסיום (המחסן סגור).
- טווח צילום מקסימלי = 7 ימים (CHECK ב-DB + validate ב-UI + max attribute ב-`<input type="date">`).
- חסימה של זוגות טווחי תאריכים חופפים בתוך אותה הפקה.
- שעות בעורך — `<select>` עם slots קבועים `09:00, 09:30, 14:30, 15:00, ... 17:30` (מקביל לטופס ההשאלה).
- רק `קולנוע` יכולים ליצור הפקה — `canCreateProductions` מסנן לפי `currentStudent.track.includes("קולנוע")`.

### 6. **Toast z-index** — תוקן
היה 9999, מאחורי ה-Modal (10000). הועלה ל-20000 עם `pointer-events:none` על container ו-`auto` על ה-toast עצמו.

---

## 🚨 באג קריטי שתוקן — `create_reservation_v2` והסטטוסים החוסמים

### תיאור
כאשר בודקים אם בקשת השאלה חדשה מתנגשת עם השאלה קיימת (overlap math),
ה-RPC `create_reservation_v2` כללה את הסטטוסים הבאים כ-"חוסמים":
```sql
-- ❌ הגרסה הבאגית (לפני 20260516160000):
r.status IN ('ממתין','אישור ראש מחלקה','מאושר','באיחור','פעילה')
```
המשמעות: בקשה שעדיין `ממתין` (לא אושרה!) חסמה בקשה חדשה. זה סתר את כלל הברזל
שתיעדנו ב-`CLAUDE.md`:

> **רק הסטטוסים `מאושר` / `באיחור` / `פעילה` חוסמים מלאי.**

### איך התגלה
משתמש עם הפקה רב-טווחית: הגיש רשימת ציוד לטווח 1 → סטטוס `ממתין`.
אחר כך ניסה להגיש לטווח 2 → קיבל שגיאה "כל החפצים מוקצים" *לטווח שונה*.
זאת רגרסיה.

### התיקון
מיגרציה `20260516160000` עדכנה את ה-RPC כך שרק הסטטוסים הבאים חוסמים:
```sql
r.status IN ('מאושר','באיחור','פעילה')
```
+ הוספתי סעיף ייעודי ב-`CLAUDE.md` (`🚨 כלל ברזל: סטטוסים שחוסמים מלאי`)
כדי להבטיח שאף עתיד-AI לא יחזיר את זה.

### Anti-regression
כל פעם שמשתנה `create_reservation_v2`, `update_reservation_status_v1`,
או כל RPC חדש שעושה overlap-check — חובה לוודא רשימת הסטטוסים.

---

## 🧪 Slots — ניסיון שבוטל באמצע הסשן

באמצע הסשן ניסינו לרענן את כל זרימת הצוות:
- במקום שהבמאי יבחר סטודנט ספציפית לכל תפקיד, הוא היה מגדיר **slots** (תפקיד + כמות).
- הסטודנטים מאיישים את ה-slots דרך self-enrollment.
- יצרתי `production_slots` table + sync ב-`upsertProduction` + UI חדש בעורך עם שדה `quantity`.

**המשתמש דחה את הגישה אחרי שראה אותה בפועל** — חזרתי לזרימה הישנה (autocomplete + פיק ישיר), עם המגבלה ש-1 סטודנט = 1 תפקיד בהפקה.

**מה נשאר ב-DB**: טבלת `production_slots` קיימת אבל לא נקראת/נכתבת מ-UI. גם API converters (`slotRowToBlob`/`slotBlobToRow`) קיימים ב-`productionsApi.js` אבל לא בשימוש. אפשר להסיר במשהוו עתידי, או להשאיר למקרה שהזרימה תרענן שוב.

**הזרימה הנוכחית** (post-revert):
- הבמאי מוסיף שורות לצוות בעורך.
- כל שורה: תפקיד + (אופציונלי) שם סטודנט.
- שורה ריקה (אין סטודנט) = משבצת פתוחה לאיוש עצמי. עוברת validate.
- ה-DB constraint רוצח את הניסיון לכתוב שורה עם student_id=null **וגם** free_text_name=null היה blocker — מיגרציה 19 ריכך אותו.

---

## 📂 קבצים שעודכנו בסשן 2

### Frontend
- `src/utils/productionsApi.js` — driveUrl, color, custom role + roleLabel, slot converters (לא בשימוש), guard "1 סטודנט = 1 תפקיד"
- `src/components/ProductionEditor.jsx` — refactor מלא של ה-UI (~700 שורות)
- `src/components/ProductionsPage.jsx` — sub-tabs (לוח שנה/רשימה), JoinRequestDialog, inbox מאוחד
- `src/components/PublicForm.jsx` — production-loan dropdown, chip-picker, identity card, `minDays=8 inclusive`, banner "9 ימים מראש"
- `src/components/CalendarGrid.jsx` — `onBarClick` prop, תיקון ghost-cell rendering
- `src/utils.js` — `.toast-container z-index: 20000`
- `src/App.jsx` — wiring (לא הרבה)

### Docs
- `CLAUDE.md` — סעיף חדש "🚨 כלל ברזל: סטטוסים שחוסמים מלאי"

### Untracked (לקמיט)
- 8 קבצי מיגרציה ב-`supabase/migrations/20260516*`
- מסמך זה (`HANDOFF_PRODUCTIONS_BOARD_2.md`)

---

## 🛠️ סביבה — תזכורת קצרה

```bash
# Branch
git checkout claude/productions
git pull origin claude/productions-board:claude/productions

# .env.local חייב להצביע על mhvujejdlmtowypjdhjd
cat .env.local | grep SUPABASE

# Dev
npm install
npm run dev
# http://localhost:5174 (port נעול)
```

**משתמש בדיקה**: `nimig10+s11@gmail.com` (סטודנט קולנוע — "טוטו מומו") / סיסמה `nini90`.
**משתמש hub**: `nimig10+s3@gmail.com`.

---

## ⚠️ דברים שחשוב לזכור

1. **המיגרציות לא הועלו לפרוד.** רק dev. רשימה ב-section "מיגרציות".
2. **`production_slots` קיימת ב-DB אבל לא משומשת.** אם משחזרים את ה-feature — שם תמצאו את התשתית. אם מבטלים סופית — אפשר למחוק את הטבלה.
3. **`production_crew_check` הקלאסי הוסר** — אם מישהו עוד מתבסס על הקבועה "exactly one of student_id/free_text_name", זה כבר לא נכון. עכשיו זה "not both".
4. **כל toast חייב להיות מעל כל modal** (z-index 20000) — אל תחזיר ל-9999.
5. **9 ימים = inclusive** (היום נספר). אם משנים, לעדכן בכל הקבצים שמחשבים deadline.

---

## ✅ Checklist להמשך עבודה

- [ ] `git pull origin claude/productions-board:claude/productions`
- [ ] קרא את ה-`CLAUDE.md` + HANDOFF הראשון + מסמך זה
- [ ] ודא `.env.local` → dev DB
- [ ] `npm install && npm run dev`
- [ ] התחבר עם `nimig10+s11@gmail.com / nini90`
- [ ] נסה ליצור הפקה חדשה — שורה ריקה לתפקיד צריכה להתקבל
- [ ] נסה לפרסם — צריך לעבוד גם ללא איוש סטודנטים
- [ ] נסה לבקש להצטרף להפקה של אחר → תראה את הבקשה מתחת ל-"בקשות נכנסות" (מאוחד)
- [ ] רוץ regression: `SELECT * FROM public.run_productions_regression_tests();`

---

*נוצר אוטומטית בסוף סשן 2. כשתחזרו לעבוד — התחילו מ-`CLAUDE.md` ואז שני קבצי ה-HANDOFF.*
