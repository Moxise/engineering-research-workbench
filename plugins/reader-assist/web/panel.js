/* reader-assist · 阅读区 AI 助手（从 plugins/literature-reader 拆出，v261009.15）
 *
 * 归属：本插件 = 阅读区的 **AI 面板**（翻译/总结/整理/润色/自定义指令 + 多模态截图 + 结果写回笔记）。
 *       LLM 调用仍走内核 `POST /api/agent/assist`；文献笔记读写走内核 `/api/literature/<id>/note`。
 *
 * 两个接缝：
 *   ① `window.ERWPanels.readerTab`（内核）——把「AI」这个 tab 贡献给阅读区；插件停用 → tab 自然消失；
 *   ② `window.ERWReaderAssist`（**阅读区插件**提供的公开接口）——阅读区的三条入口把动作派发给本插件：
 *        · 选中文本 → 工具条「AI 翻译 / 总结 / 整理」：`run(action, {text})`
 *        · 框选完成（多模态开启）：阅读区自动切到本插件的 tab，用户再点「用框选区域」
 *        · 「笔记」tab 的「AI 整理」：`fromNote(text)`
 *      阅读区在派发前会先切到本插件声明的 `tabId`，所以 `run()` 里只需更新状态并重画。
 *
 * 依赖的内核/阅读区接缝：`window.erwFetch`、`window.ERWToast`（可选）、`window.ERWMarkdown`（可选，
 * 结果区渲染，缺失时回退自带轻量 Markdown）、`window.ERWVisionEnabled` / `window.ERWAssistCustomActions`（设置项）、
 * 以及 readerTab 渲染上下文 `{paper, refreshList, aiPolish, selection(), capture{page(),area()}}`。
 */
