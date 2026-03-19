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

function Ensure-ClaudeDir {
    if (-not (Test-Path $ClaudeDir)) {
        New-Item -ItemType Directory -Path $ClaudeDir | Out-Null
    }
}

function Validate-Dependencies {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "缺少 node，无法安装。"
    }
}

function Install-StatusLine {
    $config = @{}
    if (Test-Path $SettingsPath) {
        $raw = Get-Content $SettingsPath -Raw
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $config = $raw | ConvertFrom-Json -AsHashtable
        }
    }

    $config["statusLine"] = @{
        type = "command"
        command = "node $UsageScriptPath"
    }

    $json = $config | ConvertTo-Json -Depth 20
    Set-Content -Path $SettingsPath -Value $json
}

Validate-Dependencies
Ensure-ClaudeDir

if ($DryRun) {
    Write-Output "将写入 $SettingsPath"
    Write-Output "statusLine.command = node $UsageScriptPath"
    exit 0
}

Backup-Settings
Install-StatusLine

Write-Output "安装完成。"
Write-Output ""
Write-Output "- 已写入: $SettingsPath"
Write-Output "- 状态栏命令: node $UsageScriptPath"
Write-Output ""
Write-Output "重启 Claude CLI 后生效。"
