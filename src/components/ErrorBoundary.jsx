import React, { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error Boundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const isDev = process.env.NODE_ENV === "development" || Boolean(import.meta.env?.DEV);

      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          backgroundColor: "var(--Bc-1, #0f172a)",
          color: "var(--Fc-1, #f8fafc)",
          textAlign: "center",
          fontFamily: "sans-serif"
        }}>
          <h1 style={{ fontSize: "1.75rem", marginBottom: "1rem" }}>Something went wrong</h1>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem" }}>
            An unexpected error occurred. Please try refreshing the page or navigating back.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.6rem 1.25rem",
              borderRadius: "0.5rem",
              backgroundColor: "#3b82f6",
              color: "#ffffff",
              border: "none",
              cursor: "pointer",
              fontWeight: 500
            }}
          >
            Reload Page
          </button>

          {isDev && this.state.error && (
            <pre style={{
              marginTop: "2rem",
              padding: "1rem",
              borderRadius: "0.5rem",
              backgroundColor: "#1e293b",
              color: "#ef4444",
              maxWidth: "100%",
              overflowX: "auto",
              textAlign: "left",
              fontSize: "0.875rem"
            }}>
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
