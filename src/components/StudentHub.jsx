// StudentHub — landing screen for logged-in students.
// Two apps for now: form system (existing PublicForm content) and
// productions board. Lives inside PublicForm.jsx so the existing login
// gate, session-restore and auth flow stay byte-identical — the hub is
// rendered AFTER the auth checks succeed.

import { useState } from "react";
import { ClipboardList, Film, GraduationCap, LogOut, BookOpen, Settings, Download } from "lucide-react";

export function StudentHub({
  student,
  logo,
  onSelectApp,
  onLogout,
  onOpenAccountSettings,
  onOpenUserGuide,
  canInstall = false,
  onInstall = () => {},
  pendingProductionRequests = 0,
}) {
  const [hovered, setHovered] = useState(null);

  const apps = [
    {
      key: "forms",
      icon: <ClipboardList size={42} strokeWidth={1.5} />,
      title: "מערכת הפניות",
      desc: "השאלת ציוד, הזמנת חדרים, לוז יומי וההזמנות שלי",
      color: "#f5a623",
    },
    {
      key: "productions",
      icon: <Film size={42} strokeWidth={1.5} />,
      title: "לוח הפקות",
      desc: "ניהול הפקות, צוות ותאריכי צילום",
      color: "#8b5cf6",
      badge: pendingProductionRequests > 0 ? pendingProductionRequests : null,
    },
  ];

  const handleInstallClick = () => { if (canInstall) void onInstall(); };

  return (
    <div style={{ minHeight: "100dvh", padding: 24, background: "var(--bg)", position: "relative" }}>
      {canInstall && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && (
        <button
          type="button"
          onClick={handleInstallClick}
          style={{
            position: "absolute", top: 24, right: 24,
            padding: "10px 18px",
            border: "1px solid rgba(245,166,35,0.35)",
            borderRadius: 10,
            background: "var(--accent)",
            color: "#0a0c10",
            cursor: "pointer",
            fontSize: 13, fontWeight: 800,
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          <Download size={16} strokeWidth={1.75} />
          <span>Install App</span>
        </button>
      )}

      <button
        type="button"
        onClick={onOpenAccountSettings}
        title="הגדרות חשבון"
        style={{
          position: "absolute", top: 24, left: 24,
          width: 42, height: 42, borderRadius: "50%",
          border: "1px solid var(--border)", background: "var(--surface)",
          color: "var(--text2)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Settings size={18} strokeWidth={1.75} />
      </button>

      <div style={{ width: "100%", maxWidth: 960, minHeight: "calc(100dvh - 48px)", margin: "0 auto", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ marginBottom: 12 }}>
              {logo
                ? <img src={logo} alt="לוגו" style={{ height: 80, maxWidth: 200, objectFit: "contain" }} />
                : <GraduationCap size={48} strokeWidth={1.5} color="var(--accent)" />}
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--text)", margin: 0 }}>שלום, {student?.name || "סטודנט/ית"}</h1>
            <div style={{ fontSize: 15, color: "var(--text2)", marginTop: 8 }}>
              מערכת מכללת קמרה אובסקורה וסאונד
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 600, width: "100%" }}>
            {apps.map(opt => (
              <button
                key={opt.key}
                onClick={() => onSelectApp(opt.key)}
                onMouseEnter={() => setHovered(opt.key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: "relative",
                  flex: "1 1 240px", maxWidth: 280, minHeight: 200,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 12,
                  padding: 24,
                  border: `2px solid ${hovered === opt.key ? opt.color : "var(--border)"}`,
                  borderRadius: 16,
                  background: hovered === opt.key ? `${opt.color}10` : "var(--surface)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  transform: hovered === opt.key ? "translateY(-2px)" : "none",
                  boxShadow: hovered === opt.key ? `0 8px 24px ${opt.color}20` : "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                {opt.badge && (
                  <span style={{
                    position: "absolute", top: 12, left: 12,
                    background: "#ef4444", color: "#fff",
                    fontSize: 11, fontWeight: 900,
                    minWidth: 22, height: 22, borderRadius: 11,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 6px",
                  }}>{opt.badge}</span>
                )}
                <span style={{ color: opt.color }}>{opt.icon}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{opt.title}</span>
                <span style={{ fontSize: 14, color: "var(--text2)", fontWeight: 600, textAlign: "center", lineHeight: 1.5 }}>{opt.desc}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 32, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {onOpenUserGuide && (
              <button
                type="button"
                onClick={onOpenUserGuide}
                onMouseEnter={() => setHovered("user-guide")}
                onMouseLeave={() => setHovered(null)}
                style={{
                  padding: "10px 24px",
                  border: `1.5px solid ${hovered === "user-guide" ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 10,
                  background: hovered === "user-guide" ? "rgba(245,166,35,0.12)" : "var(--surface)",
                  color: hovered === "user-guide" ? "var(--accent)" : "var(--text2)",
                  cursor: "pointer", fontSize: 14,
                  fontWeight: hovered === "user-guide" ? 700 : 400,
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "all 0.2s",
                }}
              >
                <BookOpen size={18} strokeWidth={1.75} /> המדריך למשתמש
              </button>
            )}
            <button
              onClick={onLogout}
              style={{
                padding: "10px 24px",
                border: "none", borderRadius: 10,
                background: "rgba(239,68,68,0.1)",
                color: "#ef4444",
                cursor: "pointer", fontSize: 14, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <LogOut size={16} strokeWidth={1.75} /> התנתק
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
