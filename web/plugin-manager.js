/* plugin-manager.js · v261009.4 —— 设置 → 插件
 *
 * 一块**插件预览 + 设置**页（本文件是内核模块，但走 §6.3 的自登记扩展点，
 * 不在 app.js 里加分支）：
 *   · 预览：每个插件的状态、版本、来源、类型、权限（带中文说明）、路由、面板、工具、依赖、目录
 *   · 设置：读/写插件**自己的配置接口**（`/api/plugins/<id>/config`）——
 *     内核不解释插件配置的内容，只做转发与展示。插件没提供配置接口时如实说明。
 *   · 启停：写 `System/plugins.json`（**不删文件、不动数据**），后端热重载插件集合。
 *
 * 数据来自 `GET /api/plugins?detail=1`（内核的插件预览接口）。
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
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
        if (!r.ok) throw new Error((d && (d.message || d.error)) || ('HTTP ' + r.status));
        return d;
      });
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

  var PLUGINS = {};   /* id -> 预览信息（配置块据此判断该插件有没有配置接口） */
  var STATE_LABEL = {
    available: ['可用', 'ok'], blocked: ['被阻塞', 'warn'],
    rejected: ['被拒绝', 'bad'], conflict: ['冲突', 'bad'],
  };

  function badge(state) {
    var pair = STATE_LABEL[state] || [state, ''];
    return '<span class="badge ' + pair[1] + '">' + esc(pair[0]) + '</span>';
  }

  function metaRow(label, value) {
    if (!value || (Array.isArray(value) && !value.length)) return '';
    return '<div class="pm-meta-row"><span class="pm-meta-label">' + esc(label) + '</span><span>' + value + '</span></div>';
  }

  function cardHtml(plugin) {
    var hasDetail = plugin.state !== undefined;   /* 旧后端只返回精简清单（无 state/enabled/…） */
    var perms = (plugin.permissions || []).map(function (p) {
      return '<span class="pm-perm" title="' + esc(p.label) + '">' + esc(p.id) + '</span>';
    }).join('');
    var panels = (plugin.nav || []).map(function (n) {
      var where = n.slot ? ('槽位 ' + esc(n.slot)) : '导航页';
      return '<span class="pm-panel">' + esc(n.label) + ' <small>' + where + '</small></span>';
    }).join('') || '<span class="muted">无前端面板</span>';
    return '<section class="card card-pad pm-card" data-plugin-card="' + esc(plugin.id) + '">'
      + '<div class="card-head"><div><div class="card-kicker">' + esc(plugin.kind || 'plugin') + '</div>'
      + '<h3>' + esc(plugin.name || plugin.id) + ' <small class="muted">' + esc(plugin.id) + '</small></h3>'
      + (plugin.description ? '<div class="row-meta">' + esc(plugin.description) + '</div>' : '') + '</div>'
      + '<div class="pm-actions">'
      + (hasDetail ? badge(plugin.state) : '<span class="badge">未知</span>')
      + '<label class="pm-switch"' + (hasDetail ? '' : ' title="当前后端不支持启停接口：请重启工作台"') + '>'
      + '<input type="checkbox" data-plugin-toggle="' + esc(plugin.id) + '"'
      + (hasDetail ? (plugin.enabled ? ' checked' : '') : ' disabled') + '> 启用</label></div></div>'
      + (hasDetail && plugin.state !== 'available' && plugin.reason
          ? '<div class="pm-alert"><strong>不可用</strong><span>' + esc(plugin.reason) + (plugin.fix ? '　建议：' + esc(plugin.fix) : '') + '</span></div>' : '')
      + '<div class="pm-meta">'
      + metaRow('版本', '<code>' + esc(plugin.version || '-') + '</code>　来源 <code>' + esc(plugin.source || '-') + '</code>'
          + (plugin.distribution ? '　分发 <code>' + esc(plugin.distribution) + '</code>' : '')
          + (plugin.core_min ? '　要求内核 <code>' + esc(plugin.core_min) + '</code>' : ''))
      + (hasDetail
          ? metaRow('权限', perms || '<span class="muted">未声明</span>')
            + metaRow('路由', (plugin.routes || []).map(function (r) { return '<code>' + esc(r) + '</code>'; }).join(' ') || '<span class="muted">无后端接口</span>')
            + metaRow('工具', (plugin.mcp_tools || []).map(function (t) { return '<code>p_' + esc(plugin.id) + '__' + esc(t) + '</code>'; }).join(' ') || '<span class="muted">未注册工具</span>')
            + metaRow('依赖', (plugin.dependencies || []).map(function (d) { return '<code>' + esc(d) + '</code>'; }).join(' ') || '<span class="muted">无</span>')
            + metaRow('目录', '<code class="pm-path">' + esc(plugin.dir || '') + '</code>')
          : '<div class="field-help">当前后端只下发了精简清单（' + esc(Object.keys(plugin).join(' / '))
            + '）——权限、路由、工具、目录与启用状态需要新版后端。</div>')
      + metaRow('面板', panels)
      + '</div>'
      + '<div class="pm-config" data-plugin-config="' + esc(plugin.id) + '"></div></section>';
  }

  function configBlock(plugin) {
    if (!plugin.has_config_route) {
      return '<div class="pm-config-head">配置</div><div class="field-help">该插件没有提供配置接口（'
        + (plugin.nav_labels && plugin.nav_labels.length
            ? '它的设置在自己的界面里：' + esc(plugin.nav_labels.join('、'))
            : '它不需要配置')
        + '）。</div>';
    }
    return '<div class="pm-config-head">配置　<small class="muted">'
      + '内核只做转发，读写都由插件自己负责（<code>' + esc(plugin.config_url) + '</code>）</small></div>'
      + '<div class="field-help" data-config-hint>正在读取…</div>'
      + '<textarea class="pm-json" data-config-json rows="6" spellcheck="false" style="display:none"></textarea>'
      + '<div class="pm-config-actions" style="display:none">'
      + '<button class="secondary-btn" data-config-reload>重新读取</button>'
      + '<button class="primary-btn" data-config-save>保存配置</button></div>';
  }

  function render(root) {
    root.innerHTML = '<div class="card-head"><div><div class="card-kicker">PLUGINS</div><h3>插件</h3>'
      + '<div class="row-meta">插件放在 <code>plugins/</code> 或 <code>&lt;数据根&gt;/plugins/</code> 即被发现；'
      + '停用只改「开不开」，<strong>不删文件、不动数据</strong>。</div></div>'
      + '<div style="display:flex;gap:8px"><button class="secondary-btn" id="pm-reload">重新扫描</button>'
      + '<button class="secondary-btn" id="pm-reload-page">刷新页面</button></div></div>'
      + '<div id="pm-list"><div class="empty">正在读取插件…</div></div>';

    $('#pm-reload').onclick = function () { load(root); };
    $('#pm-reload-page').onclick = function () { location.reload(); };
    wire(root);
    load(root);
  }

  function wire(root) {
    var stale = Object.keys(PLUGINS).length > 0
      && Object.keys(PLUGINS).every(function (id) { return PLUGINS[id].state === undefined; });
    if (!stale) {
      $$('[data-plugin-toggle]', root).forEach(function (box) {
        box.onchange = async function () {
          var id = box.dataset.pluginToggle;
          box.disabled = true;
          try {
            var res = await api('/api/plugin-manager/' + encodeURIComponent(id) + '/enabled',
              { method: 'POST', body: { enabled: box.checked } });
            toast((box.checked ? '已启用 ' : '已停用 ') + id + '（刷新页面后侧栏同步）');
            if (res && res.note) console.info('[plugins] ' + res.note);
          } catch (e) {
            box.checked = !box.checked;
            toast('切换失败：' + e.message, true);
          } finally {
            box.disabled = false;
          }
        };
      });
    }
    $$('[data-plugin-config]', root).forEach(function (host) {
      var id = host.dataset.pluginConfig;
      var plugin = PLUGINS[id] || {};
      if (plugin.state === undefined) {
        /* 旧后端：连状态都没有，配置接口自然也谈不上——如实说明，别猜 */
        host.innerHTML = '<div class="pm-config-head">配置</div><div class="field-help">'
          + '当前后端没有提供插件预览字段（权限 / 路由 / 配置接口），请**重启工作台**后再看这里。</div>';
        return;
      }
      if (!plugin.has_config_route) {
        /* 没有配置接口就直接说明，不发无谓的请求（也可能是 404 噪音） */
        var hint = (plugin.nav_labels || []).length
          ? '该插件没有提供配置接口——它的设置在自己的界面里：' + esc(plugin.nav_labels.join('、'))
          : '该插件没有提供配置接口，也不需要配置。';
        host.innerHTML = '<div class="pm-config-head">配置</div><div class="field-help">' + hint + '</div>';
        return;
      }
      api('/api/plugins/' + encodeURIComponent(id) + '/config')
        .then(function (cfg) {
          host.innerHTML = configBlock(plugin);
          var ta = $('[data-config-json]', host);
          var hintEl = $('[data-config-hint]', host);
          var actions = $('.pm-config-actions', host);
          ta.value = JSON.stringify(cfg, null, 2);
          hintEl.textContent = '当前配置（JSON，可直接编辑后保存）。';
          ta.style.display = '';
          actions.style.display = '';
          $('[data-config-reload]', host).onclick = function () {
            api('/api/plugins/' + encodeURIComponent(id) + '/config').then(function (c) {
              ta.value = JSON.stringify(c, null, 2);
              toast('已重新读取');
            }).catch(function (e) { toast(e.message, true); });
          };
          $('[data-config-save]', host).onclick = async function () {
            var parsed;
            try { parsed = JSON.parse(ta.value); }
            catch (e) { toast('JSON 解析失败：' + e.message, true); return; }
            try {
              var saved = await api('/api/plugins/' + encodeURIComponent(id) + '/config', { method: 'POST', body: parsed });
              ta.value = JSON.stringify(saved && saved.config ? saved.config : saved, null, 2);
              toast(id + ' 配置已保存');
            } catch (e) { toast('保存失败：' + e.message, true); }
          };
        })
        .catch(function (e) {
          host.innerHTML = '<div class="pm-config-head">配置</div><div class="field-help">读取配置失败：'
            + esc(e.message) + '（可在插件自己的界面里设置）</div>';
        });
    });
  }

  async function load(root) {
    var list = $('#pm-list', root);
    list.innerHTML = '<div class="empty">正在读取插件…</div>';
    try {
      var data = await api('/api/plugins?detail=1');
      var plugins = data.plugins || [];
      PLUGINS = {};
      plugins.forEach(function (p) { PLUGINS[p.id] = p; });
      var stale = plugins.length > 0 && plugins[0].state === undefined;
      var banner = stale
        ? '<div class="pm-alert"><strong>后端版本较旧，本页信息不完整</strong>'
          + '<span>当前后端只下发了 <code>' + esc(Object.keys(plugins[0]).join(' / ')) + '</code>，'
          + '所以权限、路由、工具、目录与「启用」状态都读不到（勾选框也因此不可用）。'
          + '<b>重启工作台</b>（<code>python server.py</code>）后再打开本页即可。</span></div>'
        : '';
      if (!plugins.length) {
        list.innerHTML = '<div class="empty">还没有发现任何插件。把插件目录（含 plugin.json）放进 <code>plugins/</code> 即可。</div>';
        return;
      }
      list.innerHTML = '<div class="row-meta" style="margin-bottom:10px">共 ' + plugins.length + ' 个 · 内核 '
        + esc(data.core_version || '-') + ' · 未启用则其工具与面板都不出现（I10）</div>'
        + banner
        + plugins.map(cardHtml).join('');
      wire(root);
    } catch (e) {
      list.innerHTML = '<div class="pm-alert"><strong>插件清单读取失败</strong><span>' + esc(e.message) + '</span></div>';
    }
  }

  if (window.ERWPanels) {
    window.ERWPanels.register({
      id: 'plugin-manager',
      label: '插件',
      settingsTab: {
        id: 'plugins',
        label: '插件',
        render: function (container) { render(container); },
      },
    });
  }
})();