(function () {
  'use strict';

  var q = function (s, r) { return (r || document).querySelector(s); };
  var qa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function api(url, opts) {
    var init = Object.assign({}, opts || {}, { headers: { 'Content-Type': 'application/json' } });
    if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
    return (window.erwFetch || fetch)(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.message || d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function toast(msg, bad) {
    if (typeof window.ERWToast === 'function') { try { window.ERWToast(msg, bad); return; } catch (e) {} }
    var stack = q('#toast-stack'); if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (bad ? ' error' : '');
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  var TAB_ID = 'ai';
  var A = { text: '', image: '', result: '', error: '', busy: false, instruction: '', busyLabel: '' };
  var CTX = null, ROOT = null;
  var LABELS = { translate: 'AI 翻译中…', summarize: 'AI 总结中…', organize: 'AI 整理中…', polish: 'AI 润色笔记中…', custom: 'AI 处理中…' };

  function paper() { return (CTX && CTX.paper) || null; }
  function selection() { try { return (CTX && CTX.selection && CTX.selection()) || {}; } catch (e) { return {}; } }
  function selectionText() { var s = selection(); return s && s.kind === 'text' ? String(s.text || '') : ''; }
  function capPage() { try { return (CTX && CTX.capture && CTX.capture.page && CTX.capture.page()) || ''; } catch (e) { return ''; } }
  function capArea() { try { return (CTX && CTX.capture && CTX.capture.area && CTX.capture.area()) || ''; } catch (e) { return ''; } }
  function refreshList() { try { CTX && CTX.refreshList && CTX.refreshList(); } catch (e) {} }
  /* 自己的 tab 自己负责可见：无论调用方（阅读区工具条 / 笔记 tab / 直接 run）从哪进来，
     先把本插件的 tab 切到前台，面板才看得到（阅读区在派发前也会切一次，这里是兜底）。 */
  function activate() { try { CTX && CTX.activate && CTX.activate(); } catch (e) {} }

  /* 结果区轻量 Markdown（内核 ERWMarkdown 缺席时的兜底）：模型输出先转义，再拼受控标签 */
  function mdLite(s) {
    var lines = String(s || '').split(/\r?\n/), out = '', inList = false, inCode = false;
    var inline = function (t) { return esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>'); };
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i], t = raw.replace(/\s+$/, '');
      if (t.trim().indexOf('```') === 0) { if (inList) { out += '</ul>'; inList = false; } out += inCode ? '</code></pre>' : '<pre><code>'; inCode = !inCode; continue; }
      if (inCode) { out += esc(raw) + '\n'; continue; }
      var h = t.match(/^(#{1,6})\s+(.*)$/);
      if (h) { if (inList) { out += '</ul>'; inList = false; } out += '<h4>' + inline(h[2]) + '</h4>'; continue; }
      var li = t.match(/^\s*[-*·]\s+(.*)$/);
      if (li) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + inline(li[1]) + '</li>'; continue; }
      if (!t.trim()) { if (inList) { out += '</ul>'; inList = false; } continue; }
      if (inList) { out += '</ul>'; inList = false; }
      out += '<p>' + inline(t) + '</p>';
    }
    if (inList) out += '</ul>';
    if (inCode) out += '</code></pre>';
    return out;
  }

  async function paint() {
    var root = ROOT || q('#lit-side-body'); if (!root) return;
    var a = A;
    var cas = window.ERWAssistCustomActions ? window.ERWAssistCustomActions() : [];
    var vis = window.ERWVisionEnabled ? window.ERWVisionEnabled() : false;
    var srcHtml = a.image
      ? '<img class="lit-ai-img" src="' + esc(a.image) + '" alt="待处理截图">' + (a.text ? '<div class="lit-ai-src-text">' + esc(a.text.slice(0, 600)) + (a.text.length > 600 ? '…' : '') + '</div>' : '')
      : '<div class="lit-ai-src-text">' + (a.text ? esc(a.text.slice(0, 600)) + (a.text.length > 600 ? '…' : '') : '<i>暂无。选中文字后点工具栏「AI 翻译 / 总结 / 整理」' + (vis ? '，或点下方「📷 截取当前页」用截图代替选中文本' : '') + '；也可在「笔记」页点「AI 整理」。</i>') + '</div>';
    root.innerHTML = '<div class="lit-ai">'
      + '<div class="lit-ai-src"><span class="lit-ai-src-head">待处理内容</span>' + srcHtml + '</div>'
      + (vis ? '<div class="lit-ai-capture"><button type="button" class="secondary-btn" id="lit-ai-cap-page" title="把当前整页截图交给 AI（多模态），代替选中文本，公式/表格提取更准">📷 截取当前页</button>' + (selection().kind === 'area' ? '<button type="button" class="secondary-btn" id="lit-ai-cap-area" title="把当前框选区域截图交给 AI">用框选区域</button>' : '') + (a.image ? '<button type="button" class="ghost-btn danger" id="lit-ai-cap-clear" title="移除截图，回到纯文本模式">移除截图</button>' : '') + '</div>' : '')
      + '<div class="lit-ai-actions"><button type="button" class="secondary-btn" data-aia="translate">翻译</button><button type="button" class="secondary-btn" data-aia="summarize">总结</button><button type="button" class="secondary-btn" data-aia="organize">整理</button><button type="button" class="secondary-btn" data-aia="polish" title="处理当前待处理内容为润色后的笔记">润色</button>'
      + cas.map(function (x) { return '<button type="button" class="secondary-btn" data-aia="' + esc(x.id) + '" title="' + esc(String(x.prompt || '').slice(0, 100)) + '">' + esc(x.name) + '</button>'; }).join('') + '</div>'
      + '<div class="lit-ai-custom"><input id="lit-ai-instr" placeholder="自定义指令，如：解释这段公式推导…" value="' + esc(a.instruction || '') + '"><button type="button" class="primary-btn" id="lit-ai-run">运行</button></div>'
      + (a.busy
        ? '<div class="lit-ai-result busy">' + esc(a.busyLabel || 'AI 处理中…') + '</div>'
        : (a.result
          ? '<div class="lit-ai-result" id="lit-ai-out"></div><div class="lit-ai-foot"><button type="button" class="primary-btn" id="lit-ai-append" title="把 AI 结果追加到该文献笔记（条目正文）末尾">追加到笔记</button><button type="button" class="secondary-btn" id="lit-ai-replace" title="用 AI 结果整体替换该文献笔记（条目正文）">替换笔记</button><button type="button" class="secondary-btn" id="lit-ai-copy">复制</button></div>'
          : (a.error ? '<div class="lit-ai-result err">' + esc(a.error) + '</div>' : '')))
      + '</div>';

    /* 结果渲染：优先内核 ERWMarkdown（与全站一致，含代码高亮/mermaid/mathjax），缺失时回退轻量实现 */
    var out = q('#lit-ai-out');
    if (out && a.result) {
      if (window.ERWMarkdown && typeof window.ERWMarkdown.renderInto === 'function') {
        try { await window.ERWMarkdown.renderInto(out, String(a.result)); }
        catch (e) { out.innerHTML = mdLite(a.result); }
      } else {
        out.innerHTML = mdLite(a.result);
      }
    }

    qa('[data-aia]').forEach(function (b) { b.onclick = function () { runAssist(b.dataset.aia, '', b.textContent); }; });
    var capP = q('#lit-ai-cap-page');
    if (capP) capP.onclick = function () {
      var d = capPage();
      if (!d) { A = Object.assign({}, A, { error: '当前页尚未渲染完成，请稍候再试' }); paint(); return; }
      A = Object.assign({}, A, { image: d, result: '', error: '' }); paint();
    };
    var capA = q('#lit-ai-cap-area');
    if (capA) capA.onclick = function () {
      var d = capArea();
      if (d) { A = Object.assign({}, A, { image: d, result: '', error: '' }); paint(); }
    };
    var capX = q('#lit-ai-cap-clear');
    if (capX) capX.onclick = function () { A = Object.assign({}, A, { image: '' }); paint(); };
    var runBtn = q('#lit-ai-run');
    if (runBtn) runBtn.onclick = function () {
      var v = (q('#lit-ai-instr') || {}).value || '';
      A = Object.assign({}, A, { instruction: v });
      if (!v.trim()) { A = Object.assign({}, A, { error: '请先输入自定义指令（如：解释这段公式推导）' }); paint(); return; }
      runAssist('custom', v);
    };
    var ap = q('#lit-ai-append'); if (ap) ap.onclick = function () { noteApply('append'); };
    var rp = q('#lit-ai-replace'); if (rp) rp.onclick = function () { noteApply('replace'); };
    var cp = q('#lit-ai-copy');
    if (cp) cp.onclick = async function () {
      try { await navigator.clipboard.writeText(A.result || ''); cp.textContent = '已复制'; setTimeout(function () { if (cp) cp.textContent = '复制'; }, 900); } catch (e) {}
    };
  }

  async function runAssist(action, instruction, label) {
    if (A.busy) return;
    var src = selectionText() || A.text || '';
    var img = A.image || '';
    if (!src && !img) {
      A = Object.assign({}, A, { text: '', result: '', busy: false, error: '没有可处理的内容：请先在 PDF 中选中文字、截取页面/框选区域，或在「笔记」页用 AI 整理已有笔记。' });
      paint(); return;
    }
    A = Object.assign({}, A, {
      text: src,
      instruction: action === 'custom' ? (instruction || A.instruction) : '',
      result: '', error: '', busy: true,
      busyLabel: LABELS[action] || (label ? 'AI ' + label + '中…' : 'AI 处理中…'),
    });
    paint();
    try {
      var body = { action: action, text: src, instruction: action === 'custom' ? (instruction || A.instruction) : '' };
      if (img) body.image = img;
      var d = await api('/api/agent/assist', { method: 'POST', body: body });
      A = Object.assign({}, A, { result: String(d.content || ''), error: '', busy: false });
    } catch (e) {
      A = Object.assign({}, A, { error: String((e && e.message) || e), result: '', busy: false });
    }
    paint();
  }

  async function noteApply(mode) {
    var p = paper(); if (!p || !A.result) return;
    var btn = q(mode === 'replace' ? '#lit-ai-replace' : '#lit-ai-append');
    if (btn) { btn.disabled = true; btn.textContent = '写入中…'; }
    try {
      var d = await api('/api/literature/' + encodeURIComponent(p.id) + '/note');
      var cur = String(d.content || '');
      var next = mode === 'replace' ? A.result : cur.replace(/\s+$/, '') + (cur.trim() ? '\n\n' : '') + A.result + '\n';
      await api('/api/literature/' + encodeURIComponent(p.id) + '/note', { method: 'POST', body: { content: next } });
      if (btn) { btn.textContent = '已写入 ✓'; setTimeout(function () { if (btn) btn.textContent = mode === 'replace' ? '替换笔记' : '追加到笔记'; }, 1200); }
      refreshList();
    } catch (e) {
      if (btn) { btn.textContent = '失败'; setTimeout(function () { if (btn) btn.textContent = mode === 'replace' ? '替换笔记' : '追加到笔记'; }, 1500); }
      toast(String((e && e.message) || e), true);
    }
  }

  /* ── 注册：① 阅读区 tab（AI 面板） ② 阅读区助手接缝（三条入口的落点） ── */
  function mount(rootEl, ctx) {
    ROOT = rootEl; CTX = ctx || null;
    paint();
  }
  /* 阅读区打开文献时会主动把实时上下文交过来（`attach`）：这样本插件在**自己的 tab 还没被渲染**时
     也拿得到 activate / selection / capture —— 从工具条或「笔记」tab 触发时不会画进别人的容器。 */
  function attach(ctx) { CTX = ctx || CTX; }
  if (window.ERWPanels) {
    window.ERWPanels.register({
      id: 'reader-assist',
      label: '阅读区 AI 助手',
      readerTab: { id: TAB_ID, label: 'AI', title: 'AI 翻译 / 总结 / 整理 / 笔记润色', render: mount },
    });
  } else {
    console.error('[reader-assist] 内核缺少 window.ERWPanels，插件不生效');
  }
  var assistRegistered = false;
  function registerAssist() {
    if (assistRegistered) return true;
    if (!window.ERWReaderAssist || typeof window.ERWReaderAssist.register !== 'function') return false;
    window.ERWReaderAssist.register({
      id: 'reader-assist',
      tabId: TAB_ID,
      attach: attach,
      run: function (action, payload) {
        payload = payload || {};
        activate();
        if (payload.text != null) A = Object.assign({}, A, { text: String(payload.text || '') });
        if (payload.image != null) A = Object.assign({}, A, { image: String(payload.image || '') });
        if (payload.instruction != null) A = Object.assign({}, A, { instruction: String(payload.instruction || '') });
        return runAssist(action, payload.instruction || '', payload.label || '');
      },
      fromNote: function (text) {
        var t = String(text || '').trim();
        activate();
        if (!t) {
          A = Object.assign({}, A, { text: '', result: '', busy: false, error: '笔记为空：先写点内容，或回到 PDF 选中段落用「AI 整理」生成。' });
          paint(); return;
        }
        A = Object.assign({}, A, { text: t, instruction: '', result: '', error: '', busy: false });
        return runAssist('polish', '');
      },
      useImage: function (dataUrl) {
        activate();
        A = Object.assign({}, A, { image: String(dataUrl || ''), result: '', error: '' });
        paint();
      },
    });
    assistRegistered = true;
    return true;
  }
  if (!registerAssist()) {
    /* 阅读区插件的脚本按拓扑序（本插件 requires 它）应先加载；这里再兜两次，避免顺序意外导致静默失效 */
    document.addEventListener('DOMContentLoaded', function () {
      if (!registerAssist()) setTimeout(function () {
        if (!registerAssist())
          console.error('[reader-assist] 阅读区未提供 window.ERWReaderAssist（需启用「文献阅读工作区」插件，且内核 ≥ v261009.14）');
      }, 400);
    });
  }
})();
