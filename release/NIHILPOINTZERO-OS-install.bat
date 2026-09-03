@echo off
setlocal EnableExtensions

rem NIHILPOINTZERO-OS v0.1.2 non-admin installer.
rem Override NPZ_INSTALL_TARGET in tests or use the default Local AppData target.
set "TARGET=%NPZ_INSTALL_TARGET%"
if not defined TARGET set "TARGET=%LOCALAPPDATA%\NIHILPOINTZERO-OS"
set "GITHUB_URL=https://github.com/DSKJazz/NihilPointZeroStudio/releases/download/v0.1.2/NIHILPOINTZERO-OS-portable.zip"
set "TEMP_ZIP=%TEMP%\nihilpointzero-portable.zip"

if not exist "%TARGET%" mkdir "%TARGET%"
if errorlevel 1 exit /b 1

echo Downloading NIHILPOINTZERO-OS v0.1.2...
curl.exe -L --fail --retry 3 "%GITHUB_URL%" -o "%TEMP_ZIP%"
if errorlevel 1 exit /b 1

where tar.exe >nul 2>nul
if errorlevel 1 exit /b 1

echo Installing to "%TARGET%"...
tar.exe -xf "%TEMP_ZIP%" -C "%TARGET%"
if errorlevel 1 exit /b 1

if not exist "%TARGET%\NIHILPOINTZERO-OS-portable.exe" exit /b 1

set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\NIHILPOINTZERO"
if not exist "%START_MENU%" mkdir "%START_MENU%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $lnk=$ws.CreateShortcut([Environment]::GetFolderPath('StartMenu') + '\Programs\NIHILPOINTZERO\NIHILPOINTZERO-OS.lnk'); $lnk.TargetPath='%TARGET%\NIHILPOINTZERO-OS-portable.exe'; $lnk.WorkingDirectory='%TARGET%'; $lnk.Description='NIHILPOINTZERO-OS v0.1.2'; $lnk.Save()"

if exist "%TEMP_ZIP%" del /q "%TEMP_ZIP%"
echo Installation complete. Launch "%TARGET%\NIHILPOINTZERO-OS-portable.exe".
exit /b 0
