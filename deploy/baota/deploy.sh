#!/usr/bin/env bash
# Deck-Loop — 宝塔生产部署（参考 debateTimer deploy/baota 模式）
# 用法：
#   bash deploy/baota/deploy.sh            # 全流程：拉码 → 构建 → 宝塔脚本重启 → 健康检查
#   bash deploy/baota/deploy.sh --dry-run
#
# 前置（一次性）：/www/wwwroot/deck-loop 为本仓库 git clone，.env 已就位，
# 宝塔「网站 → Node 项目」已创建（生成 vhost/scripts/<name>.sh 启动脚本）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        *) echo "未知参数: $1" >&2; exit 2 ;;
    esac
    shift
done

APP_DIR="${APP_DIR:-$REPO_ROOT}"
GIT_BRANCH="${GIT_BRANCH:-main}"
APP_USER=www
HEALTH_PORT="${HEALTH_PORT:-18080}"
BT_SCRIPTS_DIR="${BT_SCRIPTS_DIR:-/www/server/nodejs/vhost/scripts}"
BT_PIDS_DIR="${BT_PIDS_DIR:-/www/server/nodejs/vhost/pids}"
BT_LOG="${BT_LOG:-/www/wwwlogs/nodejs}"
LOG_FILE="${LOG_FILE:-/www/wwwlogs/deck-loop-deploy.log}"

log() {
    local line="[$(date '+%F %T')] $*"
    echo "$line"
    if [[ "$DRY_RUN" -eq 0 ]]; then
        mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
        echo "$line" >> "$LOG_FILE" 2>/dev/null || true
    fi
}

die() { log "错误: $*"; exit 1; }

# 9>&-：不把部署锁 fd 传给子进程，避免长驻应用继承锁导致后续部署误判（debateTimer 同款）
run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN  $*"
        return 0
    fi
    log "+ $*"
    "$@" 9>&-
}

# 部署锁
if [[ "$DRY_RUN" -eq 0 ]]; then
    exec 9>"${APP_DIR}/.deploy.lock"
    flock -n 9 || die "已有部署在进行（${APP_DIR}/.deploy.lock）"
fi

# ---------- 环境发现 ----------

discover_node() {
    local d
    for d in /www/server/nodejs/*/bin; do
        [[ -x "${d}/node" ]] && { echo "${d}/node"; return; }
    done
    command -v node || die "找不到 Node（宝塔「软件商店」装 Node 版本管理器）"
}

ensure_pnpm10() {
    local node_bin="$1"
    local bin_dir pm2npm
    bin_dir="$(dirname "$node_bin")"
    export PATH="${bin_dir}:${PATH}"
    if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm -v 2>/dev/null | cut -d. -f1)" != "10" ]]; then
        log "安装 pnpm@10（v11 有 minimum-release-age 兼容问题）"
        run npm i -g pnpm@10
    fi
    command -v pnpm >/dev/null 2>&1 || die "pnpm 安装失败"
}

# 宝塔「Node 项目」启动脚本：先按项目名猜，再按目录 grep 兜底
find_bt_script() {
    local name f
    for name in deck_loop deck-loop deck-loop-core; do
        [[ -f "${BT_SCRIPTS_DIR}/${name}.sh" ]] && { echo "${BT_SCRIPTS_DIR}/${name}.sh"; return; }
    done
    for f in "${BT_SCRIPTS_DIR}"/*.sh; do
        [[ -f "$f" ]] || continue
        if grep -qF "${APP_DIR}" "$f" 2>/dev/null; then
            echo "$f"
            return
        fi
    done
    return 1
}

# ---------- 步骤 ----------

pull_repo() {
    [[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} 不是 git 仓库（先 git clone 本仓库到该目录）"
    cd "$APP_DIR"
    log "仓库: ${APP_DIR}  分支: ${GIT_BRANCH}"
    run git fetch origin
    run git checkout "$GIT_BRANCH"
    run git pull --ff-only origin "$GIT_BRANCH"
    log "当前提交: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
}

build_backend() {
    local node_bin
    node_bin="$(discover_node)"
    ensure_pnpm10 "$node_bin"
    log "Node: $("$node_bin" -v)"
    [[ -f "${APP_DIR}/server-node/.env" || -f "${APP_DIR}/.env" ]] \
        || die "缺少 .env（从 deploy/deck-loop.env.example 复制到仓库根或 server-node/）"
    cd "${APP_DIR}/server-node"
    run pnpm install --frozen-lockfile
    run npm run build
    # 构建后裁剪为纯生产依赖（运行时零 devDeps）
    run pnpm install --prod --frozen-lockfile
    chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/server-node/dist" "${APP_DIR}/server-node/node_modules" 2>/dev/null || true
}

restart_via_baota() {
    local script pidfile pid
    script="$(find_bt_script)" || die "未找到宝塔 Node 项目启动脚本（${BT_SCRIPTS_DIR}/*.sh）。请在宝塔「网站 → Node 项目」创建/重建项目。"
    pidfile="${BT_PIDS_DIR}/$(basename "$script" .sh).pid"
    log "重启方式: 宝塔脚本 ${script}"

    # 停（pid 文件 + 进程匹配双保险）
    if [[ -f "$pidfile" ]]; then
        pid="$(cat "$pidfile" 2>/dev/null || true)"
        [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    fi
    pkill -u "${APP_USER}" -f "${APP_DIR}/server-node/dist/main.js" 2>/dev/null || true
    pkill -u "${APP_USER}" -f "npm run start" 2>/dev/null || true
    sleep 1

    # 起：以 www 身份执行宝塔脚本（与面板手动启动完全同路径；nohup 内置于脚本）
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN  su ${APP_USER} -c bash ${script}"
        return
    fi
    su -s /bin/bash "${APP_USER}" -c "bash '${script}'" || true
    # www 写 pid 可能受限于目录权限：root 侧回填真实 node 进程号
    sleep 2
    pid="$(pgrep -u "${APP_USER}" -f 'dist/main.js' | head -1 || true)"
    if [[ -n "$pid" && -f "$pidfile" ]] && [[ "$(cat "$pidfile" 2>/dev/null)" != "$pid" ]]; then
        echo "$pid" > "$pidfile" 2>/dev/null || true
    fi
    log "新进程 pid=$(cat "$pidfile" 2>/dev/null || echo '?')"
}

wait_health() {
    local i code
    [[ "$DRY_RUN" -eq 1 ]] && { log "DRY-RUN  curl :${HEALTH_PORT}/auth/login"; return; }
    for i in $(seq 1 30); do
        code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${HEALTH_PORT}/auth/login" \
            -H 'Content-Type: application/json' -d '{"email":"health@check","password":"x"}' || true)"
        [[ "$code" == "200" ]] && { log "健康检查通过（HTTP 200）"; return; }
        sleep 1
    done
    log "健康检查失败（最后 HTTP ${code:-无连接}）。最近日志："
    tail -n 30 "${BT_LOG}"/*.log 2>/dev/null | tail -n 30 || true
    die "API 启动后未响应 :${HEALTH_PORT}"
}

main() {
    log "======== Deck-Loop 宝塔部署开始 ========"
    pull_repo
    # git pull 后必须重新 exec 本脚本：拉下来的可能是新版部署逻辑（debateTimer 同款教训）
    if [[ "${DEPLOY_REEXECED:-0}" != "1" ]]; then
        export DEPLOY_REEXECED=1
        exec bash "${SCRIPT_DIR}/deploy.sh" "${ORIGINAL_ARGS:-}"
    fi
    build_backend
    restart_via_baota
    wait_health
    log "======== 部署完成 ========"
}

main
