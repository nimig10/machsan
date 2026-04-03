/**
 * Jewish holidays lookup table for years 2025-2030.
 * Pre-computed Gregorian dates from standard Hebrew calendar conversion tables.
 * No external dependencies.
 */

const ALL_HOLIDAYS = [
  // ============== 5786 — 2025/2026 ==============
  // ט"ו בשבט — 13 Feb 2025
  { date: "2025-02-13", name: 'ט"ו בשבט', isErev: false },

  // פורים — 14 March 2025 (erev 13 March)
  { date: "2025-03-13", name: "ערב פורים", isErev: true },
  { date: "2025-03-14", name: "פורים", isErev: false },

  // פסח — 13-19 April 2025 (erev 12 April)
  { date: "2025-04-12", name: "ערב פסח", isErev: true },
  { date: "2025-04-13", name: "פסח", isErev: false },
  { date: "2025-04-14", name: "פסח - חול המועד", isErev: false },
  { date: "2025-04-15", name: "פסח - חול המועד", isErev: false },
  { date: "2025-04-16", name: "פסח - חול המועד", isErev: false },
  { date: "2025-04-17", name: "פסח - חול המועד", isErev: false },
  { date: "2025-04-18", name: "פסח - חול המועד", isErev: false },
  { date: "2025-04-19", name: "פסח - שביעי של פסח", isErev: false },

  // יום הזיכרון — 30 April 2025 (moved from 4 Iyar)
  { date: "2025-04-30", name: "יום הזיכרון", isErev: false },

  // יום העצמאות — 1 May 2025
  { date: "2025-05-01", name: "יום העצמאות", isErev: false },

  // ל"ג בעומר — 16 May 2025
  { date: "2025-05-16", name: 'ל"ג בעומר', isErev: false },

  // שבועות — 2 June 2025 (erev 1 June)
  { date: "2025-06-01", name: "ערב שבועות", isErev: true },
  { date: "2025-06-02", name: "שבועות", isErev: false },

  // ראש השנה — 23-24 Sep 2025 (erev 22 Sep)
  { date: "2025-09-22", name: "ערב ראש השנה", isErev: true },
  { date: "2025-09-23", name: "ראש השנה", isErev: false },
  { date: "2025-09-24", name: "ראש השנה ב׳", isErev: false },

  // יום כיפור — 2 Oct 2025 (erev 1 Oct)
  { date: "2025-10-01", name: "ערב יום כיפור", isErev: true },
  { date: "2025-10-02", name: "יום כיפור", isErev: false },

  // סוכות — 7-13 Oct 2025 (erev 6 Oct)
  { date: "2025-10-06", name: "ערב סוכות", isErev: true },
  { date: "2025-10-07", name: "סוכות", isErev: false },
  { date: "2025-10-08", name: "סוכות - חול המועד", isErev: false },
  { date: "2025-10-09", name: "סוכות - חול המועד", isErev: false },
  { date: "2025-10-10", name: "סוכות - חול המועד", isErev: false },
  { date: "2025-10-11", name: "סוכות - חול המועד", isErev: false },
  { date: "2025-10-12", name: "סוכות - הושענא רבה", isErev: false },
  { date: "2025-10-13", name: "סוכות - שמיני עצרת", isErev: false },

  // שמחת תורה — 14 Oct 2025
  { date: "2025-10-14", name: "שמחת תורה", isErev: false },

  // חנוכה — 15-22 Dec 2025
  { date: "2025-12-14", name: "ערב חנוכה", isErev: true },
  { date: "2025-12-15", name: "חנוכה - נר ראשון", isErev: false },
  { date: "2025-12-16", name: "חנוכה - נר שני", isErev: false },
  { date: "2025-12-17", name: "חנוכה - נר שלישי", isErev: false },
  { date: "2025-12-18", name: "חנוכה - נר רביעי", isErev: false },
  { date: "2025-12-19", name: "חנוכה - נר חמישי", isErev: false },
  { date: "2025-12-20", name: "חנוכה - נר שישי", isErev: false },
  { date: "2025-12-21", name: "חנוכה - נר שביעי", isErev: false },
  { date: "2025-12-22", name: "חנוכה - נר שמיני", isErev: false },

  // ============== 5787 — 2026 ==============
  // ט"ו בשבט — 2 Feb 2026
  { date: "2026-02-02", name: 'ט"ו בשבט', isErev: false },

  // פורים — 3 March 2026 (erev 2 March)
  { date: "2026-03-02", name: "ערב פורים", isErev: true },
  { date: "2026-03-03", name: "פורים", isErev: false },

  // פסח — 2-8 April 2026 (erev 1 April)
  { date: "2026-04-01", name: "ערב פסח", isErev: true },
  { date: "2026-04-02", name: "פסח", isErev: false },
  { date: "2026-04-03", name: "פסח - חול המועד", isErev: false },
  { date: "2026-04-04", name: "פסח - חול המועד", isErev: false },
  { date: "2026-04-05", name: "פסח - חול המועד", isErev: false },
  { date: "2026-04-06", name: "פסח - חול המועד", isErev: false },
  { date: "2026-04-07", name: "פסח - חול המועד", isErev: false },
  { date: "2026-04-08", name: "פסח - שביעי של פסח", isErev: false },

  // יום הזיכרון — 22 April 2026
  { date: "2026-04-22", name: "יום הזיכרון", isErev: false },

  // יום העצמאות — 23 April 2026
  { date: "2026-04-23", name: "יום העצמאות", isErev: false },

  // ל"ג בעומר — 5 May 2026 (moved from 18 Iyar, but this year doesn't require move)
  { date: "2026-05-05", name: 'ל"ג בעומר', isErev: false },

  // שבועות — 22 May 2026 (erev 21 May)
  { date: "2026-05-21", name: "ערב שבועות", isErev: true },
  { date: "2026-05-22", name: "שבועות", isErev: false },

  // ראש השנה — 12-13 Sep 2026 (erev 11 Sep)
  { date: "2026-09-11", name: "ערב ראש השנה", isErev: true },
  { date: "2026-09-12", name: "ראש השנה", isErev: false },
  { date: "2026-09-13", name: "ראש השנה ב׳", isErev: false },

  // יום כיפור — 21 Sep 2026 (erev 20 Sep)
  { date: "2026-09-20", name: "ערב יום כיפור", isErev: true },
  { date: "2026-09-21", name: "יום כיפור", isErev: false },

  // סוכות — 26 Sep - 2 Oct 2026 (erev 25 Sep)
  { date: "2026-09-25", name: "ערב סוכות", isErev: true },
  { date: "2026-09-26", name: "סוכות", isErev: false },
  { date: "2026-09-27", name: "סוכות - חול המועד", isErev: false },
  { date: "2026-09-28", name: "סוכות - חול המועד", isErev: false },
  { date: "2026-09-29", name: "סוכות - חול המועד", isErev: false },
  { date: "2026-09-30", name: "סוכות - חול המועד", isErev: false },
  { date: "2026-10-01", name: "סוכות - הושענא רבה", isErev: false },
  { date: "2026-10-02", name: "סוכות - שמיני עצרת", isErev: false },

  // שמחת תורה — 3 Oct 2026
  { date: "2026-10-03", name: "שמחת תורה", isErev: false },

  // חנוכה — 5-12 Dec 2026
  { date: "2026-12-04", name: "ערב חנוכה", isErev: true },
  { date: "2026-12-05", name: "חנוכה - נר ראשון", isErev: false },
  { date: "2026-12-06", name: "חנוכה - נר שני", isErev: false },
  { date: "2026-12-07", name: "חנוכה - נר שלישי", isErev: false },
  { date: "2026-12-08", name: "חנוכה - נר רביעי", isErev: false },
  { date: "2026-12-09", name: "חנוכה - נר חמישי", isErev: false },
  { date: "2026-12-10", name: "חנוכה - נר שישי", isErev: false },
  { date: "2026-12-11", name: "חנוכה - נר שביעי", isErev: false },
  { date: "2026-12-12", name: "חנוכה - נר שמיני", isErev: false },

  // ============== 5788 — 2027 ==============
  // ט"ו בשבט — 22 Jan 2027
  { date: "2027-01-22", name: 'ט"ו בשבט', isErev: false },

  // פורים — 23 March 2027 (erev 22 March) — leap year in Hebrew calendar
  { date: "2027-03-22", name: "ערב פורים", isErev: true },
  { date: "2027-03-23", name: "פורים", isErev: false },

  // פסח — 22-28 April 2027 (erev 21 April)
  { date: "2027-04-21", name: "ערב פסח", isErev: true },
  { date: "2027-04-22", name: "פסח", isErev: false },
  { date: "2027-04-23", name: "פסח - חול המועד", isErev: false },
  { date: "2027-04-24", name: "פסח - חול המועד", isErev: false },
  { date: "2027-04-25", name: "פסח - חול המועד", isErev: false },
  { date: "2027-04-26", name: "פסח - חול המועד", isErev: false },
  { date: "2027-04-27", name: "פסח - חול המועד", isErev: false },
  { date: "2027-04-28", name: "פסח - שביעי של פסח", isErev: false },

  // יום הזיכרון — 11 May 2027
  { date: "2027-05-11", name: "יום הזיכרון", isErev: false },

  // יום העצמאות — 12 May 2027
  { date: "2027-05-12", name: "יום העצמאות", isErev: false },

  // ל"ג בעומר — 25 May 2027
  { date: "2027-05-25", name: 'ל"ג בעומר', isErev: false },

  // שבועות — 11 June 2027 (erev 10 June)
  { date: "2027-06-10", name: "ערב שבועות", isErev: true },
  { date: "2027-06-11", name: "שבועות", isErev: false },

  // ראש השנה — 2-3 Oct 2027 (erev 1 Oct)
  { date: "2027-10-01", name: "ערב ראש השנה", isErev: true },
  { date: "2027-10-02", name: "ראש השנה", isErev: false },
  { date: "2027-10-03", name: "ראש השנה ב׳", isErev: false },

  // יום כיפור — 11 Oct 2027 (erev 10 Oct)
  { date: "2027-10-10", name: "ערב יום כיפור", isErev: true },
  { date: "2027-10-11", name: "יום כיפור", isErev: false },

  // סוכות — 16-22 Oct 2027 (erev 15 Oct)
  { date: "2027-10-15", name: "ערב סוכות", isErev: true },
  { date: "2027-10-16", name: "סוכות", isErev: false },
  { date: "2027-10-17", name: "סוכות - חול המועד", isErev: false },
  { date: "2027-10-18", name: "סוכות - חול המועד", isErev: false },
  { date: "2027-10-19", name: "סוכות - חול המועד", isErev: false },
  { date: "2027-10-20", name: "סוכות - חול המועד", isErev: false },
  { date: "2027-10-21", name: "סוכות - הושענא רבה", isErev: false },
  { date: "2027-10-22", name: "סוכות - שמיני עצרת", isErev: false },

  // שמחת תורה — 23 Oct 2027
  { date: "2027-10-23", name: "שמחת תורה", isErev: false },

  // חנוכה — 25 Dec 2027 - 1 Jan 2028
  { date: "2027-12-24", name: "ערב חנוכה", isErev: true },
  { date: "2027-12-25", name: "חנוכה - נר ראשון", isErev: false },
  { date: "2027-12-26", name: "חנוכה - נר שני", isErev: false },
  { date: "2027-12-27", name: "חנוכה - נר שלישי", isErev: false },
  { date: "2027-12-28", name: "חנוכה - נר רביעי", isErev: false },
  { date: "2027-12-29", name: "חנוכה - נר חמישי", isErev: false },
  { date: "2027-12-30", name: "חנוכה - נר שישי", isErev: false },
  { date: "2027-12-31", name: "חנוכה - נר שביעי", isErev: false },
  { date: "2028-01-01", name: "חנוכה - נר שמיני", isErev: false },

  // ============== 5789 — 2028 ==============
  // ט"ו בשבט — 10 Feb 2028
  { date: "2028-02-10", name: 'ט"ו בשבט', isErev: false },

  // פורים — 12 March 2028 (erev 11 March) — leap year in Hebrew calendar
  { date: "2028-03-11", name: "ערב פורים", isErev: true },
  { date: "2028-03-12", name: "פורים", isErev: false },

  // פסח — 11-17 April 2028 (erev 10 April)
  { date: "2028-04-10", name: "ערב פסח", isErev: true },
  { date: "2028-04-11", name: "פסח", isErev: false },
  { date: "2028-04-12", name: "פסח - חול המועד", isErev: false },
  { date: "2028-04-13", name: "פסח - חול המועד", isErev: false },
  { date: "2028-04-14", name: "פסח - חול המועד", isErev: false },
  { date: "2028-04-15", name: "פסח - חול המועד", isErev: false },
  { date: "2028-04-16", name: "פסח - חול המועד", isErev: false },
  { date: "2028-04-17", name: "פסח - שביעי של פסח", isErev: false },

  // יום הזיכרון — 2 May 2028 (moved: 4 Iyar falls on Tuesday)
  { date: "2028-05-02", name: "יום הזיכרון", isErev: false },

  // יום העצמאות — 3 May 2028
  { date: "2028-05-03", name: "יום העצמאות", isErev: false },

  // ל"ג בעומר — 14 May 2028
  { date: "2028-05-14", name: 'ל"ג בעומר', isErev: false },

  // שבועות — 31 May 2028 (erev 30 May)
  { date: "2028-05-30", name: "ערב שבועות", isErev: true },
  { date: "2028-05-31", name: "שבועות", isErev: false },

  // ראש השנה — 21-22 Sep 2028 (erev 20 Sep)
  { date: "2028-09-20", name: "ערב ראש השנה", isErev: true },
  { date: "2028-09-21", name: "ראש השנה", isErev: false },
  { date: "2028-09-22", name: "ראש השנה ב׳", isErev: false },

  // יום כיפור — 30 Sep 2028 (erev 29 Sep)
  { date: "2028-09-29", name: "ערב יום כיפור", isErev: true },
  { date: "2028-09-30", name: "יום כיפור", isErev: false },

  // סוכות — 5-11 Oct 2028 (erev 4 Oct)
  { date: "2028-10-04", name: "ערב סוכות", isErev: true },
  { date: "2028-10-05", name: "סוכות", isErev: false },
  { date: "2028-10-06", name: "סוכות - חול המועד", isErev: false },
  { date: "2028-10-07", name: "סוכות - חול המועד", isErev: false },
  { date: "2028-10-08", name: "סוכות - חול המועד", isErev: false },
  { date: "2028-10-09", name: "סוכות - חול המועד", isErev: false },
  { date: "2028-10-10", name: "סוכות - הושענא רבה", isErev: false },
  { date: "2028-10-11", name: "סוכות - שמיני עצרת", isErev: false },

  // שמחת תורה — 12 Oct 2028
  { date: "2028-10-12", name: "שמחת תורה", isErev: false },

  // חנוכה — 13-20 Dec 2028
  { date: "2028-12-12", name: "ערב חנוכה", isErev: true },
  { date: "2028-12-13", name: "חנוכה - נר ראשון", isErev: false },
  { date: "2028-12-14", name: "חנוכה - נר שני", isErev: false },
  { date: "2028-12-15", name: "חנוכה - נר שלישי", isErev: false },
  { date: "2028-12-16", name: "חנוכה - נר רביעי", isErev: false },
  { date: "2028-12-17", name: "חנוכה - נר חמישי", isErev: false },
  { date: "2028-12-18", name: "חנוכה - נר שישי", isErev: false },
  { date: "2028-12-19", name: "חנוכה - נר שביעי", isErev: false },
  { date: "2028-12-20", name: "חנוכה - נר שמיני", isErev: false },

  // ============== 5790 — 2029 ==============
  // ט"ו בשבט — 30 Jan 2029
  { date: "2029-01-30", name: 'ט"ו בשבט', isErev: false },

  // פורים — 1 March 2029 (erev 28 Feb)
  { date: "2029-02-28", name: "ערב פורים", isErev: true },
  { date: "2029-03-01", name: "פורים", isErev: false },

  // פסח — 31 March - 6 April 2029 (erev 30 March)
  { date: "2029-03-30", name: "ערב פסח", isErev: true },
  { date: "2029-03-31", name: "פסח", isErev: false },
  { date: "2029-04-01", name: "פסח - חול המועד", isErev: false },
  { date: "2029-04-02", name: "פסח - חול המועד", isErev: false },
  { date: "2029-04-03", name: "פסח - חול המועד", isErev: false },
  { date: "2029-04-04", name: "פסח - חול המועד", isErev: false },
  { date: "2029-04-05", name: "פסח - חול המועד", isErev: false },
  { date: "2029-04-06", name: "פסח - שביעי של פסח", isErev: false },

  // יום הזיכרון — 18 April 2029
  { date: "2029-04-18", name: "יום הזיכרון", isErev: false },

  // יום העצמאות — 19 April 2029
  { date: "2029-04-19", name: "יום העצמאות", isErev: false },

  // ל"ג בעומר — 3 May 2029
  { date: "2029-05-03", name: 'ל"ג בעומר', isErev: false },

  // שבועות — 20 May 2029 (erev 19 May)
  { date: "2029-05-19", name: "ערב שבועות", isErev: true },
  { date: "2029-05-20", name: "שבועות", isErev: false },

  // ראש השנה — 10-11 Sep 2029 (erev 9 Sep)
  { date: "2029-09-09", name: "ערב ראש השנה", isErev: true },
  { date: "2029-09-10", name: "ראש השנה", isErev: false },
  { date: "2029-09-11", name: "ראש השנה ב׳", isErev: false },

  // יום כיפור — 19 Sep 2029 (erev 18 Sep)
  { date: "2029-09-18", name: "ערב יום כיפור", isErev: true },
  { date: "2029-09-19", name: "יום כיפור", isErev: false },

  // סוכות — 24-30 Sep 2029 (erev 23 Sep)
  { date: "2029-09-23", name: "ערב סוכות", isErev: true },
  { date: "2029-09-24", name: "סוכות", isErev: false },
  { date: "2029-09-25", name: "סוכות - חול המועד", isErev: false },
  { date: "2029-09-26", name: "סוכות - חול המועד", isErev: false },
  { date: "2029-09-27", name: "סוכות - חול המועד", isErev: false },
  { date: "2029-09-28", name: "סוכות - חול המועד", isErev: false },
  { date: "2029-09-29", name: "סוכות - הושענא רבה", isErev: false },
  { date: "2029-09-30", name: "סוכות - שמיני עצרת", isErev: false },

  // שמחת תורה — 1 Oct 2029
  { date: "2029-10-01", name: "שמחת תורה", isErev: false },

  // חנוכה — 2-9 Dec 2029
  { date: "2029-12-01", name: "ערב חנוכה", isErev: true },
  { date: "2029-12-02", name: "חנוכה - נר ראשון", isErev: false },
  { date: "2029-12-03", name: "חנוכה - נר שני", isErev: false },
  { date: "2029-12-04", name: "חנוכה - נר שלישי", isErev: false },
  { date: "2029-12-05", name: "חנוכה - נר רביעי", isErev: false },
  { date: "2029-12-06", name: "חנוכה - נר חמישי", isErev: false },
  { date: "2029-12-07", name: "חנוכה - נר שישי", isErev: false },
  { date: "2029-12-08", name: "חנוכה - נר שביעי", isErev: false },
  { date: "2029-12-09", name: "חנוכה - נר שמיני", isErev: false },

  // ============== 5791 — 2030 ==============
  // ט"ו בשבט — 19 Jan 2030
  { date: "2030-01-19", name: 'ט"ו בשבט', isErev: false },

  // פורים — 19 March 2030 (erev 18 March) — leap year in Hebrew calendar
  { date: "2030-03-18", name: "ערב פורים", isErev: true },
  { date: "2030-03-19", name: "פורים", isErev: false },

  // פסח — 18-24 April 2030 (erev 17 April)
  { date: "2030-04-17", name: "ערב פסח", isErev: true },
  { date: "2030-04-18", name: "פסח", isErev: false },
  { date: "2030-04-19", name: "פסח - חול המועד", isErev: false },
  { date: "2030-04-20", name: "פסח - חול המועד", isErev: false },
  { date: "2030-04-21", name: "פסח - חול המועד", isErev: false },
  { date: "2030-04-22", name: "פסח - חול המועד", isErev: false },
  { date: "2030-04-23", name: "פסח - חול המועד", isErev: false },
  { date: "2030-04-24", name: "פסח - שביעי של פסח", isErev: false },

  // יום הזיכרון — 7 May 2030
  { date: "2030-05-07", name: "יום הזיכרון", isErev: false },

  // יום העצמאות — 8 May 2030
  { date: "2030-05-08", name: "יום העצמאות", isErev: false },

  // ל"ג בעומר — 21 May 2030
  { date: "2030-05-21", name: 'ל"ג בעומר', isErev: false },

  // שבועות — 7 June 2030 (erev 6 June)
  { date: "2030-06-06", name: "ערב שבועות", isErev: true },
  { date: "2030-06-07", name: "שבועות", isErev: false },

  // ראש השנה — 28-29 Sep 2030 (erev 27 Sep)
  { date: "2030-09-27", name: "ערב ראש השנה", isErev: true },
  { date: "2030-09-28", name: "ראש השנה", isErev: false },
  { date: "2030-09-29", name: "ראש השנה ב׳", isErev: false },

  // יום כיפור — 7 Oct 2030 (erev 6 Oct)
  { date: "2030-10-06", name: "ערב יום כיפור", isErev: true },
  { date: "2030-10-07", name: "יום כיפור", isErev: false },

  // סוכות — 12-18 Oct 2030 (erev 11 Oct)
  { date: "2030-10-11", name: "ערב סוכות", isErev: true },
  { date: "2030-10-12", name: "סוכות", isErev: false },
  { date: "2030-10-13", name: "סוכות - חול המועד", isErev: false },
  { date: "2030-10-14", name: "סוכות - חול המועד", isErev: false },
  { date: "2030-10-15", name: "סוכות - חול המועד", isErev: false },
  { date: "2030-10-16", name: "סוכות - חול המועד", isErev: false },
  { date: "2030-10-17", name: "סוכות - הושענא רבה", isErev: false },
  { date: "2030-10-18", name: "סוכות - שמיני עצרת", isErev: false },

  // שמחת תורה — 19 Oct 2030
  { date: "2030-10-19", name: "שמחת תורה", isErev: false },

  // חנוכה — 21-28 Dec 2030
  { date: "2030-12-20", name: "ערב חנוכה", isErev: true },
  { date: "2030-12-21", name: "חנוכה - נר ראשון", isErev: false },
  { date: "2030-12-22", name: "חנוכה - נר שני", isErev: false },
  { date: "2030-12-23", name: "חנוכה - נר שלישי", isErev: false },
  { date: "2030-12-24", name: "חנוכה - נר רביעי", isErev: false },
  { date: "2030-12-25", name: "חנוכה - נר חמישי", isErev: false },
  { date: "2030-12-26", name: "חנוכה - נר שישי", isErev: false },
  { date: "2030-12-27", name: "חנוכה - נר שביעי", isErev: false },
  { date: "2030-12-28", name: "חנוכה - נר שמיני", isErev: false },
];

/**
 * Returns all Jewish holidays whose date falls within [startDate, endDate] (inclusive).
 * @param {Date|string} startDate - Start of range (Date object or "YYYY-MM-DD" string)
 * @param {Date|string} endDate   - End of range (Date object or "YYYY-MM-DD" string)
 * @returns {Array<{date: string, name: string, isErev: boolean}>}
 */
export function getHolidaysForDateRange(startDate, endDate) {
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const start = typeof startDate === "string" ? startDate : fmt(startDate);
  const end = typeof endDate === "string" ? endDate : fmt(endDate);

  return ALL_HOLIDAYS.filter((h) => h.date >= start && h.date <= end);
}
