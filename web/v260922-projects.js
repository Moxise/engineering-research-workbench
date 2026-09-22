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
