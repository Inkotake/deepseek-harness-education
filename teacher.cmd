@echo off
rem Teacher DSH: PATH-independent entry point for this repository.
rem
rem The machine's Volta installation shims only `dsh` and `playwright`; `node`, `npm`, `yarn` and
rem `corepack` are absent from an interactive shell's PATH, so `corepack yarn ...` fails with
rem "not recognized". This script locates the Volta Node tool image itself and drives Corepack
rem through absolute paths, so it works from any shell without touching system configuration.
rem
rem Usage:
rem   teacher.cmd dev       rebuild the teacher runtime and seed, then launch the app (default)
rem   teacher.cmd seed      rebuild the teacher runtime and the bundled profile seed only
rem   teacher.cmd app       launch the app from source without rebuilding resources
rem   teacher.cmd test      run the headless gates (typecheck, unit tests, source alignment)
rem   teacher.cmd package   build the Windows installer and the portable archive
rem   teacher.cmd where     print the resolved Node and Corepack paths

setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%" || (echo Teacher DSH: cannot enter "%ROOT%" & exit /b 1)

set "NODE_EXE="
set "COREPACK_JS="

rem 1. Preferred: a Volta Node tool image that carries its own Corepack.
for /d %%D in ("%LOCALAPPDATA%\Volta\tools\image\node\*") do (
  if exist "%%D\node.exe" (
    if exist "%%D\node_modules\corepack\dist\corepack.js" (
      set "NODE_EXE=%%D\node.exe"
      set "COREPACK_JS=%%D\node_modules\corepack\dist\corepack.js"
    )
  )
)

rem 2. Fallback: whatever PATH resolves to.
if not defined NODE_EXE (
  for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
)
if not defined COREPACK_JS (
  for /f "delims=" %%C in ('where corepack 2^>nul') do if not defined COREPACK_JS set "COREPACK_JS=%%C"
)

if not defined NODE_EXE (
  echo Teacher DSH: Node.js was not found.
  echo   Install it, or run this script from a shell where `node` resolves.
  exit /b 1
)
if not defined COREPACK_JS (
  echo Teacher DSH: Corepack was not found next to Node and not on PATH.
  echo   Node was resolved to: %NODE_EXE%
  exit /b 1
)

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=dev"

rem Corepack must not prompt about downloading the pinned Yarn release in an unattended run.
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"

if /i "%ACTION%"=="where" goto :where
if /i "%ACTION%"=="seed" goto :seed
if /i "%ACTION%"=="app" goto :app
if /i "%ACTION%"=="test" goto :test
if /i "%ACTION%"=="package" goto :package
if /i "%ACTION%"=="dev" goto :dev

echo Teacher DSH: unknown action "%~1".
echo   Use one of: dev ^| seed ^| app ^| test ^| package ^| where
exit /b 1

:where
echo node     : %NODE_EXE%
echo corepack : %COREPACK_JS%
echo repo     : %ROOT%
exit /b 0

:seed
echo ==^> rebuilding the teacher runtime
"%NODE_EXE%" scripts\teacher\build-teacher-runtime.mjs || exit /b 1
echo ==^> rebuilding the bundled profile seed
"%NODE_EXE%" scripts\teacher\build-profile-seed.mjs || exit /b 1
exit /b 0

:app
echo ==^> launching Teacher DSH from source
"%NODE_EXE%" "%COREPACK_JS%" yarn workspace dsh-plugin-desktop dev || exit /b 1
exit /b 0

:dev
call "%~f0" seed || exit /b 1
call "%~f0" app || exit /b 1
exit /b 0

:test
echo ==^> typecheck
"%NODE_EXE%" "%COREPACK_JS%" yarn typecheck || exit /b 1
echo ==^> unit tests
"%NODE_EXE%" "%COREPACK_JS%" yarn workspace dsh-plugin-desktop test || exit /b 1
echo ==^> desktop variant alignment
"%NODE_EXE%" scripts\verify-desktop-variants.mjs || exit /b 1
echo ==^> version-pinned patches match their declared edits
"%NODE_EXE%" scripts\teacher\port-patches.mjs --check || exit /b 1
exit /b 0

:package
echo ==^> Windows installer
"%NODE_EXE%" "%COREPACK_JS%" yarn workspace dsh-plugin-desktop dist:win || exit /b 1
echo ==^> portable archive
"%NODE_EXE%" "%COREPACK_JS%" yarn workspace dsh-plugin-desktop dist:win-portable || exit /b 1
echo ==^> smoke checks
"%NODE_EXE%" scripts\teacher\smoke-package.mjs || exit /b 1
exit /b 0
