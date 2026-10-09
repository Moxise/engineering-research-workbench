# Changelog

## v261009.5

### 检索质量再修：引用残片、整句关键词 0 命中、相似度显示错误、模型离线加载

- **剔噪加强（`rag/pdf.py`，指纹升到 `pdfv6`）**：① 全角归一化后再匹配 —— 中文学位论文的参考文献写作「［4］李凡．…［D］．西安电子科技大学」，全角方括号/点号会让半角正则**全部失配**，这是 v261009.4 漏掉整页参考文献的直接原因；② 新增「短行多 + 引用标记密集」的文献页判据与中文学位论文文献类型标记（`[D]`/`[J]`/`[M]`、学位论文、出版社、大学学报）；③ 论文前 3 页的**题录/摘要页**（元数据，题录里已有摘要）也剔除 —— 实测 CNKI 式题录页共 59 行、`摘要` 在第 21 行，固定 20 行窗口会漏判，改为「按行首匹配、扫描前 45% 行」；④ 新增**片段级**判据 `chunk_is_noise()`，兜住正文页里夹着的引用块与文本层乱码（□/■）。实测 PDF 片段 **14,106 → 9,879 块**（剔除约 30%，均为目录/参考文献/题录摘要/引用块）。
- **关键词标题优先**：loose 的 bm25 会把「术语覆盖最全」的导航类条目（`知识-原理-知识库全局说明`）顶到第一条，而用户要的是标题就写着这个主题的条目。排序改为「标题含任一查询 bigram 的优先，再按 bm25」—— 注意第一版用**整串查询**做 LIKE 等于没加（没有任何标题包含「红外暗弱目标识别」这一整串），改用 bigram token 后才生效。
- **片段质量先验（`rag/search.py:chunk_quality()`）**：查询词在引用残片/清单/断句里同样密集出现，会把它们排到正文之前。按可解释的表面特征给 0.75~1.15 的乘子（成句正文 +0.12、无句末标点 −0.12、数字密集 −0.10、引号密集 −0.08…），排序用「余弦 × 先验」，**返回值仍是原始余弦**（可比较、可复核）。实测 MRR@10 **0.874 → 0.896**，Recall@5 0.981 不变，负样本高置信误标率 0.000。
- **整句中文关键词 0 命中修复（`app/kb_segment.py` / `app/perf_index_query.py`）**：`红外暗弱目标识别` 这类没有一个空格的整句，AND/OR 表达式都还是「整串短语匹配」，只要原文措辞略有差别就 0 命中（线上实测 0 命中，而库里明明有大量相关条目）。新增 `mode="loose"`（每个 bigram 各作独立词、bm25 排序）作为第四段兜底：该查询 **0 → 60 条**。loose 极宽松，仅用于「有没有相关内容」，**不作证据**（RAG 置信度仍看严格 FTS）。
- **相似度显示修正（`rag/search.py` / `web/app.js`）**：`sources[].score` 是 RRF 融合分（1/(k+rank)，量级 0.01），界面把它当「相似度」显示 → 用户看到「相似度 0.016」。现新增 `sources[].similarity`（**真实余弦**）并优先显示，score 仅作兜底。
- **搜索弹窗重排**：语义分区置顶（带页码与真实相似度），关键词限前 8 条 —— 否则 60 条关键词会把语义分区顶到屏幕外（用户截图里正是这样）。
- **模型离线加载（`rag/config.py`）**：实测 huggingface.co 连接超时（`WinError 10060`，重试 5 次约 30 s 后半离线）时，transformers 5.x 的 `AutoProcessor` 会走错分支并抛 `Unrecognized processing class in BAAI/bge-small-zh-v1.5` —— **整个向量层直接不可用**（本次重建与服务同时失败就是这个原因）。现改为「**本地已有模型快照就强制离线**」（`HF_HUB_OFFLINE`/`TRANSFORMERS_OFFLINE`），载入 **4.7 s → 0.26 s** 且不受断网影响。
- **阈值微调**：无关键词证据时的 medium 门槛 0.65 → **0.62**（实测离题上限 0.6096 之上、留最小余量），否则 `红外暗弱目标识别`(0.646) 这类正确语义命中会被压成 low。

## v261009.4

### 修「检索命中跳过去是目录/参考文献」+ pdf.js 本地化

- **入库端剔除噪声页**（`rag/pdf.py` 新增 `page_kind()`；`rag/build_index.py` 默认剔除、`--keep-noise` 可保留）：目录页罗列全部章节标题、参考文献页罗列大量领域术语，**关键词密度极高**，在向量检索里会被顶到前面，但作为证据毫无价值。逐页判定 refs / toc / front（标题命中 + 引用行占比 ≥0.55 + 点导引行数启发式，保守判定不误杀正文），实测剔除 **1,311 个片段**（PDF 片段 14,106 → 12,795；refs+toc+front 占比 4.9% → 1.6%）。判定逻辑改动由 `doc_updated = pdfv2` 指纹自动触发重嵌，避免「改了逻辑却没重索引」。
- **修跳转落点**（`web/literature.js`、`web/app.js`）：此前 `openByAttachment` 不接页码，`openPaper` 固定打开在 `last_page`（或第 1 页）——对学位论文而言那正是封面/目录，点 PDF 命中看到的就是目录。现在 `openPaper(id, page)` / `openByAttachment(att, page)` 支持指定页，RAG 命中**直接落到命中页**；并把目标页单独保存、**布局稳定后再兜底跳一次**（`build()` 期间的滚动监听 `track()` 会改写 `S.current`，这是上一版跳页失效的真正原因）。
- **新增可分享深链** `?paper=<PDF 文件名>&page=N`：直接打开该文献并定位到第 N 页。
- **pdf.js 本地化**（新增 `tools/fetch_pdfjs.py`；`web/vendor/pdfjs/` 187 个文件 / 3.2 MB，**本地专用不入库**）：加载改为「先试本地、失败回退 CDN」。注意**不能用 HEAD 探测**——工作台静态服务只实现 GET（HEAD 返回 501），探测会永远失败退回 CDN。收益：断网也能读 PDF；同时消除无头验收的假失败 —— `tools/shot_page.py` 的 `--wait` 实质是 `--virtual-time-budget`，**不等 JS 注入脚本与 worker 的加载**，凡依赖 CDN 的界面验证都会假失败（本次排查真实踩坑并已记入 `rag/README.md`）。
- **自检升级**（`tools/rag_check.py`）：断言改为与版本号无关的稳定标记（避免每次发版自检失效），新增 pdf.js 本地化与「跳转带页码」两项检查；实测 **42 项全通过**。

## v261009.3

### 火山方舟 Agent Plan 额度（AFP）查询工具 + 4.1-flash 抵扣系数实测

