//! 导出渲染命令（ADR-015：渲染下沉客户端）。
//!
//! Windows 实现：复用宿主 WebView2——`PrintToPdf`（临时文件往返）产 PDF、
//! `CapturePreview`（HGLOBAL 内存流 + 完成回调）产当前视口 PNG。目标窗口由前端
//! 编排创建（屏幕外可见窗口，内容为 export-render 多页视图），本模块只提供
//! 原生打印/截取两个原语；非 Windows 平台暂返回不支持（后续增量）。
//!
//! 线程模型：COM 访问全部限定在 `with_webview` 主线程回调内（tauri 语义），
//! 结果经 mpsc 通道回传命令线程；PDF 临时文件用后即删，无用户数据落盘残留。

/// 打印参数（前端编排传入；尺寸为渲染视图像素，按 96dpi 折算英寸）。
#[derive(serde::Deserialize)]
pub struct PrintParams {
    pub width_px: f64,
    pub height_px: f64,
}

/// PDF 渲染：对 `label` 窗口的当前文档执行 WebView2 PrintToPdf（临时文件往返）。
/// 按窗口标签寻址——由主窗口统一编排（隐藏渲染窗口 label=dl-export-render）。
#[tauri::command]
pub fn export_render_pdf(
    app: tauri::AppHandle,
    label: String,
    params: PrintParams,
) -> Result<Vec<u8>, String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("渲染窗口不存在: {label}"))?;
    imp::render_pdf(window, params).map_err(|e| format!("PDF 渲染失败: {e}"))
}

/// 视口截图：对 `label` 窗口当前可见区域截 PNG（逐页截图由前端切换内容后重复调用）。
#[tauri::command]
pub fn export_capture_window(app: tauri::AppHandle, label: String) -> Result<Vec<u8>, String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("渲染窗口不存在: {label}"))?;
    imp::capture_png(window).map_err(|e| format!("页面截图失败: {e}"))
}

#[cfg(windows)]
use tauri::Manager;

mod imp {
    use std::sync::mpsc;
    use std::time::Duration;

    use windows::core::Interface;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::{IStream, STATSTG};
    use windows::Win32::System::Com::StructuredStorage::{
        CreateStreamOnHGlobal, GetHGlobalFromStream,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2_2, ICoreWebView2_7, ICoreWebView2Controller,
        ICoreWebView2Environment6, ICoreWebView2PrintSettings,
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    // 完成回调处理器在 crate 根（callback 模块 re-export）
    use webview2_com::{CapturePreviewCompletedHandler, PrintToPdfCompletedHandler};

    use super::PrintParams;

    const RENDER_TIMEOUT: Duration = Duration::from_secs(120);
    /// STATFLAG_NONAME：Stat 不分配名称 BSTR（免泄漏口径）
    use windows::Win32::System::Com::STATFLAG_NONAME;

    pub fn render_pdf(
        window: tauri::WebviewWindow,
        params: PrintParams,
    ) -> Result<Vec<u8>, String> {
        let temp_path = std::env::temp_dir().join(format!(
            "deck-loop-export-{}-{}.pdf",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
            std::process::id(),
        ));
        let wide: Vec<u16> = temp_path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let tx_call_result = tx.clone();
        let call_path = temp_path.clone();
        window
            .with_webview(move |webview| unsafe {
                let outcome: Result<(), String> = (|| {
                    let controller: ICoreWebView2Controller = webview.controller();
                    let core: ICoreWebView2 = controller
                        .CoreWebView2()
                        .map_err(|e| format!("CoreWebView2 获取失败: {e}"))?;
                    let core2: ICoreWebView2_2 = core
                        .cast()
                        .map_err(|e| format!("ICoreWebView2_2 转换失败: {e}"))?;
                    let env = core2
                        .Environment()
                        .map_err(|e| format!("Environment 获取失败: {e}"))?;
                    let env6: ICoreWebView2Environment6 = env
                        .cast()
                        .map_err(|e| format!("Environment6 转换失败: {e}"))?;
                    let settings: ICoreWebView2PrintSettings = env6
                        .CreatePrintSettings()
                        .map_err(|e| format!("打印设置创建失败: {e}"))?;

                    let landscape = params.width_px > params.height_px;
                    settings
                        .SetPageWidth(params.width_px / 96.0)
                        .map_err(|e| format!("页宽设置失败: {e}"))?;
                    settings
                        .SetPageHeight(params.height_px / 96.0)
                        .map_err(|e| format!("页高设置失败: {e}"))?;
                    settings
                        .SetOrientation(if landscape {
                            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                        } else {
                            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                        })
                        .map_err(|e| format!("打印方向设置失败: {e}"))?;
                    settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|e| format!("背景打印设置失败: {e}"))?;
                    settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|e| format!("页眉页脚设置失败: {e}"))?;

                    let core7: ICoreWebView2_7 = core
                        .cast()
                        .map_err(|e| format!("ICoreWebView2_7 转换失败: {e}"))?;
                    let handler = PrintToPdfCompletedHandler::create(Box::new(
                        move |error_code: windows::core::Result<()>, is_successful: bool| {
                            let outcome = if let Err(e) = error_code {
                                Err(format!("PrintToPdf 回调失败: {e}"))
                            } else if !is_successful {
                                Err("PrintToPdf 未产出 PDF（isSuccessful=false）".to_string())
                            } else {
                                Ok(())
                            };
                            let _ = tx.send(outcome);
                            Ok(())
                        },
                    ));
                    core7
                        .PrintToPdf(windows::core::PCWSTR(wide.as_ptr()), &settings, &handler)
                        .map_err(|e| format!("PrintToPdf 调用失败: {e}"))
                })();
                match outcome {
                    Ok(()) => {}
                    Err(e) => {
                        // 调用未受理：立即回传错误（否则命令线程将等到超时）
                        let _ = std::fs::remove_file(&call_path);
                        let _ = tx_call_result.send(Err(e));
                    }
                }
            })
            .map_err(|e| format!("with_webview 失败: {e}"))?;

