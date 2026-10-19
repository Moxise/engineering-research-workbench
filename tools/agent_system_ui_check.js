/* Full original Agent page, fixture HTTP APIs, no personal data or model calls. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.scratch','verify','agent-system');fs.mkdirSync(output,{recursive:true});
const sessions=[{id:'chat-fixture123',title:'科研验收',updated:'2026-10-19',messages:[]},{id:'chat-other123',title:'另一会话',updated:'2026-10-18',messages:[]}];
const runs=[{id:'run-other',session_id:sessions[1].id,status:'completed',updated:'2026-10-18'}],memories=[],installed=[],requests=[];
let opts={max_steps:48,time_budget_seconds:900,context_tokens:24000,auto_recall:true,web_enabled:true,code_enabled:false,docker_image:'python:3.12-slim',mcp_servers:[]};
let mode='normal',failSessionOnce=false,approved=false,sequence=0,delayMemory=false,failListReads=1,failedListReads=0,releaseStream=null;
const skill={name:'literature-review',description:'比较文献并保留证据',builtin:true};
const cfg={app:{app_name:'科研工作台',subtitle:'Engineering Research Workspace',ui:{},academic_profile:{graduation_conditions:[]},llm:{enabled:true,active_profile_id:'fixture',request_presets:[{id:'default',label:'默认',model:'fixture'}],profiles:[{id:'fixture',name:'测试配置',base_url:'https://example.invalid/v1',request_presets:[{id:'default',label:'默认',model:'fixture'}]}],personas:[{id:'executor',name:'执行助手',tools:['kb_read'],write_mode:'confirm'},{id:'reader',name:'阅读助手',tools:['kb_read'],write_mode:'confirm'}]}},rss:{sources:[]},weather:{enabled:false}};
function answer(content,extra={}){return {id:'msg-'+(++sequence),role:'assistant',content,created:'2026-10-19',model:'fixture',...extra}}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),p=url.pathname;
  if(p.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
    requests.push({path:p,query:url.searchParams,body});let data=[];
    if(p==='/api/config')data=cfg;
    else if(p==='/api/knowledge-types')data=['idea','journal','note','milestone','summary','literature'].map(id=>({id,label:id,statuses:['记录']}));
    else if(p==='/api/statuses')data={note:['记录']};
    else if(p==='/api/projects')data=[];
    else if(p==='/api/health')data={version:'agent-test'};
    else if(p==='/api/workspace/info')data={relative:'Fixture'};
    else if(p.startsWith('/api/weather'))data={enabled:false};
    else if(p==='/api/agent/send'){
      const session=sessions.find(s=>s.id===body.session_id);assert(session);
      session.messages.push({id:'msg-'+(++sequence),role:'user',content:body.message,created:'2026-10-19'});
      const run={id:'run-'+sequence,session_id:session.id,status:mode==='draft'?'waiting_approval':'completed',updated:'2026-10-19'};
      const parts=[{round:1,content:'## 核心方法\n第一轮分析：低秩适配。'},{round:2,content:'第二轮比较：\n\n| 方法 | 特点 |\n| --- | --- |\n| LoRA | 参数少 |'}];
      const multi=['multi','partial'].includes(mode);
      const message=answer(mode==='draft'?'请确认草稿后继续。':multi?'任务已完成。':'已完成带来源的研究总结 '+sequence,{run_id:run.id,...(multi?{response_parts:parts}:{}),...(mode==='draft'?{drafts:[{draft_id:'draft-fixture',tool:'kb_create_entry',summary:'知识-方法-测试'}]}:{})});
      if(mode==='error'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('event: error\ndata: '+JSON.stringify({message:'模拟模型接口失败'})+'\n\n');return}
      session.messages.push(message);session.title='已更新的研究会话';session.updated='2026-10-19T12:00:00';run.result={assistant:message};runs.unshift(run);
      if(mode==='metadata')failSessionOnce=true;
      const encode=events=>events.map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join('');
      if(multi){
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});
        res.write(encode([['run',{run_id:run.id,session_id:session.id}],['round',{i:0}],['delta',{text:parts[0].content}],['response',{...parts[0],intermediate:true}],['tool',{name:'kb_search',ok:true,ms:5}],['round',{i:1}],['delta',{text:parts[1].content}],['response',{...parts[1],intermediate:true}],['round',{i:2}]]));
        if(mode==='partial'){res.end(encode([['error',{message:'模拟中途连接失败'}]]));return}
        await new Promise(resolve=>{releaseStream=resolve});releaseStream=null;
        res.end(encode([['delta',{text:message.content}],['response',{round:3,content:message.content,intermediate:false}],['done',{ok:true,assistant:message}]]));return;
      }
      const events=[['run',{run_id:run.id,session_id:session.id}],['round',{i:0}],['delta',{text:message.content}],['done',{ok:true,assistant:message}]];
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});res.end(events.map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join(''));return;
    }
    else if(p==='/api/agent/sessions'&&req.method==='POST'){data={id:'chat-new123',title:'新对话',messages:[]};sessions.unshift(data)}
    else if(p==='/api/agent/sessions'){if(failListReads>0){failListReads--;failedListReads++;res.destroy();return}data=sessions.map(s=>({...s,message_count:s.messages.length}))}
    else if(p.startsWith('/api/agent/sessions/')){if(failSessionOnce){failSessionOnce=false;res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'模拟会话列表刷新失败'}));return}data=sessions.find(s=>s.id===p.split('/').at(-1))}
    else if(p==='/api/agent/runs')data=runs.filter(r=>!url.searchParams.get('session_id')||r.session_id===url.searchParams.get('session_id'));
    else if(p.endsWith('/events'))data=[{seq:1,event:'plan',data:{steps:[{step:'核对来源',status:'completed'}]}},{seq:2,event:'tool_result',data:{tool:'kb_read',result:{body:'可核对的证据'}}}].filter(e=>e.seq>Number(url.searchParams.get('after')||0));
    else if(p.endsWith('/resume')){const run=runs.find(r=>r.id===p.split('/').at(-2));run.status='completed';const message=answer('确认后已在同一会话完成',{run_id:run.id});sessions.find(s=>s.id===run.session_id).messages.push(message);run.result={assistant:message};data=run}
    else if(p.includes('/agent/runs/'))data=runs.find(r=>r.id===p.split('/').at(-1));
    else if(p.endsWith('/drafts'))data=approved?[]:[{id:'draft-fixture',tool:'kb_create_entry',status:'pending',context:{run_id:runs.find(r=>r.status==='waiting_approval')?.id},args:{title:'知识-方法-测试',body:'先检查草稿正文'}}];
    else if(p.includes('/drafts/')){approved=true;data={status:'confirmed'}}
    else if(p.endsWith('/skills/install')){installed.push({name:body.name,description:'用户技能',builtin:false});data={ok:true}}
    else if(p.endsWith('/skills/read'))data={content:'---\nname: literature-review\n---\n核对来源与页码'};
    else if(p.endsWith('/skills'))data={skills:[skill,...installed],errors:[]};
    else if(p.endsWith('/system'))data={settings:opts,brain:{counts:{memories:memories.length,runs:runs.length,events:2}}};
    else if(p.endsWith('/settings')){opts=body;data=body}
    else if(p.endsWith('/mcp/refresh'))data={tools:[],errors:[]};
    else if(p.endsWith('/memory/remember')){data={...body,id:'mem-fixture',source:{type:'user'}};memories.push(data)}
    else if(p.endsWith('/memory/recall'))data={results:memories};
    else if(p.endsWith('/memories')){if(delayMemory)await new Promise(resolve=>setTimeout(resolve,200));data=memories}
    else if(p.endsWith('/memory/forget')){memories.length=0;data={ok:true}}
    else if(p.endsWith('/backup'))data={url:'/backup.sqlite',path:'System/Agent/Backups/brain.sqlite'};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;
  }
  const file=path.resolve(root,'web','.'+(p==='/'?'/index.html':p));
  if(file.startsWith(path.join(root,'web')+path.sep)&&fs.existsSync(file)){
    const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'};
    res.writeHead(200,{'Content-Type':(mime[path.extname(file)]||'application/octet-stream')+'; charset=utf-8'});res.end(fs.readFileSync(file));
  }else{res.writeHead(404);res.end()}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER||'msedge'});
  let lastPage;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    lastPage=page;page.setDefaultTimeout(10000);
    await page.goto('http://127.0.0.1:'+server.address().port+'/#agent');
    await page.getByRole('tab',{name:'对话',exact:true}).waitFor();
    await page.locator('#agent-skill option[value="literature-review"]').waitFor({state:'attached'});
    await page.locator('#agent-profile-select').waitFor();
    assert.equal(failedListReads,1,'transient connection failure retries safely without a model call');
    assert.equal(await page.getByRole('button',{name:'Agent 系统',exact:true}).count(),0);
    assert.equal(await page.locator('.agent-system-overlay').count(),0);
    await page.locator('#agent-input').fill('保留这段输入');
    await page.getByRole('tab',{name:'技能',exact:true}).click();
    await page.getByRole('button',{name:'在当前对话使用',exact:true}).click();
    await page.locator('#agent-input').waitFor({state:'visible'});
    assert.equal(await page.locator('#agent-input').inputValue(),'保留这段输入');
    assert.equal(await page.locator('#agent-skill').inputValue(),'literature-review');
    await page.locator('#agent-input').fill('核对论文');await page.locator('#agent-send').click();
    await page.waitForFunction(()=>document.querySelector('#agent-send').textContent==='发送');
    assert.equal(await page.locator('#agent-messages .agent-error').count(),0);
    assert.match(await page.locator('#agent-messages').innerText(),/已完成带来源的研究总结/);
    assert.equal(await page.locator('[data-agent-session="chat-fixture123"] strong').textContent(),'已更新的研究会话');
    assert.equal(requests.filter(r=>r.path==='/api/agent/send').length,1);
    assert.equal(await page.locator('#agent-profile-select').count(),1,'concurrent enhancement must not duplicate API selectors');
    const sent=requests.find(r=>r.path==='/api/agent/send').body;assert.equal(sent.persona_id,'executor');assert.match(sent.message,/^\$literature-review\n/);
    await page.screenshot({path:path.join(output,'integrated-chat.png')});
    mode='metadata';await page.locator('#agent-input').fill('测试回复后的列表刷新失败');await page.locator('#agent-send').click();
    await page.waitForFunction(()=>document.querySelector('#agent-send').textContent==='发送');
    assert.equal(await page.locator('#agent-messages .agent-error').count(),0);
    assert.equal(await page.locator('#agent-messages .assistant').count(),2);
    await page.getByText('回复已保存，界面刷新失败：模拟会话列表刷新失败',{exact:true}).waitFor();
    mode='draft';await page.locator('#agent-input').fill('生成知识草稿');await page.locator('#agent-send').click();
    await page.waitForFunction(()=>document.querySelector('#agent-send').textContent==='发送');
    await page.getByRole('tab',{name:'任务',exact:true}).click();
    assert.equal(await page.locator('#as-run-form').count(),0,'tasks use the existing chat composer');
    assert.equal(await page.locator('#agent-input').count(),1,'one Agent input across all panels');
    await page.getByText('待确认：kb_create_entry').click();
    assert.equal(await page.getByText('run-other',{exact:true}).count(),0);
    await page.getByRole('button',{name:'确认执行',exact:true}).click();
    await page.getByRole('button',{name:'继续',exact:true}).click();
    await page.locator('.as-answer').getByText('确认后已在同一会话完成',{exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'integrated-tasks.png')});
    await page.getByRole('tab',{name:'对话',exact:true}).click();
    await page.locator('#agent-messages').getByText('确认后已在同一会话完成',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'记忆',exact:true}).click();
    await page.locator('#as-memory-session').waitFor();assert.equal(await page.locator('#as-memory-session').inputValue(),'chat-fixture123');
    await page.getByText('添加长期记忆',{exact:true}).click();await page.locator('#as-memory-form textarea').fill('实验统一使用 SCR 指标');
    await page.getByRole('button',{name:'保存记忆',exact:true}).click();await page.getByText('实验统一使用 SCR 指标',{exact:true}).waitFor();
    await page.getByRole('button',{name:'忘记',exact:true}).click();await page.getByText('没有匹配的记忆',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'技能',exact:true}).click();await page.getByRole('button',{name:'查看指令',exact:true}).click();
    await page.getByText('核对来源与页码',{exact:false}).waitFor();await page.getByText('安装文本技能',{exact:true}).click();
    await page.locator('#as-skill-install input').fill('custom-flow');await page.locator('#as-skill-install textarea').fill('---\nname: custom-flow\ndescription: test\n---\n检查输入');
    await page.getByRole('button',{name:'安装技能',exact:true}).click();await page.locator('.as-skill strong').getByText('custom-flow',{exact:true}).waitFor();
    await page.locator('#agent-skill option[value="custom-flow"]').waitFor({state:'attached'});
    delayMemory=true;await page.getByRole('tab',{name:'记忆',exact:true}).click();await page.locator('#as-memory-session').waitFor();
    const lateMemory=page.waitForResponse(r=>r.url().includes('/api/agent/memories'));await page.getByRole('tab',{name:'技能',exact:true}).click();await lateMemory;
    await page.locator('.as-skill').filter({hasText:'custom-flow'}).waitFor();assert.equal(await page.locator('#as-memory-results').count(),0);delayMemory=false;
    await page.getByRole('tab',{name:'运行设置',exact:true}).click();await page.locator('input[name=max_steps]').fill('64');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByText('设置已保存',{exact:true}).waitFor();assert.equal(opts.max_steps,64);
    await page.getByRole('button',{name:'刷新 MCP 连接',exact:true}).click();await page.getByRole('button',{name:'备份记忆库',exact:true}).click();await page.getByRole('link',{name:'下载一致性备份'}).waitFor();
    await page.screenshot({path:path.join(output,'integrated-settings.png')});
    await page.locator('#theme-btn').click();await page.screenshot({path:path.join(output,'integrated-dark.png')});
    await page.getByRole('tab',{name:'技能',exact:true}).click();await page.locator('.as-skill').filter({hasText:'custom-flow'}).waitFor();
    await page.getByRole('tab',{name:'技能',exact:true}).press('Home');assert.equal(await page.getByRole('tab',{name:'对话',exact:true}).getAttribute('aria-selected'),'true');
    await page.locator('#agent-input').fill('切换会话前保留的草稿');await page.getByRole('tab',{name:'任务',exact:true}).click();await page.getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await page.locator('#agent-input').inputValue(),'切换会话前保留的草稿');
    mode='error';await page.locator('#agent-input').fill('验证真实模型失败');await page.locator('#agent-send').click();await page.locator('.agent-error').getByText('请求失败：模拟模型接口失败',{exact:true}).waitFor();
    await page.locator('[data-agent-session="chat-other123"]').click();await page.getByRole('tab',{name:'任务',exact:true}).click();await page.getByText('run-other',{exact:true}).waitFor();
    assert.equal(await page.locator('.as-run').count(),1);
    await page.getByRole('tab',{name:'对话',exact:true}).click();mode='multi';
    await page.locator('#agent-input').fill('展示全部分析过程');await page.locator('#agent-send').click();
    await page.locator('#agent-thinking .agent-response-part').filter({hasText:'第二轮比较'}).waitFor();
    assert.equal(await page.locator('#agent-thinking .agent-response-part').count(),2);
    assert.match(await page.locator('#agent-thinking').innerText(),/第一轮分析/);
    assert.equal(await page.locator('#agent-thinking table').count(),1);
    releaseStream();await page.waitForFunction(()=>document.querySelector('#agent-send').textContent==='发送');
    assert.equal(await page.locator('#agent-messages .agent-response-part').count(),2);
    assert.match(await page.locator('#agent-messages').innerText(),/任务已完成/);
    await page.getByRole('tab',{name:'任务',exact:true}).click();await page.locator('[data-as-run="'+runs[0].id+'"]').click();
    await page.locator('.as-answer .agent-response-part').nth(1).waitFor();assert.match(await page.locator('.as-answer').innerText(),/第一轮分析/);
    await page.getByRole('tab',{name:'对话',exact:true}).click();
    await page.reload();await page.locator('#agent-input').waitFor();
    await page.locator('[data-agent-session="chat-other123"]').click();
    await page.locator('#agent-messages .agent-response-part').nth(1).waitFor();
    assert.match(await page.locator('#agent-messages').innerText(),/第一轮分析/);
    await page.screenshot({path:path.join(output,'intermediate-main.png')});
    await page.locator('#erw-fab-ball').click();await page.locator('#fab-input').waitFor();
    await page.locator('#fab-input').fill('悬浮助手保留过程');await page.locator('#fab-send').click();
    await page.locator('#fab-messages .fab-msg:last-child .agent-response-part').nth(1).waitFor();
    assert.match(await page.locator('#fab-messages .fab-msg:last-child').innerText(),/第一轮分析/);
    releaseStream();await page.waitForFunction(()=>document.querySelector('#fab-send').textContent==='发送');
    assert.equal(await page.locator('#fab-messages .fab-msg:last-child .agent-response-part').count(),2);
    await page.screenshot({path:path.join(output,'intermediate-floating.png')});
    mode='partial';await page.locator('#fab-input').fill('中途失败保留结果');await page.locator('#fab-send').click();
    await page.locator('#fab-messages').getByText('请求失败：模拟中途连接失败',{exact:true}).waitFor();
    assert.equal(await page.locator('#fab-messages .agent-response-part').count(),4,'partial failure retains the prior public answers');
    await page.locator('#fab-close').click();
    await page.locator('#agent-input').fill('主页面中断保留结果');await page.locator('#agent-send').click();
    await page.locator('#agent-messages .agent-error').getByText('请求失败：模拟中途连接失败',{exact:true}).waitFor();
    assert.equal(await page.locator('#agent-messages .agent-response-part').count(),4);
    const offline=await browser.newPage({viewport:{width:1440,height:1000}});offline.setDefaultTimeout(10000);let offlineReads=3;
    await offline.route('**/api/agent/sessions',route=>offlineReads-->0?route.abort('failed'):route.continue());
    await offline.goto('http://127.0.0.1:'+server.address().port+'/#agent');
    await offline.locator('#agent-sessions-retry').waitFor();await offline.locator('#agent-input').fill('连接恢复时保留草稿');
    assert.match(await offline.locator('#agent-sessions-status').innerText(),/无法连接本地 Agent 服务/);
    await offline.locator('#agent-sessions-retry').click();await offline.locator('[data-agent-session="chat-fixture123"]').waitFor();
    assert.equal(await offline.locator('#agent-input').inputValue(),'连接恢复时保留草稿');assert.equal(await offline.locator('#agent-sessions-retry').count(),0);await offline.close();
    await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'技能',exact:true}).click();await page.locator('.as-skill').filter({hasText:'custom-flow'}).waitFor();
    assert.ok(await page.locator('#agent-system-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:path.join(output,'integrated-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('Integrated Agent UI passed: chat and floating multi-round answers during streaming/completion/reload, partial failures, network retry and recovery without lost drafts, shared tasks/approvals/memory/skills/settings, themes and mobile. No model API calls.');
  }catch(error){if(lastPage){console.error('UI failure state:',(await lastPage.locator('#fab-messages').innerText()).slice(-1500));await lastPage.screenshot({path:path.join(output,'failure.png')})}throw error}
  finally{releaseStream?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
