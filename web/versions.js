/* 版本 · 内核模块（v261009.42）
 *
 * 「同一笔记的不同版本」的工作台入口：族列表 + 逐版对照（含来源）+ 按小节挑内容合并 + 归档/取回。
 * 数据与闸门都在内核（app/versions.py、/api/versions*），本模块只负责呈现与发请求。
 *
 * 与插件无关：内核自带页面，用 ERWPanels 自登记（和 manual.js / plugin-manager.js 同款），不动 app.js。
 */
(function () {
  'use strict';

  var ID = 'versions';
  var STATE = { families: [], current: '', detail: null, picks: {}, archiveAfter: false };

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
      +     '<div class="card-kicker">VERSIONS</div>'
      +     '<h3>版本</h3>'
      +     '<p class="row-meta">同一笔记的不同版本会归成一条「版本族」——'
      +       '不论它是在工作台里改的，还是外部工具（MCP）塞进来的。</p>'
      +     '<div class="ver-stats" id="ver-stats"></div>'
      +     '<div class="ver-list" id="ver-list"><div class="empty compact">正在读取…</div></div>'
      +   '</aside>'
      +   '<section class="card ver-pane" id="ver-pane"><div class="empty">选择左侧的一条版本族</div></section>'
      + '</section>';

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
      var list = main.querySelector('#ver-list');
      if (!STATE.families.length) {
        list.innerHTML = '<div class="empty compact">还没有任何版本族</div>';
        return;
      }
      list.innerHTML = STATE.families.map(function (f) {
        return '<button type="button" class="ver-item' + (f.base_id === STATE.current ? ' active' : '')
          + '" data-ver-base="' + esc(f.base_id) + '" title="' + esc(f.title) + '">'
          + '<span class="ver-item-main">' + esc(f.title || f.base_id) + '</span>'
          + '<span class="ver-item-meta">' + esc(KIND_LABEL[f.kind] || f.kind || '')
          + (f.variant_count ? ' · <b>' + f.variant_count + ' 个版本</b>' : '') + '</span></button>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('[data-ver-base]'), function (btn) {
        btn.onclick = function () { loadDetail(btn.dataset.verBase, main); };
      });
    }).catch(function (e) {
      main.querySelector('#ver-list').innerHTML = '<div class="ver-error">读取失败：' + esc(e.message) + '</div>';
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
    }).join('') || '<div class="empty compact">这一族目前没有活着的版本（已归档或从未分叉）</div>';

    var sectionRows = (d.sections || []).map(function (heading) {
      var options = ['<option value="">基准（' + esc(base.label || '当前内容') + '）</option>']
        .concat(variants.map(function (v) {
          return '<option value="' + esc(v.id) + '">' + esc(v.label || v.id) + '</option>';
        })).join('');
      return '<label class="ver-srow"><span class="ver-sname">' + esc(heading) + '</span>'
        + '<select class="search-input" data-ver-pick="' + esc(heading) + '">' + options + '</select></label>';
    }).join('') || '<div class="empty compact">这一族的正文里没有 H2 小节，可整篇挑选后再手工调整</div>';

    var archived = (d.archived || []).map(function (row) {
      return '<div class="ver-arow"><span class="ver-vtext"><b>' + esc(row.title || row.id) + '</b>'
        + '<span class="ver-vmeta">归档于 ' + esc(String(row.archived_at || '').replace('T', ' ').slice(0, 16))
        + ' · ' + esc(row.origin || '') + '</span></span>'
        + '<button class="secondary-btn" data-ver-restore="' + esc(row.file) + '">取回</button></div>';
    }).join('');

    pane.innerHTML = ''
      + '<div class="ver-head"><div><div class="card-kicker">' + esc(KIND_LABEL[base.kind] || base.kind || '')
      + '</div><h3>' + esc(base.title || d.base_id) + '</h3>'
      + '<div class="row-meta">基条 <code>' + esc(d.base_id) + '</code> · '
      + (d.forked ? '<b>' + variants.length + ' 个活版本</b>（合并前任何一版都不会被覆盖）' : '当前没有分叉')
      + '</div></div>'
      + '<button class="secondary-btn" id="ver-refresh">刷新</button></div>'

      + '<div class="ver-block"><h4>① 各版本（勾选后可归档）</h4>'
      + '<div class="ver-base-row"><span class="ver-vtext"><b>' + esc(base.title || '')
      + '</b><span class="ver-vmeta">基条 · 更新 '
      + esc(String(base.updated || '').replace('T', ' ').slice(0, 16)) + '</span></span>'
      + originChip(base) + '</div>' + versionRows + '</div>'

      + '<div class="ver-block"><h4>② 按小节挑内容（合并结果写回基条）</h4>'
      + sectionRows
      + '<label class="ver-check"><input type="checkbox" id="ver-archive-after"> 合并后把被替换的版本一并归档</label>'
      + '<div class="ver-actions"><button class="primary-btn" id="ver-merge">合并</button>'
      + '<button class="secondary-btn" id="ver-archive">归档勾选的版本</button></div></div>'

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
    pane.querySelector('#ver-merge').onclick = function () {
      var picks = STATE.picks;
      if (!Object.keys(picks).length) { toast('先为至少一个小节选一个来源版本', true); return; }
      post('/versions/merge', { base_id: d.base_id, picks: picks, archive_merged: STATE.archiveAfter })
        .then(function (out) {
          toast('已合并：替换小节 ' + ((out.replaced_sections || []).join('、') || '（无）'));
          loadDetail(d.base_id, main);
        }).catch(function (e) { toast('合并失败：' + e.message, true); });
    };
    pane.querySelector('#ver-archive').onclick = function () {
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
