@echo off
setlocal EnableExtensions

echo.
echo === NIHILPOINTZERO-OS v0.1.2 RELEASE VALIDATION ===
echo.

REM Test 1: Portable extraction
echo [1] Testing portable zip...
set "TESTDIR=%TEMP%\val-portable-%RANDOM%"
mkdir "%TESTDIR%" >nul
cd /d "%TESTDIR%"
gh release download v0.1.2 --repo DSKJazz/NihilPointZeroStudio --pattern "*portable*.zip" 2>nul
if exist NIHILPOINTZERO-OS-portable.zip (
  tar -xf NIHILPOINTZERO-OS-portable.zip >nul 2>&1
  if exist NIHILPOINTZERO-OS-portable.exe (
    echo     OK: Portable zip extracted
  ) else (
    echo     FAIL: Extraction did not produce exe
  )
) else (
  echo     FAIL: Portable zip not downloaded
)
cd /d "C:\Users\Shoaib Khan\NihilPointZeroStudio-workshop"
rmdir /s /q "%TESTDIR%" >nul 2>&1

REM Test 2: Batch installer
echo [2] Testing batch installer...
set "TESTDIR=%TEMP%\val-install-%RANDOM%"
mkdir "%TESTDIR%" >nul
set "NPZ_INSTALL_TARGET=%TESTDIR%"
call release\NIHILPOINTZERO-OS-install.bat >nul 2>&1
if exist "%TESTDIR%\NIHILPOINTZERO-OS-portable.exe" (
  echo     OK: Installer completed
) else (
  echo     FAIL: Installer did not create exe
)

REM Test 3: Batch uninstaller
echo [3] Testing batch uninstaller...
call release\NIHILPOINTZERO-OS-uninstall.bat >nul 2>&1
if not exist "%TESTDIR%\NIHILPOINTZERO-OS-portable.exe" (
  echo     OK: Uninstaller removed app
) else (
  echo     FAIL: Uninstaller did not remove app
)
rmdir /s /q "%TESTDIR%" >nul 2>&1

REM Test 4: Release assets
echo [4] Checking release assets...
gh release view v0.1.2 --repo DSKJazz/NihilPointZeroStudio | findstr "asset:" >nul
if %ERRORLEVEL% equ 0 (
  echo     OK: Release assets exist
) else (
  echo     FAIL: No release assets found
)

REM Test 5: Tests pass
echo [5] Running tests...
call npm run test -- --reporter=silent >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo     OK: All tests pass
) else (
  echo     WARN: Tests have failures
)

echo.
echo === VALIDATION COMPLETE ===
echo.
exit /b 0
