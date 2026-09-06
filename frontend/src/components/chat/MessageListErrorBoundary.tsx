'use client';

// Error boundary for the message list — "Something went wrong — Retry".

import React from 'react';
import { RefreshCw } from 'lucide-react';

interface State { error: Error | null }

export class MessageListErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry?: () => void },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-auto max-w-md rounded-lg border border-red-500/40 bg-red-500/5 p-5 text-center">
          <p className="text-sm text-red-400">Something went wrong — {this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onRetry?.(); }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default MessageListErrorBoundary;