import { Component } from "react";

const wrapStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: 24,
  background: "#0a0a0a",
  color: "#f5f5f5",
  fontFamily: "Heebo, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  textAlign: "center",
};

const titleStyle = { margin: 0, fontSize: 22, fontWeight: 800 };
const msgStyle = { margin: 0, fontSize: 14, opacity: 0.85, maxWidth: 480 };

const buttonRow = { display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" };

const primaryBtn = {
  background: "#f5a623",
  color: "#000",
  border: "none",
  padding: "10px 18px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn = {
  background: "transparent",
  color: "#f5f5f5",
  border: "1px solid #f5f5f5",
  padding: "10px 18px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const detailsStyle = {
  marginTop: 16,
  maxWidth: 720,
  width: "100%",
  background: "#161616",
  border: "1px solid #2a2a2a",
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  textAlign: "left",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  direction: "ltr",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, info } = this.state;
    const isDev = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

    return (
      <div style={wrapStyle} role="alert" aria-live="assertive">
        <h1 style={titleStyle}>משהו השתבש</h1>
        <p style={msgStyle}>אירעה שגיאה לא צפויה. ננסה לשחזר את המצב.</p>
        <div style={buttonRow}>
          <button type="button" style={primaryBtn} onClick={this.handleReload}>
            רענן את הדף
          </button>
          <button type="button" style={secondaryBtn} onClick={this.handleGoHome}>
            חזור לדף הבית
          </button>
        </div>
        {isDev && (
          <details style={detailsStyle}>
            <summary style={{ cursor: "pointer", marginBottom: 8 }}>פרטי שגיאה (dev only)</summary>
            <div>{error?.message || String(error)}</div>
            {info?.componentStack && <pre style={{ marginTop: 8 }}>{info.componentStack}</pre>}
          </details>
        )}
      </div>
    );
  }
}
