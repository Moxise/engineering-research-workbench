(()=>{
"use strict";
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp=v=>Math.max(0,Math.min(1,v));
const S={items:[],paper:null,pdf:null,scale:1.15,current:1,pages:new Map(),observer:null,pending:null,undo:[],area:false,generation:0,categories:[],selectedAnn:null,selectionOrigin:null,dragSel:null};

async function api(url,opts={}){const r=await fetch(url,opts);let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.message||d.error||("HTTP "+r.status));return d}
async function ensurePdfJs(){
 if(window.pdfjsLib)return;
 await new Promise((ok,bad)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";s.onload=ok;s.onerror=bad;document.head.appendChild(s)});
 if(!window.pdfjsLib)throw new Error("PDF.js 加载失败");
 window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}
function badge(s){return '<span class="lit-status '+(s==="已读"?"done":s==="在读"?"reading":"")+'">'+esc(s||"未读")+"</span>"}
function item(x){return '<article class="lit-item '+(S.paper?.id===x.id?"active":"")+'" data-paper="'+esc(x.id)+'"><div class="lit-item-title">'+esc(x.title)+'</div><div class="lit-item-meta">'+esc(x.authors||"")+(x.year?" · "+esc(x.year):"")+'</div><div class="lit-item-foot">'+badge(x.reading_status)+(x.categories||[]).slice(0,2).map(c=>'<span class="lit-chip">'+esc(c)+"</span>").join("")+(x.favorite?"<span>★</span>":"")+"</div></article>"}

async function loadList(){
 const d=await api("/api/literature?q="+encodeURIComponent(q("#lit-search")?.value||"")+"&status="+encodeURIComponent(q("#lit-status")?.value||"")+"&category="+encodeURIComponent(q("#lit-category")?.value||"")+"&page_size=100");
 S.items=d.items||[];S.categories=[...new Set(S.items.flatMap(x=>x.categories||[]))].sort();
 q("#lit-list").innerHTML=S.items.length?S.items.map(item).join(""):'<div class="lit-empty">暂无文献<br>点击“上传 PDF”开始</div>';
 const c=q("#lit-category"),old=c.value;c.innerHTML='<option value="">全部分类</option>'+S.categories.map(x=>'<option '+(x===old?"selected":"")+'>'+esc(x)+"</option>").join("");
 qa("[data-paper]").forEach(e=>e.onclick=()=>openPaper(e.dataset.paper));
}
function shell(){
 q("#main").innerHTML='<div class="lit-shell"><aside class="card lit-library"><div class="lit-library-head"><div><div class="card-kicker">LITERATURE LIBRARY</div><h3>文献库</h3></div><button class="primary-btn" id="lit-upload">＋ 上传 PDF</button></div><input id="lit-file" type="file" accept="application/pdf,.pdf" hidden><input class="search-input" id="lit-search" placeholder="搜索题名、作者、标签、分类…"><div class="lit-filters"><select class="search-input" id="lit-status"><option value="">全部进度</option><option>未读</option><option>在读</option><option>已读</option></select><select class="search-input" id="lit-category"><option value="">全部分类</option></select></div><div class="lit-list" id="lit-list"></div></aside><section class="card lit-reader"><div id="lit-reader-empty" class="lit-empty lit-reader-empty">选择一篇文献开始阅读</div><div id="lit-reader-live" hidden><div class="lit-toolbar"><button data-ann="highlight" disabled>高亮</button><button data-ann="underline" disabled>下划线</button><button data-ann="strikeout" disabled>删除线</button><button id="lit-area">框选区域</button><span class="lit-sep"></span><button id="lit-undo" disabled title="Ctrl+Z">↶ 撤销</button><span class="lit-sep"></span><span id="lit-page-label">1 / 1</span><button id="lit-zoom-out">−</button><span id="lit-zoom-label">115%</span><button id="lit-zoom-in">＋</button></div><div class="lit-canvas-scroll" id="lit-scroll"><div id="lit-pages" class="lit-pages"></div></div></div></section><aside class="card lit-side" id="lit-side"><div class="lit-empty">文献信息、批注和笔记将在这里显示</div></aside></div>';
 q("#lit-upload").onclick=()=>q("#lit-file").click();q("#lit-file").onchange=e=>upload(e.target.files?.[0]);
 let t;q("#lit-search").oninput=()=>{clearTimeout(t);t=setTimeout(loadList,160)};q("#lit-status").onchange=loadList;q("#lit-category").onchange=loadList;
 qa("[data-ann]").forEach(b=>b.onclick=()=>commit(b.dataset.ann));q("#lit-area").onclick=toggleArea;q("#lit-undo").onclick=undo;q("#lit-zoom-in").onclick=()=>zoom(.15);q("#lit-zoom-out").onclick=()=>zoom(-.15);
}
async function upload(file){if(!file)return;try{const r=await fetch("/api/literature/import",{method:"POST",headers:{"Content-Type":"application/pdf","X-Filename":encodeURIComponent(file.name)},body:file});const d=await r.json();if(!r.ok)throw new Error(d.message||"上传失败");await loadList();await openPaper(d.id)}catch(e){alert(e.message)}finally{q("#lit-file").value=""}}

async function openPaper(id){
 reset();S.paper=await api("/api/literature/"+encodeURIComponent(id));q("#lit-reader-empty").hidden=true;q("#lit-reader-live").hidden=false;side();await loadList();
 try{await ensurePdfJs();S.pdf=await window.pdfjsLib.getDocument({url:"/api/literature/"+encodeURIComponent(id)+"/pdf",rangeChunkSize:4*1024*1024}).promise;S.current=Math.max(1,Math.min(S.pdf.numPages,+S.paper.last_page||1));await build();requestAnimationFrame(()=>go(S.current,false))}
 catch(e){q("#lit-pages").innerHTML='<div class="lit-empty">PDF 渲染失败：'+esc(e.message)+"</div>"}
}
function reset(){S.generation++;S.observer?.disconnect();S.pages.clear();S.pending=null;S.undo=[];S.area=false;S.pdf=null;S.selectedAnn=null;S.selectionOrigin=null;S.dragSel=null}
async function build(){
 const host=q("#lit-pages");host.innerHTML="";S.pages.clear();const gen=S.generation;
 for(let n=1;n<=S.pdf.numPages;n++){
  const p=await S.pdf.getPage(n);if(gen!==S.generation)return;const vp=p.getViewport({scale:S.scale});
  const el=document.createElement("div");el.className="lit-page-shell";el.dataset.page=n;el.style.width=vp.width+"px";el.style.height=vp.height+"px";el.innerHTML='<div class="lit-page-placeholder">第 '+n+" 页</div>";host.appendChild(el);S.pages.set(n,{el,rendered:false,rendering:false,annotations:[]});
 }
 S.observer=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)renderPage(+e.target.dataset.page)}),{root:q("#lit-scroll"),rootMargin:"1000px 0px",threshold:.01});
 S.pages.forEach(r=>S.observer.observe(r.el));q("#lit-scroll").onscroll=throttle(track,100);toolbar();
}
async function renderPage(n){
 const r=S.pages.get(n);if(!r||r.rendered||r.rendering||!S.pdf)return;r.rendering=true;const gen=S.generation;
 try{
  const p=await S.pdf.getPage(n),vp=p.getViewport({scale:S.scale}),dpr=window.devicePixelRatio||1;if(gen!==S.generation)return;
  r.el.style.width=vp.width+"px";r.el.style.height=vp.height+"px";r.el.innerHTML='<div class="lit-page" data-page="'+n+'" style="width:'+vp.width+'px;height:'+vp.height+'px"><canvas></canvas><div class="lit-text-layer"></div><svg class="lit-annotation-layer" viewBox="0 0 1 1" preserveAspectRatio="none"></svg><div class="lit-selection-layer"></div></div>';
  const cv=q("canvas",r.el),ctx=cv.getContext("2d");cv.width=Math.floor(vp.width*dpr);cv.height=Math.floor(vp.height*dpr);cv.style.width=vp.width+"px";cv.style.height=vp.height+"px";
  await p.render({canvasContext:ctx,viewport:vp,transform:dpr===1?null:[dpr,0,0,dpr,0,0]}).promise;if(gen!==S.generation)return;
  const text=await p.getTextContent(),layer=q(".lit-text-layer",r.el);layer.style.width=vp.width+"px";layer.style.height=vp.height+"px";
  const task=window.pdfjsLib.renderTextLayer({textContentSource:text,container:layer,viewport:vp,textDivs:[]});if(task?.promise)await task.promise;
  r.annotations=await api("/api/literature/"+S.paper.id+"/annotations?page="+n);r.rendered=true;
  const pageEl=q(".lit-page",r.el);
  pageEl.addEventListener("pointerdown",e=>beginGeometricSelection(n,e),true);
  pageEl.onclick=e=>handlePageAnnotationClick(n,e);
  paint(n);
 }catch(e){r.el.innerHTML='<div class="lit-page-error">第 '+n+" 页渲染失败："+esc(e.message)+"</div>"}finally{r.rendering=false}
}

