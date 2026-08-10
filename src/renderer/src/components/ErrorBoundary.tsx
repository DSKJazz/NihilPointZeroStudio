/**
 * Stops ONE broken tab from killing the whole studio.
 *
 * Before this existed there was no error boundary anywhere: any render error —
 * e.g. a single malformed record in library.json reaching LibraryPage's
 * `entry.data as {...}` casts — unmounted the entire React tree. The window went
 * completely blank, sidebar included, so there was no way to navigate to another
 * tab or even see what happened; the only escape was restarting the app, and if
 * the bad record was still on disk it went blank again.
 *
 * Now the failure is contained to the tab that threw, in plain English, with the
 * rest of the studio still usable.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown in the message, e.g. "Library". */
  label?: string
  /** Bumping this (we pass the route) clears a previous error on navigation. */
  resetKey?: string
}

interface State {
  error: Error | null
  details: string
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, details: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidUpdate(prev: Props): void {
    // Navigating to another tab clears the failed state so the user isn't stuck
    // looking at the error after they've moved on.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, details: '' })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ details: (info.componentStack || '').trim().split('\n').slice(0, 4).join('\n') })
    // Record it where the user can actually find it (Settings → Known issues),
    // best-effort: logging must never itself crash the fallback UI.
    try {
      void window.api.aiErrors.recordUi({
        tab: this.props.label || 'app',
        message: error.message,
        stack: String(error.stack || '').slice(0, 1500)
      })
    } catch {
      // ignore — the on-screen message below is still shown
    }
  }

  private reset = (): void => this.setState({ error: null, details: '' })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="p-8">
        <div className="mx-auto max-w-2xl rounded-lg border border-amber-500/40 bg-ink-900 p-6">
          <h2 className="text-lg font-medium text-amber-300">
            This tab hit a snag{this.props.label ? ` (${this.props.label})` : ''}
          </h2>
          <p className="mt-2 text-sm text-ink-300">
            The rest of the studio is still working — pick another tab on the left, or try this one
            again. Nothing you have made was deleted.
          </p>
          <div className="mt-4 rounded-md border border-ink-700 bg-ink-950 p-3">
            <div className="text-[11px] uppercase tracking-wide text-ink-500">What went wrong</div>
            <div className="mt-1 break-words font-mono text-xs text-ink-300">{error.message}</div>
            {this.state.details && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] leading-relaxed text-ink-600">
                {this.state.details}
              </pre>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={this.reset}
              className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-gold-400"
            >
              Try this tab again
            </button>
            <button
              onClick={() => {
                window.location.hash = '#/'
                this.reset()
              }}
              className="rounded-md border border-ink-600 px-4 py-2 text-sm text-ink-200 transition-colors hover:border-ink-400"
            >
              Go to Today
            </button>
          </div>
        </div>
      </div>
    )
  }
}
