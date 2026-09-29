(()=>{
"use strict";
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp=v=>Math.max(0,Math.min(1,v));
const S={items:[],paper:null,pdf:null,scale:1.15,current:1,pages:new Map(),observer:null,pending:null,undo:[],area:false,generation:0,selectedAnn:null,selectionOrigin:null,dragSel:null,annotations:[]};

async function api(url,opts={}){const r=await fetch(url,opts);let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.message||d.error||("HTTP "+r.status));return d}
async function ensurePdfJs(){
 if(window.pdfjsLib)return;
 await new Promise((ok,bad)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";s.onload=ok;s.onerror=bad;document.head.appendChild(s)});
 if(!window.pdfjsLib)throw new Error("PDF.js 加载失败");
 window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}
/* v260929 · 阅读区列表条目统一为文献列表页风格（.doc-item 同构）：标题→摘要→徽章行→项目+日期
   徽章行 = 阅读状态 + 收藏 + 分类标记；附件徽章去掉（点击条目本身即打开 PDF，徽章冗余）
   分类统一走「分类标记」（kind_marks），原 categories 徽章已移除（与标记重复） */
function item(x){
 const act=S.paper?.id===x.id?" active":"";
 const favB=x.favorite?'<span class="badge" title="已收藏">★</span>':"";
 const summ=x.excerpt?esc(x.excerpt):((x.authors||"")+(x.year?(" · "+x.year):""));
 const markB=window.ERWMarkBadges?window.ERWMarkBadges(x):"";
 const projBadges=(x.projects||[]).slice(0,1).map(p=>'<span class="badge accent proj-badge"><span class="proj-text">'+esc(p)+"</span></span>").join("");
 const dateB=x.updated_at?'<span class="badge mono">'+esc(String(x.updated_at).slice(0,10))+"</span>":"";
 const projRow=(projBadges||dateB)?'<div class="doc-projects">'+projBadges+dateB+"</div>":"";
 return '<article class="doc-item lit-item'+act+'" data-paper="'+esc(x.id)+'"><div class="title">'+esc(x.title)+'</div><div class="excerpt">'+summ+'</div><div class="tags"><span class="badge lit-status '+(x.reading_status==="已读"?"done":x.reading_status==="在读"?"reading":"")+'">'+esc(x.reading_status||"未读")+"</span>"+favB+markB+"</div>"+projRow+"</article>";
}

async function loadList(){
 const d=await api("/api/literature?q="+encodeURIComponent(q("#lit-search")?.value||"")+"&status="+encodeURIComponent(q("#lit-status")?.value||"")+"&mark="+encodeURIComponent(q("#lit-mark")?.value||"")+"&page_size=100");
 S.items=d.items||[];
 q("#lit-list").innerHTML=S.items.length?S.items.map(item).join(""):'<div class="lit-empty">暂无文献<br>点击“上传 PDF”开始</div>';
 const c=q("#lit-mark"),old=c.value;c.innerHTML='<option value="">全部分类</option>'+(window.ERWMarkList?window.ERWMarkList():[]).map(k=>'<option value="'+esc(k.id)+'"'+(k.id===old?" selected":"")+">"+esc(k.icon)+" "+esc(k.label)+"</option>").join("");
 qa("[data-paper]").forEach(e=>e.onclick=()=>openPaper(e.dataset.paper));
}
function shell(){
 q("#main").innerHTML='<div class="lit-shell"><aside class="card doc-list-panel lit-library"><div class="lit-library-head"><div><div class="card-kicker">LITERATURE LIBRARY</div><h3>文献库</h3></div><div class="lit-head-actions"><button class="ghost-btn" id="lit-back">← 返回文献列表</button><button class="primary-btn" id="lit-upload">＋ 上传 PDF</button></div></div><input id="lit-file" type="file" accept="application/pdf,.pdf" hidden><div class="doc-filter"><input class="search-input" id="lit-search" placeholder="搜索题名、作者、标签、分类…"><div class="lit-filters"><select class="search-input" id="lit-status"><option value="">全部进度</option><option>未读</option><option>在读</option><option>已读</option></select><select class="search-input" id="lit-mark"><option value="">全部分类</option></select></div></div><div class="doc-list lit-list" id="lit-list"></div></aside><section class="card lit-reader"><div id="lit-reader-empty" class="lit-empty lit-reader-empty">选择一篇文献开始阅读</div><div id="lit-reader-live" hidden><div class="lit-toolbar"><button data-ann="highlight" disabled>高亮</button><button data-ann="underline" disabled>下划线</button><button data-ann="strikeout" disabled>删除线</button><button id="lit-copy" disabled title="Ctrl+C">复制</button><button id="lit-area">框选区域</button><span class="lit-sep"></span><button id="lit-undo" disabled title="Ctrl+Z">↶ 撤销</button><span class="lit-sep"></span><span id="lit-page-label">1 / 1</span><button id="lit-zoom-out">−</button><span id="lit-zoom-label">115%</span><button id="lit-zoom-in">＋</button></div><div class="lit-canvas-scroll" id="lit-scroll"><div id="lit-pages" class="lit-pages"></div></div></div></section><aside class="card lit-side" id="lit-side"><div class="lit-empty">文献信息、批注和笔记将在这里显示</div></aside></div>';
 q("#lit-upload").onclick=()=>q("#lit-file").click();q("#lit-file").onchange=e=>upload(e.target.files?.[0]);
 q("#lit-back").onclick=()=>window.dispatchEvent(new Event("erw-lit-back")); /* v260929 · 返回文献列表：经事件通知 app.js 重新渲染列表页（hash 未变不触发路由） */
 let t;q("#lit-search").oninput=()=>{clearTimeout(t);t=setTimeout(loadList,160)};q("#lit-status").onchange=loadList;q("#lit-mark").onchange=loadList;
 qa("[data-ann]").forEach(b=>b.onclick=()=>commit(b.dataset.ann));q("#lit-copy").onclick=copyPendingText;q("#lit-area").onclick=toggleArea;q("#lit-undo").onclick=undo;q("#lit-zoom-in").onclick=()=>zoom(.15);q("#lit-zoom-out").onclick=()=>zoom(-.15);
}
async function upload(file){if(!file)return;try{const r=await fetch("/api/literature/import",{method:"POST",headers:{"Content-Type":"application/pdf","X-Filename":encodeURIComponent(file.name)},body:file});const d=await r.json();if(!r.ok)throw new Error(d.message||"上传失败");await loadList();await openPaper(d.id)}catch(e){alert(e.message)}finally{q("#lit-file").value=""}}

async function openPaper(id){
 reset();
 const enc=encodeURIComponent(id);
 const [paper,annotations]=await Promise.all([
  api("/api/literature/"+enc),
  api("/api/literature/"+enc+"/annotations")
 ]);
 S.paper=paper;S.annotations=Array.isArray(annotations)?annotations:[];
 q("#lit-reader-empty").hidden=true;q("#lit-reader-live").hidden=false;side();loadList().catch(()=>{}) /* v260929 · 列表刷新仅更新徽章，不阻塞 PDF 加载 */;
 try{await ensurePdfJs();S.pdf=await window.pdfjsLib.getDocument({url:"/api/literature/"+enc+"/pdf",rangeChunkSize:4*1024*1024}).promise;S.current=Math.max(1,Math.min(S.pdf.numPages,+S.paper.last_page||1));await build();requestAnimationFrame(()=>go(S.current,false))}
 catch(e){q("#lit-pages").innerHTML='<div class="lit-empty">PDF 渲染失败：'+esc(e.message)+"</div>"}
}
function reset(){S.generation++;S.observer?.disconnect();S.pages.clear();S.pending=null;S.undo=[];S.area=false;S.pdf=null;S.selectedAnn=null;S.selectionOrigin=null;S.dragSel=null;S.annotations=[]}
function annotationsForPage(page){return (S.annotations||[]).filter(a=>+a.page===+page)}
function annotationById(id){return (S.annotations||[]).find(a=>a.id===id)||null}
function upsertAnnotation(a){
 const i=S.annotations.findIndex(x=>x.id===a.id);
 if(i>=0)S.annotations[i]=a;else S.annotations.push(a);
 const r=S.pages.get(+a.page);
 if(r){
  const j=(r.annotations||[]).findIndex(x=>x.id===a.id);
  if(j>=0)r.annotations[j]=a;else r.annotations.push(a);
 }
}
function removeAnnotationLocal(id,page){
 S.annotations=S.annotations.filter(a=>a.id!==id);
 const r=S.pages.get(+page);
 if(r)r.annotations=(r.annotations||[]).filter(a=>a.id!==id);
}
async function build(){
 const host=q("#lit-pages");host.innerHTML="";S.pages.clear();const gen=S.generation;
 for(let n=1;n<=S.pdf.numPages;n++){
  const p=await S.pdf.getPage(n);if(gen!==S.generation)return;const vp=p.getViewport({scale:S.scale});
  const el=document.createElement("div");el.className="lit-page-shell";el.dataset.page=n;el.style.width=vp.width+"px";el.style.height=vp.height+"px";el.innerHTML='<div class="lit-page-placeholder">第 '+n+" 页</div>";host.appendChild(el);S.pages.set(n,{el,rendered:false,rendering:false,annotations:annotationsForPage(n)});
 }
 S.observer=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)renderPage(+e.target.dataset.page)}),{root:q("#lit-scroll"),rootMargin:"1000px 0px",threshold:.01});
 S.pages.forEach(r=>S.observer.observe(r.el));q("#lit-scroll").onscroll=throttle(track,100);toolbar();
}
async function renderPage(n){
 const r=S.pages.get(n);if(!r||r.rendered||r.rendering||!S.pdf)return;r.rendering=true;const gen=S.generation;
 try{
  const p=await S.pdf.getPage(n),vp=p.getViewport({scale:S.scale}),dpr=window.devicePixelRatio||1;if(gen!==S.generation)return;
  r.el.style.width=vp.width+"px";r.el.style.height=vp.height+"px";r.el.innerHTML='<div class="lit-page" data-page="'+n+'" style="width:'+vp.width+'px;height:'+vp.height+'px"><canvas></canvas><svg class="lit-annotation-layer" viewBox="0 0 1 1" preserveAspectRatio="none"></svg><div class="lit-selection-layer"></div><div class="lit-interaction-layer" title="拖动选择文字"></div></div>';
  const cv=q("canvas",r.el),ctx=cv.getContext("2d");cv.width=Math.floor(vp.width*dpr);cv.height=Math.floor(vp.height*dpr);cv.style.width=vp.width+"px";cv.style.height=vp.height+"px";
  await p.render({canvasContext:ctx,viewport:vp,transform:dpr===1?null:[dpr,0,0,dpr,0,0]}).promise;if(gen!==S.generation)return;
  const text=await p.getTextContent();
  r.textItems=buildPdfTextGeometry(text,vp);
  r.annotations=annotationsForPage(n);r.rendered=true;
  const pageEl=q(".lit-page",r.el),hit=q(".lit-interaction-layer",r.el);
  hit.onmousedown=e=>beginPdfGeometrySelection(n,e);
  hit.onclick=e=>handlePageAnnotationClick(n,e);
  paint(n);
 }catch(e){r.el.innerHTML='<div class="lit-page-error">第 '+n+" 页渲染失败："+esc(e.message)+"</div>"}finally{r.rendering=false}
}

