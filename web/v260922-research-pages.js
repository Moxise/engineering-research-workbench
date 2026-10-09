/* v260922-research-pages.js · v261009a —— 研究知识页补丁合并模块（A2）
 *
 * 本文件由以下 5 个原本「靠 index.html 加载顺序互相覆盖」的补丁按序拼接而成，
 * 内容未做任何改写（逐字保留），加载位置即原来第一个补丁的位置：
 *   1. v260922-projects.js
 *   2. v260922-overview-editor-tools.js
 *   3. v260922-graph-performance.js
 *   4. v260922-overview-graph.js
 *   5. v260922-agent-profiles.js
 *
 * 合并前提（改这里之前请先复核）：每个原文件都是 IIFE 且无顶层声明，
 * 彼此只经 window / 自定义事件 / DOM 通信。装配顺序见 web/manifest.json，
 * 提交前跑 python tools/web_check.py。
 */

(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STATUS = ['进行中','暂停','完成','归档'];
  let milestoneStatus = localStorage.getItem('milestoneStatusFilter') || '';
  let projectsLoading = false;

  async function api(url, opts={}) {
    const init={...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}};
    if(init.body && typeof init.body!=='string') init.body=JSON.stringify(init.body);
    const res=await fetch(url,init); let data={}; try{data=await res.json()}catch{}
    if(!res.ok) throw new Error(data.message||data.error||`HTTP ${res.status}`); return data;
  }
  function toast(msg,error=false){
    const stack=$('#toast-stack'); if(!stack)return;
    const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=msg;stack.appendChild(el);setTimeout(()=>el.remove(),3200);
  }
  function modal(title, body, footer=''){
    $('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#modal-footer').innerHTML=footer;$('#modal-backdrop').classList.remove('hidden');
  }
  function closeModal(){ $('#modal-backdrop')?.classList.add('hidden'); }
  function fmtDate(s){return s?String(s).slice(0,10):'—'}
  function fmtTime(s){try{return s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'—'}catch{return s||'—'}}

  function ensureProjectNav(){
    const overview=$('[data-route="overview"]'); if(!overview || $('[data-project-route]'))return;
    const a=document.createElement('a'); a.className='nav-item';a.href='#projects';a.dataset.projectRoute='1';
    a.innerHTML='<span class="nav-ico">▥</span><span>项目</span>';
    overview.insertAdjacentElement('afterend',a);
    a.addEventListener('click',e=>{e.preventDefault();showProjects()});
  }

  function setProjectHeader(){
    $('#page-eyebrow').textContent='CORE WORK';$('#page-title').textContent='项目';
    document.title='项目 · 科研工作台';
    $$('.nav-item').forEach(x=>x.classList.remove('active'));$('[data-project-route]')?.classList.add('active');
    history.replaceState(null,'','#projects');
  }

  async function showProjects(){
    if(projectsLoading)return;
    projectsLoading=true;
    setProjectHeader(); const main=$('#main');
    main.innerHTML='<div class="empty"><div><div class="empty-symbol">PROJECTS</div>正在加载项目…</div></div>';
    try{
      const rows=await api('/api/project-records');
      if(location.hash!=='#projects')return;
      main.innerHTML=`<div class="project-manager">
        <section class="card card-pad project-manager-head"><div><div class="card-kicker">PROJECT MANAGEMENT</div><h3>项目管理</h3><p>项目以稳定 ID 作为唯一索引。修改名称不会改变关联关系；删除项目时工程目录会移入 Workspace 回收目录。</p></div><button class="primary-btn" id="project-new">＋ 新建项目</button></section>
        <div class="project-manager-grid">${rows.length?rows.map(projectCard).join(''):'<section class="card card-pad"><div class="empty">暂无项目，点击“新建项目”开始。</div></section>'}</div>
      </div>`;
      $('#project-new').onclick=()=>openProjectEditor();
      $$('[data-project-edit]').forEach(b=>b.onclick=()=>openProjectEditor(rows.find(x=>x.id===b.dataset.projectEdit)));
      $$('[data-project-delete]').forEach(b=>b.onclick=()=>deleteProject(rows.find(x=>x.id===b.dataset.projectDelete)));
    }catch(e){main.innerHTML=`<div class="card card-pad danger">项目加载失败：${esc(e.message)}</div>`}
    finally{projectsLoading=false;}
  }

  function projectCard(p){
    return `<section class="card project-manager-card">
      <div class="project-card-top"><div><div class="project-id mono">${esc(p.id)}</div><h3>${esc(p.name)}</h3></div><span class="badge ${p.status==='进行中'?'accent':''}">${esc(p.status||'进行中')}</span></div>
      <p class="project-desc">${esc(p.description||'暂无项目描述')}</p>
      <div class="project-card-metrics"><span><b>${p.docs||0}</b> 知识条目</span><span><b>${p.open_todos||0}</b> 待办</span><span><b>${p.milestones||0}</b> 里程碑</span></div>
      <div class="project-card-meta"><span>最近编辑 ${esc(fmtTime(p.last_updated))}</span><span>创建 ${esc(fmtDate(p.created))}</span></div>
      <div class="project-card-actions"><button class="secondary-btn" data-project-edit="${esc(p.id)}">编辑</button><button class="ghost-btn danger-text" data-project-delete="${esc(p.id)}">删除</button></div>
    </section>`;
  }

  function openProjectEditor(p=null){
    const editing=!!p;
    modal(editing?'编辑项目':'新建项目',`<div class="project-form">
      <label><span>项目名称</span><input class="search-input" id="pm-name" value="${esc(p?.name||'')}" maxlength="100" placeholder="请输入项目名称"></label>
      <label><span>项目状态</span><select class="search-input" id="pm-status">${STATUS.map(s=>`<option ${p?.status===s?'selected':''}>${s}</option>`).join('')}</select></label>
      <label class="wide"><span>项目描述</span><textarea class="search-input" id="pm-desc" rows="5" placeholder="简要说明项目目标、阶段或范围">${esc(p?.description||'')}</textarea></label>
      ${editing?`<div class="wide project-id-note">唯一 ID：<code>${esc(p.id)}</code>。重命名项目不会改变此 ID。</div>`:''}
    </div>`,`<button class="secondary-btn" id="pm-cancel">取消</button><button class="primary-btn" id="pm-save">保存</button>`);
    $('#pm-cancel').onclick=closeModal;
    $('#pm-save').onclick=async()=>{
      const body={name:$('#pm-name').value.trim(),status:$('#pm-status').value,description:$('#pm-desc').value.trim()};
      if(!body.name)return toast('项目名称不能为空',true);
      try{
        if(editing) await api('/api/projects/'+encodeURIComponent(p.id),{method:'POST',body});
        else await api('/api/project-records',{method:'POST',body});
        closeModal();toast(editing?'项目已更新':'项目已创建');await showProjects();
      }catch(e){toast(e.message,true)}
    };
  }

  async function deleteProject(p){
    if(!p)return;
    if(!confirm(`删除项目“${p.name}”？\n\n知识条目不会被删除，只会解除该项目关联；项目工程目录会移入 Workspace/System/Trash/Projects。`))return;
    try{await api('/api/projects/'+encodeURIComponent(p.id),{method:'DELETE'});toast('项目已删除，工程目录已移入回收目录');await showProjects()}catch(e){toast(e.message,true)}
  }

  function enhanceMilestones(){
    const root=$('#ms-view'); if(!root)return;
    const timeline=$('.timeline',root), three=$('.milestone-3d-layout',root); if(!timeline&&!three)return;
    if(!$('.milestone-status-filter',root)){
      const bar=document.createElement('div');bar.className='milestone-status-filter';
      bar.innerHTML=`<span>状态筛选</span><select class="mini-select" id="milestone-status-filter"><option value="">全部状态</option>${['计划','进行中','受阻','完成'].map(s=>`<option value="${s}" ${milestoneStatus===s?'selected':''}>${s}</option>`).join('')}</select>`;
      root.insertAdjacentElement('afterbegin',bar);
      $('#milestone-status-filter',root).onchange=e=>{milestoneStatus=e.target.value;localStorage.setItem('milestoneStatusFilter',milestoneStatus);applyMilestoneFilter(root)};
    }
    applyMilestoneFilter(root);
  }

  function applyMilestoneFilter(root){
    $$('.timeline-item',root).forEach(x=>{const s=$('.badge',x)?.textContent.trim()||'';x.hidden=!!milestoneStatus&&s!==milestoneStatus});
    $$('.timeline-3d-card',root).forEach(x=>{const txt=$('.row-meta',x)?.textContent||'';const status=txt.split('·').pop().trim();x.hidden=!!milestoneStatus&&status!==milestoneStatus});
  }

  function fixPreviewImages(root=document){
    $$('img',root).forEach(img=>{
      const raw=img.getAttribute('src')||'';
      if(/^\.\.\/(?:\.\.\/)?Attachments\//.test(raw)){
        const rest=raw.replace(/^\.\.\/(?:\.\.\/)?Attachments\//,'');
        img.setAttribute('src','/workspace-file/Knowledge/Attachments/'+rest);
      }
    });
  }

  const observer=new MutationObserver(()=>{
    ensureProjectNav();
    if(location.hash==='#projects' && $('#main') && !$('.project-manager')) showProjects();
    enhanceMilestones();
    fixPreviewImages(document);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  window.addEventListener('hashchange',()=>{if(location.hash==='#projects')showProjects()});
  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-project-route]');if(nav){e.preventDefault();showProjects()}
  },true);

  ensureProjectNav();
  if(location.hash==='#projects')setTimeout(showProjects,50);
  setTimeout(()=>{enhanceMilestones();fixPreviewImages()},100);
})();

