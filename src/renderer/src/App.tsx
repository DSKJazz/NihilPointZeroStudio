import { Route, Routes, useLocation } from 'react-router-dom'
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

export default function App() {
  // Keyed on the route so a crashed tab clears itself once you navigate away,
  // and so one bad page can never blank the sidebar / the whole window again.
  const { pathname } = useLocation()
  return (
    <StudioProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary label={pathname.replace('/', '') || 'Today'} resetKey={pathname}>
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
