/* 版本 · 内核模块（v261009.43）
 *
 * 「同一笔记的不同版本」的工作台入口：族列表（默认只看分叉中 + 可搜索）+ 逐版对照（含来源）
 * + 按小节挑内容合并 + 归档/取回。数据与闸门都在内核（app/versions.py、/api/versions*）。
 *
 * v261009.43 修 UI：① 左栏默认只看分叉中的族（202 个族全列出来等于噪音）+ 搜索框 + 过滤切换；
 * ② 右栏不再有大片空白（CSS 侧）；③ 没有分叉的族给出紧凑提示，不再摆一堆空控件。
 */
(function () {
  'use strict';

  var ID = 'versions';
  var STATE = { families: [], current: '', detail: null, picks: {}, archiveAfter: false,
                filter: 'forked', keyword: '' };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(path, options) {
    return (window.erwFetch || window.fetch)('/api' + path, options).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.message ? data.message : ('HTTP ' + r.status));
        return data;
      });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(body || {}) });
  }
  function toast(m, e) { if (typeof window.ERWToast === 'function') window.ERWToast(m, e); else console.log(m); }

  var KIND_LABEL = { note: '笔记', experiment: '实验', journal: '研究日志', idea: '灵感',
                     milestone: '里程碑', summary: '工作总结', literature: '文献' };

  function render(main) {
    main.innerHTML = ''
      + '<section class="ver-layout">'
      +   '<aside class="card ver-side">'
      +     '<div><div class="card-kicker">VERSIONS</div><h3>版本</h3>'
      +       '<p class="row-meta">同一笔记的不同版本会归成一条「版本族」——'
      +       '不论在工作台里改的，还是外部工具（MCP）塞进来的。</p></div>'
      +     '<div class="ver-stats" id="ver-stats"></div>'
      +     '<div class="ver-filter">'
      +       '<span class="ver-seg" id="ver-seg">'
      +         '<button type="button" data-ver-filter="forked" class="active">只看分叉中</button>'
      +         '<button type="button" data-ver-filter="all">全部</button>'
      +       '</span>'
      +       '<input class="search-input" id="ver-search" placeholder="按标题过滤…">'
      +     '</div>'
      +     '<div class="ver-list" id="ver-list"><div class="empty compact">正在读取…</div></div>'
      +   '</aside>'
      +   '<section class="card ver-pane" id="ver-pane">'
      +     '<div class="empty">选择左侧的一条版本族</div></section>'
      + '</section>';

    var seg = main.querySelector('#ver-seg');
    Array.prototype.forEach.call(seg.querySelectorAll('[data-ver-filter]'), function (btn) {
      btn.onclick = function () {
        STATE.filter = btn.dataset.verFilter;
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        paintList(main);
      };
    });
    var search = main.querySelector('#ver-search');
    search.oninput = function () { STATE.keyword = search.value.trim().toLowerCase(); paintList(main); };
    loadFamilies(main);
  }

  function loadFamilies(main) {
    api('/versions').then(function (data) {
      STATE.families = data.families || [];
      var counts = data.counts || {};
      var stats = main.querySelector('#ver-stats');
      if (stats) {
        stats.innerHTML = '<span class="ver-chip">' + (counts.families || 0) + ' 个族</span>'
          + '<span class="ver-chip ' + ((counts.forked || 0) ? 'on' : '') + '">'
          + (counts.forked || 0) + ' 个分叉中</span>'
          + '<span class="ver-chip">' + (counts.variants || 0) + ' 个版本</span>';
      }
      // 没有任何分叉时别给一个空列表：自动回落到「全部」，并在列表上方说明原因
      if (!counts.forked && STATE.filter === 'forked') {
        STATE.filter = 'all';
        var seg = main.querySelector('#ver-seg');
        if (seg) {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
            b.classList.toggle('active', b.dataset.verFilter === 'all');
          });
        }
        var note = document.createElement('div');
        note.className = 'ver-hint';
        note.style.margin = '0 0 6px';
        note.innerHTML = '当前<b>没有分叉中的版本族</b>，下面列出全部 ' + (counts.families || 0)
          + ' 个族——建一条同名不同版（如 <code>知识-方法-X（v2）</code>）后，它会自动归族并出现在这里。';
        var listBox = main.querySelector('#ver-list');
        if (listBox && listBox.parentElement) listBox.parentElement.insertBefore(note, listBox);
      }
      paintList(main);
      var first = visible().find(function (f) { return f.variant_count > 0; }) || visible()[0];
      if (first) loadDetail(first.base_id, main);
    }).catch(function (e) {
      main.querySelector('#ver-list').innerHTML = '<div class="ver-error">读取失败：' + esc(e.message) + '</div>';
    });
  }

  function visible() {
    var kw = STATE.keyword;
    return STATE.families.filter(function (f) {
      if (STATE.filter === 'forked' && !f.variant_count) return false;
      if (!kw) return true;
      return String(f.title || '').toLowerCase().indexOf(kw) >= 0
        || String(f.base_id || '').toLowerCase().indexOf(kw) >= 0;
    });
  }

  function paintList(main) {
    var list = main.querySelector('#ver-list');
    var rows = visible();
    if (!rows.length) {
      list.innerHTML = '<div class="empty compact">'
        + (STATE.filter === 'forked' ? '当前没有分叉中的版本族' : '没有匹配的族') + '</div>';
      return;
    }
    list.innerHTML = rows.map(function (f) {
      return '<button type="button" class="ver-item' + (f.base_id === STATE.current ? ' active' : '')
        + '" data-ver-base="' + esc(f.base_id) + '" title="' + esc(f.title) + '">'
        + '<span class="ver-item-main">' + esc(f.title || f.base_id) + '</span>'
        + '<span class="ver-item-meta">' + esc(KIND_LABEL[f.kind] || f.kind || '')
        + (f.variant_count ? ' · <b>' + f.variant_count + ' 个版本</b>' : '') + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-ver-base]'), function (btn) {
      btn.onclick = function () { loadDetail(btn.dataset.verBase, main); };
    });
  }

  function loadDetail(baseId, main) {
    STATE.current = baseId;
    STATE.picks = {};
    STATE.archiveAfter = false;
    var pane = main.querySelector('#ver-pane');
    pane.innerHTML = '<div class="empty">正在读取版本族…</div>';
    Array.prototype.forEach.call(main.querySelectorAll('.ver-item'), function (el) {
      el.classList.toggle('active', el.dataset.verBase === baseId);
    });
    api('/versions/' + encodeURIComponent(baseId)).then(function (data) {
      STATE.detail = data;
      paintDetail(main);
    }).catch(function (e) {
      pane.innerHTML = '<div class="ver-error">读取失败：' + esc(e.message) + '</div>';
    });
  }

  function originChip(doc) {
    var surface = doc.origin_surface || '';
    var cls = surface === 'mcp' ? 'mcp' : surface === 'plugin' ? 'plugin' : surface === 'agent' ? 'agent' : 'ui';
    return '<span class="ver-origin ' + cls + '" title="' + esc(doc.origin || '') + '">'
      + esc(doc.origin || '（未记录来源）') + '</span>';
  }

  function paintDetail(main) {
    var d = STATE.detail || {};
    var pane = main.querySelector('#ver-pane');
    var variants = d.variants || [];
    var base = d.base || {};

    var versionRows = variants.map(function (v) {
      return '<label class="ver-vrow">'
        + '<input type="checkbox" data-ver-archive="' + esc(v.id) + '">'
        + '<span class="ver-vtext"><b>' + esc(v.title) + '</b>'
        + '<span class="ver-vmeta">版本名 <code>' + esc(v.label || '（无）') + '</code> · 更新 '
        + esc(String(v.updated || '').replace('T', ' ').slice(0, 16)) + ' · 小节 '
        + (v.sections || []).length + ' 个</span>'
        + originChip(v) + '</span></label>';
    }).join('');

    var sectionRows = (d.sections || []).map(function (heading) {
      var options = ['<option value="">基准（当前内容）</option>']
        .concat(variants.map(function (v) {
          return '<option value="' + esc(v.id) + '">' + esc(v.label || v.id) + '</option>';
        })).join('');
      return '<label class="ver-srow"><span class="ver-sname">' + esc(heading) + '</span>'
        + '<select class="search-input" data-ver-pick="' + esc(heading) + '">' + options + '</select></label>';
    }).join('');

    var archived = (d.archived || []).map(function (row) {
      return '<div class="ver-arow"><span class="ver-vtext"><b>' + esc(row.title || row.id) + '</b>'
        + '<span class="ver-vmeta">归档于 ' + esc(String(row.archived_at || '').replace('T', ' ').slice(0, 16))
        + ' · ' + esc(row.origin || '') + '</span></span>'
        + '<button class="secondary-btn" data-ver-restore="' + esc(row.file) + '">取回</button></div>';
    }).join('');

    var forkHint = '<div class="ver-hint">这一族<b>当前没有分叉</b>：只有基条一条。'
      + '当你<b>再建一条同名不同版</b>（如 <code>' + esc((base.title || '') + '（v2）')
      + '</code>，界面或 MCP 都行），或族里已有版本后再改基条时，这里就会出现可对照、可合并的版本。</div>';

    pane.innerHTML = ''
      + '<div class="ver-head"><div><div class="card-kicker">' + esc(KIND_LABEL[base.kind] || base.kind || '')
      + '</div><h3>' + esc(base.title || d.base_id) + '</h3>'
      + '<div class="row-meta">基条 <code>' + esc(d.base_id) + '</code> · '
      + (d.forked ? '<b>' + variants.length + ' 个活版本</b>（合并前任何一版都不会被覆盖）' : '当前没有分叉')
      + '</div></div>'
      + '<button class="secondary-btn" id="ver-refresh">刷新</button></div>'

      + '<div class="ver-block"><h4>① 各版本' + (variants.length ? '（勾选后可归档）' : '') + '</h4>'
      + '<div class="ver-base-row"><span class="ver-vtext"><b>' + esc(base.title || '')
      + '</b><span class="ver-vmeta">基条 · 更新 '
      + esc(String(base.updated || '').replace('T', ' ').slice(0, 16)) + '</span></span>'
      + originChip(base) + '</div>'
      + (variants.length ? versionRows : forkHint) + '</div>'

      + (variants.length
          ? '<div class="ver-block"><h4>② 按小节挑内容（合并结果写回基条）</h4>' + sectionRows
            + '<label class="ver-check"><input type="checkbox" id="ver-archive-after"> 合并后把被替换的版本一并归档</label>'
            + '<div class="ver-actions"><button class="primary-btn" id="ver-merge">合并</button>'
            + '<button class="secondary-btn" id="ver-archive">归档勾选的版本</button></div></div>'
          : '')

      + (archived ? '<div class="ver-block"><h4>③ 已归档（保留可追溯）</h4>' + archived + '</div>' : '');

    pane.querySelector('#ver-refresh').onclick = function () { loadDetail(d.base_id, main); };
    Array.prototype.forEach.call(pane.querySelectorAll('[data-ver-pick]'), function (sel) {
      sel.onchange = function () {
        if (sel.value) STATE.picks[sel.dataset.verPick] = sel.value;
        else delete STATE.picks[sel.dataset.verPick];
      };
    });
    var after = pane.querySelector('#ver-archive-after');
    if (after) after.onchange = function () { STATE.archiveAfter = after.checked; };
    var mergeBtn = pane.querySelector('#ver-merge');
    if (mergeBtn) mergeBtn.onclick = function () {
      var picks = STATE.picks;
      if (!Object.keys(picks).length) { toast('先为至少一个小节选一个来源版本', true); return; }
      post('/versions/merge', { base_id: d.base_id, picks: picks, archive_merged: STATE.archiveAfter })
        .then(function (out) {
          toast('已合并：替换小节 ' + ((out.replaced_sections || []).join('、') || '（无）'));
          loadDetail(d.base_id, main);
        }).catch(function (e) { toast('合并失败：' + e.message, true); });
    };
    var archBtn = pane.querySelector('#ver-archive');
    if (archBtn) archBtn.onclick = function () {
      var ids = Array.prototype.slice.call(pane.querySelectorAll('[data-ver-archive]:checked'))
        .map(function (box) { return box.dataset.verArchive; });
      if (!ids.length) { toast('先勾选要归档的版本', true); return; }
      post('/versions/archive', { base_id: d.base_id, variant_ids: ids })
        .then(function (out) { toast('已归档 ' + ((out.archived || []).length) + ' 个版本'); loadDetail(d.base_id, main); })
        .catch(function (e) { toast('归档失败：' + e.message, true); });
    };
    Array.prototype.forEach.call(pane.querySelectorAll('[data-ver-restore]'), function (btn) {
      btn.onclick = function () {
        post('/versions/restore', { base_id: d.base_id, file: btn.dataset.verRestore })
          .then(function () { toast('已取回成一个新版本'); loadDetail(d.base_id, main); })
          .catch(function (e) { toast('取回失败：' + e.message, true); });
      };
    });
  }

  if (!window.ERWPanels) return;
  window.ERWPanels.register({
    id: ID,
    group: 'research',
    before: 'graph',
    label: '版本',
    icon: '⑂',
    eyebrow: 'VERSIONS',
    title: '版本',
    render: function (main) { render(main); },
  });
})();
