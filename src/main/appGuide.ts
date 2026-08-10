/**
 * The app manual moved to `src/shared/appGuide.ts`.
 *
 * It is plain text with no imports, and it is now read by three places: the main
 * process (for the Expert's AI answers), the renderer (for the Expert's INSTANT mode,
 * which searches it offline) and the tests. `shared/` is where all three can reach it.
 *
 * This re-export keeps every existing importer working unchanged.
 */
export { APP_GUIDE } from '../shared/appGuide'
