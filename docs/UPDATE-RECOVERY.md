# Update Recovery

Use this procedure when an update fails or the application will not start after an update.

## Protect the Existing Data

1. Close NIHILPOINTZERO-OS and any render or voice process.
2. Do not delete `%APPDATA%\finscript-studio` or the portable `nihilpointzero-data` folder.
3. Copy the data folder to a separate backup location before manual recovery.

## Retry Safely

1. Confirm at least 2 GB of free disk space. The installer downloads and stages the package before replacing the target.
2. Run `NIHILPOINTZERO-OS-install.bat` again.
3. If the installer reports checksum, download, or extraction failure, keep the existing installation and save the displayed error.
4. Remove only a leftover `<install-folder>.staging` directory after confirming no installer process is running.

## Roll Back the Installed App

The installed update path keeps one previous `resources\app.asar.previous` file when the runtime is unchanged.

1. Close the application.
2. Rename the current `resources\app.asar` to `app.asar.failed`.
3. Rename `resources\app.asar.previous` to `app.asar`.
4. Start the application and confirm the build badge.

If the Windows runtime changed, do not mix runtime DLLs from different releases. Re-run the matching release installer instead.

## Last Resort

1. Run the matching release uninstaller.
2. Reinstall from the GitHub release page.
3. Restore or select the preserved data folder only after the application starts successfully.
4. Report the release tag, Windows version, installer exit code, and sanitized logs. Never include API keys or phone-access links.
