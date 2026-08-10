@echo off
rem ============================================================
rem  NIHILPOINTZERO STUDIO - one-click backup of ALL your work
rem  Copies nihilpointzero-data (videos, scripts, settings) to
rem  C:\Users\<you>\NihilPointZero-Backups. It only ADDS/UPDATES -
rem  it never deletes anything, in either folder.
rem  TIP: for real safety, also copy that backup folder to a
rem  USB stick or cloud drive now and then - a backup on the
rem  same disk cannot survive a disk failure. (You can also set a
rem  second backup home inside the app: Settings -> Backups.)
rem  (Run this from the studio folder, next to nihilpointzero-data.)
rem ============================================================
set SRC=%~dp0nihilpointzero-data
set DST=%USERPROFILE%\NihilPointZero-Backups\nihilpointzero-data
if not exist "%SRC%" (
  echo Could not find "%SRC%".
  echo Put this file in your NihilPointZeroStudio folder, next to nihilpointzero-data.
  echo.
  pause
  exit /b 1
)
echo Backing up your studio work...
echo   from: %SRC%
echo   to:   %DST%
rem /XF and /XD deliberately EXCLUDE your API keys (settings.json, stock.json,
rem ai-video.json) and the app's browser-profile data. The backup folder may end up
rem cloud-synced, and in the portable copy the saved keys are reversible - they must
rem not leave the studio folder.
robocopy "%SRC%" "%DST%" /E /R:2 /W:5 /NP ^
  /XF settings.json stock.json ai-video.json "Local State" Preferences ^
  /XD "Local Storage" "Session Storage" Network Cache "Code Cache" GPUCache ^
     DawnGraphiteCache DawnWebGPUCache blob_storage "Shared Dictionary" SharedStorage DIPS piper
if %ERRORLEVEL% LEQ 7 (
  echo.
  echo  BACKUP OK - your work is copied to %DST%
  echo  (API keys and browser data are intentionally NOT copied, for safety.)
) else (
  echo.
  echo  BACKUP HAD ERRORS - scroll up for details.
)
echo.
pause
