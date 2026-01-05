@echo off
echo Starting PDF to EPUB Converter Backend Server...
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting server on port 8081...
echo Press Ctrl+C to stop the server
echo.

node server.js

pause






