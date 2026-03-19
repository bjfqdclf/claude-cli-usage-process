$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $HOME ".claude"
$SettingsPath = Join-Path $ClaudeDir "settings.json"
$BackupDir = Join-Path $ClaudeDir ".codex-backups"
$UsageScriptPath = Join-Path $ScriptDir "scripts\usage-bar.js"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$DryRun = $args -contains "--dry-run"

function Ensure-BackupDir {
    if (-not (Test-Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir | Out-Null
    }
}

function Backup-Settings {
    if (-not (Test-Path $SettingsPath)) {
        return
    }

    Ensure-BackupDir
    Copy-Item $SettingsPath (Join-Path $BackupDir "settings.json.$Timestamp")

    $files = Get-ChildItem $BackupDir -Filter "settings.json.*" | Sort-Object Name
    if ($files.Count -gt 20) {
        $files | Select-Object -First ($files.Count - 20) | Remove-Item -Force
    }
}

function Get-LatestRestoreBackup {
    if (-not (Test-Path $BackupDir)) {
        return $null
    }

    $files = Get-ChildItem $BackupDir -Filter "settings.json.*" | Where-Object { $_.Name -ne "settings.json.$Timestamp" } | Sort-Object Name
    if ($files.Count -eq 0) {
        return $null
    }

    return $files[-1].FullName
}

function Restore-Backup($BackupFile) {
    Copy-Item $BackupFile $SettingsPath -Force
}

function Remove-StatusLineOnly {
    if (-not (Test-Path $SettingsPath)) {
        return
    }

    $raw = Get-Content $SettingsPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return
    }

    $config = $raw | ConvertFrom-Json -AsHashtable
    $statusLine = $config["statusLine"]

    if ($null -ne $statusLine -and $statusLine["type"] -eq "command" -and $statusLine["command"] -eq "node $UsageScriptPath") {
        $config.Remove("statusLine")
    }

    $json = $config | ConvertTo-Json -Depth 20
    Set-Content -Path $SettingsPath -Value $json
}

if ($DryRun) {
    Write-Output "将尝试从 $BackupDir 恢复最近备份。"
    Write-Output "如果没有备份，则只移除 settings.json 中指向 $UsageScriptPath 的 statusLine。"
    exit 0
}

Backup-Settings
$restoreFile = Get-LatestRestoreBackup

if ($null -ne $restoreFile) {
    Restore-Backup $restoreFile
    Write-Output "卸载完成。"
    Write-Output ""
    Write-Output "- 已恢复备份: $restoreFile"
    Write-Output "- 已写回: $SettingsPath"
    Write-Output ""
    Write-Output "重启 Claude CLI 后生效。"
    exit 0
}

Remove-StatusLineOnly
Write-Output "卸载完成。"
Write-Output ""
Write-Output "- 未找到可恢复备份"
Write-Output "- 已从 $SettingsPath 移除当前项目的 statusLine 配置"
Write-Output ""
Write-Output "重启 Claude CLI 后生效。"
