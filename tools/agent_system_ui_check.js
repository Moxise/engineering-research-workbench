/* Disposable UI fixture: no access to a user's research files or model API. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.scratch','verify','agent-system');fs.mkdirSync(output,{recursive:true});
const runs=[],memories=[],installed=[];
let opts={max_steps:48,time_budget_seconds:900,context_tokens:24000,auto_recall:true,web_enabled:true,code_enabled:false,docker_image:'python:3.12-slim',mcp_servers:[]};
let approved=false;
const session={id:'chat-fixture123',title:'科研验收',archived:false};
const skill={name:'literature-review',description:'比较文献并保留证据',builtin:true};
const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
    let data={};const url=new URL(req.url,'http://localhost'),p=url.pathname;
    if(p==='/api/config')data={app:{llm:{personas:[{id:'executor',name:'执行助手'}]}}};
    else if(p.endsWith('/sessions'))data=[session];
    else if(p.endsWith('/runs')&&req.method==='POST'){data={id:'run-fixture',status:'waiting_approval',created:'2026-10-19',updated:'2026-10-19'};runs.push(data)}
    else if(p.endsWith('/runs'))data=runs;
    else if(p.endsWith('/events'))data=[{seq:1,event:'plan',data:{steps:[{step:'核对来源',status:'completed'}]}},{seq:2,event:'tool_result',data:{tool:'kb_read',result:{body:'可核对的证据'}}}].filter(e=>e.seq>Number(url.searchParams.get('after')||0));
    else if(p.endsWith('/resume')){runs[0].status='completed';data=runs[0]}
    else if(p.includes('/runs/'))data={...runs[0],result:{assistant:{content:'已完成带来源的研究总结'}}};
    else if(p.endsWith('/drafts'))data=approved?[]:[{id:'draft-fixture',tool:'kb_create_entry',status:'pending',context:{run_id:'run-fixture'},args:{title:'知识-方法-测试',body:'先检查草稿正文'}}];
    else if(p.includes('/drafts/')){approved=true;data={status:'confirmed'}}
    else if(p.endsWith('/skills/install')){installed.push({name:body.name,description:'User skill',builtin:false});data={ok:true}}
    else if(p.endsWith('/skills/read'))data={content:'---\nname: literature-review\n---\n核对来源与页码'};
    else if(p.endsWith('/skills'))data={skills:[skill,...installed],errors:[]};
    else if(p.endsWith('/system'))data={settings:opts,brain:{counts:{memories:memories.length,runs:runs.length,events:2}}};
    else if(p.endsWith('/settings')){opts=body;data=body}
    else if(p.endsWith('/mcp/refresh'))data={tools:[],errors:[]};
    else if(p.endsWith('/memory/remember')){data={...body,id:'mem-fixture',source:{type:'user'}};memories.push(data)}
    else if(p.endsWith('/memory/recall'))data={results:memories};
    else if(p.endsWith('/memories'))data=memories;
    else if(p.endsWith('/memory/forget')){memories.length=0;data={ok:true}}
    else if(p.endsWith('/backup'))data={url:'/backup.sqlite',path:'System/Agent/Backups/brain.sqlite'};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return;
  }
  if(req.url==='/'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/agent-system.css"></head><body><div class="agent-chat-head"><h3 id="agent-chat-title">科研 Agent</h3><div class="agent-head-actions"></div></div><div id="toast-stack"></div><script>window.ERWToast=(m)=>document.querySelector("#toast-stack").textContent=m</script><script src="/agent-system.js"></script></body></html>');return;
  }
  const file=path.join(root,'web',req.url.split('?')[0]);
  if(file.startsWith(path.join(root,'web'))&&fs.existsSync(file)){res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/css'});res.end(fs.readFileSync(file))}else{res.writeHead(404);res.end()}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER||'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Agent 系统',exact:true}).click();
    await page.locator('#as-run-form textarea').fill('使用 $literature-review 核对论文');
    await page.getByRole('button',{name:'开始任务',exact:true}).click();
    await page.getByText('先检查草稿正文',{exact:false}).waitFor({state:'attached'});
    await page.getByText('待确认：kb_create_entry').click();
    await page.getByRole('button',{name:'确认执行',exact:true}).click();
    await page.getByRole('button',{name:'继续',exact:true}).click();
    await page.getByText('已完成',{exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'tasks.png')});
    await page.getByRole('button',{name:'记忆',exact:true}).click();
    await page.getByText('添加长期记忆',{exact:true}).click();
    await page.locator('#as-memory-form textarea').fill('实验统一使用 SCR 指标');
    await page.getByRole('button',{name:'保存记忆',exact:true}).click();
    await page.getByText('实验统一使用 SCR 指标',{exact:true}).waitFor();
    await page.getByRole('button',{name:'忘记',exact:true}).click();
    await page.getByText('没有匹配的记忆',{exact:true}).waitFor();
    await page.getByRole('button',{name:'技能',exact:true}).click();
    await page.getByRole('button',{name:'查看指令',exact:true}).click();
    await page.getByText('核对来源与页码',{exact:false}).waitFor();
    await page.getByText('安装文本技能',{exact:true}).click();
    await page.locator('#as-skill-install input').fill('custom-flow');
    await page.locator('#as-skill-install textarea').fill('---\nname: custom-flow\ndescription: test\n---\n检查输入');
    await page.getByRole('button',{name:'安装技能',exact:true}).click();
    await page.getByText('custom-flow',{exact:true}).waitFor();
    await page.getByRole('button',{name:'设置与连接',exact:true}).click();
    await page.locator('input[name=max_steps]').fill('64');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByText('设置已保存',{exact:true}).waitFor();assert.equal(opts.max_steps,64);
    await page.getByRole('button',{name:'刷新 MCP 连接',exact:true}).click();
    await page.getByRole('button',{name:'备份记忆库',exact:true}).click();
    await page.getByRole('link',{name:'下载一致性备份'}).waitFor();
    await page.screenshot({path:path.join(output,'settings.png')});
    await page.addStyleTag({content:':root{--surface:#202b38;--text:#e5edf5;--bg:#15202b;--line:#435166;--muted:#a2afbd;--accent:#257682}'});
    assert.equal(await page.locator('.agent-system').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(32, 43, 56)');
    await page.screenshot({path:path.join(output,'settings-dark.png')});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'技能',exact:true}).click();
    await page.getByText('custom-flow',{exact:true}).waitFor();
    assert.ok(await page.locator('.agent-system').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await page.screenshot({path:path.join(output,'mobile.png')});
    await page.keyboard.press('Escape');assert.equal(await page.locator('.agent-system-overlay').count(),0);
    assert.deepEqual(errors,[]);console.log('Agent system UI passed: tasks, approval, resume, memory, skills, settings, MCP, backup, mobile, keyboard.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
