/* Run against a local server with Playwright available in NODE_PATH.
 * All task/document writes are intercepted; the user's workspace is never edited.
 * node tools/ui_usability_check.js (starts its own static fixture server)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const output = path.resolve('.scratch/verify/usability');
fs.mkdirSync(output, {recursive:true});

(async()=>{
  const webRoot=path.resolve('web');
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(webRoot,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(webRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=process.argv[2]||`http://127.0.0.1:${server.address().port}`;
  let browser;
  try{
    browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER||'msedge'});
    const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
    const errors=[];
    const libraryRequests=[],graphRequests=[];
    page.on('request',request=>{
      const url=new URL(request.url());
      if(/\/(mathjax-tex-svg|mermaid\.min)/.test(url.pathname))libraryRequests.push(url.pathname);
      if(url.pathname==='/api/graph')graphRequests.push(url.href);
    });
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',dialog=>{errors.push('Unexpected browser dialog: '+dialog.type());dialog.dismiss()});
    const date='2026-10-15';
    let todos=[{id:'ui-todo',title:'核对实验结果',project:'示例项目',due:date,priority:'普通',done:false},...['整理论文实验','复核对照结果'].map((title,i)=>({id:'ui-extra-'+i,title,project:'示例项目',due:date,priority:'普通',done:false}))];
    todos.push({id:'ui-urgent',title:'今天的紧急事项',due:date,priority:'紧急',done:false},
      {id:'ui-next',title:'明天的事项',due:'2026-10-16',priority:'普通',done:false},
      {id:'ui-yesterday',title:'昨天未完成的事项',due:'2026-10-14',priority:'低',done:false},
      {id:'ui-old',title:'较早的事项',due:'2026-08-04',priority:'高',done:false},
      {id:'ui-no-date',title:'未设置日期',due:'',priority:'紧急',done:false},
      {id:'ui-done',title:'保留的已完成事项',due:'2020-01-01',priority:'普通',done:true});
    let writes=0,docWrites=0,draftReads=0,failSave=false,failWrite=false,failDocId='',failTodoId='',cleanupCalls=0,failBootstrapOnce=false,bootstrapFailures=0;
    const deletedDocs=new Set();
    const doc=(kind,id,title)=>({id,kind,title,status:kind==='milestone'?'进行中':'记录',due:date,record_date:date,created:date,updated:date,project:'示例项目',projects:['示例项目'],tags:[],kind_marks:['knowledge','method'],body:'# '+title+'\n\n用于验证文档直达。',path:'Knowledge/'+id+'.md'});
    const milestone=doc('milestone','ui-milestone','打开这一份里程碑文档');
    const journal=doc('journal','ui-journal','有两种分类的实验记录');
    const milestoneRows=Array.from({length:14},(_,i)=>{
      const day=String(i+8).padStart(2,'0');
      return day==='15'?milestone:{...doc('milestone','ui-ms-'+day,'研究节点 '+day),due:'2026-10-'+day,status:['完成','进行中','计划','受阻'][i%4]};
    });
    const longTitle='研究内容标题需要允许换行并且最多显示两行，在更长的情况下才显示省略号，避免标题在第一行就被截断';
    const otherJournals=[journal,doc('journal','ui-journal-2','另一份实验记录'),doc('journal','ui-journal-3','第三份实验记录')];
    const recentDocs=['idea','note','summary'].flatMap(kind=>Array.from({length:5},(_,i)=>({...doc(kind,'ui-recent-'+kind+i,({idea:'灵感',note:'笔记',summary:'工作总结'}[kind])+'·'+longTitle+' '+i),project:['模型推理优化','联邦学习系统','科研工作台性能测试'][i%3],status:({idea:['探索中','已采纳','已归档','待整理','探索中'],note:['稳定','整理中','草稿','已归档','稳定'],summary:['已定稿','草稿','已归档','已定稿','草稿']}[kind])[i]})));
    const literatureEditor={...doc('literature','ui-lit-editor','完整元数据的文献'),authors:'Research Team',year:'2026',venue:'Research Conference',doi:'10.0000/test',url:'https://example.invalid/paper',cite_key:'qa_paper',bibtex:'@article{qa_paper,\n'+Array.from({length:12},(_,i)=>`  field${i} = {value},`).join('\n')+'\n}'};
    const docRecords=[...milestoneRows,...otherJournals,...recentDocs,literatureEditor];
    const paper={id:'ui-paper',title:'Dark workspace readability',authors:'Research Team',year:2026,reading_status:'在读',kind_marks:['knowledge','method'],tags:[],stored_filename:'ui-paper.pdf',last_page:1};
    const agentSession={id:'ui-agent-session',title:'实验设计与结果分析',updated:date,message_count:2,messages:[
      {role:'user',content:'请分析这组实验结果，检查 **可复现性**。',created:date},
      {role:'assistant',content:'## 分析建议\n\n先对照基线，再检查实验参数。\n\n`seed = 42`\n\n| 指标 | 结果 |\n| --- | --- |\n| 准确率 | 93% |',reasoning:'核对数据和参数，再比较结果。',created:date},
    ]};
    const days=Array.from({length:14},(_,i)=>({date:`2026-10-${String(i+2).padStart(2,'0')}`,count:i%4,breakdown:{todo_done:i===13?2:0}}));
    const projectStats=Array.from({length:6},(_,i)=>({id:'proj_internal_'+i,name:'研究项目 '+(i+1),description:'验证模型质量、实验结果与研究进展。',status:'进行中',docs:19,open_todos:4,milestones:3,literature:5,last_updated:date,created:'2025-12-10'}));
    const projectCards=projectStats.map((p,i)=>({...p,name:i===1?'一个需要占据两行的较长研究项目名称以检验卡片对齐':p.name,description:['简短描述。','研究长文本建模、实验验证、数据对照与结果复核，覆盖更多内容以检验两行描述的高度及省略效果。',''][i%3]}));
    const fixtureDashboard={today:date,academic:{configured:true,percent:43.4,start_date:'2024-09-05',expected_end_date:'2029-07-15',elapsed_days:770,remaining_days:1004,weekly_goal_days:5,conditions_total:1,conditions_done:0,graduation_conditions:[{label:'期刊论文',current:1,target:3,percent:33}]},counts:{journal:1,note:1,literature:0,milestone:1},recent:{ideas:[],notes:[doc('note','ui-note','研究笔记')],summaries:[]},project_stats:projectStats,upcoming_milestones:[milestone,...Array.from({length:4},(_,i)=>doc('milestone','ui-extra-ms-'+i,'下一阶段研究节点 '+(i+1)))],activity:{days,start:'2026-10-02',end:date,events_month:20,active_days_month:8}};
    let syncRuns=0,syncChecks=0,syncResolves=0;
    const syncState={config:{mode:'off',url:'',interval:30,scopes:['documents','attachments','records','settings']},phase:'idle',upload:0,download:0,conflicts:0,changes:[],preferences:{},applied:0,remote_known:false};
    await page.addInitScript(()=>{
      localStorage.setItem('sidebarOpen',JSON.stringify(['core','research','resources','system']));
      localStorage.setItem('sidebarPinned',JSON.stringify(['core']));
      localStorage.setItem('uiScale','100');
      localStorage.setItem('fabBallPos',JSON.stringify({x:1548,y:300}));
    });
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      const send=data=>route.fulfill({json:data});
      if(url.pathname.startsWith('/api/sync/')){
        const action=url.pathname.split('/').pop();
        if(action==='preferences'){Object.assign(syncState.preferences,request.postDataJSON());return send(syncState.preferences)}
        if(action==='guard')return send({ok:true});
        if(action==='config'){syncState.config=request.postDataJSON();return send(syncState)}
        if(action==='test')return send({ok:true,count:25});
        if(action==='run'){syncRuns++;syncState.phase='synced';syncState.last_success=Date.now()/1000;return send(syncState)}
        if(action==='check'){syncChecks++;return send(syncState)}
        if(action==='resolve'){syncResolves++;syncState.conflicts=0;syncState.changes=[];return send(syncState)}
        if(action==='conflict')return send({key:'doc:ui-journal',label:'实验记录',local_hash:'test-hash',remote_version:4,local:{text:'本地修改\n# 实验记录',editable:true},remote:{text:'服务器修改\n# 实验记录'},base:{text:'共同版本'},can_keep_both:true});
        return send(syncState);
      }
      if(url.pathname==='/api/dashboard')return send(fixtureDashboard);
      if(url.pathname==='/api/todos/batch-delete'){
        const body=request.postDataJSON();if(body.completed_only)cleanupCalls++;
        const removed=body.ids.filter(id=>id!==failTodoId&&todos.some(t=>t.id===id&&(!body.completed_only||t.done)));
        todos=todos.filter(t=>!removed.includes(t.id));
        return send({deleted:removed,failed:body.ids.filter(id=>!removed.includes(id)).map(id=>({id,message:'模拟删除失败'}))});
      }
      if(url.pathname==='/api/docs/batch-delete'){
        const ids=request.postDataJSON().ids,removed=ids.filter(id=>id!==failDocId);
        removed.forEach(id=>deletedDocs.add(id));
        return send({deleted:removed,failed:ids.filter(id=>!removed.includes(id)).map(id=>({id,message:'模拟删除失败'}))});
      }
      if(url.pathname==='/api/todos'&&method==='GET')return send(todos);
      if(url.pathname==='/api/todos'&&method==='POST'){
        writes++;const t={...request.postDataJSON(),id:'ui-new-todo',done:false};todos.push(t);return send(t);
      }
      if(url.pathname.startsWith('/api/todos/')&&method==='POST'){
        writes++;if(failWrite)return route.fulfill({status:500,json:{message:'模拟保存失败'}});
        const t=todos.find(t=>t.id===decodeURIComponent(url.pathname.split('/').pop()));Object.assign(t,request.postDataJSON());return send(t);
      }
      if(url.pathname==='/api/docs/draft'){
        draftReads++;const kind=url.searchParams.get('kind');
        return send({...doc(kind,'ui-draft-'+draftReads,'未命名文档'),path:'',draft:true,body:'# 未命名文档\n\n## 研究记录\n\n'});
      }
      if(url.pathname==='/api/docs'&&method==='POST'){
        if(failSave)return route.fulfill({status:500,json:{message:'模拟保存失败'}});
        docWrites++;const body=request.postDataJSON(),saved={...doc(body.kind,'ui-saved-'+docWrites,body.title),...body};docRecords.push(saved);return send(saved);
      }
      if(url.pathname.startsWith('/api/docs/')&&method==='POST'&&url.pathname!=='/api/docs/batch-delete'){
        if(failSave)return route.fulfill({status:500,json:{message:'模拟保存失败'}});
        docWrites++;const saved=docRecords.find(d=>d.id===decodeURIComponent(url.pathname.split('/').pop()));Object.assign(saved,request.postDataJSON());return send(saved);
      }
      if(url.pathname==='/api/docs'){
        const kind=url.searchParams.get('kind'),scope=url.searchParams.get('scope');
        const rows=docRecords.filter(d=>!deletedDocs.has(d.id)&&(!kind||d.kind===kind));
        const pageNum=Number(url.searchParams.get('page')||1),size=scope==='overview'?6:kind==='journal'?2:200;
        const pages=Math.max(1,Math.ceil(rows.length/size));
        return send({items:rows.slice((pageNum-1)*size,pageNum*size),total:rows.length,page:pageNum,pages,page_size:size,next_page:pageNum<pages?pageNum+1:null,prev_page:pageNum>1?pageNum-1:null});
      }
      if(url.pathname.startsWith('/api/docs/'))return send(docRecords.find(d=>d.id===decodeURIComponent(url.pathname.split('/').pop()))||journal);
      if(url.pathname==='/api/graph')return send({nodes:[{...journal,label:journal.title},{...milestone,label:milestone.title}],edges:[{source:journal.id,target:milestone.id,kind:'wikilink'}],meta:{total_documents:2,shown_documents:2}});
      if(url.pathname==='/api/graph/bundle')return send({content:'# 关联资料汇总\n\n'+Array.from({length:80},(_,i)=>`## 研究条目 ${i+1}\n\n包含完整的研究记录与关联 Markdown 内容。\n`).join('\n')});
      if(url.pathname==='/api/agent/sessions')return send([agentSession]);
      if(url.pathname==='/api/agent/sessions/'+agentSession.id)return send(agentSession);
      if(url.pathname==='/api/literature')return send({items:[paper],total:1});
      if(url.pathname==='/api/literature/'+paper.id){if(method==='POST')Object.assign(paper,request.postDataJSON());return send(paper)}
      if(url.pathname==='/api/literature/'+paper.id+'/annotations')return send([]);
      if(url.pathname==='/api/literature/'+paper.id+'/note')return send({content:'# 文献笔记\n\n核对实验设置。'});
      if(url.pathname==='/api/system/reload')return send({ok:true});
      if(url.pathname==='/api/config'){
        const cfg={app:{app_name:'科研工作台',subtitle:'Engineering Research Workspace',ui:{graph_default_view:'3d'},academic_profile:{graduation_conditions:[{label:'论文',current:1,target:3,unit:'篇'}]},llm:{enabled:false,active_profile_id:'qa',profiles:[{id:'qa',name:'测试配置',base_url:'https://example.invalid/v1',request_presets:[{id:'default',label:'默认',model:'qa'}]}]}},rss:{sources:[{name:'测试资讯',url:'https://example.invalid/rss',enabled:true}]},weather:{enabled:false}};
        cfg.app.classification_marks=[{id:'knowledge',label:'知识',icon:'◈',color:'#2a9d8f'},{id:'method',label:'方法',icon:'⚒',color:'#e76f51'}];
        return send(cfg);
      }
      if(url.pathname==='/api/knowledge-types'){
        if(failBootstrapOnce){failBootstrapOnce=false;bootstrapFailures++;return route.abort('failed')}
        return send(['idea','journal','note','milestone','summary','literature'].map((id,i)=>({id,label:['灵感','实验记录','笔记','里程碑','工作总结','文献'][i],builtin:true,statuses:['草稿','记录'],template:'# {{title}}\n\n## 要点\n',default_template:'# {{title}}\n'})));
      }
      if(url.pathname==='/api/statuses')return send({journal:['记录'],milestone:['进行中','完成','计划','受阻'],note:['记录']});
      if(url.pathname==='/api/projects')return send(['示例项目']);
      if(url.pathname==='/api/project-records')return send(projectCards);
      if(url.pathname==='/api/billing/summary')return send({total:{calls:3,total_tokens:9000,prompt_tokens:7000,completion_tokens:2000,cached_tokens:3500,cache_hit_rate:.5,unpriced_calls:3},by_session:[{title:'研究对话',calls:2,total_tokens:8000},{title:'阅读助手',calls:1,total_tokens:1000}],by_model:[{model:'qa-model',calls:3,total_tokens:9000,unpriced_calls:3}],by_date:[{date,calls:3,total_tokens:9000}],unpriced:[{profile_name:'测试配置',model:'qa-model',calls:3,total_tokens:9000,suggested_key:'qa/qa-model'}]});
      if(url.pathname==='/api/billing/prices')return send({currency:'USD',models:{},plans:{}});
      if(url.pathname==='/api/billing/records')return send({total:2,items:[{ts:date,session_title:'研究对话',model:'qa-model',prompt_tokens:4000,completion_tokens:1000},{ts:date,session_title:'阅读助手',model:'qa-model',prompt_tokens:3000,completion_tokens:1000}]});
      if(url.pathname==='/api/health')return send({version:'ui-test'});
      if(url.pathname==='/api/workspace/info')return send({relative:'Test Workspace'});
      if(url.pathname.startsWith('/api/weather'))return send({enabled:false});
      if(method!=='GET')throw new Error('Unexpected write: '+method+' '+url.pathname);
      return send([]);
    });
    const ready=()=>page.waitForSelector('.overview-todo-add');
    const go=async route=>{await page.locator(`#sidebar-nav [data-route="${route}"]`).click();await page.waitForFunction(r=>document.documentElement.dataset.route===r,route)};
    const respond=async(trigger,result='confirm')=>{const work=trigger();await page.waitForSelector('#workbench-dialog');await page.locator(`[data-dialog-result="${result}"]`).click();await page.waitForSelector('#workbench-dialog',{state:'detached'});await work};
    const shot=name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
    const smallText=()=>page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>e.children.length===0&&e.textContent.trim()&&e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>({class:e.className,size:getComputedStyle(e).fontSize,text:e.textContent.slice(0,30)})));
    await page.goto(base);await ready();
    assert.deepEqual(libraryRequests,[], 'Plain overview should not load math or diagram libraries');
    await page.waitForFunction(()=>document.querySelector('.overview-milestone-list')?.scrollTop>0);
    const aligned=async selectors=>{
      await page.mouse.move(5,5);
      const boxes=await Promise.all(selectors.map(s=>page.locator(s).boundingBox()));
      for(const b of boxes){assert(Math.abs(b.y-boxes[0].y)<2,'card tops align: '+selectors);assert(Math.abs(b.y+b.height-boxes[0].y-boxes[0].height)<2,'card bottoms align: '+selectors)}
    };
    const checkBands=async()=>{
      await aligned(['.heatmap-card','.overview-academic-grid']);
      await aligned(['.rhythm-card','.overview-task-card','.overview-milestone-card']);
      await aligned(['.overview-lower-left','.overview-recent-section']);
      await aligned(['.overview-today','.quick-capture-card']);
    };
    await checkBands();
    const taskIds=await page.locator('[data-overview-check]').evaluateAll(es=>es.map(e=>e.dataset.overviewCheck));
    assert.equal(taskIds.length,todos.filter(t=>!t.done).length);
    assert.equal(taskIds[0],'ui-urgent','same-date urgent tasks come first');
    assert(taskIds.indexOf('ui-next')<taskIds.indexOf('ui-old'),'near dates precede distant overdue dates');
    assert.equal(taskIds.at(-1),'ui-no-date','undated tasks come last');
    assert.equal(await page.locator('.overview-milestone-row').count(),milestoneRows.length,'all milestone pages are loaded');
    const windowMetrics=await page.evaluate(()=>['.overview-task-list','.overview-milestone-list'].map(s=>{const e=document.querySelector(s);return {height:e.clientHeight,scroll:e.scrollHeight,row:e.querySelector('.overview-task-row,.overview-milestone-row').offsetHeight}}));
    for(const m of windowMetrics){assert.equal(m.height,m.row*5);assert(m.scroll>m.height)}
    assert(await page.locator('.overview-milestone-list').evaluate(e=>{const r=e.querySelector('.is-nearest');return Math.abs(r.offsetTop-e.scrollTop+r.offsetHeight/2-e.clientHeight/2)<2}),'nearest milestone occupies the center row');
    const taskList=page.locator('.overview-task-list');
    await taskList.hover();await page.mouse.wheel(0,280);await page.waitForTimeout(100);assert(await taskList.evaluate(e=>e.scrollTop>0));
    await taskList.evaluate(e=>e.scrollTop=0);
    await page.waitForSelector('[data-recent-expanded="done"] .recent-activity-row');
    const titleStyle=await page.locator('.recent-card .row-title').first().evaluate(e=>({clamp:getComputedStyle(e).webkitLineClamp,white:getComputedStyle(e).whiteSpace,height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight)}));
    assert.equal(titleStyle.clamp,'2');assert.equal(titleStyle.white,'normal');assert(titleStyle.height<=titleStyle.line*2+1);
    assert((await page.locator('.recent-card-head').first().boundingBox()).height<=32);
    assert.equal(await page.locator('.overview-recent-group>.recent-card').count(),3,'activity cards retain the three-column layout');
    assert.equal(await page.locator('.recent-status').count(),15);
    assert(!(await page.locator('.recent-card-ideas .row-title').first().innerText()).startsWith('灵感·'));
    assert.equal(cleanupCalls,0,'completed tasks are retained until manual cleanup');
    console.log('PASS: aligned bands, five-row scrolling, task date/priority order, centered complete milestone history and two-line recent titles');
    assert.equal(await page.locator('[data-route="projects"]').count(),1);
    assert.equal(await page.locator('[data-route="research-overview"]').count(),0);
    const type=await page.evaluate(()=>({group:parseFloat(getComputedStyle(document.querySelector('.group-toggle')).fontSize),item:parseFloat(getComputedStyle(document.querySelector('.nav-item')).fontSize),weight:parseFloat(getComputedStyle(document.querySelector('.group-toggle')).fontWeight)}));
    assert(type.group<type.item&&type.weight>=600);
    assert.equal(await page.locator('.rhythm-day').count(),7);
    assert((await page.locator('.rhythm-goal').innerText()).includes('2'));
    await shot('overview');
    assert.equal(await page.locator('#page-eyebrow').count(),0);
    assert(!(await page.locator('#main').innerText()).includes('把学业周期'));
    const checkHeading=async()=>{
      const bar=await page.locator('.topbar').boundingBox();
      for(const selector of ['#page-title','#page-date']){const box=await page.locator(selector).boundingBox();assert(box.y>=bar.y&&box.y+box.height<=bar.y+bar.height+1,selector+' fits inside topbar')}
    };
    await checkHeading();
    assert((await page.locator('.overview-top-row').boundingBox()).height<260,'top cards have no forced empty height');
    assert((await page.locator('.overview-ops-grid').boundingBox()).height<360,'operations stay compact');
    await page.setViewportSize({width:2550,height:1233});await page.waitForTimeout(180);await checkHeading();await checkBands();await shot('overview-wide');
    await page.setViewportSize({width:1600,height:1000});await page.waitForTimeout(180);
    const small=await smallText();assert.deepEqual(small,[],'overview text is at least 11px');
    const recentNote=page.locator('.recent-card-notes .recent-activity-row').first(),recentId=await recentNote.getAttribute('data-open-doc');
    await recentNote.click();await page.waitForFunction(id=>window.ERWCurrentDoc===id,recentId);
    assert.equal(await page.locator('#f-title').inputValue(),docRecords.find(d=>d.id===recentId).title);
    await go('overview');await ready();
    for(let i=0;i<2;i++){
      await go('projects');await page.waitForSelector('.project-manager');
      assert.equal(await page.locator('.project-id,.project-id-note').count(),0);
      assert(!(await page.locator('#main').innerText()).includes('proj_internal_'));
      assert((await page.locator('.project-manager-head').boundingBox()).height<65);
      assert((await page.locator('.project-manager-card').first().boundingBox()).height<240);
      const heights=await page.locator('.project-manager-card').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));
      assert(Math.max(...heights)-Math.min(...heights)<1,'short, long and empty descriptions use equal card heights');
      const rows=await page.locator('.project-manager-card').evaluateAll(es=>es.map(e=>({top:e.offsetTop,metrics:e.querySelector('.project-card-metrics').offsetTop,actions:e.querySelector('.project-card-actions').offsetTop})));
      for(const row of rows){const peers=rows.filter(x=>x.top===row.top);assert(Math.max(...peers.map(x=>x.metrics))-Math.min(...peers.map(x=>x.metrics))<1);assert(Math.max(...peers.map(x=>x.actions))-Math.min(...peers.map(x=>x.actions))<1)}
      if(i===0){await shot('projects');await page.locator('[data-project-edit]').first().click();assert(!(await page.locator('#modal-body').innerText()).includes('proj_internal_'));await page.locator('#pm-cancel').click()}
      await go('overview');await ready();assert.equal(await page.locator('[data-route="projects"]').count(),1);
    }
    console.log('PASS: stable project navigation and sidebar hierarchy');

    await page.locator('#overview-todo-title').fill('新增研究任务');await page.locator('#overview-todo-title').press('Enter');
    await page.waitForSelector('[data-overview-check="ui-new-todo"]');assert.equal(writes,1);
    await respond(()=>page.locator('[data-overview-check="ui-todo"]').click(),'cancel');
    assert.equal(await page.locator('[data-overview-check="ui-todo"]').isChecked(),false);assert.equal(writes,1);
    await respond(()=>page.locator('[data-overview-check="ui-todo"]').click(),'confirm');
    await page.waitForFunction(()=>!document.querySelector('[data-overview-check="ui-todo"]'));assert.equal(writes,2);
    failWrite=true;await respond(()=>page.locator('[data-overview-check="ui-new-todo"]').click(),'confirm');
    await page.waitForFunction(()=>document.querySelector('[data-overview-check="ui-new-todo"]')?.disabled===false);
    assert.equal(await page.locator('[data-overview-check="ui-new-todo"]').isChecked(),false);failWrite=false;
    console.log('PASS: inline Todo add, completion confirmation, cancellation and failed-save recovery');

    await page.locator('[data-open-doc="ui-milestone"]').click();await page.waitForSelector('#f-title');
    assert.equal(await page.locator('#f-title').inputValue(),milestone.title);assert.equal(await page.locator('#md-input').inputValue(),milestone.body);
    assert.equal(await page.locator('[data-ms-view="docs"].active').count(),1);
    await go('journals');await page.waitForSelector('[data-doc-kind="journal"] .doc-compact-meta .mark-badge');
    assert.equal(await page.locator('.doc-item').first().locator('.mark-badge').count(),2);
    const colors=await page.locator('.doc-compact-meta .mark-badge').evaluateAll(es=>es.map(e=>({color:getComputedStyle(e).color,border:getComputedStyle(e).borderTopColor,radius:getComputedStyle(e).borderRadius})));
    assert.notEqual(colors[0].color,colors[1].color);assert.notEqual(colors[0].border,colors[1].border);assert.equal(colors[0].radius,'5px');
    await shot('document');assert.deepEqual(await smallText(),[],'document controls are at least 11px');
    assert.equal(await page.locator('#doc-selection-toolbar').isVisible(),false);
    assert.equal(await page.locator('[data-doc-pick]').first().isVisible(),false);
    const plus=await page.locator('#new-doc').boundingBox(),trash=await page.locator('#doc-batch-toggle').boundingBox();
    assert(Math.abs(plus.y-trash.y)<2&&trash.x>=plus.x+plus.width&&trash.x-plus.x-plus.width<10,'batch entry sits next to the plus button');
    const savedBody=await page.locator('#md-input').inputValue();await page.locator('#md-input').fill(savedBody+'\n未保存的编辑');
    await page.locator('#doc-batch-toggle').click();
    assert.equal(await page.locator('#doc-selection-toolbar').isVisible(),true);
    assert.equal(await page.locator('[data-doc-pick]').first().isVisible(),true);
    assert((await page.locator('#md-input').inputValue()).includes('未保存的编辑'),'entering selection preserves unsaved edits');
    await page.locator('[data-doc-pick]').first().check();await page.locator('#doc-clear-selection').click();
    assert.equal(await page.locator('#doc-selection-toolbar').isVisible(),false);
    assert.equal(await page.locator('[data-doc-pick]:checked').count(),0);
    assert((await page.locator('#md-input').inputValue()).includes('未保存的编辑'),'exiting selection preserves unsaved edits');
    await page.locator('#doc-batch-toggle').click();
    await page.locator('#doc-select-all').check();
    assert.equal(await page.locator('[data-doc-pick]:checked').count(),2);
    await page.locator('[data-perf-page="next"]').click();await page.waitForSelector('[data-doc-pick="ui-journal-3"]');
    await page.locator('[data-doc-pick="ui-journal-3"]').check();
    assert.equal(await page.locator('#doc-selected-count').innerText(),'已选 3 条');
    await respond(()=>page.locator('#doc-delete-selected').click(),'cancel');assert.equal(deletedDocs.size,0);
    failDocId='ui-journal-2';await respond(()=>page.locator('#doc-delete-selected').click(),'confirm');
    await page.waitForFunction(()=>document.querySelector('#doc-selected-count')?.textContent==='已选 1 条');
    assert(deletedDocs.has('ui-journal')&&deletedDocs.has('ui-journal-3'));
    assert.equal(await page.locator('[data-doc-pick="ui-journal-2"]').isChecked(),true,'failed deletion stays selected after pagination clamps');
    assert.equal(await page.locator('#md-input').count(),0,'deleted active document is removed from the editor');
    failDocId='';await respond(()=>page.locator('#doc-delete-selected').click(),'confirm');
    await page.waitForFunction(()=>document.querySelector('#doc-selected-count')?.textContent==='已选 0 条');
    assert.equal(await page.locator('[data-doc-pick]').count(),0);
    assert.equal(await page.locator('#doc-selection-toolbar').isVisible(),false,'successful deletion returns to normal browsing');
    console.log('PASS: cross-page document selection, confirmation cancellation, partial failure retention and empty last-page recovery');

    await go('todos');await page.waitForSelector('#todo-clear-completed');
    assert.equal(await page.locator('#todo-selection-toolbar').isVisible(),false);
    assert.equal(await page.locator('[data-todo-pick]').first().isVisible(),false);
    const add=await page.locator('#todo-add').boundingBox(),todoTrash=await page.locator('#todo-batch-toggle').boundingBox();
    assert(Math.abs(add.y-todoTrash.y)<2&&todoTrash.x>=add.x+add.width,'Todo batch entry sits beside Add');
    await respond(()=>page.locator('[data-todo-check="ui-next"]').click(),'cancel');
    assert.equal(await page.locator('[data-todo-check="ui-next"]').getAttribute('aria-checked'),'false');
    await respond(()=>page.locator('[data-todo-check="ui-next"]').click(),'confirm');
    await page.waitForFunction(()=>document.querySelector('[data-todo-check="ui-next"]')?.getAttribute('aria-checked')==='true');
    const pendingBefore=todos.filter(t=>!t.done).map(t=>t.id);
    await respond(()=>page.locator('#todo-clear-completed').click(),'cancel');assert.equal(cleanupCalls,0);
    await respond(()=>page.locator('#todo-clear-completed').click(),'confirm');
    await page.waitForFunction(()=>document.querySelector('#todo-clear-completed')?.disabled===true);
    assert.equal(cleanupCalls,1);assert.deepEqual(todos.map(t=>t.id),pendingBefore,'manual cleanup preserves all pending tasks');
    await page.locator('#todo-batch-toggle').click();
    await page.locator('[data-todo-pick="ui-extra-0"]').check();await page.locator('[data-todo-pick="ui-extra-1"]').check();
    failTodoId='ui-extra-1';await respond(()=>page.locator('#todo-delete-selected').click(),'confirm');
    await page.waitForFunction(()=>document.querySelector('#todo-selected-count')?.textContent==='已选 1 条');
    assert(!todos.some(t=>t.id==='ui-extra-0'));assert(todos.some(t=>t.id===failTodoId));
    assert.equal(await page.locator('[data-todo-pick="ui-extra-1"]').isChecked(),true);
    await page.locator('#todo-clear-selection').click();failTodoId='';
    assert.equal(await page.locator('#todo-selection-toolbar').isVisible(),false);
    assert.equal(await page.locator('[data-todo-pick]').first().isVisible(),false);
    await shot('todo-batch');
    console.log('PASS: Todo multiselect deletion and explicit manual-only completed cleanup');
    const beforeGraph=graphRequests.length;
    await go('graph');await page.waitForSelector('#graph-smart-toolbar');
    assert.equal(graphRequests.length-beforeGraph,1,'Graph page should fetch data exactly once');
    assert.equal(await page.locator('#graph-smart-toolbar').count(),1);
    await page.evaluate(async()=>{
      const first=document.createElement('div'),second=document.createElement('div');
      first.id='qa-lazy-markdown';second.id='qa-lazy-math';
      first.className=second.className='md-preview';document.body.append(first,second);
      second.textContent='$$a^2+b^2=c^2$$';
      await Promise.all([
        window.ERWMarkdown.renderInto(first,'$$E=mc^2$$\n\n```mermaid\nflowchart LR\n A --> B\n```'),
        window.ERWRenderLibraries.renderMath([second]),
      ]);
    });
    assert.equal(await page.locator('#qa-lazy-markdown .mermaid svg').count(),1);
    assert.equal(await page.locator('#qa-lazy-markdown mjx-container svg').count(),1);
    assert.equal(await page.locator('#qa-lazy-math mjx-container svg').count(),1);
    assert.equal(libraryRequests.filter(url=>url.includes('mathjax')).length,1);
    assert.equal(libraryRequests.filter(url=>url.includes('mermaid')).length,1);
    await page.locator('#qa-lazy-markdown').evaluate(node=>node.remove());
    await page.locator('#qa-lazy-math').evaluate(node=>node.remove());
    console.log('PASS: graph fetches once; math and diagrams load once on demand');
    assert.equal(await page.locator('[data-gview]').count(),0);assert.equal(await page.locator('.graph-view-label').innerText(),'关系网络');
    console.log('PASS: milestone document opens directly, multicolor classification badges, single graph view');

    await go('overview');await ready();await page.mouse.move(500,200);
    await page.waitForTimeout(800);
    const ball=page.locator('#erw-fab-ball');
    const b=await ball.boundingBox();assert(Math.abs(b.x+b.width/2-1600)<3,'right dock exposes half the ball');
    await ball.hover();await page.waitForTimeout(250);const revealed=await ball.boundingBox();assert(revealed.x+revealed.width<=1601);
    await page.mouse.move(revealed.x+26,revealed.y+26);await page.mouse.down();await page.mouse.move(10,400,{steps:12});await page.mouse.up();await page.mouse.move(500,200);await page.waitForTimeout(800);
    const left=await ball.boundingBox();assert(Math.abs(left.x+left.width/2)<3,'left dock exposes half the ball');
    await ball.hover();await page.waitForTimeout(250);await ball.click();await page.waitForSelector('#erw-fab-panel:not([hidden])');
    assert.equal(await page.locator('[data-resize-edge]').count(),8);
    const panel=page.locator('#erw-fab-panel');
    const checkAssistantRow=async()=>{const boxes=await Promise.all(['#fab-persona','#fab-history','#fab-new','#fab-close'].map(s=>page.locator(s).boundingBox()));const panelBox=await panel.boundingBox();const mid=boxes[0].y+boxes[0].height/2;for(const b of boxes){assert(Math.abs(b.y+b.height/2-mid)<2,'assistant controls share one row');assert(b.x>=panelBox.x&&b.x+b.width<=panelBox.x+panelBox.width,'assistant controls fit inside panel')}};
    await checkAssistantRow();
    const resize=async(edge,dx,dy)=>{const h=await page.locator(`[data-resize-edge="${edge}"]`).boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+dx,h.y+h.height/2+dy,{steps:6});await page.mouse.up()};
    let before=await panel.boundingBox();await resize('nw',-100,-50);let after=await panel.boundingBox();assert(after.width>before.width+70&&after.height>before.height+30);
    await checkAssistantRow();
    before=after;await resize('w',-50,0);after=await panel.boundingBox();assert(after.width>before.width+30);
    for(const edge of ['n','e','s','w','ne','nw','se','sw']){
      before=await panel.boundingBox();
      await resize(edge,edge.includes('e')?-15:edge.includes('w')?15:0,edge.includes('s')?-15:edge.includes('n')?15:0);
      after=await panel.boundingBox();
      if(/[ew]/.test(edge))assert(after.width<before.width-10,edge+' changes width');
      if(/[ns]/.test(edge))assert(after.height<before.height-10,edge+' changes height');
    }
    await page.locator('#fab-close').click();await ball.hover();await ball.click();const restored=await panel.boundingBox();assert(Math.abs(restored.width-after.width)<3);
    await resize('w',-420,0);await checkAssistantRow();await shot('assistant-wide');
    await resize('w',700,0);await checkAssistantRow();
    assert((await panel.locator('.fab-head').boundingBox()).height<50,'assistant header stays compact at minimum width');
    await shot('assistant');await page.locator('#fab-close').click();
    await page.locator('#zoom-btn').click();await page.locator('[data-zoom="125"]').click();await ball.hover();await ball.click();
    await checkBands();
    console.log('Heatmap zoom:',await page.evaluate(()=>['.heatmap-card','.heatmap-scroll','.heatmap-plot','.heatmap-stage','.heatmap-cells','.heatmap-axis'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return [s,e.clientHeight,e.scrollHeight,c.height,c.maxHeight,c.minHeight,c.overflowY]})));
    await shot('overview-zoom125');
    assert(await page.locator('.heatmap-scroll').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'all seven heatmap rows fit after zoom');
    const z=await panel.boundingBox();assert(z.x>=0&&z.y>=0&&z.x+z.width<=1601&&z.y+z.height<=1001,'zoomed panel stays on screen');
    before=z;await resize('w',-50,0);after=await panel.boundingBox();assert(after.width>before.width+30);
    await checkAssistantRow();
    await page.locator('#fab-close').click();
    console.log('PASS: left/right half docking, hover reveal, all resize handles, persistence and 125% zoom');

    await page.locator('#zoom-btn').click();await page.locator('[data-zoom="100"]').click();
    await checkHeading();
    await page.setViewportSize({width:1100,height:900});await shot('overview-1100');
    await page.setViewportSize({width:760,height:1000});await shot('overview-760');
    console.log('Narrow layout:',await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,overflow:Array.from(document.querySelectorAll('#app *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='fixed'&&!e.closest('#sidebar-nav')).slice(0,12).map(e=>[e.className,e.getBoundingClientRect().right])})));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow on narrow viewport');
    assert((await page.locator('.sidebar').boundingBox()).height<160,'narrow-screen navigation stays compact');
    await page.goto(base+'/#research-overview');await ready();assert.equal(new URL(page.url()).hash,'#overview');
    assert.equal(await page.locator('#desktop-titlebar').isVisible(),false,'browser mode has no desktop chrome');
    deletedDocs.clear();
    await page.addInitScript(()=>{
      const state={title:'科研工作台',tray_available:true,maximized:false,hidden:false,close_action:localStorage.getItem('qa-close-action')||'tray'};
      window.__desktopCommands=[];
      const invoke=(name,update={})=>{window.__desktopCommands.push(name);Object.assign(state,update);return Promise.resolve({...state})};
      window.pywebview={api:{
        desktop_get_state:()=>Promise.resolve({...state}),
        desktop_hide:()=>invoke('hide',{hidden:true}),
        desktop_minimize:()=>invoke('minimize',{hidden:true}),
        desktop_close:()=>invoke('close:'+state.close_action,{hidden:state.close_action==='tray'}),
        desktop_set_close_action:action=>{localStorage.setItem('qa-close-action',action);return invoke('preference:'+action,{close_action:action})},
        desktop_toggle_maximize:()=>invoke('maximize',{maximized:!state.maximized}),
        desktop_resize:edge=>invoke('resize:'+edge),
      }};
    });
    await page.setViewportSize({width:1600,height:1000});
    failBootstrapOnce=true;
    await page.goto(base);await ready();
    assert.equal(bootstrapFailures,1,'a temporary bootstrap read failure recovers automatically');
    await page.waitForSelector('html[data-desktop="true"]');
    const chrome=page.locator('#desktop-titlebar');
    assert.equal(await chrome.isVisible(),true);
    assert.equal(Math.round((await chrome.boundingBox()).height),48);
    assert.equal(await page.locator('[data-desktop-resize]').count(),8);
    assert((await page.locator('#app').boundingBox()).y>=48,'content starts below native chrome');
    const controlBoxes=await Promise.all(['#desktop-minimize','#desktop-maximize','#desktop-close'].map(s=>page.locator(s).boundingBox()));
    assert(controlBoxes[0].x<controlBoxes[1].x&&controlBoxes[1].x<controlBoxes[2].x,'Windows controls use the right-side order');
    assert(controlBoxes[2].x+controlBoxes[2].width>=1599,'close control sits at the right edge');
    assert.equal(await page.locator('.desktop-traffic-lights').count(),0);
    assert.equal(Math.round((await page.locator('[data-group="core"] .nav-group-head').boundingBox()).height),36);
    assert.equal(Math.round((await page.locator('.nav-item[data-route="overview"]').boundingBox()).height),30);
    const researchToggle=page.locator('[data-group-toggle="research"]');
    const icon=page.locator('[data-group="research"] .group-disclosure');
    assert.equal(await researchToggle.getAttribute('aria-expanded'),'true');
    const openTransform=await icon.evaluate(e=>getComputedStyle(e).transform);
    await researchToggle.click();
    assert.equal(await researchToggle.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('[data-route="journals"]').isVisible(),false);
    const collapsedTransform=await icon.evaluate(e=>getComputedStyle(e).transform);
    assert.notEqual(collapsedTransform,openTransform,'diamond rotates with group state');
    await researchToggle.click();
    assert.equal(await researchToggle.getAttribute('aria-expanded'),'true');
    assert.equal(await icon.evaluate(e=>getComputedStyle(e).transform),openTransform);
    await page.locator('#desktop-maximize').click();
    await page.waitForSelector('html[data-window-maximized="true"]');
    assert.equal(await page.locator('[data-desktop-resize="e"]').isVisible(),false);
    await page.locator('.desktop-page-tools .page-heading').dblclick();
    await page.waitForSelector('html[data-window-maximized="false"]');
    assert.equal(await page.locator('[data-desktop-resize="e"]').isVisible(),true);
    await page.locator('#desktop-minimize').click();
    await go('settings');await page.locator('[data-set-tab="desktop"]').click();await page.waitForSelector('#desktop-close-action');
    await page.locator('#desktop-close-action').selectOption('quit');await page.locator('#desktop-settings-save').click();
    await page.waitForFunction(()=>document.querySelector('#desktop-close').title==='退出应用');
    await page.locator('#desktop-close').click();
    await page.locator('#desktop-close-action').selectOption('tray');await page.locator('#desktop-settings-save').click();
    await page.waitForFunction(()=>document.querySelector('#desktop-close').title.includes('托盘'));
    await shot('desktop-settings');
    await page.evaluate(()=>window.ERWNav.open('journal','ui-journal'));
    await page.waitForSelector('#md-input');
    await page.locator('#md-input').fill('# 未保存的桌面内容');
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),true);
    await page.locator('#desktop-close').click();
    assert.equal(await page.locator('#md-input').inputValue(),'# 未保存的桌面内容');
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),true);
    await shot('desktop-editor');
    // Navigate with the existing unsaved-document guard, then check shell zoom.
    await respond(()=>go('overview'),'discard');await ready();
    await shot('desktop-overview');
    await page.locator('#zoom-btn').click();await page.locator('[data-zoom="125"]').click();
    await page.waitForTimeout(150);
    assert.equal(Math.round((await chrome.boundingBox()).height),48,'titlebar height is stable under app zoom');
    assert((await page.locator('#app').boundingBox()).y>=47.9);
    assert(await page.evaluate(()=>Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--vh-px'))*1.25-(innerHeight-48))<1));
    await shot('desktop-zoom125');
    await page.locator('#zoom-btn').click();await page.locator('[data-zoom="100"]').click();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('workbench:window-state',{detail:{tray_available:false}})));
    assert((await page.locator('#desktop-close').getAttribute('title')).includes('任务栏'));
    await page.setViewportSize({width:1100,height:800});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(await page.evaluate(()=>window.__desktopCommands),['maximize','maximize','minimize','preference:quit','close:quit','preference:tray','close:tray']);
    await page.reload();await ready();
    await go('settings');await page.locator('[data-set-tab="desktop"]').click();await page.waitForSelector('#desktop-close-action');
    assert.equal(await page.locator('#desktop-close-action').inputValue(),'tray');
    console.log('PASS: right-side chrome, close preferences, rotating disclosure, swapped row heights and desktop zoom');
    await page.setViewportSize({width:1600,height:1000});
    assert.equal(await page.locator('#app .topbar').isVisible(),false,'old toolbar is removed from the desktop layout');
    for(const id of ['page-title','page-date','sidebar-toggle','weather-pill','theme-btn','density-btn','zoom-btn','reload-btn']){
      assert.equal(await chrome.locator('#'+id).count(),1,id+' moved to native titlebar');
      const bounds=await page.locator('#'+id).boundingBox();
      assert(bounds.y>=0&&bounds.y+bounds.height<=49,id+' fits in the single titlebar');
    }
    const refreshBox=await page.locator('#reload-btn').boundingBox(),minimizeBox=await page.locator('#desktop-minimize').boundingBox();
    assert(refreshBox.x+refreshBox.width<=minimizeBox.x+1&&minimizeBox.x-refreshBox.x-refreshBox.width<10,'refresh is beside minimize');
    assert.equal((await page.locator('#reload-btn').innerText()).trim(),'','refresh button is icon-only');
    await page.locator('#reload-btn').click();
    assert.equal(await page.locator('#reload-menu').isVisible(),true);
    assert.equal(await page.locator('#reload-btn').getAttribute('aria-expanded'),'true');
    await respond(()=>page.locator('[data-system-action="restart"]').click(),'cancel');
    assert.equal(await page.locator('#reload-menu').isVisible(),false,'canceling restart leaves the app open');
    await go('overview');await ready();
    await shot('single-titlebar-light');
    await page.locator('#theme-btn').click();
    await page.waitForSelector('html[data-theme="dark"]');
    await shot('single-titlebar-dark');
    const contrast=async selectors=>page.evaluate(selectors=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const rgb=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
      const blend=(front,back)=>front.slice(0,3).map((c,i)=>c*front[3]/255+back[i]*(1-front[3]/255));
      const luminance=values=>values.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector)).filter(el=>el.getClientRects().length).map(el=>{
        const layers=[];let bg=[17,24,39],node=el;
        while(node){const c=rgb(getComputedStyle(node).backgroundColor);layers.push(c);if(c[3]===255)break;node=node.parentElement}
        for(const c of layers.reverse())bg=blend(c,bg);
        const fg=blend(rgb(getComputedStyle(el).color),bg);
        const a=luminance(fg),b=luminance(bg);return {selector,text:el.textContent.slice(0,30),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      }));
    },selectors);
    const overviewContrast=await contrast(['#page-title','#page-date','#weather-text','#density-btn','#zoom-btn','.nav-item','.card-head h3','.row-meta','.quick-action b','.recent-card .row-title']);
    assert.deepEqual(overviewContrast.filter(x=>x.ratio<4.5),[],'dark text has readable contrast');
    await page.locator('#reload-btn').click();await shot('refresh-menu-dark');
    assert.deepEqual((await contrast(['#reload-menu button'])).filter(x=>x.ratio<4.5),[]);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#reload-menu').isVisible(),false);
    await page.evaluate(()=>window.ERWNav.open('journal','ui-journal'));
    await page.waitForSelector('#md-input');
    await shot('editor-dark');
    assert.deepEqual((await contrast(['#f-title','#md-input','.md-preview h1','#doc-save','.toolbar button','.project-chip'])).filter(x=>x.ratio<4.5),[]);
    const readable=async selectors=>{
      for(const s of selectors)assert(await page.locator(s).count()>0,'contrast check has real content: '+s);
      assert.deepEqual((await contrast(selectors)).filter(x=>x.ratio<4.5),[],'dark page text contrast: '+selectors);
    };
    const darkSurfaces=async selectors=>{
      const light=await page.evaluate(selectors=>{
        const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d',{willReadFrequently:true});
        return selectors.flatMap(s=>[...document.querySelectorAll(s)].filter(e=>{const r=e.getBoundingClientRect();return e.getClientRects().length&&r.width>=24&&r.height>=16}).map(e=>({selector:s,element:e.id||e.className||e.tagName,color:getComputedStyle(e).backgroundColor}))).filter(x=>{
          ctx.clearRect(0,0,1,1);ctx.fillStyle=x.color;ctx.fillRect(0,0,1,1);const rgba=[...ctx.getImageData(0,0,1,1).data];
          return rgba[3]>180&&Math.min(...rgba.slice(0,3))>140;
        });
      },selectors);
      assert.deepEqual(light,[],'module surfaces must not retain a light background');
    };
    await go('literature');await page.waitForSelector('#f-bibtex');
    if((await page.locator('#meta-toggle').innerText())==='展开')await page.locator('#meta-toggle').click();
    for(const density of ['compact','cozy']){
      if(await page.evaluate(d=>document.documentElement.dataset.density!==d,density))await page.locator('#density-btn').click();
      for(const [width,height,zoom] of [[1600,1000,100],[1100,720,100],[1600,1000,125],[1100,720,125]]){
        await page.setViewportSize({width,height});await page.locator('#zoom-btn').click();await page.locator(`[data-zoom="${zoom}"]`).click();
        await page.waitForTimeout(120);
        const sizes=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {editor:box('.doc-editor'),list:box('.doc-list-panel'),footer:box('.editor-actions'),pane:box('.editor-pane'),height:innerHeight}});
        assert(sizes.height-sizes.editor.bottom<=18&&sizes.height-sizes.editor.bottom>=5,'document workspace uses bottom area: '+JSON.stringify({density,width,height,zoom,sizes}));
        assert(Math.abs(sizes.editor.bottom-sizes.list.bottom)<2,'document columns end together');
        assert(sizes.footer.bottom<=sizes.editor.bottom+1&&sizes.footer.top>=sizes.editor.top,'save actions remain inside the visible editor');
        assert(sizes.pane.height>=50,'long literature metadata leaves usable editing space');
        assert(await page.locator('.meta-block').evaluate(e=>e.scrollHeight<=e.clientHeight+1&&getComputedStyle(e).overflowY==='visible'),'metadata expands to its complete natural height');
        const fieldsFit=await page.locator('.meta-block').evaluate(e=>{const box=e.getBoundingClientRect();return [...e.querySelectorAll('.field')].every(f=>{const r=f.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom+1})});
        assert(fieldsFit,'all metadata fields stay inside the expanded block');
        await page.locator('.doc-editor-content').evaluate(e=>e.scrollTop=e.scrollHeight);
        await page.locator('#meta-toggle').click();
        assert.equal(await page.locator('#meta-toggle').getAttribute('aria-expanded'),'false');
        assert.equal(await page.locator('#f-title').isVisible(),false);
        const collapsed=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {meta:box('.meta-block'),button:box('#meta-toggle'),content:box('.doc-editor-content'),scroll:document.querySelector('.doc-editor-content').scrollTop}});
        assert(collapsed.scroll===0&&collapsed.button.top>=collapsed.meta.top&&collapsed.button.bottom<=collapsed.meta.bottom&&collapsed.button.bottom<=collapsed.content.bottom,'collapsed Expand button is fully visible: '+JSON.stringify(collapsed));
        assert(collapsed.button.height>=27*zoom/100,'Expand button keeps its full height');
        await page.locator('#meta-toggle').click();
        assert.equal(await page.locator('#meta-toggle').getAttribute('aria-expanded'),'true');
        assert.equal(await page.locator('#f-title').inputValue(),literatureEditor.title,'folding preserves metadata');
      }
    }
    await page.setViewportSize({width:1600,height:1000});await page.locator('#zoom-btn').click();await page.locator('[data-zoom="100"]').click();
    if(await page.evaluate(()=>document.documentElement.dataset.density!=='compact'))await page.locator('#density-btn').click();
    await shot('literature-editor-full-height-dark');
    for(const density of ['compact','cozy']){
      if(await page.evaluate(d=>document.documentElement.dataset.density!==d,density))await page.locator('#density-btn').click();
      for(const zoom of [100,125]){
        await page.setViewportSize({width:2559,height:1527});await page.locator('#zoom-btn').click();await page.locator(`[data-zoom="${zoom}"]`).click();
        for(const route of ['overview','projects','todos','journals','notes','summaries','literature','agent','billing','settings']){
          await go(route);await page.waitForTimeout(80);
          const bounds=await page.evaluate(()=>{const box=e=>e.getBoundingClientRect().toJSON(),main=document.querySelector('#main');return {sidebar:box(document.querySelector('#app>.sidebar')),main:box(main),child:box(main.firstElementChild),width:innerWidth,scroll:document.documentElement.scrollWidth}});
          assert(Math.abs(bounds.main.left-bounds.sidebar.right)<1&&Math.abs(bounds.main.right-bounds.width)<2,'canvas fills available width: '+JSON.stringify({route,density,zoom,bounds}));
          assert(bounds.child.left-bounds.main.left<=17*zoom/100&&bounds.main.right-bounds.child.right<=17*zoom/100,'workspace retains only its normal edge padding: '+JSON.stringify({route,density,zoom,bounds}));
          assert(bounds.scroll<=bounds.width+1,'wide canvas has no horizontal page overflow');
          if(['journals','notes','summaries','literature'].includes(route)){
            if((await page.locator('#meta-toggle').innerText())==='展开')await page.locator('#meta-toggle').click();
            assert(await page.locator('.meta-block').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'all document kinds expand metadata without internal scrolling');
            if(density==='compact'&&zoom===100){
              const fits=await page.evaluate(()=>document.querySelector('.meta-block').getBoundingClientRect().bottom<=document.querySelector('.doc-editor-content').getBoundingClientRect().bottom+1);
              assert(fits,'all expanded metadata is visible together at normal wide-screen size: '+route);
              if(route==='notes'){
                await shot('metadata-expanded-wide-dark');await page.locator('#meta-toggle').click();await shot('metadata-collapsed-wide-dark');
                await page.locator('#theme-btn').click();await shot('metadata-collapsed-wide-light');await page.locator('#meta-toggle').click();await shot('metadata-expanded-wide-light');await page.locator('#theme-btn').click();
              }
            }
          }
        }
      }
    }
    await page.setViewportSize({width:1600,height:1000});await page.locator('#zoom-btn').click();await page.locator('[data-zoom="100"]').click();
    if(await page.evaluate(()=>document.documentElement.dataset.density!=='compact'))await page.locator('#density-btn').click();
    await go('billing');await page.waitForSelector('.billing-card');
    await readable(['.billing-card .k','.billing-card .v','.billing-card .s','.billing-table td','.billing-table th','.billing-tabs button']);
    await darkSurfaces(['.billing-page *']);await shot('billing-dark');
    await page.locator('[data-btab="records"]').click();await page.waitForSelector('#billing-filter');
    await readable(['.billing-table td','.billing-table th','.billing-badge']);await darkSurfaces(['.billing-page *']);await shot('billing-records-dark');
    await page.locator('[data-btab="prices"]').click();await page.waitForSelector('#billing-prices-text');
    await readable(['#billing-prices-text','.billing-sub']);await darkSurfaces(['.billing-page *']);await shot('billing-prices-dark');
    console.log('PASS: complete expanded metadata, unclipped fold buttons, full-width canvases across 10 routes at both densities and 100/125% zoom; dark billing');
    await go('journals');await page.waitForSelector('#md-input');
    await readable(['.doc-list-panel .mark-badge','.mark-chip.on','.nav-ico']);
    assert.notEqual(await page.locator('.mark-badge').first().evaluate(e=>getComputedStyle(e).color),await page.locator('.row-meta').first().evaluate(e=>getComputedStyle(e).color),'classification labels retain their color');
    await go('summaries');await page.waitForSelector('.doc-item .mark-badge');
    await readable(['.doc-item .mark-badge','.nav-item']);await shot('summaries-dark');
    await go('todos');await page.waitForSelector('.todo-row');
    await darkSurfaces(['.todo-row']);
    await readable(['.todo-title','.todo-row .row-meta','.todo-row time','.todo-row .badge','.todo-row button']);
    await shot('todos-dark');
    await go('milestones');await page.locator('[data-ms-view="timeline"]').click();
    await page.waitForSelector('.mdt-card.month-cluster');
    await darkSurfaces(['.mdt-ruler','.mdt-stats','.mdt-scale','.mdt-card']);
    await readable(['.mdt-month-label','.mdt-date-label','.mdt-stat','.mdt-status-copy strong','.mdt-status-copy span','.mdt-month-cluster-title strong','.mdt-month-cluster-title span']);
    await shot('milestone-month-dark');
    await page.locator('.mdt-card.month-cluster').first().click();await page.waitForSelector('.mdt-drawer-item');
    await readable(['.mdt-drawer-copy strong','.mdt-drawer-copy span','.mdt-drawer-year','.mdt-drawer-monthday']);
    await shot('milestone-drawer-dark');await page.locator('.mdt-drawer-head>.ghost-btn').click();
    await page.locator('.mdt-scale button').filter({hasText:'周'}).click();await page.waitForSelector('.mdt-card-date');
    await readable(['.mdt-card-date','.mdt-card-title']);await shot('milestone-week-dark');
    await page.locator('[data-ms-view="list"]').click();await page.waitForSelector('.timeline-card');
    await darkSurfaces(['.timeline-card']);await readable(['.timeline-card strong','.timeline-card .row-meta','.timeline-date']);
    await shot('milestone-list-dark');
    await go('agent');await page.waitForSelector('.agent-message-body h2');
    await page.locator('.agent-reasoning summary').click();
    await darkSurfaces(['.agent-side-head','.agent-chat-head','.agent-messages','.agent-bubble','.agent-composer']);
    await readable(['.agent-side-head h3','#agent-chat-title','.agent-session strong','.agent-session small','.agent-message-body p','.agent-message-body h2','.agent-message-body code','.agent-msg-meta','.agent-reasoning summary','.agent-reasoning-body','#agent-input','.agent-preset-label','.agent-avatar']);
    await shot('agent-dark');
    await go('literature');await page.waitForSelector('#open-lit-workspace');
    // The actual reader controller and UI run with a deterministic in-memory page renderer.
    // This avoids a CDN dependency and tests workspace colors without modifying real PDFs.
    await page.evaluate(()=>{
      const page={getViewport:({scale})=>({width:400*scale,height:560*scale,scale,transform:[scale,0,0,-scale,0,560*scale]}),
        render:({canvasContext:ctx,viewport:v})=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,v.width,v.height);ctx.fillStyle='#111';ctx.font='18px serif';ctx.fillText('PDF document keeps its original colors',25,50);return {promise:Promise.resolve()}},
        getTextContent:async()=>({items:[]}),cleanup:()=>{}};
      window.pdfjsLib={getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>page})})};
    });
    await page.locator('#open-lit-workspace').click();await page.waitForSelector('[data-paper="ui-paper"]');
    await page.locator('[data-paper="ui-paper"]').click();await page.waitForSelector('.lit-page canvas');
    await darkSurfaces(['.lit-library-head','.lit-toolbar','.lit-canvas-scroll']);
    await readable(['.lit-library-head h3','.lit-side-tabs button','#li-title','#li-authors','#li-year','.lit-info label','#lit-area','#lit-page-label','#lit-zoom-label']);
    assert.equal(await page.locator('.lit-page').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)','PDF paper remains white');
    await shot('literature-dark');
    await page.locator('.lit-side-tabs [data-tab="notes"]').click();await page.waitForSelector('#lit-note');
    await readable(['#lit-note']);await shot('literature-notes-dark');
    await go('overview');await ready();await page.waitForFunction(()=>document.querySelector('.overview-milestone-list').scrollTop>0);
    const rail=page.locator('.overview-milestone-rail'),ring=page.locator('.is-nearest .milestone-ring'),list=page.locator('.overview-milestone-list');
    assert.equal(await rail.count(),1,'all milestone rings share one continuous rail');
    assert.equal(await page.locator('.milestone-ring').count(),milestoneRows.length);
    const railBefore=await rail.boundingBox(),ringBefore=await ring.boundingBox();
    assert(Math.abs(railBefore.x+railBefore.width/2-ringBefore.x-ringBefore.width/2)<1,'rings align with the common rail');
    await list.evaluate(e=>e.scrollTop+=40);
    const railAfter=await rail.boundingBox(),ringAfter=await ring.boundingBox();
    assert(Math.abs(railBefore.y-railAfter.y)<1&&Math.abs(railBefore.height-railAfter.height)<1,'rail stays fixed while scrolling');
    assert(Math.abs(ringAfter.y-ringBefore.y+40)<1,'rings move with their milestones along the rail');
    await page.locator('#overview-ms-center').click();
    assert(await list.evaluate(e=>{const r=e.querySelector('.is-nearest');return Math.abs(r.offsetTop-e.scrollTop+r.offsetHeight/2-e.clientHeight/2)<2}));
    assert.equal(await ring.evaluate(e=>getComputedStyle(e,'::after').animationName),'none','reduced motion disables ring animation');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await ring.evaluate(e=>getComputedStyle(e,'::after').animationName),'milestone-orbit');
    await page.evaluate(()=>document.documentElement.dataset.animations='off');
    assert.equal(await ring.evaluate(e=>getComputedStyle(e,'::after').animationName),'none','app animation preference is respected');
    await page.evaluate(()=>document.documentElement.dataset.animations='on');await page.emulateMedia({reducedMotion:'reduce'});
    await readable(['.mini-ms-date strong']);await shot('overview-timeline-dark');
    console.log('PASS: dark todo, milestone month/week/list/drawer, Agent, PDF workspace, colored classifications and moving milestone rings');
    await go('focus');await page.waitForSelector('#focus-apply');await page.locator('#focus-apply').click();
    await readable(['#toast-stack .toast']);await darkSurfaces(['#toast-stack .toast']);await shot('toast-dark');
    await go('settings');
    for(const tab of ['general','knowledge','service','literature','academic','weather','rss','llm','interface','sync','desktop']){
      await page.locator(`[data-set-tab="${tab}"]`).click();await page.waitForTimeout(160);
      await darkSurfaces(['#settings-panel *:not([type="color"])']);
      const bad=(await contrast(['#settings-panel h3','#settings-panel .row-title','#settings-panel .row-meta','#settings-panel .field-help','#settings-panel .field>label','#settings-panel input:not([type="color"]):not([type="checkbox"])','#settings-panel textarea','#settings-panel select','#settings-panel button:not(:disabled)'])).filter(x=>x.ratio<4.5);
      assert.deepEqual(bad,[],'all settings tabs remain readable: '+tab);
    }
    await page.locator('[data-set-tab="knowledge"]').click();await page.waitForSelector('[data-kt-template]');
    await shot('settings-knowledge-dark');
    await page.locator('[data-kt-template]').first().click();await page.waitForSelector('#kt-template-edit');
    await readable(['#modal-title','#kt-template-edit','#kt-template-cancel']);await darkSurfaces(['#modal','#kt-template-edit']);await shot('settings-template-dark');
    await page.locator('#kt-template-cancel').click();
    await page.locator('#kt-add').click();await page.waitForSelector('#kt-id');
    await readable(['#kt-id','#kt-label','#kt-template']);await darkSurfaces(['#modal','#kt-template']);await shot('settings-new-type-dark');
    await page.locator('#modal-close').click();
    await page.locator('#km-icon-trigger').click();await page.waitForSelector('.compact-icon-menu');
    await darkSurfaces(['.compact-icon-menu']);await shot('settings-icons-dark');await page.locator('[data-km-icon]').first().click();
    await page.locator('[data-km-delete]').first().click();await page.waitForSelector('#workbench-dialog');
    await readable(['#workbench-dialog-title','#workbench-dialog-message','#workbench-dialog button']);await darkSurfaces(['#workbench-dialog']);
    assert.equal(await page.locator('[data-dialog-result="cancel"]').evaluate(e=>e===document.activeElement),true,'destructive actions focus Cancel');
    await shot('confirmation-dark');await page.keyboard.press('Escape');await page.waitForSelector('#workbench-dialog',{state:'detached'});
    await page.locator('#theme-btn').click();await page.locator('[data-km-delete]').first().click();await page.waitForSelector('#workbench-dialog');
    await readable(['#workbench-dialog-title','#workbench-dialog-message','#workbench-dialog button']);await shot('confirmation-light');
    await page.locator('[data-dialog-result="cancel"]').click();await page.locator('#theme-btn').click();
    await page.locator('#erw-fab-ball').hover();await page.locator('#erw-fab-ball').click();await page.waitForSelector('#erw-fab-panel:not([hidden])');
    await darkSurfaces(['#erw-fab-panel','.fab-head','.fab-foot','.fab-compose']);
    await readable(['.fab-title strong','#fab-input','#fab-send']);await page.locator('#fab-shot-page').click();await page.waitForSelector('.fab-notice.error');
    await readable(['.fab-notice.error']);await shot('floating-assistant-dark');await page.locator('#fab-close').click();
    console.log('PASS: all 11 settings tabs, template/type/icon dialogs, shared notifications, floating assistant and themed confirmations');

    await go('notes');await page.waitForSelector('#new-doc');const writesBeforeDrafts=docWrites;
    await page.locator('#new-doc').click();await page.waitForSelector('[data-doc-draft]');
    assert.equal(await page.evaluate(()=>window.ERWDesktop.documentDraft()),true);
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),false);
    await page.locator('#doc-save').click();assert.equal(docWrites,writesBeforeDrafts,'an untouched template never persists');
    await go('overview');await ready();assert.equal(docWrites,writesBeforeDrafts);
    await go('notes');await page.waitForSelector('#new-doc');await page.locator('#new-doc').click();await page.waitForSelector('[data-doc-draft]');
    const template=await page.locator('#md-input').inputValue();
    await page.locator('#md-input').fill(template+'temporary');await page.locator('#md-input').fill(template);
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),false,'reverting to the template is not a change');
    await go('overview');await ready();assert.equal(docWrites,writesBeforeDrafts);
    await go('notes');await page.waitForSelector('#new-doc');await page.locator('#new-doc').click();await page.waitForSelector('[data-doc-draft]');
    await page.locator('#f-title').fill('保存这份新文档');
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),true,'metadata edits count as changes');
    await page.locator('#md-input').fill('# 实验结果\n\n这里是修改后的内容。');
    await respond(()=>page.locator('[data-route="overview"]').click(),'cancel');
    assert.equal(await page.locator('#f-title').inputValue(),'保存这份新文档');assert.equal(docWrites,writesBeforeDrafts);
    failSave=true;await respond(()=>page.locator('[data-route="overview"]').click(),'save');
    await page.waitForFunction(()=>document.querySelector('#doc-save')?.disabled===false);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.route),'notes');assert.equal(docWrites,writesBeforeDrafts);
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),true,'failed save retains the modified draft');
    failSave=false;await respond(()=>go('overview'),'save');await ready();
    assert.equal(docWrites,writesBeforeDrafts+1,'first save creates exactly one document');
    const newDoc=docRecords.find(d=>d.title==='保存这份新文档');assert(newDoc&&!newDoc.draft);
    await page.evaluate(id=>window.ERWNav.open('note',id),newDoc.id);await page.waitForSelector('#md-input');
    await page.locator('#md-input').fill('# 第二次修改');await page.locator('#doc-save').click();
    await page.waitForFunction(()=>!window.ERWDesktop.hasUnsavedChanges());
    assert.equal(docRecords.filter(d=>d.title==='保存这份新文档').length,1,'later saves update the same document');
    await page.locator('#new-doc').click();await page.waitForSelector('[data-doc-draft]');await page.locator('#md-input').fill('# 放弃的草稿');
    const savedCount=docRecords.length;
    await respond(()=>go('overview'),'discard');await ready();assert.equal(docRecords.length,savedCount,'discard never writes or deletes persisted documents');
    await go('milestones');await page.waitForSelector('#new-ms');await page.locator('#new-ms').click();await page.waitForSelector('[data-doc-draft]');
    assert.equal(await page.evaluate(()=>window.ERWDesktop.hasUnsavedChanges()),false);
    await go('overview');await ready();assert.equal(docRecords.length,savedCount,'untouched milestone drafts also disappear');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await page.locator('.degree-progress-track i').evaluate(e=>getComputedStyle(e,'::after').animationName),'overview-water-glint');
    await page.evaluate(()=>document.documentElement.dataset.animations='off');
    assert.equal(await page.locator('.degree-progress-track i').evaluate(e=>getComputedStyle(e,'::after').animationName),'none');
    await page.evaluate(()=>document.documentElement.dataset.animations='on');await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.degree-progress-track i').evaluate(e=>getComputedStyle(e,'::after').animationName),'none');
    console.log('PASS: untouched/reverted drafts, metadata edits, cancel, save failure, first save, updates, discard, milestone drafts and optional overview motion');
    await go('graph');await page.waitForSelector('#graph-smart-toolbar');
    await page.evaluate(()=>window.__knowledgeGraphEngine.selectNode('ui-journal'));
    await page.locator('#graph-bundle').click();await page.waitForSelector('#opt-bundle-list');
    const selectionBounds=await page.locator('#modal').boundingBox();
    assert(selectionBounds.height>=600&&selectionBounds.width>=900);
    await page.locator('#opt-bundle-generate').click();await page.waitForSelector('#opt-bundle-content');
    const exportBounds=await page.locator('#modal').boundingBox(),textBounds=await page.locator('#opt-bundle-content').boundingBox();
    assert(Math.abs(selectionBounds.height-exportBounds.height)<2,'selection and export keep a fixed dialog size');
    assert(textBounds.height>=450&&textBounds.width>=850,'export textarea has room for many lines');
    assert.equal(await page.locator('#opt-bundle-content').evaluate(e=>getComputedStyle(e).resize),'none');
    assert(await page.locator('#opt-bundle-content').evaluate(e=>e.scrollHeight>e.clientHeight));
    assert.deepEqual((await contrast(['#modal-title','#opt-bundle-content','#opt-bundle-copy'])).filter(x=>x.ratio<4.5),[]);
    await shot('markdown-export-dark');
    await page.locator('#theme-btn').click();await page.waitForSelector('html[data-theme="light"]');
    await page.waitForTimeout(220);
    await shot('markdown-export-light');
    await page.setViewportSize({width:1000,height:700});
    await page.waitForFunction(()=>Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--vh-px'))-(innerHeight-48))<1);
    const smallModal=await page.locator('#modal').boundingBox();
    assert(smallModal.x>=0&&smallModal.y>=48&&smallModal.x+smallModal.width<=1001&&smallModal.y+smallModal.height<=701,'fixed export dialog adapts to smaller work areas: '+JSON.stringify(smallModal));
    await page.locator('#opt-bundle-done').click();
    await page.setViewportSize({width:1600,height:1000});
    await page.locator('#zoom-btn').click();await page.locator('[data-zoom="125"]').click();
    for(const id of ['page-title','page-date','weather-pill','theme-btn','density-btn','zoom-btn','reload-btn']){
      const b=await page.locator('#'+id).boundingBox();assert(b.y>=0&&b.y+b.height<=49,id+' remains inside the titlebar at 125%');
    }
    await shot('single-titlebar-zoom125');
    console.log('PASS: one titlebar, refresh dropdown, fixed Markdown export, dark contrast and 125% zoom');
    await go('settings');await page.locator('[data-set-tab="sync"]').click();await page.waitForSelector('#sync-url');
    assert.equal(await page.locator('.sync-wrap').isVisible(),false,'sync button hidden while disabled');
    await page.locator('#sync-url').fill('http://192.168.1.10:8765');await page.locator('#sync-test').click();await page.waitForFunction(()=>document.querySelector('#sync-test-result').textContent.includes('连接成功'));
    await page.locator('#sync-mode').selectOption('manual');await page.locator('#sync-save').click();await page.waitForFunction(()=>!document.querySelector('.sync-wrap').hidden);
    assert.equal(await page.locator('#desktop-sync-slot .sync-wrap').count(),1,'sync button in desktop titlebar');
    const syncBounds=await page.locator('.sync-wrap').boundingBox(),reloadBounds=await page.locator('#reload-btn').boundingBox();
    assert(syncBounds.x+syncBounds.width<=reloadBounds.x,'sync precedes refresh and minimize');
    await page.locator('#sync-now').click();await page.waitForFunction(()=>document.querySelector('.sync-wrap').dataset.phase==='synced');assert.equal(syncRuns,1);
    await page.locator('#sync-more').click();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/sync/check')),page.locator('#sync-menu [data-sync-check]').click()]);assert.equal(syncChecks,1);
    syncState.phase='conflict';syncState.conflicts=1;syncState.changes=[{key:'doc:ui-journal',code:'!',doc_id:'ui-journal',label:'实验记录',scope:'documents'}];await page.evaluate(()=>window.ERWSync.poll());
    await page.locator('#sync-more').click();await page.locator('#sync-menu [data-sync-conflict]').click();await page.waitForSelector('.sync-conflict-modal textarea');
    await shot('sync-conflict-light');
    await page.locator('#theme-btn').click();await page.waitForSelector('html[data-theme="dark"]');
    await readable(['.sync-conflict textarea','.sync-conflict .sync-caption','#modal-footer button']);await darkSurfaces(['.sync-conflict textarea','#modal']);await shot('sync-conflict-dark');
    await respond(()=>page.locator('[data-sync-choice="both"]').click());await page.waitForSelector('#modal-backdrop',{state:'hidden'});assert.equal(syncResolves,1);
    await page.locator('[data-set-tab="sync"]').click();await page.waitForSelector('#sync-mode');await shot('sync-settings-dark');
    await page.locator('#sync-mode').selectOption('auto');await page.locator('#sync-save').click();await page.waitForSelector('#sync-mode');assert.equal(syncState.config.mode,'auto');
    await page.locator('#sync-mode').selectOption('off');await page.locator('#sync-save').click();await page.waitForFunction(()=>document.querySelector('.sync-wrap').hidden);
    console.log('PASS: centralized sync settings, disabled/active/auto modes, desktop placement, Git status, conflict comparison and resolution in light/dark themes');
    assert.deepEqual(errors,[]);
    console.log('PASS: responsive layout, legacy overview redirect and no browser errors');
    console.log('Screenshots:',output);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
