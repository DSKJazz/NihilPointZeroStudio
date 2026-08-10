/**
 * The Storyboard Director core now lives in `src/shared/storyboard.ts`.
 *
 * It moved because it is genuinely shared: the phone app plans storyboards with the
 * very same functions, and `src/shared/project.ts` validates incoming phone plans
 * with `sanitizeStoryboard`. The code itself is unchanged — it always was pure, with
 * no node or electron imports, which is exactly what made the phone app possible.
 *
 * This file stays as a re-export so every existing importer
 * (`from '../video/storyboard'`, `from './storyboard'`) keeps working untouched.
 */
export {
  sanitizeStoryboard,
  storyboardDuration,
  beatStartTimes,
  compileStoryboardToTimeline,
  storyboardFromScript,
  buildStoryboardPrompt
} from '../../shared/storyboard'

export type { ResolvedBeatSound, ResolvedBeatAsset } from '../../shared/storyboard'
