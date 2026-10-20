#!/usr/bin/env bash
# Deck-Loop — 宝塔生产部署（产物模式：构建在 CI runner 完成，服务器只解包+重启）
# 前置：/tmp/deck-loop-deploy/deck-node-bundle.tgz 已就位（deploy-baota.yml 构建+scp）。
# 教训（2026-10-20）：1.6GB 服务器扛不住 pnpm 全量 install+tsc 的内存峰值（OOM 僵死），
# 服务器端构建永久移除；管理权归宝塔（vhost/scripts/deck_loop.sh 启动脚本）。
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/deck-loop}"
APP_USER=www
HEALTH_PORT="${HEALTH_PORT:-18080}"
BUNDLE_DIR=/tmp/deck-loop-deploy
BT_SCRIPTS_DIR="${BT_SCRIPTS_DIR:-/www/server/nodejs/vhost/scripts}"
BT_PIDS_DIR="${BT_PIDS_DIR:-/www/server/nodejs/vhost/pids}"
BT_LOG_DIR="${BT_LOG_DIR:-/www/wwwlogs/nodejs}"
LOG_FILE="${LOG_FILE:-/www/wwwlogs/deck-loop-deploy.log}"

log() { echo "[$(date '+%F %T')] $*"; mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true; echo "$*" >> "$LOG_FILE" 2>/dev/null || true; }
die() { log "错误: $*"; exit 1; }

exec 9>"${APP_DIR}/.deploy.lock"
flock -w 30 9 || die "部署锁等待超时（另一部署进行中或锁被长驻进程误持）"

ls "${BUNDLE_DIR}"/deck-node-*.tgz >/dev/null 2>&1 || die "缺少部署包（${BUNDLE_DIR}/deck-node-*.tgz）"

find_bt_script() {
    local name f
    for name in deck_loop deck-loop deck-loop-core; do
        [[ -f "${BT_SCRIPTS_DIR}/${name}.sh" ]] && { echo "${BT_SCRIPTS_DIR}/${name}.sh"; return; }
    done
    for f in "${BT_SCRIPTS_DIR}"/*.sh; do
        [[ -f "$f" ]] && grep -qF "${APP_DIR}" "$f" 2>/dev/null && { echo "$f"; return; }
    done
    return 1
}

log "======== Deck-Loop 宝塔部署（产物模式）========"

# 解包（--no-same-owner 防 runner 数字 uid 映射错乱；先清旧目录防陈旧残留）
rm -rf "${APP_DIR}/server-node/dist" "${APP_DIR}/server-node/node_modules"
tar --no-same-owner -xzf "${BUNDLE_DIR}"/deck-node-*.tgz -C "${APP_DIR}/server-node"
rm -f "${BUNDLE_DIR}"/deck-node-*.tgz
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/server-node/dist" "${APP_DIR}/server-node/node_modules"
log "产物解包完成: $(ls "${APP_DIR}/server-node/dist" | head -1) 等"

# 重启：杀旧 → 以 www 执行宝塔启动脚本（面板同路径）
SCRIPT="$(find_bt_script)" || die "未找到宝塔 Node 项目启动脚本（${BT_SCRIPTS_DIR}/*.sh）"
PIDFILE="${BT_PIDS_DIR}/$(basename "$SCRIPT" .sh).pid"
log "重启: ${SCRIPT}"
[[ -f "$PIDFILE" ]] && kill "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null || true
pkill -u "${APP_USER}" -f "${APP_DIR}/server-node/dist/main.js" 2>/dev/null || true
pkill -u "${APP_USER}" -f "npm run start" 2>/dev/null || true
sleep 1
# 9>&-：剥离部署锁 fd——否则长驻应用继承锁句柄，后续部署全部误判占用（debateTimer 同款教训）
su -s /bin/bash "${APP_USER}" -c "bash '${SCRIPT}'" 9>&- || true
sleep 2
PID="$(pgrep -u "${APP_USER}" -f 'dist/main.js' | head -1 || true)"
[[ -n "$PID" ]] && echo "$PID" > "$PIDFILE" 2>/dev/null || true
log "新进程 pid=$(cat "$PIDFILE" 2>/dev/null || echo '?')"

# 健康检查（真实 DB 往返：错误密码登录 → 必须回 BIZ_AUTH_CREDENTIALS 信封。
# 教训：只断言 HTTP 200 是假绿——异常过滤器对 404/500 也回 200）
for i in $(seq 1 30); do
    BODY="$(curl -s -m 3 -X POST "http://127.0.0.1:${HEALTH_PORT}/auth/account/login"         -H 'Content-Type: application/json' -d '{"email":"health@check","password":"x"}' || true)"
    if echo "$BODY" | grep -q 'BIZ_AUTH_CREDENTIALS'; then
        log "健康检查通过（DB 往返确认）"; log "======== 部署完成 ========"; exit 0
    fi
    sleep 1
done
log "健康检查失败（HTTP ${CODE:-无连接}），最近宝塔日志："
tail -n 30 "${BT_LOG_DIR}"/deck_loop.log 2>/dev/null || true
die "API 未响应 :${HEALTH_PORT}"
