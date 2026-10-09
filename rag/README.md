# rag · kb 检索增强层（本地 RAG）

> 设计与决策依据：`docs/kb-RAG可行版方案.md`（含 10 处事实核对修正）
> 本文件只讲：怎么跑、怎么测、怎么排障。

## 语料范围

**知识条目 md（199 条）+ 文献 PDF 全文（56 篇）** —— 两者同处一个向量空间，结果里用 `source_type` 区分。

| 来源 | 规模 | 分块方式 | 标注 |
| --- | --- | --- | --- |
| `Knowledge/**/*.md` | 199 条 → 3,093 块（97.9 万字符） | 条目内 ~380 字分块 | `md`，引用 `doc_id` |
| `Knowledge/Literature/PDF/*.pdf` | 56 篇 → **9,879 块**（剔噪后，原始 14,106 块） | **逐页**分块，保留页码 | `pdf`，引用文献条目 `doc_id` + `page` |

**剔噪**（`page_kind()` 页级 + `chunk_is_noise()` 片段级，`--keep-noise` 可保留）：目录页/参考文献页/封面/
摘要页与引用块的关键词密度极高，会被向量检索顶到前面却毫无证据价值。判据含全角归一化（中文学位论文的
「［4］…［D］．西安电子科技大学」）、短行+引用标记密度、中文学位论文文献类型标记、文本层乱码（□）；
改动提取逻辑时把 `rag/pdf.py:EXTRACT_VERSION` 加一即可让 PDF 分域自动重嵌，不会出现「改了规则没重索引」。

PDF 通过 `documents.attachment` 挂回文献条目（实测 **56/56** 精确对应），因此命中 PDF 片段时引用的是
**知识库条目 id + 页码**（如「文献-高轨非合作目标多视线分布式相对导航方法 第 3 页」），而不是裸文件名。
56 篇全部有文本层（无需 OCR）；若将来遇到扫描件，`build_index.py` 会跳过并写入 `meta.pdf_no_text`。

## 组成

| 文件 | 作用 |
| --- | --- |
| `config.py` | 路径/常量；`apply_hf_env()` 把 HF 缓存重定向到 `.rag/models`（必须在 import sentence_transformers 之前调用） |
| `chunk.py` | 条目/页面分块 + frontmatter 剥离（容忍 CRLF）+ 片段摘要 |
| `pdf.py` | PDF 逐页文本提取（PyMuPDF）+ 条目↔PDF 映射 |
| `store.py` | `rag.sqlite` schema 与读写（chunks / 向量 BLOB / 按 `(doc_id, source_type)` 分域的增量指纹） |
| `embedder.py` | bge-small-zh-v1.5 编码器（GPU 优先、fp16、查询侧加 bge-zh 官方前缀） |
| `build_index.py` | 从 `index.sqlite` + md + PDF 构建/增量刷新向量索引 |
| `search.py` | 三路检索（FTS 复用工作台表 / 向量 / 图）+ RRF 融合 + 硬拒答与置信分档 |
| `service.py` | 本机 HTTP 服务（127.0.0.1:8770），模型常驻显存 |
| `client.py` | stdlib 客户端：自动拉起服务 / 降级为 FTS+图 |
| `fetch_model.py` | 下载并自检模型 |
| `eval/` | 评测集、四档评测、阈值标定、报告与 `threshold.json` |

## 快速开始

```bat
:: 1) 依赖（cuda 环境，仅一次）
C:\Users\<你>\.conda\envs\cuda\python.exe -m pip install sentence-transformers pymupdf

:: 2) 权重（仅一次，约 95 MB，落在 .rag/models）
C:\Users\<你>\.conda\envs\cuda\python.exe rag\fetch_model.py

:: 3) 建/刷新向量索引（默认 md + PDF 都处理；增量，秒级~分钟级）
C:\Users\<你>\.conda\envs\cuda\python.exe rag\build_index.py
::    --rebuild 全量 | --no-pdf 只 md | --pdf-only 只 PDF | --pdf-limit 3 小样

:: 4) 起服务（也可由工具首次调用自动拉起）
run_rag_service.bat

:: 5) 命令行验证
D:\Software\Miniforge\python.exe rag\client.py "星点提取的阈值怎么定"
```

## 三个使用入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| **工作台界面** | 顶栏「⌕ 搜索 / Ctrl+⌘K」→ 弹窗下半部「**语义检索 · 含 PDF 全文**」 | 关键词结果在上、语义结果在下；PDF 命中显示 `PDF p.N`，点击直接进 PDF 阅读工作区；深链 `http://127.0.0.1:8765/?q=关键词` 可直接打开 |
| **MCP 工具** | `kb_retrieve`（第 26 个） | Claude / Trae / WorkBuddy 直接调用；MCP 按会话启动，改完代码下次连接即生效 |
| **工作台内置 Agent** | `kb_retrieve` | 默认（无人设）即可用；**已存盘的人设白名单需在设置页勾选**（`reader` 内置默认已加） |

返回结构：`sources[]`（`doc_id` / `title` / `kind` / `snippet` / `page` / `source_type` / `score` / `in_fts` / `in_vector`）+ `confidence` + `caveats` + `related[]`。引用结论时必须回链 `doc_id`（PDF 片段再带页码）。

## 检索质量（冻结评测集 60 条 = 52 正样本 + 8 负样本，2026-10-09）

| 档 | Recall@5 | MRR@10 | 负样本高置信误标率 |
| --- | --- | --- | --- |
| 修复前基线（仅关键词） | 0.154 | 0.070 | — |
| 工作台 FTS 修复后 | 0.385 | 0.183 | — |
| 仅向量 | 0.827 | 0.772 | — |
| **融合（交付档，含 PDF 全文）** | **0.981** | **0.896** | **0.000** |

