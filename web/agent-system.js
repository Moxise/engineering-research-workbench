/* Embedded Agent workspace: one conversation, with tasks, memory and skills. */
(()=>{
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $=(s,r=document)=>r.querySelector(s);
  const labels={queued:'排队中',running:'执行中',pausing:'正在停止',paused:'已暂停',interrupted:'执行中断',waiting_approval:'等待确认',completed:'已完成',failed:'失败',cancelled:'已停止'};
  let panelHost=null,tab='chat',timer=null,selected='',cursor=0,log=[],generation=0;
  async function api(path,body){const r=await fetch('/api/agent/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.message||d.error||r.status);return d}
  const toast=(s,bad=false)=>window.ERWToast?.(s,bad);
  const tabs=[['chat','对话'],['runs','任务'],['memory','记忆'],['skills','技能'],['settings','运行设置']];
  function close(){open('chat')}
  function open(initial='chat'){
    tab=tabs.some(([id])=>id===initial)?initial:'chat';
    if(!$('#agent-workspace')){location.hash='agent';return}
    mount();
  }
  function mount(){
    const panel=$('#agent-system-panel'),nav=$('#agent-workspace-tabs');
    if(!panel||!nav)return;
    const changed=panelHost!==panel;panelHost=panel;
    if(!nav.children.length){
      nav.innerHTML=tabs.map(([id,label])=>`<button type="button" role="tab" id="agent-tab-${id}" data-as-tab="${id}" aria-controls="${id==='chat'?'agent-chat-panel':'agent-system-panel'}">${label}</button>`).join('');
      nav.querySelectorAll('[data-as-tab]').forEach((button,index)=>{
        button.onclick=()=>{tab=button.dataset.asTab;load()};
        button.onkeydown=event=>{const key=event.key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;event.preventDefault();const next=key==='Home'?0:key==='End'?tabs.length-1:(index+(key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;const target=nav.querySelectorAll('button')[next];target.focus();target.click()};
      });
    }
    if(changed){clearInterval(timer);timer=setInterval(()=>{if(!panelHost?.isConnected){clearInterval(timer);timer=null;return}if(tab==='runs')refreshRuns().catch(()=>{})},2500)}
    load();
  }
  async function load(){
    if(!panelHost)return;
    const sequence=++generation;
    $('#agent-workspace-tabs')?.querySelectorAll('[data-as-tab]').forEach(b=>{const active=b.dataset.asTab===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1});
    const chat=$('#agent-chat-panel');if(chat)chat.hidden=tab!=='chat';
    panelHost.hidden=tab==='chat';
    if(tab==='chat'){window.ERWAgentPage?.refresh?.().catch(error=>toast(error.message,true));return}
    panelHost.setAttribute('aria-labelledby','agent-tab-'+tab);
    const root=document.createElement('div');root.innerHTML='<p>正在载入…</p>';
    $('.as-content',panelHost).replaceChildren(root);
    try{if(tab==='runs')await runs(root);else if(tab==='memory')await memory(root);else if(tab==='skills')await skills(root);else await settings(root)}catch(e){if(sequence===generation&&root.isConnected)root.innerHTML=`<p class="as-error">${esc(e.message)}</p>`}
  }
  async function runs(root){
    root.innerHTML='<div class="as-section-head"><div><h3>当前会话任务</h3><p class="as-hint">对话中发送的消息会自动在这里记录进度。确认草稿后，可继续同一个任务。</p></div><button type="button" class="primary-btn" id="as-go-chat">返回对话</button></div><div id="as-runs-list"></div><section id="as-run-detail"></section>';
    $('#as-go-chat',root).onclick=()=>{open('chat');$('#agent-input')?.focus()};
    await refreshRuns();
  }
  async function refreshRuns(){
    if(!panelHost||tab!=='runs')return;
    const root=$('#as-runs-list',panelHost);if(!root)return;
    const session=window.ERWAgentPage?.sessionId?.()||'';
    const rows=await api('runs?session_id='+encodeURIComponent(session));
    if(!panelHost||tab!=='runs'||!root.isConnected)return;
    if(!rows.some(run=>run.id===selected)){selected=rows[0]?.id||'';cursor=0;log=[]}
    root.innerHTML=rows.length?rows.map(r=>`<article class="as-run"><button type="button" class="as-run-title" data-as-run="${esc(r.id)}"><strong>${esc(r.id.slice(0,16))}</strong><small>${esc(r.updated)}</small></button><span class="as-status" data-state="${esc(r.status)}">${labels[r.status]||esc(r.status)}</span><div class="as-actions">${['running','queued'].includes(r.status)?`<button type="button" data-as-control="pause" data-id="${r.id}">暂停</button><button type="button" data-as-control="cancel" data-id="${r.id}">停止</button>`:''}${['paused','interrupted','waiting_approval','failed'].includes(r.status)?`<button type="button" data-as-control="resume" data-id="${r.id}">继续</button>`:''}</div>${r.error?`<p class="as-error">${esc(r.error)}</p>`:''}</article>`).join(''):'<p class="as-hint">暂无任务，普通对话也会自动出现在这里。</p>';
    root.querySelectorAll('[data-as-run]').forEach(b=>b.onclick=()=>{selected=b.dataset.asRun;cursor=0;log=[];detail().catch(e=>toast(e.message,true))});
    root.querySelectorAll('[data-as-control]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('runs/'+b.dataset.id+'/'+b.dataset.asControl,{});await refreshRuns();await window.ERWAgentPage?.refresh?.()}catch(e){toast(e.message,true)}finally{b.disabled=false}});
    if(selected)await detail();
  }
  async function detail(){
    const root=panelHost&&$('#as-run-detail',panelHost);if(!root||!selected)return;
    const id=selected;
    const [run,events,drafts]=await Promise.all([api('runs/'+id),api('runs/'+id+'/events?after='+cursor),api('drafts?status=')]);
    if(!panelHost||selected!==id||tab!=='runs')return;
    log.push(...events);if(events.length)cursor=events.at(-1).seq;
    const pending=(Array.isArray(drafts)?drafts:[]).filter(d=>d.context?.run_id===id&&d.status==='pending');
    const plan=log.filter(e=>e.event==='plan').at(-1)?.data.steps||[];
    root.innerHTML=`<h3>执行记录</h3>${plan.length?`<ol class="as-plan">${plan.map(p=>`<li>${p.status==='completed'?'✓':p.status==='in_progress'?'◉':'○'} ${esc(p.step)}</li>`).join('')}</ol>`:''}${pending.map(d=>`<details class="as-draft"><summary>待确认：${esc(d.tool)}</summary><pre>${esc(JSON.stringify(d.args,null,2))}</pre><button type="button" data-as-draft="${d.id}" data-action="confirm">确认执行</button><button type="button" data-as-draft="${d.id}" data-action="reject">拒绝</button></details>`).join('')}${run.result?.assistant?`<div class="as-answer">${window.ERWFabTimeline?.responses?.(run.result.assistant)||''}${window.ERWFabTimeline?.render?.(run.result.assistant.content)||esc(run.result.assistant.content)}</div>`:''}<details><summary>事件与工具证据 · ${log.length} 项</summary><pre>${esc(JSON.stringify(log.filter(e=>e.event!=='delta'),null,2))}</pre></details>`;
    root.querySelectorAll('[data-as-draft]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('drafts/'+b.dataset.asDraft+'/'+b.dataset.action,{});await detail();toast('草稿已处理，全部处理后点击继续')}catch(e){toast(e.message,true)}});
  }
  async function memory(root){
    const sessions=await api('sessions');
    root.innerHTML=`<div class="as-form"><div class="as-row"><label>会话范围<select id="as-memory-session"><option value="">用户与全局记忆</option>${sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></label><label>项目标识<input id="as-memory-project" placeholder="可选项目标识"></label></div><div class="as-row"><input id="as-memory-query" placeholder="检索记忆，例如：实验口径、研究偏好"><button type="button" id="as-recall">检索</button></div><div id="as-memory-results"></div></div><details><summary>添加长期记忆</summary><form class="as-form" id="as-memory-form"><label>记忆内容<textarea name="content" rows="3" required></textarea></label><div class="as-row"><label>作用域<select name="scope"><option value="user">用户</option><option value="global">全局</option><option value="project">项目</option><option value="session">会话</option></select></label><label>作用域标识<input name="scope_id" placeholder="项目/会话记忆必填"></label><label>类型<select name="kind">${['fact','preference','procedure','decision','episode'].map(k=>`<option>${k}</option>`).join('')}</select></label></div><label>稳定标识（同作用域相同标识将替代旧内容）<input name="memory_key" placeholder="例如：research-metric-policy"></label><button type="submit">保存记忆</button></form></details>`;
    const show=async(query='')=>{const sid=$('#as-memory-session',root).value,pid=$('#as-memory-project',root).value;const rows=query?(await api('memory/recall',{query,session_id:sid,project_id:pid})).results:await api('memories?session_id='+encodeURIComponent(sid)+'&project_id='+encodeURIComponent(pid));$('#as-memory-results',root).innerHTML=rows.map(m=>`<article class="as-memory"><p>${esc(m.content)}</p><small>${esc(m.scope)} · ${esc(m.kind)} · 来源 ${esc(JSON.stringify(m.source))}</small><button type="button" data-forget="${esc(m.id)}">忘记</button></article>`).join('')||'<p class="as-hint">没有匹配的记忆</p>';root.querySelectorAll('[data-forget]').forEach(b=>b.onclick=async()=>{try{await api('memory/forget',{id:b.dataset.forget});await show()}catch(e){toast(e.message,true)}})};
    $('#as-recall',root).onclick=()=>show($('#as-memory-query',root).value).catch(e=>toast(e.message,true));
    $('#as-memory-session',root).onchange=()=>show().catch(e=>toast(e.message,true));
    const current=window.ERWAgentPage?.sessionId?.();if(current&&sessions.some(session=>session.id===current))$('#as-memory-session',root).value=current;
    $('#as-memory-form',root).onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{await api('memory/remember',Object.fromEntries(new FormData(form)));form.reset();await show();toast('记忆已保存')}catch(err){toast(err.message,true)}};
    await show();
  }
  async function skills(root){
    const data=await api('skills');
    root.innerHTML=`<p class="as-hint">对话中使用 $技能名称 显式激活，或由助手按任务需要读取。用户技能放在 Workspace/System/Agent/Skills/名称/SKILL.md，资源按需加载。</p><div>${data.skills.map(s=>`<article class="as-skill"><strong>${esc(s.name)}</strong><span>${s.builtin?'内置':'用户'}</span><p>${esc(s.description)}</p><button type="button" data-read-skill="${esc(s.name)}">查看指令</button><button type="button" data-use-skill="${esc(s.name)}">用于新任务</button><pre hidden></pre></article>`).join('')}</div>${data.errors.map(e=>`<p class="as-error">${esc(e.name)}：${esc(e.error)}</p>`).join('')}<details><summary>安装文本技能</summary><form class="as-form" id="as-skill-install"><label>目录名称<input name="name" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="my-research-skill"></label><label>SKILL.md<textarea name="content" rows="9" required placeholder="---&#10;name: my-research-skill&#10;description: 说明用途和触发条件&#10;---&#10;具体工作流程"></textarea></label><button type="submit">安装技能</button></form></details>`;
    root.querySelectorAll('[data-read-skill]').forEach(b=>b.onclick=async()=>{try{const d=await api('skills/read',{name:b.dataset.readSkill});const p=$('pre',b.parentElement);p.hidden=!p.hidden;p.textContent=d.content}catch(e){toast(e.message,true)}});
    root.querySelectorAll('[data-use-skill]').forEach(b=>{b.textContent='在当前对话使用';b.onclick=async()=>{try{const name=b.dataset.useSkill;await window.ERWAgentPage?.useSkill?.(name);open('chat');$('#agent-input')?.focus()}catch(error){toast(error.message,true)}}});
    $('#as-skill-install',root).onsubmit=async e=>{e.preventDefault();try{await api('skills/install',Object.fromEntries(new FormData(e.currentTarget)));await skills(root);await window.ERWAgentPage?.reloadSkills?.();toast('技能已安装')}catch(err){toast(err.message,true)}};
  }
  async function settings(root){
    const data=await api('system'),s=data.settings;
    root.innerHTML=`<p class="as-hint">本地 SQLite 记忆库 · ${data.brain.counts.memories} 条记忆 · ${data.brain.counts.runs} 个任务 · ${data.brain.counts.events} 个事件</p><form class="as-form" id="as-settings"><div class="as-row">${[['max_steps','每次执行最多轮数',1,256],['time_budget_seconds','每次执行时间预算（秒）',10,7200],['context_tokens','上下文估算 Token 预算',2048,200000]].map(([key,label,min,max])=>`<label>${label}<input type="number" name="${key}" value="${s[key]}" min="${min}" max="${max}"></label>`).join('')}</div><label class="as-check"><input name="auto_recall" type="checkbox" ${s.auto_recall?'checked':''}>自动召回相关长期记忆</label><label class="as-check"><input name="web_enabled" type="checkbox" ${s.web_enabled?'checked':''}>允许公开网页与文献检索</label><label class="as-check"><input name="code_enabled" type="checkbox" ${s.code_enabled?'checked':''}>允许 Docker 隔离代码执行（需已安装并启动 Docker）</label><label>本地 Python 镜像<input name="docker_image" value="${esc(s.docker_image)}"></label><p class="as-hint">代码容器无网络，仅能读取明确选择的输入；输出保存在 Workspace/System/Agent/Artifacts。镜像须事先拉取。</p><label>MCP HTTP 服务配置（JSON）<textarea name="mcp_servers" rows="8">${esc(JSON.stringify(s.mcp_servers,null,2))}</textarea></label><p class="as-hint">每项包含 name、url、enabled、tools（明确允许的远端工具）、read_only_tools、headers_env（请求头到环境变量名称）。保存后刷新连接，并在人设编辑器中勾选工具权限。</p><div class="as-actions"><button type="submit" class="primary-btn">保存设置</button><button type="button" id="as-mcp-refresh">刷新 MCP 连接</button><button type="button" id="as-backup">备份记忆库</button></div><pre id="as-settings-result"></pre></form>`;
    $('#as-settings',root).onsubmit=async e=>{e.preventDefault();try{const f=e.currentTarget;const d=Object.fromEntries(new FormData(f));for(const key of ['auto_recall','code_enabled','web_enabled'])d[key]=f.elements[key].checked;for(const key of ['max_steps','time_budget_seconds','context_tokens'])d[key]=Number(d[key]);d.mcp_servers=JSON.parse(d.mcp_servers);await api('settings',d);toast('设置已保存')}catch(err){toast(err.message,true)}};
    $('#as-mcp-refresh',root).onclick=async e=>{e.target.disabled=true;try{const d=await api('mcp/refresh',{});$('#as-settings-result',root).textContent=JSON.stringify(d,null,2)}catch(err){toast(err.message,true)}finally{e.target.disabled=false}};
    $('#as-backup',root).onclick=async()=>{try{const d=await api('backup',{});const a=document.createElement('a');a.href=d.url;a.textContent='下载一致性备份';a.download=d.path.split('/').at(-1);$('#as-settings-result',root).replaceChildren(a)}catch(e){toast(e.message,true)}};
  }
  function attach(){
    const panel=$('#agent-system-panel');
    if(panel&&panel!==panelHost)mount();
    if(!panel&&panelHost&&!panelHost.isConnected){clearInterval(timer);timer=null;panelHost=null;generation++}
  }
  let queued=false;
  new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;attach()})}}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('erw-agent-run-updated',()=>{if(tab==='runs')refreshRuns().catch(error=>toast(error.message,true))});
  window.ERWAgentSystem={open,close,mount,showRun:id=>{if(selected!==id){selected=id;cursor=0;log=[]}open('runs')}};attach();
})();
