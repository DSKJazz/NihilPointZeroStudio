@echo off
setlocal EnableExtensions

rem NIHILPOINTZERO-OS v0.1.2 non-admin installer.
rem Override NPZ_INSTALL_TARGET in tests or use the default Local AppData target.
set "TARGET=%NPZ_INSTALL_TARGET%"
if not defined TARGET set "TARGET=%LOCALAPPDATA%\NIHILPOINTZERO-OS"
set "STAGE=%TARGET%.staging"
set "GITHUB_URL=https://github.com/DSKJazz/NihilPointZeroStudio/releases/download/v0.1.2/NIHILPOINTZERO-OS-portable.zip"
set "TEMP_ZIP=%TEMP%\NIHILPOINTZERO-OS-portable-%RANDOM%.zip"
set "EXPECTED_SHA256=9c744ed28128a937ba15208640448b3d010699b68183c1f4f3953a51bc8c1a76"

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%" || exit /b 1

echo Downloading NIHILPOINTZERO-OS v0.1.2...
curl.exe -L --fail --retry 3 "%GITHUB_URL%" -o "%TEMP_ZIP%"
if errorlevel 1 exit /b 1

where tar.exe >nul 2>nul
if errorlevel 1 exit /b 1

echo Installing to "%TARGET%"...
tar.exe -xf "%TEMP_ZIP%" -C "%STAGE%"
if errorlevel 1 exit /b 1

if not exist "%STAGE%\NIHILPOINTZERO-OS-portable.exe" exit /b 1
if not exist "%STAGE%\icudtl.dat" exit /b 1
if not exist "%STAGE%\resources\app\out\main\index.js" exit /b 1
if exist "%TARGET%" rmdir /s /q "%TARGET%"
move "%STAGE%" "%TARGET%" || exit /b 1

set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\NIHILPOINTZERO"
if not exist "%START_MENU%" mkdir "%START_MENU%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $lnk=$ws.CreateShortcut([Environment]::GetFolderPath('StartMenu') + '\Programs\NIHILPOINTZERO\NIHILPOINTZERO-OS.lnk'); $lnk.TargetPath='%TARGET%\NIHILPOINTZERO-OS-portable.exe'; $lnk.WorkingDirectory='%TARGET%'; $lnk.Description='NIHILPOINTZERO-OS v0.1.2'; $lnk.Save()"

if exist "%TEMP_ZIP%" del /q "%TEMP_ZIP%"
echo Installation complete. Launch "%TARGET%\NIHILPOINTZERO-OS-portable.exe".
exit /b 0
