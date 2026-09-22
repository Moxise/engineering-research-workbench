(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CARD_SELECTOR = '.heatmap-card';
  const observed = new WeakMap();
  const scheduled = new WeakMap();

  function parseIsoLocal(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
    };
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
    layer.setAttribute('preserveAspectRatio', 'none');
    stage.appendChild(layer);
    return layer;
  }

  function visibleMonthStarts(cells) {
    const visible = cells
      .map((cell, index) => ({ cell, index, date: parseIsoLocal(cell.dataset.date) }))
      .filter(item => item.date && !item.cell.classList.contains('outside'));

    if (!visible.length) return [];

    const first = visible[0].date;
    const firstMonthKey = `${first.year}-${first.month}`;

    return visible.filter(item => {
      const d = item.date;
      if (d.day !== 1) return false;
      return `${d.year}-${d.month}` !== firstMonthKey;
    });
  }

  function alignMonthDividers(card) {
    const stage = card.querySelector('.heatmap-stage');
    const grid = card.querySelector('.heatmap-cells');
    if (!stage || !grid) return;

    const cells = [...grid.querySelectorAll('.heat-cell[data-date]')];
    if (!cells.length) return;

    const monthStarts = visibleMonthStarts(cells);
    const layer = ensureDividerLayer(stage);

    const gridRect = grid.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const width = gridRect.width;
    const height = gridRect.height;
    if (!(width > 0 && height > 0)) {
      layer.replaceChildren();
      return;
    }

    /*
     * Important: the SVG is anchored to the ACTUAL rendered heat-cell grid,
     * not to the old data-col0/data-row formula. This matters when 1-11 month
     * views use a different fitted cell size from the 12-month view.
     */
    const layerLeft = gridRect.left - stageRect.left;
    const layerTop = gridRect.top - stageRect.top;
    layer.style.left = `${layerLeft}px`;
    layer.style.top = `${layerTop}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const computed = getComputedStyle(grid);
    const columnGap = Number.parseFloat(computed.columnGap) || 0;
    const rowGap = Number.parseFloat(computed.rowGap) || 0;
    const tolerance = 0.75;

    const paths = monthStarts.map(({ cell, date }) => {
      const rect = cell.getBoundingClientRect();
      const cellLeft = rect.left - gridRect.left;
      const cellTop = rect.top - gridRect.top;

      /* Use the center of the real inter-cell gap so the divider never cuts a cell. */
      const xLeft = Math.max(0, cellLeft - columnGap / 2);
      const xRight = Math.min(width, cellLeft + rect.width + columnGap / 2);
      const y = Math.max(0, cellTop - rowGap / 2);

      const path = document.createElementNS(SVG_NS, 'path');
      path.classList.add('heatmap-month-divider-path');
      path.dataset.month = `${date.year}-${String(date.month).padStart(2, '0')}`;

      if (y <= tolerance) {
        path.setAttribute('d', `M ${xLeft} 0 V ${height}`);
      } else {
        path.setAttribute('d', `M ${xRight} 0 V ${y} H ${xLeft} V ${height}`);
      }
      return path;
    });

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

    /* fitResearchHeatmap() may change CSS variables just after insertion. */
    requestAnimationFrame(() => schedule(card));
    setTimeout(() => schedule(card), 80);
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

  document.addEventListener('change', event => {
    if (event.target?.id !== 'heatmap-month-select') return;
    requestAnimationFrame(scan);
    setTimeout(scan, 40);
    setTimeout(() => document.querySelectorAll(CARD_SELECTOR).forEach(schedule), 120);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
})();
