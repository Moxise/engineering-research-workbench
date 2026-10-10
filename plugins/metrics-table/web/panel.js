/* 指标表 · 插件面板 v1.0.0
 * 自登记侧栏导航页「指标表」；样式全部落在 [data-plugin="metrics-table"] 内。
 */
(function () {
  'use strict';

  var ID = 'metrics-table';
  if (window.__erwMetricsLoaded) return;
  window.__erwMetricsLoaded = true;

  function el(sel, root) { return (root || document).querySelector(sel); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, e) { if (typeof window.ERWToast === 'function') window.ERWToast(m, e); else console.log('[' + ID + '] ' + m); }
  function api(path, body) {
    var f = window.erwFetch || window.fetch;
    var init = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined;
    return f('/api/plugins/' + ID + '/' + path, init).then(function (r) { return r.json(); });
  }
  function num(v, digits) { return (v === null || v === undefined) ? '—' : Number(v).toFixed(digits === undefined ? 4 : digits); }

  var LAST = null;

  function renderTable(data) {
    LAST = data;
    el('#mt-summary').innerHTML = '<span class="mt-chip">扫描 ' + data.scanned + ' 条</span>'
      + '<span class="mt-chip ok">带指标 ' + data.with_metrics + '</span>'
      + '<span class="mt-chip">指标列 ' + (data.columns || []).length + '</span>'
      + (data.scope && (data.scope.project || data.scope.kind)
          ? '<span class="mt-chip">范围 ' + esc(data.scope.project || data.scope.kind) + '</span>' : '');

    if (!data.rows || !data.rows.length) {
      el('#mt-table').innerHTML = '<div class="mt-empty">' + esc(data.hint || '没有数据') + '</div>';
      el('#mt-detail').innerHTML = '';
      return;
    }
    var cols = data.columns || [];
    var head = '<tr><th class="mt-sticky">条目</th><th>状态</th><th>日期</th>'
      + cols.map(function (c) {
          return '<th title="' + esc(c.key) + '：有 ' + c.filled + ' 条 / 缺 ' + c.missing + ' 条'
            + (c.unit ? ' · 单位 ' + esc(c.unit) : '') + '">' + esc(c.key) + '</th>';
        }).join('') + '<th>缺项</th></tr>';
    var stat = '<tr class="mt-stat"><td class="mt-sticky">列统计</td><td></td><td></td>'
      + cols.map(function (c) {
          return '<td title="min/max/mean">' + num(c.min, 3) + ' / ' + num(c.max, 3) + ' / ' + num(c.mean, 3)
            + (c.numeric < c.filled ? '<em>（' + (c.filled - c.numeric) + ' 项非数值）</em>' : '') + '</td>';
        }).join('') + '<td></td></tr>';
    var body = data.rows.map(function (r) {
      return '<tr data-mt-row="' + esc(r.id) + '"><td class="mt-sticky"><span class="mt-kind">' + esc(r.kind) + '</span> '
        + '<span class="mt-title">' + esc(r.title) + '</span></td>'
        + '<td>' + esc(r.status || '') + '</td><td>' + esc(r.date || '') + '</td>'
        + cols.map(function (c) {
            var v = r.metrics[c.key];
            return v === undefined ? '<td class="mt-miss">—</td>' : '<td>' + esc(v) + '</td>';
          }).join('')
        + '<td class="mt-miss">' + (r.missing.length ? esc(r.missing.join('、')) : '') + '</td></tr>';
    }).join('');
    el('#mt-table').innerHTML = '<div class="mt-scroll"><table class="mt-table">'
      + '<thead>' + head + '</thead><tbody>' + stat + body + '</tbody></table></div>'
      + (data.warnings && data.warnings.length
          ? '<div class="mt-warn">解析提示：' + esc(data.warnings.slice(0, 5).join('；')) + '</div>' : '');
    Array.prototype.slice.call(el('#mt-table').querySelectorAll('[data-mt-row]')).forEach(function (tr) {
      tr.onclick = function () { showDetail(tr.dataset.mtRow); };
    });
  }

  function showDetail(id) {
    api('entry?id=' + encodeURIComponent(id)).then(function (d) {
      if (!d.ok) { toast(d.error, true); return; }
      var keys = Object.keys(d.metrics || {});
      el('#mt-detail').innerHTML = '<div class="mt-detail-box">'
        + '<b>' + esc(d.title) + '</b> <span class="mt-kind">' + esc(d.kind) + '</span>'
        + '<div class="mt-muted">' + esc(d.id) + (d.projects && d.projects.length ? ' · ' + esc(d.projects.join('、')) : '') + '</div>'
        + (keys.length
            ? '<ul class="mt-kv">' + keys.map(function (k) {
                return '<li><code>' + esc(k) + '</code> ' + esc(d.metrics[k]) + '</li>'; }).join('') + '</ul>'
            : '<div class="mt-warn">这条条目还没有 ```' + esc(d.block_name) + ' 块。可以让 Agent 用 '
              + '<code>record_metrics</code> 记录（会先生成草稿让你确认）。</div>')
        + '<div class="mt-muted">正文预览：</div><pre class="mt-preview">' + esc(d.preview || '') + '</pre>'
        + '</div>';
    }).catch(function (e) { toast('读取失败：' + e.message, true); });
  }

  function render(main) {
    main.innerHTML = ''
      + '<section class="card card-pad mt-card">'
      +   '<div class="card-kicker">METRICS</div>'
      +   '<h3>指标表</h3>'
      +   '<p class="row-meta">把条目正文里的 <code>```metrics</code> 块聚合成跨条目对照表：'
      +     '列 = 指标键并集，缺项显式标出，附列统计。数据始终在条目正文里（可搜索、可 diff、随备份与报告一起走）。</p>'
      +   '<div class="mt-controls">'
      +     '<label><span>项目</span><select id="mt-project"><option value="">全部项目</option></select></label>'
      +     '<label><span>类别</span><select id="mt-kind">'
      +       '<option value="">默认（配置）</option><option value="experiment">实验</option><option value="note">笔记</option>'
      +       '<option value="milestone">里程碑</option><option value="summary">工作总结</option>'
      +       '<option value="idea">灵感</option><option value="journal">研究日志</option></select></label>'
      +     '<button class="secondary-btn" id="mt-refresh" type="button">刷新</button>'
      +     '<a class="secondary-btn" id="mt-csv" href="#" download>导出 CSV</a>'
      +     '<a class="secondary-btn" id="mt-md" href="#" download>导出 Markdown</a>'
      +   '</div>'
      +   '<div class="mt-summary" id="mt-summary"></div>'
      +   '<div id="mt-table"></div>'
      +   '<div id="mt-detail"></div>'
      +   '<div class="mt-hint">写入方式：让 Agent 用 <code>p_metrics-table__record_metrics</code>（写工具，'
      +     '内核会先生成草稿等你确认）；也可以自己在条目正文里手写这个块。'
      +     '块格式：<code>键: 值</code> 一行一项，例如 <code>mIoU: 0.732</code>。</div>'
      + '</section>';

    function params() {
      var p = el('#mt-project').value, k = el('#mt-kind').value;
      return '?project=' + encodeURIComponent(p) + '&kind=' + encodeURIComponent(k);
    }
    function load() {
      api('table' + params()).then(function (data) {
        renderTable(data);
        el('#mt-csv').href = '/api/plugins/' + ID + '/export' + params() + '&format=csv';
        el('#mt-md').href = '/api/plugins/' + ID + '/export' + params() + '&format=md';
      }).catch(function (e) { toast('读取失败：' + e.message, true); });
    }
    el('#mt-refresh').onclick = load;
    el('#mt-project').onchange = load;
    el('#mt-kind').onchange = load;
    /* 项目下拉：用内核公开 API 拿项目名；拿不到就保持"全部项目"（不影响表格本身） */
    (window.erwFetch || window.fetch)('/api/projects').then(function (r) { return r.json(); })
      .then(function (names) {
        (names || []).forEach(function (n) {
          var opt = document.createElement('option');
          opt.value = n; opt.textContent = n;
          el('#mt-project').appendChild(opt);
        });
      }).catch(function () { /* 忽略：降级为全部项目 */ });
    load();
  }

  if (!window.ERWPanels) return;
  window.ERWPanels.register({
    id: ID,
    group: 'research',
    before: 'experiments',
    label: '指标表',
    icon: '▩',
    eyebrow: 'DATA',
    title: '指标表',
    render: function (main) { render(main); },
  });
})();
