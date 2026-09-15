@echo off
title Nyashavee School Management System
cd /d "%~dp0"

REM Starts the production stack: app + PostgreSQL + Redis in Docker.
REM Requires Docker Desktop installed and running.

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is not installed. Install Docker Desktop first.
  pause
  exit /b 1
)

echo Starting Nyashavee (production)...
docker compose -f docker-compose.prod.yml up -d
if errorlevel 1 (
  echo Failed to start. Is Docker Desktop running?
  pause
  exit /b 1
)

set PORT=%NYASHAVEE_PORT%
if "%PORT%"=="" set PORT=3000

echo.
echo Nyashavee is starting at http://localhost:%PORT%/
echo First run? Open http://localhost:%PORT%/setup to create the school.
echo.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 12; Start-Process 'http://localhost:%PORT%/'"
pause
