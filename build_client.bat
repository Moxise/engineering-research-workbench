@echo off
chcp 65001 >nul
rem v260923 · 构建桌面客户端 exe：pywebview 窗口 + 便携式数据（exe 同级 config/ 与 Workspace/）
cd /d "%~dp0"

echo [1/3] 安装构建依赖（pyinstaller / pywebview / pillow）...
python -m pip install --quiet pyinstaller pywebview pillow || (echo 依赖安装失败 & exit /b 1)

echo [2/3] 生成应用图标...
if not exist build mkdir build
python -c "from PIL import Image; img=Image.open('web/favicon.png'); img.save('build/favicon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])" 2>nul
if exist build\favicon.ico (set ICON_ARG=--icon build\favicon.ico) else (echo 图标转换跳过，使用默认图标 & set ICON_ARG=)

echo [3/3] PyInstaller 打包中...
rem v260923w · exe 直接生成在项目根目录（--distpath .），与开发环境共用根目录的 config\ 与 Workspace\
python -m PyInstaller --noconfirm --clean --onefile --windowed --name ResearchWorkbench --distpath . %ICON_ARG% --add-data "web;web" --add-data "VERSION;." client.py || (echo 打包失败 & exit /b 1)

echo.
echo 完成：ResearchWorkbench.exe（项目根目录）
echo 使用说明：在项目根目录双击运行，直接使用根目录的 config\ 与 Workspace\，不再产生独立数据副本。
pause
