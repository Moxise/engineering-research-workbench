(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CARD_SELECTOR = '.heatmap-card';
  const observed = new WeakMap();
  const scheduled = new WeakMap();

  function numberAttr(el, name, fallback = 0) {
    const value = Number(el?.dataset?.[name]);
    return Number.isFinite(value) ? value : fallback;
  }

  function schedule(card) {
    if (!card || scheduled.get(card)) return;
    scheduled.set(card, true);
    requestAnimationFrame(() => {
      scheduled.delete(card);
      alignMonthDividers(card);
    });
  }

  function ensureDividerLayer(stage) {
    let layer = stage.querySelector(':scope > .heatmap-month-divider-layer');
    if (layer) return layer;
    layer = document.createElementNS(SVG_NS, 'svg');
    layer.classList.add('heatmap-month-divider-layer');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('focusable', 'false');
    stage.appendChild(layer);
    return layer;
  }

  function alignMonthDividers(card) {
    const stage = card.querySelector('.heatmap-stage');
    const grid = card.querySelector('.heatmap-cells');
    const boundaries = [...card.querySelectorAll('.heatmap-month-boundary')];
    if (!stage || !grid || !boundaries.length) return;

    const cells = [...grid.querySelectorAll('.heat-cell[data-date]')];
    if (!cells.length) return;

    const computed = getComputedStyle(grid);
    const columnGap = Number.parseFloat(computed.columnGap) || 0;
    const rowGap = Number.parseFloat(computed.rowGap) || 0;
    const gridRect = grid.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const width = gridRect.width;
    const height = gridRect.height;
    if (!(width > 0 && height > 0)) return;

    const layer = ensureDividerLayer(stage);
    layer.style.left = `${gridRect.left - stageRect.left}px`;
    layer.style.top = `${gridRect.top - stageRect.top}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const paths = [];
    for (const boundary of boundaries) {
      const col = Math.max(0, Math.trunc(numberAttr(boundary, 'col0')));
      const row = Math.max(0, Math.min(6, Math.trunc(numberAttr(boundary, 'row'))));
      const target = cells[col * 7 + row];
      if (!target) continue;

      const rect = target.getBoundingClientRect();
      const cellLeft = rect.left - gridRect.left;
      const cellTop = rect.top - gridRect.top;
      const xLeft = Math.max(0, cellLeft - columnGap / 2);
      const xRight = Math.min(width, cellLeft + rect.width + columnGap / 2);
      const y = row === 0 ? 0 : Math.max(0, cellTop - rowGap / 2);

      const path = document.createElementNS(SVG_NS, 'path');
      path.classList.add('heatmap-month-divider-path');
      path.dataset.col = String(col);
      path.dataset.row = String(row);
      path.setAttribute(
        'd',
        row === 0
          ? `M ${xLeft} 0 V ${height}`
          : `M ${xRight} 0 V ${y} H ${xLeft} V ${height}`
      );
      paths.push(path);
    }
    layer.replaceChildren(...paths);
  }

  function attach(card) {
    if (!card || observed.has(card)) return;
    card.classList.add('heatmap-divider-v2');

    const stage = card.querySelector('.heatmap-stage');
    const grid = card.querySelector('.heatmap-cells');
    if (!stage || !grid) return;

    let resizeObserver = null;
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => schedule(card));
      resizeObserver.observe(stage);
      resizeObserver.observe(grid);
    }

    observed.set(card, { resizeObserver });
    schedule(card);
  }

  function scan() {
    document.querySelectorAll(CARD_SELECTOR).forEach(attach);
  }

  const root = document.getElementById('main') || document.body;
  const mutationObserver = new MutationObserver(() => scan());
  mutationObserver.observe(root, { childList: true, subtree: true });

  window.addEventListener('resize', () => {
    document.querySelectorAll(CARD_SELECTOR).forEach(schedule);
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
})();
