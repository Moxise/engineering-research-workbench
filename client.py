"""v260923 · 桌面客户端入口：后台线程跑 HTTP 服务，pywebview（Edge WebView2）承载前端窗口。

用法：
- 开发调试：python client.py
- 打包产物：PyInstaller onefile exe（build_client.bat）
  v260923w · exe 生成在项目根目录（--distpath .），frozen 时 DATA_ROOT=exe 所在目录，
  即直接使用根目录的 config/ 与 Workspace/，与开发环境共用同一份数据，不再产生独立副本。
"""
from __future__ import annotations

import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from app.paths import DATA_ROOT, FROZEN


def _setup_logging():
    """windowed exe 无控制台，把输出落到 exe 同级 workbench.log 便于排查。"""
    if not FROZEN:
        return
    try:
        log_path = DATA_ROOT / "workbench.log"
        # 覆盖式写入，避免便携目录下日志无限增长
        stream = open(log_path, "w", encoding="utf-8", buffering=1)
        sys.stdout = stream
        sys.stderr = stream
    except OSError:
        pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _wait_ready(url: str, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=1.5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False


def _clamped_window_size() -> tuple[int, int]:
    """v260923v · 按屏幕工作区预收缩默认窗口尺寸。小屏上若按 1440x900 建窗，
    Windows 会先显示大窗再压回屏幕，产生用户可见的「拉伸」闪动。"""
    w, h = 1440, 900
    try:
        import ctypes
        from ctypes import wintypes
        rect = wintypes.RECT()
        # SPI_GETWORKAREA：任务栏以外的可用区域，返回值与窗口逻辑坐标一致
        if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0):
            w = min(w, rect.right - rect.left)
            h = min(h, rect.bottom - rect.top)
    except Exception:
        pass
    return w, h


def _run_window(url: str, cfg, httpd=None):
    """打开桌面窗口。httpd 为 None 表示连接到已有实例（次生窗口），退出时不触碰对方服务。"""
    try:
        import webview
    except ImportError:
        print("pywebview 未安装：pip install pywebview", file=sys.stderr)
        if httpd is not None:
            httpd.shutdown()
        sys.exit(1)

    title = str(cfg.get("app_name") or "科研工作台")
    # v260923v · 尺寸与 min_size 都按工作区收缩，min_size 超过实际窗口会触发二次调整（同样可见）
    win_w, win_h = _clamped_window_size()
    webview.create_window(
        title, url, width=win_w, height=win_h,
        min_size=(min(1080, win_w), min(720, win_h)),
    )
    # storage_path 指向 exe 同级，保证 localStorage（自定义标记、侧栏状态等）便携持久化
    webview.start(storage_path=str(DATA_ROOT / ".webview-profile"))

    if httpd is None:
        return
    httpd.shutdown()
    httpd.server_close()

    # 设置页触发「快速重启」时：拉起新进程接管，当前进程退出（此时端口已释放，新进程可直接绑定）
    if getattr(httpd, "restart_requested", False):
        print("Restarting client...")
        subprocess.Popen([sys.executable])
        sys.exit(0)


def main():
    _setup_logging()
    t0 = time.time()
    now = lambda: time.strftime("%H:%M:%S")

    import server

    # v260923v · 端口被占时先探测是否为另一个健康的工作台实例：是则开一个次生窗口（单服务多窗口），
    # 避免回退随机端口造成双服务并存；探测失败（陌生进程占用）才回退空闲端口。
    try:
        httpd, cfg, url = server.build_server(auto_open_browser=False)
    except OSError as first_err:
        print(f"[client] {now()} bind failed ({first_err}), probing existing instance...")
        from app import config as _config
        _cfg = _config.get_app()
        _host = str(_cfg.get("host") or "127.0.0.1")
        _port = int(_cfg.get("port") or 8765)
        _url = f"http://{_host}:{_port}"
        if _wait_ready(_url, timeout=2.0):
            print(f"[client] {now()} existing workbench at {_url} is healthy, opening a secondary window.")
            _run_window(_url, _cfg)
            return
        print(f"[client] {now()} no healthy instance detected, falling back to a free port.")
        httpd, cfg, url = server.build_server(port_override=_free_port(), auto_open_browser=False)

    # v260923v · 服务线程兜底：异常打印完整堆栈到 workbench.log，避免线程静默死亡无从排查
    def _serve():
        try:
            httpd.serve_forever(poll_interval=0.25)
        except Exception:
            import traceback
            traceback.print_exc()

    serve_thread = threading.Thread(target=_serve, daemon=True)
    serve_thread.start()
    print(f"[client] {now()} serve thread started (+{time.time() - t0:.1f}s)")

    if not _wait_ready(url):
        print(f"Server failed to become ready at {url}", file=sys.stderr)
        httpd.shutdown()
        sys.exit(1)

    print(f"[client] {now()} server ready (+{time.time() - t0:.1f}s) at {url}")
    _run_window(url, cfg, httpd=httpd)


if __name__ == "__main__":
    main()
