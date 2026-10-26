param([switch]$Open)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskService=Join-Path $taskRoot 'household'
$taskPython=Join-Path $taskService '.venv/Scripts/python.exe'
& (Join-Path $PSScriptRoot 'Stop-Local.ps1')
if(!(Test-Path -LiteralPath $taskPython)) {
    & python -m venv (Join-Path $taskService '.venv')
    & $taskPython -m pip install -r (Join-Path $taskService 'requirements.lock.txt')
    if($LASTEXITCODE -ne 0){throw 'Dependency installation failed'}
}
$taskEnv=Join-Path $taskService '.env.local'
if(!(Test-Path -LiteralPath $taskEnv)) {
    $taskBytes=New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($taskBytes)
    $taskEnrollment=[Convert]::ToBase64String($taskBytes)
    "BOOTSTRAP_TOKEN=$taskEnrollment`nCATALOG_HOST_ALLOWLIST=v3-cinemeta.strem.io,cinemeta-catalogs.strem.io`nENVIRONMENT=development" | Set-Content -LiteralPath $taskEnv -Encoding utf8
    $taskAcl=Get-Acl -LiteralPath $taskEnv
    $taskAcl.SetAccessRuleProtection($true,$false)
    $taskRule=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().Name,'FullControl','Allow')
    $taskAcl.SetAccessRule($taskRule)
    Set-Acl -LiteralPath $taskEnv -AclObject $taskAcl
}
foreach($taskLine in Get-Content -LiteralPath $taskEnv){
    if($taskLine -match '^([A-Z_]+)=(.*)$'){[Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process')}
}
$env:DATABASE_URL='sqlite:///'+(Join-Path $taskService 'household-dev.sqlite').Replace('\','/')
& $taskPython -m alembic -c (Join-Path $taskService 'alembic.ini') upgrade head
if($LASTEXITCODE -ne 0){throw 'Database migration failed'}
$taskApi=Start-Process -FilePath $taskPython -WorkingDirectory $taskService -ArgumentList '-m','uvicorn','service.main:app','--host','127.0.0.1','--port','8765','--no-access-log' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskService 'api.local.log') -RedirectStandardError (Join-Path $taskService 'api-error.local.log')
$taskWorker=Start-Process -FilePath $taskPython -WorkingDirectory $taskService -ArgumentList '-m','service.worker' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskService 'worker.local.log') -RedirectStandardError (Join-Path $taskService 'worker-error.local.log')
@{api=$taskApi.Id;worker=$taskWorker.Id} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskService 'local-processes.json')
Write-Output 'Household development service: http://127.0.0.1:8765'
Write-Output "Enrollment token is protected in $taskEnv. Production requires HTTPS and PostgreSQL."
if($Open){Start-Process ('http://127.0.0.1:8765/#enrollment='+[uri]::EscapeDataString($env:BOOTSTRAP_TOKEN)) -WindowStyle Hidden}
