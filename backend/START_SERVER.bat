@echo off
title PDF to EPUB Backend Server
color 0A
echo ========================================
echo   PDF to EPUB Converter - Backend Server
echo ========================================
echo.

cd /d "%~dp0"

echo Checking dependencies...
if not exist "node_modules" (
    echo [WARNING] node_modules not found!
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
)

echo Starting server on port 8081...
echo.
echo If you see errors below, check:
echo   1. MySQL is running
echo   2. Database 'epub_db' exists
echo   3. .env file has correct database credentials
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

node server.js

if errorlevel 1 (
    echo.
    echo [ERROR] Server failed to start!
    echo Check the error messages above.
    pause
)






