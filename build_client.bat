@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1

rem v261013: Keep diagnostics visible, with a build log next to this script.
rem Only build artifacts are changed. Existing config/ and Workspace/ are not touched.
set "BUILD_LOG=%CD%\build_client.log"
set "ICON_ARG="
set "STAGE=initialization"
> "%BUILD_LOG%" echo ResearchWorkbench desktop build log
>> "%BUILD_LOG%" echo Working directory: %CD%
>> "%BUILD_LOG%" echo Date: %DATE% %TIME%

echo.
echo ResearchWorkbench - Windows desktop build
echo Build log: "%BUILD_LOG%"
echo.

set "STAGE=Python environment"
echo [1/3] Checking Python and installing build dependencies...
python -c "import sys; print('Python:', sys.version); sys.exit(0 if sys.version_info >= (3, 11) else 1)" >> "%BUILD_LOG%" 2>&1
if errorlevel 1 goto :failed
python -m pip --version >> "%BUILD_LOG%" 2>&1
if errorlevel 1 goto :failed
python -m pip install pyinstaller pywebview pillow >> "%BUILD_LOG%" 2>&1
if errorlevel 1 goto :failed

set "STAGE=resources and icon"
echo [2/3] Checking resources and preparing the icon...
if not exist "client.py" (
    >> "%BUILD_LOG%" echo ERROR: Missing client.py
    goto :failed
)
if not exist "web\index.html" (
    >> "%BUILD_LOG%" echo ERROR: Missing web\index.html
    goto :failed
)
if not exist "VERSION" (
    >> "%BUILD_LOG%" echo ERROR: Missing VERSION
    goto :failed
)
if not exist "build" mkdir "build"
if not exist "build\research-workstation.ico" (
    python -c "from PIL import Image; img=Image.open('web/favicon.png'); img.save('build/research-workstation.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])" >> "%BUILD_LOG%" 2>&1
)
if exist "build\research-workstation.ico" set "ICON_ARG=--icon build\research-workstation.ico"

set "STAGE=PyInstaller packaging"
echo [3/3] Packaging ResearchWorkbench.exe...
echo Detailed PyInstaller output is written to build_client.log.
rem Do not terminate a running application: that could lose unsaved edits.
tasklist /FI "IMAGENAME eq ResearchWorkbench.exe" 2>nul | find /I "ResearchWorkbench.exe" >nul
if not errorlevel 1 (
    >> "%BUILD_LOG%" echo ERROR: ResearchWorkbench.exe is running. Please close it before packaging.
    goto :failed
)
python -m PyInstaller --noconfirm --clean --onefile --windowed --name ResearchWorkbench --distpath "." %ICON_ARG% --add-data "web;web" --add-data "VERSION;." client.py >> "%BUILD_LOG%" 2>&1
if errorlevel 1 goto :failed
if not exist "ResearchWorkbench.exe" (
    >> "%BUILD_LOG%" echo ERROR: PyInstaller finished without producing ResearchWorkbench.exe
    goto :failed
)

echo.
echo SUCCESS: "%CD%\ResearchWorkbench.exe"
echo The existing Workspace and config folders were left unchanged.
echo Full log: "%BUILD_LOG%"
pause
exit /b 0

:failed
echo.
echo ERROR during: %STAGE%
echo Full log: "%BUILD_LOG%"
echo.
echo Last lines of the build log:
powershell -NoProfile -Command "Get-Content -LiteralPath $env:BUILD_LOG -Tail 80"
if errorlevel 1 type "%BUILD_LOG%"
echo.
echo Copy the above error output or share build_client.log for troubleshooting.
pause
exit /b 1
