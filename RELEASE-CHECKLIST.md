# NIHILPOINTZERO-OS Release Checklist

Use this checklist for every Windows release. A release is ready only when all required checks pass.

## 1. Source and Version

- [x] Working tree reviewed; unrelated changes are excluded.
- [x] Version updated consistently in `package.json` and release metadata.
- [ ] Changelog updated with user-visible changes and known limitations.
- [x] Release branch is based on the intended `main` revision.

## 2. Automated Quality Gates

- [x] `npm ci` completes on a clean environment.
- [x] `npm run test` passes with no test failures.
- [x] `npm run lint` completes with zero errors.
- [x] Relevant TypeScript checks pass.
- [x] CI runs the same commands and blocks release on failure.

## 3. Windows Packaging

- [x] `npm run dist:win` completes on Windows.
- [x] Portable artifact opens on a clean Windows profile.
- [x] Required executable, DLL, and resource files are present.
- [x] Portable artifact hash is recorded in the release notes or checksums.
- [x] Installer downloads the matching portable artifact over HTTPS.
- [x] Installer succeeds without administrator elevation.
- [x] Start Menu shortcut is created and verified in an isolated target.
- [x] Uninstaller removes application files and shortcuts in an isolated target.
- [x] A second install/update does not leave stale staging directories.

## 4. Updater Validation

- [x] Updater resolves the current release asset name.
- [x] Updater rejects incomplete, non-HTTPS, or missing assets.
- [x] A real installed-app update from v0.1.2 to published v0.1.3 has been tested.
- [x] The application quits only when it is safe to replace installed files.
- [x] Deferred updates retain the downloaded installer for retry.
- [x] Update failure is visible to the user and leaves the existing install usable.

## 5. GitHub Release

- [x] Release tag and version match the packaged application.
- [x] Release notes include changes, requirements, installation, update, uninstall, and troubleshooting details.
- [x] All expected assets are uploaded and downloadable.
- [x] `latest.yml` points to the intended v0.1.3 portable asset.
- [x] ZIP size and SHA-256 were verified after upload.
- [x] Published release was reviewed after upload.

## 6. Security and Support

- [x] No secrets, private keys, tokens, or local paths are included in artifacts or notes.
- [x] Dependencies have been reviewed for important security updates on the migration branch; `npm audit --audit-level=high` reports zero vulnerabilities.
- [x] Code signing status is documented.
- [x] Known SmartScreen, network, permissions, and disk-space limitations are documented.
- [x] Support or issue-reporting link is present.
- [x] Scheduled dependency audit workflow is present.
- [x] Post-release asset verification workflow is present.

## 7. Sign-off

- [x] CI run URL: PR #370 checks, all 7 successful
- [x] Release URL: https://github.com/DSKJazz/NihilPointZeroStudio/releases/tag/v0.1.3
- [x] Tested application version: v0.1.2 -> v0.1.3
- [x] Tester: repository owner authorized release validation
- [x] Date: 2026-09-03
- [x] Release owner approval: confirmed in task authorization

## Validation Evidence

- Full migration suite: 1,693 passed, 1 skipped.
- Updater lifecycle suite: 49 passed.
- Release/updater focused suite: 64 passed.
- v0.1.2 isolated install: exit 0; executable, app bundle, and shortcut present.
- v0.1.3 isolated update: exit 0; app.asar present; staging removed; shortcut present.
- v0.1.3 isolated uninstall: exit 0; target and shortcut directory removed.
- Published ZIP: 465,516,753 bytes.
- Published ZIP SHA-256: `d57a1db04c741cceb6b3f9836106f0bfc615f975ba83018b79e312911c125a25`.
- Remaining follow-up: merge the validated migration branch after review; code signing still requires a certificate; GitHub Actions upload-artifact PR #382 still requires a `workflow`-scoped credential.
