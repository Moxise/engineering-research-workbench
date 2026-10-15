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
    page.on('pageerror',e=>errors.push(e.message));
    const date='2026-10-15';
    let todos=[{id:'ui-todo',title:'核对实验结果',project:'示例项目',due:date,priority:'普通',done:false},...['整理论文实验','复核对照结果'].map((title,i)=>({id:'ui-extra-'+i,title,project:'示例项目',due:date,priority:'普通',done:false}))];
    todos.push({id:'ui-urgent',title:'今天的紧急事项',due:date,priority:'紧急',done:false},
      {id:'ui-next',title:'明天的事项',due:'2026-10-16',priority:'普通',done:false},
      {id:'ui-yesterday',title:'昨天未完成的事项',due:'2026-10-14',priority:'低',done:false},
      {id:'ui-old',title:'较早的事项',due:'2026-08-04',priority:'高',done:false},
      {id:'ui-no-date',title:'未设置日期',due:'',priority:'紧急',done:false},
      {id:'ui-done',title:'保留的已完成事项',due:'2020-01-01',priority:'普通',done:true});
    let writes=0,failWrite=false,failDocId='',failTodoId='',cleanupCalls=0;
    const deletedDocs=new Set();
    const doc=(kind,id,title)=>({id,kind,title,status:kind==='milestone'?'进行中':'记录',due:date,record_date:date,created:date,updated:date,project:'示例项目',projects:['示例项目'],tags:[],kind_marks:['knowledge','method'],body:'# '+title+'\n\n用于验证文档直达。',path:'Knowledge/'+id+'.md'});
    const milestone=doc('milestone','ui-milestone','打开这一份里程碑文档');
    const journal=doc('journal','ui-journal','有两种分类的实验记录');
    const milestoneRows=Array.from({length:14},(_,i)=>{
      const day=String(i+8).padStart(2,'0');
      return day==='15'?milestone:{...doc('milestone','ui-ms-'+day,'研究节点 '+day),due:'2026-10-'+day,status:i<5?'完成':'进行中'};
    });
    const longTitle='研究内容标题需要允许换行并且最多显示两行，在更长的情况下才显示省略号，避免标题在第一行就被截断';
    const otherJournals=[journal,doc('journal','ui-journal-2','另一份实验记录'),doc('journal','ui-journal-3','第三份实验记录')];
    const recentDocs=['idea','note','summary'].flatMap(kind=>Array.from({length:5},(_,i)=>({...doc(kind,'ui-recent-'+kind+i,({idea:'灵感',note:'笔记',summary:'工作总结'}[kind])+'·'+longTitle+' '+i),project:['模型推理优化','联邦学习系统','科研工作台性能测试'][i%3],status:({idea:['探索中','已采纳','已归档','待整理','探索中'],note:['稳定','整理中','草稿','已归档','稳定'],summary:['已定稿','草稿','已归档','已定稿','草稿']}[kind])[i]})));
    const docRecords=[...milestoneRows,...otherJournals,...recentDocs];
    const days=Array.from({length:14},(_,i)=>({date:`2026-10-${String(i+2).padStart(2,'0')}`,count:i%4,breakdown:{todo_done:i===13?2:0}}));
    const projectStats=Array.from({length:6},(_,i)=>({id:'proj_internal_'+i,name:'研究项目 '+(i+1),description:'验证模型质量、实验结果与研究进展。',status:'进行中',docs:19,open_todos:4,milestones:3,literature:5,last_updated:date,created:'2025-12-10'}));
    const fixtureDashboard={today:date,academic:{configured:true,percent:43.4,start_date:'2024-09-05',expected_end_date:'2029-07-15',elapsed_days:770,remaining_days:1004,weekly_goal_days:5,conditions_total:1,conditions_done:0,graduation_conditions:[{label:'期刊论文',current:1,target:3,percent:33}]},counts:{journal:1,note:1,literature:0,milestone:1},recent:{ideas:[],notes:[doc('note','ui-note','研究笔记')],summaries:[]},project_stats:projectStats,upcoming_milestones:[milestone,...Array.from({length:4},(_,i)=>doc('milestone','ui-extra-ms-'+i,'下一阶段研究节点 '+(i+1)))],activity:{days,start:'2026-10-02',end:date,events_month:20,active_days_month:8}};
    await page.addInitScript(()=>{
      localStorage.setItem('sidebarOpen',JSON.stringify(['core','research','resources','system']));
      localStorage.setItem('sidebarPinned',JSON.stringify(['core']));
      localStorage.setItem('uiScale','100');
      localStorage.setItem('fabBallPos',JSON.stringify({x:1548,y:300}));
    });
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      const send=data=>route.fulfill({json:data});
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
      if(url.pathname==='/api/docs'){
        const kind=url.searchParams.get('kind'),scope=url.searchParams.get('scope');
        const rows=docRecords.filter(d=>!deletedDocs.has(d.id)&&(!kind||d.kind===kind));
        const pageNum=Number(url.searchParams.get('page')||1),size=scope==='overview'?6:kind==='journal'?2:200;
        const pages=Math.max(1,Math.ceil(rows.length/size));
        return send({items:rows.slice((pageNum-1)*size,pageNum*size),total:rows.length,page:pageNum,pages,page_size:size,next_page:pageNum<pages?pageNum+1:null,prev_page:pageNum>1?pageNum-1:null});
      }
      if(url.pathname.startsWith('/api/docs/'))return send(docRecords.find(d=>d.id===decodeURIComponent(url.pathname.split('/').pop()))||journal);
      if(url.pathname==='/api/graph')return send({nodes:[{...journal,label:journal.title},{...milestone,label:milestone.title}],edges:[{source:journal.id,target:milestone.id,kind:'wikilink'}],meta:{total_documents:2,shown_documents:2}});
      if(url.pathname==='/api/config'){
        const cfg={app:{app_name:'科研工作台',subtitle:'Engineering Research Workspace',ui:{graph_default_view:'3d'},llm:{enabled:false}},weather:{enabled:false}};
        cfg.app.classification_marks=[{id:'knowledge',label:'知识',icon:'◈',color:'#2a9d8f'},{id:'method',label:'方法',icon:'⚒',color:'#e76f51'}];
        return send(cfg);
      }
      if(url.pathname==='/api/knowledge-types')return send(['idea','journal','note','milestone','summary','literature'].map((id,i)=>({id,label:['灵感','实验记录','笔记','里程碑','工作总结','文献'][i]})));
      if(url.pathname==='/api/statuses')return send({journal:['记录'],milestone:['进行中','完成'],note:['记录']});
      if(url.pathname==='/api/projects')return send(['示例项目']);
      if(url.pathname==='/api/project-records')return send(projectStats);
      if(url.pathname==='/api/health')return send({version:'ui-test'});
      if(url.pathname==='/api/workspace/info')return send({relative:'Test Workspace'});
      if(url.pathname.startsWith('/api/weather'))return send({enabled:false});
      if(method!=='GET')throw new Error('Unexpected write: '+method+' '+url.pathname);
      return send([]);
    });
    const ready=()=>page.waitForSelector('.overview-todo-add');
    const go=async route=>{await page.locator(`[data-route="${route}"]`).click();await page.waitForFunction(r=>document.documentElement.dataset.route===r,route)};
    const shot=name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
    const smallText=()=>page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>e.children.length===0&&e.textContent.trim()&&e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>({class:e.className,size:getComputedStyle(e).fontSize,text:e.textContent.slice(0,30)})));
    await page.goto(base);await ready();
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
      if(i===0){await shot('projects');await page.locator('[data-project-edit]').first().click();assert(!(await page.locator('#modal-body').innerText()).includes('proj_internal_'));await page.locator('#pm-cancel').click()}
      await go('overview');await ready();assert.equal(await page.locator('[data-route="projects"]').count(),1);
    }
    console.log('PASS: stable project navigation and sidebar hierarchy');

    await page.locator('#overview-todo-title').fill('新增研究任务');await page.locator('#overview-todo-title').press('Enter');
    await page.waitForSelector('[data-overview-check="ui-new-todo"]');assert.equal(writes,1);
    page.once('dialog',d=>d.dismiss());await page.locator('[data-overview-check="ui-todo"]').click();
    assert.equal(await page.locator('[data-overview-check="ui-todo"]').isChecked(),false);assert.equal(writes,1);
    page.once('dialog',d=>d.accept());await page.locator('[data-overview-check="ui-todo"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-overview-check="ui-todo"]'));assert.equal(writes,2);
    failWrite=true;page.once('dialog',d=>d.accept());await page.locator('[data-overview-check="ui-new-todo"]').click();
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
    page.once('dialog',d=>d.dismiss());await page.locator('#doc-delete-selected').click();assert.equal(deletedDocs.size,0);
    failDocId='ui-journal-2';page.once('dialog',d=>d.accept());await page.locator('#doc-delete-selected').click();
    await page.waitForFunction(()=>document.querySelector('#doc-selected-count')?.textContent==='已选 1 条');
    assert(deletedDocs.has('ui-journal')&&deletedDocs.has('ui-journal-3'));
    assert.equal(await page.locator('[data-doc-pick="ui-journal-2"]').isChecked(),true,'failed deletion stays selected after pagination clamps');
    assert.equal(await page.locator('#md-input').count(),0,'deleted active document is removed from the editor');
    failDocId='';page.once('dialog',d=>d.accept());await page.locator('#doc-delete-selected').click();
    await page.waitForFunction(()=>document.querySelector('#doc-selected-count')?.textContent==='已选 0 条');
    assert.equal(await page.locator('[data-doc-pick]').count(),0);
    assert.equal(await page.locator('#doc-selection-toolbar').isVisible(),false,'successful deletion returns to normal browsing');
    console.log('PASS: cross-page document selection, confirmation cancellation, partial failure retention and empty last-page recovery');

    await go('todos');await page.waitForSelector('#todo-clear-completed');
    assert.equal(await page.locator('#todo-selection-toolbar').isVisible(),false);
    assert.equal(await page.locator('[data-todo-pick]').first().isVisible(),false);
    const add=await page.locator('#todo-add').boundingBox(),todoTrash=await page.locator('#todo-batch-toggle').boundingBox();
    assert(Math.abs(add.y-todoTrash.y)<2&&todoTrash.x>=add.x+add.width,'Todo batch entry sits beside Add');
    page.once('dialog',d=>d.dismiss());await page.locator('[data-todo-check="ui-next"]').click();
    assert.equal(await page.locator('[data-todo-check="ui-next"]').getAttribute('aria-checked'),'false');
    page.once('dialog',d=>d.accept());await page.locator('[data-todo-check="ui-next"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-todo-check="ui-next"]')?.getAttribute('aria-checked')==='true');
    const pendingBefore=todos.filter(t=>!t.done).map(t=>t.id);
    page.once('dialog',d=>d.dismiss());await page.locator('#todo-clear-completed').click();assert.equal(cleanupCalls,0);
    page.once('dialog',d=>d.accept());await page.locator('#todo-clear-completed').click();
    await page.waitForFunction(()=>document.querySelector('#todo-clear-completed')?.disabled===true);
    assert.equal(cleanupCalls,1);assert.deepEqual(todos.map(t=>t.id),pendingBefore,'manual cleanup preserves all pending tasks');
    await page.locator('#todo-batch-toggle').click();
    await page.locator('[data-todo-pick="ui-extra-0"]').check();await page.locator('[data-todo-pick="ui-extra-1"]').check();
    failTodoId='ui-extra-1';page.once('dialog',d=>d.accept());await page.locator('#todo-delete-selected').click();
    await page.waitForFunction(()=>document.querySelector('#todo-selected-count')?.textContent==='已选 1 条');
    assert(!todos.some(t=>t.id==='ui-extra-0'));assert(todos.some(t=>t.id===failTodoId));
    assert.equal(await page.locator('[data-todo-pick="ui-extra-1"]').isChecked(),true);
    await page.locator('#todo-clear-selection').click();failTodoId='';
    assert.equal(await page.locator('#todo-selection-toolbar').isVisible(),false);
    assert.equal(await page.locator('[data-todo-pick]').first().isVisible(),false);
    await shot('todo-batch');
    console.log('PASS: Todo multiselect deletion and explicit manual-only completed cleanup');
    await go('graph');await page.waitForSelector('#graph-smart-toolbar');
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
    assert.deepEqual(errors,[]);
    console.log('PASS: responsive layout, legacy overview redirect and no browser errors');
    console.log('Screenshots:',output);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
