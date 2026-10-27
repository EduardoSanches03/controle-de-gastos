# Gera o executável e instala o Controle de Gastos no Windows
# (pasta em %LOCALAPPDATA%\Programs + atalhos na Área de Trabalho e no Menu Iniciar).
# Uso: powershell -ExecutionPolicy Bypass -File instalar.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/4 Dependências Python..." -ForegroundColor Cyan
if (-not (Test-Path ".venv")) { python -m venv .venv }
& .venv\Scripts\python -m pip install -q -r requirements.txt

Write-Host "2/4 Build do frontend (React)..." -ForegroundColor Cyan
Push-Location frontend
if (-not (Test-Path "node_modules")) { npm install --silent }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Falha no build do frontend" }
Pop-Location

Write-Host "3/4 Gerando executável..." -ForegroundColor Cyan
& .venv\Scripts\python tools\gerar_icone.py
& .venv\Scripts\pyinstaller --noconfirm --clean --windowed --name ControleDeGastos --icon icon.ico `
    --add-data "frontend\dist;frontend\dist" --collect-submodules uvicorn app.py
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o executável" }

Write-Host "4/4 Instalando..." -ForegroundColor Cyan
$destino = Join-Path $env:LOCALAPPDATA "Programs\ControleDeGastos"
Get-Process ControleDeGastos -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
Copy-Item "dist\ControleDeGastos" $destino -Recurse

$exe = Join-Path $destino "ControleDeGastos.exe"
$shell = New-Object -ComObject WScript.Shell
$atalhos = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Controle de Gastos.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Controle de Gastos.lnk")
)
foreach ($lnk in $atalhos) {
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $destino
    $s.IconLocation = "$exe,0"
    $s.Description = "Controle de Gastos"
    $s.Save()
}
Write-Host "Instalado em $destino" -ForegroundColor Green
Write-Host "Atalhos criados na Área de Trabalho e no Menu Iniciar." -ForegroundColor Green
Write-Host "Seus dados ficam em $env:APPDATA\ControleDeGastos\gastos.db"
