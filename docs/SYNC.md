# 双向同步

设置与使用方法见 [Windows 使用说明](WINDOWS.md#客户端与服务器同步)。客户端和服务器须使用本次版本；浏览器编辑与桌面编辑使用同一套保存与同步数据层。

## 数据与版本

Markdown 和原有 JSON 数据仍是资料来源。`app/sync_engine.py` 在 `System/Sync/state.sqlite` 保存观察到的内容校验、递增版本、对端共同基线及冲突记录。每次扫描比较内容，而不是依赖不同设备的系统时间。文档通过 frontmatter 的 `id` 识别，重命名仍保留条目身份；没有 ID 的普通文件通过 Workspace 相对路径识别。

项目、待办、文献索引与批注按记录 ID 分别比较。因此两端修改不同待办时可以同时合入，无需把整个 JSON 文件认定为冲突。通用设置按字段比较；列表字段整体比较，修改同一列表时保留冲突。

同步基线是持久的离线变更记录。已删除项目保留墓碑，防止再次连接时旧条目复活。文件内容以 SHA-256 保存并校验，分块最多 2 MB，单个文件最多 512 MB，重试可以从已收到的断点继续。相同内容的缓存只发布一次，已有缓存直接复用，避免 Windows 下替换正在读取的文件而触发拒绝访问。并行下载和接收按内容校验值限制为单个断点文件写入者；已完整传输但尚未发布的断点文件可以在重试时完成发布。

## 合并规则

| 相对共同基线的变化 | 行为 |
| --- | --- |
| 仅本地修改 | 上传 |
| 仅服务器修改 | 下载 |
| 两端内容相同 | 更新共同基线，无需重传 |
| 两端不同修改，或删除与修改同时发生 | 保留冲突，等待用户选择 |
| 首次连接，两端同一 ID 的内容不同 | 保留冲突，不推断谁更新 |

清单与应用之间使用递增版本作条件检查，下载期间新保存的内容不会被覆盖。正常 HTTP 写入和同步应用共用写锁，联网时释放锁。网页通过本机服务登记未保存文档的保护状态；保护有心跳和过期时间，关闭标签页时释放。文档保存或放弃后，下一次同步再处理变化。

## 同步范围

- 文档：`Knowledge/`、`Projects/`、`Resources/` 下的 Markdown。
- 附件：上述资料目录下的其他文件；跳过缓存、预览、索引、回收站、隐藏文件与符号链接。
- 记录：`System/todos.json`、`System/projects.json`、文献 `Index/library.json` 的 `items` 和 `Annotations/` 里的记录。
- 通用设置：工作台名称、副标题、界面、学业目标、知识条目类型、分类标记、天气和资讯源；浏览器偏好通过本地服务保存到 `config/ui-preferences.json`。
- 可选历史：`System/AgentChats/` 的对话与附件。

`config/sync.json` 仅存本机连接设置。secret / secrets、LLM 账号、端口、窗口状态、WebView 用户目录、缓存索引、账单与操作临时目录不进入清单。外部绝对路径引用不会搬运到另一台机器，应先将附件存入 Workspace。

## 接口与运行

`app/sync_service.py` 管理当前 Workspace 的实例。Python 后台线程负责自动同步；网页标题栏负责触发手动同步、显示本地状态与冲突处理。切换 Workspace 时停止旧实例并创建对应的新实例。接收端应用成功后重新读取配置并刷新索引。

- `GET /api/sync/status`：本地状态，不访问对端。
- `GET /api/sync/manifest?scopes=...`：对端版本清单。
- `GET /api/sync/blob-info`、`GET /api/sync/blob`、`PUT /api/sync/blob`：内容查询与断点传输。
- `POST /api/sync/apply`：按预期版本应用一批变化，返回成功、冲突与失败。
- `POST /api/sync/config`、`test`、`run`、`check`：连接配置、测试、同步和只检查。
- `POST /api/sync/preferences`、`guard`：保存界面偏好与编辑保护心跳。
- `GET /api/sync/conflict`、`POST /api/sync/resolve`：比较并处理冲突。

“不同步”禁用主动连接，对端仍可通过同步接口读写资料，因此服务器通常不需要配置反向同步地址。当前接口按已确定的单人方案不含鉴权。

## 验证

`tools/test_sync_engine.py` 使用两个独立 Workspace 和真实 HTTP 通信验证上传、下载、冲突、删除、断点、版本竞争、编辑保护、重启恢复与范围隔离。`tools/test_sync_integration.py` 启动两个独立服务进程，检查真实索引、配置回读和无浏览器窗口时的自动同步。`tools/ui_usability_check.js` 验证设置、标题栏位置、三种模式与亮暗冲突界面，同时保留现有桌面界面的回归检查。
