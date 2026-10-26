param([switch]$TestDevice)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskOut=Join-Path $taskRoot 'artifacts/household-tv-local'
Push-Location (Join-Path $taskRoot 'tv')
try {
    $taskTargets=@('assembleDebug','lintDebug')
    if($TestDevice){$taskTargets+='connectedDebugAndroidTest'}
    & ./gradlew.bat @taskTargets --console=plain
    if($LASTEXITCODE -ne 0){throw 'Android TV build or validation failed'}
    New-Item -ItemType Directory -Force -Path $taskOut | Out-Null
    $taskApk=Join-Path $taskOut 'dxbi-household-tv-local-0.1.9.apk'
    Copy-Item -LiteralPath 'app/build/outputs/apk/debug/app-debug.apk' -Destination $taskApk
    $taskHash=Get-FileHash -LiteralPath $taskApk -Algorithm SHA256
    "$($taskHash.Hash)  $([IO.Path]::GetFileName($taskHash.Path))" | Set-Content -LiteralPath (Join-Path $taskOut 'SHA256SUMS.txt')
    Write-Output $taskApk
} finally {Pop-Location}
