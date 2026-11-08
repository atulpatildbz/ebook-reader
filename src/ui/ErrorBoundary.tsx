import { Component, type ReactNode } from "react";
import { openLibrary } from "../lib/route";

/** Instead of a blank page when something fails while drawing: a way back to the library. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="font-serif text-2xl leading-snug">This page couldn’t be shown</h1>
        <p className="mt-2 text-[var(--muted)]">The link may be wrong, or something went wrong on our side.</p>
        <button
          onClick={() => {
            this.setState({ failed: false });
            openLibrary();
          }}
          className="mt-6 rounded-full border border-[var(--line)] px-5 py-2.5"
        >
          Go to library
        </button>
      </main>
    );
  }
}