(() => {
  'use strict';

  const qs = (s, root=document) => root.querySelector(s);
  const qsa = (s, root=document) => [...root.querySelectorAll(s)];

  const clampZoom = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 100;
    return Math.max(10, Math.min(200, Math.round(n / 10) * 10));
  };
  const readZoom = key => clampZoom(localStorage.getItem(key) || 100);
  const writeZoom = (key, value) => {
    const z = clampZoom(value);
    localStorage.setItem(key, String(z));
    return z;
  };
  const zoomOptions = current => Array.from({length:20}, (_,i)=>(i+1)*10)
    .map(n=>`<option value="${n}" ${n===current?'selected':''}>${n}%</option>`).join('');

  function applyEditorZoom(){
    const pane=qs('#editor-pane'); if(!pane)return;
    const edit=readZoom('erwEditorZoom'), preview=readZoom('erwPreviewZoom');
    pane.style.setProperty('--md-edit-scale', String(edit/100));
    pane.style.setProperty('--md-preview-scale', String(preview/100));
    const a=qs('[data-editor-zoom="edit"]'), b=qs('[data-editor-zoom="preview"]');
    if(a)a.value=String(edit); if(b)b.value=String(preview);
  }

  function injectEditorZoomControls(){
    const toolbar=qs('#doc-editor .toolbar');
    if(!toolbar){return;}
    if(toolbar.querySelector('.editor-zoom-controls')){applyEditorZoom();return;}
    const edit=readZoom('erwEditorZoom'), preview=readZoom('erwPreviewZoom');
    const box=document.createElement('div');
    box.className='editor-zoom-controls';
    box.innerHTML=`<label class="editor-zoom-field" title="Markdown 编辑区缩放"><span>编辑</span><select data-editor-zoom="edit" aria-label="编辑区缩放">${zoomOptions(edit)}</select></label><label class="editor-zoom-field" title="Markdown 预览区缩放"><span>预览</span><select data-editor-zoom="preview" aria-label="预览区缩放">${zoomOptions(preview)}</select></label>`;
    const tabs=toolbar.querySelector('.editor-tabs');
    if(tabs)toolbar.insertBefore(box,tabs);else toolbar.appendChild(box);
    qsa('[data-editor-zoom]',box).forEach(sel=>sel.addEventListener('change',()=>{
      writeZoom(sel.dataset.editorZoom==='edit'?'erwEditorZoom':'erwPreviewZoom',sel.value);
      applyEditorZoom();
    }));
    applyEditorZoom();
  }

  /* Only CURRENT TASKS and NEXT MILESTONE are capped here. Research Rhythm is untouched. */
  function limitOverviewRows(ops){
    if(!ops)return;
    const cards=[...ops.children];
    [1,2].forEach(i=>{
      const card=cards[i]; if(!card)return;
      qsa('.list-row',card).forEach((row,index)=>{
        row.style.display=index>=3?'none':'';
      });
    });
  }

  function openRecentDoc(card, docId){
    const allButton=qs('[data-go]',card);
    if(!allButton)return;
    allButton.click();
    let tries=0;
    const timer=setInterval(()=>{
      const target=qsa('[data-doc-id]').find(el=>el.dataset.docId===String(docId));
      if(target){clearInterval(timer);target.click();return;}
      if(++tries>=30)clearInterval(timer);
    },80);
  }

  function paintRecentCard(card, docs){
    const head=qs('.card-head',card); if(!head)return;
    [...card.children].forEach(child=>{if(child!==head)child.remove();});
    const rows=(docs||[]).slice(0,10);
    if(!rows.length){
      const empty=document.createElement('div');
      empty.className='empty';
      empty.style.minHeight='120px';
      empty.textContent='暂无内容';
      card.appendChild(empty);
      return;
    }
    rows.forEach(doc=>{
      const row=document.createElement('div');
      row.className='list-row clickable';
      const main=document.createElement('div'); main.className='row-main';
      const title=document.createElement('div'); title.className='row-title'; title.textContent=doc.title||'未命名';
      const meta=document.createElement('div'); meta.className='row-meta'; meta.textContent=`${doc.project||'未归属项目'} · ${doc.status||''}`;
      main.append(title,meta); row.appendChild(main);
      row.addEventListener('click',()=>openRecentDoc(card,doc.id));
      card.appendChild(row);
    });
  }

  async function expandRecentResearch(dashboard){
    const group=qs('.overview-recent-group',dashboard); if(!group||group.dataset.recentExpanded==='loading'||group.dataset.recentExpanded==='done')return;
    const cards=qsa('.recent-card',group); if(cards.length<3)return;
    group.dataset.recentExpanded='loading';
    const specs=[['idea',cards[0]],['note',cards[1]],['summary',cards[2]]];
    try{
      const results=await Promise.all(specs.map(async([kind])=>{
        const res=await fetch('/api/docs?kind='+encodeURIComponent(kind));
        if(!res.ok)throw new Error(`HTTP ${res.status}`);
        const data=await res.json();
        return Array.isArray(data)?data.slice(0,5):[]; /* v260922i2 · 笔记行数 6→5，压缩最近卡高度 */
      }));
      specs.forEach(([,card],i)=>paintRecentCard(card,results[i]));
      group.dataset.recentExpanded='done';
    }catch(err){
      console.warn('recent research expansion failed',err);
      group.dataset.recentExpanded='error';
    }
  }

  function enhanceOverviewLayout(){
    const dashboard=qs('#main .overview-dashboard'); if(!dashboard)return;
    if(!qs(':scope > .overview-mid-band',dashboard)){
      const today=qs(':scope > .overview-today',dashboard), quick=qs(':scope > .quick-capture-card',dashboard), ops=qs(':scope > .overview-ops-grid',dashboard);
      if(today&&quick&&ops){
        const band=document.createElement('div');band.className='overview-mid-band';
        const left=document.createElement('div');left.className='overview-mid-left';
        dashboard.insertBefore(band,today);left.append(today,quick);band.append(left,ops);
      }
    }
    if(!qs(':scope > .overview-lower-band',dashboard)){
      const project=qs(':scope > .project-pulse-card',dashboard), stats=qs(':scope > .overview-stats',dashboard), heading=qs(':scope > .section-title',dashboard), recent=heading?.nextElementSibling;
      if(project&&stats&&heading&&recent?.classList.contains('grid-3')){
        const band=document.createElement('div');band.className='overview-lower-band';
        const left=document.createElement('div');left.className='overview-lower-left';
        const right=document.createElement('div');right.className='overview-recent-group';
        dashboard.insertBefore(band,project);left.append(project,stats);right.append(heading,recent);band.append(left,right);
      }
    }
    limitOverviewRows(qs('.overview-mid-band .overview-ops-grid',dashboard)||qs('.overview-ops-grid',dashboard));
    expandRecentResearch(dashboard);
    dashboard.dataset.layoutEnhanced='1';
  }

  let scheduled=false;
  function enhance(){scheduled=false;enhanceOverviewLayout();injectEditorZoomControls();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(enhance);}
  function start(){const main=qs('#main');if(!main)return;new MutationObserver(schedule).observe(main,{childList:true,subtree:true});schedule();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

(() => {
  'use strict';

  const VERSION = '260922.1';
  const MAX_FETCH_NODES = 500;
  const SEARCH_LIMIT = 10;
  const LAYOUT_CACHE_VERSION = 2;
  const DOC_KINDS = new Set(['idea','journal','note','milestone','summary','literature']);
  const KIND_LABEL = {idea:'灵感',journal:'研究日志',note:'笔记',milestone:'里程碑',summary:'工作总结',literature:'文献',project:'项目',tag:'标签'};
  const KIND_COLOR = {idea:'#2a9d8f',journal:'#5b8def',note:'#6f7a8a',milestone:'#c6863b',summary:'#845ec2',literature:'#2673a7',tag:'#b56a9d',project:'#087f8c'};
  const REL_LABEL = {wikilink:'显式引用',tag:'标签关联',project:'项目归属'};
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const css = (name, fallback='') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const route = () => (location.hash || '#overview').slice(1).split('?')[0];
  const now = () => performance.now();

  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededUnit(seed) {
    let x = (seed || 1) >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 1000000) / 1000000;
  }
  function safeDateValue(v) { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; }
  function relativeDate(v) {
    const t=safeDateValue(v); if(!t) return '';
    const d=Math.max(0,Date.now()-t), m=Math.floor(d/60000), h=Math.floor(d/3600000), day=Math.floor(d/86400000);
    if(m<1)return '刚刚'; if(m<60)return `${m} 分钟前`; if(h<24)return `${h} 小时前`; if(day<2)return '昨天'; if(day<7)return `${day} 天前`;
    return new Date(t).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});
  }
  async function api(url, opts={}) {
    const init={...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}};
    if(init.body && typeof init.body!=='string') init.body=JSON.stringify(init.body);
    const res=await fetch(url,init); let data={}; try{data=await res.json()}catch{}
    if(!res.ok) throw new Error(data.message||data.error||`HTTP ${res.status}`); return data;
  }

  class OptimizedKnowledgeGraph {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.pageToken = `${Date.now()}-${Math.random()}`;
      this.raw = {nodes:[],edges:[],meta:{}};
      this.graph = {nodes:[],edges:[]};
      this.nodeMap = new Map();
      this.adjacency = new Map();
      this.degree = new Map();
      this.edgeImportance = new Map();
      this.communities = new Map();
      this.layout = new Map();
      this.searchIndex = [];
      this.searchHits = new Set();
      this.selectedId = null;
      this.focusDepth = 1;
      this.focusDistances = new Map();
      this.mode = document.querySelector('[data-gview].active')?.dataset.gview || '2d';
      this.camera = {
        '2d': {panX:0,panY:0,zoom:1,rotX:0,rotY:0},
        '3d': {panX:0,panY:0,zoom:1,rotX:.25,rotY:0},
      };
      this.screen = new Map();
      this.renderPending = false;
      this.drag = null;
      this.dragMoved = false;
      this.pressNodeId = null;
      this.labelWidth = new Map();
      this.layoutSignature = '';
      this.layoutStats = null;
      this.searchCursor = -1;
      this.destroyed = false;
      this.resizeObserver = null;
      this.bindCanvas();
    }

    async init() {
      window.__workbenchPerf && (window.__workbenchPerf.graphLimit = Math.max(window.__workbenchPerf.graphLimit || 0, MAX_FETCH_NODES));
      this.installToolbar();
      this.bindExistingControls();
      this.setStatus('正在建立图结构索引…');
      const graph = await api(`/api/graph?limit=${MAX_FETCH_NODES}`);
      if (this.destroyed || route() !== 'graph' || !this.canvas.isConnected) return;
      this.raw = graph || {nodes:[],edges:[],meta:{}};
      this.refreshFilteredGraph(true);
      this.resizeObserver = new ResizeObserver(() => this.requestRender());
      this.resizeObserver.observe(this.canvas);
      this.requestRender();
      const meta=this.raw.meta||{};
      this.setStatus(`${this.graph.nodes.length} 节点 · ${this.graph.edges.length} 关系 · Force + LOD${meta.truncated?' · 当前服务端载入 '+meta.shown_documents+'/'+meta.total_documents:''}`);
    }

    destroy() {
      this.destroyed = true;
      try { this.resizeObserver?.disconnect(); } catch (_) {}
      if(this.outsidePointerHandler)document.removeEventListener('pointerdown',this.outsidePointerHandler,{capture:true});
    }

    installToolbar() {
      const wrap=document.querySelector('#graph-wrap'); if(!wrap) return;
      let toolbar=document.querySelector('#graph-smart-toolbar');
      if(!toolbar){
        toolbar=document.createElement('section'); toolbar.id='graph-smart-toolbar'; toolbar.className='graph-smart-toolbar';
        toolbar.innerHTML=`
          <div class="graph-smart-search-wrap">
            <div class="graph-smart-search"><span>⌕</span><input id="graph-smart-search" autocomplete="off" placeholder="搜索知识、标签或项目……"><kbd>↑↓ Enter</kbd></div>
            <div class="graph-smart-results hidden" id="graph-smart-results"></div>
          </div>
          <div class="graph-focus-tools" aria-label="图谱聚焦">
            <button class="secondary-btn active" type="button" data-graph-focus="1">直接关系</button>
            <button class="secondary-btn" type="button" data-graph-focus="2">两级关系</button>
            <button class="secondary-btn" type="button" data-graph-focus="0">恢复全图</button>
            <span class="graph-tool-sep"></span>
            <button class="ghost-btn" type="button" data-graph-scope="docs">仅知识节点</button>
            <button class="ghost-btn" type="button" data-graph-scope="all">全部节点</button>
          </div>
          <div class="graph-engine-status" id="graph-engine-status"></div>`;
        wrap.parentElement.insertBefore(toolbar,wrap);
      }
      const input=toolbar.querySelector('#graph-smart-search'); const results=toolbar.querySelector('#graph-smart-results');
      input.onfocus=()=>this.showSuggestions(input.value);
      input.oninput=()=>this.showSuggestions(input.value);
      input.onkeydown=e=>this.onSearchKey(e);
      this.outsidePointerHandler=e=>{if(this.destroyed)return;if(!toolbar.contains(e.target))results.classList.add('hidden')};
      document.addEventListener('pointerdown',this.outsidePointerHandler,{capture:true});
      toolbar.querySelectorAll('[data-graph-focus]').forEach(b=>b.onclick=()=>{
        const d=Number(b.dataset.graphFocus||0); if(!d){this.clearFocus(true);return} this.focusDepth=d; this.updateFocus(); this.syncFocusButtons(); this.requestRender();
      });
      toolbar.querySelector('[data-graph-scope="docs"]').onclick=()=>this.setScope(true);
      toolbar.querySelector('[data-graph-scope="all"]').onclick=()=>this.setScope(false);
    }

    bindExistingControls() {
      document.querySelectorAll('[data-gview]').forEach(btn=>{btn.onclick=(e)=>{e.preventDefault();e.stopPropagation();this.mode=btn.dataset.gview||'2d';document.querySelectorAll('[data-gview]').forEach(x=>x.classList.toggle('active',x===btn));this.requestRender()}});
      const fit=document.querySelector('#graph-fit'); if(fit)fit.onclick=(e)=>{e.preventDefault();this.clearFocus(true)};
      const close=document.querySelector('#graph-preview-close'); if(close)close.onclick=()=>this.clearFocus(false);
      const bundle=document.querySelector('#graph-bundle'); if(bundle)bundle.onclick=()=>this.openBundle();

      document.querySelectorAll('[data-graph-kind],[data-graph-relation]').forEach(input=>{input.onchange=(e)=>{e.stopPropagation();this.persistFilters();this.refreshFilteredGraph(true)}});
      const all=document.querySelector('#graph-filter-all'); if(all)all.onclick=(e)=>{e.preventDefault();e.stopPropagation();document.querySelectorAll('[data-graph-kind]').forEach(x=>x.checked=true);this.persistFilters();this.refreshFilteredGraph(true)};
      const docs=document.querySelector('#graph-filter-docs'); if(docs)docs.onclick=(e)=>{e.preventDefault();e.stopPropagation();this.setScope(true)};
    }

    persistFilters(){
      localStorage.setItem('graphKinds',JSON.stringify([...document.querySelectorAll('[data-graph-kind]:checked')].map(x=>x.dataset.graphKind)));
      localStorage.setItem('graphRelations',JSON.stringify([...document.querySelectorAll('[data-graph-relation]:checked')].map(x=>x.dataset.graphRelation)));
    }
    setScope(docsOnly){
      document.querySelectorAll('[data-graph-kind]').forEach(x=>x.checked=docsOnly?DOC_KINDS.has(x.dataset.graphKind):true);
      this.persistFilters(); this.refreshFilteredGraph(true);
    }

    refreshFilteredGraph(rebuildLayout=false) {
      const kinds=new Set([...document.querySelectorAll('[data-graph-kind]:checked')].map(x=>x.dataset.graphKind));
      const relations=new Set([...document.querySelectorAll('[data-graph-relation]:checked')].map(x=>x.dataset.graphRelation));
      const nodes=(this.raw.nodes||[]).filter(n=>kinds.has(n.kind)); const ids=new Set(nodes.map(n=>String(n.id)));
      const edges=(this.raw.edges||[]).filter(e=>relations.has(e.relation)&&ids.has(String(e.source))&&ids.has(String(e.target)));
      this.graph={nodes,edges}; this.nodeMap=new Map(nodes.map(n=>[String(n.id),n]));
      this.buildAdjacency(); this.buildSearchIndex();
      if(this.selectedId&&!this.nodeMap.has(this.selectedId)) this.clearFocus(false);
      if(rebuildLayout) this.ensureLayout(); else this.requestRender();
      this.updateFocus();
      this.setStatus(`${nodes.length} 节点 · ${edges.length} 关系 · Force + LOD`);
    }

    buildAdjacency() {
      this.adjacency=new Map(); this.degree=new Map(); this.edgeImportance=new Map(); this._degreeSorted=null;
      for(const n of this.graph.nodes){const id=String(n.id);this.adjacency.set(id,[]);this.degree.set(id,0)}
      for(const e of this.graph.edges){const a=String(e.source),b=String(e.target);if(!this.adjacency.has(a)||!this.adjacency.has(b))continue;this.adjacency.get(a).push({id:b,edge:e});this.adjacency.get(b).push({id:a,edge:e});this.degree.set(a,(this.degree.get(a)||0)+1);this.degree.set(b,(this.degree.get(b)||0)+1)}
      for(const e of this.graph.edges){const a=String(e.source),b=String(e.target);const rel=e.relation==='wikilink'?4:e.relation==='project'?2:1;this.edgeImportance.set(e,rel+(this.degree.get(a)||0)+(this.degree.get(b)||0))}
    }

    buildSearchIndex() {
      this.searchIndex=this.graph.nodes.map(n=>{
        const projects=(n.projects||[]).length?n.projects:(n.project?[n.project]:[]); const tags=n.tags||[];
        const label=String(n.label||n.id||''); return {id:String(n.id),label,kind:n.kind||'',projects,tags,updated:n.updated||'',searchText:[label,...projects,...tags,KIND_LABEL[n.kind]||n.kind||''].join(' ').toLocaleLowerCase()};
      });
    }

    layoutKey(){
      let s=`${LAYOUT_CACHE_VERSION}|${this.graph.nodes.length}|${this.graph.edges.length}|`;
      for(const n of this.graph.nodes)s+=`${n.id};`; for(const e of this.graph.edges)s+=`${e.source}>${e.target}:${e.relation};`;
      return hashString(s).toString(36);
    }

    ensureLayout(){
      const sig=this.layoutKey(); this.layoutSignature=sig;
      const memory=OptimizedKnowledgeGraph.layoutCache.get(sig); if(memory){this.layout=new Map(memory.map(x=>[x[0],{...x[1]}]));this.communities=this.detectCommunities();this.layoutStats={cached:true};this.requestRender();return}
      try{
        const raw=sessionStorage.getItem(`erw:graph-layout:${sig}`); if(raw){const arr=JSON.parse(raw);if(Array.isArray(arr)&&arr.length===this.graph.nodes.length){this.layout=new Map(arr);OptimizedKnowledgeGraph.layoutCache.set(sig,arr);this.communities=this.detectCommunities();this.layoutStats={cached:true};this.requestRender();return}}
      }catch(_){ }
      const t=now(); this.communities=this.detectCommunities(); this.layout=this.forceLayout(); this.layoutStats={cached:false,ms:Math.round((now()-t)*10)/10};
      const arr=[...this.layout.entries()]; OptimizedKnowledgeGraph.layoutCache.set(sig,arr);
      try{if(arr.length<=1200)sessionStorage.setItem(`erw:graph-layout:${sig}`,JSON.stringify(arr))}catch(_){ }
      this.requestRender();
    }

    detectCommunities(){
      const ids=this.graph.nodes.map(n=>String(n.id)); const community=new Map(ids.map((id,i)=>[id,i])); if(ids.length<25)return community;
      const iterations=ids.length>800?3:5;
      for(let it=0;it<iterations;it++){
        let changed=0;
        for(const id of ids){const score=new Map();for(const nb of this.adjacency.get(id)||[]){const c=community.get(nb.id);score.set(c,(score.get(c)||0)+1)}if(!score.size)continue;let best=community.get(id),bestScore=-1;for(const [c,v] of score){if(v>bestScore||(v===bestScore&&c<best)){best=c;bestScore=v}}if(best!==community.get(id)){community.set(id,best);changed++}}
        if(!changed)break;
      }
      const remap=new Map();let k=0;for(const id of ids){const c=community.get(id);if(!remap.has(c))remap.set(c,k++);community.set(id,remap.get(c))}return community;
    }

    forceLayout(){
      const nodes=this.graph.nodes, n=nodes.length; const pos=new Map(); if(!n)return pos;
      const commCount=Math.max(1,new Set(this.communities.values()).size); const communityCenter=new Map();
      for(let c=0;c<commCount;c++){const a=2*Math.PI*c/commCount;communityCenter.set(c,{x:Math.cos(a)*260,y:Math.sin(a)*190})}
      for(let i=0;i<n;i++){const node=nodes[i],id=String(node.id),seed=hashString(id),c=this.communities.get(id)||0,center=communityCenter.get(c)||{x:0,y:0};const a=seededUnit(seed)*Math.PI*2,r=25+80*seededUnit(seed^0x9e3779b9);pos.set(id,{x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r,z:(seededUnit(seed^0x85ebca6b)-.5)*180})}
      if(n===1){const only=pos.values().next().value;only.x=only.y=0;return pos}
      const iter=n<100?140:n<500?90:n<1200?55:36; const sample=n<200?Math.min(32,n-1):n<800?20:12; const ids=nodes.map(x=>String(x.id));
      for(let step=0;step<iter;step++){
        const cool=.9*(1-step/iter)+.08; const delta=new Map(ids.map(id=>[id,{x:0,y:0}]));
        for(const e of this.graph.edges){const a=String(e.source),b=String(e.target),pa=pos.get(a),pb=pos.get(b);if(!pa||!pb)continue;let dx=pb.x-pa.x,dy=pb.y-pa.y,dist=Math.hypot(dx,dy)||1;const desired=e.relation==='project'?95:e.relation==='tag'?82:115;const f=(dist-desired)*.012;dx/=dist;dy/=dist;delta.get(a).x+=dx*f;delta.get(a).y+=dy*f;delta.get(b).x-=dx*f;delta.get(b).y-=dy*f}
        for(let i=0;i<n;i++){const id=ids[i],p=pos.get(id),d=delta.get(id);const stride=1+(hashString(id)%Math.max(1,n-1));for(let s=1;s<=sample;s++){const j=(i+s*stride)%n;if(j===i)continue;const q=pos.get(ids[j]);let dx=p.x-q.x,dy=p.y-q.y,dist2=dx*dx+dy*dy+36,dist=Math.sqrt(dist2);const f=Math.min(2.6,780/dist2);d.x+=dx/dist*f;d.y+=dy/dist*f}const center=communityCenter.get(this.communities.get(id)||0)||{x:0,y:0};d.x+=(center.x-p.x)*.0028;d.y+=(center.y-p.y)*.0028;d.x+=-p.x*.0008;d.y+=-p.y*.0008}
        for(const id of ids){const p=pos.get(id),d=delta.get(id);const mag=Math.hypot(d.x,d.y),cap=8*cool,scale=mag>cap?cap/mag:1;p.x+=d.x*scale;p.y+=d.y*scale}
      }
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const p of pos.values()){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)}const cx=(minX+maxX)/2,cy=(minY+maxY)/2,span=Math.max(1,maxX-minX,maxY-minY),scale=650/span;for(const p of pos.values()){p.x=(p.x-cx)*scale;p.y=(p.y-cy)*scale}
      return pos;
    }

    showSuggestions(query=''){
      const box=document.querySelector('#graph-smart-results');if(!box)return;const q=String(query||'').trim().toLocaleLowerCase();let rows=[];
      if(!q){rows=[...this.searchIndex].filter(x=>DOC_KINDS.has(x.kind)).sort((a,b)=>safeDateValue(b.updated)-safeDateValue(a.updated)).slice(0,8).map(x=>({...x,score:0,recent:true}))}
      else{rows=this.searchIndex.map(x=>{const label=x.label.toLocaleLowerCase();let score=0;if(label===q)score=1000;else if(label.startsWith(q))score=700;else if(label.includes(q))score=500;else if(x.tags.some(t=>String(t).toLocaleLowerCase().includes(q)))score=350;else if(x.projects.some(p=>String(p).toLocaleLowerCase().includes(q)))score=300;else if(x.searchText.includes(q))score=150;score+=(this.degree.get(x.id)||0)*.2;return {...x,score}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label,'zh-CN')).slice(0,SEARCH_LIMIT)}
      this.searchHits=new Set(q?rows.map(x=>x.id):[]);this.searchCursor=rows.length?0:-1;box.dataset.ids=JSON.stringify(rows.map(x=>x.id));
      box.innerHTML=`<div class="graph-result-heading">${q?'匹配节点':'最近编辑'}</div>${rows.map((x,i)=>`<button type="button" class="graph-result-row ${i===this.searchCursor?'active':''}" data-graph-result="${esc(x.id)}"><span class="graph-result-kind">${esc(KIND_LABEL[x.kind]||x.kind)}</span><span><strong>${esc(x.label)}</strong><small>${esc((x.projects||[]).join(', ')||(x.tags||[]).slice(0,3).join(', ')||'')}</small></span><time>${esc(x.recent?relativeDate(x.updated):'')}</time></button>`).join('')||'<div class="graph-result-empty">没有找到匹配节点</div>'}`;
      box.classList.remove('hidden');box.querySelectorAll('[data-graph-result]').forEach(btn=>btn.onclick=()=>{this.selectSearchResult(btn.dataset.graphResult);box.classList.add('hidden')});this.requestRender();
    }

    onSearchKey(e){
      const box=document.querySelector('#graph-smart-results');let ids=[];try{ids=JSON.parse(box?.dataset.ids||'[]')}catch{}
      if(e.key==='Escape'){box?.classList.add('hidden');return}
      if((e.key==='ArrowDown'||e.key==='ArrowUp')&&ids.length){e.preventDefault();this.searchCursor=(this.searchCursor+(e.key==='ArrowDown'?1:-1)+ids.length)%ids.length;box.querySelectorAll('.graph-result-row').forEach((x,i)=>x.classList.toggle('active',i===this.searchCursor));box.querySelector('.graph-result-row.active')?.scrollIntoView({block:'nearest'});return}
      if(e.key==='Enter'&&ids.length){e.preventDefault();const id=ids[Math.max(0,this.searchCursor)];this.selectSearchResult(id);box?.classList.add('hidden')}
    }
    selectSearchResult(id){const input=document.querySelector('#graph-smart-search');const node=this.nodeMap.get(id);if(input&&node)input.value=node.label;this.selectNode(id,true)}

    updateFocus(){
      this.focusDistances=new Map();if(!this.selectedId||!this.nodeMap.has(this.selectedId))return;this.focusDistances.set(this.selectedId,0);const q=[this.selectedId];for(let i=0;i<q.length;i++){const id=q[i],d=this.focusDistances.get(id);if(d>=2)continue;for(const nb of this.adjacency.get(id)||[]){if(!this.focusDistances.has(nb.id)){this.focusDistances.set(nb.id,d+1);q.push(nb.id)}}}
    }
    syncFocusButtons(){document.querySelectorAll('[data-graph-focus]').forEach(b=>b.classList.toggle('active',Number(b.dataset.graphFocus||0)===this.focusDepth&&!!this.selectedId))}

    selectNode(id,animate=false){
      const node=this.nodeMap.get(String(id));if(!node)return;this.selectedId=String(id);this.focusDepth=this.focusDepth||1;this.updateFocus();this.syncFocusButtons();this.updateSidePanel(node);this.openPreview(node);const bundle=document.querySelector('#graph-bundle');if(bundle)bundle.disabled=false;if(animate)this.animateCameraTo(id);else this.requestRender();
    }
    clearFocus(resetCamera=false){
      this.selectedId=null;this.focusDistances.clear();this.searchHits.clear();this.syncFocusButtons();const title=document.querySelector('#graph-node-title'),info=document.querySelector('#graph-node-info'),bundle=document.querySelector('#graph-bundle');if(title)title.textContent='选择节点';if(info)info.textContent='搜索或点击节点后，将进入 Focus + Context；点击空白处可恢复全图。';if(bundle)bundle.disabled=true;this.hidePreview();if(resetCamera){const c=this.camera[this.mode];c.panX=0;c.panY=0;c.zoom=1;if(this.mode==='3d'){c.rotX=.25;c.rotY=0}}this.requestRender();
    }

    updateSidePanel(n){
      const title=document.querySelector('#graph-node-title'),info=document.querySelector('#graph-node-info');if(title)title.textContent=n.label||n.id;if(!info)return;const projects=(n.projects||[]).length?n.projects:(n.project?[n.project]:[]),tags=n.tags||[],degree=this.degree.get(String(n.id))||0;info.innerHTML=`<div><b>类型：</b>${esc(KIND_LABEL[n.kind]||n.kind)}</div><div><b>项目：</b>${esc(projects.join(', ')||'—')}</div><div><b>标签：</b>${esc(tags.join(', ')||'—')}</div><div><b>状态：</b>${esc(n.status||'—')}</div><div><b>直接关系：</b>${degree}</div><div class="row-meta graph-selection-hint">Focus + Context 已启用；可切换直接关系 / 两级关系。</div>`;
    }

    async openPreview(n){
      const wrap=document.querySelector('#graph-wrap'),panel=document.querySelector('#graph-preview'),body=document.querySelector('#graph-preview-body');if(!wrap||!panel||!body)return;const seq=`${this.pageToken}:${n.id}:${Date.now()}`;this.previewSeq=seq;wrap.classList.add('preview-open');panel.classList.remove('hidden');document.querySelector('#graph-preview-title').textContent=n.label||n.id;const projects=(n.projects||[]).length?n.projects:(n.project?[n.project]:[]);document.querySelector('#graph-preview-meta').textContent=`${KIND_LABEL[n.kind]||n.kind}${projects.length?' · '+projects.join(', '):''}`;body.innerHTML='<div class="empty" style="min-height:120px">正在加载 Markdown…</div>';
      try{let raw='';if(n.virtual){raw=this.virtualMarkdown(n)}else{const doc=await api('/api/docs/'+encodeURIComponent(n.id));raw=doc.body||''}if(this.previewSeq!==seq||this.selectedId!==String(n.id))return;await this.renderMarkdown(body,raw||'*暂无正文*')}catch(err){if(this.previewSeq===seq)body.innerHTML=`<div class="empty danger">预览失败：${esc(err.message)}</div>`}
    }
    hidePreview(){this.previewSeq='';const wrap=document.querySelector('#graph-wrap'),panel=document.querySelector('#graph-preview'),body=document.querySelector('#graph-preview-body');wrap?.classList.remove('preview-open');panel?.classList.add('hidden');if(body)body.innerHTML=''}
    virtualMarkdown(n){const rows=(this.adjacency.get(String(n.id))||[]).map(x=>{const other=this.nodeMap.get(x.id);return other?`- [[${other.label}]] · ${KIND_LABEL[other.kind]||other.kind} · ${REL_LABEL[x.edge.relation]||x.edge.relation}`:''}).filter(Boolean);return `# ${n.label}\n\n> 这是一个由知识图谱自动生成的${KIND_LABEL[n.kind]||n.kind}节点预览。\n\n## 当前可见关联\n\n${rows.join('\n')||'- 当前筛选条件下暂无可见关联。'}\n`}
    async renderMarkdown(out,raw){
      let html='';if(window.marked){const renderer=new marked.Renderer();renderer.code=(tokenOrCode,info)=>{let code='',lang='';if(tokenOrCode&&typeof tokenOrCode==='object'){code=tokenOrCode.text||'';lang=tokenOrCode.lang||''}else{code=String(tokenOrCode||'');lang=String(info||'')}if(String(lang).trim()==='mermaid')return `<div class="mermaid">${esc(code)}</div>`;return `<pre><code class="language-${esc(String(lang).trim())}">${esc(code)}</code></pre>`};try{html=marked.parse(raw||'',{gfm:true,renderer})}catch{html=`<pre>${esc(raw)}</pre>`}}else html=`<pre>${esc(raw)}</pre>`;
      html=html.replace(/(src|href)="(?:\.\.\/)+(?:Knowledge\/)?Attachments\//g,'$1="/workspace-file/Knowledge/Attachments/').replace(/(src|href)="Attachments\//g,'$1="/workspace-file/Knowledge/Attachments/').replace(/src="(?!https?:|data:|\/|#)([^"]+)"/g,(m,p)=>'src="/workspace-file/'+p.replace(/^\.?\//,"")+'"'); /* v260929w · Workspace 相对路径图片（批注截图 / 笔记插图）：img src 经 /workspace-file/ 服务 */
      out.innerHTML=window.DOMPurify?DOMPurify.sanitize(html,{ADD_TAGS:['mjx-container']}):html;out.querySelectorAll('pre code').forEach(el=>{try{window.hljs?.highlightElement(el)}catch{}});try{if(!window.mermaid&&out.querySelector('.mermaid'))await window.erwVendor?.load?.('mermaid')}catch{};try{if(!window.MathJax&&window.erwVendor?.hasMath?.(raw))await window.erwVendor.load('mathjax')}catch{};try{if(window.mermaid){mermaid.initialize({startOnLoad:false,securityLevel:'strict'});await mermaid.run({nodes:[...out.querySelectorAll('.mermaid')]})}}catch{};try{await window.MathJax?.typesetPromise?.([out])}catch{}
    }

    async openBundle(){
      if(!this.selectedId)return;const root=this.nodeMap.get(this.selectedId);if(!root)return;const dist=new Map([[this.selectedId,0]]),q=[this.selectedId];for(let i=0;i<q.length;i++){const cur=q[i],d=dist.get(cur);if(d>=2)continue;for(const nb of this.adjacency.get(cur)||[]){if(!dist.has(nb.id)){dist.set(nb.id,d+1);q.push(nb.id)}}}const rows=[...dist.entries()].filter(([id,d])=>id!==this.selectedId&&d<=2&&!this.nodeMap.get(id)?.virtual).map(([id,d])=>({...this.nodeMap.get(id),distance:d})).sort((a,b)=>a.distance-b.distance||String(a.label).localeCompare(String(b.label),'zh-CN'));
      const backdrop=document.querySelector('#modal-backdrop'),title=document.querySelector('#modal-title'),body=document.querySelector('#modal-body'),footer=document.querySelector('#modal-footer');if(!backdrop||!body||!footer)return;title.textContent='整理关联 Markdown';body.innerHTML=`<div class="bundle-root"><strong>${esc(root.label)}</strong><span class="badge accent">核心</span></div><div class="graph-bundle-depth"><label><input type="radio" name="opt-bundle-depth" value="1" checked> 一阶</label><label><input type="radio" name="opt-bundle-depth" value="2"> 二阶</label></div><div class="bundle-list" id="opt-bundle-list">${rows.map(x=>`<label class="bundle-item" data-distance="${x.distance}"><input type="checkbox" value="${esc(x.id)}" ${x.distance===1?'checked':''}><span class="badge">${x.distance} 阶</span><span><strong>${esc(x.label)}</strong><br><span class="row-meta">${esc(KIND_LABEL[x.kind]||x.kind)}</span></span></label>`).join('')||'<div class="empty">当前筛选条件下没有关联 Markdown</div>'}</div>`;footer.innerHTML='<button class="secondary-btn" id="opt-bundle-cancel">取消</button><button class="primary-btn" id="opt-bundle-generate">生成 Markdown</button>';backdrop.classList.remove('hidden');
      const apply=()=>{const depth=Number(document.querySelector('input[name="opt-bundle-depth"]:checked')?.value||1);body.querySelectorAll('.bundle-item').forEach(i=>{i.classList.toggle('hidden',Number(i.dataset.distance)>depth);if(Number(i.dataset.distance)>depth)i.querySelector('input').checked=false})};body.querySelectorAll('input[name="opt-bundle-depth"]').forEach(x=>x.onchange=apply);document.querySelector('#opt-bundle-cancel').onclick=()=>backdrop.classList.add('hidden');document.querySelector('#opt-bundle-generate').onclick=async()=>{const depth=Number(document.querySelector('input[name="opt-bundle-depth"]:checked')?.value||1),ids=[...body.querySelectorAll('.bundle-item:not(.hidden) input:checked')].map(x=>x.value),active=[this.selectedId,...ids,...[...dist.entries()].filter(([id,d])=>d<=depth&&this.nodeMap.get(id)?.virtual).map(([id])=>id)],set=new Set(active),relations=this.graph.edges.filter(e=>set.has(String(e.source))&&set.has(String(e.target)));const r=await api('/api/graph/bundle',{method:'POST',body:{root:this.selectedId,selected_ids:ids,active_node_ids:active,relations}});body.innerHTML=`<textarea class="search-input mono" id="opt-bundle-content" style="height:460px">${esc(r.content||'')}</textarea>`;footer.innerHTML='<button class="secondary-btn" id="opt-bundle-copy">复制</button><button class="primary-btn" id="opt-bundle-done">完成</button>';document.querySelector('#opt-bundle-copy').onclick=()=>navigator.clipboard?.writeText(r.content||'');document.querySelector('#opt-bundle-done').onclick=()=>backdrop.classList.add('hidden')};apply();
    }

    animateCameraTo(id){
      const p=this.layout.get(String(id));if(!p){this.requestRender();return}const c=this.camera[this.mode],start={...c},target={...c,zoom:Math.max(c.zoom,1.55)};const projected=this.projectBase(p,target);target.panX=-projected.x;target.panY=-projected.y;const t0=now(),dur=320;const tick=()=>{if(this.destroyed)return;const u=clamp((now()-t0)/dur,0,1),ease=1-Math.pow(1-u,3);c.panX=start.panX+(target.panX-start.panX)*ease;c.panY=start.panY+(target.panY-start.panY)*ease;c.zoom=start.zoom+(target.zoom-start.zoom)*ease;this.requestRender();if(u<1)requestAnimationFrame(tick)};requestAnimationFrame(tick)
    }

    projectBase(p,c){
      if(this.mode==='3d'){const cy=Math.cos(c.rotY),sy=Math.sin(c.rotY),cx=Math.cos(c.rotX),sx=Math.sin(c.rotX);let x=p.x*cy-p.z*sy,z=p.x*sy+p.z*cy,y=p.y*cx-z*sx;z=p.y*sx+z*cx;const ss=560/Math.max(160,560+z);return{x:x*ss*c.zoom,y:y*ss*c.zoom,z,s:ss*c.zoom}}
      return{x:p.x*c.zoom,y:p.y*c.zoom,z:0,s:c.zoom}
    }

    requestRender(){if(this.renderPending||this.destroyed)return;this.renderPending=true;requestAnimationFrame(()=>{this.renderPending=false;this.paint()})}
    paint(){
      if(this.destroyed||!this.canvas.isConnected)return;const rect=this.canvas.getBoundingClientRect();if(rect.width<2||rect.height<2)return;const dpr=Math.min(window.devicePixelRatio||1,2),W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);if(this.canvas.width!==W||this.canvas.height!==H){this.canvas.width=W;this.canvas.height=H}const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);const c=this.camera[this.mode],margin=52;this.screen=new Map();
      for(const n of this.graph.nodes){const base=this.layout.get(String(n.id));if(!base)continue;const p=this.projectBase(base,c);p.x+=w/2+c.panX;p.y+=h/2+c.panY;p.visible=p.x>=-margin&&p.x<=w+margin&&p.y>=-margin&&p.y<=h+margin;this.screen.set(String(n.id),p)}
      const visibleNodes=this.graph.nodes.filter(n=>this.screen.get(String(n.id))?.visible);const nodeCount=this.graph.nodes.length,zoom=c.zoom;this.paintEdges(ctx,w,h,zoom);const sorted=visibleNodes.map(n=>({n,p:this.screen.get(String(n.id))})).sort((a,b)=>a.p.z-b.p.z);const labelCandidates=[];
      for(const {n,p} of sorted){const id=String(n.id),dist=this.focusDistances.get(id),isSel=id===this.selectedId,isSearch=this.searchHits.has(id),alpha=this.nodeAlpha(dist,isSel);if(alpha<=.015)continue;const degree=this.degree.get(id)||0,base=n.virtual?7.5:5.5,rad=clamp((base+(isSel?4:dist===1?2:0))*clamp(p.s,.58,1.8),2.8,16);ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(p.x,p.y,rad,0,Math.PI*2);ctx.fillStyle=n.kind==='project'?css('--accent',KIND_COLOR.project):(KIND_COLOR[n.kind]||css('--accent','#087f8c'));ctx.fill();if(isSel||isSearch){ctx.globalAlpha=1;ctx.strokeStyle=isSel?css('--text','#222'):css('--accent','#087f8c');ctx.lineWidth=isSel?3:2;ctx.stroke()}else if(dist===1){ctx.globalAlpha=.95;ctx.strokeStyle=css('--accent','#087f8c');ctx.lineWidth=1.6;ctx.stroke()}const priority=this.labelPriority(n,id,degree,dist,isSel,isSearch,zoom,nodeCount);if(priority>0)labelCandidates.push({n,p,rad,priority,isSel,dist,isSearch})}
      ctx.globalAlpha=1;this.paintLabels(ctx,labelCandidates,zoom,nodeCount);ctx.globalAlpha=1;
    }

    nodeAlpha(dist,isSel){if(!this.selectedId)return 1;if(isSel)return 1;if(dist===1)return 1;if(dist===2)return this.focusDepth>=2?.55:.16;return .12}
    edgeAlpha(e,zoom){
      const a=String(e.source),b=String(e.target),da=this.focusDistances.get(a),db=this.focusDistances.get(b);if(this.selectedId){if(a===this.selectedId||b===this.selectedId)return 1;if(this.focusDepth>=2&&da!=null&&db!=null&&Math.max(da,db)<=2)return .32;return .025}
      if(zoom<.6)return .06;if(zoom<.9)return .10;if(zoom<1.35)return .16;return .28;
    }
    paintEdges(ctx,w,h,zoom){
      let edges=this.graph.edges;if(!this.selectedId&&zoom<.7&&edges.length>180){const sorted=[...edges].sort((a,b)=>(this.edgeImportance.get(b)||0)-(this.edgeImportance.get(a)||0));edges=sorted.slice(0,Math.max(90,Math.round(edges.length*.24)))}else if(!this.selectedId&&zoom<1&&edges.length>800){edges=[...edges].sort((a,b)=>(this.edgeImportance.get(b)||0)-(this.edgeImportance.get(a)||0)).slice(0,500)}
      for(const e of edges){const a=this.screen.get(String(e.source)),b=this.screen.get(String(e.target));if(!a||!b||(!a.visible&&!b.visible))continue;const alpha=this.edgeAlpha(e,zoom);if(alpha<.01)continue;const direct=this.selectedId&&(String(e.source)===this.selectedId||String(e.target)===this.selectedId);ctx.globalAlpha=alpha;ctx.lineWidth=direct?2.4:1;ctx.strokeStyle=direct?css('--accent','#087f8c'):css('--line-strong','#b7c0c8');ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}ctx.globalAlpha=1;
    }

    labelPriority(n,id,degree,dist,isSel,isSearch,zoom,nodeCount){
      if(isSearch)return 10000;if(isSel)return 9000;if(dist===1)return 8000;if(this.focusDepth>=2&&dist===2&&zoom>=.9)return 7000;if(n.kind==='project')return 5500+degree;if(nodeCount<100&&zoom>=.65)return 4000+degree;if(zoom<.7)return degree>=this.degreeThreshold(.94)?3000+degree:0;if(zoom<1.5){if(degree>=this.degreeThreshold(.82))return 3000+degree;if(n.kind==='tag'&&degree>=3)return 2200+degree;return 0}if(degree>=this.degreeThreshold(.5))return 1800+degree;return n.kind==='tag'?900:1100}
    degreeThreshold(q){if(!this._degreeSorted||this._degreeSorted.length!==this.degree.size)this._degreeSorted=[...this.degree.values()].sort((a,b)=>a-b);if(!this._degreeSorted.length)return 0;return this._degreeSorted[Math.floor((this._degreeSorted.length-1)*q)]||0}
    paintLabels(ctx,candidates,zoom,nodeCount){
      candidates.sort((a,b)=>b.priority-a.priority);const placed=[],limit=nodeCount<100?180:nodeCount<500?(zoom>=1.5?140:70):(zoom>=1.5?110:45);let count=0;
      for(const x of candidates){if(count>=limit&&!x.isSel&&!x.isSearch)break;const text=String(x.n.label||'').slice(0,x.isSel?36:24),fontSize=clamp((x.isSel?12:x.dist===1?11:10)*clamp(zoom,.82,1.28),9,15),weight=(x.isSel||x.dist===1||x.isSearch)?700:500,font=`${weight} ${fontSize}px Microsoft YaHei, sans-serif`;ctx.font=font;const key=`${font}|${text}`;let tw=this.labelWidth.get(key);if(tw==null){tw=ctx.measureText(text).width;this.labelWidth.set(key,tw)}const left=x.p.x+x.rad+4,top=x.p.y-fontSize*.72,rect={l:left-2,t:top-2,r:left+tw+3,b:top+fontSize+4};const collide=!x.isSel&&!x.isSearch&&placed.some(r=>!(rect.r<r.l||rect.l>r.r||rect.b<r.t||rect.t>r.b));if(collide)continue;placed.push(rect);ctx.globalAlpha=x.isSel||x.isSearch?1:(this.selectedId?(x.dist===1?.95:x.dist===2?.62:.2):.78);ctx.fillStyle=x.isSel||x.isSearch?css('--text','#222'):css('--muted','#667');ctx.fillText(text,left,x.p.y+fontSize*.25);count++}ctx.globalAlpha=1;
    }

    hit(x,y){let best=null,bd=24;for(const n of this.graph.nodes){const p=this.screen.get(String(n.id));if(!p?.visible)continue;const d=Math.hypot(x-p.x,y-p.y);if(d<bd){bd=d;best=String(n.id)}}return best}
    bindCanvas(){
      const c=this.canvas;c.oncontextmenu=e=>{if(this.mode==='3d')e.preventDefault()};
      c.onpointerdown=e=>{this.pressNodeId=this.hit(e.offsetX,e.offsetY);this.dragMoved=false;this.drag={x:e.offsetX,y:e.offsetY,mode:(this.mode==='3d'&&(e.altKey||e.button===2))?'rotate':'pan'};c.setPointerCapture?.(e.pointerId)};
      c.onpointermove=e=>{if(!this.drag)return;const dx=e.offsetX-this.drag.x,dy=e.offsetY-this.drag.y;if(Math.hypot(dx,dy)>1)this.dragMoved=true;const cam=this.camera[this.mode];if(this.drag.mode==='rotate'){cam.rotY+=dx*.008;cam.rotX=clamp(cam.rotX+dy*.006,-1.2,1.2)}else{cam.panX+=dx;cam.panY+=dy}this.drag.x=e.offsetX;this.drag.y=e.offsetY;this.requestRender()};
      c.onpointerup=e=>{const id=this.hit(e.offsetX,e.offsetY),wasDrag=this.dragMoved;try{c.releasePointerCapture?.(e.pointerId)}catch{}this.drag=null;if(!wasDrag){if(this.pressNodeId&&id===this.pressNodeId)this.selectNode(id,false);else if(!this.pressNodeId)this.clearFocus(false)}this.pressNodeId=null};
      c.onpointercancel=e=>{this.drag=null;this.pressNodeId=null;try{c.releasePointerCapture?.(e.pointerId)}catch{}};
      c.onwheel=e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const cam=this.camera[this.mode],old=cam.zoom,next=clamp(old*Math.exp(-e.deltaY*.0015),.32,4.5);if(Math.abs(next-old)<1e-4)return;const rect=c.getBoundingClientRect(),cx=e.clientX-rect.left-rect.width/2,cy=e.clientY-rect.top-rect.height/2,localX=(cx-cam.panX)/old,localY=(cy-cam.panY)/old;cam.zoom=next;cam.panX=cx-localX*next;cam.panY=cy-localY*next;this.requestRender()};
    }

    setStatus(text){const el=document.querySelector('#graph-engine-status');if(el)el.textContent=text+(this.layoutStats?.ms?` · 布局 ${this.layoutStats.ms} ms`:'')}
  }
  OptimizedKnowledgeGraph.layoutCache = new Map();

  let instance=null, enhancing=false;
  function replaceCanvas(oldCanvas){const clone=oldCanvas.cloneNode(false);clone.width=oldCanvas.width;clone.height=oldCanvas.height;oldCanvas.replaceWith(clone);return clone}
  async function enhance(){
    if(enhancing||route()!=='graph')return;const old=document.querySelector('#graph-canvas');if(!old||old.dataset.optimizedGraph==='1')return;enhancing=true;try{instance?.destroy();const canvas=replaceCanvas(old);canvas.dataset.optimizedGraph='1';instance=new OptimizedKnowledgeGraph(canvas);window.__knowledgeGraphEngine=instance;await instance.init()}catch(err){console.error('[graph-engine]',err);document.querySelector('#graph-engine-status')?.replaceChildren(document.createTextNode('图谱优化引擎加载失败：'+err.message))}finally{enhancing=false}}
  function maybeEnhance(){if(route()!=='graph'){instance?.destroy();instance=null;return}requestAnimationFrame(enhance)}

  const observer=new MutationObserver(()=>maybeEnhance());
  window.addEventListener('DOMContentLoaded',()=>{observer.observe(document.querySelector('#main')||document.body,{childList:true,subtree:true});maybeEnhance()});
  window.addEventListener('hashchange',()=>setTimeout(maybeEnhance,0));
  window.__knowledgeGraphEngineVersion=VERSION;
})();

