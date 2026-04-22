param(
    [string]$RepoPath = $PSScriptRoot,
    [string]$CsvPath = "arduino_data.csv",
    [int]$IntervalSeconds = 300,
    [switch]$RunOnce,
    [switch]$DryRun
)

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git is not installed or not available in PATH."
    exit 1
}

if ($IntervalSeconds -lt 60) {
    Write-Error "IntervalSeconds must be at least 60."
    exit 1
}

if (-not (Test-Path -Path $RepoPath -PathType Container)) {
    Write-Error "Repository path does not exist: $RepoPath"
    exit 1
}

Set-Location $RepoPath

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "RepoPath is not a git repository: $RepoPath"
    exit 1
}

if (-not (Test-Path -Path $CsvPath -PathType Leaf)) {
    Write-Error "CSV file not found: $CsvPath"
    exit 1
}

git remote | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Unable to access git remotes for this repository."
    exit 1
}

Write-Log "Auto-push started for $CsvPath (interval: $IntervalSeconds seconds)."
if ($DryRun) {
    Write-Log "DryRun mode is ON. No commit or push will be performed."
}

while ($true) {
    git add -- $CsvPath
    if ($LASTEXITCODE -ne 0) {
        Write-Log "git add failed. Retrying next cycle."
    }
    else {
        git diff --cached --quiet -- $CsvPath
        $hasChanges = ($LASTEXITCODE -eq 1)

        if ($hasChanges) {
            $message = "data: update arduino_data.csv $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

            if ($DryRun) {
                Write-Log "Detected changes. Would commit with message: $message"
            }
            else {
                git commit -m $message -- $CsvPath
                if ($LASTEXITCODE -ne 0) {
                    Write-Log "git commit failed. Retrying next cycle."
                }
                else {
                    git push
                    if ($LASTEXITCODE -eq 0) {
                        Write-Log "Pushed updated $CsvPath"
                    }
                    else {
                        Write-Log "git push failed. Attempting pull --rebase and one retry."
                        git pull --rebase
                        if ($LASTEXITCODE -eq 0) {
                            git push
                            if ($LASTEXITCODE -eq 0) {
                                Write-Log "Push succeeded after rebase."
                            }
                            else {
                                Write-Log "Retry push failed. Will retry next cycle when new changes exist."
                            }
                        }
                        else {
                            Write-Log "pull --rebase failed. Resolve conflicts and rerun script."
                        }
                    }
                }
            }
        }
        else {
            Write-Log "No changes in $CsvPath"
        }
    }

    if ($RunOnce) {
        Write-Log "RunOnce complete. Exiting."
        break
    }

    Start-Sleep -Seconds $IntervalSeconds
}