//! Deck-Loop 桌面客户端 Tauri 壳（标准 2.x 最小实现，无自定义 IPC）。
//!
//! F1 范围：仅承载 WebView（devUrl 5173 / frontendDist ../dist）。
//!
//! TODO(F 后续批次，按 api-platform.md P-02 与 auth.md 落地)：
//! - 多端同步本地缓存：`#[tauri::command] fn sync_cache_*`（增量游标快照，
//!   与 POST /auth/sync/pull 配合，配合 sqlite/Stronghold 插件）
//! - token 本地安全存储：Stronghold / keyring 插件替代 localStorage
//!   （auth.md「token 持久化（本地安全存储）」）
//! - SSE 进度通道转发的窗口通知（gw/task/stream，deck_deck_status-changed）

mod export_renderer;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ping,
            export_renderer::export_render_pdf,
            export_renderer::export_capture_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
