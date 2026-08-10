/**
 * Upload metadata in both languages, with the language codes right.
 *
 * YouTube shows each viewer the title and description matching their own interface
 * language. On a channel written half in Roman Urdu that is not a nicety — it decides
 * whether a title lands or is skipped.
 *
 * The one thing it will not do is translate. Publishing an unchecked machine translation
 * on a channel whose product is credibility is worse than publishing one language, so it
 * labels what has been written, checks the limits that truncate silently, and says which
 * language is still missing.
 */
import { useMemo, useState } from 'react'
import { LANGUAGE_NAMES, pasteBlock, planDualLanguage, type UploadLanguage } from '../../../shared/dualLanguage'

export default function DualLanguagePanel({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element | null {
  const [otherTitle, setOtherTitle] = useState('')
  const [otherDescription, setOtherDescription] = useState('')
  const [tagText, setTagText] = useState('')
  const [copied, setCopied] = useState(false)

  const plan = useMemo(
    () =>
      planDualLanguage({
        entries: [
          { title, description },
          { title: otherTitle, description: otherDescription }
        ],
        tags: tagText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      }),
    [title, description, otherTitle, otherDescription, tagText]
  )

  if (!title.trim() && !description.trim()) return null

  const block = pasteBlock(plan)

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-ink-100 font-medium">Upload in both languages</div>
        {block && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(block)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            {copied ? 'Copied' : 'Copy for YouTube'}
          </button>
        )}
      </div>

      <p className="text-xs text-ink-400">{plan.headline}</p>

      <div className="mt-3 space-y-2">
        {plan.localizations.map((l) => (
          <div key={l.language} className="rounded-md border border-ink-800 bg-ink-950 p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] text-gold-500 font-medium">{LANGUAGE_NAMES[l.language]}</span>
              {/* The CODE, because "Roman Urdu" is not in YouTube's dropdown — ur-Latn is. */}
              <code className="text-[11px] text-ink-500">{l.language}</code>
              {plan.defaultLanguage === l.language && (
                <span className="text-[11px] text-ink-500">· set this as the video's language</span>
              )}
            </div>
            <div className="text-xs text-ink-200">{l.title}</div>
            {l.problems.map((p) => (
              <div key={p} className="text-[11px] text-amber-300 mt-1">
                {p}
              </div>
            ))}
          </div>
        ))}
      </div>

      {plan.missing.length > 0 && (
        <div className="mt-3 rounded-md border border-ink-800 bg-ink-950 p-2.5">
          <div className="text-[11px] text-ink-400 mb-1.5">
            Not written yet: {plan.missing.map((m: UploadLanguage) => LANGUAGE_NAMES[m]).join(', ')}. Type one here and it
            will be labelled automatically — nothing is translated for you, because an unchecked translation on your
            channel is worse than one language.
          </div>
          <input
            value={otherTitle}
            onChange={(e) => setOtherTitle(e.target.value)}
            placeholder="Title in the other language"
            className="w-full rounded-md bg-ink-900 border border-ink-700 text-ink-200 text-xs px-2 py-1.5 mb-1.5"
          />
          <textarea
            value={otherDescription}
            onChange={(e) => setOtherDescription(e.target.value)}
            placeholder="Description in the other language"
            rows={3}
            className="w-full rounded-md bg-ink-900 border border-ink-700 text-ink-200 text-xs px-2 py-1.5"
          />
        </div>
      )}

      <div className="mt-2">
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="Tags, comma separated — put both scripts in: mehngai, مہنگائی, inflation"
          className="w-full rounded-md bg-ink-950 border border-ink-700 text-ink-200 text-xs px-2 py-1.5"
        />
        {plan.tags.length > 0 && (
          <div className="text-[11px] text-ink-600 mt-1">
            {plan.tags.length} tags, {plan.tags.join(', ').length} of 500 characters
            {plan.droppedTags.length > 0 && ` · no room for: ${plan.droppedTags.join(', ')}`}
          </div>
        )}
      </div>
    </div>
  )
}
