import { useEffect, useState } from 'react'
import { confirmDialog } from './Confirm'
import { toast } from './Toast'

interface Tpl {
  id: string
  name: string
  title: string
  body: string
  createdAt: string
}

/**
 * Reusable script templates: save the current script's structure under a name, and
 * start any new video from it ("hook → context → analysis → takeaway…" in one click).
 * Deleting a template asks first — same rule as every delete in this studio.
 */
export default function TemplatesMenu({
  title,
  body,
  onInsert
}: {
  title: string
  body: string
  onInsert: (title: string, body: string) => void
}): React.JSX.Element {
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api.templates.list().then(setTemplates)
  }, [])

  async function save(): Promise<void> {
    if (!body.trim()) {
      toast('Write or paste a script first — an empty template helps nobody.', 'error')
      return
    }
    setSaving(true)
    try {
      setTemplates(await window.api.templates.save(name.trim() || title.trim() || 'My format', title, body))
      setName('')
      toast('Template saved ✓', 'success')
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: Tpl): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete this template?',
      message: `“${t.name}” will be removed from your templates. Your scripts and videos are not affected.`,
      confirmLabel: 'Delete template'
    })
    if (!ok) return
    setTemplates(await window.api.templates.remove(t.id))
  }

  return (
    <details className="rounded-md border border-ink-700 bg-ink-800/60">
      <summary className="cursor-pointer px-3 py-1.5 text-xs text-gold-400 select-none">
        📐 Templates — start from a saved format ({templates.length})
      </summary>
      <div className="p-3 space-y-2">
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this format (e.g. hook → analysis → takeaway)"
            className="flex-1 rounded-md bg-ink-900 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
          />
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md border border-ink-600 px-2 py-1 text-xs text-ink-300 hover:border-gold-500 disabled:opacity-40"
          >
            Save current as template
          </button>
        </div>
        {templates.length === 0 && (
          <p className="text-[11px] text-ink-500">
            No templates yet. Write a script whose STRUCTURE you want to reuse, then save it here — next time, insert
            it and only swap the facts.
          </p>
        )}
        <div className="space-y-1 max-h-44 overflow-y-auto">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-ink-200">{t.name}</div>
                <div className="truncate text-[10px] text-ink-500">{t.body.slice(0, 90)}</div>
              </div>
              <button
                onClick={() => {
                  onInsert(t.title, t.body)
                  toast(`Template “${t.name}” inserted — replace the facts with today's.`, 'success')
                }}
                className="shrink-0 rounded border border-ink-600 px-2 py-0.5 text-[10px] text-ink-300 hover:border-gold-500"
              >
                Insert
              </button>
              <button
                onClick={() => void remove(t)}
                className="shrink-0 rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-500 hover:border-red-500 hover:text-red-400"
                aria-label={`Delete template ${t.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
