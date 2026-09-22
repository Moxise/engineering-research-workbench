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

  function limitOverviewRows(ops){
    if(!ops)return;
    const cards=[...ops.children];
    [1,2].forEach(i=>{
      const card=cards[i]; if(!card)return;
      qsa('.list-row',card).forEach((row,index)=>row.hidden=index>=4);
    });
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
    dashboard.dataset.layoutEnhanced='1';
  }

  let scheduled=false;
  function enhance(){scheduled=false;enhanceOverviewLayout();injectEditorZoomControls();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(enhance);}
  function start(){const main=qs('#main');if(!main)return;new MutationObserver(schedule).observe(main,{childList:true,subtree:true});schedule();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
