import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation, faRotate } from '@fortawesome/free-solid-svg-icons';
import { Button } from './Button';

export class ErrorBoundary extends Component<{ children: ReactNode; onError?: (error: unknown) => void }, { error: unknown }> {
  state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Render error caught by ErrorBoundary', error, info);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-full place-items-center p-6">
          <div className="max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow)]">
            <div className="text-lg font-semibold">
              <FontAwesomeIcon icon={faTriangleExclamation} className="mr-2" style={{ color: 'var(--review)' }} />
              Something went wrong
            </div>
            <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              {String(this.state.error)}
            </p>
            <Button variant="primary" className="mt-5" onClick={() => this.setState({ error: undefined })}>
              <FontAwesomeIcon icon={faRotate} />
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
