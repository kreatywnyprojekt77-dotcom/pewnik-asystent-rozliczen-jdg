@echo off
setlocal
set "APP_DIR=%~dp0"
set "APP_PORT=8765"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %APP_PORT%; $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if (-not $listener) { Start-Process -FilePath 'node' -ArgumentList 'scripts/serve.mjs','%APP_PORT%' -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden }"

timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:%APP_PORT%/index.html"
endlocal
