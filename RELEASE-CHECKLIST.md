# NIHILPOINTZERO-OS Release Checklist

Use this checklist for every Windows release. A release is ready only when all required checks pass.

## 1. Source and Version

- [ ] Working tree reviewed; unrelated changes are excluded.
- [ ] Version updated consistently in `package.json` and release metadata.
- [ ] Changelog updated with user-visible changes and known limitations.
- [ ] Release branch is based on the intended `main` revision.

## 2. Automated Quality Gates

- [ ] `npm ci` completes on a clean environment.
- [ ] `npm run test` passes with no test failures.
- [ ] `npm run lint` completes with zero errors.
- [ ] Relevant TypeScript checks pass.
- [ ] CI runs the same commands and blocks release on failure.

## 3. Windows Packaging

- [ ] `npm run dist:win` completes on Windows.
- [ ] Portable artifact opens on a clean Windows profile.
- [ ] Required executable, DLL, and resource files are present.
- [ ] Portable artifact hash is recorded in the release notes or checksums.
- [ ] Installer downloads the matching portable artifact over HTTPS.
- [ ] Installer succeeds without administrator elevation.
- [ ] Start Menu shortcut is created and launches the application.
- [ ] Uninstaller removes application files and shortcuts.
- [ ] A second install/update does not leave stale staging directories.

## 4. Updater Validation

- [ ] Updater resolves the current release asset name.
- [ ] Updater rejects incomplete, non-HTTPS, or missing assets.
- [ ] A real installed-app update has been tested against a published release.
- [ ] The application quits only when it is safe to replace installed files.
- [ ] Deferred updates retain the downloaded installer for retry.
- [ ] Update failure is visible to the user and leaves the existing install usable.

## 5. GitHub Release

- [ ] Release tag and version match the packaged application.
- [ ] Release notes include changes, requirements, installation, update, uninstall, and troubleshooting details.
- [ ] All expected assets are uploaded and downloadable.
- [ ] `latest.yml` points to the intended release assets.
- [ ] Asset hashes are verified after upload.
- [ ] Draft release is reviewed before publication.

## 6. Security and Support

- [ ] No secrets, private keys, tokens, or local paths are included in artifacts or notes.
- [ ] Dependencies have been reviewed for important security updates.
- [ ] Code signing status is documented.
- [ ] Known SmartScreen, network, permissions, and disk-space limitations are documented.
- [ ] Support or issue-reporting link is present.

## 7. Sign-off

- [ ] CI run URL: ______________________________
- [ ] Release URL: _____________________________
- [ ] Tested application version: ______________
- [ ] Tester: __________________________________
- [ ] Date: ____________________________________
- [ ] Release owner approval: ___________________
