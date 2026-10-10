/* 文献笔记面板 · 插件 litnote v1.1.0
 *
 * 两块 UI：
 *  ① **阅读区「笔记」tab**（`ERWPanels.readerTab`，v261009.12 新扩展点）——
 *     从核心阅读器 `web/literature.js` 原样搬出（textarea + 保存 + 插入图片 + AI 整理）。
 *     阅读器只负责把 tab 排进右侧 tab 行，并传入上下文 `{paper, refreshList, aiPolish}`。
 *  ② 没有导航页：这个插件不占侧栏（它是阅读区的一部分 + 两个 AI 工具）。
 *
 * 数据面走**插件自己的路由**（`/api/plugins/litnote/note|note-image`），
 * 后端再经 `core_api.lit_*` 访问核心文献库——插件不直接读 Workspace 下的文件。
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function api(url, opts) {
    var init = Object.assign({}, opts || {}, { headers: { 'Content-Type': 'application/json' } });
    if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
    return (window.erwFetch || fetch)(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d && (d.message || d.error)) || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(message, error) {
    if (typeof window.ERWToast === 'function') { window.ERWToast(message, error); return; }
    var stack = $('#toast-stack');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }
  function insertAtCursor(ta, text) {
    if (!ta) return;
    var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var e = ta.selectionEnd == null ? s : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    var p = s + text.length;
    ta.focus();
    ta.setSelectionRange(p, p);
  }

  function renderNote(root, context) {
    var paper = (context && context.paper) || {};
    var paperId = String(paper.id || '');
    if (!paperId) {
      root.innerHTML = '<div class="empty">没有打开中的文献。</div>';
      return;
    }
    root.innerHTML = '<div class="empty">正在读取笔记…</div>';

    api('/api/plugins/litnote/note?paper_id=' + encodeURIComponent(paperId))
      .then(function (d) {
        root.innerHTML = '<textarea class="lit-note" data-ln-note placeholder="Markdown 文献笔记…（与知识库条目正文同源，文献编辑器里看到的是同一份）">'
          + esc(d.content || '') + '</textarea>'
          + '<div class="lit-note-actions"><span>与知识库条目正文同源 · Ctrl+S 保存</span>'
          + '<span style="display:flex;gap:6px">'
          + '<button type="button" class="secondary-btn" data-ln-img title="上传图片到笔记图片目录，并在光标处插入 Markdown 图片引用">插入图片</button>'
          + '<input type="file" data-ln-img-file accept="image/png,image/jpeg,image/webp" hidden>'
          + '<button type="button" class="secondary-btn" data-ln-ai title="把当前笔记交给 AI 整理润色，结果在 AI 面板确认后写入">AI 整理</button>'
          + '<button class="primary-btn" data-ln-save>保存笔记</button>'
          + '</span></div>';

        var ta = $('[data-ln-note]', root);
        var save = function () {
          return api('/api/plugins/litnote/note', {
            method: 'POST', body: { paper_id: paperId, content: ta.value },
          }).then(function () {
            toast('笔记已保存');
            if (context && typeof context.refreshList === 'function') context.refreshList();   /* 左栏摘要取自同一份正文 */
          }).catch(function (e) { toast('保存失败：' + e.message, true); });
        };
        $('[data-ln-save]', root).onclick = save;
        ta.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        });

        var imgBtn = $('[data-ln-img]', root);
        var imgFile = $('[data-ln-img-file]', root);
        imgBtn.onclick = function () { imgFile.click(); };
        imgFile.onchange = async function () {
          var f = imgFile.files && imgFile.files[0];
          imgFile.value = '';
          if (!f) return;
          var old = imgBtn.textContent;
          imgBtn.disabled = true;
          imgBtn.textContent = '上传中…';
          try {
            var dataUrl = await new Promise(function (res, rej) {
              var r = new FileReader();
              r.onload = function () { res(String(r.result)); };
              r.onerror = function () { rej(new Error('读取图片失败')); };
              r.readAsDataURL(f);
            });
            var out = await api('/api/plugins/litnote/note-image', {
              method: 'POST', body: { paper_id: paperId, data_url: dataUrl },
            });
            insertAtCursor(ta, '![' + (out.filename || '图片') + '](' + (out.path || '') + ')');
          } catch (e) {
            toast(e && e.message ? e.message : String(e), true);
          } finally {
            imgBtn.disabled = false;
            imgBtn.textContent = old;
          }
        };
        $('[data-ln-ai]', root).onclick = function () {
          if (context && typeof context.aiPolish === 'function') context.aiPolish(ta.value);
          else toast('当前阅读器不支持把笔记交给 AI 整理', true);
        };
      })
      .catch(function (e) {
        root.innerHTML = '<div class="empty danger">读取笔记失败：' + esc(e.message) + '</div>';
      });
  }

  if (window.ERWPanels) {
    window.ERWPanels.register({
      id: 'litnote',
      label: '文献笔记',
      readerTab: {
        id: 'notes',
        label: '笔记',
        title: '文献笔记（由插件 litnote 提供：与知识库条目正文同源）',
        render: function (container, context) { renderNote(container, context); },
      },
    });
  }
})();
