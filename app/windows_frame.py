"""Keep a borderless WinForms window inside the active monitor's work area."""
from __future__ import annotations

import ctypes
from ctypes import wintypes


class MonitorInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


class MinMaxInfo(ctypes.Structure):
    _fields_ = [(name, wintypes.POINT) for name in
               ("ptReserved", "ptMaxSize", "ptMaxPosition", "ptMinTrackSize", "ptMaxTrackSize")]


def work_area_bounds(monitor, work) -> tuple[int, int, int, int]:
    """WM_GETMINMAXINFO positions are relative to the current monitor origin."""
    return (work.left - monitor.left, work.top - monitor.top,
            work.right - work.left, work.bottom - work.top)


class WindowsFrame:
    def __init__(self, hwnd: int):
        self.hwnd = hwnd
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        self.user.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        self.user.MonitorFromWindow.restype = wintypes.HANDLE
        self.user.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MonitorInfo)]
        self.comctl = ctypes.WinDLL("comctl32", use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT,
                                           wintypes.WPARAM, wintypes.LPARAM, ctypes.c_size_t, ctypes.c_size_t)
        self.comctl.SetWindowSubclass.argtypes = [wintypes.HWND, callback_type, ctypes.c_size_t, ctypes.c_size_t]
        self.comctl.RemoveWindowSubclass.argtypes = [wintypes.HWND, callback_type, ctypes.c_size_t]
        self.comctl.DefSubclassProc.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.comctl.DefSubclassProc.restype = ctypes.c_ssize_t
        # Retain the callback until WM_NCDESTROY; installation happens on the
        # owning UI thread in before_show, never on a pywebview bridge thread.
        self.callback = callback_type(self._procedure)
        if not self.comctl.SetWindowSubclass(hwnd, self.callback, 1, 0):
            raise ctypes.WinError(ctypes.get_last_error())

    def monitor_info(self) -> MonitorInfo:
        monitor = self.user.MonitorFromWindow(self.hwnd, 2)  # MONITOR_DEFAULTTONEAREST
        info = MonitorInfo(cbSize=ctypes.sizeof(MonitorInfo))
        if not self.user.GetMonitorInfoW(monitor, ctypes.byref(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        return info

    def _procedure(self, hwnd, message, wparam, lparam, subclass_id, reference):
        if message == 0x0082:  # WM_NCDESTROY
            self.comctl.RemoveWindowSubclass(hwnd, self.callback, subclass_id)
        result = self.comctl.DefSubclassProc(hwnd, message, wparam, lparam)
        if message == 0x0024 and lparam:  # WM_GETMINMAXINFO
            try:
                info = self.monitor_info()
                left, top, width, height = work_area_bounds(info.rcMonitor, info.rcWork)
                limits = MinMaxInfo.from_address(lparam)
                limits.ptMaxPosition.x, limits.ptMaxPosition.y = left, top
                limits.ptMaxSize.x, limits.ptMaxSize.y = width, height
            except Exception as exc:
                print(f"[desktop] could not constrain maximized bounds: {exc}")
        return result