        // 等待完成回调（受理失败时 with_webview 返回 Err 已短路）
        rx.recv_timeout(RENDER_TIMEOUT)
            .map_err(|_| "PDF 打印超时".to_string())??;
        let bytes = std::fs::read(&temp_path).map_err(|e| format!("临时 PDF 读取失败: {e}"))?;
        let _ = std::fs::remove_file(&temp_path);
        Ok(bytes)
    }

    pub fn capture_png(window: tauri::WebviewWindow) -> Result<Vec<u8>, String> {
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        window
            .with_webview(move |webview| unsafe {
                let outcome: Result<(), String> = (|| {
                    let controller: ICoreWebView2Controller = webview.controller();
                    let core: ICoreWebView2 = controller
                        .CoreWebView2()
                        .map_err(|e| format!("CoreWebView2 获取失败: {e}"))?;
                    // NULL HGLOBAL：系统按需分配可移动内存块；deleteonrelease=true
                    // （末次引用释放时回收，读毕无需手动 GlobalFree）
                    let stream: IStream = CreateStreamOnHGlobal(
                        HGLOBAL(std::ptr::null_mut()),
                        true,
                    )
                    .map_err(|e| format!("截图流创建失败: {e}"))?;

                    // 流经闭包移交：CapturePreview 写完后回调读取字节并回传
                    let handler_stream = stream.clone();
                    let tx_handler = tx.clone();
                    let handler = CapturePreviewCompletedHandler::create(Box::new(
                        move |error_code: windows::core::Result<()>| {
                            let outcome = error_code
                                .map_err(|e| format!("CapturePreview 回调失败: {e}"))
                                .and_then(|_| read_hglobal_bytes(&handler_stream));
                            let _ = tx_handler.send(outcome);
                            Ok(())
                        },
                    ));
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                    .map_err(|e| format!("CapturePreview 调用失败: {e}"))
                })();
                if let Err(e) = outcome {
                    // 调用未受理：立即回传错误（否则命令线程将等到超时）
                    let _ = tx.send(Err(e));
                }
            })
            .map_err(|e| format!("with_webview 失败: {e}"))?;

        rx.recv_timeout(RENDER_TIMEOUT)
            .map_err(|_| "页面截图超时".to_string())?
    }

    /** HGLOBAL 内存流读全量（Stat 取逻辑长度 + GlobalLock 拷贝） */
    unsafe fn read_hglobal_bytes(stream: &IStream) -> Result<Vec<u8>, String> {
        let mut stat = STATSTG::default();
        stream
            .Stat(&mut stat, STATFLAG_NONAME)
            .map_err(|e| format!("截图流 Stat 失败: {e}"))?;
        let size = stat.cbSize as usize;
        let hglobal: HGLOBAL =
            GetHGlobalFromStream(stream).map_err(|e| format!("HGLOBAL 获取失败: {e}"))?;
        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            return Err("GlobalLock 失败".to_string());
        }
        let bytes = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
        let _ = GlobalUnlock(hglobal);
        if bytes.is_empty() {
            return Err("截图结果为空".to_string());
        }
        Ok(bytes)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn render_pdf(_window: tauri::WebviewWindow, _params: PrintParams) -> Result<Vec<u8>, String> {
        Err("当前平台暂不支持本地导出渲染（Windows 先行，后续增量）".to_string())
    }

    pub fn capture_png(_window: tauri::WebviewWindow) -> Result<Vec<u8>, String> {
        Err("当前平台暂不支持本地导出渲染（Windows 先行，后续增量）".to_string())
    }
}
