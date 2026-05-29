# 🔁 רוטינת סריקה יומית — חוזה קבוע

> מסמך זה הוא **החוזה** של הרוטינה האוטומטית היומית. סוכן הסריקה היומי קורא אותו ראשון ומבצע אותו צעד-צעד.
> ה-prompt של ה-Trigger רק מצביע על הקובץ הזה — כל הלוגיקה כאן, כדי לשמור עקביות בין הרצות.

## 🎯 מטרה

פעם ביום (09:00 שעון ישראל) לסרוק את **הקבצים החמים** של האפליקציה ולחפש:
1. **באגים** — לוגיקה שגויה, edge cases, regressions מול הכללים ב-`CLAUDE.md`.
2. **יציבות** — null/undefined, async race conditions, error handling חסר, memory leaks (listeners/timers).
3. **אופטימיזציה** — re-renders מיותרים, `Promise.all` ענק (ראה כלל batched writes), חישובים כבדים בלולאות.

## 📁 היקף (hot files בלבד — אסור לחרוג)

- `src/App.jsx`
- `src/components/LessonsPage.jsx`
- `src/utils.js`
- `supabase/migrations/**` + RPCs (קריאה/דיווח בלבד — ראה איסור DB למטה)

**אסור** לסרוק/לגעת בשאר `src/`, `api/`, config, או קבצי build. אם נראה משהו קריטי מחוץ להיקף — לרשום ב-checklist בלבד, לא לתקן.

## 🚦 מצב פעולה: "תקן בטוח + דווח השאר"

### מותר לתקן אוטומטית (safe fixes בלבד)
- null/undefined guards, optional chaining, default values.
- timers/listeners שלא מנוקים (cleanup ב-useEffect).
- typos לוגיים ברורים, dead code, תנאים שתמיד true/false.
- אופטימיזציות נקודתיות בלי שינוי התנהגות (memoization ברור, פיצול `Promise.all` ל-`inBatches`).

