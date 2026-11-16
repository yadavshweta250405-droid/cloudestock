@echo off
cd /d "%~dp0\.."
node scripts\check-node.mjs || exit /b 1
if not exist .env copy .env.example .env >nul
npm run dev
