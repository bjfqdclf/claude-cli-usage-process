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

ensure_claude_dir() {
  mkdir -p "${CLAUDE_DIR}"
}

validate_dependencies() {
  command -v node >/dev/null 2>&1 || {
    echo "缺少 node，无法安装。" >&2
    exit 1
  }
}

install_statusline() {
  SETTINGS_PATH="${SETTINGS_PATH}" USAGE_SCRIPT_PATH="${USAGE_SCRIPT_PATH}" node <<'NODE'
const fs = require('fs');

const settingsPath = process.env.SETTINGS_PATH;
const usageScriptPath = process.env.USAGE_SCRIPT_PATH;

let config = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  config = raw ? JSON.parse(raw) : {};
}

config.statusLine = {
  type: 'command',
  command: `node ${usageScriptPath}`,
};

fs.writeFileSync(settingsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
NODE
}

main() {
  validate_dependencies
  ensure_claude_dir

  if [[ "${DRY_RUN}" == "--dry-run" ]]; then
    echo "将写入 ${SETTINGS_PATH}"
    echo "statusLine.command = node ${USAGE_SCRIPT_PATH}"
    exit 0
  fi

  backup_settings
  install_statusline

  cat <<EOF
安装完成。

- 已写入: ${SETTINGS_PATH}
- 状态栏命令: node ${USAGE_SCRIPT_PATH}

重启 Claude CLI 后生效。
EOF
}

main "$@"