### דיווח בלבד (לעולם לא לתקן אוטומטית) → checklist ב-PR
- כל שינוי שמשנה **התנהגות** גלויה למשתמש.
- refactors גדולים / שינוי מבנה.
- כל דבר שנוגע ב-`CLAUDE.md` anti-regressions (סטטוסים חוסמי מלאי, `lecturerIds[]`/`studioIds[]`, auth client, overdue 48h, וכו').
- **כל שינוי DB/schema/RPC/migration** — ראה איסור מוחלט למטה.

## ⛔ איסורים מוחלטים (חוקי ברזל)

1. **אסור לגעת ב-DB.** לא `apply_migration`, לא `execute_sql` שכותב, לא על dev ולא על prod. הרוטינה היא **code-only**. בעיות DB/RPC → checklist בלבד.
2. **אסור לגעת ב-prod** בשום צורה.
3. **אסור למזג** את ה-PR. אף פעם. המיזוג הוא של המשתמש בלבד, אחרי בדיקה ידנית.
4. **אסור לדחוף ל-`main`** (מוגן ממילא — 403). רק לענף `claude/daily-audit`.
5. **אסור לפתוח PR חדש** אם כבר קיים PR פתוח של הרוטינה — מעדכנים את הקיים (Rolling PR).
6. אסור לחרוג מהיקף ה-hot files.
7. **מקסימום `git push` אחד ליום (= build אחד ב-Vercel).** ההרצה כולה דוחפת **פעם אחת בלבד**, בסוף, ורק אחרי ש-`lint`+`build` עברו מקומית. אסור push ביניים/fixup, אסור לדחוף "כדי לבדוק" (האימות מקומי בלבד). אם נדרשו תיקוני fixup — לאחד (`git commit --amend` / squash) ל-commit אחד לפני ה-push היחיד.
8. **אם אין ממצאים → אפס push באותו יום.** לא commit, לא push, לא build ב-Vercel, לא נגיעה ב-PR. לדלג בשקט לחלוטין.

## 🔄 פרוצדורה יומית (צעד-צעד)

1. **קרא state**: קרא את `.claude/audit-log.md` (היכן עצרנו, מה כבר תוקן/דווח) ואת `CLAUDE.md` (הכללים העדכניים).
2. **בדוק אם יש PR פתוח** של הרוטינה (`mcp__github__list_pull_requests`, head=`claude/daily-audit`, state=open):
   - **קיים** → `git fetch origin claude/daily-audit` + checkout. נסה `git rebase origin/main`; אם conflict → `git rebase --abort`, המשך על ה-tip הקיים, וציין ב-PR ש-rebase ממתין.
   - **לא קיים** → צור ענף טרי `claude/daily-audit` מ-`origin/main`.
3. **סרוק** את ה-hot files לפי המטרה למעלה. השווה מול ה-log כדי לא לחזור על ממצאים שכבר טופלו/דווחו.
4. **אם אין ממצאים חדשים** → **לדלג בשקט**: אין commit, אין push, אין build ב-Vercel, אין שינוי ב-PR, אין log. סיים את הסשן. **זה התרחיש הנפוץ — ואז אפס דחיפות באותו יום.**
5. **אם יש ממצאים** — מבצעים הכל מקומית, ודוחפים **פעם אחת בלבד** בסוף:
   a. החל את **כל** ה-safe fixes בקוד (במצב עבודה מקומי, בלי לדחוף בין לבין).
   b. עדכן את `.claude/audit-log.md` (פורמט למטה).
   c. **אמת מקומית**: `npm ci` (אם צריך) → `npm run lint` → `npm run build`. אם נכשל — תקן מקומית. **אסור לדחוף build שבור, ואסור לדחוף כדי לבדוק** (האימות כולו מקומי, לא ב-Vercel).
   d. `git commit` **יחיד** עם הודעה מתוארכת: `chore(audit): YYYY-MM-DD daily scan — <N> fixes, <M> reported`. (אם יצרת fixups תוך כדי — squash/`--amend` ל-commit אחד.)
   e. **push יחיד**: `git push -u origin claude/daily-audit` (retry עם backoff **רק** על שגיאות רשת — retry של רשת אינו "push נוסף", זו אותה דחיפה). **זו הדחיפה היחידה ביום.**
   f. אם אין PR פתוח → פתח PR (`base=main`, `head=claude/daily-audit`). אם קיים → הוא מתעדכן אוטומטית מה-push; עדכן את גוף ה-PR (עדכון גוף ה-PR אינו push ל-git, לא מפעיל build).
6. **עדכן את גוף ה-PR** לפורמט למטה (כולל קישור Preview עדכני) — דרך GitHub API, לא דרך commit נוסף.

## 🔗 קישור Preview

אחרי ה-push, השג את ה-Preview URL של הענף:
- דרך Vercel MCP `list_deployments` (project `prj_PICvjZOmhLkCMa7sEtCzwpScz4H2`, team `team_fHXCsz8hPugxC6aLtwH88wcH`) — קח את ה-deployment האחרון של הענף עם `readyState: READY`.
- fallback ל-git alias: `https://machsan-git-claude-daily-audit-nimig10s-projects.vercel.app`.
- ה-Preview מחובר ל-**dev DB** (Stage 2) ומציג את ה-state **המצטבר** של הענף — זו נקודת הבדיקה הידנית של המשתמש.

## 📋 פורמט גוף ה-PR (לעדכן בכל הרצה)

```
## 🔁 סריקה יומית מצטברת — Rolling PR

**טווח:** <תאריך ראשון> → <תאריך אחרון> (<N> סבבים)
**Preview לבדיקה ידנית:** <URL>

### ✅ תוקן אוטומטית (safe)
- [תאריך] <קובץ>: <תיאור קצר>

### 📝 דורש החלטה שלך (לא תוקן)
- [ ] <קובץ>: <ממצא> — <למה לא תוקן אוטומטית>

### 🗒️ לוג מלא
ראה `.claude/audit-log.md`.

> ⚠️ לא למזג לפני בדיקה ידנית ב-Preview ואישור מפורש. מיגרציות DB (אם דווחו) — להחיל ידנית לפי זרימת dev-first שב-CLAUDE.md.
```

## 📝 פורמט רשומת log (`.claude/audit-log.md`)

```
## YYYY-MM-DD
- **נסרק:** <קבצים>
- **תוקן:** <רשימה או "אין">
- **דווח (checklist):** <רשימה או "אין">
- **build/lint:** PASS/FAIL
```
