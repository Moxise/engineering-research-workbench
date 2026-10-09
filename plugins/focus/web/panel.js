/* 专注计时面板 · 插件 focus v1.0.0
 *
 * 从 web/app.js 原样搬出（renderFocus / paintFocus / startFocus / pauseFocus /
 * resetFocus / applyFocusDurations / clampFocusMinutes / syncFocusModeDuration），
 * 逻辑与标记未改写，只把内核内部的 `$` / `$$` / `toast` 换成等价的本地实现。
 *
 * 自登记（§6.3）：导航项、页头与渲染函数都由本文件声明，内核不再认识「专注」。
 * localStorage 键沿用 `focusMinutes` / `breakMinutes`，老用户的设置不会丢。
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* 内核的 toast 是 app.js 内部函数；这里优先用悬浮球提供的 window.ERWToast，否则自建一条 */
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

  function storedInt(key, fallback, min, max) {
    var raw = localStorage.getItem(key);
    var n = Number(raw);
    return raw != null && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  }

  var state = {
    focus: {
      mode: '专注',
      focusMinutes: storedInt('focusMinutes', 25, 1, 240),
      breakMinutes: storedInt('breakMinutes', 5, 1, 120),
      seconds: 0, total: 0, timer: null, running: false,
    },
  };
  state.focus.seconds = state.focus.focusMinutes * 60;
  state.focus.total = state.focus.focusMinutes * 60;

  function render(main) {
    main.innerHTML = `<section class="card focus-panel"><div class="card-kicker">FOCUS TIMER</div><h3>专注计时</h3><p class="focus-caption">专注与休息时长均可自定义，设置保存在当前浏览器。</p><div class="progress-ring" id="focus-ring"></div><div class="focus-time" id="focus-time">25:00</div><div class="focus-mode" id="focus-mode">专注 · 25 分钟</div>
      <div class="focus-duration-panel"><div class="focus-duration-grid"><label><span>专注时长</span><div><input id="focus-minutes" type="number" min="1" max="240" step="1" value="${state.focus.focusMinutes}"><em>分钟</em></div></label><label><span>休息时长</span><div><input id="break-minutes" type="number" min="1" max="120" step="1" value="${state.focus.breakMinutes}"><em>分钟</em></div></label><button class="secondary-btn" id="focus-apply">应用时长</button></div><div class="focus-presets"><span>快速预设</span>${[25, 45, 60, 90].map(n => `<button type="button" data-focus-preset="${n}">${n} min</button>`).join('')}</div></div>
      <div class="focus-actions"><button class="primary-btn" id="focus-start">开始</button><button class="secondary-btn" id="focus-reset">重置</button><button class="secondary-btn" id="focus-mode-btn">切换休息</button></div></section>`;
    paintFocus();
    $('#focus-start').onclick = () => { state.focus.running ? pauseFocus() : startFocus(); };
    $('#focus-reset').onclick = () => resetFocus();
    $('#focus-mode-btn').onclick = () => { pauseFocus(); state.focus.mode = state.focus.mode === '专注' ? '休息' : '专注'; syncFocusModeDuration(); paintFocus(); };
    $('#focus-apply').onclick = () => applyFocusDurations();
    $$('[data-focus-preset]').forEach(btn => btn.onclick = () => { $('#focus-minutes').value = btn.dataset.focusPreset; applyFocusDurations(); });
  }

  function clampFocusMinutes(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }
  function syncFocusModeDuration() {
    state.focus.total = (state.focus.mode === '专注' ? state.focus.focusMinutes : state.focus.breakMinutes) * 60;
    state.focus.seconds = state.focus.total;
  }
  function applyFocusDurations() {
    const focus = clampFocusMinutes($('#focus-minutes')?.value, 1, 240, state.focus.focusMinutes);
    const rest = clampFocusMinutes($('#break-minutes')?.value, 1, 120, state.focus.breakMinutes);
    pauseFocus(); state.focus.focusMinutes = focus; state.focus.breakMinutes = rest;
    localStorage.setItem('focusMinutes', String(focus)); localStorage.setItem('breakMinutes', String(rest));
    if ($('#focus-minutes')) $('#focus-minutes').value = focus; if ($('#break-minutes')) $('#break-minutes').value = rest;
    syncFocusModeDuration(); paintFocus(); toast(`已设置：专注 ${focus} 分钟 · 休息 ${rest} 分钟`);
  }
  function paintFocus() {
    const el = $('#focus-time'); if (!el) return;
    const s = state.focus.seconds;
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('#focus-mode').textContent = `${state.focus.mode} · ${Math.round(state.focus.total / 60)} 分钟`;
    $('#focus-start').textContent = state.focus.running ? '暂停' : '开始';
    const deg = state.focus.total ? Math.max(0, Math.min(360, (1 - s / state.focus.total) * 360)) : 0;
    $('#focus-ring').style.background = `conic-gradient(var(--accent) ${deg}deg,var(--surface-3) ${deg}deg)`;
  }
  function startFocus() {
    if (state.focus.timer) return;
    state.focus.running = true;
    state.focus.timer = setInterval(() => {
      state.focus.seconds = Math.max(0, state.focus.seconds - 1);
      paintFocus();
      if (state.focus.seconds === 0) { pauseFocus(); toast(`${state.focus.mode}计时完成`); }
    }, 1000);
    paintFocus();
  }
  function pauseFocus() { clearInterval(state.focus.timer); state.focus.timer = null; state.focus.running = false; paintFocus(); }
  function resetFocus() { pauseFocus(); state.focus.seconds = state.focus.total; paintFocus(); }

  if (window.ERWPanels) {
    window.ERWPanels.register({
      id: 'focus', group: 'core', before: 'agent',
      label: '专注', icon: '◷', eyebrow: 'CORE WORK', title: '专注',
      render: function (main) { render(main); },
    });
  }
})();