function buildPdfTextGeometry(text,viewport){
 const out=[];
 for(const it of text.items||[]){
  const str=String(it.str||"");if(!str.trim())continue;
  const tx=window.pdfjsLib.Util.transform(viewport.transform,it.transform);
  const h=Math.max(1,Math.hypot(tx[2],tx[3]));
  const w=Math.max(1,Math.abs((it.width||0)*viewport.scale));
  const x=tx[4],y=tx[5]-h;
  out.push({
   text:str,
   x1:clamp(x/viewport.width), y1:clamp(y/viewport.height),
   x2:clamp((x+w)/viewport.width), y2:clamp((y+h)/viewport.height),
   cx:clamp((x+w*.5)/viewport.width), cy:clamp((y+h*.5)/viewport.height),
   h:h/viewport.height
  });
 }
 return out;
}
function geometryHasTwoColumns(items){
 if(!items?.length)return false;
 let left=0,right=0,center=0;
 for(const it of items){
  if(it.x2-it.x1>.55){center++;continue}
  if(it.cx<.46)left++;else if(it.cx>.54)right++;else center++;
 }
 return left>10&&right>10&&center<Math.max(12,(left+right)*.22);
}
function geometryRows(items,side){
 let list=(items||[]).filter(it=>side==="left"?it.cx<.5:side==="right"?it.cx>.5:true)
   .slice().sort((a,b)=>a.cy-b.cy||a.x1-b.x1);
 const rows=[];
 for(const it of list){
  let row=rows[rows.length-1];
  if(!row||Math.abs(it.cy-row.cy)>Math.max(it.h,row.h)*.58){
   row={items:[],cy:it.cy,h:it.h};rows.push(row);
  }
  row.items.push(it);
  row.cy=row.items.reduce((s,v)=>s+v.cy,0)/row.items.length;
  row.h=Math.max(...row.items.map(v=>v.h));
 }
 rows.forEach(row=>row.items.sort((a,b)=>a.x1-b.x1));
 return rows;
}
function nearestGeometryRow(rows,y){
 let best=-1,d=Infinity;
 rows.forEach((r,i)=>{const z=Math.abs(r.cy-y);if(z<d){d=z;best=i}});
 return best;
}
function charOffsetForX(it,x){
 const len=Math.max(1,it.text.length);
 const t=clamp((x-it.x1)/Math.max(.00001,it.x2-it.x1));
 return Math.max(0,Math.min(len,Math.round(t*len)));
}
function buildSelectionFromPdfGeometry(n,start,end){
 const rec=S.pages.get(n);if(!rec?.textItems?.length)return null;
 const two=geometryHasTwoColumns(rec.textItems);
 const side=two?(start.x<.5?"left":"right"):null;
 const rows=geometryRows(rec.textItems,side);if(!rows.length)return null;
 let sr=nearestGeometryRow(rows,start.y),er=nearestGeometryRow(rows,end.y);
 if(sr<0||er<0)return null;
 const forward=sr<er||(sr===er&&end.x>=start.x);
 const first=forward?sr:er,last=forward?er:sr;
 const firstX=forward?start.x:end.x,lastX=forward?end.x:start.x;
 const rects=[],lines=[];
 for(let ri=first;ri<=last;ri++){
  const row=rows[ri],rowLeft=Math.min(...row.items.map(it=>it.x1)),rowRight=Math.max(...row.items.map(it=>it.x2));
  let minX=rowLeft,maxX=rowRight;
  if(first===last){minX=Math.min(start.x,end.x);maxX=Math.max(start.x,end.x);}
  else{if(ri===first)minX=firstX;if(ri===last)maxX=lastX;}
  if(maxX<minX){const t=minX;minX=maxX;maxX=t}
  const parts=[];
  for(const it of row.items){
   if(it.x2<=minX||it.x1>=maxX)continue;
   let from=0,to=it.text.length;
   if(minX>it.x1&&minX<it.x2)from=charOffsetForX(it,minX);
   if(maxX>it.x1&&maxX<it.x2)to=charOffsetForX(it,maxX);
   if(to<from){const t=from;from=to;to=t}
   if(to<=from)continue;
   const len=Math.max(1,it.text.length),w=it.x2-it.x1;
   const x1=it.x1+w*(from/len),x2=it.x1+w*(to/len);
   const hh=it.y2-it.y1;
   rects.push([x1,it.y1+hh*.10,x2,it.y2-hh*.08]);
   parts.push(it.text.slice(from,to));
  }
  if(parts.length)lines.push(parts.join("").trimEnd());
 }
 const merged=mergeGeometryRects(rects);
 if(!merged.length)return null;
 return {page:n,rects:merged,text:lines.join("\n").trim(),kind:"text"};
}
function mergeGeometryRects(rects){
 const list=rects.filter(r=>r[2]-r[0]>.0003&&r[3]-r[1]>.0003)
  .sort((a,b)=>(((a[1]+a[3])/2)-((b[1]+b[3])/2))||a[0]-b[0]);
 const out=[];
 for(const r of list){
  const last=out[out.length-1];
  if(last){
   const h=Math.max(r[3]-r[1],last[3]-last[1]);
   const same=Math.abs((r[1]+r[3]-last[1]-last[3])/2)<=h*.5;
   const gap=r[0]-last[2];
   if(same&&gap>=-.003&&gap<=.012){
    last[0]=Math.min(last[0],r[0]);last[1]=Math.min(last[1],r[1]);
    last[2]=Math.max(last[2],r[2]);last[3]=Math.max(last[3],r[3]);continue;
   }
  }
  out.push([...r]);
 }
 return out;
}
function eventPointInPage(page,e){
 const pr=page.getBoundingClientRect();
 return {x:clamp((e.clientX-pr.left)/pr.width),y:clamp((e.clientY-pr.top)/pr.height)};
}
function beginPdfGeometrySelection(n,e){
 if(S.area||e.button!==0)return;
 const rec=S.pages.get(n),page=q(".lit-page",rec.el);if(!page||!rec.textItems?.length)return;
 e.preventDefault();e.stopPropagation();
 if(S.pending){S.pending=null;paintPending();toolbar()}
 const start=eventPointInPage(page,e);
 S.dragSel={page:n,start,last:start,moved:false};
 const move=ev=>{
  if(!S.dragSel||S.dragSel.page!==n)return;
  const last=eventPointInPage(page,ev);S.dragSel.last=last;
  if(!S.dragSel.moved&&Math.hypot((last.x-start.x)*page.clientWidth,(last.y-start.y)*page.clientHeight)>3)S.dragSel.moved=true;
  if(!S.dragSel.moved)return;
  const next=buildSelectionFromPdfGeometry(n,start,last);
  if(next){S.pending=next;paintPending();toolbar()}
 };
 const up=ev=>{
  document.removeEventListener("mousemove",move,true);document.removeEventListener("mouseup",up,true);
  const drag=S.dragSel;S.dragSel=null;if(!drag?.moved)return;
  const last=eventPointInPage(page,ev),next=buildSelectionFromPdfGeometry(n,start,last);
  if(next)S.pending=next;paintPending();toolbar();
 };
 document.addEventListener("mousemove",move,true);
 document.addEventListener("mouseup",up,true);
}
function paintPending(){qa(".lit-selection-layer").forEach(x=>x.innerHTML="");if(!S.pending)return;const r=S.pages.get(S.pending.page);if(!r?.rendered)return;const l=q(".lit-selection-layer",r.el);S.pending.rects.forEach(a=>{const d=document.createElement("div");d.className="lit-pending-selection";d.style.left=a[0]*100+"%";d.style.top=a[1]*100+"%";d.style.width=(a[2]-a[0])*100+"%";d.style.height=(a[3]-a[1])*100+"%";l.appendChild(d)})}

