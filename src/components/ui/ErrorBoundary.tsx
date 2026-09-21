"use client";

import { Component, type ReactNode } from "react";

/**
 * Contains a render failure to the section it happened in.
 *
 * Without one, any thrown error during render replaces the entire page with a
 * blank "Application error" — the board, the prices and the wallet all gone
 * because one panel hit a bad value. With one, that panel says so and offers a
 * retry, and everything around it keeps working.
 */
export class ErrorBoundary extends Component<
  {
    /** What failed, in the words the user would use: "Your position". */
    name: string;
    children: ReactNode;
    /** Replaces the default card, e.g. to keep a close button in a drawer. */
    fallback?: (retry: () => void) => ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[kolu] ${this.props.name} failed to render:`, error);
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return (
      <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]" role="alert">
        <span className="text-[var(--text-2)]">
          {this.props.name} hit an error. The rest of Kolu is unaffected.
        </span>
        <button
          type="button"
          onClick={this.retry}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
}
