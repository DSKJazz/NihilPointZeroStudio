import { useEffect, useState } from 'react'
import type { GeneratedScript, LibraryEntry, SavedImage, VideoIdea } from '../../../shared/types'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import { fileUrl } from '../../../shared/mediaUrl'

type Filter = 'all' | 'idea' | 'script' | 'image' | 'trash'

function entryTitle(entry: LibraryEntry): string {
  return (entry.data as { title: string }).title || entry.kind
}

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [selected, setSelected] = useState<LibraryEntry | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.library
      .list()
      .then(setEntries)
      .catch(() => toast('Could not load your Library — try reopening this tab.', 'error'))
      // finally, not then: a failed load used to show "Loading…" forever.
      .finally(() => setLoading(false))
  }, [])

  const trashCount = entries.filter((e) => e.trashedAt).length
  const visible =
    filter === 'trash'
      ? entries.filter((e) => e.trashedAt)
      : entries.filter((e) => !e.trashedAt && (filter === 'all' || e.kind === filter))

  function applyUpdate(updated: LibraryEntry[], keepSelection = false): void {
    setEntries(updated)
    if (!keepSelection) setSelected(null)
  }

  // Every mutation is wrapped: after the user confirms a destructive action, a
  // failed write must SAY so — silence is indistinguishable from a broken button.
  async function tryUpdate(run: () => Promise<LibraryEntry[]>, okMsg: string, okTone: 'info' | 'success'): Promise<void> {
    try {
      applyUpdate(await run())
      toast(okMsg, okTone)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That change could not be saved — try again.', 'error')
    }
  }

  /** Reversible: only moves the item into the Trash Can. */
  async function handleTrash(id: string): Promise<void> {
    await tryUpdate(() => window.api.library.remove(id), 'Moved to Trash — restore it any time from the Trash view', 'info')
  }

  async function handleRestore(id: string): Promise<void> {
    await tryUpdate(() => window.api.library.restore(id), 'Restored', 'success')
  }

  async function handleDeleteForever(id: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete forever?',
      message: 'This permanently removes the item from your library. This cannot be undone.',
      danger: true
    })
    if (!ok) return
    await tryUpdate(() => window.api.library.removeForever(id), 'Deleted forever', 'info')
  }

  async function handleEmptyTrash(): Promise<void> {
    const ok = await confirmDialog({
      title: `Empty Trash (${trashCount} item${trashCount === 1 ? '' : 's'})?`,
      message: 'Everything in the Trash is permanently removed. This cannot be undone.',
      danger: true
    })
    if (!ok) return
    await tryUpdate(() => window.api.library.emptyTrash(), 'Trash emptied', 'info')
  }

  async function handleExport(entry: LibraryEntry): Promise<void> {
    if (entry.kind !== 'script') return
    const script = entry.data as GeneratedScript
    const fileName = `${script.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`
    try {
      const res = await window.api.exportText(fileName, `${script.title}\n\n${script.body}`)
      if (res.saved) toast(`Exported to ${res.path}`, 'success')
      else if (res.error) toast(`Export failed: ${res.error}`, 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    }
  }

  async function handleSaveImageCopy(entry: LibraryEntry): Promise<void> {
    if (entry.kind !== 'image') return
    const img = entry.data as SavedImage
    const res = await window.api.scene.saveImage(img.path, `${img.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'image'}.jpg`)
    if (res.saved) toast(`Saved to ${res.path}`, 'success')
    else if (res.error) toast(`Save failed: ${res.error}`, 'error')
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'idea', label: 'Ideas' },
    { key: 'script', label: 'Scripts' },
    { key: 'image', label: 'Images' },
    { key: 'trash', label: `🗑 Trash${trashCount ? ` (${trashCount})` : ''}` }
  ]

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Library</h1>
      <p className="text-ink-400 text-sm mt-1">
        Everything you save — and every picture the studio generates — stored locally on this machine.
        Deleting only moves items to the Trash; only you can empty it.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilter(f.key)
              setSelected(null)
            }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === f.key
                ? 'border-gold-500 bg-ink-800 text-gold-300'
                : 'border-ink-700 bg-ink-900 text-ink-400 hover:border-ink-500'
            }`}
          >
            {f.label}
          </button>
        ))}
        {filter === 'trash' && trashCount > 0 && (
          <button
            onClick={handleEmptyTrash}
            className="ml-auto rounded-md border border-red-500/40 text-red-300 hover:border-red-400 text-xs px-3 py-1 transition-colors"
          >
            Empty Trash…
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-6 text-ink-400 text-sm">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-ink-600 text-sm">
          {filter === 'trash' ? 'The Trash is empty.' : 'Nothing saved here yet.'}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {visible.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelected(entry)}
                className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                  selected?.id === entry.id
                    ? 'border-gold-500 bg-ink-800 text-ink-100'
                    : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-500'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{entryTitle(entry)}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-500">{entry.kind}</span>
                </div>
                <div className="text-[11px] text-ink-600 mt-0.5">
                  {new Date(entry.savedAt).toLocaleString()}
                  {entry.kind === 'image' && ` · ${(entry.data as SavedImage).source}`}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selected ? (
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
                {selected.kind === 'idea' ? (
                  <IdeaDetail idea={selected.data as VideoIdea} />
                ) : selected.kind === 'script' ? (
                  <ScriptDetail script={selected.data as GeneratedScript} />
                ) : (
                  <ImageDetail image={selected.data as SavedImage} />
                )}
                <div className="flex flex-wrap gap-2 mt-4">
                  {selected.kind === 'script' && (
                    <button
                      onClick={() => handleExport(selected)}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors"
                    >
                      Export .txt
                    </button>
                  )}
                  {selected.kind === 'image' && (
                    <button
                      onClick={() => handleSaveImageCopy(selected)}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors"
                    >
                      ⬇ Save a copy…
                    </button>
                  )}
                  {selected.trashedAt ? (
                    <>
                      <button
                        onClick={() => handleRestore(selected.id)}
                        className="rounded-md border border-emerald-500/50 text-emerald-300 hover:border-emerald-400 text-sm px-4 py-1.5 transition-colors"
                      >
                        ♻ Restore
                      </button>
                      <button
                        onClick={() => handleDeleteForever(selected.id)}
                        className="rounded-md border border-red-500/40 text-red-300 hover:border-red-400 text-sm px-4 py-1.5 transition-colors"
                      >
                        Delete forever…
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleTrash(selected.id)}
                      className="rounded-md border border-red-500/40 text-red-300 hover:border-red-400 text-sm px-4 py-1.5 transition-colors"
                    >
                      🗑 Move to Trash
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-ink-700 h-full min-h-[300px] flex items-center justify-center text-ink-600 text-sm">
                Select an item to view details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function IdeaDetail({ idea }: { idea: VideoIdea }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-medium text-ink-100">{idea.title}</h2>
      <p className="text-sm text-ink-400 italic">&ldquo;{idea.hook}&rdquo;</p>
      <p className="text-sm text-ink-200">{idea.angle}</p>
      <p className="text-xs text-ink-400 border-l-2 border-gold-500/40 pl-2">{idea.viewPotentialReason}</p>
      <div className="text-xs text-ink-400">
        Score {idea.viewPotentialScore}/10 · {idea.competitionLevel} competition · {idea.suggestedLength}
      </div>
    </div>
  )
}

function ScriptDetail({ script }: { script: GeneratedScript }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium text-ink-100">{script.title}</h2>
        <div className="text-xs text-ink-400 shrink-0 text-right">
          {script.estimatedWordCount} words · ~{script.estimatedDurationMinutes} min
        </div>
      </div>
      <pre className="mt-3 whitespace-pre-wrap font-serif text-sm text-ink-200 leading-relaxed max-h-[500px] overflow-y-auto">
        {script.body}
      </pre>
    </div>
  )
}

function ImageDetail({ image }: { image: SavedImage }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium text-ink-100 break-words">{image.title}</h2>
        <span className="text-xs text-ink-400 shrink-0">{image.source}</span>
      </div>
      <img
        src={fileUrl(image.path)}
        alt={image.title}
        className="mt-3 w-full max-w-2xl rounded border border-ink-800 bg-ink-950"
      />
    </div>
  )
}
