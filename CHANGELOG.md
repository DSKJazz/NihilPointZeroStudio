# Changelog

## 0.1.1 - 2026-08-08

### Ship summary
- Release hardening pass for 0.1.1: current packaging, docs, and release automation were aligned for a consistent desktop and GitHub experience.

### Recent changes
- Updated the shipping workflow to keep the Desktop studio copy, installed app, and GitHub release assets aligned.
- Added a resilient storage fallback for phone/browser environments so the app continues working when browser storage is blocked.
- Fixed update status checks so the app can still determine whether it is current even when GitHub release notes omit the usual build stamp.
