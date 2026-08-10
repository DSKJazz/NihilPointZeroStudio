import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useLayoutEffect } from 'react'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import FallbackBanner from './components/FallbackBanner'
import UpdateBanner from './components/UpdateBanner'
import OnboardingTour from './components/OnboardingTour'
import AssistantWidget from './components/AssistantWidget'
import GuideWidget from './components/GuideWidget'
import CommandPalette from './components/CommandPalette'
import ToastHost from './components/Toast'
import ConfirmHost from './components/Confirm'
import TodayPage from './pages/TodayPage'
import ChannelPage from './pages/ChannelPage'
import IdeasPage from './pages/IdeasPage'
import AgentPage from './pages/AgentPage'
import SceneStudioPage from './pages/SceneStudioPage'
import WriterPage from './pages/WriterPage'
import ScriptPadPage from './pages/ScriptPadPage'
import VideoPage from './pages/VideoPage'
import TimelinePage from './pages/TimelinePage'
import StoryboardPage from './pages/StoryboardPage'
import PresenterPage from './pages/PresenterPage'
import RecorderPage from './pages/RecorderPage'
import TeleprompterPage from './pages/TeleprompterPage'
import ChartsPage from './pages/ChartsPage'
import PsxPage from './pages/PsxPage'
import NccplPage from './pages/NccplPage'
import AdvisorPage from './pages/AdvisorPage'
import LibraryPage from './pages/LibraryPage'
import SettingsPage from './pages/SettingsPage'
import ActivityLogPage from './pages/ActivityLogPage'
import { StudioProvider } from './store/StudioContext'

const RouterTracer = ({ children }: { children: React.ReactNode }) => {
  const loc = useLocation()
  const renders = useRef(0)
  // useLayoutEffect to catch synchronous render updates before paint
  useLayoutEffect(() => {
    renders.current += 1
    try {
      console.log('[ROUTER-TRACER] layout', Date.now(), 'render=', renders.current, 'loc=', JSON.stringify(loc), 'hash=', window.location.hash)
    } catch (_) {}
  }, [loc])
  // effect for async observation
  useEffect(() => {
    try { console.log('[ROUTER-TRACER] effect', Date.now(), 'loc=', JSON.stringify(loc), 'hash=', window.location.hash) } catch (_) {}
  }, [loc])
  return <>{children}</>
}

export default function App() {
  // Keyed on the route so a crashed tab clears itself once you navigate away,
  // and so one bad page can never blank the sidebar / the whole window again.
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // Expose a navigation shim to E2E diagnostics so the harness can drive navigation
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - diagnostic global
      window.__npz_navTo = (p: string) => navigate(p)
      console.log('[APP-TRACE] __npz_navTo shim installed')
    } catch (_) {}
    // Also listen for a custom test-only event that forces the router to re-run navigation
    const onForce = () => {
      try {
        const target = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
        console.log('[APP-TRACE] npz-force-nav received, navigating to', target)
        navigate(target || '/')
      } catch (err) { console.log('[APP-TRACE] npz-force-nav handler error', err) }
    }
    window.addEventListener('npz-force-nav', onForce)
    return () => {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        delete window.__npz_navTo
      } catch (_) {}
      window.removeEventListener('npz-force-nav', onForce)
    }
  }, [navigate])

  // Diagnostic trace: log router-visible pathname changes during E2E investigations
  useEffect(() => {
    try { console.log('[APP-TRACE] pathname=', pathname, 'hash=', window.location.hash) } catch (_) {}
  }, [pathname])

  // Also trace raw hashchange events directly to see whether the browser fires them
  useEffect(() => {
    const onHash = () => {
      try { console.log('[HASHCHANGE-EVENT] window.location.hash=', window.location.hash, 'location.pathname=', location.pathname) } catch (_) {}
      try {
        // Test-only diagnostic: if enabled, force the router to navigate from the raw hash
        // This is guarded by window.__npz_diag_force_hash_nav so normal behavior is unchanged.
        // The harness can set that flag when reproducing the sequence.
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (window.__npz_diag_force_hash_nav) {
          const target = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
          try { console.log('[APP-TRACE] __npz_diag_force_hash_nav navigating to', target) } catch (_) {}
          navigate(target || '/')
        }
      } catch (_) {}
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [navigate])

  // Periodic debug snapshot (short-lived): log pathname+hash pairs for 6s after mount
  useEffect(() => {
    let ticks = 0
    const id = setInterval(() => {
      try {
        ticks += 1
        console.log('[APP-POLL] t=', Date.now(), 'tick=', ticks, 'pathname=', pathname, 'hash=', window.location.hash)
        if (ticks >= 30) clearInterval(id)
      } catch (_) {}
    }, 200)
    return () => clearInterval(id)
  }, [])

  return (
    <StudioProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary label={pathname.replace('/', '') || 'Today'} resetKey={pathname}>
            <RouterTracer>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/ideas" element={<IdeasPage />} />
              <Route path="/channel" element={<ChannelPage />} />
              <Route path="/agent" element={<AgentPage />} />
              <Route path="/scenes" element={<SceneStudioPage />} />
              <Route path="/writer" element={<WriterPage />} />
              <Route path="/scriptpad" element={<ScriptPadPage />} />
              <Route path="/video" element={<VideoPage />} />
              <Route path="/storyboard" element={<StoryboardPage />} />
              <Route path="/presenter" element={<PresenterPage />} />
              <Route path="/recorder" element={<RecorderPage />} />
              <Route path="/teleprompter" element={<TeleprompterPage />} />
              <Route path="/timeline" element={<TimelinePage />} />
              <Route path="/charts" element={<ChartsPage />} />
              <Route path="/psx" element={<PsxPage />} />
              <Route path="/nccpl" element={<NccplPage />} />
              <Route path="/advisor" element={<AdvisorPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/activity" element={<ActivityLogPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
            </RouterTracer>
          </ErrorBoundary>
        </main>
        <FallbackBanner />
        <UpdateBanner />
        <OnboardingTour />
        <AssistantWidget />
        <GuideWidget />
        <CommandPalette />
        <ToastHost />
        <ConfirmHost />
      </div>
    </StudioProvider>
  )
}
