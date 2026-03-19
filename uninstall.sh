#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
SETTINGS_PATH="${CLAUDE_DIR}/settings.json"
BACKUP_DIR="${CLAUDE_DIR}/.codex-backups"
USAGE_SCRIPT_PATH="${SCRIPT_DIR}/scripts/usage-bar.js"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
DRY_RUN="${1:-}"

ensure_backup_dir() {
  mkdir -p "${BACKUP_DIR}"
}

backup_settings() {
  if [[ ! -f "${SETTINGS_PATH}" ]]; then
    return
  fi

  ensure_backup_dir
  cp "${SETTINGS_PATH}" "${BACKUP_DIR}/settings.json.${TIMESTAMP}"

  python3 - "${BACKUP_DIR}" <<'PY'
import os
import sys

backup_dir = sys.argv[1]
prefix = "settings.json."
files = sorted(
    f for f in os.listdir(backup_dir)
    if f.startswith(prefix)
)

for old in files[:-20]:
    os.remove(os.path.join(backup_dir, old))
PY
}

latest_restore_backup() {
  python3 - "${BACKUP_DIR}" "${TIMESTAMP}" <<'PY'
import os
import sys

backup_dir = sys.argv[1]
current_ts = sys.argv[2]
prefix = "settings.json."
files = sorted(
    f for f in os.listdir(backup_dir)
    if f.startswith(prefix) and not f.endswith(current_ts)
)

if files:
    print(os.path.join(backup_dir, files[-1]))
PY
}

restore_backup() {
  local backup_file="$1"
  cp "${backup_file}" "${SETTINGS_PATH}"
}

remove_statusline_only() {
  SETTINGS_PATH="${SETTINGS_PATH}" USAGE_SCRIPT_PATH="${USAGE_SCRIPT_PATH}" node <<'NODE'
const fs = require('fs');

const settingsPath = process.env.SETTINGS_PATH;
const usageScriptPath = process.env.USAGE_SCRIPT_PATH;

if (!fs.existsSync(settingsPath)) {
  process.exit(0);
}

const raw = fs.readFileSync(settingsPath, 'utf8').trim();
if (!raw) {
  process.exit(0);
}

const config = JSON.parse(raw);
const statusLine = config.statusLine;

if (
  statusLine &&
  statusLine.type === 'command' &&
  typeof statusLine.command === 'string' &&
  statusLine.command.trim() === `node ${usageScriptPath}`
) {
  delete config.statusLine;
}

fs.writeFileSync(settingsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
NODE
}

main() {
  if [[ "${DRY_RUN}" == "--dry-run" ]]; then
    echo "将尝试从 ${BACKUP_DIR} 恢复最近备份。"
    echo "如果没有备份，则只移除 settings.json 中指向 ${USAGE_SCRIPT_PATH} 的 statusLine。"
    exit 0
  fi

  backup_settings

  local restore_file=""
  if [[ -d "${BACKUP_DIR}" ]]; then
    restore_file="$(latest_restore_backup || true)"
  fi

  if [[ -n "${restore_file}" && -f "${restore_file}" ]]; then
    restore_backup "${restore_file}"
    cat <<EOF
卸载完成。

- 已恢复备份: ${restore_file}
- 已写回: ${SETTINGS_PATH}

重启 Claude CLI 后生效。
EOF
    exit 0
  fi

  remove_statusline_only
  cat <<EOF
卸载完成。

- 未找到可恢复备份
- 已从 ${SETTINGS_PATH} 移除当前项目的 statusLine 配置

重启 Claude CLI 后生效。
EOF
}

main "$@"
