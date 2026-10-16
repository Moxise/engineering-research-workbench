# Windows 桌面版

双击 `ResearchWorkbench.exe` 即可打开独立窗口。推荐 Windows 10 / 11 x64，需要 Microsoft Edge WebView2 Runtime；普通使用无需安装 Python。若提示缺少运行环境，安装 [Microsoft 官方 WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download-section)。

## 窗口与后台运行

- 顶层标题栏右侧依次为最小化、最大化 / 还原、关闭。最小化缩到 Windows 任务栏；最大化仅占用当前显示器工作区，保留系统任务栏。
- “设置 → 窗口 → 点击关闭按钮时”可选择“最小化到系统托盘，继续后台运行”或“退出应用”，保存后立即生效，重启后保留。默认隐藏到托盘，后台服务、编辑内容和进行中的任务继续保留；Alt+F4 遵循同一设置。
- 双击标题栏切换最大化 / 还原。拖动标题栏移动窗口，拖动边缘或四角调整大小。
- 页面标题、日期、天气、主题、布局密度和缩放集中在顶层标题栏。最小化按钮左侧的刷新图标打开菜单，可选择重新加载配置与索引或快速重启；点击图标本身不会立即重启。
- 标题栏的主题按钮可切换浅色 / 暗色。关联 Markdown 导出使用固定尺寸弹窗，长内容在窗口内滚动，小屏自动适配可用空间。
- 暗色模式覆盖待办、里程碑时间轴与列表、Agent 对话、文献工作区；侧栏和知识分类标签保留各自颜色。PDF 纸张维持原文颜色，周边工具栏与阅读区使用暗色。
- 概览“近期节点”使用连续时间轴，圆环随列表滚动；临近节点带轻微环绕动效。“设置 → 界面 → 动画”关闭或 Windows 开启减少动态效果时，圆环保持静态。
- 设置页、右下角提示消息和确认弹窗统一跟随亮色 / 暗色主题。删除和完成待办使用工作台内的居中弹窗；离开未保存的 Markdown 或退出应用时，可选择“保存并继续 / 不保存 / 继续编辑”。保存失败会保留当前编辑内容。
- 新建文档首先是内存草稿，首次保存才生成本地 Markdown；未修改的模板在离开或退出时直接丢弃。标题、状态、分类、标签等修改也会触发保存提醒；改回原始内容后不再提醒。关闭到托盘会保留当前编辑页面。
- 概览的学业、条件和活跃目标进度条带间歇波光，活动柱带错开的高光。可通过界面动画设置关闭；隐藏到托盘后暂停。
- 文档、PDF 和 Agent 工作区利用窗口底部空间，各页面随可用窗口宽度铺满，不再在宽屏两侧保留居中空白。条目信息展开时完整显示所有字段，收起后保留完整的“展开”按钮；小窗口容纳不下内容时由整个编辑内容区滚动，信息区不设单独滚动条，保存操作保持可见。项目卡片统一高度，长名称和描述可悬停查看。
- 桌面专注 / 休息计时由后台时钟负责，切换页面、刷新页面或隐藏到托盘仍继续。到时在当前显示器右下角显示独立置顶提醒，保留至手动点击“知道了”或关闭按钮；点击“打开工作台”会消除提醒并恢复主窗口。提醒适配亮色 / 暗色，不抢占输入焦点；多个未确认的提醒合并显示数量。暂停或重置会停止相应计时，完全退出应用时关闭计时和提醒窗口。
- 点击托盘图标或右键选择“打开科研工作台”恢复窗口；重复启动 exe 也会唤回原窗口。同一数据目录仅运行一个桌面实例。
- 完全退出：托盘图标右键 → “退出”。有未保存的 Markdown 时会要求确认；取消退出会恢复窗口。
- 系统托盘不可用时退回任务栏最小化，避免窗口隐藏后无法找回。
- `ResearchWorkbench.exe --background` 启动后直接在托盘运行。需要登录后启动时，可把带此参数的快捷方式放到 `Win+R` → `shell:startup` 对应目录。

隐藏到托盘并不会释放 WebView 内存，因为它需要保留正在编辑的内容；后台运行也不意味着 Windows 休眠或关机后任务仍能执行。

## 数据位置与升级

这是便携版：默认读取 exe 同级的 `config/` 和 `Workspace/`。把 exe 放在当前项目根目录，会沿用现有配置和资料。也可使用 `ResearchWorkbench.exe --data-dir "D:\ResearchData"` 指定另一数据目录。

将 ZIP 解压到有写入权限的目录后再运行，不要直接在 ZIP 内或 `Program Files` 中启动。首次运行会初始化配置和 Workspace。窗口大小、最大化状态及关闭行为保存在 `window-state.json`；主题、缩放等偏好保存在 `.webview-profile/`；日志为 `workbench.log`。端口被占用时会使用可用端口，并将其记在 `desktop-service.json`，使重启后的界面偏好仍能恢复；修改服务监听地址或配置端口后会重新选择。

升级时先通过托盘退出，再替换 exe。发布 ZIP 仅包含程序、许可证和本说明，不包含任何个人资料、API Key 或聊天记录。浏览器版仍可通过 `run.bat` / `python server.py` 使用。

若构建时旧程序正在运行，新版会另存为同目录的 `ResearchWorkbench-Updated.exe`。先从托盘退出旧版再打开新版；同目录程序共用数据，旧版未退出时启动新版只会唤回原窗口。`run_client.bat` 会选择最近构建的 exe；ZIP 内仍统一命名为 `ResearchWorkbench.exe`。

## 从源码构建

安装 Windows x64 Python 3.11+，双击 `build_client.bat`。它在 `build/.venv` 安装固定版本的桌面依赖，生成：

- 项目根目录 `ResearchWorkbench.exe`；
- `dist/ResearchWorkbench-Windows-x64.zip`；
- `dist/windows-build.json`，记录版本、文件大小和 SHA-256；
- `build_client.log`，记录构建输出。

已有 `build/.venv` 时会直接复用；创建环境时也可通过环境变量 `ERW_BUILD_PYTHON` 指定 Python 路径。自动构建可执行 `build_client.bat --no-pause`。源码变更后须重新构建 exe。

底层采用 [pywebview](https://pywebview.flowrl.com/api/) 与 [pystray](https://pystray.readthedocs.io/en/latest/usage.html)，由 WebView2 承载现有前端，本地 Python 服务负责数据处理。Windows 11 使用系统圆角和阴影；Windows 10 的圆角效果由系统能力决定。