(() => {
  'use strict';

  const ROUTE = 'research-overview';
  const MAX_NODES = 80;
  const KIND_COLOR = {idea:'#2a9d8f',journal:'#5b8def',note:'#6f7a8a',milestone:'#c6863b',summary:'#845ec2',literature:'#2673a7',tag:'#b56a9d',project:'#087f8c'};
  const route = () => (location.hash || '#overview').slice(1).split('?')[0];
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const css = (name,fallback='') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  function hashString(s) {
    let h=2166136261>>>0;
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return h>>>0;
  }
  function seeded(seed){
    let x=(seed||1)>>>0;
    x^=x<<13;x^=x>>>17;x^=x<<5;
    return ((x>>>0)%1000000)/1000000;
  }

  class OverviewGraph {
    constructor(canvas, graph) {
      this.canvas=canvas;
      this.ctx=canvas.getContext('2d');
      this.graph=graph||{nodes:[],edges:[]};
      this.nodes=(this.graph.nodes||[]).slice(0,MAX_NODES);
      this.nodeMap=new Map(this.nodes.map(n=>[String(n.id),n]));
      this.edges=(this.graph.edges||[]).filter(e=>this.nodeMap.has(String(e.source))&&this.nodeMap.has(String(e.target)));
      this.adj=new Map(this.nodes.map(n=>[String(n.id),[]]));
      this.degree=new Map(this.nodes.map(n=>[String(n.id),0]));
      this.layout=new Map();
      this.screen=new Map();
      this.labelWidths=new Map();
      this.camera={panX:0,panY:0,zoom:1};
      this.drag=null;
      this.dragMoved=false;
      this.pressId=null;
      this.renderPending=false;
      this.destroyed=false;
      this.buildIndex();
      this.layoutGraph();
      this.fit();
      this.bind();
      this.resizeObserver=new ResizeObserver(()=>{this.fit(false);this.requestRender()});
      this.resizeObserver.observe(canvas);
      this.requestRender();
    }

    destroy(){this.destroyed=true;try{this.resizeObserver?.disconnect()}catch{}}

    buildIndex(){
      for(const e of this.edges){
        const a=String(e.source),b=String(e.target);
        this.adj.get(a)?.push(b);this.adj.get(b)?.push(a);
        this.degree.set(a,(this.degree.get(a)||0)+1);
        this.degree.set(b,(this.degree.get(b)||0)+1);
      }
      this.degreeSorted=[...this.degree.values()].sort((a,b)=>a-b);
    }

    communities(){
      const ids=this.nodes.map(n=>String(n.id));
      const c=new Map(ids.map((id,i)=>[id,i]));
      if(ids.length<18)return c;
      for(let it=0;it<5;it++){
        let changed=0;
        for(const id of ids){
          const scores=new Map();
          for(const nb of this.adj.get(id)||[]){const x=c.get(nb);scores.set(x,(scores.get(x)||0)+1)}
          if(!scores.size)continue;
          let best=c.get(id),score=-1;
          for(const [k,v] of scores){if(v>score||(v===score&&k<best)){best=k;score=v}}
          if(best!==c.get(id)){c.set(id,best);changed++}
        }
        if(!changed)break;
      }
      const remap=new Map();let next=0;
      for(const id of ids){const x=c.get(id);if(!remap.has(x))remap.set(x,next++);c.set(id,remap.get(x))}
      return c;
    }

    layoutGraph(){
      const n=this.nodes.length;if(!n)return;
      const community=this.communities();
      const count=Math.max(1,new Set(community.values()).size);
      const centers=new Map();
      for(let i=0;i<count;i++){const a=i/count*Math.PI*2;centers.set(i,{x:Math.cos(a)*230,y:Math.sin(a)*160})}
      for(const node of this.nodes){
        const id=String(node.id),seed=hashString(id),center=centers.get(community.get(id)||0)||{x:0,y:0},a=seeded(seed)*Math.PI*2,r=24+70*seeded(seed^0x9e3779b9);
        this.layout.set(id,{x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r});
      }
      const ids=this.nodes.map(n=>String(n.id));
      const iterations=n<40?110:80;
      for(let step=0;step<iterations;step++){
        const delta=new Map(ids.map(id=>[id,{x:0,y:0}]));
        const cool=.9*(1-step/iterations)+.1;
        for(const e of this.edges){
          const a=String(e.source),b=String(e.target),pa=this.layout.get(a),pb=this.layout.get(b);if(!pa||!pb)continue;
          let dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.hypot(dx,dy)||1;
          const target=e.relation==='tag'?75:e.relation==='project'?88:105,f=(d-target)*.014;
          dx/=d;dy/=d;delta.get(a).x+=dx*f;delta.get(a).y+=dy*f;delta.get(b).x-=dx*f;delta.get(b).y-=dy*f;
        }
        for(let i=0;i<ids.length;i++){
          const id=ids[i],p=this.layout.get(id),d=delta.get(id);
          for(let j=i+1;j<ids.length;j++){
            const qid=ids[j],q=this.layout.get(qid);let dx=p.x-q.x,dy=p.y-q.y,ds=dx*dx+dy*dy+64,dist=Math.sqrt(ds),f=Math.min(2.2,620/ds);dx/=dist;dy/=dist;
            d.x+=dx*f;d.y+=dy*f;delta.get(qid).x-=dx*f;delta.get(qid).y-=dy*f;
          }
          const center=centers.get(community.get(id)||0)||{x:0,y:0};
          d.x+=(center.x-p.x)*.0025-p.x*.0007;d.y+=(center.y-p.y)*.0025-p.y*.0007;
        }
        for(const id of ids){const p=this.layout.get(id),d=delta.get(id),mag=Math.hypot(d.x,d.y),cap=7*cool,s=mag>cap?cap/mag:1;p.x+=d.x*s;p.y+=d.y*s}
      }
    }

    fit(resetPan=true){
      const rect=this.canvas.getBoundingClientRect();if(rect.width<20||rect.height<20||!this.layout.size)return;
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for(const p of this.layout.values()){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)}
      const spanX=Math.max(1,maxX-minX),spanY=Math.max(1,maxY-minY);
      this.camera.zoom=clamp(Math.min((rect.width-70)/spanX,(rect.height-60)/spanY),.5,1.45);
      if(resetPan){this.camera.panX=-(minX+maxX)/2*this.camera.zoom;this.camera.panY=-(minY+maxY)/2*this.camera.zoom}
    }

    threshold(q){if(!this.degreeSorted.length)return 0;return this.degreeSorted[Math.floor((this.degreeSorted.length-1)*q)]||0}
    requestRender(){if(this.renderPending||this.destroyed)return;this.renderPending=true;requestAnimationFrame(()=>{this.renderPending=false;this.paint()})}

    paint(){
      if(this.destroyed||!this.canvas.isConnected)return;
      const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);
      if(this.canvas.width!==W||this.canvas.height!==H){this.canvas.width=W;this.canvas.height=H}
      const ctx=this.ctx,w=rect.width,h=rect.height;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);this.screen.clear();
      for(const n of this.nodes){const p=this.layout.get(String(n.id));if(!p)continue;this.screen.set(String(n.id),{x:w/2+this.camera.panX+p.x*this.camera.zoom,y:h/2+this.camera.panY+p.y*this.camera.zoom})}
      const zoom=this.camera.zoom;
      let edges=this.edges;
      if(zoom<.75&&edges.length>120)edges=[...edges].sort((a,b)=>((this.degree.get(String(b.source))||0)+(this.degree.get(String(b.target))||0))-((this.degree.get(String(a.source))||0)+(this.degree.get(String(a.target))||0))).slice(0,Math.max(70,Math.round(edges.length*.35)));
      ctx.strokeStyle=css('--line-strong','#bcc8ca');ctx.lineWidth=1;
      for(const e of edges){const a=this.screen.get(String(e.source)),b=this.screen.get(String(e.target));if(!a||!b)continue;ctx.globalAlpha=zoom<.8?.09:.16;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      ctx.globalAlpha=1;
      const labels=[];
      for(const n of this.nodes){
        const id=String(n.id),p=this.screen.get(id);if(!p||p.x<-30||p.x>w+30||p.y<-30||p.y>h+30)continue;
        const deg=this.degree.get(id)||0,rad=n.virtual?5.5:4.5;
        ctx.beginPath();ctx.arc(p.x,p.y,rad,0,Math.PI*2);ctx.fillStyle=KIND_COLOR[n.kind]||css('--accent','#087f83');ctx.fill();
        const priority=n.kind==='project'?900+deg:n.kind==='tag'?500+deg:deg>=this.threshold(.78)?700+deg:zoom>=1.15?300+deg:0;
        if(priority>0)labels.push({n,p,rad,priority});
      }
      labels.sort((a,b)=>b.priority-a.priority);const placed=[];let shown=0,maxLabels=zoom<.75?12:zoom<1.15?22:36;
      for(const x of labels){if(shown>=maxLabels)break;const text=String(x.n.label||'').slice(0,18),font=`${x.n.kind==='project'?'700':'500'} 10px Microsoft YaHei, sans-serif`;ctx.font=font;const key=font+'|'+text;let width=this.labelWidths.get(key);if(width==null){width=ctx.measureText(text).width;this.labelWidths.set(key,width)}const left=x.p.x+x.rad+4,box={l:left-2,t:x.p.y-8,r:left+width+3,b:x.p.y+7};if(placed.some(r=>!(box.r<r.l||box.l>r.r||box.b<r.t||box.t>r.b)))continue;placed.push(box);ctx.globalAlpha=.78;ctx.fillStyle=css('--muted','#68777c');ctx.fillText(text,left,x.p.y+3);shown++}
      ctx.globalAlpha=1;
    }

    hit(x,y){let best=null,dist=18;for(const n of this.nodes){const p=this.screen.get(String(n.id));if(!p)continue;const d=Math.hypot(x-p.x,y-p.y);if(d<dist){dist=d;best=String(n.id)}}return best}
    bind(){
      const c=this.canvas;c.style.cursor='grab';
      c.onpointerdown=e=>{this.pressId=this.hit(e.offsetX,e.offsetY);this.dragMoved=false;this.drag={x:e.offsetX,y:e.offsetY};c.setPointerCapture?.(e.pointerId)};
      c.onpointermove=e=>{if(!this.drag)return;const dx=e.offsetX-this.drag.x,dy=e.offsetY-this.drag.y;if(Math.hypot(dx,dy)>1)this.dragMoved=true;this.camera.panX+=dx;this.camera.panY+=dy;this.drag.x=e.offsetX;this.drag.y=e.offsetY;c.style.cursor='grabbing';this.requestRender()};
      c.onpointerup=e=>{const id=this.hit(e.offsetX,e.offsetY),moved=this.dragMoved;try{c.releasePointerCapture?.(e.pointerId)}catch{}this.drag=null;c.style.cursor='grab';if(!moved&&id&&id===this.pressId)this.openFullGraph(id);this.pressId=null};
      c.onpointercancel=e=>{this.drag=null;this.pressId=null;c.style.cursor='grab';try{c.releasePointerCapture?.(e.pointerId)}catch{}};
      c.onwheel=e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const old=this.camera.zoom,next=clamp(old*Math.exp(-e.deltaY*.0015),.4,3);const r=c.getBoundingClientRect(),cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2,lx=(cx-this.camera.panX)/old,ly=(cy-this.camera.panY)/old;this.camera.zoom=next;this.camera.panX=cx-lx*next;this.camera.panY=cy-ly*next;this.requestRender()};
    }

    openFullGraph(id){
      sessionStorage.setItem('erw:pending-graph-focus',id);
      location.hash='graph';
      focusWhenReady();
    }
  }

  let instance=null,loading=false;
  async function enhance(){
    if(loading||route()!==ROUTE)return;
    const old=document.querySelector('#overview-graph');
    if(!old||old.dataset.modernOverviewGraph==='1')return;
    loading=true;
    try{
      const res=await fetch(`/api/graph/overview?limit=${MAX_NODES}`);if(!res.ok)throw new Error(`HTTP ${res.status}`);const graph=await res.json();
      if(route()!==ROUTE||!old.isConnected)return;
      instance?.destroy();
      const canvas=old.cloneNode(false);canvas.dataset.modernOverviewGraph='1';canvas.setAttribute('aria-label','新版知识关系预览');old.replaceWith(canvas);
      instance=new OverviewGraph(canvas,graph);
      window.__overviewKnowledgeGraph=instance;
    }catch(err){console.warn('[overview-graph]',err)}finally{loading=false}
  }

  function focusWhenReady(){
    if(route()!=='graph')return;
    const id=sessionStorage.getItem('erw:pending-graph-focus');if(!id)return;
    let tries=0;const timer=setInterval(()=>{
      tries++;
      const engine=window.__knowledgeGraphEngine;
      if(engine?.nodeMap?.has?.(id)){clearInterval(timer);sessionStorage.removeItem('erw:pending-graph-focus');engine.selectNode(id,true)}
      else if(tries>50){clearInterval(timer)}
    },60);
  }

  function schedule(){
    if(route()!==ROUTE){instance?.destroy();instance=null;focusWhenReady();return}
    requestAnimationFrame(enhance);
  }

  const observer=new MutationObserver(schedule);
  window.addEventListener('DOMContentLoaded',()=>{observer.observe(document.querySelector('#main')||document.body,{childList:true,subtree:true});schedule()});
  window.addEventListener('hashchange',()=>setTimeout(schedule,0));
})();

