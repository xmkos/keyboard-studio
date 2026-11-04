@echo off
cd /d "%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" server.mjs --open
echo Keyboard Studio stopped. Close this window.
pause
