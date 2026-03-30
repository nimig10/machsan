import { useState } from "react";

export function StaffHub({ user, onNavigate, onLogout }) {
  const [hovered, setHovered] = useState(null);

  const allowedViews = user?.role === "admin" ? [] : (user?.permissions?.views || []);

  const allOptions = [
    { key: "warehouse",       icon: "📦", title: "תפעול מחסן",     desc: "ניהול ציוד, הזמנות, קיטים והסמכות",              color: "#3b82f6" },
    { key: "administration",  icon: "📋", title: "אדמיניסטרציה",   desc: "ניהול סטודנטים, אולפנים, שיעורים ודוחות",        color: "#8b5cf6" },
  ];

  // Filter views based on permissions (empty = all allowed)
  const options = allOptions.filter(o => !allowedViews.length || allowedViews.includes(o.key));

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>🏠</div>
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
        <button
          onClick={() => onNavigate("staff-management")}
          style={{
            marginTop: 24,
            padding: "10px 24px",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--surface)",
            cursor: "pointer",
            fontSize: 14,
            color: "var(--text2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>⚙️</span> ניהול צוות
        </button>
      )}

      <button
        onClick={onLogout}
        style={{
          marginTop: 32,
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
        🚪 התנתק
      </button>
    </div>
  );
}