- **新增 `tools/ark_afp_quota.py`**（只读运维脚本，stdlib-only）：用火山引擎 AK/SK 对管控面 `GetAFPUsage`（`open.volcengineapi.com`，`service=ark` / `region=cn-beijing` / `Version=2024-01-01`，HMAC-SHA256 签名，与火山官方 nodejs/py demo 同形）查询套餐各窗口额度，打印配额/已用/剩余/已用%/重置时间与倒计时，并按实测系数把剩余额度换算成 token 与轮数（`--turns` / `--json`）。凭据取自环境变量 `VOLC_ACCESSKEY`/`VOLC_SECRETKEY` 或 `~/.dsh/.credentials.yaml` 的 refs 段，脚本不落盘、不打印密钥。
- **额度窗口实测**（该账号为 **Medium** 档）：5 小时 **10,000** AFP / 周 **35,000** / 月 **100,000** / 视觉日 **50,000**（`AFPDaily` 为视觉额度，文本调用不消耗）；周窗口每周一 00:00（北京时间）重置、月窗口随订阅日滚动。
- **deepseek-v4.1-flash 抵扣系数实测 = 100 AFP / 1M tokens（1 AFP = 10,000 tokens）**，且**输入与输出同价、缓存命中也同价**（不因 prompt cache 打折）。方法：火山 AFP 用量是异步聚合的，直接前后取差会把上一笔算进下一笔（首轮尝试就踩到），故改为「发请求 → 轮询 AFP 直到读数稳定 → 取差」的四个对照用例（11.7K 输入/1 输出、11.7K/222 输出、同前缀缓存命中 11,648、短输入/415 输出），四点一致拟合到 100.0 AFP/1M，残差 < 0.002 AFP。
- **额度换算口径**：Medium 月额度 100,000 AFP ≈ **10 亿 tokens/月**（4.1-flash）；5 小时窗口 10,000 AFP ≈ 1 亿 tokens。按每轮 25,500 tokens 计约 2.55 AFP/轮。注：当前系数是 2026-09-15~2026-10-30「deepseek-v4.1-flash 抵扣系数 5 折」活动的折后值，活动结束（2026-10-30 18:00）后同样 token 预计按双倍 AFP 计（**推断**，以官方公告为准）。
- **与按量付费的口径差异**：官方单价里输出约为输入的 4 倍、缓存命中约为未命中的 1/50，而 Agent Plan 内三者同价——套餐里输出密集与缓存命中密集的负载相对更划算，这也是套餐内 4.1-flash 单价被社区评为「性价比最低」档的原因之一（[Agent Plan 套餐概览](https://docs.volcengine.com/docs/ark/agent-plan-personal-plan-overview?lang=zh)、[套餐内 AFP 抵扣规则](https://docs.volcengine.com/docs/ark/agent-plan-personal-afp-credits-billing-rules?lang=zh)）。
- **新增 `--official`：把 AFP 额度折算成官方按量价格（CNY）**。单价表 `OFFICIAL_PRICES` 取 DeepSeek 官方「模型 & 价格」（`deepseek-flash` = DeepSeek-V4.1-Flash，2026-10-09 核对，与 `Workspace/System/billing/prices.json` 同源）： 缓存命中 ¥0.02 / 未命中输入 ¥1 / 输出 ¥4（空闲，高峰 ×2）。因为 1 AFP = 10,000 tokens，换算极简：**每 AFP 值 ¥0.0002（命中）/ ¥0.01（未命中）/ ¥0.04（输出）**；Medium 整月 100,000 AFP（= 10 亿 tokens）对应 **¥20 / ¥1,000 / ¥4,000**（空闲；高峰翻倍）。**方舟侧同模型的按量价目页是 JS 渲染、抓不到表格**，故一律按 DeepSeek 官方口径标注，若方舟加价则以控制台账单为准。
- **套餐值不值的分界线（写进脚本自动算）**：Medium 标价 ¥200 / 月摊到 10 亿 tokens = **¥0.2000 / 1M tokens**。空闲时段按量价相对该摊薄成本为 未命中输入 **5.0×** / 输出 **20.0×** / 缓存命中 **0.1×**；即「未命中输入 + 输出」为主时套餐明显划算，而**纯输入且缓存命中率高于 81.6%（高峰时段 91.8%）**时按量反而更便宜——这与「4.1-flash 在该套餐里性价比最低」的社区口径一致（缓存命中在套餐内不打折，吃掉全部红利）。活动结束（2026-10-30）系数翻倍后摊薄成本升至 ¥0.4/1M，平衡点前移到 61.2%。
- **真实负载结构下的点估计（代理口径）**：DSH 用量账本（`~/.dsh/storages/cost-meter/ledger.json`）里 2026-10-08 / 10-09 的 `opencode-go:deepseek-v4.1-flash` 长上下文 agent 流量，缓存命中率 **95.1% / 96.5%**，同样 token 按官方按量价只需 **¥0.0805 / ¥0.0677 每 1M tokens**，均低于套餐摊薄的 ¥0.2 —— 即**该结构下套餐比按量贵 2.5~3.0 倍**。结论只对该结构成立：短上下文、低缓存复用的调用（如工作台自身的小请求）落在另一侧。（该账本是本机 DSH 流量代理，不是方舟套餐自身的 token 结构，故仅作量级参考。）
- **跨厂商对照：阿里百炼 Coding Plan（2026-10-09 官网口径）**。Pro 高级套餐 **¥200/月**（新客首月 ¥39.90）= 每 5 小时 **6,000 次** / 每周 **45,000 次** / 每月 **90,000 次**「模型调用」，5 小时额度**滚动释放**（每分钟释放 5 小时前的额度），周额度周一 00:00、月额度按订阅日重置；模型为 qwen3.7-plus / qwen3.6-plus / kimi-k2.5 / glm-5 / MiniMax-M2.5 等，**不含 DeepSeek**。与方舟同为 ¥200/月，但一侧按「次」、一侧按「token（AFP）」，桥接量是「单次调用多少 token」：**交叉点 = 5 小时 16,667 / 周 7,778 / 月 11,111 tokens/次**；单次超过 ~11k tokens（长上下文 agent 常态）时按次计费给得更多——按本机实测均值 278.7k tokens/次算，月额度 90,000 次 vs 方舟 3,588 次（**25.1×**），1,000 次 × 100k tokens 的同等负载阿里 **¥2.22** vs 方舟 **¥20**（便宜 9×）。另：千问 Token Plan（Credits 计量、含 deepseek-v4.1-flash、**无周限额**）档位 Lite ¥39/11,500、Essential ¥79/25,500、Standard ¥139/45,000、Pro ¥499/180,000，加油包 ¥100/20,000 Credits，但 **Credits↔token 官方未公开固定表**（随模型/思考模式/工具调用变化，只能看控制台用量分析），且**阿里侧无 API 化额度查询**（对比方舟可用 AK/SK 直查 `GetAFPUsage`）。两家均禁止把套餐 Key 用于脚本/后端等非交互调用。
- **Credits↔token 实测校准 + 与方舟的额度对比**（补上前一条的缺口）。锚点：社区用户 2026-10-05 自述 Pro 档（¥499/180,000 Credits）5 天全程 qwen3.8-flash，消耗 **21,258 Credits**，token 明细 **未命中输入 179.66M / 缓存命中 1,121.59M / 输出 2.64M**（合计 1.304B tokens，缓存命中占 86.0%）；按千问官方按量价（¥0.8/¥0.1/¥2.7 每百万）折得等值 **¥263.01**。由此：**每个 Credit 值 ¥0.01237 官方等值金额**，**混合口径 16.3 Credits / 1M tokens**（按价目比例拆分 ≈ 64.7 / 8.1 / 218.2 Credits 每 1M 输入/缓存/输出），与插件内置 2026-08 表（qwen3.7-plus 15/1.5/60、deepseek-v4-flash 3/0.3/12 等）**量级一致但数值不同**——旧表只能当相对参考。各档位可跑 tokens（同负载形状）：Lite 0.71B / Essential 1.56B / Standard 2.76B / Pro **11.04B/月**，折合 **¥0.045~0.055 / 1M tokens**；方舟 Medium 为 **1.00B/月、¥0.2000 / 1M**（4.1-flash，1 AFP = 10,000 tokens）。**同一份 5 天负载**打两家：阿里 Pro 只占月额度 **11.8%**（Sticker ¥58.93），而方舟要 **130,389 AFP = 月额度的 130.4%**（直接打穿，且该负载每天 26,078 AFP，**1.34 天就吃满一周额度**）。价值倍数：阿里 **4.46×**（¥263 等值 ÷ ¥58.93），方舟 **0.82×**（同形状按 DeepSeek 官方价等值 ¥212.65，却需 ¥261 的订阅额度）——**该负载形状下 Token Plan 的每元价值约为方舟的 5.4 倍**；但按类目看，qwen3.8-flash 在 Pro 档为 ¥0.179/1M 未命中输入（≈方舟的 ¥0.2，基本打平）、¥0.0225/1M 缓存命中（方舟的 1/8.9）、¥0.605/1M 输出（方舟的 3.0 倍贵）——**优势全部来自缓存命中打折与按次/按量解耦，输出密集负载反而方舟更便宜**。




## v261009.2

### RAG 接入文献 PDF 全文 + 界面入口（全局搜索「语义检索」分区）

- **56 篇文献 PDF 全文入库**（新增 `rag/pdf.py`，改 `rag/build_index.py`）：PyMuPDF 逐页提取并按页分块、保留页码；经 `documents.attachment` 挂回文献条目（实测 **56/56** 精确对应），因此命中 PDF 片段时引用的是**知识库条目 id + 页码**（如《高轨非合作目标多视线分布式相对导航方法》第 3 页），而不是裸文件名。语料由 199 条 md（3,093 块）扩到 **17,199 块**（+14,106 块 PDF / 460 万字符）；56 篇全部含文本层，无需 OCR，扫描件会被跳过并记入 `meta.pdf_no_text`。
- **界面入口**（`web/app.js`、新增 `web/v261009-rag.css`、`web/index.html`）：全局搜索（Ctrl/⌘K）弹窗改为「关键词」+「**语义检索 · 含 PDF 全文**」双分区，标题行显示 RAG 状态条（`RAG 就绪 · 17199 个片段` / `服务未启动（仅关键词可用）`）；PDF 命中显示 `PDF p.N`，点击直接进 PDF 阅读工作区并提示命中页码；`low` 置信度附「属候选线索，请核对原文」。新增深链 `http://127.0.0.1:8765/?q=关键词` 直接打开搜索（便于分享与自动化验收）。
- **新增两个 HTTP 接口**（`server.py`）：`GET /api/rag/search`（混合检索，含 PDF）与 `GET /api/rag/status`（服务/索引状态）；源码模式复用 `rag.client`（含自动拉起与降级），打包 exe 无 `rag/` 包时退回对 8770 的 HTTP 调用。
- **拒答与置信度重设计**（`rag/search.py`、`rag/eval/threshold.json`、`rag/eval/run_eval.py`）：实测发现**用分数做拒答会藏掉正确结果** —— 跨语言/改写型查询的正确答案常只有 0.55~0.61（「传感器切换时的配准」→《Cross-Spectral Navigation with Sensor Handover》=0.593），而离题命中可达 0.610；且绝对分、`top1` 相对全库的 z、`margin` 三种信号都无法分开两类（`rag/eval/signal_experiment.py`，8/8 重叠）。故改为：**硬拒答**只在「FTS 无命中且相似度 < 0.45」；**confidence 按证据结构**给 —— `high` = 关键词 ≥3 命中且向量 ≥0.62，或向量 ≥0.75；`medium` = 有关键词命中，或向量 ≥0.65（高于实测离题上限 0.6096）；`low` = 仅弱语义召回，**仍返回结果**并提示核对。
- **终测**（60 条冻结评测集）：Recall@5 **0.981**、MRR@10 **0.874**、负样本高置信误标率 **0.000**（改前 0.750）。
- **修一个破坏性缺陷**：`build_index.py` 的增量指纹原先按 `doc_id` 聚合，而同一文献条目同时有 md 正文块与 PDF 全文块时会互相污染；且 `--pdf-only/--limit` 运行会把未选中分域误判为「已消失」而删除（曾误删 3,093 个 md 块）。现按 `(doc_id, source_type)` 分域，且「存活全集」取自完整语料而非本次子集，并加注释防回归。

## v261009.1

### 知识库检索升级：中文分词修复 + 本地 RAG 混合检索（新工具 `kb_retrieve`）

- **FTS 中文短词失效修复**（新增 `app/kb_segment.py`；改 `app/perf_index_db.py` / `perf_index_core.py` / `perf_index_query.py`）：`documents_fts` 原用 `tokenize='trigram'`，要求 token ≥ 3 字符，「质心 / 滤波 / CW」这类最高频领域短词在 `MATCH` 下恒为 0 命中（27 词实测仅 12 命中）；且旧查询把整串查询当**一个短语**，多词与整句查询（「卡尔曼滤波 状态估计」「统一燃料模型…口径」）必然 0 命中——线上实测确认。改为 **unicode61 + 中文 bigram 预分词**（写入侧与查询侧共用 `kb_segment.segment()`，杜绝切分漂移），新增 `seg` 列专供 MATCH，`title/body/tags/projects` 仍存原文以保留 LIKE 兜底与原文展示；查询改**三段式**：词间 AND → 词间 OR → LIKE 全表扫。旧库自动迁移（DROP 重建 + `meta.fts_backfill_pending` 由 `sync()` 消费触发一次全量回填），因此 `ws_reindex` 之后仍然生效。
- **FTS 修复实测**（60 条固定评测集，`rag/eval/run_eval.py`）：纯关键词档 Recall@5 **0.154 → 0.385**、MRR@10 **0.070 → 0.183**；运行中服务实测「卡尔曼滤波 状态估计」0 → 11 条、整句查询 0 → 54 条、2 字词「质心」仍可检索。
- **新增本地 RAG 检索层 `rag/`**（可选组件，工作台仍保持 stdlib-only + 便携 exe）：`bge-small-zh-v1.5`（GPU fp16，RTX 4060）向量 + 工作台 FTS + wikilink 图扩展，RRF(k=60) 融合。服务为独立进程（`rag/service.py`，127.0.0.1:8770，模型常驻显存），客户端 `rag/client.py` 为 stdlib 且**服务不可用会自动拉起、再失败则降级为 FTS+图**并在 `caveats` 明确说明。向量索引 `Workspace/System/Cache/rag.sqlite`（派生可重建，已被 `Workspace/.stignore` 排除同步），模型权重在 `.rag/models`（gitignore，约 95 MB）。
- **融合档实测**：Recall@5 = **1.000**、MRR@10 = **0.897**、负样本误召回 = **0.000**。拒答规则 = 「FTS 无命中 **且** 最高向量相似度 < 0.58」——纯向量分数不可分（实测负样本最高 0.572 > 正样本最低 0.447），必须与关键词信号组合；阈值标定脚本 `rag/eval/calibrate_threshold.py`，工作点扫描见 `rag/README.md`。
- **两处与原始方案的偏差（均有实测依据）**：① **条目不能整条嵌入**——kb 条目均约 8 KB ≈ 3000+ 中文字，远超 512 token 上限，整条嵌入只剩前 16%，改为 380 字/块（199 条 → 3093 块）+ 按 doc 聚合取最高分；② **图不进主排序**——含 graph 的 RRF 组合 MRR ≤ 0.790，而 vector + fts(0.5) = 0.897，故图只作 `related[]` 关联条目单独输出。
- **新增 `kb_retrieve` 工具**（MCP 第 26 个：`mcp/tools_workspace.py`；工作台内置 Agent：`app/agent_tools.py`，打包 exe 无 `rag/` 包时自动退回 HTTP 调用）：参数 `query / topk / use_vector / use_graph / auto_start`，返回 `sources[]`（doc_id、标题、类型、片段、score、in_fts/in_vector）+ `confidence` + `caveats` + `related[]`；`reader` 人设默认白名单已加入该工具（**已存盘的人设需在设置页勾选**）。
- **文档**：新增 `docs/kb-RAG可行版方案.md`（可行版方案：10 处事实核对修正、决策记录、阶段验收、执行日志）与 `rag/README.md`（跑法/评测/排障/设计取舍）。

## v261008.2

### 知识库数据结构升级：实验独立成类 + 类型化关系层（底层变更，需重启生效）

- **实验升格为第七类 `experiment`**（`app/store.py`、`app/workspace.py`、`mcp/constraints.py`、`mcp/naming.py`、`mcp/tools_knowledge.py`、`web/app.js`）：目录 `Knowledge/Experiments`、前缀 `实验-`、状态机 计划/进行中/完成/受阻/已归档、日期字段 `record_date`、实验专用正文骨架（摘要/目标与假设/配置与参数/数据与口径/结果/结论与失效模式/留档路径/关联）。原先作为 `note` 类别词的「实验」**废弃**：`mcp/naming.py` 新增 **T020 error** 并在提示里给出迁移出路，T017 编号校验改按 `kind == "experiment"` 判定。前端新增「实验」导航/路由/状态机，图谱节点类别、`KIND_ROUTE`/`routeByKind`/`PAGE_META` 同步。
- **新增 `kb_change_kind` 工具与 `store.change_kind()`**（结构性迁移的唯一合法途径）：`id`/`created` 不变，目录随动、标题前缀改写、首个 H1 同步、状态映射、`kind_marks` 补齐，可选重写全库交叉引用；默认返回迁移计划，`dry_run=false` 才落盘。通用 `kb_update_entry` 仍然拒绝改 `kind`（`IMMUTABLE_FIELDS` 未变）。
- **关系层：关联段小标题 → 类型化边**（`app/store.py` 的 `RELATION_SECTIONS` / `RELATION_LABELS` / `iter_body_links()`，`app/perf_index_core.py`）。关系类型：`uses-knowledge`（依据的知识）、`uses-data`（用到的数据）、`cites`（引用文献）、`series`（同系列实验）、`chain-prev`/`chain-next`（上一/下一环节）、`produces`（产出与汇总），未命中一律退化为通用 `wikilink`。**不新增 frontmatter 字段**；历史条目沿用行内标签写法（`- 方法条目：[[…]]`）即被识别，存量内容无需改写。`graph_edges` 对类型化边**双写**通用 `wikilink` 边，保证只认旧类型的消费方（含前端默认筛选）不受影响。
- **索引结构变更**（`app/perf_index_db.py`）：`SCHEMA_VERSION` 2 → **3**；`document_links` 主键由 `(doc_id, token)` 扩为 `(doc_id, token, role)`，旧库检测缺列后整表重建（纯派生数据）并强制全量重索引；`_rebuild_graph_edges()` 按 role 建边。同步修掉一处**静默失败**：`sync()` 原先把 `OSError`/`UnicodeError` 直接 `continue`，条目会"凭空消失"而无任何提示，现在返回结果带 `skipped` 列表。
- **通用基础知识归属**（`app/perf_index_query.py`、`mcp/bridge.py`、`mcp/tools_knowledge.py`、`server.py`、`web/app.js`）：`kb_list_entries` 与 `GET /api/docs` 新增 `tag`（标签精确筛选，此前只能靠全文搜索命中）与 `unowned`（只看未归属项目）两个过滤维；列表页新增标签筛选项、「未归属项目（通用基础）」与「仅未归属」。约定：跨项目通用知识 `projects` 留空 + 标签 `通用基础`，不建伪项目（避免污染项目仪表盘/里程碑/待办）。
- **新增 `tools/kb_tree.py`**：只读派生索引生成四张视图 —— 知识树（按类别词分层、按"被几个实验交叉使用"分档）、交叉使用清单（同一知识被 ≥N 个实验共用）、实验依赖视图（依据知识/用到的数据/同系列/环节链/产出）、通用基础清单、实验链条与系列；支持 `--section` / `--min-shared` / `--out`，默认输出到 `Workspace/Knowledge/Exports/KnowledgeTree/`。
- **新增 `tools/kb_migrate_experiments.py` 并已执行迁移**：25 条 `知识-实验-…`（note）→ `实验-…`（kind=experiment），`id` 不变、状态按 稳定→完成 / 草稿→计划 / 整理中→进行中 映射、补 ⚗ 标记，全库**改写 139 处**按旧标题写的 WikiLink；并给 DUST 在轨链路（4.5–4.8b，5 条）与 GEO 多对一制导（4 条）两条实验线补 `### 同系列实验` 互指关系。复核：194 条（note 85 / experiment 25 / literature 67 / journal 6 / idea 4 / summary 4 / milestone 3），命名体检零 error。
- **关系实测**（迁移+重建后）：`uses-knowledge` 47、`produces` 6、`chain-prev` 4、`chain-next` 3、`series` 两条系列、`wikilink` 236（保底）、`tag` 1140、`project` 195；`知识-方法-WCS 星图定姿与坏帧判据` 被 7 个实验交叉使用，`知识-方法-受控归因诊断`/`帧间稳像与链式配准` 各 4 个 —— 即"哪些实验交叉使用同一知识"已可直接查出。
- **关系层内容补录（同批次，证据驱动，不发明引用）**：① 建 5 条数据集条目（`知识-数据集-DUST 在轨实测（SET 1 / SET 2）`/`NUAA-SIRST`/`IRSTD-1K`/`NUDT-SIRST`/`SIRST-v2（已退出评测口径）`），把实验反复点名却从未建档的数据集变成可引用对象（未确证的数字不写，标"待补"）；② 按"该实验正文自己点名了某数据集"补 `### 用到的数据` → `uses-data` 25 条边（DUST 10 / NUAA-SIRST 7 / IRSTD-1K 3 / NUDT-SIRST 3 / SIRST-v2 2）；③ 把正文里**以纯文本形式完整出现**的文献题名补成 `### 引用文献` 链接 → `cites` 50 条边、26 个条目获得引用小节；④ 17 条教科书级通用方法（亚像素质心五法、Top-Hat/LCM/SR/IPI、CKF/SCKF/EIF/IF、LQDG/Stackelberg/Minimax）清空项目归属并打 `通用基础` 标签。补录后：199 条（note 90 / experiment 25 / literature 67 / journal 6 / idea 4 / summary 4 / milestone 3），关系边 `uses-knowledge` 52 / `uses-data` 25 / `cites` 50 / `series` 32 / `produces` 7 / `chain-prev` 4 / `chain-next` 3 / `wikilink` 325（保底），未归属条目 23 条。补录脚本一处教训：同批次多次改同一个「关联」段时必须**改前重读磁盘正文**，否则后一步会用旧快照覆盖前一步（本批次踩到并已修正重放）。
- **修复 `_normalize_projects()` 的幽灵归属**（`app/store.py`）：该函数原先只同步 `projects`/`project`，清空归属时残留的 `project_id`/`project_ids` 会让索引（`document_projects` 同时看名字与 id）仍按项目计入——即"清不掉的归属"。现改为名字清空时同步清 id。
- **列表排序口径改为「置顶优先 + 加入时间」**（`app/perf_index_query.py`、`mcp/bridge.py`、`mcp/tools_knowledge.py`、`server.py`、`web/app.js`）：原排序是 `pinned DESC, updated DESC`，而 `updated` 只代表"最近被写入"——登记 PDF 附件、批量建档、改名同步交叉引用都会刷新它，于是条目会在**没有任何编辑**的情况下跳到列表最前，看起来像被置顶却没有 📌 徽章（2026-10-08 用户实测反馈：点击引用的文献后该条目排到列表最前）。现在默认排序为 `pinned DESC, COALESCE(added_date, record_date, created, updated) DESC, id DESC`（文献按收录日期、日志/总结/实验按记录日期、其余按创建时间），并新增 `sort` 参数（`added` 默认 / `updated` 最近更新 / `title` 标题）与列表页「排序」下拉（选择记忆在 localStorage）。`kb_list_entries` 同步新增 `sort`；`GET /api/docs` 新增 `sort` 查询参数。**注意**：文献的 `added_date` 是同一批次（2026-09-24），因此该页默认会退化为稳定的 id 顺序——需要"最近动过的靠前"时切到「排序：最近更新」即可。
- **PDF 阅读工作区「信息」面板重排**（`web/literature.js`、`web/literature.css`）：原来是一列裸 `<label>+<input>`（字段与值同权重、标签与输入框混排、长题名被输入框横向截断、标签区"＋"按钮悬在右侧独立一列、内容超长会被裁切且没有滚动），现改为：① 四个分组卡片「基本信息 / 分类标记 / 标签 / 引用信息」，字段统一为"小号灰标签 + 值"的上下结构，输入框有独立边框与聚焦环；② 题名改为 textarea 并**按内容自动增高**（`fitTitleHeight()`，长中英文题名不再被两行裁掉）；③ 年份 / 阅读状态并排（88px + 自适应），DOI 与 Cite Key 各占满行（原来 DOI 被挤到截断）；④ 标签区去掉外框与独立的"＋"按钮列，改为 `＋ 添加` 虚线胶囊放在小节标题右侧，与分类标记的「＋ 自定义」风格统一；⑤ 面板底部新增**常驻操作条**（`position:sticky`）：`保存信息` + `📂 打开所在文件夹` 始终可见；⑥ `#lit-side-body` 补 `overflow:auto`，长内容可滚动不再被裁切；⑦ 全部使用主题变量（`--surface-2` / `--line` / `--accent` / `--accent-soft`），明暗主题同时适配。所有元素 id 保持不变，`saveInfo` / `renderLiMarks` / `paintLiTags` 无需改动。验证方式：把 `infoHtml` 与 `fitTitleHeight` 从 `literature.js` 原样提取、加载真实 `styles.css` + `literature.css`，用无头 Chrome 在 340px 宽下渲染明/暗两套主题并与长英文题名样例逐一核对（截图见 `.scratch/preview/panel-info-*.png`，属本地临时产物，7 天后自动清理）。
- **文档列表降密度与筛选区整理（v261008.2d）**（`web/app.js`、`web/literature.js`、`web/styles.css`）：针对"内容多、繁琐、不好梳理"，① **摘要去重**：正文摘要通常以「条目标题 + 段落名（BibTeX / 核心结论 / 想法 …）」开头，与标题重复且无扫描价值，`excerptOf()` 先剥标题前缀（按标题分词做弹性匹配，连字符/空格差异也能剥）再剥已知段落名，完整摘要保留在 `title` 提示里——实测「文献 Cooperative space object tracking… BibTeX 核心结论 研究基于…」→「研究基于一致性滤波的协作空间目标跟踪…」；② **卡片结构由四块压到三块**：状态 / 置顶 / 附件 / 分类标记（最多 3 个）/ 项目 / 日期合并为**单行元信息**（`nowrap` + 不溢出，日期靠右），置顶与附件徽章缩短为 `📌` / `⧉`（提示保留全称），日期徽章去掉「更新 」前缀；③ **筛选区文案缩短**：`排序：加入时间`→`加入时间`、`按标签精确筛选（可输入）`→`标签筛选`、`仅未归属`→`仅通用`，细说明移入 `title`，消除窄栏里的截断；④ 紧凑档下卡片内边距 8→6px、列表间距 5→4px。**列表页与 PDF 阅读区「文献库」共用同一套卡片口径**（`ERWExcerptOf` 跨脚本复用）。
- **修复一处既有布局缺陷：列表在高窗口/条目多时把条目压扁成文字叠印**（`web/styles.css`）：`.doc-list` 是 grid 容器且缺少行高约束，窗口变矮或条目变多时各行被压缩，标题与摘要叠在一起无法阅读（实测在 1000×700 窗口下 67 条不可读；用户此前 2560×1440 未触发）。现加 `grid-auto-rows:max-content` + `.doc-item{flex-shrink:0}`，列表**按内容高度成行、超出即滚动**，不再压扁。同时把列表标题/摘要的截断从 `-webkit-line-clamp` 改为**固定行高上限 + 硬裁剪**（`max-height:2.7em/2.8em` + `overflow:hidden`）：clamp 在部分渲染器（字体回退/缩放）下会"算 N 行高、画 N+1 行字"导致越界叠印，用 max-height 与行高解耦后行为稳定。以上两点均以**运行中的工作台实拍截图**核对（列表页 · 文献 / 灵感，含置顶、多标记、多项目、长中英文题名四种情形）。
- **卡片信息量回退 + 顶部筛选区重做（v261008.2e）**（`web/app.js`、`web/literature.js`、`web/styles.css`）：上一版（v261008.2d）把卡片压成单行元信息后，用户实测反馈「过于紧凑、原先能展示的更多信息都没了」——具体是项目名被截成「红…」、分类标记只留 3 个、日期徽章丢掉「更新」语义。按反馈回退并重做：① **卡片恢复两行元信息**（状态 / 附件 / 📌置顶 / 分类标记一行 + 项目与日期一行），项目名完整显示（仅在徽章自身宽度内省略）、标记不再截断、`⧉ 附件` 与 `更新 <日期>` 文案复原；② 保留**无信息损失**的两项改进：摘要去重（`excerptOf`：剥标题前缀与段落名，完整原文留在悬停提示）与列表「按内容成行、超出滚动」（`grid-auto-rows:max-content`，修掉条目被压扁成文字叠印的既有缺陷），标题/摘要截断继续用 `max-height` + `overflow:hidden`；③ **顶部筛选区重做为三段式**：表头「筛选 · 清除」（一键复位搜索/状态/项目/分类/标签/仅通用）、条件区（状态与项目、分类与排序两列，加「标签筛选」输入与「仅通用」胶囊开关）、虚线分隔的操作区（批量导出 BibTeX / PDF 阅读工作区）；④ 非默认筛选项自动高亮（`--accent` 描边 + 浅底），一眼看出「列表为什么变短」；⑤ 修掉「标签筛选」输入框因缺少跨列、在两列网格里被挤成一个字的缺陷。列表页与 PDF 阅读区「文献库」同步应用（`ERWExcerptOf` 跨脚本复用）。
- **日期徽章固定列，列表内纵向对齐（v261008.2f）**（`web/styles.css`）：日期徽章原先紧跟在项目徽章之后，横向位置随项目名长短浮动，同一屏里几个日期参差不齐、不方便按时间扫。现给 `.doc-item .doc-projects .badge.mono` 加 `margin-left:auto`（推到行右端）+ `min-width:88px` + `justify-content:center`（统一占位，短日期也不会缩成小块）+ `font-variant-numeric:tabular-nums`（等宽数字），并让项目徽章 `flex:0 1 auto` 先让位。列表页与 PDF 阅读区「文献库」共用该规则，日期在所有卡片上落在同一列（实测「实验」页 2026-10-08 两处完全对齐）。
- **筛选表头重做：去掉常驻的「筛选 / 清除」裸文字（v261008.2g）**（`web/app.js`、`web/styles.css`）：上一版把「筛选」与「清除」两个裸文字并排放在顶部，看起来像飘在控件上方、且「清除」永远挂着（没筛选时点它毫无作用）。现改为：① 表头写成 **「筛选条件」小节标题 + 一条分隔线**，与下方控件形成明确分组；② 「清除筛选」改为**右对齐的胶囊按钮**（带 `×` 图标 + hover 用主题色），并且**仅在确有筛选条件时才出现**（无筛选时 `hidden`，不占位、不突兀）；③ 按钮的 `title` 会列出当前生效的条件（如「清空以下筛选：状态=稳定、标签=DUST、仅通用」），并在每次筛选变化时同步刷新，点一下即全部复位；④ 「非默认条件高亮」（v261008.2e）与它配合：高亮的控件 + 一行条件说明，能立刻回答「列表为什么变短」。两种状态都已渲染核对（默认态只有标题与分隔线；有筛选态显示 `× 清除筛选` 胶囊 + 高亮控件）。
- **标题长度限制（显示宽度口径，v261008.2h）**（`Workspace/System/AI助手写作与建档规范.md`、`mcp/constraints.py`、`mcp/naming.py`、`tools/kb_smoke.py`）：列表里超长标题会占两三行、规范上却没有一条上限。现按**显示宽度**（1 个汉字 = 2、1 个拉丁字符/数字/半角符号 = 1，Unicode East Asian Width；例 `实验-星特朗 NexStar 6 SLT 配件档位实测（W1）` 字符数 30、显示宽度 44）定两级限制并落到校验器：① **硬上限 60 半角当量**（≈30 汉字）→ 新规则码 **`T021`（error，写工具拒写）**；② **建议值**：单主题类（`知识-`/`实验-`/`灵感-`）≤ **44**（≈22 汉字）、流水与收口类（`日志-`/`总结-`/`里程碑-`）≤ **56**（≈28 汉字，承载当日多事件）→ **`T022`（warn）**；③ **`文献-` 题名照抄原文，豁免长度上限**；④ 阈值按全库 199 条的显示宽度分布收敛（命中约 3.5%）——最初设的 36/48 会让 29 条（15%）报警，等于把"规范"变成噪声。规则写入三处：写作规范 §一 第 7 条（含"超长了怎么改"、"末尾全角括号里的编号/版本不删"、"进入列表不超过两行"的判据）、`mcp/constraints.py` 的 `TITLE_WIDTH_RULE` + `TITLE_WIDTH_LIMIT` + `TITLE_WIDTH_WARN`（`kb_constraints(topic=naming)` 直接渲染）、`mcp/naming.py` 的 `display_width()` 与 T021/T022 检查。**执行结果**：修正 2 条越界标题（`总结-阶段 2 单帧深度学习 IRSTD 基线（BasicIRSTD 9 模型 × 3 数据集）` 67→35、`日志-星点质心算法对比 4.1 完成、星图识别与 WCS 解算 4.2 未收敛` 62→58；两条正文均已含括号内信息，故缩短无信息损失，`naming.rewrite_references` 各改写引用 1 处并重建索引）；全库现为 **T021 error 0 条 / T022 warn 6 条**；`tools/kb_smoke.py` 新增 5 条断言（宽度口径、两级阈值、文献豁免）全部通过。⑤ 顺带修掉一处**与文档承诺相反**的实现：`app/config.py::writing_rules()` 原本只在进程内缓存一次，而规范文档自称「修改本文档即对所有人生效，无需改代码」——实际必须重启工作台才生效。现按文件 mtime 重读（同进程实测：改文件后下一次读取立即返回新内容，还原后逐字一致），因此**写作规范类改动无需重启**，改了就在下一次对话里生效。
- **PDF 阅读区「笔记」面板重排（v261008.2i）**（`web/literature.js`、`web/literature.css`）：原面板是「一个 100vh 高的 textarea + 一条被挤到换行的操作条」——按钮文案折成两行、编辑区比面板还高、Markdown 只能读源码。现改为：① 新增 **「编辑 / 预览」切换**（复用既有 `.view-tabs` 样式）：预览态用 `mdLite()` 渲染标题、BibTeX 深色代码块、列表与行内代码，并复用 `.md-preview` 排版；② 编辑区改为**贴合面板高度**（`flex:1 1 auto`，不再用 `min-height:calc(100vh - 245px)`），面板底部不再被撑出屏幕；③ 操作条 `flex:0 0 auto` + 按钮 `white-space:nowrap`，`插入图片 / AI 整理` 在左、`保存笔记` 右对齐（`margin-left:auto`），**一行放得下**；④ 提示文案「与知识库条目正文同源 · Ctrl+S 保存」移到标题行右侧（`margin-left:auto` + ellipsis），不再与按钮抢位置；⑤ 编辑区字体由等宽改为继承正文字体、`line-height:1.75`、去掉 `resize`（高度已自适应）；⑥ 预览态下点「插入图片 / AI 整理」先切回编辑态（否则内容插进隐藏的 textarea、界面无反馈）。验证：把 `note()` 的 markup 表达式与 `mdLite` **从源码原样提取**后渲染两态，诊断实测编辑态 `textarea=479px`、预览态 `preview=479px`（二者互斥显示），操作条一行、保存按钮右对齐均已核对。
- **PDF 阅读区右栏可调宽：拖拽 / ⇔ 一键加宽（v261008.2j）**（`web/literature.js`、`web/literature.css`）：340px 固定宽的右栏写长笔记太挤（一屏约 22 汉字/行）。现改为：① `.lit-shell` 的第三列改用 CSS 变量 `--lit-side-w`（默认 340px），新增 `ensureSideResizer()`——在栅格 12px 间隙里绝对定位一个 **12px 拖拽把手**（不占栅格轨道），`pointerdown/move/up` + `setPointerCapture` 实时改宽，范围 260–`litSideMax()`（窗口宽 58%，封顶 760px），拖完写入 `localStorage.litSideW` **持久化**，打开文献时自动恢复；② 侧栏 tabs 行右侧新增 **`⇔` 一键加宽/还原**按钮（340 ⇄ 560px），双击把手也可复位；③ 窗口缩小时 `resize` 监听自动收回超限宽度；④ 原 `.lit-side-tabs` 是 `repeat(4,1fr)` 的 grid，直接 append 会让按钮落到第二行——改为 `repeat(4,1fr) auto`（保持原观感，按钮独占窄列）。加宽对**四个标签页都生效**（信息/批注/笔记/AI），不只笔记。**验证**：把 `litSideW/litSideMax/applyLitSideW/ensureSideResizer` 四个函数从源码原样提取，用合成 `PointerEvent` 真的拖一次把手，实测 `340px → 点 ⇔ 560px → 向左拖 100px 660px`、`localStorage.litSideW` 同步为 660、上限 760px；把手与按钮均已注入、tabs 不再换行（截图见 `.scratch/preview/右栏加宽-验证.png`）。
- **笔记编辑区高度链修复（v261008.2k）**（`web/literature.css`）：上一版只让编辑区「贴合面板高度」，但 `.lit-side` 右栏本身**不是 flex 容器**，`#lit-side-body` 的高度=内容高度，于是 `.lit-note-wrap{height:100%}` 退化成 `auto`，textarea 只能撑到 `min-height:160px`——实测就是用户看到的"高度太低"。现补齐整条链路：`.lit-side{display:flex;flex-direction:column}` → `#lit-side-body{flex:1 1 auto;min-height:0;overflow:auto}` → `#lit-side-body:has(>.lit-note-wrap){display:flex;flex-direction:column}` → `.lit-note-wrap{flex:1 1 auto}` → `.lit-note{flex:1 1 auto;min-height:200px}`。实测（788px 面板）：`lit-side=788 / side-body=740 / wrap=716 / **textarea=629** / actions=48`。顺带用同一链路让「信息」面板的常驻操作条（保存信息 / 📂 打开所在文件夹）真正钉在面板底部（`.lit-info{flex:1 1 auto}` + `.lit-info .li-actions{margin-top:auto}`），此前内容少时它只跟在内容后面、不贴底。
- **实测：图片 token 的真实开销与优化幅度（v261008.2i）**（新增 `tools/shot_prep.py`）：用工作台自己的 LLM 链路（`agent._http_json` 非流式请求读回 `usage`）对**同一屏 UI 的不同采集方式**各发真实请求，测得「图像占用 = 带图 `prompt_tokens` − 无图基线（35）」：2x 整窗 2000×1400（2.80 MP）**991**、1x 整窗 1000×700（0.70 MP）**428**、1x 只截列表面板 305×700（0.21 MP）**203**、极小 100×70（0.007 MP）**190**、4000×2800 与 6000×4200 同为 **991**。三条结论：① token 与**像素面积**相关、**与文件体积无关**（441 KB 压到 120 KB 一分不省）；② 存在**每张固定开销 ≈190**（地板）——图裁到 0.3 MP 以下几乎不再省，而**多张图应合并成一张**以摊掉地板；③ 存在 **provider 侧上限 ≈991**（>2.8 MP 不再增加），超大图无需再压。据此新增 `tools/shot_prep.py`（裁剪 + 像素预算 + 按实测分段曲线估算 token，六点误差 0%），并把默认采集方式从「2x 缩放整窗」改为「1x + 只截目标区域」：**单图 991 → 203 tokens（省 80%）**；仅改 1x 整窗省 57%；仅靠配置层把 2.8 MP 规范化到 1 MP 省 34%。**补充实测（图片留在上下文里逐轮传递的花费）**：对同一段历史连发 4 次请求（首轮 / 相同请求重发 / 追加一轮新用户消息 / 再重发）读取 `prompt_tokens` 与 `cached_tokens`——① 图片的占用**每一轮都完整出现在输入里**（R1=R2=R3 中图的部分不变，追加一轮只 +6~7 tokens，说明历史含图仍全程重发）；② 缓存是否命中由**前缀长度**决定：纯文本 39 tokens 与小图 249 tokens 两次相同请求 `cached` 均为 **0**（不命中），而大图 1030 tokens 的请求 `cached=896`（命中 87%）——据此推断本端点存在约 **1024 tokens 的缓存门槛**（待进一步标定）；③ 由此产生一个反直觉结论：**按 token 计的配额，裁剪省 80%；但按 API 金额算未必省钱**——大图每轮 1030 tokens 中 896 走缓存价（1/50），折合「全价当量」仅 158，而裁到 249 tokens 的小图完全不走缓存、每轮 249 全价，两者每轮金额相当（0.000158 vs 0.000249 元）。**选择策略取决于计费方式**：订阅按 token 计（如本机 OpenCode Go 的 5 小时窗口）→ 裁剪优先；按 API 付费 → 让历史足够长以触发缓存更划算。
- **UI 迭代省 token：一条龙截图工具 + 默认规范（v261008.2m）**（新增 `tools/shot_page.py`、`AGENTS.md`、`.trae/rules/UI迭代与截图成本规范.md`；`README.md` 工具段同步）：v261008.2i 已把"图片 token 的真实开销"测清楚并给出裁剪工具，但**没有一条让 agent 默认照做的规范**——本轮实测的浪费正出在这里（同一轮里反复拍 2x 整窗 2000×1520 ≈ 991 tokens/张，而 1x 裁到面板 ≈ 203）。三件事补齐：① **一条龙工具 `tools/shot_page.py`**：无头浏览器采集（默认 **1x** + `--max-mp 0.3` 像素预算）→ 复用 `shot_prep.py` 的标定做裁剪/压缩 → 直接打印「像素/体积/估算 token/本轮省多少」；修正了两个真实踩过的坑（Chrome 的相对路径写不进截图 → 强制 `Path.resolve()`；Windows 默认 GBK 解 Chrome 的 UTF-8 输出抛 `UnicodeDecodeError` → 显式 `encoding="utf-8"`），并**每次新建临时 profile**，根治反复出现的"改了 CSS 但截图没变"缓存假象。实测：1x+裁到面板 **207 tokens** vs 1x 整窗 286 vs 2x 整窗 661。② **`AGENTS.md`（新增，仓库级 agent 约定）**：仓库速览、5 条硬约束（kb_* 工具建档、命名规范 error 级拒写、`Workspace/` 是用户数据、长驻进程改代码需重启、临时数据进 `.scratch/`）、以及"UI 迭代与截图成本规范"默认行为。③ **`.trae/rules/UI迭代与截图成本规范.md`（新增）**：把 v261008.2i 的实测表、做法优先级、**缓存命中门槛的决策规则**写成可执行清单。**关键补充（来自 v261008.2i 的隐藏结论）**：本端点存在约 **1024 token 的缓存门槛**——前缀 39/249 tokens 的相同请求 `cached` 均为 0，而 1030 tokens 的请求 `cached=896`（87%）；因此"裁图"与"吃缓存价"会互相拉扯：**订阅/按 token 配额 → 裁剪优先（缓存也占配额）**；**按 API 金额 → 先保证稳定前缀 ≥1024 tokens（本项目加载 `AGENTS.md` + `.trae/rules/` 已≈千 token 量级）再谈裁图**，否则小请求永远不命中、命中率恒为 0——这正是"命中率低"的机制性原因。**④ 规范升级为"全局 + 项目"两级（本轮追加）**：原先只有仓库级 `AGENTS.md`，换一个工作区就失效。实测出 DSH 的指令发现规则后补齐：新建 **`~/.dsh/AGENTS.md`（user-global 级，所有工作区自动加载）**，写入跨项目通用纪律——图片 token 的面积口径与三级对照表、文本度量优先、要截就裁/1x/一轮一张/不重发、压体积无用、**约 1024 token 缓存门槛与"配额 vs 金额"的决策表**、前缀杀手清单（时间戳/天气/随机 ID/频繁改系统提示/压缩/TTL 过期）、通用作业习惯（先看再动、验证用数据、临时产物不入库、用户数据只读优先、长驻进程需重启、收尾留痕）。仓库级 `AGENTS.md` 相应瘦身为**只写项目专属**（kb_* 建档与命名硬约束、`Workspace/` 是用户数据、长驻进程重启、`.scratch/` 约定、`mcp/` 不在 git 白名单、本仓库截图工具与工作台 URL），并在开头声明"通用纪律以全局为准、冲突时项目级优先"。机制已验证：`~/.dsh/AGENTS.md` 写入后**当轮即被注入**（系统提示出现 `user-global` 段），无需重启；`.trae/rules/UI迭代与截图成本规范.md` 覆盖工作台内置 AI 那一侧。
- **新增 `tools/kb_smoke.py` 冒烟测试**（只读、可重复）：覆盖关系解析（小标题/行内标签/小节继承/兜底类型）、命名规则（experiment 前缀与编号、旧类别词 T020、缺编号 T017）、归属归一化、关系边与 `document_links.role`、无幽灵归属、七类条目齐备、通用基础标签与未归属可查、`kb_tree` 五张视图可生成、约束主题渲染、实验迁移幂等，另加"列表排序口径"4 条与"文献口径统一/定位功能"6 条断言。当前 **全部通过**。
- **排序口径全局统一 + 新增「打开所在文件夹」**（`app/literature.py`、`server.py`、`web/literature.js`、`web/app.js`）：① PDF 阅读工作区左侧「文献库」原先按 registry 的 `updated_at` 排序（保存阅读位置、写批注、加批注截图都会刷新它），与知识库列表页口径不一致；现两端统一为**同一套三种模式**（`added` 加入时间＝默认 / `updated` 最近更新 / `title` 标题）与同一条**置顶优先**规则，`added` 取值范围也是同一条链（文献 → `added_date`，其余 → `record_date` → `created`），并且**共用 localStorage 的 `docSort`**：在任一页切换排序，另一页同步生效。阅读区列表同时补上 📌 置顶徽章与「加入时间」日期徽章（原为"最近写入"日期），`GET /api/literature` 新增 `sort` 参数。② 新增 `POST /api/literature/reveal`（`literature.reveal()`）：在系统文件管理器中**定位并选中该篇文献的 PDF**（Windows `explorer /select,`、macOS `open -R`、Linux `xdg-open` 打开所在目录），找不到 PDF 时退回打开 PDF 存放目录；**接口只接受 `doc_id`/`paper_id`，不接受任意路径**（路径一律由工作台登记信息解析），避免成为任意路径探测面。入口两处：文献编辑器「PDF 附件路径」右侧的「📂 打开所在文件夹」，以及 PDF 阅读工作区右侧「信息」面板底部同名按钮。
- **文档**：新增 `docs/KNOWLEDGE_RELATIONS.md`（对象层 / 关系层 / 索引与接口变更 / 迁移记录 / 内容补录 / 通用知识口径 / 论文引用层预留 / 已知陷阱）；`README.md` 增加「知识库结构（七类条目 + 关系层）」小节并更新开发目录；`kb_constraints` 新增 `topic=relations`，`kinds` 主题变七类矩阵，`schema`/`marks`/`playbook` 文案同步（`实验-` 建档、通用基础归属、`kb_change_kind` 红线）。
- 注意：本次只改源码，`ResearchWorkbench.exe` **未重新打包**；`VERSION` 升至 `v261008.2`。工作台 exe 与 MCP 服务是长驻进程，需**重启**后才加载新结构与新工具；重启前旧进程若刷新索引会按旧口径重建（派生数据，重启后自动恢复）。

## v261008.1

### Agent 接入 OpenCode Go（代理 / 直连）与火山方舟 Agent Plan

- 新增三套 Agent API 配置（`config/secret.json` 的 `profiles`）：`profile-opencode-go`（本机 `127.0.0.1:9355` 上的 opencode-go 反代理，`base_url=http://127.0.0.1:9355/zen/go/v1`）、`profile-opencode-go-direct`（**不经任何本地进程**，`base_url=https://opencode.ai/zen/go/v1`）与 `profile-ark-agent-plan`（`base_url=https://ark.cn-beijing.volces.com/api/plan/v3`，方舟 **Agent Plan 专属网关**）。接入本身不改变激活项；切换用 Agent 页顶部「API 配置」下拉或设置页「设为当前配置」。
- **新增档案级自定义请求头**（`profiles[].headers`）：opencode.ai 直连强制要求 `x-opencode-session`（缺它 400 `Request is missing x-opencode-session and cannot be routed efficiently`），工作台原先只发 4 个固定头，故 `app/config.py` 加 `_clean_headers()` 白名单化（头名须 RFC 7230 token、值禁 CR/LF、单值 ≤512 字符、最多 20 条），`app/agent.py` `_api_headers(api_key, extra)` 把它合并进**全部**请求路径（普通补全、SSE 流式、`/models` 探针、对话探针）；`Content-Type` / `Authorization` 由工作台接管不可覆盖，`User-Agent` 允许改写。实测只有 session 是硬要求，`x-opencode-request/client/project` 可省（保留以与官方 CLI 同形）。设置页「Agent API 配置」同步加「自定义请求头（JSON）」输入框（`web/v260922-agent-profiles.js`）。
- 请求模式：每套先给 6 个，默认 `deepseek-v4.1-flash`，另含「· 无思考」（`{"thinking":{"type":"disabled"}}`）、`deepseek-v4-pro`、`glm-5.3`、`doubao-seed-2.1-pro`、`kimi-k3`、`qwen3.8-flash`、`deepseek-v4-flash-vision-exp` 等，均按服务商实际可得模型逐个实测返回 200；超时给到 300s（推理模型长回答 + 阅读区 AI 助手非流式路径）。
- `app/agent.py` `test_connection()` 修复「能用但测不通」：方舟 Agent Plan 不提供 `GET /models`（404），新增回退分支——仅当 /models 报 404/405/501 时，用默认请求模式的模型发一次 16-token 对话探针，返回 `choices` 即判定连通（响应 `probe=chat_completions`、`message` 说明已改用探针）；401/429/5xx 仍原样抛错保留诊断信息。
- 接入验证走工作台自身代码路径（非另写探针）：`test_connection()` + `assist()` 真实补全 + `_post_chat(on_delta=…)` SSE 流式 + `_run_with_tools()` 原生 function calling 工具循环，四套配置全绿（含直连一套：`/models` 直连返回列表、流式 9 个 delta、工具循环命中知识库）；三家的 `reasoning_content` 均能回传并进入「模型思考过程」。
- 踩坑记录三则：①方舟 Agent Plan 网关是 `/api/plan/v3`，误用通用网关 `/api/v3` 或 Coding Plan 网关 `/api/coding/v3` 一律 401；②opencode.ai 侧按 UA 拦访问，`Python-urllib/*` 默认 UA 触发 Cloudflare 1010，工作台自带的 `Workbench/260922.3` 直连与经代理均放行——日后改 `_api_headers` 的 UA 需重新实测；③**旧版 exe 不认识 `headers`**，在旧版设置页点「保存全部配置」会把直连档案的请求头静默抹掉，直连配置需搭配 v261008.1 及以后的 exe（或开发模式）。
- 架构与实测结论记入 `docs/ARCHITECTURE.md`「Agent Provider 接入（v261008）」；`VERSION` 升至 `v261008.1`，`ResearchWorkbench.exe` 已重新打包（2026-10-08 12:11），并用归档解析核对产物内含 `pf-headers` / `_MODELS_UNSUPPORTED_RE` / `extra_headers` / `_clean_headers` 与内嵌 `VERSION=v261008.1`。
- 工具轨迹改为**时间条视图**（v261008b）：`app/agent.py` 的 `_run_with_tools` 为每轮 LLM 调用与每次工具调用记录 `t0/t1`（相对本轮起点毫秒），返回第 5 项 `timing`（总耗时 / 思考累计 / 工具累计 / 轮数 / `timeline` 段列表）并挂到 assistant 消息（SSE `done` 随 `assistant` 回传），`tool_trace` 条目同步补 `t0/t1`。前端把原来的逐条 chip 流水账换成「一行汇总（⏱ 总耗时 · 轮数 · 思考合计 · 工具合计与次数）+ 一条与耗时成比例的堆叠时间条 + 图例（色块 ↔ 工具名，带 ×次数与累计耗时，失败另标 ✗N）+ 可折叠过程明细（逐段名称与耗时，工具名前带同色圆点，草稿的已确认/已拒绝仍保留）」；**思考段用浅灰，每个工具按本消息内首次出现顺序取 8 色调色板中的一色（保证同一条消息里各工具颜色互不相同），失败段固定红色（语义优先于配色）**，悬停任一段显示「名称 · 耗时」。生成中另有一条实时时间条随 `round`/`tool` 事件推进，取色顺序与最终结果一致。渲染器经 `window.ERWFabTimeline` 暴露，Agent 页（`web/app.js`）复用同一套类名与样式（`web/v260930-floating-agent.css`）。旧会话没有 `timing` 时按 `tool_trace` 的 `ms` 顺序兜底成条，并标「旧记录」，不谎报 0 轮 / 0ms 思考。
- 草稿确认卡片紧凑化（v261008b）：待确认从「一张四行卡片」改为**紧凑行**（工具徽标 + 标题同行、确认/拒绝按钮右对齐；≥2 篇仍给「✓ 全部确认 / ✗ 全部拒绝」整批操作条），已处理（已确认/已拒绝）折成**一行汇总**「✓ 已确认 N ✗ 已拒绝 M · 共 X 篇 · 点击展开明细」，明细收进 `<details>` 默认收起（每篇一行：状态徽标 + 工具 + 标题 + 落盘 `doc_id`）。11 篇批量建档的场景由约 11 张卡片（≈900px）压到一行（≈40px）。`data-draft-confirm` / `-reject` / `-confirm-all` / `-reject-all` 四个钩子原样保留，单条与整批确认/拒绝的既有接线（含 `querySelectorAll("[data-draft-confirm]")` 收集 id）不变；旧 `.fab-draft*` 样式保留备回退。渲染器经 `window.ERWFabTimeline.drafts(msg, states)` 暴露，便于离线预览与复用。
- 悬浮球面板**自适应窗口**（v261008b）：内容不再撑破面板。①`.fab-messages` 补 `overflow-x:hidden`，flex 子项统一 `min-width:0`（默认 `min-width:auto` 不肯收缩，是溢出的根因）；②长串断行（`overflow-wrap:anywhere`），宽表格在 `mdRender` 渲染后套 `.fab-tbl` 滚动容器——表格保持自身布局、超宽时在气泡内横滚，Agent 页 `renderMarkdownInto` 同步处理（先试过 `table{display:block}`，实测会把表格压成逐字换行「lite rat ure」，已弃用）；③已处理草稿行改为「徽标 + 标题一行、`doc_id` 另起一行」（实测 298px 可用宽度下徽标 138px + id 171px 已超，标题曾被挤成 0 宽）；④面板尺寸/位置此前只在「恢复」与「拖拽」时钳制，窗口变小后不重算，新增 `reflowPanel()` 在 `resize` 时按当前视口重新钳制面板与悬浮球，尺寸上下限改为随视口推导（`fabMaxW/H`、`fabMinW/H`），避免窄窗口下「下限大于上限」把面板顶出视口。无头浏览器实测：360px 窄面板内塞入 5 列宽表 + 长英文题名 + 长 `doc_id`，8 项断言全 PASS（消息区 358/358 无横向溢出，表格在 276px 容器内滚动 947px）；预置 900×900 尺寸与 (800,700) 位置后缩小窗口，面板被钳制为 456×357@(32,102)，7 项断言全 PASS。
- 修复 Agent 页（`web/app.js`）与 SSE 后端的协议错位：`/api/agent/send` 自 v260930k 改为 SSE，v260930m 又把 `done` 负载瘦身成只回 `assistant`，而 Agent 页仍按旧 JSON 契约读 `r.session.id`（`api()` 对流式响应 `res.json()` 抛错后返回 `{}`），表现为发消息即报 `Cannot read properties of undefined (reading 'id')`。新增 `streamAgentSend()` 消费 `round|delta|tool|done|error` 事件（delta 增量就地渲染进思考气泡、round 显示工具循环轮次），`done` 后回读 `GET /api/agent/sessions/<id>` 补齐会话对象，故其后的既有渲染逻辑一行未改；悬浮球（`web/v260930-floating-agent.js`）本就是 SSE 版，不受影响。已用 Node 同构脚本对着运行中的服务实测 round→delta→done→会话回读全通。
- 消息元信息去重（v261008b）：悬浮球与 Agent 页的元信息行原本并排显示 `model` 与「请求模式标签」，而标签通常自带模型名（`deepseek-v4.1-flash` + `DeepSeek V4.1 Flash（默认）`），同一件事报两遍。新增 `metaParts()`——归一化（去空格/点/连字符/括号）后标签已含模型名则只留标签，标签确实不同才两者都留，人设名始终保留；悬浮球经 `window.ERWFabTimeline.metaParts` 暴露给 Agent 页复用。自检五例：`术语建档员 · DeepSeek V4.1 Flash（默认）`、`DeepSeek V4.1 Flash · 无思考`、`qwen3.8-flash · 默认（不附加参数）`、`glm-5.3`、空（旧消息只剩时间）。
- 用量计费口径升级（v261008b，`app/billing.py` + `web/v261008-billing.js` + `web/v261008-billing.css`；该模块本身为 v261008 新增，此处一并补记）：①**按档案区分计费方式**——`prices.json` 新增 `plans` 段（`mode=token|subscription|free`），订阅套餐（OpenCode Go · 直连/代理、火山方舟 Agent Plan）只统计用量、金额项不适用，不再被算成「缺单价」；②**单价键支持档案限定**，优先级 `档案id/模型名` → `档案id`（该档案兜底价）→ `模型名`（含 `*` 通配），解决同一模型在不同 Provider 价格不同的问题；③**缓存命中率**进入总览卡片与按会话/按模型表（命中部分按 `cache_hit`、未命中输入按 `input` 计），长上下文 Agent 的最大成本变量终于可见；④**缺单价闭环**：总览新增「缺单价」清单（按 档案+模型 聚合并给出建议键）与「加入单价表」按钮，一键生成待填条目并跳到编辑框；⑤**usage 缺失也落账**（`usage_missing`），调用次数与实际一致；⑥老账本（无 `billing_mode` 字段）在**读取时按当前 plans 推导**归位，账本文件仍只增不改。实测：47 条历史调用由「未计价 47 / 请补全单价表」变为「订阅内 47 · 缺单价 0」，命中率 72.5%（输入 1,078,568 中命中 781,952，计费输入 296,616）；真跑一次对话后新记录带 `billing_mode=subscription`、`priced=true`、`plan_label`。另修 `billing.py` 顶层 `from .workspace import ...` 在「billing 作为首个 app 模块」时的循环导入（改为延迟导入、先初始化 config）。
- 订阅制**按官方定价换算等价标价**（v261008b，续上条）：①单价条目新增可选 `currency`（直接粘贴官方人民币标价即写 `"currency":"CNY"`），价格表顶层新增 `fx` 参考汇率（语义 1 USD = N 该币种，预置 `{"CNY":7.1}`，可在单价表里改），新增 `convert_cost()` 统一折算，缺汇率的条目标 `fx_missing`（等价记 0，不猜数）；②订阅/免费档案除 `cost_usd`（实付口径，订阅记 0）外另记 `equiv_usd`（等价标价），token 模式两者相同；③`summary()` 给出 `equiv_usd` / `subscription_equiv_usd`，页面新增「等价标价合计」卡片、订阅档案表与按模型表的「等价标价」列（明示为参考、非实付）；④老账本读取时用**当前单价表**补算等价标价（仍是视图层：不改账本文件，也不改 token 模式写入时冻结的实付金额）；⑤价格表预置 DeepSeek 官方标价（`deepseek-v4.1-flash` 与官方名 `deepseek-flash`：空闲时段 输入 1 元、缓存命中 0.02 元、输出 4 元 / 百万 tokens，高峰时段为该值 2 倍），来源 [api-docs.deepseek.com「模型 & 价格」](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（2026-10-08 核对，与七牛云同模型页标价一致）。实测你那 48 次调用按此折算 ≈ **$0.0831**（≈0.59 元），其中 OpenCode Go·直连 Zen 47 次 ≈$0.0829、方舟 Agent Plan 1 次 ≈$0.00015——订阅制"省下多少"终于可见。计费纯函数自检 17/17 通过（含档案限定键优先、通配、计费口径、人民币折算、缺汇率处理、老账本归位与实付冻结、`fx`/`currency` 归一化）。
- Agent 对话页排版优化（v261008c，`web/styles.css` + `web/v260922-agent-profiles.js`）：①原 `.agent-message` 锁死 `max-width:920px` 且助手气泡左对齐，1828px 宽屏下右侧空出 600+px——改为整条会话（消息列 + 引用条 + 输入框）共用一条**居中阅读列**（`--agent-col:1180px`，以 `padding-inline:max(6px,calc((100% - var(--agent-col))/2))` 实现），助手气泡放宽到 1080px、用户气泡 900px，≤1100px 自动回退通栏；②`.agent-message-body` 的 `overflow-wrap:anywhere` 会把表格单元格里的英文逐字断开（实测 `literature` → `literat/ure`、表头「中 1」竖排），改为 `break-word`，并补齐消息内表格样式（`width:max-content` 保持自身列宽 + 表头 `nowrap` + 渲染时已套的 `.fab-tbl` 容器内横滚，与悬浮球同一套做法），正文 12→13px；③输入区「API 配置」旁的徽标原本把下拉框已选中的配置名重复显示一遍，改为显示**接口地址主机**（`opencode.ai` / `127.0.0.1:9355` / `ark.cn-beijing.volces.com`，悬停看完整 base_url）——直连还是走本地反代理一眼可辨；④输入区与引用条套用同一条阅读列，与消息对齐。无头浏览器按用户截图同尺寸（1828×1109）与窄屏（980×860）各验一次：宽屏会话列居中、表格列宽正常且超宽在气泡内横滚，窄屏回退通栏、输入区自动换行。**v261008d · 对齐与秩序**：原 `.agent-message.user{align-self:flex-end}` 会把「YOU 头像 + 气泡」整体推到右边，YOU 与 AI 的开头相差数百像素（用户反馈「两个对话开头不对齐」）；改为**统一栅格 + 全部左对齐**——两角色的 `article` 同宽同起点、头像固定占第一列（`--agent-gutter:36px`），**AI 与 YOU 的气泡一律从「头像右侧」同一条线起笔**（YOU 气泡 `width:fit-content` 贴合文字，短消息不被拉成一条空框；角色靠头像与底色区分），并让聊天头 / 消息列 / 引用条 / 输入框共用同一条列宽 `--agent-col-inner:1080px`——整页只剩一条对齐轴。已用真实短会话（两轮问答，截图后删除）在 1828×1000 核对：四个头像落在同一竖线、四个气泡左缘同为 x≈697；用户真实长会话（含 5 列表格与耗时时间条）复核无回归。

## v260929.1

### 文献 PDF 工作区合并（四阶段方案落地）

- 并入上游 `feature/literature-pdf-workspace` 40 个提交：PDF 上传与流式阅读、三栏文献工作区、矩形/手绘/文字批注、区域截图预览、批注笔记，合并后按方案分四阶段与既有文献条目体系融合。
- **阶段 1 · 共存接入**：移除对 `kind='literature'` 页面的整体接管，文献列表/编辑器（BibTeX 双向同步、自动 cite_key、元数据表单）原样保留；工作区改由列表页头部「PDF 阅读工作区」按钮进入，工作区内提供「← 返回文献列表」按钮。
- **阶段 2 · 数据互认**：上传 PDF 即同步创建 literature md 条目（`attachment` 指向 `Knowledge/Literature/PDF/`，cite_key 自动生成），`doc_id` 双向关联写入 `library.json`；删除文献时联动清理 md 条目（均入 Trash）；列表「⧉ 附件」徽章优先跳转工作区阅读，未登记附件退回新窗口直开。
- **阶段 3 · 真值归一**：元数据以 md 条目为唯一真值——工作区列表/详情 join 回读 md（编辑器改题名/作者/DOI 即时生效于检索与展示），工作区侧改元数据经 `indexer.update_doc` 回写 md 并刷新索引；新增「重建关联」按钮与 `POST /api/literature/rebuild`（幂等：补 doc_id 关联、旧附件 PDF 复制入库登记、孤儿条目补建 md）；修复上游遗留的 `/api/literature/export-bibtex` 路由错位（误置于 GET 分发致 POST 落入泛匹配 404）。
- **阶段 4 · 自动填写**：文献编辑器新增「自动填写」行——粘贴 DOI（CrossRef）或 arXiv 编号（arXiv API）联网抓取回填，粘贴 BibTeX 文本则前端本地解析回填；cite_key 按第一作者姓氏 + 年份生成；回填仅覆盖空字段并提示核对。
- **附件入口统一与存放空间合并**：列表「⧉ 附件」徽章点击一律跳转 PDF 阅读区（原浏览器新窗口直开并入工作区）；未登记的附件自动单条登记（`rebuild` 支持 `doc_id`）后重试打开；附件 PDF 统一存放于 `Knowledge/Literature/PDF/`——Workspace 内的旧附件（如 `Knowledge/Attachments/`）原地移动迁入不留双份，Workspace 外绝对路径仅复制不破坏外部文件。
- 打包提醒：`web/` 与 `VERSION` 均为构建期注入，改动后须重跑 `build_client.bat` 才对 exe 生效；开发模式重启服务即生效。

## v260924.1

### 分类标记

- 内置分类标记新增 `model`（⬡ 模型）与 `principle`（∑ 原理），候选由 8 个扩展到 10 个。
- `模型` 用于可建模对象：物理动力学模型、参数化抽象、可训练网络；`原理` 用于记录某个方法的具体原理与公式：机理推导、口径与度量定义、判据式。
- 标记与条目命名规范的类别词对齐：`架构`→`architecture`、`方法`→`method`、`模型`→`model`、`原理`→`principle`、`实验`→`experiment`、`数据集`→`data`。`.trae/rules/知识库条目命名规范.md` 中原「类别词不新增 `kind_marks` 取值、`模型` 类条目沿用 `method` 标记」条款同步修订为「类别词与 `kind_marks` 一一对应」。
- 标记仍为前端固定常量，保存写入 frontmatter `kind_marks`；后端存储、索引与 `/api/docs?mark=` 过滤均按字符串处理，无 schema 变更、无需数据库迁移。
- 按新映射对存量 `知识-` 笔记批量重标记（2026-09-24 10:16，经 `store.update_doc` 写入并自动记录 `doc_update`）：65 篇中 25 篇标记与新规范不一致，已全部对齐 —— `模型` 16 篇由 `method` 改为 `model`，`原理` 4 篇由 `data` / `architecture` / `thinking` 等代用标记改为 `principle`，`方法` 4 篇去除 `synthesis` / `thinking` / `experiment` 代用标记，`架构` 1 篇去除其中 `method`；其余 40 篇（`方法` 20、`实验` 16、`架构` 3、`数据集` 1）原本合规未动。重标记后 `知识-` 笔记标记分布（篇）：`knowledge` + `method` 24、`knowledge` + `model` 16、`knowledge` + `experiment`（含叠加 `method` / `data`）16、`knowledge` + `architecture` 4、`knowledge` + `principle` 4、`knowledge` + `data` 1。

### 条目拆分

- 按《知识库条目命名规范》§四.4「禁止「A 与 B」式跨族合写标题（一篇只讲一个知识点或一个族）」拆分 2 篇「一篇多实验」条目为 9 篇单实验条目（2026-09-24 10:55，经 `store.create_doc` / `delete_doc` 写入并自动记录 `doc_create` / `doc_update` / `doc_delete`）：`知识-实验-传统单帧检测方法对比与失效机理（1.1/1.2）`（含 1.1/1.1b/1.2/1.2b/1.2c/1.2d/1.2e 七项实验）拆为 7 篇，`知识-实验-数据集难度分级与深度学习批量基线（2.0/2.1）` 拆为 2 篇。
- 新条目：`知识-实验-小区域滤波单帧检测基线（1.1）`、`知识-实验-小区域滤波虚警改进（1.1b）`、`知识-实验-传统单帧经典方法对比（1.2）`、`知识-实验-LCM 失效根因诊断（1.2b）`、`知识-实验-四方法增强域受控归因（1.2c）`、`知识-实验-IPI 强云层帧虚警根因（1.2d）`、`知识-实验-四方法环境适用性分层（1.2e）`、`知识-实验-数据集结构实测与难度分级（2.0）`、`知识-实验-深度学习批量基线（2.1）`；`kind_marks` 沿用原主题标记（阶段 1 七篇叠 `method`，阶段 2 两篇叠 `data`），`project_id` 经 `apply_doc_project_ids` 补写。
- 原 2 篇经 `delete_doc` 移入 `Workspace/System/Trash/note/`（可回滚）；全库互引同步：`知识-实验-GEO单帧经典检测（1.3g）` 中指向原条目的管线来源行改指新的 1.1b / 1.2 两篇，扫描确认无其余残留引用。
- 全库同类问题排查：其余 63 篇标题均为「单类别词 + 单一对象」，`知识-方法-传统红外小目标检测` 为声明的「同目标多方法归类」篇、三篇制导实验条目以括号补充侧面而非跨族合写，均不属此问题。

### 打包

- `ResearchWorkbench.exe` 由 PyInstaller onefile 打包，`web/` 与 `VERSION` 在构建时写入包内（`--add-data "web;web" --add-data "VERSION;."`）；冻结运行时 `ASSET_ROOT = sys._MEIPASS`，**修改 `web/` 或 `VERSION` 后必须重新执行 `build_client.bat`**，改动才对 exe 生效，直接跑开发模式（`python server.py` / `run.bat`）读的是仓库目录。
- 本版本已重新打包（2026-09-24 10:11），确认 exe 内 `/app.js` 含 `model` / `principle`，`/api/health` 返回 `v260924.1`。

## v260922.3

### 性能优化

- 新增 SQLite 可重建索引，Markdown 仍作为唯一真实数据源。
- 文档、项目、标签、待办、活动和知识关系改为索引查询，减少大规模 Workspace 下的重复扫描。
- 文档列表支持服务端分页，全文搜索接入 FTS5。
- Workspace 文件树改为按需加载。
- Dashboard、项目统计和科研活动改为聚合查询。
- 新增索引状态、手动重建接口及性能测试脚本。

### 知识图谱优化

- 知识图谱改用 Force-Directed Layout，并加入社区辅助布局。
- 新增 Semantic Zoom、标签 LOD、标签碰撞检测和 Edge LOD。
- 新增节点搜索、实时联想、最近编辑、自动定位和 Camera 聚焦。
- 新增一阶 / 二阶 `Focus + Context` 关系浏览。
- 建立邻接表、布局缓存、投影缓存、Viewport Culling 和 `requestAnimationFrame` 合帧。
- 2D / 3D 共用统一的搜索、选择和 Focus 逻辑。
- 修复搜索框、Canvas、预览区等 UI 层级覆盖问题。
- 「研究 · 知识总览」中的知识关系预览同步升级为新版绘图方式。

### 界面

- 新增类似 ChatGPT Web 的左侧栏收起 / 展开功能。
- 侧栏状态自动保存，收起后主区域自适应扩展。

### Agent / LLM

- Agent 配置升级为多套 API Profile，可独立保存并快速切换。
- API Key 改为直接保存在本地 `config/secret.json`，不再依赖环境变量。
- 每套 Profile 独立支持：
  - Base URL；
  - API Key；
  - 超时时间；
    -最大输出 Token；
  - Temperature；
  - 是否显示思考；
  - 多套 Request Mode。
- Request Mode 支持独立配置模型、Temperature 和扩展 `params`。
- Agent 设置页改为结构化配置管理界面，不再手动编辑整段 Preset JSON。
- Agent 对话页支持选择当前 API Profile 和 Request Mode。
- 模型调用统一使用 OpenAI-compatible Chat Completions。

### 配置迁移

- 首次升级时自动读取旧版 Agent 配置并生成「未命名配置」。
- 兼容旧 `app.json`、`secrets.json` 和 `api_key_env`。
- 原有 Base URL、模型、请求模式、超时和思考设置等会尽量自动迁移。
- 新版密钥配置保存在 Git 忽略的 `config/secret.json` 中。

## v260922.2

* 优化「核心工作 → 概览」页面布局，整体调整为更紧凑的科研仪表盘结构，提高桌面端信息密度并减少纵向空白。
* 重构概览页模块排列：科研热力图与学业进度 / 毕业条件组成顶部区域，「今日科研桌面」与「快速记录」作为左侧组合，并与右侧科研节奏、当前任务和近期节点统一对齐。
* 调整「今日科研桌面」与「快速记录」的高度分配，减少今日概览卡片无效留白，同时为快速记录提供更充足的操作空间。
* 「当前任务」与「近期节点」统一限制为最多显示 3 条记录；无记录或记录较少时仍保持合理的卡片最小高度，避免概览布局塌缩。
* 调整「项目推进」与「最近研究活动」布局，使两组内容顶部对齐；最近灵感、最近笔记和最近工作总结分别支持最多展示 10 条近期记录。
* 优化项目推进、统计卡片、列表项、导航栏、顶部栏及卡片间距，使整体界面在保持可读性的同时更加紧凑。
* Markdown 编辑界面新增独立缩放控制，支持分别调整编辑区和预览区显示比例，范围为 10%–200%，100% 对应原始显示大小。
* 编辑区与预览区缩放比例分别保存到本地浏览器，页面刷新或重新进入编辑界面后自动恢复上次设置。

## v260922.1

* 新增「核心工作 → 项目」管理模块，支持项目新建、编辑、重命名、状态修改和删除，并展示描述、最近编辑及关联内容统计。
* 项目改用稳定 `project_id` 作为唯一索引；旧 Workspace 启动时自动为历史项目补充 ID，并迁移笔记、灵感、里程碑和待办等项目关联。
* 项目重命名后保持原 ID 和知识关联不变；删除项目时解除关联，并将项目工程目录移入 Workspace 回收目录。
* 修复知识图谱 Markdown 预览中的本地图片路径解析，支持正常显示 Workspace 附件图片。
* 修复「研究 · 知识总览」近期里程碑，仅显示计划中节点的问题；现在默认展示当前日前后约半年的全部状态里程碑。
* 里程碑普通时间轴与 3D 时间轴新增状态筛选，支持计划、进行中、受阻、完成等状态，并在视图切换时保留筛选条件。

## v260921.1

- 修复知识图谱右侧长文本不换行。
- 新增知识图谱节点 Markdown 预览抽屉；支持真实文档和项目/标签虚拟节点。
- 里程碑 3D 时间线新增 Markdown 预览抽屉与“打开编辑”。
- 知识图谱新增空白画布拖动、Ctrl/Cmd+滚轮缩放、3D Alt/右键旋转与一键全览。
- 设置中心新增“服务与存储”页，暴露 Host、Port、自动打开浏览器、Workspace、迁移策略；天气启用开关和 LLM provider_label 也可视化。

## workbench-v260921 · 2026-09-21

### 本轮新增

- 文档新增「分类标记」：每条 Markdown 可挂载多个标记（知识 ◈ / 归类 ◎ / 方法 ⚒ / 问题 ？），编辑器元信息区以 chip 多选，保存写入 frontmatter `kind_marks` 字段。
- 列表条目显示彩色标记胶囊；文档筛选栏新增标记下拉，后端 `/api/docs` 支持 `mark` 参数按标记过滤。
- 标记候选为前端固定常量（图标与颜色内置），与配置解耦，不再依赖 `custom_kinds`。
- 新增本地私密配置 `config/secrets.json`：在 `env` 对象中填入 `"环境变量名": "密钥值"`，服务运行中保存后自动注入进程环境变量（修改时间检测热重载，无需重启），`run.bat` 启动无需每次手动设置 API Key。该文件已被 `.gitignore` 排除，不会上传 git；Key 依旧不进入 `config/app.json` 与接口返回。

### 本轮修复与调整

- 修复笔记分屏/预览模式下 Markdown 界面无法使用滚轮阅读的问题。
- 笔记编辑器顶部表单区紧凑化；项目选择弹窗修复项目名竖排折行，选择框高度与其它控件统一，备注输入移至选择框下方。

### 本轮移除

- 移除自定义笔记类型机制（`custom_kinds`）：侧栏入口、`kind-` 路由、设置页「笔记类型」管理、后端 `custom_kinds()` 配置读取与 `Knowledge/Custom` 目录；原四类图标与颜色由分类标记固定候选继承。

## workbench-v260920.2 · 2026-09-20

### 本轮新增

- 概览「项目推进」新增“＋ 新建项目”，无需先进入资源页面。
- 研究条目的项目字段改为已有项目选择器：默认空白、支持多项目、支持移除，不再手动输入项目名称；待办项目也限制为已有项目。
- Agent API Key 机制改为环境变量：新增 `api_key_env`，默认 `OPENAI_API_KEY`；服务运行时从 `os.environ` 读取，不再创建或更新 `config/secrets.json`。
- Agent 默认请求模式增加三套：默认、Qwen 低思考（`enable_thinking=true` + `thinking_budget=1024`）、Qwen 无思考（`enable_thinking=false`）。
- Agent 输入改为乐观渲染：发送后用户消息立即出现在对话区，模型调用期间显示思考状态与耗时。
- Agent 支持从兼容接口提取 `reasoning_content` / `reasoning` / `thinking` / `analysis`，并通过设置项控制是否展示。
- Agent 用户消息在外部模型调用前写入会话历史；即使模型请求失败，也尽可能保留本轮用户输入。
- 知识图谱点击空白处可清除当前选中节点与邻接高亮。
- 更新自检：覆盖环境变量密钥、无本地 secrets 文件、模型 reasoning 提取、项目选择器与图谱取消高亮。

### 上一轮整合内容

本版本延续 workbench 独立工程，并整合此前图谱、资讯、Agent 与 Markdown 能力：

- 修复资讯模块：arXiv RSS 增加官方 Atom API 回退与短重试；全部抓取失败时不再覆盖有效缓存，也不缓存空失败结果；资讯页显示每个源的实际状态与详细诊断。
- Markdown 标签 placeholder 改为 `标签1, 标签2, 标签3`。
- Agent 增加 JSON 请求模式配置，可把供应商自定义请求参数动态合并到 Chat Completions / Responses API 请求；对话页可逐轮选择请求模式。
- Markdown 编辑时 `Ctrl/Cmd + S` 改为保存当前文档并阻止浏览器“保存网页”。
- 修复知识图谱从 3D 切换 2D 后旧动画循环继续绘制的问题。
- 选中图谱节点时，高亮当前节点、一阶相邻节点和相关边，并弱化其它图元。
- 图谱新增标签节点和标签关系；项目关系升级为多项目；Markdown 支持 `projects: []`，同时保留 `project` 兼容字段。
- 图谱筛选增加“关系来源”：显式引用 / 标签关联 / 项目归属。
- 关联 Markdown 导出改为继承当前图谱可见节点与关系，不再使用未过滤图谱；支持直接以标签或项目虚拟节点作为导出核心。
- 自检覆盖多项目、标签图谱、筛选导出、动态 Agent 请求参数和 RSS arXiv 回退。
