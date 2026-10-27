# Modo desenvolvimento: backend com auto-reload (porta 8765) + frontend Vite com hot reload (porta 5173).
# Abra http://localhost:5173 no navegador. Ctrl+C encerra os dois.
Set-Location $PSScriptRoot
$backend = Start-Process -PassThru -NoNewWindow .venv\Scripts\python -ArgumentList "-m uvicorn backend.api:app --reload --port 8765"
try {
    Set-Location frontend
    npm run dev
} finally {
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
}
