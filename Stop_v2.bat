@echo off
title Stop SQL Scripts Manager
echo Stopping SQL Scripts Manager server on port 3000...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo Done! Server stopped.
ping 127.0.0.1 -n 2 >nul
exit /b 0
