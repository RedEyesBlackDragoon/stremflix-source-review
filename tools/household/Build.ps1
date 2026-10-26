param([switch]$SkipTests)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskOut=Join-Path $taskRoot 'artifacts/household-dev'
New-Item -ItemType Directory -Force -Path $taskOut | Out-Null
Push-Location $taskRoot
try {
    & household/.venv/Scripts/python -m alembic -c household/alembic.ini upgrade head
    if($LASTEXITCODE -ne 0){throw 'Migration failed'}
    if(!$SkipTests) {
        & household/.venv/Scripts/python -m pytest household/tests -q --junitxml=docs/household/backend-tests.xml
        if($LASTEXITCODE -ne 0){throw 'Backend tests failed'}
    }
    Push-Location app
    try {
        & npm.cmd ci
        if($LASTEXITCODE -ne 0){throw 'npm ci failed'}
        & npm.cmd run dist
        if($LASTEXITCODE -ne 0){throw 'TypeScript build failed'}
        if(!$SkipTests){& npx.cmd playwright test; if($LASTEXITCODE -ne 0){throw 'Client tests failed'}}
        & npm.cmd run build:win:x64 -- --publish never
        if($LASTEXITCODE -ne 0){throw 'Windows build failed'}
    } finally { Pop-Location }
    Push-Location tv
    try { & ./gradlew.bat assembleDebug --console=plain; if($LASTEXITCODE -ne 0){throw 'Android build failed'} } finally {Pop-Location}
    Copy-Item -LiteralPath tv/app/build/outputs/apk/debug/app-debug.apk -Destination (Join-Path $taskOut 'dxbi-household-dev-android.apk')
    Copy-Item app/release-builds/dxbi-household-dev-*.exe -Destination $taskOut
    Get-ChildItem -LiteralPath $taskOut -File | Get-FileHash -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  $([IO.Path]::GetFileName($_.Path))" } | Set-Content -LiteralPath (Join-Path $taskOut 'SHA256SUMS.txt')
} finally {Pop-Location}
