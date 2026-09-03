@echo off
setlocal EnableExtensions

rem Manual portable package for v0.1.2. This intentionally does not call electron-builder.
set "ROOT=%~dp0.."
set "RELEASE=%ROOT%\release"
set "PACKAGE=%RELEASE%\NIHILPOINTZERO-OS-portable"
set "ELECTRON_DIST=%ROOT%\node_modules\electron\dist"
set "ELECTRON=%ROOT%\node_modules\electron\dist\electron.exe"

if not exist "%ROOT%\out\main\index.js" (
  echo ERROR: %ROOT%\out\main\index.js is missing. Run npm run build first.
  exit /b 1
)
if not exist "%ELECTRON%" (
  echo ERROR: Electron runtime is missing at %ELECTRON%.
  exit /b 1
)

if exist "%PACKAGE%" rmdir /s /q "%PACKAGE%"
if exist "%RELEASE%\NIHILPOINTZERO-OS-portable.zip" del /q "%RELEASE%\NIHILPOINTZERO-OS-portable.zip"
mkdir "%PACKAGE%"

robocopy "%ELECTRON_DIST%" "%PACKAGE%" /e /xf electron.exe /nfl /ndl /njh /njs /np >nul
if errorlevel 8 (
  echo ERROR: Could not copy the complete Electron runtime.
  exit /b 1
)
copy /y "%ELECTRON%" "%PACKAGE%\NIHILPOINTZERO-OS-portable.exe" >nul
xcopy "%ROOT%\out" "%PACKAGE%\resources\app\out\" /e /i /h /y >nul
copy /y "%ROOT%\package.json" "%PACKAGE%\resources\app\package.json" >nul
xcopy "%ROOT%\node_modules" "%PACKAGE%\resources\app\node_modules\" /e /i /h /y >nul
xcopy "%ROOT%\resources" "%PACKAGE%\resources\app\resources\" /e /i /h /y >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%PACKAGE%\*' -DestinationPath '%RELEASE%\NIHILPOINTZERO-OS-portable.zip' -Force"
if errorlevel 1 (
  echo ERROR: Could not create the portable zip.
  exit /b 1
)

echo Manual portable package created:
echo   Folder: %PACKAGE%
echo   Zip:    %RELEASE%\NIHILPOINTZERO-OS-portable.zip
endlocal