```bat
python rag\eval\run_eval.py --mode fts_legacy --db .scratch\tmp\index-snapshot-<date>.sqlite
python rag\eval\run_eval.py --mode fts | vector | rrf [--report 报告.md]
python rag\eval\calibrate_threshold.py     :: 分数分布
```

## 关键设计取舍（都有实测依据）

1. **条目必须分块**：`「条目即 chunk」不成立` —— kb 条目均 ~8 KB ≈ 3000+ 中文字，远超 bge 的 512 token 上限，整条嵌入只剩前 16%。改为 380 字/块 + 按 doc 聚合取最高分；PDF 另按页分块以保留页码。
2. **图不进主排序**：含 graph 的 RRF 组合 MRR ≤ 0.790，而 `vector + fts(0.5)` = 0.897。图只作 `related[]` 输出。
3. **置信度不用分数编，用证据结构**（`rag/eval/signal_experiment.py` 实测）：
   - 绝对分、`top1` 相对全库的 z、`margin` 三种信号**都无法分开**「跨语言正确命中 0.55~0.61」（如「传感器切换时的配准」→《Cross-Spectral Navigation with Sensor Handover》=0.593）与「离题命中 0.48~0.61」（如「激光通信终端…」→ 某篇空间目标检测论文 = 0.610）。这是 bge-small-zh 在本语料上的判别力上限。
   - 因此：**硬拒答**只留给「几乎没有证据」（FTS 无命中 **且** 相似度 < 0.45）；**confidence** 按证据结构给 ——
     `high` = 关键词≥3 命中且向量≥0.62，或向量 ≥0.75；`medium` = 有关键词命中，或向量 ≥0.65（高于实测离题上限 0.6096）；`low` = 仅弱语义召回。
   - **`low` 也照常返回结果**并附「属候选线索，请核对原文」——检索工具不该替调用方决定「找不到」。负样本实测高置信误标率 0.000。
4. **分词唯一实现**：写入侧（工作台）与查询侧（本层）都调 `app/kb_segment.py`。
5. **服务独立进程 + 可降级**：服务不可用时自动降级为 FTS+图，`caveats` 与界面状态条都会说明。
6. **增量指纹按 `(doc_id, source_type)` 分域**：同一条文献既有 md 正文块又有 PDF 全文块，混在一起会互相污染（`build_index.py` 曾因此误删 3093 个 md 块，已修并加注释防回归）。

6. **入库前剔除噪声页**：目录页/参考文献页关键词密度极高，会在向量检索里被顶到前面却毫无证据价值（用户实测反馈）。`rag/pdf.py:page_kind()` 逐页判定 refs/toc/front 并默认跳过（`--keep-noise` 可保留），实测剔掉 1,311 个片段；判定逻辑改动由 `doc_updated = pdfv<N>` 指纹自动触发重嵌。
7. **命中直达页码**：`openPaper(id, page)` / `openByAttachment(att, page)` / 深链 `?paper=&page=` 都支持指定页；跳页在布局稳定后会兜底再跳一次（`build()` 期间 `track()` 会改写当前页）。
8. **pdf.js 本地优先**：`tools/fetch_pdfjs.py` 把 pdf.js + cmaps + standard_fonts 拉到 `web/vendor/pdfjs/`（本地专用、不入库），加载先试本地再回退 CDN；**该目录必须整体不入库**——只提交 JS 而没有 cmaps，clone 后会“本地可用”却渲染不出中文，比直接用 CDN 更糟。

## 排障

| 现象 | 处理 |
| --- | --- |
| 首次调用慢（~20 s） | 服务冷启动加载模型；起一次后常驻 |
| `caveats` 出现「已降级为本地 FTS + 图」 | 服务未启动/模型未就绪：看 `.rag/logs/service.log`，或跑 `run_rag_service.bat` |
| 新加的 PDF / 条目搜不到 | `python rag\build_index.py`（增量；只重嵌变更分域） |
| 服务在跑但结果没更新 | 代码或索引变更后服务需重启（`POST /shutdown` 后重跑 `run_rag_service.bat`），或调 `POST /reindex` 让它重载矩阵 |
| 报 `Unrecognized processing class in BAAI/bge-small-zh-v1.5` | HuggingFace 不可达导致的半离线分支（实测 `WinError 10060`）。`rag/config.py` 已改为**本地有快照就强制离线**；若仍报错说明缓存缺失，跑一次 `python rag/fetch_model.py` |
| 界面「相似度」看着很小（0.01x） | 那是 RRF 融合分；真实余弦在 `sources[].similarity`（界面已优先显示相似度） |
| 想关掉向量 | 工具参数 `use_vector=false`，或 `run_rag_service.bat --no-model` |
| 显存被占 | 服务常驻约 1 GB；不用时关掉服务窗口/进程即可 |

## 已知边界

- **不做生成层**：不提供 `kb_answer`，生成交给调用方 LLM（本机无本地 LLM 运行时）。
- **扫描件 PDF**：无文本层的会被跳过并记录在 `meta.pdf_no_text`，需离线 OCR 后才能入库。
- **跨语言弱**：bge-small-zh 对英文文献的语义分辨有限（见上文取舍 3）；若要提升中↔英检索，下一步换 `bge-m3`（多语言，约 2.2 GB）并重建索引。
- **模型权重不入库**：`.rag/` 已 gitignore；换机需重跑 `fetch_model.py`。