(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const route=()=> (location.hash||'#overview').slice(1).split('?')[0];
  async function api(url,opts={}){const init={...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}};if(init.body&&typeof init.body!=='string')init.body=JSON.stringify(init.body);const r=await fetch(url,init);let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d}
  function toast(msg,bad=false){const root=$('#toast-stack');if(!root)return;const el=document.createElement('div');el.className='toast'+(bad?' error':'');el.textContent=msg;root.appendChild(el);setTimeout(()=>el.remove(),3200)}

  function installSidebarToggle(){
    const top=$('.topbar');if(!top||$('#sidebar-toggle'))return;
    const btn=document.createElement('button');btn.id='sidebar-toggle';btn.className='sidebar-toggle-btn';btn.type='button';btn.title='收起 / 展开侧边栏';btn.setAttribute('aria-label','收起 / 展开侧边栏');btn.textContent='☰';
    top.insertBefore(btn,top.firstChild);
    const saved=localStorage.getItem('sidebarCollapsed')==='1';document.body.classList.toggle('sidebar-collapsed',saved);
    const sync=()=>{const c=document.body.classList.contains('sidebar-collapsed');btn.textContent=c?'☰':'⇤';btn.title=c?'展开侧边栏':'收起侧边栏';btn.setAttribute('aria-expanded',String(!c))};
    btn.onclick=()=>{document.body.classList.toggle('sidebar-collapsed');localStorage.setItem('sidebarCollapsed',document.body.classList.contains('sidebar-collapsed')?'1':'0');sync()};sync();
  }

  let managerState=null;
  async function renderProfileManager(){
    const panel=$('#settings-panel');if(!panel||route()!=='settings')return;
    const cfg=await api('/api/config');const app=cfg.app||{},llm=app.llm||{};const profiles=JSON.parse(JSON.stringify(llm.profiles||[]));
    if(!profiles.length)return;
    managerState={cfg,app,llm,profiles,activeId:llm.active_profile_id||profiles[0].id,selectedId:llm.active_profile_id||profiles[0].id,openModes:{}}; /* v260929d · openModes：每个配置下展开编辑的请求模式 id 集合（默认全部收起省空间） */
    paintManagerShell(panel);paintProfileEditor();
  }
  function paintManagerShell(panel){
    const s=managerState;
    panel.innerHTML=`<div class="card-head"><div><div class="card-kicker">OPENAI COMPATIBLE PROFILES</div><h3>Agent API 配置</h3><p class="row-meta">多套配置保存在本地 config/secret.json；系统提示词统一保存在 app.json。只使用 OpenAI-compatible Chat Completions。</p></div><button class="secondary-btn" id="goto-personas" title="跳转到 AI 助手人设编辑器（修改提示词 / 新增人设 / 工具权限）">AI 助手人设 ↓</button></div>
    <div class="agent-profile-settings"><aside class="agent-profile-list"><div class="agent-profile-list-head"><h4>配置列表</h4><button class="primary-btn" id="profile-add">＋</button></div><div class="agent-profile-items" id="profile-items"></div></aside><section class="agent-profile-editor" id="profile-editor"></section></div>
    <div class="field" style="margin-top:14px"><label>统一系统提示词</label><textarea id="global-system-prompt" style="min-height:120px">${esc(s.llm.system_prompt||'')}</textarea><p class="row-meta">对所有模型请求生效的全局提示词；悬浮球 AI 助手的角色化提示词（阅读助手 / 执行助手 / 术语建档员等）在下方「AI 助手人设」卡片中单独配置。</p></div>
    <div class="agent-settings-footer"><div class="left"><label class="badge"><input type="checkbox" id="agent-enabled" ${s.llm.enabled?'checked':''}> 启用 Agent</label><label class="badge"><input type="checkbox" id="llm-vision-global" ${s.llm.vision_enabled?'checked':''}> 多模态 / 截图识别</label><span class="row-meta">开启后阅读区 AI 面板可用「截取当前页 / 框选区域」代替选中文本；需模型支持图片输入（如 qwen-vl / gpt-4o 系列）。</span></div><button class="primary-btn" id="profile-save-all">保存全部配置</button></div>`;
    $('#profile-add').onclick=()=>{const id='profile-'+Date.now();s.profiles.push({id,name:'未命名配置',base_url:'https://api.openai.com/v1',has_api_key:false,headers:{},timeout:120,max_output_tokens:0,temperature:null,show_reasoning:true,default_request_preset:'default',request_presets:[{id:'default',label:'默认',model:'',temperature:null,params:{}}]});s.selectedId=id;paintProfileList();paintProfileEditor()};
    $('#goto-personas').onclick=()=>$('#erw-persona-host')?.scrollIntoView({behavior:'smooth',block:'start'}); /* v260930g2 · 跳转 AI 助手人设编辑器 */
    $('#profile-save-all').onclick=saveAllProfiles;paintProfileList();
    /* v260930 · M3 人设编辑器宿主：渲染完本面板后挂宿主节点并广播事件，由 v260930-floating-agent.js 填充（保存 API 配置会整页重渲染，事件随之重发，编辑器自动重建） */
    panel.insertAdjacentHTML('beforeend','<div id="erw-persona-host"></div>');
    document.dispatchEvent(new CustomEvent('erw-llm-settings-rendered'));
  }
  function paintProfileList(){
    const s=managerState,root=$('#profile-items');if(!root)return;root.innerHTML=s.profiles.map(p=>`<button class="agent-profile-item ${p.id===s.selectedId?'active':''}" data-profile-id="${esc(p.id)}"><span class="profile-state"><span class="profile-dot ${p.id===s.activeId?'on':''}"></span><strong>${esc(p.name||'未命名配置')}</strong></span><small>${esc(p.base_url||'')} · ${(p.request_presets||[]).length} 模式</small></button>`).join('');$$('[data-profile-id]',root).forEach(b=>b.onclick=()=>{captureEditor();s.selectedId=b.dataset.profileId;paintProfileList();paintProfileEditor()})
  }
  function selectedProfile(){return managerState?.profiles.find(p=>p.id===managerState.selectedId)}
  function paintProfileEditor(){
    const p=selectedProfile(),root=$('#profile-editor');if(!p||!root)return;const modes=p.request_presets||[];
    root.innerHTML=`<div class="agent-profile-editor-head"><div><div class="card-kicker">PROFILE</div><h3>${esc(p.name||'未命名配置')}</h3></div><div class="agent-profile-editor-actions"><button class="secondary-btn" id="profile-activate">${p.id===managerState.activeId?'当前已激活':'设为当前配置'}</button><button class="secondary-btn" id="profile-test">测试连接</button><button class="ghost-btn danger" id="profile-delete" ${managerState.profiles.length<=1?'disabled':''}>删除</button></div></div>
    <div class="agent-profile-grid">
      <div class="field span-2"><label>配置名称</label><input id="pf-name" value="${esc(p.name||'')}"></div>
      <div class="field span-2"><label>Base URL</label><input id="pf-base" value="${esc(p.base_url||'')}"></div>
      <div class="field span-2"><label>API Key</label><input id="pf-key" type="password" placeholder="${p.has_api_key?'已保存；留空则保持原 Key':'输入 API Key'}"></div>
      <div class="field"><label>超时 / 秒</label><input id="pf-timeout" type="number" min="5" max="600" value="${Number(p.timeout||120)}"></div>
      <div class="field"><label>最大输出 tokens</label><input id="pf-max" type="number" min="0" value="${Number(p.max_output_tokens||0)}"></div>
      <div class="field"><label>默认 Temperature</label><input id="pf-temp" type="number" min="0" max="2" step="0.1" value="${p.temperature==null?'':p.temperature}" placeholder="留空 = 不发送"></div>
      <div class="field"><label>思考过程</label><select id="pf-reason"><option value="1" ${p.show_reasoning!==false?'selected':''}>显示</option><option value="0" ${p.show_reasoning===false?'selected':''}>隐藏</option></select></div>
      <div class="field span-2"><label>自定义请求头（JSON，留空即不加）</label><textarea class="search-input" id="pf-headers" style="min-height:72px" placeholder='{"x-opencode-session":"ses_xxx"}'>${esc(JSON.stringify(p.headers&&Object.keys(p.headers).length?p.headers:{},null,2))}</textarea><p class="row-meta">按配置附加的 HTTP 请求头。例：直连 opencode.ai Zen Go 必须带 <code>x-opencode-session</code>（缺它上游返回 400）；<code>Authorization</code> 与 <code>Content-Type</code> 由工作台接管，写在这里也不生效。</p></div>
    </div><div class="agent-secret-note">Key 仅保存在本机 config/secret.json。仓库 .gitignore 已忽略整个 config/ 目录。</div>
    <div class="agent-mode-section"><div class="agent-mode-head"><div><h4>请求模式</h4><span class="row-meta">每个模式保存 id、label、模型名、可选 temperature 和 params。</span></div><button class="secondary-btn" id="mode-add">＋ 新增模式</button></div><div class="agent-mode-list" id="mode-list">${modes.map(modeRow).join('')}</div></div>`;
    $('#profile-activate').onclick=()=>{captureEditor();managerState.activeId=p.id;paintProfileList();paintProfileEditor()};
    $('#profile-delete').onclick=()=>{if(managerState.profiles.length<=1)return;managerState.profiles=managerState.profiles.filter(x=>x.id!==p.id);if(managerState.activeId===p.id)managerState.activeId=managerState.profiles[0].id;managerState.selectedId=managerState.profiles[0].id;paintProfileList();paintProfileEditor()};
    $('#mode-add').onclick=()=>{captureEditor();p.request_presets.push({id:'mode-'+(p.request_presets.length+1),label:'新模式',model:'',temperature:null,params:{}});const nm=p.request_presets[p.request_presets.length-1];(managerState.openModes[p.id]||(managerState.openModes[p.id]=new Set())).add(nm.id);paintProfileEditor()}; /* v260929d · 新增模式自动展开 */
    $('#profile-test').onclick=async()=>{try{captureEditor();managerState.activeId=p.id;await saveAllProfiles(false);const r=await api('/api/agent/test',{method:'POST',body:{}});toast(r.models?.length?`连接成功：${r.models.slice(0,3).join(' / ')}`:'连接成功')}catch(e){toast(e.message,true)}};
    wireModeDeletes();
  }
  function modeRow(m,i){const pid=selectedProfile()?.id,open=!!managerState.openModes?.[pid]?.has(m.id);return `<div class="agent-mode-row${open?' open':''}" data-mode-row="${i}"><input class="search-input" data-mode-id value="${esc(m.id||'')}" placeholder="id"><input class="search-input" data-mode-label value="${esc(m.label||'')}" placeholder="label"><input class="search-input" data-mode-model value="${esc(m.model||'')}" placeholder="模型名"><label class="mode-default"><input type="radio" name="mode-default" value="${esc(m.id||'')}" ${m.id===selectedProfile()?.default_request_preset?'checked':''}> 默认</label><button class="ghost-btn mode-toggle" type="button" data-mode-toggle="${i}" title="${open?'收起':'展开'}">${open?'▾':'▸'}</button><div class="agent-mode-body"><input class="search-input" data-mode-temp type="number" min="0" max="2" step="0.1" value="${m.temperature==null?'':m.temperature}" placeholder="温度"><button class="ghost-btn danger mode-delete" type="button" data-mode-delete="${i}">删除</button><textarea class="search-input mode-params" data-mode-params placeholder='{"reasoning_effort":"low"}'>${esc(JSON.stringify(m.params||{},null,2))}</textarea></div></div>`} /* v260929d · 模式行折叠：头部只留 id/label/模型/默认/▸，温度与 params 藏进 body（DOM 常驻，captureEditor 仍可读到） */
  function wireModeDeletes(){$$('[data-mode-toggle]').forEach(b=>b.onclick=()=>{const p=selectedProfile();const set=managerState.openModes[p.id]||(managerState.openModes[p.id]=new Set());const id=$(`[data-mode-row="${b.dataset.modeToggle}"] [data-mode-id]`)?.value.trim()||p.request_presets[Number(b.dataset.modeToggle)]?.id;if(id)set.has(id)?set.delete(id):set.add(id);paintProfileEditor()});$$('[data-mode-delete]').forEach(b=>b.onclick=()=>{captureEditor();const p=selectedProfile();p.request_presets.splice(Number(b.dataset.modeDelete),1);if(!p.request_presets.length)p.request_presets=[{id:'default',label:'默认',model:'',temperature:null,params:{}}];if(!p.request_presets.some(x=>x.id===p.default_request_preset))p.default_request_preset=p.request_presets[0].id;paintProfileEditor()})}
  function captureEditor(){
    const p=selectedProfile();if(!p||!$('#pf-name'))return;
    p.name=$('#pf-name').value.trim()||'未命名配置';p.base_url=$('#pf-base').value.trim();const key=$('#pf-key').value.trim();if(key)p.api_key=key;p.timeout=Math.max(5,Math.min(600,Number($('#pf-timeout').value)||120));p.max_output_tokens=Math.max(0,Number($('#pf-max').value)||0);p.temperature=$('#pf-temp').value.trim()===''?null:Number($('#pf-temp').value);p.show_reasoning=$('#pf-reason').value==='1';let hdr={};try{hdr=JSON.parse($('#pf-headers')?.value||'{}')}catch{throw new Error('自定义请求头必须是合法 JSON 对象')}if(!hdr||Array.isArray(hdr)||typeof hdr!=='object')throw new Error('自定义请求头必须是 JSON 对象');p.headers=hdr; /* v261008 · 档案级自定义请求头（直连 Zen Go 等网关用） */
    const modes=[];$$('[data-mode-row]').forEach(r=>{let params={};try{params=JSON.parse($('[data-mode-params]',r).value||'{}')}catch{throw new Error('请求模式 params 必须是合法 JSON 对象')}if(!params||Array.isArray(params)||typeof params!=='object')throw new Error('请求模式 params 必须是 JSON 对象');const id=$('[data-mode-id]',r).value.trim();if(!id)throw new Error('请求模式 id 不能为空');modes.push({id,label:$('[data-mode-label]',r).value.trim()||id,model:$('[data-mode-model]',r).value.trim(),temperature:$('[data-mode-temp]',r).value.trim()===''?null:Number($('[data-mode-temp]',r).value),params})});
    const ids=new Set();for(const m of modes){if(ids.has(m.id))throw new Error('请求模式 id 不能重复：'+m.id);ids.add(m.id)}p.request_presets=modes;const checked=$('input[name="mode-default"]:checked');p.default_request_preset=checked?.value||modes[0]?.id||'default';
  }
  async function saveAllProfiles(notify=true){
    try{captureEditor();const s=managerState;s.app.llm={...s.app.llm,enabled:$('#agent-enabled')?.checked===true,vision_enabled:$('#llm-vision-global')?.checked===true,system_prompt:$('#global-system-prompt')?.value||'',active_profile_id:s.activeId,profiles:s.profiles};const saved=await api('/api/config/app',{method:'POST',body:s.app});window.ERWConfigSync?.(saved); /* v260929d · 回写主应用 state.config，多模态开关等免刷新生效 */s.cfg.app=saved;s.app=saved;s.llm=saved.llm||{};s.profiles=JSON.parse(JSON.stringify(s.llm.profiles||[]));s.activeId=s.llm.active_profile_id||s.profiles[0]?.id;s.selectedId=s.activeId;paintManagerShell($('#settings-panel'));paintProfileEditor();if(notify)toast('Agent 配置已保存')}catch(e){toast(e.message,true);throw e}
  }

  async function enhanceAgentPage(){
    if(route()!=='agent')return;const preset=$('#agent-preset');if(!preset||$('#agent-profile-select'))return;const cfg=await api('/api/config');const llm=cfg.app?.llm||{},profiles=llm.profiles||[];if(!profiles.length)return;
    /* v261008c · 徽标改为显示「接口地址主机」而不是把选中项名字重复一遍：
       select 里已经有配置名，这里给的是 直连(域名) / 本地反代理(127.0.0.1:9355) / 方舟 这类一眼可辨的信息 */
    const hostOf=p=>{try{return new URL(p?.base_url||'').host||'—'}catch{return String(p?.base_url||'').replace(/^https?:\/\//,'').split('/')[0]||'—'}};
    const active0=profiles.find(p=>p.id===llm.active_profile_id)||profiles[0];
    const wrap=document.createElement('div');wrap.className='agent-runtime-selects';wrap.innerHTML=`<label>API 配置 <select class="search-input" id="agent-profile-select">${profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===llm.active_profile_id?'selected':''}>${esc(p.name||'未命名配置')}</option>`).join('')}</select></label><span class="agent-profile-badge" id="agent-profile-badge" title="接口地址：${esc(active0?.base_url||'')}">${esc(hostOf(active0))}</span>`;
    preset.closest('.agent-preset-label')?.parentElement?.insertBefore(wrap,preset.closest('.agent-preset-label'));
    $('#agent-profile-select').onchange=async()=>{const fresh=await api('/api/config');fresh.app.llm.active_profile_id=$('#agent-profile-select').value;const saved=await api('/api/config/app',{method:'POST',body:fresh.app});const active=saved.llm?.profiles?.find(p=>p.id===saved.llm.active_profile_id);const badge=$('#agent-profile-badge');if(badge){badge.textContent=hostOf(active);badge.title='接口地址：'+(active?.base_url||'')}const modes=active?.request_presets||[];preset.innerHTML=modes.map((m,i)=>`<option value="${esc(m.id)}" ${m.id===active?.default_request_preset||(!active?.default_request_preset&&i===0)?'selected':''}>${esc(m.label||m.id)}</option>`).join('');preset.dispatchEvent(new Event('change',{bubbles:true}));toast('已切换 Agent API 配置')};
  }

  function onSettingsClick(e){const btn=e.target.closest('[data-set-tab="llm"]');if(!btn)return;setTimeout(()=>renderProfileManager().catch(err=>toast(err.message,true)),0)}
  const observer=new MutationObserver(()=>{installSidebarToggle();if(route()==='agent')enhanceAgentPage().catch(()=>{})});
  window.addEventListener('DOMContentLoaded',()=>{installSidebarToggle();document.addEventListener('click',onSettingsClick);observer.observe(document.body,{childList:true,subtree:true});if(route()==='agent')enhanceAgentPage().catch(()=>{})});
  window.addEventListener('hashchange',()=>setTimeout(()=>{installSidebarToggle();if(route()==='agent')enhanceAgentPage().catch(()=>{})},0));
})();
