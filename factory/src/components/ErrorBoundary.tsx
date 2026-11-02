import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { reportError } from "../lib/errors";

/** Catches a crash in part of the app: reports it and shows a way back instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; place: string; full?: boolean }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: ErrorInfo) { reportError(err, `${this.props.place}${info.componentStack ? " " + info.componentStack.split("\n").slice(1, 4).join(" < ").trim() : ""}`); }
  componentDidUpdate(prev: { place: string }) { if (prev.place !== this.props.place && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className={`crash ${this.props.full ? "full" : ""}`}>
        <b>{t("Something went wrong on this screen")}</b>
        <p className="muted">{t("It has been reported automatically. Try again, or reload the app.")}</p>
        <div className="row gap">
          <button type="button" className="btn soft" onClick={() => this.setState({ err: null })}>{t("Try again")}</button>
          <button type="button" className="btn primary" onClick={() => location.reload()}>{t("Reload")}</button>
        </div>
      </div>
    );
  }
}
