# Gera o APK do app Android (ControleDeGastos.apk na pasta do projeto).
# Usa o Java e o SDK que vêm com o Android Studio.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$env:JAVA_HOME = "$env:ProgramFiles\Android\Android Studio\jbr"
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }

Push-Location frontend
try {
    npm run build
    if ($LASTEXITCODE) { throw 'Falha no build do frontend' }
    npx cap sync android
    if ($LASTEXITCODE) { throw 'Falha no cap sync' }
    Push-Location android
    try {
        .\gradlew.bat assembleDebug
        if ($LASTEXITCODE) { throw 'Falha no Gradle' }
    } finally { Pop-Location }
} finally { Pop-Location }

Copy-Item frontend\android\app\build\outputs\apk\debug\app-debug.apk ControleDeGastos.apk -Force
Write-Host "APK gerado: $PSScriptRoot\ControleDeGastos.apk"
