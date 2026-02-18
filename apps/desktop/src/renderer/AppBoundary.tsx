import { Component, type ReactNode } from "react";
import { clearLayout } from "./layout";
import { clearSessionSnapshot } from "./session";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AppBoundary extends Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public override componentDidCatch(error: Error, info: unknown): void {
    console.error("renderer crash", error, info);
  }

  private readonly reload = () => {
    window.location.reload();
  };

  private readonly resetUiState = () => {
    clearLayout();
    clearSessionSnapshot();
    window.location.reload();
  };

  public override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="app-crash-fallback" role="alert" aria-live="assertive">
        <div className="app-crash-card">
          <h1>Atlas Meridian encountered an unrecoverable UI error</h1>
          <p>The renderer state can be reloaded without touching project files.</p>
          <code>{this.state.error.message}</code>
          <div className="inline-search">
            <button onClick={this.reload}>Reload UI</button>
            <button onClick={this.resetUiState}>Reset UI State + Reload</button>
          </div>
        </div>
      </main>
    );
  }
}
