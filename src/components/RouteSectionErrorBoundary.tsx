import { Component, type ErrorInfo, type ReactNode } from "react";

type RouteSectionErrorBoundaryProps = {
  title: string;
  children: ReactNode;
};

type RouteSectionErrorBoundaryState = {
  hasError: boolean;
};

export class RouteSectionErrorBoundary extends Component<
  RouteSectionErrorBoundaryProps,
  RouteSectionErrorBoundaryState
> {
  state: RouteSectionErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): RouteSectionErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[route-section:${this.props.title}] render failed`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <h2 className="text-sm font-medium text-destructive">{this.props.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Этот блок не удалось загрузить. Обновите страницу или откройте его позже.
          </p>
        </section>
      );
    }

    return this.props.children;
  }
}