function nodeSpan(node){
 const el=node?.nodeType===1?node:node?.parentElement;
 return el?.closest?.(".lit-text-layer span")||null;
}

function textCaretAt(x,y,page){
 let node=null,offset=0;
 if(document.caretPositionFromPoint){
  const p=document.caretPositionFromPoint(x,y);
  node=p?.offsetNode||null;offset=p?.offset||0;
 }else if(document.caretRangeFromPoint){
  const r=document.caretRangeFromPoint(x,y);
  node=r?.startContainer||null;offset=r?.startOffset||0;
 }
 const span=nodeSpan(node);
 if(!span||!page.contains(span))return null;
 const tn=Array.from(span.childNodes).find(n=>n.nodeType===Node.TEXT_NODE);
 if(!tn)return null;
 return {span,node:tn,offset:Math.max(0,Math.min(tn.length,offset))};
}
function pagePoint(page,x,y){
 const pr=page.getBoundingClientRect();
 return {x:clamp((x-pr.left)/pr.width),y:clamp((y-pr.top)/pr.height)};
}
function visualRows(page,side){
 const pr=page.getBoundingClientRect();
 const spans=qa(".lit-text-layer span",page).map(span=>{
  const r=span.getBoundingClientRect();
  return {span,r,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,h:r.height};
 }).filter(x=>x.r.width>.5&&x.r.height>.5)
   .filter(x=>side==="left"?x.cx<pr.left+pr.width*.5:side==="right"?x.cx>pr.left+pr.width*.5:true)
   .sort((a,b)=>a.cy-b.cy||a.r.left-b.r.left);
 const rows=[];
 for(const item of spans){
  let row=rows[rows.length-1];
  if(!row||Math.abs(item.cy-row.cy)>Math.max(item.h,row.h)*.48){
   row={items:[],cy:item.cy,h:item.h};rows.push(row);
  }
  row.items.push(item);
  row.cy=row.items.reduce((s,v)=>s+v.cy,0)/row.items.length;
  row.h=Math.max(...row.items.map(v=>v.h));
 }
 rows.forEach(row=>row.items.sort((a,b)=>a.r.left-b.r.left));
 return rows;
}
function rowIndexForSpan(rows,span){
 for(let i=0;i<rows.length;i++)if(rows[i].items.some(x=>x.span===span))return i;
 return -1;
}
function nearestRowIndex(rows,y){
 if(!rows.length)return -1;
 let best=0,d=Infinity;
 rows.forEach((r,i)=>{const z=Math.abs(r.cy-y);if(z<d){d=z;best=i}});
 return best;
}
function sliceSpan(span,from,to){
 const tn=Array.from(span.childNodes).find(n=>n.nodeType===Node.TEXT_NODE);
 if(!tn)return null;
 const len=tn.length;from=Math.max(0,Math.min(len,from));to=Math.max(0,Math.min(len,to));
 if(to<from){const t=from;from=to;to=t}if(to<=from)return null;
 try{
  const rg=document.createRange();rg.setStart(tn,from);rg.setEnd(tn,to);
  const rects=Array.from(rg.getClientRects()).filter(r=>r.width>.3&&r.height>.3);
  return {text:tn.textContent.slice(from,to),rects};
 }catch{return null}
}
function offsetByX(span,x){
 const tn=Array.from(span.childNodes).find(n=>n.nodeType===Node.TEXT_NODE);
 if(!tn||!tn.length)return 0;
 const sr=span.getBoundingClientRect();
 if(x<=sr.left)return 0;if(x>=sr.right)return tn.length;
 // Binary-search the caret position by rendered substring width. This respects PDF.js span transforms.
 let lo=0,hi=tn.length;
 while(lo<hi){
  const mid=Math.ceil((lo+hi)/2),part=sliceSpan(span,0,mid);
  const right=part?.rects?.length?Math.max(...part.rects.map(r=>r.right)):sr.left;
  if(right<x)lo=mid;else hi=mid-1;
 }
 const a=Math.max(0,lo),b=Math.min(tn.length,a+1);
 const ra=sliceSpan(span,0,a),rb=sliceSpan(span,0,b);
 const xa=ra?.rects?.length?Math.max(...ra.rects.map(r=>r.right)):sr.left;
 const xb=rb?.rects?.length?Math.max(...rb.rects.map(r=>r.right)):sr.right;
 return Math.abs(x-xa)<=Math.abs(x-xb)?a:b;
}
function buildGeometricSelection(n,startClient,endClient){
 const rec=S.pages.get(n),page=q(".lit-page",rec.el),pr=page.getBoundingClientRect();
 const start=pagePoint(page,startClient.x,startClient.y),end=pagePoint(page,endClient.x,endClient.y);
 const two=detectTwoColumns(page);
 const side=two?(start.x<.5?"left":"right"):null;
 const rows=visualRows(page,side);if(!rows.length)return null;
 let sr=nearestRowIndex(rows,startClient.y),er=nearestRowIndex(rows,endClient.y);
 if(sr<0||er<0)return null;
 const forward=sr<er||(sr===er&&endClient.x>=startClient.x);
 const first=forward?sr:er,last=forward?er:sr;
 const firstX=forward?startClient.x:endClient.x;
 const lastX=forward?endClient.x:startClient.x;
 const raw=[],texts=[];
 for(let ri=first;ri<=last;ri++){
  const row=rows[ri],parts=[];
  const rowLeft=Math.min(...row.items.map(it=>it.r.left));
  const rowRight=Math.max(...row.items.map(it=>it.r.right));
  let minX=rowLeft,maxX=rowRight;
  if(first===last){
   minX=Math.min(startClient.x,endClient.x);
   maxX=Math.max(startClient.x,endClient.x);
  }else{
   if(ri===first)minX=firstX;
   if(ri===last)maxX=lastX;
  }
  if(maxX<minX){const t=minX;minX=maxX;maxX=t}
  for(const it of row.items){
   const tn=Array.from(it.span.childNodes).find(n=>n.nodeType===Node.TEXT_NODE);
   if(!tn||!tn.length)continue;
   if(it.r.right<=minX||it.r.left>=maxX)continue;
   let from=0,to=tn.length;
   if(minX>it.r.left&&minX<it.r.right)from=offsetByX(it.span,minX);
   if(maxX>it.r.left&&maxX<it.r.right)to=offsetByX(it.span,maxX);
   const part=sliceSpan(it.span,from,to);if(!part||!part.rects.length)continue;
   parts.push(part.text);raw.push(...part.rects);
  }
  if(parts.length)texts.push(parts.join("").trimEnd());
 }
 const rects=normalizeVisualRects(raw,pr);
 if(!rects.length)return null;
 return {page:n,rects,text:texts.join("\n").trim(),kind:"text"};
}
function normalizeVisualRects(raw,pr){
 const rects=raw.map(r=>{
  let x1=clamp((r.left-pr.left)/pr.width),x2=clamp((r.right-pr.left)/pr.width);
  let y1=clamp((r.top-pr.top)/pr.height),y2=clamp((r.bottom-pr.top)/pr.height);
  const h=y2-y1;y1+=h*.08;y2-=h*.06;return [x1,y1,x2,y2];
 }).filter(r=>r[2]-r[0]>.0004&&r[3]-r[1]>.0004)
   .sort((u,v)=>(((u[1]+u[3])/2)-((v[1]+v[3])/2))||u[0]-v[0]);
 const merged=[];
 for(const r of rects){
  const last=merged[merged.length-1];
  if(last){
   const h=Math.max(r[3]-r[1],last[3]-last[1]);
   const sameLine=Math.abs((r[1]+r[3]-last[1]-last[3])/2)<=h*.38;
   const gap=r[0]-last[2];
   if(sameLine&&gap>=-.002&&gap<=.005){
    last[0]=Math.min(last[0],r[0]);last[1]=Math.min(last[1],r[1]);last[2]=Math.max(last[2],r[2]);last[3]=Math.max(last[3],r[3]);continue;
   }
  }
  merged.push([...r]);
 }
 return merged;
}
function beginGeometricSelection(n,e){
 if(S.area||e.button!==0)return;
 const rec=S.pages.get(n),page=q(".lit-page",rec.el);if(!page)return;
 // Only start a text drag when the pointer is inside the rendered text column area.
 const pr=page.getBoundingClientRect();
 const p=pagePoint(page,e.clientX,e.clientY);
 if(p.x<.02||p.x>.98||p.y<.01||p.y>.99)return;
 e.preventDefault();
 window.getSelection()?.removeAllRanges();
 if(S.pending){S.pending=null;paintPending();toolbar()}
 const start={x:e.clientX,y:e.clientY};
 S.dragSel={page:n,start,last:start,moved:false};
 try{page.setPointerCapture?.(e.pointerId)}catch{}
 const move=ev=>{
  if(!S.dragSel||S.dragSel.page!==n)return;
  const last={x:ev.clientX,y:ev.clientY};S.dragSel.last=last;
  if(!S.dragSel.moved&&Math.hypot(last.x-start.x,last.y-start.y)>2)S.dragSel.moved=true;
  if(!S.dragSel.moved)return;
  const next=buildGeometricSelection(n,start,last);
  if(next){S.pending=next;paintPending();toolbar()}
 };
 const up=ev=>{
  document.removeEventListener("pointermove",move,true);
  document.removeEventListener("pointerup",up,true);
  const drag=S.dragSel;S.dragSel=null;
  try{page.releasePointerCapture?.(e.pointerId)}catch{}
  if(!drag?.moved)return;
  const next=buildGeometricSelection(n,start,{x:ev.clientX,y:ev.clientY});
  if(next)S.pending=next;
  paintPending();toolbar();
 };
 document.addEventListener("pointermove",move,true);
 document.addEventListener("pointerup",up,true);
}
function paintPending(){qa(".lit-selection-layer").forEach(x=>x.innerHTML="");if(!S.pending)return;const r=S.pages.get(S.pending.page);if(!r?.rendered)return;const l=q(".lit-selection-layer",r.el);S.pending.rects.forEach(a=>{const d=document.createElement("div");d.className="lit-pending-selection";d.style.left=a[0]*100+"%";d.style.top=a[1]*100+"%";d.style.width=(a[2]-a[0])*100+"%";d.style.height=(a[3]-a[1])*100+"%";l.appendChild(d)})}
async function commit(action){
 if(!S.pending)return;
 const row=await api("/api/literature/"+S.paper.id+"/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({page:S.pending.page,type:action,rects:S.pending.rects,text:S.pending.text||"",comment:""})});
 S.undo.push({id:row.id,page:S.pending.page});
 const r=S.pages.get(S.pending.page);r?.annotations.push(row);
 S.pending=null;paintPending();paint(row.page);toolbar();annList();
}
function toggleArea(){S.area=!S.area;S.pending=null;paintPending();toolbar();q("#lit-pages").onpointerdown=S.area?areaStart:null}
function areaStart(e){
 const page=e.target.closest(".lit-page");if(!page||!S.area)return;e.preventDefault();const n=+page.dataset.page,pr=page.getBoundingClientRect(),a=[clamp((e.clientX-pr.left)/pr.width),clamp((e.clientY-pr.top)/pr.height)];
 const move=ev=>{const b=[clamp((ev.clientX-pr.left)/pr.width),clamp((ev.clientY-pr.top)/pr.height)];S.pending={page:n,text:"区域选块",kind:"area",rects:[[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]]};paintPending()};
 const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);S.area=false;q("#lit-pages").onpointerdown=null;toolbar()};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
}
async function undo(){const op=S.undo.pop();if(!op)return;await api("/api/literature/"+S.paper.id+"/annotations/"+op.id,{method:"DELETE"});const r=S.pages.get(op.page);if(r){r.annotations=r.annotations.filter(a=>a.id!==op.id);paint(op.page)}toolbar();annList()}
function paint(n){
 const r=S.pages.get(n);if(!r?.rendered)return;
 const svg=q(".lit-annotation-layer",r.el);svg.innerHTML="";
 (r.annotations||[]).forEach(a=>(a.rects||[]).forEach(x=>{
  if(a.type==="underline"||a.type==="strikeout"){
   const line=document.createElementNS("http://www.w3.org/2000/svg","line");
   const y=a.type==="underline"?x[3]:(x[1]+x[3])/2;
   line.setAttribute("x1",x[0]);line.setAttribute("x2",x[2]);line.setAttribute("y1",y);line.setAttribute("y2",y);
   line.setAttribute("class","ann-line "+(a.type==="underline"?"ann-underline-line":"ann-strike-line"));
   svg.appendChild(line);
  }else{
   const e=document.createElementNS("http://www.w3.org/2000/svg","rect");
   e.setAttribute("x",x[0]);e.setAttribute("y",x[1]);e.setAttribute("width",x[2]-x[0]);e.setAttribute("height",x[3]-x[1]);
   e.setAttribute("class","ann-highlight");svg.appendChild(e);
  }
 }));
}
function handlePageAnnotationClick(n,e){
 if(S.pending||S.area)return;
 const sel=window.getSelection();if(sel&&!sel.isCollapsed)return;
 const r=S.pages.get(n),page=q(".lit-page",r.el),pr=page.getBoundingClientRect();
 const x=clamp((e.clientX-pr.left)/pr.width),y=clamp((e.clientY-pr.top)/pr.height);
 const anns=[...(r.annotations||[])].reverse();
 for(const a of anns){
  for(const rect of a.rects||[]){
   const padY=Math.max(.003,(rect[3]-rect[1])*.28),padX=.003;
   if(x>=rect[0]-padX&&x<=rect[2]+padX&&y>=rect[1]-padY&&y<=rect[3]+padY){
    openAnnotation(n,a.id);return;
   }
  }
 }
}
function track(){const sc=q("#lit-scroll"),y=sc.getBoundingClientRect().top+70;let best=1,d=Infinity;S.pages.forEach((r,n)=>{const z=Math.abs(r.el.getBoundingClientRect().top-y);if(z<d){d=z;best=n}});if(best===S.current)return;S.current=best;toolbar();clearTimeout(track.t);track.t=setTimeout(()=>savePos(best),400)}
async function savePos(page){if(!S.paper||!S.pdf)return;const st=S.paper.reading_status==="未读"?"在读":S.paper.reading_status;S.paper.last_page=page;S.paper.reading_status=st;try{await api("/api/literature/"+S.paper.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({last_page:page,page_count:S.pdf.numPages,reading_status:st})})}catch{}}
function go(n,smooth=true){
 const rec=S.pages.get(n),sc=q("#lit-scroll");if(!rec||!sc)return;
 const top=Math.max(0,rec.el.offsetTop-8);
 sc.scrollTo({top,behavior:smooth?"smooth":"auto"});S.current=n;toolbar();
}
async function zoom(delta){if(!S.pdf)return;const keep=S.current;S.scale=Math.max(.65,Math.min(2.4,S.scale+delta));S.generation++;S.observer?.disconnect();await build();requestAnimationFrame(()=>go(keep,false))}
function toolbar(){if(!S.pdf)return;q("#lit-page-label").textContent=S.current+" / "+S.pdf.numPages;q("#lit-zoom-label").textContent=Math.round(S.scale*100)+"%";qa("[data-ann]").forEach(b=>{b.disabled=!S.pending;b.classList.toggle("ready",!!S.pending)});q("#lit-area").classList.toggle("active",S.area);q("#lit-area").textContent=S.area?"拖动选择区域…":"框选区域";q("#lit-undo").disabled=!S.undo.length}


