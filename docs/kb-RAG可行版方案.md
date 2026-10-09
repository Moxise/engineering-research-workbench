# kb RAG 可行版方案（v2 · 执行版）

> 编制：2026-10-09 ｜ 目标系统：`D:\Project\engineering-research-workbench\Workspace\`
> 依据：`C:\Users\ZL-Robot-05\WorkBuddy\2026-10-08-13-19-09\outputs\kb-RAG实施方案.md`（原方案）+ 同目录诊断产物
> 状态：**已落成，按 MVP 范围执行中**（执行状态见 §7 表格「状态」列）

---

## 0. 原方案核对修正（实测，2026-10-08/09）

| # | 原方案断言 | 实测 | 处置 |
| --- | --- | --- | --- |
| 1 | 194 条 md（note 108 + literature 67…） | `Knowledge/` 下 **200 个 md**；索引 `documents`=**199**（note 90、literature 67、**experiment 25**、journal 6、idea/summary 各 4、milestone 3） | 语料口径**以索引为真值**，不按文件数；`Knowledge/Experiments/` 25 条不可漏 |
| 2 | 56 篇 PDF「待复制」；验收 `Attachments/` 57 个文件 | 56 篇 / **291.3 MB 已在** `Knowledge/Literature/PDF/`；`Attachments/` 只有 **1 篇**（工作台 v260929.1 起附件统一存 `Literature/PDF/`） | 步骤 B 口径作废；**不再往 Attachments 复制** |
| 3 | 1514 条边、196 wikilink | `graph_edges`=**1854**、`document_links`=**395** | 仅数字漂移 |
| 4 | FTS 修复改 kb 侧 `documents_fts` | 该表由工作台建：`doc_id,title,body,tags,projects` + `trigram`；`fix_fts_tokenizer.py` 重建为 `doc_id,title,**excerpt**,tags_json,projects_json` | **硬伤**：丢 `body`（正文召回面积大减）+ 列结构与工作台写入/`ws_reindex` 不一致 → 改为**工作台侧一致修改**（唯一写入者） |
| 5 | 命中率 6/27 → 26/27（另处 12/27、20/21） | 口径不一；且脚本判据是 `count>0` | 改为固定评测集 + Top-k 判据（§5） |
| 6 | Python 3.13.14（managed） | 工作台/MCP 跑 **Miniforge base 3.12.11**；`cuda` env = **3.14.7 + torch 2.14.0+cu132（CUDA 可用，RTX 4060 8 GB / 驱动 616.92）**；`sentence_transformers` 未装 | 双解释器边界 → 向量算力独立进程（§2） |
| 7 | 生成层「本地 LLM / API 待定」 | 本机**无任何本地 LLM 运行时**（无 ollama / LM Studio / llama.cpp；11434、1234、8080 不通） | **MVP 不做生成层**；生成交给调用方 Agent |
| 8 | 原型「Top1 5/5」证明语义可用 | 原型 `embed()` 是 hashing 词面投影 | 只证明链路与分词通；语义质量须用真模型 + 评测集验证（§5） |
| 9 | frontmatter 剥离 `^---\n.*?\n---\n` | 抽样 md 为 **CRLF** 行尾 → 正则不匹配 | 实现改用 `\r?\n`；见 §3 语料装载 |
| 10 | MCP 工具 24 个 | 实测 **25** 个（`tools_knowledge` 9 + `tools_workspace` 16） | `kb_retrieve` 为第 26 个 |

补充实测：`kb_search`(MCP) 与 UI 搜索**共用** `app/perf_index_query.py`（`t_search → wb.search → search_docs`）→ 修 FTS 是「一处改、两端受益」。

---

## 1. 目标与边界

**目标**：让外部 Agent（Claude / Trae / WorkBuddy）与工作台内置 Agent 用**一条工具**回答四类问题——查缺口 / 查出处 / 查冲突 / 查迁移——每条结论可回链 `doc_id`。

**MVP 边界（明确不做）**：不做生成层（M5 可选）；不做 Zotero / Vault 迁移（另案）；不引 LangChain / LlamaIndex；不动索引架构。

**硬约束**：

1. `System/Cache/*` 是可重建派生数据，唯一写入者是工作台 → RAG 索引同样必须可一键重建，且不改写 `index.sqlite`；
2. `Workspace/Knowledge/<Kind>/*.md` 是唯一真值，RAG 只读；
3. `System/Cache/` 已被 `Workspace/.stignore` 排除同步 → 向量库放这里不会跨机漂移，但必须能重建。

---

## 2. 架构

```
工作台 (base 3.12.11, stdlib-only, 可打包 exe)
  app/kb_segment.py         中文 bigram 分词（唯一实现，三方共用）
  app/perf_index_db.py      建 FTS: unicode61 + bigram 预分词（含旧表自动迁移）
  app/perf_index_query.py   查询侧同样切分（去掉 len>=3 门槛）
        ↓ documents_fts（复用，不另建）
  Workspace/System/Cache/index.sqlite  ← RAG 只读

RAG 服务 (独立进程, cuda env 3.14.7, torch+CUDA)
  127.0.0.1:8770   /health /embed /search /rebuild
  bge-small-zh-v1.5（权重放仓库外，约 95 MB）
  Workspace/System/Cache/rag.sqlite  ← 向量 + PDF chunk（派生、可重建、不同步）

客户端 rag/client.py (stdlib urllib)
  ├─ MCP 工具 kb_retrieve        → 外部 Agent
  └─ app/agent_tools 同名工具     → 内置 Agent
  服务不可达 → 自动降级 FTS + 图，并在 caveats 说明
```

关键取舍：

- **分词只写一份**（`app/kb_segment.py`，stdlib）：写入侧、查询侧、RAG、评测共用 → 杜绝切分漂移；
- **向量层独立进程**：工作台保持 stdlib-only + 便携 exe；MCP 也不背 torch（否则每次启动付 5–15 s 冷启动）；
- **服务可降级**：RAG 服务不可用时工具仍返回 FTS + 图结果并标注，向量层不是单点。

---

## 3. 检索与语料设计

- 融合：**FTS（工作台 unicode61+bigram）+ 向量（bge-small-zh）+ 图（`document_links` 1 跳扩展）**，RRF `k=60`；权重默认 `1.0 / 1.0 / 0.5`（图为扩展非主排序），不做未经验证的调参。
- 过滤：`kind` / `tags` / `projects` / `status` 为可选精确过滤，默认不过滤；`status` 词汇随 kind 而异（稳定 73、待阅读 67、完成 25、草稿 16、记录 6…），提供 `exclude_status` 开关，是否默认开启由评测决定。
- 查询理解（可选、可关）：别名表（`CW→CW|Clohessy-Wiltshire`）、编号正则（`C\d` / `S[0-9A-Z]` / `实验\d+\.\d+`）、域判定；任一环失败不阻断主流程。
- 语料装载：`documents.path` 是**相对 Workspace 根**的路径；剥离 frontmatter 用 `\r?\n`（实测 CRLF）；`documents.updated` / `mtime_ns` 作为增量指纹。
- 输出：`sources[]`（doc_id / title / snippet / page / score）+ `confidence` + `caveats`；零命中返回明确「未找到」，不用低分填充。
- PDF chunk 与 md 条目同库、以 `source_type` 区分；默认不加先验权重。

---

## 4. 评测（原方案缺失，本版补齐）

- `rag/eval/queries.jsonl`：**40+ 条**，四类各 10 条 + `negative` 8–10 条；字段 `query / expected_doc_ids / type / notes`。
- 指标：**Recall@5、MRR@10、负样本拒答率**；判据为「expected doc 出现在 Top-k」，**不用 `count>0`**。
- 三次对照：FTS-only → +vector → RRF，同一集合、同一日期，报告存 `rag/eval/report-<date>.md`。
- **验收门槛**：RRF 的 Recall@5 ≥ 0.80（四类加权）且负样本拒答率 ≥ 0.90；不达标则只交付 FTS + 图（仍强于现状）。

---

## 5. 阶段路线与验收

| 阶段 | 内容 | 验收标准 | 预估 | 状态 |
| --- | --- | --- | --- | --- |
| **M0** | 冻结基线（只读）：快照 + 固定评测集 + 测现状 | 基线数字可复现，报告落盘 | 0.5 d | ✅ 完成 2026-10-09（Recall@5 0.154 / MRR 0.070） |
| **M1** | 工作台侧 FTS 修复：`app/kb_segment.py` + 建表/写入/查询三处（保留原文列；旧表自动迁移） | 2 字词可检索；`ws_reindex` 后仍生效；评测集提升；UI 与 `kb_search` 同步改善；199 条不丢 | 0.5 d | ✅ 完成（Recall@5 0.385 / MRR 0.183；线上多词查询 0→11、整句 0→54） |
| **M2** | RAG 服务 + 向量库：`cuda` env 补依赖、下载 bge-small 权重、8770 服务、建 `rag.sqlite` | `/health` 通；向量 Top5 人工看合理；本地权重不外传 | 0.5–1 d | ✅ 完成（3093 块 / 199 条 / GPU fp16 / 查询 3 ms） |
| **M3** | RRF 融合 + 图扩展 + `kb_retrieve`（MCP + 内置 Agent）+ 降级路径 | §4 门槛达标；工具可调；服务停掉时优雅降级 | 0.5–1 d | ✅ 完成（Recall@5 1.000 / MRR@10 0.897 / 拒答 8/8 / 13 项端到端检查全通） |
| **M4** | PDF 语料（可选）：Zotero `fulltext.sqlite` 复用 + PyMuPDF 补缺；按章节切分、保留页码 | 「查出处」能定位到「论文 X 第 N 页」 | 1–2 d | ✅ 已完成 2026-10-09（PyMuPDF 逐页提取，56 篇全有文本层，无需 Zotero 复用；14,106 块 + 页码；命中经 `attachment` 挂回文献条目） |
| **M5** | 生成层 `kb_answer`（可选，需先定 LLM） | 带引用 + 阈值拒答 + 事实/推断标注 | 1–2 d | 不在今日范围 |

依赖：`M0 → M1 → M3`、`M2 → M3`。做完 M1 即具备实用价值（关键词检索覆盖大部分「查出处」）。

---

## 6. 决策记录（本版已采纳的默认值）

| # | 决策 | 采纳 | 理由 |
| --- | --- | --- | --- |
| 1 | FTS 修复落点 | **改工作台** | UI 与 MCP 共用同一实现；`ws_reindex` 不会覆盖；避免双真值 |
| 2 | embedding 模型 | **bge-small-zh-v1.5（本地）** | 512 维 / 95 MB，8 GB 显存充裕；不外传数据 |
| 3 | MVP 是否含生成层 | **不含** | 本机无本地 LLM 运行时；调用方 Agent 自带 LLM，引用控制更可控 |
| 4 | PDF 语料 | **放 M4** | md 1.6 MB 先跑通链路与评测；291 MB 是增量 |
| 5 | RAG 服务生命周期 | **手动启 + MCP 首次调用按需拉起** | 避免常驻显存；稳定后再考虑随工作台启动 |

（以上任一项可随时推翻，推翻即改本表并同步执行方式。）

### 6.1 执行中新增的三处修正（实测驱动，已落地）

| # | 修正 | 实测依据 |
| --- | --- | --- |
| 1 | **条目必须分块**：原方案「条目即 chunk」不成立，改为 380 字/块 + doc 级聚合取最高分 | kb 条目均约 8 KB ≈ 3000+ 中文字，远超 bge 的 512 token 上限，整条嵌入只剩前 16%；199 条 → 3093 块 |
| 2 | **图不进主排序**：只作 `related[]` 关联条目输出 | 含 graph 的 RRF 组合 MRR ≤ 0.790；`vector + fts(0.5)` = 0.897 |
| 3 | **拒答必须组合判据**：FTS 无命中 **且** 最高向量相似度 < 0.58 | 纯向量分数不可分：负样本最高 0.5718 > 正样本最低 0.4473 |
| 4 | **（含 PDF 后修订）拒答只做硬底线，置信度改由「证据结构」决定**：硬拒答 = FTS 空且相似度 < 0.45；`high` = 关键词≥3 且向量≥0.62 或向量≥0.75；`medium` = 有关键词命中或向量≥0.65；`low` = 仅弱语义召回（仍返回 + 提示核对） | 跨语言正确答案常只有 0.55~0.61（「传感器切换时的配准」→《Cross-Spectral Navigation with Sensor Handover》0.593），而离题命中可达 0.610；绝对分 / z / margin 三种信号全部重叠（8/8，`rag/eval/signal_experiment.py`），用分数拒答会藏掉正确结果 |
| 5 | **PDF 片段按页分块**，并经 `documents.attachment` 挂回文献条目 | 实测 56/56 精确对应；命中可直接给「条目 + 页码」，且引用可核验 |
| 6 | **增量指纹按 `(doc_id, source_type)` 分域**，存活全集取完整语料而非本次子集 | 同一条目同时有 md 与 PDF 分块会互相污染；`--pdf-only` 曾因此误删 3,093 个 md 块 |

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Python 3.14 上 `sentence_transformers` / `tokenizers` wheel 可用性 | 中 | 先试装；失败则新建 3.12 rag env 或退 onnxruntime + ONNX 权重 |
| 模型权重需联网下载 | 中 | 由用户正常会话执行下载；权重放仓库外，绝不进 git |
| 服务常驻显存与 4060 其他占用冲突 | 低 | 按需启动；batch 小；不启用 fp16 |
| 索引陈旧 | 中 | `documents.updated` / `mtime_ns` 指纹比对 + 只重嵌变更条目；记录 `meta.schema_version` |
| 与原方案的临时脚本并存造成双真值 | 中 | 以本文件为唯一权威；`fix_fts_tokenizer.py` 降级为「bigram 有效」的证据，不再是执行入口 |
| 与并行会话改动冲突 | 中 | RAG 改动集中在 `app/kb_segment.py` + `perf_index_*` + 新目录 `rag/`，避开 `web/`、`CHANGELOG.md` 热区 |
| 幻觉 | 高 | MVP 不生成（风险归调用方）；若做 M5 则强制引用 + 阈值拒答 |

---

## 8. 明确不做

不引框架；不把 291 MB PDF 复制进 `Attachments/`；不在 kb 侧私改 `System/Cache` 索引；不先做生成层再补评测；不把模型权重放仓库；不把 Vault / Zotero 迁移（原方案 P3–P8）混进 RAG 计划。

---

## 9. 执行日志

（执行过程中按阶段追加：日期 / 阶段 / 命令 / 实测数字 / 结论）

- 2026-10-09 方案落成本文件；开始 M0。
- **M0**（只读）：`con.backup()` 取一致性快照 `.scratch/tmp/index-snapshot-20261009.sqlite`（35.7 MB）；导出 199 条清单；编写 60 条固定评测集 `rag/eval/queries.jsonl`（52 正样本：出处/冲突/缺口/迁移 + 12 条短关键词；8 负样本）。基线（修复前行为，对快照跑）**Recall@5 = 0.154 / MRR@10 = 0.070**；并在运行中的旧服务上交叉验证：多词与整句查询确实 0 命中。
- **M1**：新增 `app/kb_segment.py`（中文 bigram 预分词唯一实现）；`perf_index_db.py` 建表改 unicode61 + `seg` 列 + 旧库自动迁移 + `fts_backfill_pending`；`perf_index_core.py` 写入侧分词与回填钩子；`perf_index_query.py` 查询侧三段式（AND → OR → LIKE）。重启工作台后自迁移完成（schema 实测 `docid,title,body,tags,projects,seg / unicode61`，199 行，标志已清）。**Recall@5 0.154 → 0.385，MRR@10 0.070 → 0.183**；线上「卡尔曼滤波 状态估计」0 → 11、「统一燃料模型…口径」0 → 54。
- **M2**：cuda 环境装 `sentence-transformers 6.1.0`（3.14 有 abi3 轮子；沙箱内 pip 受 `tempfile.mkdtemp` 的 0700 权限影响，用 `.scratch/tmp/pyshim` 的 `sitecustomize` 绕过）；权重下载到 `.rag/models`；`rag/build_index.py` 22 s 建 3093 块（97.9 万字符，0 缺失向量）；`rag/service.py` 起 8770，GPU fp16，查询 3 ms。
- **M3**：`rag/search.py`（三路 + RRF + 拒答）、`rag/client.py`（自动拉起 + 降级）、`kb_retrieve` 接入 MCP（第 26 个工具）与内置 Agent；`.scratch/tmp/_rrf_sweep.py` 权重网格、`calibrate_threshold.py` + `.scratch/tmp/_op_point.py` 工作点扫描确定阈值 0.58。**终测：Recall@5 = 1.000、MRR@10 = 0.897、负样本误召回 0.000**；`.scratch/tmp/_verify_rag_tool.py` 13 项端到端检查全通（含降级、自动拉起、拒答、健康检查）。
- 留痕：`CHANGELOG.md` v261009.1、`rag/README.md`；报告 `rag/eval/report-20261009-*.md`。
- 未做（按 §1 边界）：M4 PDF 全文入库、M5 生成层 `kb_answer`。

## 10. 追加执行：PDF 全文 + 界面入口（2026-10-09 第二轮，用户要求）

用户提出两点：**「Literature/PDF 内的文献不能被检索到吗，它们应统属知识库的一部分」** 与
**「界面里找不到 RAG 的应用」**。二者都成立（M4 原在边界外、RAG 只有工具入口），本轮补齐：

- **M4 提前完成**（PyMuPDF 逐页提取 56 篇 / 14,106 块 / 460 万字符，全部有文本层，无需 OCR；命中带页码）；
  同时修掉一个破坏性缺陷（增量指纹按 `(doc_id, source_type)` 分域；曾被 `--pdf-only` 误删 3,093 个 md 块）。
- **界面入口**：全局搜索（Ctrl/⌘K）改为「关键词 + 语义检索 · 含 PDF 全文」双分区，标题行有 RAG 状态条，
  PDF 命中显示 `PDF p.N` 并点击直达 PDF 阅读工作区；新增深链 `?q=关键词`；后端加
  `GET /api/rag/search`、`GET /api/rag/status`（打包 exe 走 HTTP 兜底）。
- **置信度语义按实测重设计**（见 §6.1 第 4 条）：不再用分数编置信度（三种信号实测全部重叠），
  改为证据结构；`low` 也照常返回结果 —— 检索工具不该替调用方决定「找不到」。
- **终测**：Recall@5 **0.981**、MRR@10 **0.874**、负样本高置信误标率 **0.000**；
  界面已实拍验收（`.scratch/preview/_verify_rag_search.png`，619×485，0.3 MP）。
- 留痕：`CHANGELOG.md` v261009.2、`rag/README.md` 全面更新。

### 10.1 第三批（用户反馈：点进去是目录/参考文献）2026-10-09

- **入库端剔噪**：新增 `rag/pdf.py:page_kind()`，逐页判定 refs / toc / front 并默认跳过（`--keep-noise` 可保留）；
  实测剔除 1,311 个片段（PDF 片段 14,106 → 12,795，噪声占比 4.9% → 1.6%）。判定逻辑改动由
  `doc_updated = pdfv2` 指纹自动触发重嵌 —— 再不会出现「改了提取逻辑但没重索引」。
- **跳转落点**：`openPaper(id, page)` / `openByAttachment(att, page)` 支持指定页，RAG 命中直达命中页；
  关键实现细节是**布局稳定后再兜底跳一次**（`build()` 期间 `track()` 会改写 `S.current`），
  新增深链 `?paper=&page=`。检索质量终测不变：Recall@5 0.981 / MRR@10 0.874 / 负样本高置信误标 0.000。
- **pdf.js 本地化**（`tools/fetch_pdfjs.py` → `web/vendor/pdfjs/`，本地专用不入库）：断网可用 + 消除
  无头验收假失败。记录一个工具事实：`tools/shot_page.py` 的 `--wait` 就是 `--virtual-time-budget`，
  **不等 JS 注入脚本与 worker 的加载**，凡依赖 CDN 的界面验证都会假失败；且工作台静态服务只实现 GET
  （HEAD → 501），本地可用性探测不能用 HEAD。
- 自检：`tools/rag_check.py` 扩到 **42 项**（含 pdf.js 本地化、跳转带页码），断言改为与版本号无关；
  当前 42/0 全通。
