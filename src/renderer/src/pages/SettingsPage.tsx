import QRCode from 'qrcode'
import type { WebServerAddress } from '../../../shared/types'
import { useEffect, useState } from 'react'
import { confirmDialog } from '../components/Confirm'
import { toast } from '../components/Toast'
import WhatsNewCard from '../components/WhatsNewCard'
import VersionCard from '../components/VersionCard'
import YouTubeSetup from '../components/YouTubeSetup'
import AiSwitchboard from '../components/AiSwitchboard'
import CaretakerCard from '../components/CaretakerCard'
import GeminiSetup from '../components/GeminiSetup'
import type {
  AiErrorEntry,
  HardwareReport,
  HealthReport,
  LLMProviderId,
  OllamaStatus,
  ProviderSettings,
  StrandedReport
} from '../../../shared/types'

const providerLabel: Record<LLMProviderId, string> = {
  free: 'Free (online)',
  ollama: 'Local (Free)',
  gemini: 'Gemini (free key)',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI'
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [hordeKey, setHordeKey] = useState('')
  const [mvsepToken, setMvsepToken] = useState('')
  const [demucsCmd, setDemucsCmd] = useState('')
  const [faceAnimCmd, setFaceAnimCmd] = useState('')
  const [ytChannel, setYtChannel] = useState('')
  const [piperInstalled, setPiperInstalled] = useState(false)
  const [piperVoices, setPiperVoices] = useState<
    { id: string; label: string; language: string; approxMB: number; installed: boolean }[]
  >([])
  const [piperBusyId, setPiperBusyId] = useState<string | null>(null)
  const [piperMsg, setPiperMsg] = useState<string | null>(null)
  const [winVoices, setWinVoices] = useState<{ id: string; name: string; language: string }[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [checkingOllama, setCheckingOllama] = useState(false)
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  const [webUrl, setWebUrl] = useState<string | null>(null)
  // Every network this PC can be reached on, plus a scannable code for each.
  const [webAddresses, setWebAddresses] = useState<WebServerAddress[]>([])
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  const [webBusy, setWebBusy] = useState(false)
  const [aiCloudEndpoint, setAiCloudEndpoint] = useState('')
  const [aiCloudModel, setAiCloudModel] = useState('')
  const [aiCloudKey, setAiCloudKey] = useState('')
  const [aiLocalEndpoint, setAiLocalEndpoint] = useState('')
  const [aiHasCloudKey, setAiHasCloudKey] = useState(false)
  const [aiLocalKind, setAiLocalKind] = useState<'comfyui' | 'generic'>('comfyui')
  const [aiComfyWorkflow, setAiComfyWorkflow] = useState('')
  const [aiFreeProvider, setAiFreeProvider] = useState<'puter' | 'pollinations'>('puter')
  const [aiFreeModel, setAiFreeModel] = useState('')
  const [aiPollinModel, setAiPollinModel] = useState('')
  const [aiPollinKey, setAiPollinKey] = useState('')
  const [aiHasPollinKey, setAiHasPollinKey] = useState(false)
  const [aiPollinTest, setAiPollinTest] = useState<string | null>(null)
  const [aiFreeCap, setAiFreeCap] = useState(5)
  const [aiFreeStatus, setAiFreeStatus] = useState<{ ok: boolean; detail: string } | null>(null)
  const [backupInfo, setBackupInfo] = useState<{ root: string; secondDir: string; purgeOnDelete: boolean } | null>(null)
  const [backupBusy, setBackupBusy] = useState<'backup' | 'restore' | 'orphans' | null>(null)
  const [backupNote, setBackupNote] = useState<string | null>(null)
  // Where the app keeps this user's work, and any work stranded in another folder.
  const [activeDir, setActiveDir] = useState('')
  const [stranded, setStranded] = useState<StrandedReport | null>(null)
  const [strandedBusy, setStrandedBusy] = useState(false)
  const [pixabayKey, setPixabayKey] = useState('')
  const [hasPixabay, setHasPixabay] = useState(false)
  const [hardware, setHardware] = useState<HardwareReport | null>(null)
  const [aiErrors, setAiErrors] = useState<AiErrorEntry[]>([])
  const [aiErrBusy, setAiErrBusy] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      setDemucsCmd(s.demucsCmd || '')
      setFaceAnimCmd(s.faceAnimCmd || '')
      setYtChannel(s.youtubeChannelId || '')
    })
    checkOllama()
    void window.api.webServer.status().then(adoptWebStatus)
    window.api.ai.getConfig().then((c) => {
      setAiCloudEndpoint(c.cloudEndpoint)
      setAiCloudModel(c.cloudModel)
      setAiLocalEndpoint(c.localEndpoint)
      setAiHasCloudKey(c.hasCloudKey)
      setAiLocalKind(c.localKind)
      setAiComfyWorkflow(c.comfyWorkflowPath)
      setAiFreeProvider(c.freeCloudProvider)
      setAiFreeModel(c.freeCloudModel)
      setAiPollinModel(c.pollinationsModel)
      setAiHasPollinKey(c.hasPollinationsKey)
      setAiFreeCap(c.freeCloudSceneCap)
    })
    // Live pill for the free-cloud video tier (reachability only; sign-in happens at build time).
    window.api.ai
      .engineStatus()
      .then((s) => setAiFreeStatus({ ok: s.freeCloudAvailable, detail: s.freeCloudDetail }))
      .catch(() => {})
    window.api.backups.status().then(setBackupInfo).catch(() => {})
    window.api.dataHome.activeDir().then(setActiveDir).catch(() => {})
    window.api.dataHome.strandedScan().then(setStranded).catch(() => {})
    window.api.stock.getConfig().then((c) => setHasPixabay(c.hasPixabay))
    window.api.voice.piperStatus().then((s) => setPiperInstalled(s.installed))
    window.api.voice.piperCatalogue().then(setPiperVoices)
    window.api.voice.winNaturalList().then(setWinVoices)
    void loadAiErrors()
    window.api.hardware.check().then(setHardware).catch(() => {})
  }, [])

  async function loadAiErrors(): Promise<void> {
    setAiErrBusy(true)
    try {
      setAiErrors(await window.api.aiErrors.list(50))
    } finally {
      setAiErrBusy(false)
    }
  }

  async function saveYtChannel(): Promise<void> {
    await window.api.settings.setYouTubeChannel(ytChannel.trim())
    setStatus('YouTube channel saved — Publish will open your upload page.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function downloadPiper(voiceId: string): Promise<void> {
    setPiperBusyId(voiceId)
    setPiperMsg('Starting…')
    const unsub = window.api.voice.onPiperProgress((stage) => setPiperMsg(stage))
    try {
      await window.api.voice.piperDownload(voiceId)
      const [status, catalogue] = await Promise.all([window.api.voice.piperStatus(), window.api.voice.piperCatalogue()])
      setPiperInstalled(status.installed)
      setPiperVoices(catalogue)
      setPiperMsg('Voice installed ✓')
    } catch (err) {
      setPiperMsg(err instanceof Error ? err.message : 'Install failed')
    } finally {
      unsub()
      setPiperBusyId(null)
    }
  }

  /** Picking a voice also selects it as the active Piper voice for narration. */
  async function applyPiperVoice(voiceId: string): Promise<void> {
    const s = await window.api.settings.setPiperVoice(voiceId)
    setSettings(s)
  }

  async function saveStockKey(): Promise<void> {
    // The input is always empty on load (keys are never echoed back), so an
    // unguarded save wiped the stored key from disk while announcing success.
    if (!pixabayKey.trim()) {
      setStatus('Paste your Pixabay key into the box first — the saved key was not changed.')
      setTimeout(() => setStatus(null), 3500)
      return
    }
    const r = await window.api.stock.setKey('pixabay', pixabayKey.trim())
    setHasPixabay(r.hasPixabay)
    setPixabayKey('')
    setStatus('Stock footage key saved.')
    setTimeout(() => setStatus(null), 2500)
  }

  async function saveAiConfig(): Promise<void> {
    await window.api.ai.setConfig({
      cloudEndpoint: aiCloudEndpoint || undefined,
      cloudModel: aiCloudModel || undefined,
      localEndpoint: aiLocalEndpoint || undefined,
      localKind: aiLocalKind,
      comfyWorkflowPath: aiComfyWorkflow || undefined,
      freeCloudProvider: aiFreeProvider,
      freeCloudModel: aiFreeModel || undefined,
      pollinationsModel: aiPollinModel || undefined,
      freeCloudSceneCap: Math.min(30, Math.max(1, Math.round(aiFreeCap) || 5)),
      ...(aiCloudKey ? { cloudApiKey: aiCloudKey } : {}),
      ...(aiPollinKey ? { pollinationsKey: aiPollinKey } : {})
    })
    setAiCloudKey('')
    setAiHasCloudKey(aiHasCloudKey || !!aiCloudKey)
    setAiHasPollinKey(aiHasPollinKey || !!aiPollinKey)
    setAiPollinKey('')
    setStatus('AI Video settings saved.')
    setTimeout(() => setStatus(null), 2500)
  }

  /** Copies videos out of a data folder the app isn't using. Never moves or deletes. */
  async function bringStrandedIn(): Promise<void> {
    setStrandedBusy(true)
    try {
      const r = await window.api.dataHome.strandedImport()
      setStranded(await window.api.dataHome.strandedScan())
      toast(
        r.imported
          ? `Brought in ${r.imported} video(s) — they're in Video Studio now. The other folder was left untouched.`
          : 'Nothing new to bring in.',
        r.imported ? 'success' : 'info'
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not bring those videos in.', 'error')
    } finally {
      setStrandedBusy(false)
    }
  }

  async function backupNow(): Promise<void> {
    setBackupBusy('backup')
    setBackupNote(null)
    try {
      const r = await window.api.backups.runNow()
      setBackupNote(
        r.failed
          ? `Backup finished with ${r.failed} FAILED file(s) — see the Activity Log.${r.secondNote}`
          : `Backup done — ${r.copied} new/changed file(s), ${r.unchanged} already safe.${r.secondNote}`
      )
    } finally {
      setBackupBusy(null)
    }
  }

  async function restoreFromBackup(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Restore missing files from backup?',
      message:
        'Anything in the backup that is MISSING from your work folder will be copied back. Nothing you currently have is touched or overwritten.',
      confirmLabel: 'Restore'
    })
    if (!ok) return
    setBackupBusy('restore')
    setBackupNote(null)
    try {
      const r = await window.api.backups.restore()
      setBackupNote(
        r.ok
          ? `Restore done — ${r.copied} missing file(s) brought back, ${r.unchanged} were already present.`
          : (r.error ?? 'Restore failed.')
      )
    } finally {
      setBackupBusy(null)
    }
  }

  async function cleanOrphans(): Promise<void> {
    setBackupBusy('orphans')
    setBackupNote(null)
    try {
      const scan = await window.api.backups.orphans()
      if (scan.count === 0) {
        setBackupNote('No ghosts — your backup only contains things that still exist in the app.')
        return
      }
      const ok = await confirmDialog({
        title: `Remove ${scan.count} ghost file(s) (~${scan.mb} MB)?`,
        message:
          'These are backup copies of things you deleted in the app BEFORE delete-sync existed. Removing them makes those deletions final, everywhere. This cannot be undone.',
        confirmLabel: 'Remove them for good',
        danger: true
      })
      if (!ok) return
      const r = await window.api.backups.cleanOrphans()
      setBackupNote(`Removed ${r.removed} ghost file(s), freeing ~${r.mb} MB.`)
    } finally {
      setBackupBusy(null)
    }
  }

  async function setBackupOptions(opts: { secondDir?: string; purgeOnDelete?: boolean }): Promise<void> {
    await window.api.backups.setOptions(opts)
    setBackupInfo(await window.api.backups.status())
  }

  async function pickSecondBackupDir(): Promise<void> {
    const r = await window.api.backups.pickSecondDir()
    if (r.picked) setBackupInfo(await window.api.backups.status())
  }

  /** Tests the typed (or saved) Pollinations key without spending any Pollen. */
  async function testPollinationsKey(): Promise<void> {
    setAiPollinTest('Testing…')
    const r = await window.api.ai.testPollinationsKey(aiPollinKey.trim() || undefined)
    setAiPollinTest(r.detail)
  }

  /**
   * Renders a QR for every reachable address. Scanning beats typing a link that
   * carries a long secret token, and with a VPN installed there is more than one
   * address — showing them all is what stops the user picking the wrong network.
   */
  async function adoptWebStatus(s: { url: string | null; addresses?: WebServerAddress[] }): Promise<void> {
    setWebUrl(s.url)
    const list = s.addresses ?? []
    setWebAddresses(list)
    const codes: Record<string, string> = {}
    for (const a of list) {
      try {
        codes[a.address] = await QRCode.toDataURL(a.url, { margin: 1, width: 220 })
      } catch {
        // A missing code is cosmetic — the link itself is still shown.
      }
    }
    setQrCodes(codes)
  }

  async function toggleWebServer(): Promise<void> {
    setWebBusy(true)
    try {
      const s = webUrl ? await window.api.webServer.stop() : await window.api.webServer.start()
      await adoptWebStatus(s)
    } catch (err) {
      // Without this the button stayed disabled on "Working…" until app restart.
      setStatus(err instanceof Error ? err.message : 'Could not switch phone access — try again.')
      setTimeout(() => setStatus(null), 4000)
    } finally {
      setWebBusy(false)
    }
  }

  async function checkOllama(): Promise<void> {
    setCheckingOllama(true)
    try {
      setOllamaStatus(await window.api.settings.ollamaStatus())
    } finally {
      setCheckingOllama(false)
    }
  }

  /** Live test of every dependency — including whether saved keys are ACCEPTED. */
  async function runLiveHealth(): Promise<void> {
    setHealthBusy(true)
    try {
      setHealth(await window.api.health.run())
    } finally {
      setHealthBusy(false)
    }
  }

  async function refresh(): Promise<void> {
    setSettings(await window.api.settings.get())
  }

  /**
   * Used ONLY by the walkthrough, which can save the channel id itself.
   *
   * The channel box has to follow when the walkthrough writes it, or it keeps showing the
   * old value and the save looks like it failed. But doing that inside `refresh()` was
   * wrong: every Save button on this page calls refresh(), so typing a channel id and then
   * saving anything else silently wiped what had been typed.
   */
  async function refreshIncludingChannel(): Promise<void> {
    const s = await window.api.settings.get()
    setSettings(s)
    setYtChannel(s.youtubeChannelId || '')
  }

  /**
   * Arrive at #youtube-setup and land ON the walkthrough, not at the top of a very long
   * page. "Scroll down until you see it" is exactly the kind of half-step this page is
   * supposed to be removing.
   */
  useEffect(() => {
    if (window.location.hash !== '#youtube-setup') return
    // After paint, or the element is not on the page yet to scroll to.
    const t = setTimeout(() => document.getElementById('youtube-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => clearTimeout(t)
  }, [])

  /** The main process saves AND registers with Windows; re-read so the checkbox reflects
   * what was actually stored rather than what was clicked. */
  async function setStartWithWindows(on: boolean): Promise<void> {
    await window.api.settings.setStartWithWindows(on)
    await refresh()
  }

  async function handleSetModel(provider: LLMProviderId, model: string): Promise<void> {
    setSettings(await window.api.settings.setModel(provider, model))
  }

  async function handleSaveKey(provider: 'anthropic' | 'openai'): Promise<void> {
    const key = provider === 'anthropic' ? anthropicKey : openaiKey
    await window.api.settings.setApiKey(provider, key)
    if (provider === 'anthropic') setAnthropicKey('')
    else setOpenaiKey('')
    setStatus(`${providerLabel[provider]} key saved.`)
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveHordeKey(): Promise<void> {
    await window.api.settings.setHordeKey(hordeKey)
    setHordeKey('')
    setStatus('AI Horde key saved — photo scenes will get priority.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveMvsepToken(): Promise<void> {
    await window.api.settings.setMvsepToken(mvsepToken)
    setMvsepToken('')
    setStatus('MVSEP token saved — online music separation is ready.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveDemucsCmd(): Promise<void> {
    await window.api.settings.setDemucsCmd(demucsCmd.trim())
    setStatus('Local Demucs command saved.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  async function handleSaveFaceAnimCmd(): Promise<void> {
    await window.api.settings.setFaceAnimCmd(faceAnimCmd.trim())
    setStatus('Face-animation command saved — the graft mode will use it first.')
    await refresh()
    setTimeout(() => setStatus(null), 2500)
  }

  if (!settings) return <div className="p-8 text-ink-400 text-sm">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Settings</h1>
      <p className="text-ink-400 text-sm mt-1">
        Choose what writes your ideas and scripts. The local option is free and runs entirely on this PC; the API
        options cost a small amount per script but write at higher quality.
      </p>

      {/* What changed — an upgrade is otherwise invisible: the app looks identical after
          one. Sits above health so it is the first thing seen after an update. */}
      {/* Version, stated out loud. FIRST, above everything: after an update the only
          question is "did that work?", and the app used to answer it with silence. */}
      <VersionCard />

      <WhatsNewCard />

      {/* Start with Windows. Default ON. Paired with the silent sign-in update, this is
          what makes "turn the laptop on and the studio is open and already current" true —
          so the explanation says that, rather than just naming the switch. */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings?.startWithWindows ?? true}
            onChange={(e) => void setStartWithWindows(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-gold-500"
          />
          <span>
            <span className="block text-sm text-ink-100 font-medium">Open the studio when Windows starts</span>
            <span className="block text-xs text-ink-400 mt-0.5">
              The studio opens by itself when you turn the laptop on — and because nobody is waiting for it at that
              moment, it also installs any update it finds, quietly, before you start working. Turn this off and you
              open it yourself and choose when to update.
            </span>
            <span className="block text-xs text-ink-500 mt-1">
              It never updates while a render or a queue is running — your work is never interrupted.
            </span>
          </span>
        </label>
      </div>

      {/* Setup health — at-a-glance readiness of every subsystem. */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-ink-100 font-medium">Setup health</div>
          <button
            onClick={() => void runLiveHealth()}
            disabled={healthBusy}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
            title="Actually tests every service live — including whether your saved API keys are ACCEPTED, not just saved"
          >
            {healthBusy ? 'Testing…' : '🩺 Run full check'}
          </button>
        </div>
        {health && (
          <div className="mb-3 rounded-md border border-ink-800 bg-ink-950 p-3">
            <div className="text-[11px] text-ink-400 mb-1.5">
              Live test · {new Date(health.checkedAt).toLocaleTimeString()} ·{' '}
              {health.failCount === 0 && health.warnCount === 0
                ? 'everything working ✓'
                : `${health.failCount} problem${health.failCount === 1 ? '' : 's'}, ${health.warnCount} note${health.warnCount === 1 ? '' : 's'}`}
            </div>
            <div className="space-y-1 text-xs">
              {health.checks.map((c) => (
                <div key={c.name} className="flex items-start gap-2">
                  <span className={c.status === 'ok' ? 'text-emerald-400' : c.status === 'warn' ? 'text-amber-400' : 'text-red-400'}>
                    {c.status === 'ok' ? '●' : c.status === 'warn' ? '○' : '✗'}
                  </span>
                  <span className="text-ink-300 shrink-0">{c.name}</span>
                  <span className={`ml-auto text-right ${c.status === 'fail' ? 'text-red-300' : 'text-ink-500'}`}>{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
          {[
            {
              label: 'AI brain',
              // Deliberately reports only what is CONFIGURED — a saved key can still be
              // rejected. "Run full check" above is the authority on whether it works.
              ok: settings.activeProvider === 'free' || (settings.activeProvider === 'ollama' ? !!ollamaStatus?.connected : settings.activeProvider === 'anthropic' ? settings.hasAnthropicKey : settings.hasOpenAIKey),
              note:
                settings.activeProvider === 'free'
                  ? 'Free (online)'
                  : `${settings.activeProvider} — configured; run the check to confirm`
            },
            { label: 'Photo scenes', ok: true, note: 'built-in key — needs internet (free queue)' },
            { label: 'Online music removal', ok: true, note: 'built-in token — needs internet (free queue)' },
            { label: 'Natural voice', ok: piperInstalled, note: piperInstalled ? 'installed' : 'optional — not installed' },
            { label: 'Local music separation', ok: !!settings.demucsCmd, note: settings.demucsCmd ? 'ready' : 'optional — not set up' },
            { label: 'YouTube channel', ok: !!settings.youtubeChannelId, note: settings.youtubeChannelId ? 'set' : 'not set' }
          ].map((h) => (
            <div key={h.label} className="flex items-center gap-2">
              <span className={h.ok ? 'text-emerald-400' : 'text-amber-400'}>{h.ok ? '●' : '○'}</span>
              <span className="text-ink-300">{h.label}</span>
              <span className="text-ink-600 ml-auto truncate">{h.note}</span>
            </div>
          ))}
        </div>
        {hardware && (
          <div className="mt-2 rounded-md border border-ink-800 bg-ink-950 p-2">
            <div className="text-[11px] text-ink-300">Graphics card</div>
            <div className="text-[10px] text-ink-500 mt-0.5">{hardware.summary}</div>
            {!hardware.gpu.hasCuda && (
              <div className="text-[10px] text-amber-400/90 mt-1">
                AI motion-video and talking-photo models need a dedicated NVIDIA card. Photo slideshow, stock footage,
                voices, music, trimming and captions all work normally.
              </div>
            )}
          </div>
        )}
        <p className="text-[10px] text-ink-600 mt-2">
          This list shows what is SET UP. It cannot tell whether a saved key is accepted — click
          &ldquo;🩺 Run full check&rdquo; above for the live truth. Green = ready. Amber = optional/needs setup.
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div>
          <div className="text-sm text-ink-100 font-medium">Where your work is kept</div>
          <p className="text-[11px] text-ink-500 mt-0.5">
            Everything you make — videos, scripts, library, settings — lives in{' '}
            <span className="text-ink-300 break-all">{activeDir || '…'}</span>
          </p>
        </div>
        {stranded && stranded.videoCount > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <p className="text-[11px] text-amber-200 leading-snug">
              ⚠ Found <span className="font-medium">{stranded.videoCount} finished video(s)</span> ({stranded.size}) that
              Video Studio is not showing you.
              {stranded.inPlace > 0 && (
                <>
                  <br />• {stranded.inPlace} are already in your work folder — the app just lost track of them in its
                  list. Adding them back is instant (nothing is copied).
                </>
              )}
              {stranded.elsewhere > 0 && stranded.dir && (
                <>
                  <br />• {stranded.elsewhere} are in a folder this app no longer uses:{' '}
                  <span className="text-amber-100/80 break-all">{stranded.dir}</span> — those get copied in.
                </>
              )}
            </p>
            <button
              onClick={() => void bringStrandedIn()}
              disabled={strandedBusy}
              className="rounded-md border border-amber-400/60 hover:border-amber-300 disabled:opacity-40 text-amber-100 text-xs px-3 py-1.5"
              title="Lists them in Video Studio. Anything in another folder is COPIED — nothing is ever moved or deleted."
            >
              {strandedBusy ? 'Recovering…' : '⬅ Show these in Video Studio (nothing is deleted)'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div>
          <div className="text-sm text-ink-100 font-medium">Backups</div>
          <p className="text-[11px] text-ink-500 mt-0.5">
            Your work is copied weekly (and on demand) to <span className="text-ink-300">{backupInfo?.root || '…'}</span>.
            Keys and browser data are never included.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void backupNow()}
            disabled={backupBusy !== null}
            className="rounded-md border border-ink-600 hover:border-gold-500 disabled:opacity-40 text-ink-200 text-xs px-3 py-1.5"
          >
            {backupBusy === 'backup' ? 'Backing up…' : '💾 Back up now'}
          </button>
          <button
            onClick={() => void restoreFromBackup()}
            disabled={backupBusy !== null}
            className="rounded-md border border-ink-600 hover:border-gold-500 disabled:opacity-40 text-ink-200 text-xs px-3 py-1.5"
            title="Brings back anything in the backup that is missing from your work folder. Never overwrites existing work."
          >
            {backupBusy === 'restore' ? 'Restoring…' : '↩ Restore missing files from backup'}
          </button>
          <button
            onClick={() => void cleanOrphans()}
            disabled={backupBusy !== null}
            className="rounded-md border border-ink-700 hover:border-amber-500 disabled:opacity-40 text-ink-400 text-xs px-3 py-1.5"
            title="Backup copies of things you deleted in the app before delete-sync existed. You confirm before anything is removed."
          >
            {backupBusy === 'orphans' ? 'Scanning…' : '🧹 Clean deleted-items ghosts'}
          </button>
        </div>
        <label className="flex items-start gap-2 text-[11px] text-ink-300 cursor-pointer">
          <input
            type="checkbox"
            checked={backupInfo?.purgeOnDelete ?? true}
            onChange={(e) => void setBackupOptions({ purgeOnDelete: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <b>Delete-sync:</b> when I permanently delete something in the app, remove its backup copy too — deleted
            means gone for good, everywhere.
          </span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-400 shrink-0">Second backup home (USB / another disk):</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-300">{backupInfo?.secondDir || 'not set — recommended, so a dead disk can never take both copies'}</span>
          <button
            onClick={() => void pickSecondBackupDir()}
            className="shrink-0 rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1"
          >
            Choose…
          </button>
        </div>
        {backupNote && <p className="text-[11px] text-emerald-400">{backupNote}</p>}
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-ink-100 font-medium">Welcome tour</div>
            <p className="text-[11px] text-ink-500 mt-0.5">
              The 60-second orientation shown on first run — replay it any time.
            </p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('npz-show-tour'))}
            className="rounded-md border border-ink-700 hover:border-gold-500 text-ink-300 text-xs px-3 py-1.5 transition-colors"
          >
            ▶ Show the welcome tour
          </button>
        </div>
      </div>

      {/* Known Issues — the AI failure log. Problems used to vanish silently; now every
          failure is recorded with a timestamp and the service's own words. */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-ink-100 font-medium">Known Issues</div>
          <div className="flex gap-2">
            <button
              onClick={() => void loadAiErrors()}
              disabled={aiErrBusy}
              className="rounded-md border border-ink-700 hover:border-ink-500 disabled:opacity-50 text-ink-300 text-xs px-3 py-1.5 transition-colors"
            >
              {aiErrBusy ? 'Reading…' : '↻ Refresh'}
            </button>
            <button
              onClick={() => void window.api.aiErrors.reveal()}
              className="rounded-md border border-ink-700 hover:border-ink-500 text-ink-300 text-xs px-3 py-1.5 transition-colors"
              title="Opens the folder containing ai-errors.log"
            >
              📁 Show log file
            </button>
          </div>
        </div>
        {aiErrors.length === 0 ? (
          <p className="text-xs text-ink-500">
            No AI failures recorded. When something goes wrong with an AI feature, it is logged here with the exact
            time and reason instead of failing silently.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-ink-400 mb-2">
              {aiErrors.length} recent failure{aiErrors.length === 1 ? '' : 's'} — newest first. This is a record, not
              a live alarm; an entry from an hour ago may already be resolved.
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {aiErrors.map((e, i) => (
                <div key={`${e.at}-${i}`} className="rounded-md border border-ink-800 bg-ink-950 p-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-red-400">✗</span>
                    <span className="text-ink-300">{new Date(e.at).toLocaleString()}</span>
                    <span className="text-ink-500">{e.provider}</span>
                    {e.status !== undefined && <span className="text-amber-400">HTTP {e.status}</span>}
                    {e.ms !== undefined && <span className="text-ink-600 ml-auto">{(e.ms / 1000).toFixed(1)}s</span>}
                  </div>
                  <div className="text-xs text-ink-400 mt-1 leading-snug">{e.message}</div>
                  {e.body && <div className="text-[10px] text-ink-600 mt-1 font-mono break-all">{e.body}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <CaretakerCard />

      {/* The switchboard replaced the bare "Active provider" row: same choice, plus an
          honest ON/OFF per brain, so "off" finally means never-contacted. */}
      <AiSwitchboard settings={settings} onChanged={setSettings} />

      <GeminiSetup hasKey={settings.hasGeminiKey} onSaved={refresh} />

      {settings.activeProvider === 'free' && (
        <div className="mt-4 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-4">
          <div className="text-sm text-emerald-300 font-medium">🟢 Free online AI — active</div>
          <p className="text-xs text-ink-300 mt-1 leading-relaxed">
            No API key, no signup, no install — this uses a free hosted AI model and works out of the box
            as long as you have internet. It powers the AI Command panel, Script Writer, Ideas, Advisor and
            the AI Director, and free AI image generation for thumbnails and video visuals. Free services can
            get busy; if a request fails, just try again, or switch to a paid key below for top quality.
          </p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Local (Free, runs on this PC via Ollama)</span>
          {checkingOllama ? (
            <span className="text-xs text-ink-500">Checking…</span>
          ) : ollamaStatus?.connected ? (
            <span className="text-xs text-emerald-400">Ollama running</span>
          ) : (
            <span className="text-xs text-red-400">Ollama not detected</span>
          )}
        </div>

        {!ollamaStatus?.connected && !checkingOllama && (
          <p className="text-xs text-ink-500">
            Install Ollama from ollama.com, open it, then pull a model (e.g. <code>ollama pull llama3.1:8b</code>) in
            a terminal. No account or API key needed — generation just runs slower than the cloud options since it
            uses your own CPU.
          </p>
        )}

        <div>
          <label className="text-xs text-ink-400">Model</label>
          {ollamaStatus?.connected && ollamaStatus.models.length > 0 ? (
            <select
              value={settings.ollamaModel}
              onChange={(e) => handleSetModel('ollama', e.target.value)}
              className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            >
              {ollamaStatus.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={settings.ollamaModel}
              onChange={(e) => handleSetModel('ollama', e.target.value)}
              placeholder="llama3.1:8b"
              className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
          )}
        </div>

        <button
          onClick={checkOllama}
          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors"
        >
          Re-check connection
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Claude (Anthropic)</span>
          <span className={`text-xs ${settings.hasAnthropicKey ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.hasAnthropicKey ? 'Key configured' : 'No key set'}
          </span>
        </div>
        <div>
          <label className="text-xs text-ink-400">Model</label>
          <input
            value={settings.anthropicModel}
            onChange={(e) => handleSetModel('anthropic', e.target.value)}
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-…"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={() => handleSaveKey('anthropic')}
            disabled={!anthropicKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">OpenAI</span>
          <span className={`text-xs ${settings.hasOpenAIKey ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.hasOpenAIKey ? 'Key configured' : 'No key set'}
          </span>
        </div>
        <div>
          <label className="text-xs text-ink-400">Model</label>
          <input
            value={settings.openaiModel}
            onChange={(e) => handleSetModel('openai', e.target.value)}
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder="sk-…"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={() => handleSaveKey('openai')}
            disabled={!openaiKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">YouTube channel (for Publish)</span>
          <span className={`text-xs ${ytChannel ? 'text-emerald-400' : 'text-ink-500'}`}>{ytChannel ? 'Set' : 'Not set'}</span>
        </div>
        <p className="text-xs text-ink-500">
          Your channel ID (starts with “UC…”). The “▶ Publish to YouTube” button on each built video copies the
          AI-written title/description/tags to your clipboard and opens YOUR channel’s upload page so you just drop the
          file in — free, no sign-in, no limits.
        </p>
        <p className="text-xs text-ink-600">
          Don’t know your ID? Nobody does — YouTube hides it. Use “Find my channel” in the Connect YouTube box above
          and type your @name instead; it fills this in for you.
        </p>
        <div className="flex gap-2">
          <input
            value={ytChannel}
            onChange={(e) => setYtChannel(e.target.value)}
            placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={saveYtChannel}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* The walkthrough. The old bare password box lived here and told the user to "get a
          free key from Google Cloud Console", which is not an instruction anybody can
          follow without already knowing the answer. */}
      <YouTubeSetup
        hasKey={settings.hasYouTubeKey}
        savedChannelId={settings.youtubeChannelId || ''}
        onSaved={refreshIncludingChannel}
      />

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">AI Horde key — photo scenes (optional, free)</span>
          <span className={`text-xs ${settings.hasHordeKey ? 'text-emerald-400' : 'text-emerald-400'}`}>
            {settings.hasHordeKey ? 'Your key configured' : 'Built-in key active'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Scene Studio’s “Put me in (photo)” uses the free AI Horde image queue. A free key is already built into this
          app (travels with every copy), so photo scenes work everywhere with priority — no setup. You can paste your
          own free key here to use your own account instead (get one at aihorde.net → Register → copy the API key).
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={hordeKey}
            onChange={(e) => setHordeKey(e.target.value)}
            placeholder="Your free AI Horde API key"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveHordeKey}
            disabled={!hordeKey.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save Key
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Natural narration voices (optional, free)</span>
          <span className={`text-xs ${piperInstalled ? 'text-emerald-400' : 'text-ink-500'}`}>
            {piperInstalled ? 'Active voice ready' : 'No voice installed yet'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Far more natural than the robotic Windows voice — free, offline, and it travels with your data folder.
          Includes real Urdu (Pakistan) voices, which the channel actually needs. Your own recorded voice (🎙 Voice
          studio) is still the best and stays the default; this upgrades the <em>computer</em> voice option. Pick a
          voice, download it once (~20-60 MB), then choose “Natural voice” under a build’s Narration voice.
        </p>
        <div className="space-y-1.5">
          {piperVoices.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-md border border-ink-800 bg-ink-950/60 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
                <input
                  type="radio"
                  name="piperVoice"
                  checked={settings?.piperVoiceId === v.id}
                  disabled={!v.installed}
                  onChange={() => void applyPiperVoice(v.id)}
                  className="accent-gold-500"
                />
                {v.label}
              </label>
              <span className="text-[11px] text-ink-500">{v.language}</span>
              {v.installed ? (
                <span className="text-[11px] text-emerald-400">Installed ✓</span>
              ) : (
                <button
                  onClick={() => void downloadPiper(v.id)}
                  disabled={piperBusyId !== null}
                  className="ml-auto rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                >
                  {piperBusyId === v.id ? 'Installing…' : `Download (~${v.approxMB} MB)`}
                </button>
              )}
            </div>
          ))}
          {piperMsg && <span className="text-[11px] text-ink-400">{piperMsg}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Windows natural voices (free, no download)</span>
          <span className={`text-xs ${winVoices.length ? 'text-emerald-400' : 'text-ink-500'}`}>
            {winVoices.length} found on this PC
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Windows itself ships free natural voices per language you install — including Asad and Uzma for Urdu
          (Pakistan). If none show below, or Urdu is missing, install the language pack (free, one-time) in Windows'
          own Speech settings, then come back and refresh.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void window.api.voice.openSpeechSettings()}
            className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
          >
            Open Windows Speech settings
          </button>
          <button
            onClick={() => window.api.voice.winNaturalList().then(setWinVoices)}
            className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
          >
            Refresh list
          </button>
        </div>
        {winVoices.length > 0 && (
          <ul className="text-xs text-ink-300 space-y-0.5">
            {winVoices.map((v) => (
              <li key={v.id}>
                {v.name} <span className="text-ink-600">({v.language})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-ink-600">
          Pick “Windows natural voice” under a build’s Narration voice to use one of these — no download needed here.
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Music separation — online (free)</span>
          <span className={`text-xs ${settings.hasMvsepToken ? 'text-emerald-400' : 'text-emerald-400'}`}>
            {settings.hasMvsepToken ? 'Your token configured' : 'Built-in token active'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Removes background music from OUTSIDE videos (ones not made in this app) over the internet — no install. A
          free token is already built in (travels with every copy), so it works out of the box. You can paste your own
          free token here (mvsep.com → Register → API) to use your own account/quota instead. Videos you build in the
          app don’t need this; they remove/replace music exactly on their own.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={mvsepToken}
            onChange={(e) => setMvsepToken(e.target.value)}
            placeholder="Your free MVSEP API token"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveMvsepToken}
            disabled={!mvsepToken.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Music separation — local (optional, best quality)</span>
          <span className={`text-xs ${settings.demucsCmd ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.demucsCmd ? 'Command set' : 'Not set up'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Offline, highest quality — needs a one-time install: install Python, then <code>pip install demucs</code>.
          Enter the command to run it (usually just <code>demucs</code>, or a full path). This is the only feature
          that needs an install; everything else stays copy-paste portable.
        </p>
        <div className="flex gap-2">
          <input
            value={demucsCmd}
            onChange={(e) => setDemucsCmd(e.target.value)}
            placeholder="demucs"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveDemucsCmd}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Face animation — local (optional, for the ✨ Living Picture graft)</span>
          <span className={`text-xs ${settings.faceAnimCmd ? 'text-emerald-400' : 'text-ink-500'}`}>
            {settings.faceAnimCmd ? 'Command set' : 'Built-in graft in use'}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          The Living Picture graft works out of the box with the built-in engine. For FULL-quality face
          animation, install a free local tool (e.g. Wav2Lip or SadTalker — Python, one-time, needs a decent
          GPU) and enter its command using <code>{'{photo}'}</code> <code>{'{video}'}</code> <code>{'{audio}'}</code>{' '}
          <code>{'{out}'}</code> placeholders. Example:{' '}
          <code>{'python inference.py --face {photo} --audio {audio} --outfile {out}'}</code>. If the tool fails,
          the build automatically falls back to the built-in graft — a render never breaks.
        </p>
        <div className="flex gap-2">
          <input
            value={faceAnimCmd}
            onChange={(e) => setFaceAnimCmd(e.target.value)}
            placeholder="python inference.py --face {photo} --audio {audio} --outfile {out}"
            className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={handleSaveFaceAnimCmd}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-100 font-medium">Phone access (same Wi-Fi)</span>
          <span className={`text-xs ${webUrl ? 'text-emerald-400' : 'text-ink-500'}`}>{webUrl ? 'On' : 'Off'}</span>
        </div>
        <p className="text-xs text-ink-500">
          Turn this on to open a companion page on your Android phone's browser (same Wi-Fi) and generate ideas,
          write scripts, and chat with the Advisor — your PC does all the work and everything saves to this PC's
          Library. Only works while this app is running and your phone is on the same network.
        </p>
        <p className="text-xs text-ink-500">
          <b className="text-ink-300">Want it to work when you leave the house?</b> Install{' '}
          <b className="text-ink-300">Tailscale</b> (free) on this PC and on your phone and sign into both. Your phone
          then reaches this PC over mobile data as if it were on your home Wi-Fi — nothing is opened to the internet.
          A "Private VPN" link will appear below; use that one when you're out.
        </p>
        <button
          onClick={toggleWebServer}
          disabled={webBusy}
          className={`rounded-md text-sm px-4 py-1.5 transition-colors disabled:opacity-50 ${
            webUrl
              ? 'border border-red-500/60 text-red-300 hover:border-red-400'
              : 'bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium'
          }`}
        >
          {webBusy ? 'Working…' : webUrl ? 'Turn off phone access' : 'Turn on phone access'}
        </button>
        {webUrl && (
          <div className="space-y-2">
            <div className="text-xs text-ink-400">
              Point your phone's camera at a code, or type the link. This PC will not go to sleep while phone
              access is on.
            </div>
            {webAddresses.map((a) => (
              <div key={a.address} className="rounded-md border border-ink-700 bg-ink-800 p-3 flex gap-3 items-start">
                {qrCodes[a.address] && (
                  <img
                    src={qrCodes[a.address]}
                    alt={`QR code for ${a.label}`}
                    className="h-28 w-28 shrink-0 rounded bg-white p-1"
                  />
                )}
                <div className="min-w-0">
                  <div className={`text-xs font-medium ${a.remote ? 'text-emerald-400' : 'text-ink-300'}`}>
                    {a.label}
                    {a.remote && ' ✓'}
                  </div>
                  <div className="text-xs text-gold-400 break-all font-mono mt-1">{a.url}</div>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(a.url)
                      toast('Link copied.', 'success')
                    }}
                    className="mt-2 rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-700"
                  >
                    Copy link
                  </button>
                </div>
              </div>
            ))}
            <div className="text-[11px] text-ink-600">
              Each link includes a private access token — anyone who has the exact link can use it, so don't share
              it or post a screenshot of the code. Turning phone access off invalidates every link immediately.
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-lg font-medium text-ink-100">Stock footage (free, optional)</h2>
        <p className="text-ink-400 text-sm mt-1">
          Add a free Pixabay API key to let the Video Studio pull real B-roll footage matched to your script (online).
          Without it, videos use the built-in animated look. Get a free key at pixabay.com → Join → the key appears at
          pixabay.com/api/docs while logged in.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={pixabayKey}
            onChange={(e) => setPixabayKey(e.target.value)}
            placeholder={hasPixabay ? 'Key saved — type to replace' : 'Pixabay API key'}
            className="flex-1 min-w-[220px] rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={saveStockKey}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium text-sm px-4 py-1.5 transition-colors"
          >
            Save key
          </button>
          {hasPixabay && <span className="text-[11px] text-emerald-400">✓ Pixabay key set</span>}
        </div>
        <p className="text-[10px] text-ink-600 mt-2">
          Pixabay footage is free for commercial use, no attribution required. Your key is stored locally (obfuscated)
          and never leaves your machine except to call Pixabay.
        </p>
      </div>

      <div className="mt-8 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-lg font-medium text-ink-100">AI Video engines (optional)</h2>
        <p className="text-ink-400 text-sm mt-1">
          The free “Style presets” and “Photo slideshow” engines need nothing here and always work. These settings
          power the three REAL-motion engines in the Video Generator: free cloud (no key), your own local GPU, and a
          paid provider. The two free real-motion engines fall back to the slideshow automatically when they can’t
          run; the paid engine stops with a clear error instead (so it never spends your money on a guess).
        </p>

        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-ink-100">🎬 REAL AI video — free cloud (two free routes)</div>
              {aiFreeStatus && (
                <span className={`text-[10px] shrink-0 ${aiFreeStatus.ok ? 'text-emerald-400' : 'text-amber-400/80'}`}>
                  {aiFreeStatus.ok ? '✓ Reachable' : '✗ Unreachable'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-500">
              Real generated motion with no paid subscription — two routes, pick what works for you. Both fall back to
              AI stills automatically when they can’t run, and the build log always says why.
            </p>
            {aiFreeStatus && !aiFreeStatus.ok && <p className="text-[11px] text-amber-400/80">{aiFreeStatus.detail}</p>}
            <div className="flex flex-col gap-1.5">
              <label className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer ${aiFreeProvider === 'pollinations' ? 'border-gold-500 bg-gold-500/5' : 'border-ink-700'}`}>
                <input
                  type="radio"
                  checked={aiFreeProvider === 'pollinations'}
                  onChange={() => setAiFreeProvider('pollinations')}
                  className="mt-0.5"
                />
                <span className="text-[11px] text-ink-300">
                  <b className="text-ink-100">Pollinations — free key, NO phone number.</b> Sign up at{' '}
                  <b>enter.pollinations.ai</b> (GitHub or email), create a key, paste the <b>SECRET (sk_…) one</b>{' '}
                  below. Free Pollen comes from that dashboard’s <b>Quests tab</b> — claim the rewards (they’re
                  retroactive; “Create your first API key” alone pays 0.25 = five 5-second scenes on the default
                  wan-fast model). This is the route to use where Puter’s phone verification doesn’t work.
                </span>
              </label>
              <label className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer ${aiFreeProvider === 'puter' ? 'border-gold-500 bg-gold-500/5' : 'border-ink-700'}`}>
                <input type="radio" checked={aiFreeProvider === 'puter'} onChange={() => setAiFreeProvider('puter')} className="mt-0.5" />
                <span className="text-[11px] text-ink-300">
                  <b className="text-ink-100">Puter (Google Veo) — no key at all.</b> A sign-in window pops up during
                  the first build (may ask again after a restart) and generation draws on that account’s small free
                  monthly allowance. Heads-up: Puter’s verification rejects some countries’ phone numbers — if you
                  can’t finish their sign-up, use the Pollinations route above.
                </span>
              </label>
            </div>
            {aiFreeProvider === 'pollinations' ? (
              <>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={aiPollinKey}
                    onChange={(e) => setAiPollinKey(e.target.value)}
                    placeholder={aiHasPollinKey ? 'Key saved — type to replace' : 'Pollinations SECRET key (sk_…) — pk_ keys often block video'}
                    className="flex-1 rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
                  />
                  <button
                    onClick={() => void testPollinationsKey()}
                    className="rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3"
                    title="Checks the key against your Pollen balance — spends nothing."
                  >
                    Test key
                  </button>
                </div>
                {aiPollinTest && <p className="text-[11px] text-ink-300">{aiPollinTest}</p>}
                <input
                  value={aiPollinModel}
                  onChange={(e) => setAiPollinModel(e.target.value)}
                  placeholder="Video model (default wan-fast — the cheapest)"
                  className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
                />
              </>
            ) : (
              <input
                value={aiFreeModel}
                onChange={(e) => setAiFreeModel(e.target.value)}
                placeholder="Model (default google/veo-3.1-fast)"
                className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            )}
            <label className="flex items-center gap-2 text-[11px] text-ink-400">
              Real-motion scenes per build (rest use AI stills):
              <input
                type="number"
                min={1}
                max={30}
                value={aiFreeCap}
                onChange={(e) => setAiFreeCap(Number(e.target.value))}
                className="w-20 rounded-md bg-ink-900 border border-ink-700 px-2 py-1 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </label>
          </div>

          <div className="rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
            <div className="text-sm text-ink-100">🟢 REAL AI video — local GPU (ComfyUI)</div>
            {hardware && !hardware.gpu.hasCuda ? (
              <div className="rounded-md border border-amber-600/40 bg-amber-950/20 p-2">
                <p className="text-[11px] text-amber-300 font-medium">Requires NVIDIA GPU — not detected on this system</p>
                <p className="text-[11px] text-ink-400 mt-1">
                  This PC has {hardware.gpu.name} — these models cannot run on it, not even slowly. You can still
                  configure everything below now; the engine unlocks by itself the day this PC (or a future one) has a
                  dedicated NVIDIA card.
                </p>
              </div>
            ) : hardware ? (
              <p className="text-[11px] text-emerald-400/90">
                {hardware.gpu.name} ({hardware.gpu.vramGB}GB) detected.
                {(() => {
                  const fits = hardware.models.filter(
                    (m) => m.verdict.canRun && !['sadtalker', 'liveportrait'].includes(m.id)
                  )
                  const best = fits.sort((a, b) => b.minVramGB - a.minVramGB)[0]
                  return best ? ` Recommended model for this card: ${best.label}.` : ''
                })()}
              </p>
            ) : null}
            <p className="text-[11px] text-ink-500">
              Free per video and fully private, on your own graphics card. One-time setup: install{' '}
              <b>ComfyUI</b> (comfy.org), download a video model that fits your card’s memory — 8GB: AnimateDiff or
              Wan 2.1 (1.3B) · 12GB: LTX-Video / LTX-2 · 16GB: <b>LTX-2.3 (recommended)</b> · 24GB+: Wan 2.2 or
              HunyuanVideo 1.5 — then start ComfyUI and the app finds it at the address below.
            </p>
            <div className="flex gap-2">
              <select
                value={aiLocalKind}
                onChange={(e) => setAiLocalKind(e.target.value as 'comfyui' | 'generic')}
                className="rounded-md bg-ink-900 border border-ink-700 px-2 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="comfyui">ComfyUI (recommended)</option>
                <option value="generic">Custom server (legacy /generate contract)</option>
              </select>
              <input
                value={aiLocalEndpoint}
                onChange={(e) => setAiLocalEndpoint(e.target.value)}
                placeholder={aiLocalKind === 'comfyui' ? 'ComfyUI URL (default http://127.0.0.1:8188)' : 'Server URL (default http://127.0.0.1:7860)'}
                className="flex-1 rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </div>
            {aiLocalKind === 'comfyui' && (
              <>
                <input
                  value={aiComfyWorkflow}
                  onChange={(e) => setAiComfyWorkflow(e.target.value)}
                  placeholder="Workflow file path (optional — blank = built-in LTX starter)"
                  className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
                />
                <p className="text-[10px] text-ink-600">
                  The built-in starter workflow targets LTX video models. If your install uses different model files,
                  export YOUR working workflow in ComfyUI via “Save (API format)”, replace the prompt text with{' '}
                  {'{{PROMPT}}'} (also available: {'{{WIDTH}} {{HEIGHT}} {{FRAMES}} {{SEED}}'}), and paste the file’s
                  path here. Swapping to Wan or Hunyuan later is just a different workflow file — no app update needed.
                </p>
              </>
            )}
            {aiLocalKind === 'generic' && (
              <p className="text-[10px] text-ink-600">
                Legacy contract for a server you built yourself: GET /health, POST /generate{' '}
                {'{ prompt, seconds, width, height }'} → video bytes or a URL.
              </p>
            )}
          </div>

          <div className="rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
            <div className="text-sm text-ink-100">💳 Cloud AI footage (paid — your key)</div>
            <p className="text-[11px] text-ink-500">
              Get an API key from a text-to-video provider (e.g. Runway, Pika, Luma, or Replicate). Paste your key and
              the provider’s REST endpoint. Each video costs money on the provider’s side — that’s why it’s not
              “free for life”. Endpoint contract: POST {'{ prompt, seconds, width, height }'} → returns a video URL.
            </p>
            <input
              value={aiCloudEndpoint}
              onChange={(e) => setAiCloudEndpoint(e.target.value)}
              placeholder="Cloud endpoint URL (https://…)"
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
            <input
              value={aiCloudModel}
              onChange={(e) => setAiCloudModel(e.target.value)}
              placeholder="Model name (optional)"
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
            <input
              type="password"
              value={aiCloudKey}
              onChange={(e) => setAiCloudKey(e.target.value)}
              placeholder={aiHasCloudKey ? 'API key saved — type to replace' : 'API key'}
              className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            />
            <p className="text-[10px] text-ink-600">Your key is stored locally, encrypted, and never leaves this PC except to call your provider.</p>
          </div>

          <button
            onClick={saveAiConfig}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium text-sm px-4 py-1.5 transition-colors"
          >
            Save AI Video settings
          </button>
        </div>
      </div>

      {status && <div className="mt-4 text-sm text-emerald-400">{status}</div>}

      <div className="mt-8 text-xs text-ink-600 border-t border-ink-800 pt-4">
        Trend topics still reason from the model's own knowledge (no free live "trending topics" API exists), but
        with a YouTube key set, idea scoring is grounded in real existing videos and view counts for your topic.
      </div>
    </div>
  )
}