function areaPreviewDataUrl(pending){
 if(!pending||pending.kind!=="area"||!pending.rects?.[0])return "";
 const rec=S.pages.get(pending.page),canvas=q("canvas",rec?.el);
 if(!canvas)return "";
 const [x1,y1,x2,y2]=pending.rects[0];
 const sx=Math.max(0,Math.floor(x1*canvas.width)),sy=Math.max(0,Math.floor(y1*canvas.height));
 const sw=Math.max(1,Math.floor((x2-x1)*canvas.width)),sh=Math.max(1,Math.floor((y2-y1)*canvas.height));
 const maxW=640,maxH=420,scale=Math.min(1,maxW/sw,maxH/sh);
 const out=document.createElement("canvas");
 out.width=Math.max(1,Math.round(sw*scale));out.height=Math.max(1,Math.round(sh*scale));
 const ctx=out.getContext("2d");
 ctx.drawImage(canvas,sx,sy,sw,sh,0,0,out.width,out.height);
 return out.toDataURL("image/webp",.82);
}
async function copyPendingText(){
 const text=String(S.pending?.text||"");
 if(!text||S.pending?.kind==="area")return;
 try{
  await navigator.clipboard.writeText(text);
 }catch{
  const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
  document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
 }
 const b=q("#lit-copy");if(b){const old=b.textContent;b.textContent="已复制";b.classList.add("copied");setTimeout(()=>{if(b){b.textContent=old;b.classList.remove("copied")}},900)}
}
function previewUrl(a){
 return a?.preview_path?"/workspace-file/"+String(a.preview_path).split("/").map(encodeURIComponent).join("/"):"";
}
function annotationExcerpt(a,small=false){
 if(a?.selection_kind==="area"&&a?.preview_path){
  return '<div class="lit-ann-preview-wrap"><img class="lit-ann-preview'+(small?' small':'')+'" src="'+previewUrl(a)+'" alt="框选区域截图"></div>';
 }
 return '<blockquote>'+esc(a?.text||"区域标记")+'</blockquote>';
}
async function commit(action){
 if(!S.pending)return;
 const payload={
  page:S.pending.page,type:action,rects:S.pending.rects,text:S.pending.text||"",comment:"",
  selection_kind:S.pending.kind||"text"
 };
 if(S.pending.kind==="area")payload.preview_data_url=areaPreviewDataUrl(S.pending);
 const row=await api("/api/literature/"+S.paper.id+"/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
 S.undo.push({id:row.id,page:S.pending.page});
 upsertAnnotation(row);
 S.pending=null;paintPending();paint(row.page);toolbar();annList();
}
function toggleArea(){
 S.area=!S.area;S.pending=null;paintPending();toolbar();
 qa(".lit-interaction-layer").forEach(el=>{el.onmousedown=S.area?areaStart:null});
}
function areaStart(e){
 const page=e.target.closest(".lit-page");if(!page||!S.area)return;e.preventDefault();const n=+page.dataset.page,pr=page.getBoundingClientRect(),a=[clamp((e.clientX-pr.left)/pr.width),clamp((e.clientY-pr.top)/pr.height)];
 const move=ev=>{const b=[clamp((ev.clientX-pr.left)/pr.width),clamp((ev.clientY-pr.top)/pr.height)];S.pending={page:n,text:"区域选块",kind:"area",rects:[[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]]};paintPending()};
 const up=()=>{document.removeEventListener("mousemove",move,true);document.removeEventListener("mouseup",up,true);S.area=false;qa(".lit-interaction-layer").forEach(el=>el.onmousedown=null);toolbar()};document.addEventListener("mousemove",move,true);document.addEventListener("mouseup",up,true);
}
async function undo(){const op=S.undo.pop();if(!op)return;await api("/api/literature/"+S.paper.id+"/annotations/"+op.id,{method:"DELETE"});removeAnnotationLocal(op.id,op.page);paint(op.page);toolbar();annList()}
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
function toolbar(){if(!S.pdf)return;q("#lit-page-label").textContent=S.current+" / "+S.pdf.numPages;q("#lit-zoom-label").textContent=Math.round(S.scale*100)+"%";qa("[data-ann]").forEach(b=>{b.disabled=!S.pending;b.classList.toggle("ready",!!S.pending)});q("#lit-area").classList.toggle("active",S.area);q("#lit-area").textContent=S.area?"拖动选择区域…":"框选区域";q("#lit-undo").disabled=!S.undo.length;const cp=q("#lit-copy");if(cp)cp.disabled=!(S.pending?.kind==="text"&&S.pending?.text)}


async function openAnnotation(page,id){
 const a=annotationById(id);if(!a)return;
 S.selectedAnn={page:+page,id};
 qa("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab==="annotations"));
 annList();
}
async function jumpToAnnotation(page,id){
 const r=S.pages.get(+page);if(!r)return;
 if(!r.rendered)await renderPage(+page);
 go(+page,true);
 const a=annotationById(id);
 if(a){S.selectedAnn={page:+page,id};qa("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab==="annotations"));annList();}
}
async function saveAnnotationComment(){
 if(!S.selectedAnn)return;
 const page=+S.selectedAnn.page,id=S.selectedAnn.id;
 const a=annotationById(id);if(!a)return;
 const comment=q("#ann-comment")?.value||"";
 const saved=await api("/api/literature/"+S.paper.id+"/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...a,comment})});
 upsertAnnotation(saved);
 S.selectedAnn=null;
 paint(page);annList();go(page,true);
}
function side(){const p=S.paper;q("#lit-side").innerHTML='<div class="lit-side-tabs"><button class="active" data-tab="info">信息</button><button data-tab="annotations">批注</button><button data-tab="notes">笔记</button></div><div id="lit-side-body"></div>';qa("[data-tab]").forEach(b=>b.onclick=()=>{if(b.dataset.tab!=="annotations")S.selectedAnn=null;qa("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));sideTab(b.dataset.tab)});sideTab("info")}
function sideTab(tab){
 const root=q("#lit-side-body"),p=S.paper;
 if(tab==="info"){root.innerHTML='<div class="lit-info"><label>题名<input id="li-title" value="'+esc(p.title)+'"></label><label>作者<input id="li-authors" value="'+esc(p.authors||"")+'"></label><div class="lit-two"><label>年份<input id="li-year" value="'+esc(p.year||"")+'"></label><label>阅读状态<select id="li-status"><option '+(p.reading_status==="未读"?"selected":"")+'>未读</option><option '+(p.reading_status==="在读"?"selected":"")+'>在读</option><option '+(p.reading_status==="已读"?"selected":"")+'>已读</option></select></label></div><label class="lit-marks-label">分类标记</label><div class="mark-chip-box" id="li-marks"></div><label class="lit-marks-label">标签</label><div class="project-picker-row"><div class="project-chip-box" id="li-tags"></div><button type="button" class="secondary-btn project-add-btn" id="li-tag-add" title="添加标签：可勾选已有或输入新标签">＋</button></div><label>期刊 / 会议<input id="li-venue" value="'+esc(p.venue||"")+'"></label><div class="lit-two"><label>DOI<input id="li-doi" value="'+esc(p.doi||"")+'"></label><label>Cite Key<input id="li-cite" value="'+esc(p.cite_key||"")+'"></label></div><label class="lit-favorite"><input type="checkbox" id="li-favorite" '+(p.favorite?"checked":"")+'> 收藏此文献</label><button class="primary-btn" id="li-save">保存信息</button></div>';q("#li-save").onclick=saveInfo;renderLiMarks();paintLiTags(p.tags||[])}
 else if(tab==="annotations")annList();else note();
}
async function saveInfo(){const p={title:q("#li-title").value,authors:q("#li-authors").value,year:q("#li-year").value,reading_status:q("#li-status").value,tags:liTags(),venue:q("#li-venue").value,doi:q("#li-doi").value,cite_key:q("#li-cite").value,favorite:q("#li-favorite").checked,kind_marks:qa("#li-marks .mark-chip.on").map(b=>b.dataset.mark)};S.paper=await api("/api/literature/"+S.paper.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});await loadList()}
/* v260929 · 阅读区信息栏「分类标记」chips：与编辑区同款渲染（复用 app.js 的 ERWMarkChips），保存时随 saveInfo 写回条目 md */
function renderLiMarks(){
 const box=q("#li-marks"); if(!box||!window.ERWMarkChips)return;
 const on=qa("#li-marks .mark-chip.on").map(b=>b.dataset.mark);
 const saved=(S.paper&&S.paper.kind_marks)||[];
 box.innerHTML=window.ERWMarkChips.html([...new Set([...on,...saved])]);
 qa("#li-marks .mark-chip:not(.add-mark)").forEach(b=>b.onclick=()=>b.classList.toggle("on"));
 const add=q("#li-marks .mark-chip.add-mark");
  if(add)add.onclick=()=>window.ERWMarkChips.openManager(renderLiMarks);
}
/* v260929 · 阅读区标签 chip 化：与文献编辑区同款（× 移除 + ＋ 弹窗勾选已有或新建），替换原逗号输入框 */
function liTags(){const box=q("#li-tags");if(!box)return [];try{const v=JSON.parse(box.dataset.tags||"[]");return Array.isArray(v)?v:[]}catch{return []}}
function paintLiTags(tags){
 const box=q("#li-tags");if(!box)return;
 const list=[...new Set((tags||[]).map(x=>String(x).trim()).filter(Boolean))];
 box.dataset.tags=JSON.stringify(list);
 box.innerHTML=list.length?list.map((t,i)=>'<span class="project-chip tag-chip">'+esc(t)+'<button type="button" data-tag-remove="'+i+'" title="移除标签">×</button></span>').join(""):'<span class="row-meta">暂无标签</span>';
 qa("[data-tag-remove]",box).forEach(b=>b.onclick=()=>{const now=liTags();now.splice(+b.dataset.tagRemove,1);paintLiTags(now)});
 const add=q("#li-tag-add");
 if(add)add.onclick=()=>{if(window.ERWTagPicker)window.ERWTagPicker(liTags(),()=>[...new Set(S.items.flatMap(x=>x.tags||[]))],paintLiTags)};
}
function loadedAnns(){return [...(S.annotations||[])].sort((a,b)=>(+a.page-+b.page)||String(a.created_at||"").localeCompare(String(b.created_at||"")))}
function annList(){
 const root=q("#lit-side-body");if(!root||!q('[data-tab="annotations"]')?.classList.contains("active"))return;
 const rows=loadedAnns().filter(a=>!S.selectedAnn||a.id!==S.selectedAnn.id);
 let editor="";
 if(S.selectedAnn){
  const a=annotationById(S.selectedAnn.id);
  if(a)editor='<section class="lit-ann-editor"><div class="lit-ann-editor-head"><strong>P.'+S.selectedAnn.page+' · '+esc(a.type)+'</strong><button id="ann-editor-close">×</button></div>'+annotationExcerpt(a,false)+'<label>批注<textarea id="ann-comment" placeholder="为这个标记添加批注…">'+esc(a.comment||"")+'</textarea></label><button class="primary-btn" id="ann-comment-save">保存批注</button></section>';
 }
 root.innerHTML=editor+'<div class="lit-ann-list">'+(rows.length?rows.map(a=>'<article class="lit-ann '+(S.selectedAnn?.id===a.id?"selected":"")+'" data-open-ann="'+a.id+'" data-page="'+a.page+'"><div><strong>P.'+a.page+" · "+esc(a.type)+'</strong><button data-del="'+a.id+'" data-page="'+a.page+'">×</button></div>'+annotationExcerpt(a,true)+(a.comment?"<p>"+esc(a.comment)+"</p>":"")+"</article>").join(""):'<div class="lit-empty">当前已加载页面暂无批注</div>')+"</div>";
 if(q("#ann-comment-save"))q("#ann-comment-save").onclick=saveAnnotationComment;
 if(q("#ann-editor-close"))q("#ann-editor-close").onclick=()=>{S.selectedAnn=null;annList()};
 qa("[data-open-ann]").forEach(x=>x.onclick=e=>{if(e.target.closest("[data-del]"))return;jumpToAnnotation(+x.dataset.page,x.dataset.openAnn)});
 qa("[data-del]").forEach(b=>b.onclick=async()=>{const page=+b.dataset.page;await api("/api/literature/"+S.paper.id+"/annotations/"+b.dataset.del,{method:"DELETE"});removeAnnotationLocal(b.dataset.del,page);paint(page);if(S.selectedAnn?.id===b.dataset.del)S.selectedAnn=null;annList()});
}
async function note(){const root=q("#lit-side-body"),d=await api("/api/literature/"+S.paper.id+"/note");root.innerHTML='<textarea class="lit-note" id="lit-note" placeholder="Markdown 文献笔记…">'+esc(d.content||"")+'</textarea><div class="lit-note-actions"><span>Markdown · Ctrl+S 保存</span><button class="primary-btn" id="lit-note-save">保存笔记</button></div>';q("#lit-note-save").onclick=saveNote}
async function saveNote(){await api("/api/literature/"+S.paper.id+"/note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:q("#lit-note").value})})}
function throttle(fn,ms){let wait=false;return(...a)=>{if(wait)return;wait=true;fn(...a);setTimeout(()=>wait=false,ms)}}

async function start(){shell();await loadList()}
/* v260929 · 由文献条目附件徽章进入：按 attachment 路径尾段匹配库内 PDF 文件名（stored_filename 唯一），
   命中则进工作区并直接打开该论文；未登记（如手动填写附件路径的旧条目）抛错，由调用方退回新窗口直开 */
async function openByAttachment(att){
 const name=String(att||"").split(/[\\/]/).pop().trim();
 if(!name)throw new Error("无附件路径");
 const d=await api("/api/literature?page_size=200");
 const hit=(d.items||[]).find(x=>String(x.stored_filename||"")===name);
 if(!hit)throw new Error("该附件未登记到 PDF 工作区");
 await start();await openPaper(hit.id);
}
window.ERWLiterature={start,openByAttachment};
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"&&q("#lit-note")){e.preventDefault();saveNote()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="c"&&S.pending?.kind==="text"&&!/input|textarea/i.test(document.activeElement?.tagName||"")){e.preventDefault();copyPendingText()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&S.paper&&!/input|textarea/i.test(document.activeElement?.tagName||"")){e.preventDefault();undo()}else if(e.key==="Escape"&&S.pending){S.pending=null;paintPending();toolbar()}});
})();