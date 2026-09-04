# Changelog

## Unreleased

### Runtime-aware production workflow
- Carry requested runtime through analysis narration and storyboard generation so scripts and shot lists do not collapse into short summaries.
- Preserve creator instructions, language, style, and Pakistan-specific visual direction through storyboard planning and autosave.
- Add multi-file analysis imports with partial-error reporting.
- Add direct Script, Storyboard, Scene Studio, and Video Studio draft handoffs.
- Remove tracked local audit exports and archive the stale workshop copy outside the repository.

## 0.1.1 - 2026-08-08

### Ship summary
- Release hardening pass for 0.1.1: current packaging, docs, and release automation were aligned for a consistent desktop and GitHub experience.

### Recent changes
- Updated the shipping workflow to keep the Desktop studio copy, installed app, and GitHub release assets aligned.
- Added a resilient storage fallback for phone/browser environments so the app continues working when browser storage is blocked.
- Fixed update status checks so the app can still determine whether it is current even when GitHub release notes omit the usual build stamp.
