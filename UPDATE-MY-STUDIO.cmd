@echo off
setlocal enabledelayedexpansion
title Updating NIHILPOINTZERO-OS
color 0E

REM ============================================================================
REM  UPDATE MY STUDIO  --  double-click this file. That is the whole procedure.
REM
REM  WHY THIS FILE EXISTS
REM  Everything the studio needs to update itself was already automatic except the
REM  last step, which was "open a terminal and type npm run ship". That is not a
REM  step for somebody who does not code, and telling them to do it anyway is how
REM  a laptop ends up three builds behind while everything else is current.
REM  So: one file, double-clicked, no typing.
REM
REM  WHAT IT DOES, IN ORDER
REM    1. checks the tools it needs are actually there, and says which is missing
REM    2. fetches the newest code
REM    3. installs anything new that code needs
REM    4. runs the real ship script, which builds, copies to the Desktop studio
REM       folder, updates the installed app in place, and pushes
REM
REM  WHAT IT WILL NEVER DO
REM  Touch nihilpointzero-data. That folder is the user's videos, scripts and
REM  settings, and nothing in this file goes near it. If a step fails it stops and
REM  says so rather than carrying on and leaving things half-updated.
REM ============================================================================

cd /d "%~dp0"

echo.
echo  ================================================================
echo    UPDATING YOUR STUDIO
echo    This takes about 5-10 minutes. You can leave it running.
echo  ================================================================
echo.
echo  Working in: %CD%
echo.

REM --- Step 0: are the tools here? Say WHICH one is missing, not "an error". ---
where git >nul 2>nul
if errorlevel 1 (
  echo  [X] Git is not installed on this PC.
  echo.
  echo      Install it once from https://git-scm.com/download/win
  echo      Click through the installer with all the default choices.
  echo      Then double-click this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed on this PC.
  echo.
  echo      Install it once from https://nodejs.org  ^(the green "LTS" button^)
  echo      Click through the installer with all the default choices.
  echo      Then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "scripts\ship.ps1" (
  echo  [X] This file is not in the studio's code folder.
  echo.
  echo      It has to sit next to the "scripts" folder and package.json,
  echo      in the folder called NihilPointZeroStudio-workshop.
  echo      Move it there and double-click it again.
  echo.
  pause
  exit /b 1
)

echo  [1/4] Tools found. Good.
echo.

REM --- Step 1: newest code. --------------------------------------------------
echo  [2/4] Getting the newest version of the code...
call git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo  [X] Could not get the newest code.
  echo.
  echo      Usually this means either no internet, or you have your own
  echo      unsaved changes in this folder that would be overwritten.
  echo      Nothing has been changed. Tell Claude what this screen says.
  echo.
  pause
  exit /b 1
)
echo.

REM --- Step 2: dependencies. -------------------------------------------------
echo  [3/4] Installing anything new that the code needs...
echo        ^(this is the slow part - a few minutes is normal^)
call npm install
if errorlevel 1 (
  echo.
  echo  [X] Could not install what the code needs.
  echo      Nothing has been shipped. Tell Claude what this screen says.
  echo.
  pause
  exit /b 1
)
echo.

REM --- Step 3: the real thing. ------------------------------------------------
REM ship.ps1 already refuses to ship unless the tests pass and the automated
REM click-through of the interface succeeds, so there is no need to repeat those
REM checks here - and repeating them would only double the wait.
echo  [4/4] Building and updating everything...
echo        ^(tests, then the app, then your Desktop folder, then GitHub^)
echo.
call npm run ship
if errorlevel 1 (
  echo.
  echo  ================================================================
  echo    IT DID NOT FINISH
  echo  ================================================================
  echo.
  echo    Your existing studio and all your work are untouched - this
  echo    stops rather than leaving things half-updated.
  echo.
  echo    Scroll up to the first red line and tell Claude what it says.
  echo.
  pause
  exit /b 1
)

echo.
echo  ================================================================
echo    DONE. Your studio is up to date.
echo  ================================================================
echo.
echo    NOTHING ELSE TO DO. The installed app was refreshed in place.
echo.
echo    If it still says an update is available when you open it, just
echo    press "Get the update" on the blue notice - the app downloads
echo    and installs it by itself. You never need to hunt for a file.
echo.
echo    Then open the app and look at Settings - "What changed" tells
echo    you what is new in the version you are now running.
echo.
pause
