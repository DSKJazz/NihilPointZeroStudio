import React from 'react'
import ReactDOM from 'react-dom/client'
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom'
import { createHashHistory } from 'history'
import App from './App'
import './index.css'

// Diagnostic: instrument addEventListener/removeEventListener early so we can
// see which code registers hashchange/popstate handlers (helps identify if
// the router's listener is attached and from where). This runs before React mounts.
try {
  if (typeof window !== 'undefined' && !((window as any).__npz_listeners_hooked)) {
    const origAdd = window.addEventListener.bind(window)
    const origRemove = window.removeEventListener.bind(window)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.addEventListener = function (ev, fn, ...args) {
      try {
        console.log('[WIN-ADD-EVENT-LISTENER] event=', ev, 'stack=', (new Error().stack || '').split('\n').slice(2,6).join(' | '))
      } catch (_) {}
      return origAdd(ev, fn, ...args)
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.removeEventListener = function (ev, fn, ...args) {
      try {
        console.log('[WIN-REMOVE-EVENT-LISTENER] event=', ev, 'stack=', (new Error().stack || '').split('\n').slice(2,6).join(' | '))
      } catch (_) {}
      return origRemove(ev, fn, ...args)
    }
    // mark hooked so we don't double-wrap on HMR/dev
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.__npz_listeners_hooked = true
  }
} catch (err) {
  /* ignore */
}

// Create a hash history and log history events for debugging router internals.
const history = createHashHistory()
history.listen((loc, action) => {
  try { console.log('[HISTORY-LISTEN]', action, JSON.stringify(loc), Date.now(), (new Error().stack || '').split('\n').slice(2,8).join(' | ')) } catch (_) {}
})


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HistoryRouter history={history}>
      <App />
    </HistoryRouter>
  </React.StrictMode>
)
