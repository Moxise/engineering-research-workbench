/* 版本管理 · 插件前端 v1.0.0（v261009.44 从内核页面搬成插件）
 *
 * 页面：版本族列表（默认只看分叉中 + 搜索）+ 逐版对照（含来源）+ 按小节挑内容合并 + 归档/取回。
 * 数据与闸门都在内核：本面板只调用本插件后端 /api/plugins/version-manager/*（后端再走 core_api）。
 */
(function () {
  'use strict';

  var API = '/api/plugins/version-manager';
  var STATE = { families: [], current: '', detail: null, picks: {}, archiveAfter: false,
                filter: 'forked', keyword: '' };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(path, options) {
    return (window.erwFetch || window.fetch)(path, options).then(function (r) {
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
      + '<section class="vm-layout">'
      +   '<aside class="card vm-side">'
      +     '<div><div class="card-kicker">VERSIONS</div><h3>版本</h3>'
      +       '<p class="row-meta">同一笔记的不同版本会归成一条「版本族」——'
      +       '不论在工作台里改的，还是外部工具（MCP）塞进来的。</p></div>'
      +     '<div class="vm-stats" id="vm-stats"></div>'
      +     '<div class="vm-filter">'
      +       '<span class="vm-seg" id="vm-seg">'
      +         '<button type="button" data-vm-filter="forked" class="active">只看分叉中</button>'
      +         '<button type="button" data-vm-filter="all">全部</button>'
      +       '</span>'
      +       '<input class="search-input" id="vm-search" placeholder="按标题过滤…">'
      +     '</div>'
      +     '<div class="vm-list" id="vm-list"><div class="empty compact">正在读取…</div></div>'
      +   '</aside>'
      +   '<section class="card vm-pane" id="vm-pane">'
      +     '<div class="empty">选择左侧的一条版本族</div></section>'
      + '</section>';

    var seg = main.querySelector('#vm-seg');
    Array.prototype.forEach.call(seg.querySelectorAll('[data-vm-filter]'), function (btn) {
      btn.onclick = function () {
        STATE.filter = btn.dataset.vmFilter;
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        paintList(main);
      };
    });
    var search = main.querySelector('#vm-search');
    search.oninput = function () { STATE.keyword = search.value.trim().toLowerCase(); paintList(main); };
    loadFamilies(main);
  }

  function loadFamilies(main) {
    api(API + '/overview').then(function (data) {
      STATE.families = data.families || [];
      var counts = data.counts || {};
      var stats = main.querySelector('#vm-stats');
      if (stats) {
        stats.innerHTML = '<span class="vm-chip">' + (counts.families || 0) + ' 个族</span>'
          + '<span class="vm-chip ' + ((counts.forked || 0) ? 'on' : '') + '">'
          + (counts.forked || 0) + ' 个分叉中</span>'
          + '<span class="vm-chip">' + (counts.variants || 0) + ' 个版本</span>';
      }
      // 没有任何分叉时别给一个空列表：自动回落到「全部」，并在列表上方说明原因
      if (!counts.forked && STATE.filter === 'forked') {
        STATE.filter = 'all';
        var seg = main.querySelector('#vm-seg');
        if (seg) {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
            b.classList.toggle('active', b.dataset.vmFilter === 'all');
          });
        }
        var note = document.createElement('div');
        note.className = 'vm-hint';
        note.style.margin = '0 0 6px';
        note.innerHTML = '当前<b>没有分叉中的版本族</b>，下面列出全部 ' + (counts.families || 0)
          + ' 个族——建一条同名不同版（如 <code>知识-方法-X（v2）</code>）后，它会自动归族并出现在这里。';
        var listBox = main.querySelector('#vm-list');
        if (listBox && listBox.parentElement) listBox.parentElement.insertBefore(note, listBox);
      }
      paintList(main);
      var first = visible().find(function (f) { return f.variant_count > 0; }) || visible()[0];
      if (first) loadDetail(first.base_id, main);
    }).catch(function (e) {
      main.querySelector('#vm-list').innerHTML = '<div class="vm-error">读取失败：' + esc(e.message) + '</div>';
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
    var list = main.querySelector('#vm-list');
    var rows = visible();
    if (!rows.length) {
      list.innerHTML = '<div class="empty compact">'
        + (STATE.filter === 'forked' ? '当前没有分叉中的版本族' : '没有匹配的族') + '</div>';
      return;
    }
    list.innerHTML = rows.map(function (f) {
      return '<button type="button" class="vm-item' + (f.base_id === STATE.current ? ' active' : '')
        + '" data-vm-base="' + esc(f.base_id) + '" title="' + esc(f.title) + '">'
        + '<span class="vm-item-main">' + esc(f.title || f.base_id) + '</span>'
        + '<span class="vm-item-meta">' + esc(KIND_LABEL[f.kind] || f.kind || '')
        + (f.variant_count ? ' · <b>' + f.variant_count + ' 个版本</b>' : '') + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-vm-base]'), function (btn) {
      btn.onclick = function () { loadDetail(btn.dataset.vmBase, main); };
    });
  }

  function loadDetail(baseId, main) {
    STATE.current = baseId;
    STATE.picks = {};
    STATE.archiveAfter = false;
    var pane = main.querySelector('#vm-pane');
    pane.innerHTML = '<div class="empty">正在读取版本族…</div>';
    Array.prototype.forEach.call(main.querySelectorAll('.vm-item'), function (el) {
      el.classList.toggle('active', el.dataset.vmBase === baseId);
    });
    api(API + '/family?id=' + encodeURIComponent(baseId)).then(function (data) {
      STATE.detail = data;
      paintDetail(main);
    }).catch(function (e) {
      pane.innerHTML = '<div class="vm-error">读取失败：' + esc(e.message) + '</div>';
    });
  }

  function originChip(doc) {
    var surface = doc.origin_surface || '';
    var cls = surface === 'mcp' ? 'mcp' : surface === 'plugin' ? 'plugin' : surface === 'agent' ? 'agent' : 'ui';
    return '<span class="vm-origin ' + cls + '" title="' + esc(doc.origin || '') + '">'
      + esc(doc.origin || '（未记录来源）') + '</span>';
  }

  function paintDetail(main) {
    var d = STATE.detail || {};
    var pane = main.querySelector('#vm-pane');
    var variants = d.variants || [];
    var base = d.base || {};

    var versionRows = variants.map(function (v) {
      return '<label class="vm-vrow">'
        + '<input type="checkbox" data-vm-archive="' + esc(v.id) + '">'
        + '<span class="vm-vtext"><b>' + esc(v.title) + '</b>'
        + '<span class="vm-vmeta">版本名 <code>' + esc(v.label || '（无）') + '</code> · 更新 '
        + esc(String(v.updated || '').replace('T', ' ').slice(0, 16)) + ' · 小节 '
        + (v.sections || []).length + ' 个</span>'
        + originChip(v) + '</span></label>';
    }).join('');

    var sectionRows = (d.sections || []).map(function (heading) {
      var options = ['<option value="">基准（当前内容）</option>']
        .concat(variants.map(function (v) {
          return '<option value="' + esc(v.id) + '">' + esc(v.label || v.id) + '</option>';
        })).join('');
      return '<label class="vm-srow"><span class="vm-sname">' + esc(heading) + '</span>'
        + '<select class="search-input" data-vm-pick="' + esc(heading) + '">' + options + '</select></label>';
    }).join('');

    var archived = (d.archived || []).map(function (row) {
      return '<div class="vm-arow"><span class="vm-vtext"><b>' + esc(row.title || row.id) + '</b>'
        + '<span class="vm-vmeta">归档于 ' + esc(String(row.archived_at || '').replace('T', ' ').slice(0, 16))
        + ' · ' + esc(row.origin || '') + '</span></span>'
        + '<button class="secondary-btn" data-vm-restore="' + esc(row.file) + '">取回</button></div>';
    }).join('');

    var forkHint = '<div class="vm-hint">这一族<b>当前没有分叉</b>：只有基条一条。'
      + '当你<b>再建一条同名不同版</b>（如 <code>' + esc((base.title || '') + '（v2）')
      + '</code>，界面或 MCP 都行），或族里已有版本后再改基条时，这里就会出现可对照、可合并的版本。</div>';

    pane.innerHTML = ''
      + '<div class="vm-head"><div><div class="card-kicker">' + esc(KIND_LABEL[base.kind] || base.kind || '')
      + '</div><h3>' + esc(base.title || d.base_id) + '</h3>'
      + '<div class="row-meta">基条 <code>' + esc(d.base_id) + '</code> · '
      + (d.forked ? '<b>' + variants.length + ' 个活版本</b>（合并前任何一版都不会被覆盖）' : '当前没有分叉')
      + '</div></div>'
      + '<button class="secondary-btn" id="vm-refresh">刷新</button></div>'

      + '<div class="vm-block"><h4>① 各版本' + (variants.length ? '（勾选后可归档）' : '') + '</h4>'
      + '<div class="vm-base-row"><span class="vm-vtext"><b>' + esc(base.title || '')
      + '</b><span class="vm-vmeta">基条 · 更新 '
      + esc(String(base.updated || '').replace('T', ' ').slice(0, 16)) + '</span></span>'
      + originChip(base) + '</div>'
      + (variants.length ? versionRows : forkHint) + '</div>'

      + (variants.length
          ? '<div class="vm-block"><h4>② 按小节挑内容（合并结果写回基条）</h4>' + sectionRows
            + '<label class="vm-check"><input type="checkbox" id="vm-archive-after"> 合并后把被替换的版本一并归档</label>'
            + '<div class="vm-actions"><button class="primary-btn" id="vm-merge">合并</button>'
            + '<button class="secondary-btn" id="vm-archive">归档勾选的版本</button></div></div>'
          : '')

      + (archived ? '<div class="vm-block"><h4>③ 已归档（保留可追溯）</h4>' + archived + '</div>' : '');

    pane.querySelector('#vm-refresh').onclick = function () { loadDetail(d.base_id, main); };
    Array.prototype.forEach.call(pane.querySelectorAll('[data-vm-pick]'), function (sel) {
      sel.onchange = function () {
        if (sel.value) STATE.picks[sel.dataset.vmPick] = sel.value;
        else delete STATE.picks[sel.dataset.vmPick];
      };
    });
    var after = pane.querySelector('#vm-archive-after');
    if (after) after.onchange = function () { STATE.archiveAfter = after.checked; };
    var mergeBtn = pane.querySelector('#vm-merge');
    if (mergeBtn) mergeBtn.onclick = function () {
      var picks = STATE.picks;
      if (!Object.keys(picks).length) { toast('先为至少一个小节选一个来源版本', true); return; }
      post(API + '/merge', { base_id: d.base_id, picks: picks, archive_merged: STATE.archiveAfter })
        .then(function (out) {
          toast('已合并：替换小节 ' + ((out.replaced_sections || []).join('、') || '（无）'));
          loadDetail(d.base_id, main);
        }).catch(function (e) { toast('合并失败：' + e.message, true); });
    };
    var archBtn = pane.querySelector('#vm-archive');
    if (archBtn) archBtn.onclick = function () {
      var ids = Array.prototype.slice.call(pane.querySelectorAll('[data-vm-archive]:checked'))
        .map(function (box) { return box.dataset.vmArchive; });
      if (!ids.length) { toast('先勾选要归档的版本', true); return; }
      post(API + '/archive', { base_id: d.base_id, variant_ids: ids })
        .then(function (out) { toast('已归档 ' + ((out.archived || []).length) + ' 个版本'); loadDetail(d.base_id, main); })
        .catch(function (e) { toast('归档失败：' + e.message, true); });
    };
    Array.prototype.forEach.call(pane.querySelectorAll('[data-vm-restore]'), function (btn) {
      btn.onclick = function () {
        post(API + '/restore', { base_id: d.base_id, file: btn.dataset.vmRestore })
          .then(function () { toast('已取回成一个新版本'); loadDetail(d.base_id, main); })
          .catch(function (e) { toast('取回失败：' + e.message, true); });
      };
    });
  }

  if (!window.ERWPanels) return;
  window.ERWPanels.register({
    id: 'version-manager',
    group: 'research',
    before: 'graph',
    label: '版本',
    icon: '⑂',
    eyebrow: 'VERSIONS',
    title: '版本',
    render: function (main) { render(main); },
  });
})();
