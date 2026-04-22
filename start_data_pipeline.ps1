param(
    [string]$RepoPath = $PSScriptRoot,
    [string]$PythonExe = (Join-Path $PSScriptRoot ".venv\Scripts\python.exe"),
    [string]$CsvPath = "arduino_data.csv",
    [int]$PushIntervalSeconds = 300
)

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message"
}

if (-not (Test-Path -Path $RepoPath -PathType Container)) {
    Write-Error "Repository path does not exist: $RepoPath"
    exit 1
}

if (-not (Test-Path -Path $PythonExe -PathType Leaf)) {
    Write-Error "Python executable not found: $PythonExe"
    exit 1
}

$autoPushScript = Join-Path $RepoPath "auto_push_csv.ps1"
if (-not (Test-Path -Path $autoPushScript -PathType Leaf)) {
    Write-Error "auto_push_csv.ps1 not found in: $RepoPath"
    exit 1
}

$serialScript = Join-Path $RepoPath "reading_serial_data.py"
if (-not (Test-Path -Path $serialScript -PathType Leaf)) {
    Write-Error "reading_serial_data.py not found in: $RepoPath"
    exit 1
}

Write-Log "Starting data pipeline..."

$loggerJob = Start-Job -Name "SerialLogger" -ScriptBlock {
    param($repoPath, $pythonExe, $csvPath)
    Set-Location $repoPath

    $args = @("reading_serial_data.py", "--output", $csvPath)

    & $pythonExe @args
} -ArgumentList $RepoPath, $PythonExe, $CsvPath

$pushJob = Start-Job -Name "CsvAutoPush" -ScriptBlock {
    param($repoPath, $csvPath, $intervalSeconds)
    Set-Location $repoPath
    & (Join-Path $repoPath "auto_push_csv.ps1") -RepoPath $repoPath -CsvPath $csvPath -IntervalSeconds $intervalSeconds
} -ArgumentList $RepoPath, $CsvPath, $PushIntervalSeconds

Write-Log "Serial logger job id: $($loggerJob.Id)"
Write-Log "Auto-push job id: $($pushJob.Id)"
Write-Log "Press Ctrl+C to stop both jobs."

try {
    while ($true) {
        Receive-Job -Id $loggerJob.Id -Keep | Out-Host
        Receive-Job -Id $pushJob.Id -Keep | Out-Host

        $loggerState = (Get-Job -Id $loggerJob.Id).State
        $pushState = (Get-Job -Id $pushJob.Id).State

        if ($loggerState -ne "Running" -or $pushState -ne "Running") {
            Write-Log "One of the jobs has stopped. Logger=$loggerState, AutoPush=$pushState"
            break
        }

        Start-Sleep -Seconds 2
    }
}
finally {
    Write-Log "Stopping jobs..."
    Get-Job -Id $loggerJob.Id, $pushJob.Id -ErrorAction SilentlyContinue | Stop-Job -ErrorAction SilentlyContinue
    Get-Job -Id $loggerJob.Id, $pushJob.Id -ErrorAction SilentlyContinue | Receive-Job -Keep | Out-Host
    Get-Job -Id $loggerJob.Id, $pushJob.Id -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
    Write-Log "Data pipeline stopped."
}