async function openAnnotation(page,id){
 let r=S.pages.get(page);
 if(!r)return;
 if(!r.rendered)await renderPage(page);
 r=S.pages.get(page);
 const a=r?.annotations.find(x=>x.id===id);if(!a)return;
 S.selectedAnn={page,id};
 qa("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab==="annotations"));
 annList();
}
async function jumpToAnnotation(page,id){
 const r=S.pages.get(page);if(!r)return;
 if(!r.rendered)await renderPage(page);
 go(page,true);
 const rr=S.pages.get(page),a=rr?.annotations.find(x=>x.id===id);
 if(a){S.selectedAnn={page,id};qa("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab==="annotations"));annList();}
}
async function saveAnnotationComment(){
 if(!S.selectedAnn)return;
 const page=S.selectedAnn.page,id=S.selectedAnn.id;
 let r=S.pages.get(page);
 if(!r?.rendered)await renderPage(page);
 r=S.pages.get(page);
 const a=r?.annotations.find(x=>x.id===id);if(!a)return;
 const comment=q("#ann-comment")?.value||"";
 const saved=await api("/api/literature/"+S.paper.id+"/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...a,comment})});
 const i=r.annotations.findIndex(x=>x.id===saved.id);if(i>=0)r.annotations[i]=saved;else r.annotations.push(saved);
 S.selectedAnn=null;
 paint(page);
 annList();
 go(page,true);
}
function side(){const p=S.paper;q("#lit-side").innerHTML='<div class="lit-side-tabs"><button class="active" data-tab="info">信息</button><button data-tab="annotations">批注</button><button data-tab="notes">笔记</button></div><div id="lit-side-body"></div>';qa("[data-tab]").forEach(b=>b.onclick=()=>{if(b.dataset.tab!=="annotations")S.selectedAnn=null;qa("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));sideTab(b.dataset.tab)});sideTab("info")}
function sideTab(tab){
 const root=q("#lit-side-body"),p=S.paper;
 if(tab==="info"){root.innerHTML='<div class="lit-info"><label>题名<input id="li-title" value="'+esc(p.title)+'"></label><label>作者<input id="li-authors" value="'+esc(p.authors||"")+'"></label><div class="lit-two"><label>年份<input id="li-year" value="'+esc(p.year||"")+'"></label><label>阅读状态<select id="li-status"><option '+(p.reading_status==="未读"?"selected":"")+'>未读</option><option '+(p.reading_status==="在读"?"selected":"")+'>在读</option><option '+(p.reading_status==="已读"?"selected":"")+'>已读</option></select></label></div><label>分类（逗号分隔）<input id="li-categories" value="'+esc((p.categories||[]).join(", "))+'"></label><label>标签（逗号分隔）<input id="li-tags" value="'+esc((p.tags||[]).join(", "))+'"></label><label>期刊 / 会议<input id="li-venue" value="'+esc(p.venue||"")+'"></label><div class="lit-two"><label>DOI<input id="li-doi" value="'+esc(p.doi||"")+'"></label><label>Cite Key<input id="li-cite" value="'+esc(p.cite_key||"")+'"></label></div><label class="lit-favorite"><input type="checkbox" id="li-favorite" '+(p.favorite?"checked":"")+'> 收藏此文献</label><button class="primary-btn" id="li-save">保存信息</button></div>';q("#li-save").onclick=saveInfo}
 else if(tab==="annotations")annList();else note();
}
async function saveInfo(){const p={title:q("#li-title").value,authors:q("#li-authors").value,year:q("#li-year").value,reading_status:q("#li-status").value,categories:q("#li-categories").value.split(",").map(x=>x.trim()).filter(Boolean),tags:q("#li-tags").value.split(",").map(x=>x.trim()).filter(Boolean),venue:q("#li-venue").value,doi:q("#li-doi").value,cite_key:q("#li-cite").value,favorite:q("#li-favorite").checked};S.paper=await api("/api/literature/"+S.paper.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});await loadList()}
function loadedAnns(){return [...S.pages.entries()].flatMap(([page,r])=>(r.annotations||[]).map(a=>({...a,page}))).sort((a,b)=>a.page-b.page)}
function annList(){
 const root=q("#lit-side-body");if(!root||!q('[data-tab="annotations"]')?.classList.contains("active"))return;
 const rows=loadedAnns().filter(a=>!S.selectedAnn||a.id!==S.selectedAnn.id);
 let editor="";
 if(S.selectedAnn){
  const rr=S.pages.get(S.selectedAnn.page),a=rr?.annotations.find(x=>x.id===S.selectedAnn.id);
  if(a)editor='<section class="lit-ann-editor"><div class="lit-ann-editor-head"><strong>P.'+S.selectedAnn.page+' · '+esc(a.type)+'</strong><button id="ann-editor-close">×</button></div><blockquote>'+esc(a.text||"区域标记")+'</blockquote><label>批注<textarea id="ann-comment" placeholder="为这个标记添加批注…">'+esc(a.comment||"")+'</textarea></label><button class="primary-btn" id="ann-comment-save">保存批注</button></section>';
 }
 root.innerHTML=editor+'<div class="lit-ann-list">'+(rows.length?rows.map(a=>'<article class="lit-ann '+(S.selectedAnn?.id===a.id?"selected":"")+'" data-open-ann="'+a.id+'" data-page="'+a.page+'"><div><strong>P.'+a.page+" · "+esc(a.type)+'</strong><button data-del="'+a.id+'" data-page="'+a.page+'">×</button></div><blockquote>'+esc(a.text||"区域批注")+"</blockquote>"+(a.comment?"<p>"+esc(a.comment)+"</p>":"")+"</article>").join(""):'<div class="lit-empty">当前已加载页面暂无批注</div>')+"</div>";
 if(q("#ann-comment-save"))q("#ann-comment-save").onclick=saveAnnotationComment;
 if(q("#ann-editor-close"))q("#ann-editor-close").onclick=()=>{S.selectedAnn=null;annList()};
 qa("[data-open-ann]").forEach(x=>x.onclick=e=>{if(e.target.closest("[data-del]"))return;jumpToAnnotation(+x.dataset.page,x.dataset.openAnn)});
 qa("[data-del]").forEach(b=>b.onclick=async()=>{await api("/api/literature/"+S.paper.id+"/annotations/"+b.dataset.del,{method:"DELETE"});const r=S.pages.get(+b.dataset.page);if(r){r.annotations=r.annotations.filter(x=>x.id!==b.dataset.del);paint(+b.dataset.page)}if(S.selectedAnn?.id===b.dataset.del)S.selectedAnn=null;annList()});
}
async function note(){const root=q("#lit-side-body"),d=await api("/api/literature/"+S.paper.id+"/note");root.innerHTML='<textarea class="lit-note" id="lit-note" placeholder="Markdown 文献笔记…">'+esc(d.content||"")+'</textarea><div class="lit-note-actions"><span>Markdown · Ctrl+S 保存</span><button class="primary-btn" id="lit-note-save">保存笔记</button></div>';q("#lit-note-save").onclick=saveNote}
async function saveNote(){await api("/api/literature/"+S.paper.id+"/note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:q("#lit-note").value})})}
function throttle(fn,ms){let wait=false;return(...a)=>{if(wait)return;wait=true;fn(...a);setTimeout(()=>wait=false,ms)}}

async function start(){shell();await loadList()}
window.ERWLiterature={start};
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"&&q("#lit-note")){e.preventDefault();saveNote()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&S.paper&&!/input|textarea/i.test(document.activeElement?.tagName||"")){e.preventDefault();undo()}else if(e.key==="Escape"&&S.pending){S.pending=null;paintPending();toolbar()}});
})();