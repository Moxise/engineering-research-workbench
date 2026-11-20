(() => {
  'use strict';

  const ROUTE = 'project-flow';
  const TYPES = {project:'关联项目', step:'工作环节', method:'方法', principle:'原理', experiment:'实验', idea:'灵感'};
  const DOC_TYPES = {method:['note', 'method'], principle:['note', 'principle'], experiment:['experiment', ''], idea:['idea', '']};
  const RELATIONS = ['包含', '前置依赖', '依据', '采用', '验证', '对照', '汇总', '启发'];
  const drafts = new Map();
  const esc = window.ERWResearchUI.esc;
  const find = (host, selector) => host.querySelector(selector);
  const kindLabel = kind => kind === 'note' ? '知识' : window.ERWContract.kindLabel(kind);
  const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const knowledgeTitle = title => /^知识-([^-]+)-(.+)$/.exec(title || '');
  let projectId = new URLSearchParams(location.search).get('project') || sessionStorage.getItem('project-flow-owner') || '';

  async function api(url, data) {
    const options = data ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)} : {};
    const response = await window.erwFetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    return result;
  }

  window.addEventListener('beforeunload', event => {
    if (!drafts.size) return;
    event.preventDefault();
    event.returnValue = '';
  });

  function edgeGeometry(source, target, reverse, {node_width:WIDTH, node_height:HEIGHT}, cards) {
    const dx = target.x - source.x, dy = target.y - source.y;
    const offset = reverse ? 12 : 0;
    const vertical = Math.abs(dx) < WIDTH + 38 && Math.abs(dy) >= HEIGHT + 28;
    let start, end, elbows;
    if (vertical) {
      const down = dy > 0;
      start = [source.x + WIDTH / 2 + (down ? offset : -offset), source.y + (down ? HEIGHT : 0)];
      end = [target.x + WIDTH / 2 + (down ? offset : -offset), target.y + (down ? 0 : HEIGHT)];
      const bend = (start[1] + end[1]) / 2;
      elbows = [[start[0], bend], [end[0], bend]];
    } else {
      const right = dx >= 0;
      const separated = Math.abs(dx) >= WIDTH + 38;
      start = [source.x + (right || !separated ? WIDTH : 0), source.y + HEIGHT / 2 + (right ? -offset : offset)];
      end = [target.x + (right && separated ? 0 : WIDTH), target.y + HEIGHT / 2 + (right ? -offset : offset)];
      const bend = separated ? (start[0] + end[0]) / 2 : Math.max(start[0], end[0]) + 40 + offset;
      elbows = [[bend, start[1]], [bend, end[1]]];
    }
    let points = [start, ...elbows, end];
    function clearRoute(route) {
      return route.slice(1).every((point, index) => {
        const previous = route[index];
        if (point[0] === previous[0] && point[1] === previous[1]) return true;
        return cards.every(card => {
          const padding = card === source || card === target ? 0 : 10;
          return Math.max(previous[0], point[0]) <= card.x - padding || Math.min(previous[0], point[0]) >= card.x + WIDTH + padding
            || Math.max(previous[1], point[1]) <= card.y - padding || Math.min(previous[1], point[1]) >= card.y + HEIGHT + padding;
        });
      });
    }
    if (!clearRoute(points)) {
      let bestLength = Infinity;
      for (const axis of [0, 1]) {
        const size = axis === 0 ? WIDTH : HEIGHT;
        const crossSize = axis === 0 ? HEIGHT : WIDTH;
        const coord = axis === 0 ? 'x' : 'y';
        const cross = axis === 0 ? 'y' : 'x';
        const pointAt = (along, across) => axis === 0 ? [along, across] : [across, along];
        const lanes = new Set(cards.flatMap(card => [card[coord] - 14, card[coord] + size + 14]).filter(lane => lane >= 0));
        for (const [out, into] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) {
          const exit = source[coord] + (out > 0 ? size : 0);
          const entry = target[coord] + (into > 0 ? size : 0);
          const crossStart = source[cross] + crossSize / 2 + offset * out;
          const crossEnd = target[cross] + crossSize / 2 + offset * into;
          for (const lane of [...lanes, (exit + entry) / 2]) {
            if ((lane - exit) * out < 10 || (lane - entry) * into < 10) continue;
            const length = Math.abs(lane - exit) + Math.abs(lane - entry) + Math.abs(crossEnd - crossStart);
            if (length >= bestLength) continue;
            const route = [pointAt(exit, crossStart), pointAt(lane, crossStart), pointAt(lane, crossEnd), pointAt(entry, crossEnd)];
            if (clearRoute(route)) {
              points = route;
              bestLength = length;
            }
          }
        }
      }
    }
    [start, ...elbows] = points;
    end = elbows.pop();
    const path = [`M ${start.join(' ')}`];
    function towards(point, other) {
      const distance = Math.abs(other[0] - point[0]) + Math.abs(other[1] - point[1]);
      const ratio = Math.min(0.5, 10 / (distance || 1));
      return point.map((value, axis) => value + (other[axis] - value) * ratio).join(' ');
    }
    for (const [index, point] of elbows.entries()) {
      path.push(`L ${towards(point, points[index])} Q ${point.join(' ')} ${towards(point, points[index + 2])}`);
    }
    path.push(`L ${end.join(' ')}`);
    return {path:path.join(' '), points};
  }

  async function render(main) {
    main.innerHTML = '<div class="empty">正在加载工程画布…</div>';
    const loading = main.firstElementChild;
    const projects = (await api('/api/project-records')).filter(record => record.id);
    if (!loading.isConnected || location.hash !== '#' + ROUTE) return;
    if (!projects.length) {
      loading.innerHTML = '创建项目后即可绘制工程画布。 <a href="#projects">前往项目管理</a>';
      return;
    }
    const projectMap = new Map(projects.map(record => [record.id, record]));
    main.innerHTML = `<section class="pf card">
      <div class="pf-header">
        <label class="pf-owner">主项目<select class="search-input" data-pf-owner>
          ${projects.map(record => `<option value="${esc(record.id)}">${esc(record.name)}</option>`).join('')}
        </select></label>
        <div class="pf-actions">
          <span class="pf-status" data-pf-status role="status"></span>
          <button type="button" class="ghost-btn" data-pf-reload>重新载入</button>
          <button type="button" class="primary-btn" data-pf-save disabled>保存画布</button>
        </div>
      </div>
      <div data-pf-body></div>
    </section>`;
    const shell = main.firstElementChild;
    const owner = find(shell, '[data-pf-owner]');
    const body = find(shell, '[data-pf-body]');
    const save = find(shell, '[data-pf-save]');
    const reload = find(shell, '[data-pf-reload]');
    const status = find(shell, '[data-pf-status]');
    let sequence = 0;

    async function open(id, refresh = false) {
      const ticket = ++sequence;
      const project = projectMap.get(id);
      if (!Array.from(owner.options).some(option => option.value === id)) owner.add(new Option(project.name, id));
      projectId = owner.value = id;
      sessionStorage.setItem('project-flow-owner', id);
      const endpoint = `/api/projects/${encodeURIComponent(id)}/flow`;
      body.innerHTML = '<div class="empty">正在加载画布…</div>';
      save.disabled = reload.disabled = true;
      status.textContent = '';
      try {
        const flow = (!refresh && drafts.get(id)) || await api(endpoint);
        if (!shell.isConnected || ticket !== sequence) return;
        if (!flow.layout) throw new Error('未加载画布坐标规范，请重启工作台服务。');
        if (refresh) drafts.delete(id);
        const dirty = () => {
          drafts.set(id, flow);
          status.textContent = '有未保存修改';
          save.disabled = false;
        };
        status.textContent = drafts.has(id) ? '有未保存修改' : '已保存';
        save.disabled = !drafts.has(id);
        reload.disabled = false;
        editor(body, flow, project, projectMap, dirty, open);
        save.onclick = async () => {
          const snapshot = {revision:flow.revision, nodes:flow.nodes, edges:flow.edges, relation_scope:flow.relation_scope};
          const request = api(endpoint, snapshot);
          save.disabled = owner.disabled = reload.disabled = true;
          body.inert = true;
          status.textContent = '正在保存…';
          try {
            const result = await request;
            flow.revision = result.revision;
            drafts.delete(id);
            status.textContent = '已保存';
          } catch (error) {
            status.textContent = '保存失败，草稿仍在';
            window.ERWToast(error.message, true);
          } finally {
            save.disabled = !drafts.has(id);
            owner.disabled = reload.disabled = body.inert = false;
          }
        };
        reload.onclick = async () => {
          if (drafts.has(id) && !await window.ERWDialog.confirm('重新载入并放弃这张画布的本地草稿？')) return;
          await open(id, true);
        };
      } catch (error) {
        if (!shell.isConnected || ticket !== sequence) return;
        body.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
        reload.disabled = false;
        reload.onclick = () => open(id, refresh);
      }
    }

    owner.onchange = () => open(owner.value);
    await open(projectMap.has(projectId) ? projectId : projects[0].id);
  }

  function editor(host, flow, project, projectMap, dirty, open) {
    const {grid_size:GRID, node_width:WIDTH, node_height:HEIGHT, max_coordinate:LIMIT, max_nodes:MAX_NODES, max_edges:MAX_EDGES} = flow.layout;
    const snapCoordinate = value => Math.max(0, Math.min(LIMIT, Math.round(value / GRID) * GRID));
    host.innerHTML = `<div class="pf-toolbar">
      <div class="pf-tools">
        <button type="button" class="primary-btn" data-pf-library>项目条目</button>
        <label class="pf-sr" for="pf-kind">节点类型</label>
        <select id="pf-kind" class="search-input" data-pf-kind>${Object.entries(TYPES).map(([kind, label]) => `<option value="${kind}">${label}</option>`).join('')}</select>
        <button type="button" class="secondary-btn" data-pf-add>＋ 添加节点</button>
        <button type="button" class="secondary-btn" data-pf-connect aria-pressed="false">↗ 连线</button>
        <label class="pf-auto-toggle"><input type="checkbox" data-pf-auto checked> 自动关系</label>
        <select class="search-input" data-pf-relation-scope aria-label="自动关系范围">
          <option value="hierarchy">项目层级</option><option value="internal">项目内</option><option value="all">含跨项目</option>
        </select>
        <button type="button" class="ghost-btn" data-pf-inspire>生成灵感提纲</button>
      </div>
      <div class="pf-tools">
        <button type="button" class="ghost-btn" data-pf-align>对齐网格</button>
        <label class="pf-sr" for="pf-zoom">缩放</label>
        <select id="pf-zoom" class="search-input" data-pf-zoom>
          <option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option>
        </select>
        <button type="button" class="ghost-btn" data-pf-fit>适配画布</button>
      </div>
    </div><p class="pf-hint" data-pf-hint role="status"></p>
    <div class="pf-layout">
      <div class="pf-viewport" data-pf-viewport tabindex="0" aria-label="可滚动的工程画布">
        <div class="pf-plane"><div class="pf-board" style="--pf-grid:${GRID}px;--pf-node-width:${WIDTH}px;--pf-node-height:${HEIGHT}px">
          <svg class="pf-lines" aria-hidden="true"><defs>
            <marker id="pf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" fill="context-stroke"/></marker>
          </defs><g></g></svg>
          <div class="pf-node-layer"></div><div class="pf-label-layer"></div>
          <div class="pf-guides" aria-hidden="true"><i hidden></i><i hidden></i></div>
        </div></div>
      </div>
      <aside class="pf-inspector" aria-label="画布编辑" data-pf-inspector></aside>
    </div>`;
    const viewport = find(host, '[data-pf-viewport]');
    const inspector = find(host, '[data-pf-inspector]');
    const connect = find(host, '[data-pf-connect]');
    const hint = find(host, '[data-pf-hint]');
    const nodeLayer = find(host, '.pf-node-layer');
    const labelLayer = find(host, '.pf-label-layer');
    const lineLayer = find(host, '.pf-lines g');
    const [columnGuide, rowGuide] = host.querySelectorAll('.pf-guides i');
    const zoom = find(host, '[data-pf-zoom]');
    const nodes = new Map(flow.nodes.map(node => [node.id, node]));
    flow.documents ||= {};
    const documents = new Map(Object.entries(flow.documents || {}));
    const autoToggle = find(host, '[data-pf-auto]');
    const relationScope = find(host, '[data-pf-relation-scope]');
    relationScope.value = flow.relation_scope || 'all';
    const autoNodes = new Map();
    let derived = {projects:[], edges:[], document_edges:[]};
    let relationStamp = '', requestedRefs = '', relationRequest = 0;
    let autoEdges = [];
    let selection = '', selectedEdge = '', connecting = false, from = '', scale = 1;
    let dragging = false, redrawPending = false;

    function title(node) {
      if (node.id === 'root') return project.name;
      if (node.kind === 'project') return projectMap.get(node.ref)?.name || node.title;
      return documents.get(node.ref)?.title || node.title;
    }

    function nodeType(node) {
      if (node.id === 'root') return '主项目';
      if (node.kind === 'project') return derived.projects.find(item => item.id === node.ref)?.child ? '子项目' : '关联项目';
      const doc = documents.get(node.ref);
      const category = knowledgeTitle(doc?.title || node.title);
      if (category && (doc?.kind === 'note' || node.kind === 'entry')) return category[1];
      if (node.kind === 'entry') return doc ? kindLabel(doc.kind) : '条目';
      return TYPES[node.kind];
    }

    function displayTitle(node) {
      const name = title(node);
      return node.kind === 'project' ? name : knowledgeTitle(name)?.[2] || name;
    }

    function canvasNode(id) { return nodes.get(id) || autoNodes.get(id); }

    function relationRefs() {
      return [...new Set(flow.nodes.filter(node => node.ref && node.kind !== 'project').map(node => node.ref))].sort();
    }

    async function refreshRelations() {
      const ticket = ++relationRequest;
      const refs = relationRefs();
      requestedRefs = JSON.stringify(refs);
      const params = new URLSearchParams(refs.map(ref => ['doc', ref]));
      try {
        const result = await api(`/api/projects/${encodeURIComponent(project.id)}/flow/relations?${params}`);
        if (!viewport.isConnected || location.hash !== '#' + ROUTE || ticket !== relationRequest) return;
        const nextStamp = JSON.stringify(result);
        if (nextStamp === relationStamp) return;
        relationStamp = nextStamp;
        derived = result;
        for (const item of result.projects) projectMap.set(item.id, {...projectMap.get(item.id), ...item});
        draw();
      } catch (error) {
        if (viewport.isConnected && ticket === relationRequest) hint.textContent = `自动关系暂时无法更新：${error.message}`;
      }
    }

    function resolveAutomaticLayer() {
      const previous = new Map(autoNodes);
      autoNodes.clear();
      autoEdges = [];
      if (!autoToggle.checked) return;
      const scope = relationScope.value;
      const inside = new Set([project.id, ...derived.projects.filter(item => item.child).map(item => item.id)]);
      const projectNodes = new Map([[project.id, 'root']]);
      const documentNodes = new Map();
      for (const node of flow.nodes) {
        if (!node.ref) continue;
        const mapping = node.kind === 'project' ? projectNodes : documentNodes;
        mapping.set(node.ref, node.id);
      }
      for (const item of derived.projects) {
        if (scope !== 'all' && !item.child) continue;
        if (projectNodes.has(item.id)) continue;
        const id = `auto-project:${item.id}`;
        const occupied = [...flow.nodes, ...autoNodes.values()];
        const existing = previous.get(id);
        const position = existing && !collides(existing, occupied) ? existing : freePosition(occupied);
        autoNodes.set(id, {id, kind:'project', ref:item.id, title:item.name, x:position.x, y:position.y, automatic:true});
        projectNodes.set(item.id, id);
      }
      const pairs = new Map();
      const manualPairs = new Set(flow.edges.map(edge => JSON.stringify([edge.source, edge.target])));
      for (const [items, mapping] of [[derived.edges, projectNodes], [derived.document_edges, documentNodes]]) {
        for (const item of items) {
          if (scope === 'hierarchy' && item.type !== 'hierarchy') continue;
          if (scope === 'internal' && item.type !== 'document' && (!inside.has(item.source) || !inside.has(item.target))) continue;
          const source = mapping.get(item.source), target = mapping.get(item.target);
          if (!source || !target || source === target) continue;
          const pair = JSON.stringify([source, target]);
          if (manualPairs.has(pair) || (item.type === 'shared' && manualPairs.has(JSON.stringify([target, source])))) continue;
          let edge = pairs.get(pair);
          if (!edge) {
            edge = {id:`auto:${pair}`, source, target, label:item.label, style:item.type === 'hierarchy' ? 'solid' : 'dashed', automatic:true, items:[]};
            pairs.set(pair, edge);
          }
          edge.items.push(item);
          if (edge.items.length > 1 && edge.items[0].type !== 'hierarchy') edge.label = '多种关系';
        }
      }
      autoEdges = [...pairs.values()];
    }

    function bounds() {
      const cards = [...flow.nodes, ...autoNodes.values()];
      return {width:Math.max(...cards.map(node => node.x)) + WIDTH + 86,
              height:Math.max(...cards.map(node => node.y)) + HEIGHT + 64};
    }

    function sizeBoard() {
      const extent = bounds();
      const width = Math.max(extent.width, viewport.clientWidth / scale);
      const height = Math.max(extent.height, viewport.clientHeight / scale);
      const plane = find(viewport, '.pf-plane');
      const board = find(plane, '.pf-board');
      Object.assign(plane.style, {width:`${width * scale}px`, height:`${height * scale}px`});
      Object.assign(board.style, {width:`${width}px`, height:`${height}px`, transform:`scale(${scale})`});
    }

    function drawEdges() {
      const edges = [...flow.edges, ...autoEdges];
      const pairs = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target])));
      const cards = [...flow.nodes, ...autoNodes.values()];
      const drawing = edges.map(edge => ({edge, ...edgeGeometry(canvasNode(edge.source), canvasNode(edge.target), pairs.has(JSON.stringify([edge.target, edge.source])), flow.layout, cards)}));
      lineLayer.innerHTML = drawing.map(({edge, path}) => `<path class="pf-edge${edge.style === 'dashed' ? ' is-dashed' : ''}${edge.id === selectedEdge ? ' is-selected' : ''}" d="${path}" ${edge.items?.every(item => item.type === 'shared') ? '' : 'marker-end="url(#pf-arrow)"'}/>`).join('');
      labelLayer.innerHTML = drawing.map(({edge}) => `<button type="button" class="pf-edge-label${edge.automatic ? ' is-automatic' : ''}" data-pf-edge="${esc(edge.id)}" aria-pressed="${edge.id === selectedEdge}" aria-label="${esc(`${title(canvasNode(edge.source))}、${title(canvasNode(edge.target))}：${edge.label || '关系'}`)}" title="${esc(edge.label || '关系')}">${esc(edge.label || '关系')}</button>`).join('');
      const occupied = cards.map(card => ({left:card.x - 3, top:card.y - 3, right:card.x + WIDTH + 3, bottom:card.y + HEIGHT + 3}));
      const limits = {width:labelLayer.clientWidth, height:labelLayer.clientHeight};
      const labels = Array.from(labelLayer.children, label => ({label, halfWidth:label.offsetWidth / 2, halfHeight:label.offsetHeight / 2}));
      const hitPaths = [];
      for (const [index, {edge, points, path}] of drawing.entries()) {
        const {label, halfWidth, halfHeight} = labels[index];
        const segments = [[points[1], points[2]], [points[0], points[1]], [points[2], points[3]]];
        const candidates = segments.flatMap(([first, last]) => [0.5, 0.3, 0.7].map(ratio => [
          first[0] + (last[0] - first[0]) * ratio, first[1] + (last[1] - first[1]) * ratio,
        ]));
        const offsets = [[0, 0], [0, -halfHeight - 3], [0, halfHeight + 3], [-halfWidth - 3, 0], [halfWidth + 3, 0]];
        let placement;
        for (const [dx, dy] of offsets) {
          for (const [anchorX, anchorY] of candidates) {
            const x = anchorX + dx, y = anchorY + dy;
            const top = y - halfHeight, bottom = y + halfHeight;
            if (top < 0 || bottom > limits.height) continue;
            let room = Math.min(halfWidth, x, limits.width - x);
            for (const rect of occupied) {
              if (bottom <= rect.top || top >= rect.bottom) continue;
              room = Math.min(room, Math.max(rect.left - x, x - rect.right));
              if (room < 24) break;
            }
            if (room >= Math.min(halfWidth, 24) && (!placement || room > placement.room)) placement = {x, y, top, bottom, room};
            if (placement?.room === halfWidth) break;
          }
          if (placement?.room === halfWidth) break;
        }
        if (placement) {
          const {x, y, top, bottom, room} = placement;
          Object.assign(label.style, {left:`${x}px`, top:`${y}px`, width:`${room * 2}px`});
          occupied.push({left:x - room - 3, top:top - 3, right:x + room + 3, bottom:bottom + 3});
        } else {
          label.classList.add('pf-sr');
          hitPaths.push(`<path class="pf-edge-hit" data-pf-edge="${esc(edge.id)}" d="${path}"><title>${esc(edge.label || '关系')}</title></path>`);
        }
      }
      lineLayer.insertAdjacentHTML('beforeend', hitPaths.join(''));
    }

    function draw() {
      if (dragging) {
        redrawPending = true;
        return;
      }
      redrawPending = false;
      resolveAutomaticLayer();
      sizeBoard();
      viewport.classList.toggle('is-connecting', connecting);
      connect.setAttribute('aria-pressed', String(connecting));
      hint.textContent = connecting ? (from ? '选择终点。点击「连线」可取消。' : '选择连线起点。') : '拖动节点靠近同一行或列时显示对齐参考线。';
      nodeLayer.innerHTML = [...flow.nodes, ...autoNodes.values()].map(node => {
        const category = nodeType(node);
        return `<button type="button" class="pf-node${node.automatic ? ' is-automatic' : ''}" data-pf-node="${esc(node.id)}" data-type="${esc(node.kind)}" data-category="${esc(category)}" aria-pressed="${node.id === selection || node.id === from}" style="left:${node.x}px;top:${node.y}px" title="${esc(title(node))}">
          <span class="pf-node-type">${esc(category)}${node.automatic ? ' · 自动' : node.ref && node.kind !== 'project' ? ' · 有原条目' : ''}</span><strong>${esc(displayTitle(node))}</strong></button>`;
      }).join('');
      drawEdges();
      if (JSON.stringify(relationRefs()) !== requestedRefs) void refreshRelations();
    }

    function changeScale(value) {
      scale = value;
      const fitOption = find(zoom, 'option[data-fit]');
      if (fitOption) fitOption.remove();
      zoom.value = String(value);
      if (!zoom.value) {
        const option = new Option(`${Math.round(value * 100)}%`, String(value), false, true);
        option.dataset.fit = '';
        zoom.add(option, 0);
      }
      sizeBoard();
    }

    zoom.onchange = () => changeScale(Number(zoom.value));
    find(host, '[data-pf-align]').onclick = () => {
      const offGrid = flow.nodes.filter(node => node.x % GRID || node.y % GRID);
      const next = flow.nodes.map(node => ({...node, x:snapCoordinate(node.x), y:snapCoordinate(node.y)}));
      if (offGrid.some(node => overlaps(next.find(item => item.id === node.id), next))) {
        window.ERWToast('对齐后有卡片重叠，请先移开相邻卡片', true);
        return;
      }
      if (offGrid.length) {
        for (const node of next) Object.assign(nodes.get(node.id), {x:node.x, y:node.y});
        dirty();
        draw();
      }
      window.ERWToast(offGrid.length ? `已将 ${offGrid.length} 个节点对齐网格` : '所有节点已对齐网格');
    };
    find(host, '[data-pf-fit]').onclick = () => {
      const extent = bounds();
      changeScale(Math.max(0.1, Math.min(1, viewport.clientWidth / extent.width, viewport.clientHeight / extent.height)));
      viewport.scrollTo(0, 0);
    };

    function clearConnection() {
      connecting = false;
      from = '';
    }

    function showNode(node, focus = false) {
      selection = node.id;
      selectedEdge = '';
      clearConnection();
      draw();
      const linkedProject = projectMap.get(node.ref);
      const linkedDoc = documents.get(node.ref);
      if (node.automatic) {
        inspector.innerHTML = `<h3>${esc(nodeType(node))}</h3><p class="pf-node-name">${esc(title(node))}</p>
          <div class="pf-tools"><button type="button" class="secondary-btn" data-pf-source>打开项目画布</button>
          <button type="button" class="ghost-btn" data-pf-pin>固定节点</button></div>`;
        find(inspector, '[data-pf-source]').onclick = () => open(node.ref);
        find(inspector, '[data-pf-pin]').onclick = () => {
          if (flow.nodes.length >= MAX_NODES) {
            window.ERWToast(`画布已达到 ${MAX_NODES} 个节点`, true);
            return;
          }
          const fixed = {id:newId(), kind:'project', ref:node.ref, title:title(node).slice(0, 180), description:'', x:node.x, y:node.y};
          flow.nodes.push(fixed);
          nodes.set(fixed.id, fixed);
          dirty();
          showNode(fixed);
        };
        return;
      }
      inspector.innerHTML = `<h3>${esc(nodeType(node))}</h3>
        ${node.ref || node.id === 'root' ? `<p class="pf-node-name">${esc(title(node))}</p>` : `<label>标题<input class="search-input" maxlength="180" value="${esc(node.title)}" data-pf-title></label>`}
        <label>说明<textarea class="search-input" maxlength="2000" rows="5" data-pf-description placeholder="写下步骤、原理、结果或待验证的猜想">${esc(node.description || '')}</textarea></label>
        <div class="pf-tools">
          ${node.kind === 'project' && linkedProject ? '<button type="button" class="secondary-btn" data-pf-source>打开项目画布</button>' : linkedDoc ? '<button type="button" class="secondary-btn" data-pf-source>打开原条目</button>' : ''}
          ${node.id !== 'root' ? '<button type="button" class="ghost-btn danger-text" data-pf-remove>移除节点</button>' : ''}
        </div>
        ${node.ref && !linkedProject && !linkedDoc ? '<p class="pf-muted">原项目或条目当前不可用，保留上次引用的标题。</p>' : ''}`;
      const input = find(inspector, '[data-pf-title]');
      if (input) {
        input.oninput = () => {
          node.title = input.value.trim() || `未命名${TYPES[node.kind]}`;
          draw();
          dirty();
        };
        if (focus) { input.focus(); input.select(); }
      }
      find(inspector, '[data-pf-description]').oninput = event => { node.description = event.target.value; dirty(); };
      const source = find(inspector, '[data-pf-source]');
      if (source) source.onclick = () => {
        if (node.kind === 'project') open(node.ref);
        else window.ERWNav.open(linkedDoc.kind, node.ref).catch(error => window.ERWToast(error.message, true));
      };
      const remove = find(inspector, '[data-pf-remove]');
      if (remove) remove.onclick = async () => {
        const linked = flow.edges.some(edge => edge.source === node.id || edge.target === node.id);
        if (linked && !await window.ERWDialog.confirm('移除该节点及相连的箭头？原条目仍可在工作台打开。')) return;
        flow.nodes = flow.nodes.filter(item => item.id !== node.id);
        flow.edges = flow.edges.filter(edge => edge.source !== node.id && edge.target !== node.id);
        nodes.delete(node.id);
        selection = '';
        idle();
        draw();
        dirty();
      };
    }

    function showEdge(edge, focus = false) {
      selection = '';
      selectedEdge = edge.id;
      clearConnection();
      draw();
      if (edge.automatic) {
        const evidence = [];
        function entryButton(item) {
          const index = evidence.push(item) - 1;
          return `<button type="button" class="ghost-btn" data-pf-evidence="${index}">${esc(item.title)}</button>`;
        }
        const details = edge.items.map(item => {
          if (item.type === 'hierarchy') return '<p>依据项目登记中的「上级项目」生成。</p>';
          if (item.type === 'document') return `<p>依据原条目的显式链接生成。<br>${esc(item.labels.join(' · '))}</p>`;
          const items = item.evidence.map(record => {
            const target = record.target_id ? `<small>${esc(record.label)} →</small>${entryButton({id:record.target_id, title:record.target_title, kind:record.target_kind})}` : '';
            return `<li>${entryButton(record)}${target}</li>`;
          });
          return `<h4>${esc(item.label)}</h4><ul class="pf-evidence">${items.join('')}</ul>${item.count > items.length ? `<p class="pf-muted">显示前 ${items.length} 条依据</p>` : ''}`;
        });
        inspector.innerHTML = `<h3>自动关系</h3><p class="pf-node-name">${esc(displayTitle(canvasNode(edge.source)))}${edge.items.every(item => item.type === 'shared') ? ' · ' : ' → '}${esc(displayTitle(canvasNode(edge.target)))}</p>${details.join('')}`;
        inspector.querySelectorAll('[data-pf-evidence]').forEach(button => {
          button.onclick = () => {
            const doc = evidence[Number(button.dataset.pfEvidence)];
            window.ERWNav.open(doc.kind, doc.id).catch(error => window.ERWToast(error.message, true));
          };
        });
        return;
      }
      inspector.innerHTML = `<h3>关系</h3><p class="pf-node-name">${esc(title(nodes.get(edge.source)))} → ${esc(title(nodes.get(edge.target)))}</p>
        <label>箭头标签<input class="search-input" maxlength="32" data-pf-label list="pf-relations" value="${esc(edge.label)}"></label>
        <datalist id="pf-relations">${RELATIONS.map(label => `<option value="${label}"></option>`).join('')}</datalist>
        <label>线型<select class="search-input" data-pf-style><option value="solid">实线</option><option value="dashed">虚线</option></select></label>
        <div class="pf-tools"><button type="button" class="ghost-btn" data-pf-reverse>反转方向</button><button type="button" class="ghost-btn danger-text" data-pf-remove>删除连线</button></div>`;
      const label = find(inspector, '[data-pf-label]');
      label.oninput = () => { edge.label = label.value; drawEdges(); dirty(); };
      if (focus) { label.focus(); label.select(); }
      const style = find(inspector, '[data-pf-style]');
      style.value = edge.style;
      style.onchange = () => { edge.style = style.value; drawEdges(); dirty(); };
      find(inspector, '[data-pf-reverse]').onclick = () => {
        if (flow.edges.some(item => item.source === edge.target && item.target === edge.source)) {
          window.ERWToast('反方向已有连线', true);
          return;
        }
        [edge.source, edge.target] = [edge.target, edge.source];
        showEdge(edge);
        dirty();
      };
      find(inspector, '[data-pf-remove]').onclick = () => {
        flow.edges = flow.edges.filter(item => item.id !== edge.id);
        selectedEdge = '';
        idle();
        draw();
        dirty();
      };
    }

    function pickNode(id) {
      if (!connecting) return showNode(canvasNode(id));
      if (autoNodes.has(id)) {
        window.ERWToast('固定自动节点后即可手动连线');
        return;
      }
      if (!from) { from = id; draw(); return; }
      if (from === id) return;
      const existing = flow.edges.find(edge => edge.source === from && edge.target === id);
      if (existing) return showEdge(existing);
      if (flow.edges.length >= MAX_EDGES) { window.ERWToast(`画布已达到 ${MAX_EDGES} 条连线`, true); return; }
      const edge = {id:newId(), source:from, target:id, label:'', style:'solid'};
      flow.edges.push(edge);
      dirty();
      showEdge(edge, true);
    }

    function referencedNode(ref, kind) {
      return ref && flow.nodes.find(node => node.ref === ref && (node.kind === 'project') === (kind === 'project'));
    }

    function rememberDocument(item) {
      const meta = {title:item.title, kind:item.kind};
      flow.documents[item.id] = meta;
      documents.set(item.id, meta);
    }

    function collides(position, occupied) {
      return occupied.some(other => Math.abs(position.x - other.x) < WIDTH + GRID && Math.abs(position.y - other.y) < HEIGHT + GRID);
    }

    function overlaps(position, occupied) {
      return occupied.some(other => position.id !== other.id && Math.abs(position.x - other.x) < WIDTH && Math.abs(position.y - other.y) < HEIGHT);
    }

    function freePosition(occupied) {
      const left = 19 * GRID, top = 6 * GRID, columnGap = 17 * GRID, rowGap = 7 * GRID, rows = 3;
      const columns = Math.floor((LIMIT - left) / columnGap) + 1;
      const position = {x:left, y:top};
      let slot = 0;
      while (collides(position, occupied)) {
        slot += 1;
        const column = Math.floor(slot / rows);
        position.x = left + (column % columns) * columnGap;
        position.y = top + (slot % rows + Math.floor(column / columns) * rows) * rowGap;
      }
      return position;
    }

    function addNode(kind, ref = '', name = '') {
      const node = {id:newId(), kind, ref, title:(name || `未命名${TYPES[kind]}`).slice(0, 180), description:'',
        ...freePosition([...flow.nodes, ...autoNodes.values()])};
      flow.nodes.push(node);
      nodes.set(node.id, node);
      return node;
    }

    function insert(kind, ref = '', name = '') {
      const existing = referencedNode(ref, kind);
      if (existing) { showNode(existing); reveal(existing); return; }
      if (flow.nodes.length >= MAX_NODES) {
        window.ERWToast(`画布已达到 ${MAX_NODES} 个节点`, true);
        return;
      }
      const node = addNode(kind, ref, name);
      dirty();
      showNode(node, !ref);
      reveal(node);
    }

    function reveal(node) {
      const left = node.x * scale, top = node.y * scale;
      if (left < viewport.scrollLeft || left + WIDTH * scale > viewport.scrollLeft + viewport.clientWidth
          || top < viewport.scrollTop || top + HEIGHT * scale > viewport.scrollTop + viewport.clientHeight) {
        viewport.scrollTo(Math.max(0, left - 32), Math.max(0, top - 32));
      }
    }

    function choose(kind) {
      selection = selectedEdge = '';
      clearConnection();
      draw();
      const label = TYPES[kind];
      if (kind === 'step') return insert(kind);
      inspector.innerHTML = `<h3>添加${label}</h3><div class="pf-picker">
        ${kind === 'project' ? '' : `<button type="button" class="primary-btn" data-pf-new>新建${label}卡片</button><p class="pf-muted">或从工作区引用已有条目</p>`}
        ${kind === 'experiment' ? '<label>范围<select class="search-input" data-pf-scope><option value="project">当前项目</option><option value="all">全部项目</option></select></label>' : ''}
        <form class="pf-search"><label class="pf-sr" for="pf-query">搜索${label}</label><input id="pf-query" class="search-input" name="query" maxlength="100" placeholder="搜索${label}"><button type="submit" class="secondary-btn">搜索</button></form>
        <div data-pf-results aria-live="polite"></div>
      </div>`;
      const form = find(inspector, 'form');
      const results = find(inspector, '[data-pf-results]');
      const scope = find(inspector, '[data-pf-scope]');
      const newButton = find(inspector, '[data-pf-new]');
      if (newButton) newButton.onclick = () => insert(kind);
      let searchSequence = 0;
      async function search(page = 1) {
        const ticket = ++searchSequence;
        const query = form.elements.query.value.trim();
        results.textContent = '正在查找…';
        try {
          let items, pages = 1;
          if (kind === 'project') {
            items = [...projectMap.values()].filter(record => record.id !== project.id && record.name.toLowerCase().includes(query.toLowerCase()));
          } else {
            const [docKind, mark] = DOC_TYPES[kind];
            const params = new URLSearchParams({scope:'reference', kind:docKind, mark, q:query, paged:'1', page_size:'12', page:String(page)});
            if (scope?.value === 'project') params.set('project', project.id);
            const response = await api(`/api/docs?${params}`);
            items = response.items;
            pages = response.pages;
          }
          if (!results.isConnected || ticket !== searchSequence) return;
          results.innerHTML = `<div class="pf-results">${items.map(item => `<button type="button" class="ghost-btn" data-pf-ref="${esc(item.id)}">${esc(item.title || item.name)}</button>`).join('') || '<p class="pf-muted">没有匹配条目</p>'}</div>
            ${pages > 1 ? `<div class="pf-pagination"><button type="button" class="ghost-btn" data-pf-prev ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}</span><button type="button" class="ghost-btn" data-pf-next ${page >= pages ? 'disabled' : ''}>下一页</button></div>` : ''}`;
          results.querySelectorAll('[data-pf-ref]').forEach(button => {
            button.onclick = () => {
              const item = items.find(candidate => candidate.id === button.dataset.pfRef);
              if (kind !== 'project') rememberDocument(item);
              insert(kind, item.id, item.title || item.name);
            };
          });
          const prev = find(results, '[data-pf-prev]'), next = find(results, '[data-pf-next]');
          if (prev) prev.onclick = () => search(page - 1);
          if (next) next.onclick = () => search(page + 1);
        } catch (error) {
          if (results.isConnected && ticket === searchSequence) results.textContent = error.message;
        }
      }
      form.onsubmit = event => { event.preventDefault(); search(); };
      if (scope) scope.onchange = () => search();
      search();
    }

    function documentNodeKind(item) {
      if (item.kind === 'experiment' || item.kind === 'idea') return item.kind;
      if (item.kind === 'note') {
        if (item.title.startsWith('知识-方法-')) return 'method';
        if (item.title.startsWith('知识-原理-')) return 'principle';
      }
      return 'entry';
    }

    function showLibrary() {
      selection = selectedEdge = '';
      clearConnection();
      draw();
      const filters = [
        ...window.ERWContract.kinds().map(kind => ({value:kind, label:kindLabel(kind), kind})),
        {value:'method', label:'方法', kind:'note', mark:'method'},
        {value:'principle', label:'原理', kind:'note', mark:'principle'},
      ];
      inspector.innerHTML = `<h3>项目条目</h3>
        <form class="pf-search">
          <label class="pf-sr" for="pf-library-query">搜索项目条目</label>
          <input class="search-input" id="pf-library-query" name="query" maxlength="100" placeholder="搜索项目条目">
          <button type="submit" class="secondary-btn">搜索</button>
        </form>
        <div class="pf-library-controls">
          <select class="search-input" aria-label="条目类型" data-pf-library-kind>
            <option value="">全部类型</option>
            ${filters.map(filter => `<option value="${esc(filter.value)}">${esc(filter.label)}</option>`).join('')}
          </select>
          <button type="button" class="secondary-btn" data-pf-library-add disabled>添加选中条目</button>
        </div>
        <div data-pf-library-results></div>`;
      const form = find(inspector, 'form');
      const types = find(inspector, '[data-pf-library-kind]');
      const results = find(inspector, '[data-pf-library-results]');
      const add = find(inspector, '[data-pf-library-add]');
      const checked = new Map();
      let sequence = 0;
      let visible = [];
      let page = 1, pages = 1;

      function updateCount() {
        add.disabled = checked.size === 0;
        add.textContent = checked.size ? `添加选中（${checked.size}）` : '添加选中条目';
      }

      function addItems(items) {
        const pending = items.filter(item => !referencedNode(item.id, documentNodeKind(item)));
        if (!pending.length) return;
        if (flow.nodes.length + pending.length > MAX_NODES) {
          window.ERWToast(`画布还可添加 ${MAX_NODES - flow.nodes.length} 个节点`, true);
          return;
        }
        const added = pending.map(item => {
          checked.delete(item.id);
          rememberDocument(item);
          return addNode(documentNodeKind(item), item.id, item.title);
        });
        draw();
        reveal(added[0]);
        dirty();
        paint();
        window.ERWToast(`已添加 ${added.length} 个条目`);
      }

      function paint() {
        results.innerHTML = `<div class="pf-library-list">
          ${visible.map(item => {
            const kind = documentNodeKind(item);
            const added = referencedNode(item.id, kind);
            const label = added ? '定位' : '添加';
            return `<div class="pf-library-row">
              <label class="pf-library-entry">
                <input type="checkbox" data-pf-library-check="${esc(item.id)}" ${checked.has(item.id) ? 'checked' : ''} ${added ? 'disabled' : ''}>
                <span><strong>${esc(knowledgeTitle(item.title)?.[2] || item.title)}</strong><small>${esc(knowledgeTitle(item.title)?.[1] || TYPES[kind] || kindLabel(item.kind))}${added ? ' · 已在画布' : ''}</small></span>
              </label>
              <button type="button" class="ghost-btn" data-pf-library-item="${esc(item.id)}" aria-label="${label} ${esc(item.title)}">${label}</button>
            </div>`;
          }).join('') || '<p class="pf-muted">当前项目没有匹配条目</p>'}
        </div>
        ${pages > 1 ? `<div class="pf-pagination"><button type="button" class="ghost-btn" data-pf-library-prev ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}</span><button type="button" class="ghost-btn" data-pf-library-next ${page >= pages ? 'disabled' : ''}>下一页</button></div>` : ''}`;
        updateCount();
      }

      async function search(nextPage = 1) {
        const request = ++sequence;
        results.innerHTML = '<p class="pf-muted" role="status">正在加载项目条目…</p>';
        const filter = filters.find(item => item.value === types.value);
        const params = new URLSearchParams({scope:'reference', project:project.id, paged:'1', page_size:'12', page:String(nextPage), q:form.elements.query.value.trim()});
        if (filter) params.set('kind', filter.kind);
        if (filter?.mark) params.set('mark', filter.mark);
        try {
          const response = await api(`/api/docs?${params}`);
          if (!results.isConnected || request !== sequence) return;
          visible = response.items;
          page = nextPage;
          pages = response.pages;
          paint();
        } catch (error) {
          if (results.isConnected && request === sequence) results.textContent = error.message;
        }
      }

      results.onchange = event => {
        const input = event.target.closest('[data-pf-library-check]');
        if (!input) return;
        const item = visible.find(item => item.id === input.dataset.pfLibraryCheck);
        if (input.checked) checked.set(item.id, item);
        else checked.delete(item.id);
        updateCount();
      };
      results.onclick = event => {
        if (event.target.closest('[data-pf-library-prev]')) return search(page - 1);
        if (event.target.closest('[data-pf-library-next]')) return search(page + 1);
        const button = event.target.closest('[data-pf-library-item]');
        if (!button) return;
        const item = visible.find(item => item.id === button.dataset.pfLibraryItem);
        const node = referencedNode(item.id, documentNodeKind(item));
        if (node) {
          selection = node.id;
          draw();
          reveal(node);
        } else addItems([item]);
      };
      add.onclick = () => addItems([...checked.values()]);
      types.onchange = () => search();
      form.onsubmit = event => { event.preventDefault(); search(); };
      search();
    }

    function inspire() {
      const focus = nodes.get(selection);
      const working = focus && focus.id !== 'root' ? [focus] : flow.nodes.filter(node => node.id !== 'root');
      const incoming = new Set(flow.edges.map(edge => edge.target));
      const outgoing = new Set(flow.edges.map(edge => edge.source));
      const questions = working.flatMap(node => {
        const name = `「${title(node)}」`;
        if (node.kind === 'method') return [`${name}依赖哪些假设？哪个对照能检验其中一个假设？`];
        if (node.kind === 'principle') return [`怎样把${name}转成一个可观察、可测量的预测？`];
        if (node.kind === 'experiment') return [`${name}需要怎样的基线、指标和失败判据？`];
        if (node.kind === 'idea') return [`验证${name}的最小实验是什么？什么结果会推翻它？`];
        if (!incoming.has(node.id) || !outgoing.has(node.id)) return [`${name}需要什么输入，产出可被哪个环节复用？`];
        return [];
      });
      const prompt = [`# ${project.name} · 灵感提纲`, ...((questions.length ? questions : ['哪个关键假设最值得验证？为它设计一组最小对照。']).slice(0, 12).map(question => `- ${question}`))].join('\n');
      selection = selectedEdge = '';
      clearConnection();
      draw();
      inspector.innerHTML = `<h3>灵感提纲</h3><label>可编辑的研讨问题<textarea class="search-input" rows="10" maxlength="2000" data-pf-prompt></textarea></label>
        <div class="pf-tools"><button type="button" class="secondary-btn" data-pf-copy>复制提纲</button><button type="button" class="ghost-btn" data-pf-idea>存为灵感卡片</button></div>`;
      const text = find(inspector, '[data-pf-prompt]');
      text.value = prompt.slice(0, 2000);
      find(inspector, '[data-pf-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(text.value); window.ERWToast('灵感提纲已复制'); }
        catch { text.select(); window.ERWToast('已选中提纲，可手动复制'); }
      };
      find(inspector, '[data-pf-idea]').onclick = () => {
        const count = flow.nodes.length;
        insert('idea', '', focus && focus.id !== 'root' ? `${title(focus)} · 待验证问题`.slice(0, 180) : '项目灵感提纲');
        if (flow.nodes.length === count) return;
        flow.nodes.at(-1).description = text.value;
        showNode(flow.nodes.at(-1), true);
      };
    }

    function idle() {
      inspector.innerHTML = '<h3>画布编辑</h3><p class="pf-muted">选择节点或连线编辑。添加已有子项目，也可以用工作环节卡片梳理还未建档的任务。</p>';
    }

    find(host, '[data-pf-kind]').value = 'step';
    autoToggle.onchange = () => {
      if (autoNodes.has(selection) || autoEdges.some(edge => edge.id === selectedEdge)) {
        selection = selectedEdge = '';
        idle();
      }
      draw();
      if (autoToggle.checked) void refreshRelations();
    };
    relationScope.onchange = () => {
      flow.relation_scope = relationScope.value;
      autoToggle.onchange();
      dirty();
    };
    find(host, '[data-pf-library]').onclick = showLibrary;
    find(host, '[data-pf-add]').onclick = () => choose(find(host, '[data-pf-kind]').value);
    find(host, '[data-pf-inspire]').onclick = inspire;
    connect.onclick = () => {
      connecting = !connecting;
      from = connecting && nodes.has(selection) ? selection : '';
      selection = selectedEdge = '';
      idle();
      draw();
    };
    labelLayer.onclick = lineLayer.onclick = event => {
      const button = event.target.closest('[data-pf-edge]');
      if (button) showEdge([...flow.edges, ...autoEdges].find(edge => edge.id === button.dataset.pfEdge));
    };
    nodeLayer.onclick = event => {
      const button = event.target.closest('[data-pf-node]');
      if (button) pickNode(button.dataset.pfNode);
    };
    nodeLayer.onpointerdown = event => {
      const button = event.target.closest('[data-pf-node]');
      if (!button || connecting || dragging || event.button !== 0 || !event.isPrimary) return;
      const node = nodes.get(button.dataset.pfNode);
      if (!node) return;
      const origin = nodeLayer.getBoundingClientRect();
      const dragScale = origin.width / nodeLayer.clientWidth;
      const start = {clientX:event.clientX, clientY:event.clientY, x:node.x, y:node.y};
      const cards = [...flow.nodes, ...autoNodes.values()].filter(other => other !== node);
      const tolerance = Math.min(GRID * 0.75, 10 / dragScale);
      let blocked = false;
      function snapToCard(axis, value, guide) {
        let distance = tolerance;
        let aligned;
        for (const card of cards) {
          const coordinate = card[axis];
          const offset = Math.abs(value - coordinate);
          if (coordinate % GRID === 0 && offset < distance) {
            aligned = coordinate;
            distance = offset;
          }
        }
        guide.hidden = aligned === undefined;
        if (!guide.hidden) guide.style[axis === 'x' ? 'left' : 'top'] = `${aligned}px`;
        return aligned ?? snapCoordinate(value);
      }
      button.setPointerCapture(event.pointerId);
      dragging = true;
      button.onpointermove = move => {
        if (move.pointerId !== event.pointerId) return;
        const rect = nodeLayer.getBoundingClientRect();
        const dx = (move.clientX - start.clientX + origin.left - rect.left) / dragScale;
        const dy = (move.clientY - start.clientY + origin.top - rect.top) / dragScale;
        const nearStart = Math.max(Math.abs(dx), Math.abs(dy)) < GRID / 2 || Math.hypot(dx, dy) * dragScale < 4;
        if (nearStart) columnGuide.hidden = rowGuide.hidden = true;
        const left = nearStart ? start.x : snapToCard('x', start.x + dx, columnGuide);
        const top = nearStart ? start.y : snapToCard('y', start.y + dy, rowGuide);
        blocked = !nearStart && overlaps({id:node.id, x:left, y:top}, cards);
        button.classList.toggle('is-overlapping', blocked);
        if (node.x === left && node.y === top) return;
        Object.assign(node, {x:left, y:top});
        Object.assign(button.style, {left:`${node.x}px`, top:`${node.y}px`});
        sizeBoard();
        drawEdges();
      };
      const finish = cancelled => {
        button.onpointermove = button.onpointercancel = button.onlostpointercapture = null;
        dragging = false;
        columnGuide.hidden = rowGuide.hidden = true;
        button.classList.remove('is-overlapping');
        if (node.x === start.x && node.y === start.y) {
          if (redrawPending) draw();
          return;
        }
        if (cancelled || blocked) {
          Object.assign(node, {x:start.x, y:start.y});
          draw();
          if (blocked && !cancelled) window.ERWToast('该位置与其他卡片重叠，已恢复原位', true);
          return;
        }
        dirty();
        showNode(node);
      };
      button.onpointercancel = () => finish(true);
      button.onlostpointercapture = () => finish(false);
    };
    showLibrary();
    const refreshTimer = setInterval(() => {
      if (!viewport.isConnected || location.hash !== '#' + ROUTE) {
        clearInterval(refreshTimer);
      } else if (autoToggle.checked && !document.hidden) {
        void refreshRelations();
      }
    }, 12000);
  }

  window.ERWPanels.register({id:ROUTE, group:'core', before:'todos', label:'工程画布', icon:'⌘',
    eyebrow:'PROJECT WORKFLOW', title:'工程画布', render,
    selectProject(id) { projectId = id; location.hash = ROUTE; }});
})();
