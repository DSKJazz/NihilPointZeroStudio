@echo off
setlocal EnableExtensions

rem NIHILPOINTZERO-OS v0.1.3 non-admin installer.
rem Override NPZ_INSTALL_TARGET in tests or use the default Local AppData target.
set "TARGET=%NPZ_INSTALL_TARGET%"
if not defined TARGET set "TARGET=%LOCALAPPDATA%\NIHILPOINTZERO-OS"
set "STAGE=%TARGET%.staging"
set "GITHUB_URL=https://github.com/DSKJazz/NihilPointZeroStudio/releases/download/v0.1.3/NIHILPOINTZERO-OS-portable.zip"
set "TEMP_ZIP=%TEMP%\NIHILPOINTZERO-OS-portable-%RANDOM%.zip"
set "EXPECTED_SHA256=602717e3c18eb5d568a593e74d84df2771a7b1f9cfa6af89fa0ca21c2abf7e8d"

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%" || exit /b 1

echo Downloading NIHILPOINTZERO-OS v0.1.3...
curl.exe -L --fail --retry 3 "%GITHUB_URL%" -o "%TEMP_ZIP%" || exit /b 1
for /f "tokens=*" %%H in ('powershell.exe -NoProfile -Command "(Get-FileHash -LiteralPath '%TEMP_ZIP%' -Algorithm SHA256).Hash"') do set "ACTUAL_SHA256=%%H"
if /i not "%ACTUAL_SHA256%"=="%EXPECTED_SHA256%" (
	echo Download checksum verification failed.
	if exist "%TEMP_ZIP%" del /q "%TEMP_ZIP%"
	exit /b 1
)

where tar.exe >nul 2>nul || exit /b 1
echo Installing to "%TARGET%"...
tar.exe -xf "%TEMP_ZIP%" -C "%STAGE%" || exit /b 1

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
