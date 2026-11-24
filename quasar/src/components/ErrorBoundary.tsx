import { Component, type ReactNode } from "react";

/** Keeps one broken view from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="card pad" style={{ maxWidth: 720 }}>
          <h3>This view hit a problem</h3>
          <p className="muted" style={{ fontSize: 13 }}>The lighting keeps running. Switch tabs, or report this so it can be fixed:</p>
          <pre className="mono" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", userSelect: "text", background: "rgba(0,0,0,.35)", padding: 12, borderRadius: 4 }}>
            {String(this.state.error?.stack ?? this.state.error)}
          </pre>
          <button className="btn sm" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
