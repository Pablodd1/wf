import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  resetKey: string;
};

type State = {
  error: Error | null;
};

export class RouteLoadBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[route-load] page failed to load', {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#09090d] px-5 text-white">
        <section className="w-full max-w-xl border border-white/15 bg-[#111116] p-7 text-center shadow-2xl sm:p-10" role="alert">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#c9a96e]">Curated Luxury</p>
          <h1 className="mt-4 font-serif text-4xl">This page needs a refresh</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-white/65">
            The site was updated while this page was loading. Refresh to use the current version. Your route and filters will remain in the address bar.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 bg-[#c9a96e] px-5 text-sm font-semibold text-black"
            >
              Refresh page
            </button>
            <a href="/#/" className="flex min-h-11 items-center justify-center border border-white/20 px-5 text-sm font-semibold text-white">
              Return to landing page
            </a>
          </div>
        </section>
      </main>
    );
  }
}
