$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskService=Join-Path $taskRoot 'household'
$taskRecord=Join-Path $taskService 'local-processes.json'
if(!(Test-Path -LiteralPath $taskRecord)){return}
$taskPython=[IO.Path]::GetFullPath((Join-Path $taskService '.venv/Scripts/python.exe'))
$taskProcesses=Get-Content -LiteralPath $taskRecord -Raw | ConvertFrom-Json
foreach($taskEntry in @(@{id=$taskProcesses.api;module='service.main:app'},@{id=$taskProcesses.worker;module='service.worker'})) {
    $taskProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$taskEntry.id)"
    if(!$taskProcess){continue}
    if(![String]::Equals($taskProcess.ExecutablePath,$taskPython,[StringComparison]::OrdinalIgnoreCase) -or
        !$taskProcess.CommandLine.Contains($taskEntry.module)) {throw 'Recorded PID no longer belongs to this Household service; it was not stopped.'}
    foreach($taskChild in Get-CimInstance Win32_Process -Filter "ParentProcessId=$([int]$taskEntry.id)") {
        if($taskChild.CommandLine -and $taskChild.CommandLine.Contains($taskEntry.module)) {
            Stop-Process -Id $taskChild.ProcessId -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Id ([int]$taskEntry.id) -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $taskRecord
