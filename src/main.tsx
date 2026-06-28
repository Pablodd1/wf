import React, { Component, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App';

// Error boundary to catch and display render errors
class ErrorBoundary extends Component<{children: React.ReactNode}, {error: Error | null}> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error.message, error.stack, info);
  }
  render() {
    if (this.state.error) {
      return createElement('div', {
        style: { padding: 20, color: '#ef4444', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }
      }, [
        createElement('h2', null, '⚠ Render Error'),
        createElement('p', null, this.state.error.message),
        createElement('pre', { style: { fontSize: 11, opacity: 0.7 } }, this.state.error.stack || ''),
      ]);
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  createElement(ErrorBoundary, null,
    createElement(HashRouter, null,
      createElement(App)
    )
  )
);
