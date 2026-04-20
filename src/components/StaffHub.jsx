import { useState } from "react";
import { BookOpen, Calendar, ClipboardList, Download, GraduationCap, LayoutDashboard, LogOut, Package, Settings, Users } from "lucide-react";

export function StaffHub({ user, logo, onNavigate, onLogout, canInstall = false, onInstall = () => {} }) {
  const [hovered, setHovered] = useState(null);

  const allowedViews = user?.role === "admin" ? [] : (user?.permissions?.views || []);

  const allOptions = [
    { key: "warehouse",       icon: <Package size={40} strokeWidth={1.5} />, title: "תפעול מחסן",     desc: "ניהול ציוד, הזמנות, קיטים והסמכות",              color: "#3b82f6" },
    { key: "administration",  icon: <ClipboardList size={40} strokeWidth={1.5} />, title: "אדמיניסטרציה",   desc: "ניהול סטודנטים, אולפנים, שיעורים ודוחות",        color: "#8b5cf6" },
    { key: "staff-schedule",  icon: <Calendar size={40} strokeWidth={1.5} />, title: 'לו"ז עובדים',   desc: "הגשת העדפות, צפייה בשיבוצים ומשמרות",            color: "#0ea5e9" },
  ];

  const options = allOptions.filter(o => o.key === "staff-schedule" || !allowedViews.length || allowedViews.includes(o.key));

  const handleInstallClick = () => {
    if (!canInstall) return;
    void onInstall();
  };

  return (
    <div style={{ minHeight: "100dvh", padding: 24, background: "var(--bg)", position: "relative" }}>
      {canInstall && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && (
        <button
          type="button"
          onClick={handleInstallClick}
          style={{
            position: "absolute",
            top: 24,
            right: 24,
            padding: "10px 18px",
            border: "1px solid rgba(245,166,35,0.35)",
            borderRadius: 10,
            background: "var(--accent)",
            color: "#0a0c10",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          <Download size={16} strokeWidth={1.75} />
          <span>Install App</span>
        </button>
      )}

      <div style={{ width: "100%", maxWidth: 960, minHeight: "calc(100dvh - 48px)", margin: "0 auto", display: "flex", flexDirection: "column" }}>
        <div style={{ minHeight: 52, width: "100%", marginBottom: 16 }}>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ marginBottom: 12 }}>
              {logo
                ? <img src={logo} alt="לוגו" style={{ height: 80, maxWidth: 200, objectFit: "contain" }} />
                : <span style={{ fontSize: 42 }}>🏠</span>
              }
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--text)", margin: 0 }}>Staff Hub</h1>
            <div style={{ fontSize: 15, color: "var(--text2)", marginTop: 8 }}>
              שלום, <strong>{user?.full_name || "צוות"}</strong>
              {user?.role === "admin" && <span style={{ marginRight: 8, background: "rgba(239,68,68,0.12)", color: "#ef4444", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>Admin</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 600, width: "100%" }}>
            {options.map(opt => (
              <button
                key={opt.key}
                onClick={() => onNavigate(opt.key)}
                onMouseEnter={() => setHovered(opt.key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  flex: "1 1 240px",
                  maxWidth: 280,
                  minHeight: 180,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
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
                <span style={{ fontSize: 48 }}>{opt.icon}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{opt.title}</span>
                <span style={{ fontSize: 13, color: "var(--text3)", textAlign: "center" }}>{opt.desc}</span>
              </button>
            ))}
          </div>

          {user?.role === "admin" && (
            <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              {[
                { key: "staff-management", icon: <Users size={20} strokeWidth={1.75} />, label: "ניהול צוות",     color: "#22c55e" },
                { key: "system-settings",  icon: <Settings size={20} strokeWidth={1.75} />, label: "הגדרות מערכת",  color: "#f5a623" },
                { key: "activity-logs",    icon: <LayoutDashboard size={20} strokeWidth={1.75} />, label: "יומן פעילות",    color: "#3b82f6" },
              ].map(btn => (
                <button
                  key={btn.key}
                  onClick={() => onNavigate(btn.key)}
                  onMouseEnter={() => setHovered(btn.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: "10px 24px",
                    border: `1.5px solid ${hovered === btn.key ? btn.color : "var(--border)"}`,
                    borderRadius: 10,
                    background: hovered === btn.key ? `${btn.color}12` : "var(--surface)",
                    cursor: "pointer",
                    fontSize: 14,
                    color: hovered === btn.key ? btn.color : "var(--text2)",
                    fontWeight: hovered === btn.key ? 700 : 400,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s",
                    transform: hovered === btn.key ? "translateY(-2px)" : "none",
                    boxShadow: hovered === btn.key ? `0 6px 18px ${btn.color}25` : "none",
                  }}
                >
                  <span>{btn.icon}</span> {btn.label}
                </button>
              ))}
            </div>
          )}

          {(user?.is_student || user?.is_lecturer) && (
            <div style={{ marginTop: 32, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              {user.is_student && (
                <button
                  onClick={() => { sessionStorage.setItem("active_role", "student"); sessionStorage.removeItem("staff_user"); sessionStorage.removeItem("staff_view"); window.location.assign("/"); }}
                  onMouseEnter={() => setHovered("switch-student")}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: "8px 20px",
                    border: `1.5px solid ${hovered === "switch-student" ? "#8b5cf6" : "var(--border)"}`,
                    borderRadius: 8,
                    background: hovered === "switch-student" ? "rgba(139,92,246,0.12)" : "var(--surface)",
                    color: hovered === "switch-student" ? "#8b5cf6" : "var(--text2)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    transition: "all 0.2s",
                  }}
                >
                  <GraduationCap size={16} strokeWidth={1.75} /> מעבר לתצוגת סטודנט
                </button>
              )}
              {user.is_lecturer && (
                <button
                  onClick={() => { sessionStorage.setItem("active_role", "lecturer"); sessionStorage.removeItem("staff_user"); sessionStorage.removeItem("staff_view"); window.location.assign("/"); }}
                  onMouseEnter={() => setHovered("switch-lecturer")}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    padding: "8px 20px",
                    border: `1.5px solid ${hovered === "switch-lecturer" ? "#0ea5e9" : "var(--border)"}`,
                    borderRadius: 8,
                    background: hovered === "switch-lecturer" ? "rgba(14,165,233,0.12)" : "var(--surface)",
                    color: hovered === "switch-lecturer" ? "#0ea5e9" : "var(--text2)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    transition: "all 0.2s",
                  }}
                >
                  <BookOpen size={16} strokeWidth={1.75} /> מעבר לתצוגת מרצה
                </button>
              )}
            </div>
          )}

          <button
            onClick={onLogout}
            style={{
              marginTop: 16,
              padding: "8px 20px",
              border: "none",
              borderRadius: 8,
              background: "rgba(239,68,68,0.1)",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <LogOut size={16} strokeWidth={1.75} /> התנתק
          </button>
        </div>
      </div>
    </div>
  );
}
