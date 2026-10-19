/* Agent system control center: background runs, sourced memory, skills, settings. */
(()=>{
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $=(s,r=document)=>r.querySelector(s);
  const labels={queued:'排队中',running:'执行中',pausing:'正在停止',paused:'已暂停',interrupted:'执行中断',waiting_approval:'等待确认',completed:'已完成',failed:'失败',cancelled:'已停止'};
  let overlay=null,tab='runs',timer=null,selected='',cursor=0,log=[],lastFocus=null;
  async function api(path,body){const r=await fetch('/api/agent/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||r.status);return d}
  const toast=(s,bad=false)=>window.ERWToast?.(s,bad);
  function close(){clearInterval(timer);timer=null;overlay?.remove();overlay=null;lastFocus?.focus()}
  function open(initial='runs'){
    if(overlay){tab=initial;load();return}
    lastFocus=document.activeElement;tab=initial;
    overlay=document.createElement('div');overlay.className='agent-system-overlay';
    overlay.innerHTML=`<section class="agent-system" role="dialog" aria-modal="true" aria-labelledby="as-title"><header><div><h2 id="as-title">Agent 系统</h2><p>任务、记忆与科研技能</p></div><button type="button" aria-label="关闭 Agent 系统" data-as-close>×</button></header><nav aria-label="Agent 系统栏目">${[['runs','任务'],['memory','记忆'],['skills','技能'],['settings','设置与连接']].map(([id,t])=>`<button type="button" data-as-tab="${id}">${t}</button>`).join('')}</nav><div class="as-content" aria-live="polite"></div></section>`;
    document.body.append(overlay);
    $('[data-as-close]',overlay).onclick=close;
    overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
    overlay.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();close();return}
      if(e.key==='Tab'){const a=[...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(x=>!x.disabled&&x.offsetParent!==null);if(!a.length)return;if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0].focus()}}
    });
    overlay.querySelectorAll('[data-as-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.asTab;selected='';load()});
    $('[data-as-close]',overlay).focus();load();
    timer=setInterval(()=>{if(overlay&&tab==='runs')refreshRuns().catch(()=>{})},2500);
  }
  async function load(){
    if(!overlay)return;
    overlay.querySelectorAll('[data-as-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.asTab===tab)));
    const root=$('.as-content',overlay);root.innerHTML='<p>正在载入…</p>';
    try{if(tab==='runs')await runs(root);else if(tab==='memory')await memory(root);else if(tab==='skills')await skills(root);else await settings(root)}catch(e){root.innerHTML=`<p class="as-error">${esc(e.message)}</p>`}
  }
  async function runs(root){
    const [sessions,cfg]=await Promise.all([api('sessions'),fetch('/api/config').then(r=>r.json())]);
    root.innerHTML=`<form class="as-form" id="as-run-form"><label>任务目标<textarea name="message" rows="3" required placeholder="例如：使用 $literature-review 对比知识库中的相关文献，并给出带来源的结论"></textarea></label><div class="as-row"><label>会话<select name="session_id"><option value="">新建会话</option>${sessions.filter(s=>!s.archived).map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></label><label>助手<select name="persona_id">${(cfg.app?.llm?.personas||[]).map(p=>`<option value="${esc(p.id)}" ${p.id==='executor'?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><button type="submit" class="primary-btn">开始任务</button></div><p class="as-hint">任务在后台执行。写入草稿确认后，可继续同一个任务。</p></form><div id="as-runs-list"></div><section id="as-run-detail"></section>`;
    const projectLabel=document.createElement('label');projectLabel.textContent='项目范围（可选，用于检索项目记忆）';const projectInput=document.createElement('input');projectInput.name='project_id';projectInput.placeholder='项目名称或稳定标识';projectLabel.append(projectInput);$('#as-run-form .as-row',root).before(projectLabel);
    $('#as-run-form',root).onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const b=$('button[type=submit]',form);b.disabled=true;try{const data=Object.fromEntries(new FormData(form));data.context={project_id:data.project_id};delete data.project_id;const r=await api('runs',data);selected=r.id;cursor=0;log=[];form.message.value='';await refreshRuns();toast('任务已启动')}catch(err){toast(err.message,true)}finally{b.disabled=false}};
    await refreshRuns();
  }
  async function refreshRuns(){
    if(!overlay||tab!=='runs')return;
    const root=$('#as-runs-list',overlay);if(!root)return;
    const rows=await api('runs');
    if(!overlay||tab!=='runs')return;
    root.innerHTML=rows.length?rows.map(r=>`<article class="as-run"><button type="button" class="as-run-title" data-as-run="${esc(r.id)}"><strong>${esc(r.id.slice(0,16))}</strong><small>${esc(r.updated)}</small></button><span class="as-status" data-state="${esc(r.status)}">${labels[r.status]||esc(r.status)}</span><div class="as-actions">${['running','queued'].includes(r.status)?`<button type="button" data-as-control="pause" data-id="${r.id}">暂停</button><button type="button" data-as-control="cancel" data-id="${r.id}">停止</button>`:''}${['paused','interrupted','waiting_approval','failed'].includes(r.status)?`<button type="button" data-as-control="resume" data-id="${r.id}">继续</button>`:''}</div>${r.error?`<p class="as-error">${esc(r.error)}</p>`:''}</article>`).join(''):'<p class="as-hint">暂无任务，普通对话也会自动出现在这里。</p>';
    root.querySelectorAll('[data-as-run]').forEach(b=>b.onclick=()=>{selected=b.dataset.asRun;cursor=0;log=[];detail().catch(e=>toast(e.message,true))});
    root.querySelectorAll('[data-as-control]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('runs/'+b.dataset.id+'/'+b.dataset.asControl,{});await refreshRuns()}catch(e){toast(e.message,true)}finally{b.disabled=false}});
    if(selected)await detail();
  }
  async function detail(){
    const root=overlay&&$('#as-run-detail',overlay);if(!root||!selected)return;
    const id=selected;
    const [run,events,drafts]=await Promise.all([api('runs/'+id),api('runs/'+id+'/events?after='+cursor),api('drafts?status=')]);
    if(!overlay||selected!==id||tab!=='runs')return;
    log.push(...events);if(events.length)cursor=events.at(-1).seq;
    const pending=drafts.filter(d=>d.context?.run_id===id&&d.status==='pending');
    const plan=log.filter(e=>e.event==='plan').at(-1)?.data.steps||[];
    root.innerHTML=`<h3>执行记录</h3>${plan.length?`<ol class="as-plan">${plan.map(p=>`<li>${p.status==='completed'?'✓':p.status==='in_progress'?'◉':'○'} ${esc(p.step)}</li>`).join('')}</ol>`:''}${pending.map(d=>`<details class="as-draft"><summary>待确认：${esc(d.tool)}</summary><pre>${esc(JSON.stringify(d.args,null,2))}</pre><button type="button" data-as-draft="${d.id}" data-action="confirm">确认执行</button><button type="button" data-as-draft="${d.id}" data-action="reject">拒绝</button></details>`).join('')}${run.result?.assistant?`<div class="as-answer">${esc(run.result.assistant.content)}</div>`:''}<details><summary>事件与工具证据 · ${log.length} 项</summary><pre>${esc(JSON.stringify(log.filter(e=>e.event!=='delta'),null,2))}</pre></details>`;
    root.querySelectorAll('[data-as-draft]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('drafts/'+b.dataset.asDraft+'/'+b.dataset.action,{});await detail();toast('草稿已处理，全部处理后点击继续')}catch(e){toast(e.message,true)}});
  }
  async function memory(root){
    const sessions=await api('sessions');
    root.innerHTML=`<div class="as-form"><div class="as-row"><label>会话范围<select id="as-memory-session"><option value="">用户与全局记忆</option>${sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></label><label>项目标识<input id="as-memory-project" placeholder="可选项目标识"></label></div><div class="as-row"><input id="as-memory-query" placeholder="检索记忆，例如：实验口径、研究偏好"><button type="button" id="as-recall">检索</button></div><div id="as-memory-results"></div></div><details><summary>添加长期记忆</summary><form class="as-form" id="as-memory-form"><label>记忆内容<textarea name="content" rows="3" required></textarea></label><div class="as-row"><label>作用域<select name="scope"><option value="user">用户</option><option value="global">全局</option><option value="project">项目</option><option value="session">会话</option></select></label><label>作用域标识<input name="scope_id" placeholder="项目/会话记忆必填"></label><label>类型<select name="kind">${['fact','preference','procedure','decision','episode'].map(k=>`<option>${k}</option>`).join('')}</select></label></div><label>稳定标识（同作用域相同标识将替代旧内容）<input name="memory_key" placeholder="例如：research-metric-policy"></label><button type="submit">保存记忆</button></form></details>`;
    const show=async(query='')=>{const sid=$('#as-memory-session',root).value,pid=$('#as-memory-project',root).value;const rows=query?(await api('memory/recall',{query,session_id:sid,project_id:pid})).results:await api('memories?session_id='+encodeURIComponent(sid)+'&project_id='+encodeURIComponent(pid));$('#as-memory-results',root).innerHTML=rows.map(m=>`<article class="as-memory"><p>${esc(m.content)}</p><small>${esc(m.scope)} · ${esc(m.kind)} · 来源 ${esc(JSON.stringify(m.source))}</small><button type="button" data-forget="${esc(m.id)}">忘记</button></article>`).join('')||'<p class="as-hint">没有匹配的记忆</p>';root.querySelectorAll('[data-forget]').forEach(b=>b.onclick=async()=>{try{await api('memory/forget',{id:b.dataset.forget});await show()}catch(e){toast(e.message,true)}})};
    $('#as-recall',root).onclick=()=>show($('#as-memory-query',root).value).catch(e=>toast(e.message,true));
    $('#as-memory-session',root).onchange=()=>show().catch(e=>toast(e.message,true));
    $('#as-memory-form',root).onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{await api('memory/remember',Object.fromEntries(new FormData(form)));form.reset();await show();toast('记忆已保存')}catch(err){toast(err.message,true)}};
    await show();
  }
  async function skills(root){
    const data=await api('skills');
    root.innerHTML=`<p class="as-hint">对话中使用 $技能名称 显式激活，或由助手按任务需要读取。用户技能放在 Workspace/System/Agent/Skills/名称/SKILL.md，资源按需加载。</p><div>${data.skills.map(s=>`<article class="as-skill"><strong>${esc(s.name)}</strong><span>${s.builtin?'内置':'用户'}</span><p>${esc(s.description)}</p><button type="button" data-read-skill="${esc(s.name)}">查看指令</button><button type="button" data-use-skill="${esc(s.name)}">用于新任务</button><pre hidden></pre></article>`).join('')}</div>${data.errors.map(e=>`<p class="as-error">${esc(e.name)}：${esc(e.error)}</p>`).join('')}<details><summary>安装文本技能</summary><form class="as-form" id="as-skill-install"><label>目录名称<input name="name" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="my-research-skill"></label><label>SKILL.md<textarea name="content" rows="9" required placeholder="---&#10;name: my-research-skill&#10;description: 说明用途和触发条件&#10;---&#10;具体工作流程"></textarea></label><button type="submit">安装技能</button></form></details>`;
    root.querySelectorAll('[data-read-skill]').forEach(b=>b.onclick=async()=>{try{const d=await api('skills/read',{name:b.dataset.readSkill});const p=$('pre',b.parentElement);p.hidden=!p.hidden;p.textContent=d.content}catch(e){toast(e.message,true)}});
    root.querySelectorAll('[data-use-skill]').forEach(b=>b.onclick=async()=>{const name=b.dataset.useSkill;tab='runs';await load();const input=$('#as-run-form textarea',overlay);input.value='请使用 $'+name+' ';input.focus()});
    $('#as-skill-install',root).onsubmit=async e=>{e.preventDefault();try{await api('skills/install',Object.fromEntries(new FormData(e.currentTarget)));await skills(root);toast('技能已安装')}catch(err){toast(err.message,true)}};
  }
  async function settings(root){
    const data=await api('system'),s=data.settings;
    root.innerHTML=`<p class="as-hint">本地 SQLite 记忆库 · ${data.brain.counts.memories} 条记忆 · ${data.brain.counts.runs} 个任务 · ${data.brain.counts.events} 个事件</p><form class="as-form" id="as-settings"><div class="as-row">${[['max_steps','每次执行最多轮数',1,256],['time_budget_seconds','每次执行时间预算（秒）',10,7200],['context_tokens','上下文估算 Token 预算',2048,200000]].map(([key,label,min,max])=>`<label>${label}<input type="number" name="${key}" value="${s[key]}" min="${min}" max="${max}"></label>`).join('')}</div><label class="as-check"><input name="auto_recall" type="checkbox" ${s.auto_recall?'checked':''}>自动召回相关长期记忆</label><label class="as-check"><input name="web_enabled" type="checkbox" ${s.web_enabled?'checked':''}>允许公开网页与文献检索</label><label class="as-check"><input name="code_enabled" type="checkbox" ${s.code_enabled?'checked':''}>允许 Docker 隔离代码执行（需已安装并启动 Docker）</label><label>本地 Python 镜像<input name="docker_image" value="${esc(s.docker_image)}"></label><p class="as-hint">代码容器无网络，仅能读取明确选择的输入；输出保存在 Workspace/System/Agent/Artifacts。镜像须事先拉取。</p><label>MCP HTTP 服务配置（JSON）<textarea name="mcp_servers" rows="8">${esc(JSON.stringify(s.mcp_servers,null,2))}</textarea></label><p class="as-hint">每项包含 name、url、enabled、tools（明确允许的远端工具）、read_only_tools、headers_env（请求头到环境变量名称）。保存后刷新连接，并在人设编辑器中勾选工具权限。</p><div class="as-actions"><button type="submit" class="primary-btn">保存设置</button><button type="button" id="as-mcp-refresh">刷新 MCP 连接</button><button type="button" id="as-backup">备份记忆库</button></div><pre id="as-settings-result"></pre></form>`;
    $('#as-settings',root).onsubmit=async e=>{e.preventDefault();try{const f=e.currentTarget;const d=Object.fromEntries(new FormData(f));for(const key of ['auto_recall','code_enabled','web_enabled'])d[key]=f.elements[key].checked;for(const key of ['max_steps','time_budget_seconds','context_tokens'])d[key]=Number(d[key]);d.mcp_servers=JSON.parse(d.mcp_servers);await api('settings',d);toast('设置已保存')}catch(err){toast(err.message,true)}};
    $('#as-mcp-refresh',root).onclick=async e=>{e.target.disabled=true;try{const d=await api('mcp/refresh',{});$('#as-settings-result',root).textContent=JSON.stringify(d,null,2)}catch(err){toast(err.message,true)}finally{e.target.disabled=false}};
    $('#as-backup',root).onclick=async()=>{try{const d=await api('backup',{});const a=document.createElement('a');a.href=d.url;a.textContent='下载一致性备份';a.download=d.path.split('/').at(-1);$('#as-settings-result',root).replaceChildren(a)}catch(e){toast(e.message,true)}};
  }
  function attach(){
    for(const host of [$('#agent-chat-title')?.closest('.agent-chat-head')?.querySelector('.agent-head-actions'),$('#fab-new')?.parentElement]){
      if(!host||host.querySelector('[data-agent-system]'))continue;
      const b=document.createElement('button');b.type='button';b.className='secondary-btn';b.dataset.agentSystem='1';b.textContent='Agent 系统';b.onclick=()=>open();host.append(b);
    }
    const settingsHost=$('#erw-persona-host');if(settingsHost&&!$('#as-settings-link')){const b=document.createElement('button');b.id='as-settings-link';b.type='button';b.className='secondary-btn';b.textContent='任务、记忆、技能与执行设置';b.onclick=()=>open('settings');settingsHost.before(b)}
  }
  let queued=false;
  new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;attach()})}}).observe(document.body,{childList:true,subtree:true});
  window.ERWAgentSystem={open,close};attach();
})();
