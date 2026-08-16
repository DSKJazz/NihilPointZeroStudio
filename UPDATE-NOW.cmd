@echo off
setlocal
:: Move to repo root (the script is placed at the repo root)
cd /d "%~dp0"
necho === UPDATE-NOW: Pulling latest from origin/main ===
:: Check for uncommitted changesngit status --porcelain > .git-status.tmp
for /f "usebackq delims=" %%i in (`type .git-status.tmp`) do set STAGED=1
if defined STAGED (
  echo There are uncommitted changes that will block an automatic update.
  echo Please commit or stash them first, or run this script from a clean working copy.
  echo The following files are uncommitted:
  type .git-status.tmp
  del .git-status.tmp
  exit /b 1
)
del .git-status.tmp 2>nul
necho Fetching and merging origin/main...
git fetch origin mainngit pull origin mainnif errorlevel 1 (
  echo git pull failed. Resolve the error and run UPDATE-NOW.cmd again.
  exit /b 1
)
necho === Installing dependencies ===
npm installnif errorlevel 1 (
  echo npm install failed. Resolve dependency issues and run UPDATE-NOW.cmd again.
  exit /b 1
)
necho === Building distributables (this may take several minutes) ===
npm run dist:winnif errorlevel 1 (
  echo Build failed. See the console output above for details.
  exit /b 1
)
necho === Build complete ===necho Files placed in the release\ directory:necho  - release\NIHILPOINTZERO-OS-portable.exenecho  - release\NIHILPOINTZERO-OS-setup.exenechonecho Installer (NSIS) will replace the installed app when run; the portable exe must be manually replaced if you want to use it in-place.nechonecho To update the installed app automatically: open the app and use its updater or run the installer shown above.necho Done.
endlocal
exit /b 0
