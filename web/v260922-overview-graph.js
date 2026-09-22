(() => {
  'use strict';

  const ROUTE = 'research-overview';
  const MAX_NODES = 80;
  const KIND_COLOR = {idea:'#2a9d8f',journal:'#5b8def',note:'#6f7a8a',milestone:'#c6863b',summary:'#845ec2',literature:'#2673a7',tag:'#b56a9d',project:'#087f8c'};
  const route = () => (location.hash || '#overview').slice(1).split('?')[0];
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const css = (name,fallback='') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  function hashString(s) {
    let h=2166136261>>>0;
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return h>>>0;
  }
  function seeded(seed){
    let x=(seed||1)>>>0;
    x^=x<<13;x^=x>>>17;x^=x<<5;
    return ((x>>>0)%1000000)/1000000;
  }

  class OverviewGraph {
    constructor(canvas, graph) {
      this.canvas=canvas;
      this.ctx=canvas.getContext('2d');
      this.graph=graph||{nodes:[],edges:[]};
      this.nodes=(this.graph.nodes||[]).slice(0,MAX_NODES);
      this.nodeMap=new Map(this.nodes.map(n=>[String(n.id),n]));
      this.edges=(this.graph.edges||[]).filter(e=>this.nodeMap.has(String(e.source))&&this.nodeMap.has(String(e.target)));
      this.adj=new Map(this.nodes.map(n=>[String(n.id),[]]));
      this.degree=new Map(this.nodes.map(n=>[String(n.id),0]));
      this.layout=new Map();
      this.screen=new Map();
      this.labelWidths=new Map();
      this.camera={panX:0,panY:0,zoom:1};
      this.drag=null;
      this.dragMoved=false;
      this.pressId=null;
      this.renderPending=false;
      this.destroyed=false;
      this.buildIndex();
      this.layoutGraph();
      this.fit();
      this.bind();
      this.resizeObserver=new ResizeObserver(()=>{this.fit(false);this.requestRender()});
      this.resizeObserver.observe(canvas);
      this.requestRender();
    }

    destroy(){this.destroyed=true;try{this.resizeObserver?.disconnect()}catch{}}

    buildIndex(){
      for(const e of this.edges){
        const a=String(e.source),b=String(e.target);
        this.adj.get(a)?.push(b);this.adj.get(b)?.push(a);
        this.degree.set(a,(this.degree.get(a)||0)+1);
        this.degree.set(b,(this.degree.get(b)||0)+1);
      }
      this.degreeSorted=[...this.degree.values()].sort((a,b)=>a-b);
    }

    communities(){
      const ids=this.nodes.map(n=>String(n.id));
      const c=new Map(ids.map((id,i)=>[id,i]));
      if(ids.length<18)return c;
      for(let it=0;it<5;it++){
        let changed=0;
        for(const id of ids){
          const scores=new Map();
          for(const nb of this.adj.get(id)||[]){const x=c.get(nb);scores.set(x,(scores.get(x)||0)+1)}
          if(!scores.size)continue;
          let best=c.get(id),score=-1;
          for(const [k,v] of scores){if(v>score||(v===score&&k<best)){best=k;score=v}}
          if(best!==c.get(id)){c.set(id,best);changed++}
        }
        if(!changed)break;
      }
      const remap=new Map();let next=0;
      for(const id of ids){const x=c.get(id);if(!remap.has(x))remap.set(x,next++);c.set(id,remap.get(x))}
      return c;
    }

    layoutGraph(){
      const n=this.nodes.length;if(!n)return;
      const community=this.communities();
      const count=Math.max(1,new Set(community.values()).size);
      const centers=new Map();
      for(let i=0;i<count;i++){const a=i/count*Math.PI*2;centers.set(i,{x:Math.cos(a)*230,y:Math.sin(a)*160})}
      for(const node of this.nodes){
        const id=String(node.id),seed=hashString(id),center=centers.get(community.get(id)||0)||{x:0,y:0},a=seeded(seed)*Math.PI*2,r=24+70*seeded(seed^0x9e3779b9);
        this.layout.set(id,{x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r});
      }
      const ids=this.nodes.map(n=>String(n.id));
      const iterations=n<40?110:80;
      for(let step=0;step<iterations;step++){
        const delta=new Map(ids.map(id=>[id,{x:0,y:0}]));
        const cool=.9*(1-step/iterations)+.1;
        for(const e of this.edges){
          const a=String(e.source),b=String(e.target),pa=this.layout.get(a),pb=this.layout.get(b);if(!pa||!pb)continue;
          let dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.hypot(dx,dy)||1;
          const target=e.relation==='tag'?75:e.relation==='project'?88:105,f=(d-target)*.014;
          dx/=d;dy/=d;delta.get(a).x+=dx*f;delta.get(a).y+=dy*f;delta.get(b).x-=dx*f;delta.get(b).y-=dy*f;
        }
        for(let i=0;i<ids.length;i++){
          const id=ids[i],p=this.layout.get(id),d=delta.get(id);
          for(let j=i+1;j<ids.length;j++){
            const qid=ids[j],q=this.layout.get(qid);let dx=p.x-q.x,dy=p.y-q.y,ds=dx*dx+dy*dy+64,dist=Math.sqrt(ds),f=Math.min(2.2,620/ds);dx/=dist;dy/=dist;
            d.x+=dx*f;d.y+=dy*f;delta.get(qid).x-=dx*f;delta.get(qid).y-=dy*f;
          }
          const center=centers.get(community.get(id)||0)||{x:0,y:0};
          d.x+=(center.x-p.x)*.0025-p.x*.0007;d.y+=(center.y-p.y)*.0025-p.y*.0007;
        }
        for(const id of ids){const p=this.layout.get(id),d=delta.get(id),mag=Math.hypot(d.x,d.y),cap=7*cool,s=mag>cap?cap/mag:1;p.x+=d.x*s;p.y+=d.y*s}
      }
    }

    fit(resetPan=true){
      const rect=this.canvas.getBoundingClientRect();if(rect.width<20||rect.height<20||!this.layout.size)return;
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for(const p of this.layout.values()){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)}
      const spanX=Math.max(1,maxX-minX),spanY=Math.max(1,maxY-minY);
      this.camera.zoom=clamp(Math.min((rect.width-70)/spanX,(rect.height-60)/spanY),.5,1.45);
      if(resetPan){this.camera.panX=-(minX+maxX)/2*this.camera.zoom;this.camera.panY=-(minY+maxY)/2*this.camera.zoom}
    }

    threshold(q){if(!this.degreeSorted.length)return 0;return this.degreeSorted[Math.floor((this.degreeSorted.length-1)*q)]||0}
    requestRender(){if(this.renderPending||this.destroyed)return;this.renderPending=true;requestAnimationFrame(()=>{this.renderPending=false;this.paint()})}

    paint(){
      if(this.destroyed||!this.canvas.isConnected)return;
      const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);
      if(this.canvas.width!==W||this.canvas.height!==H){this.canvas.width=W;this.canvas.height=H}
      const ctx=this.ctx,w=rect.width,h=rect.height;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);this.screen.clear();
      for(const n of this.nodes){const p=this.layout.get(String(n.id));if(!p)continue;this.screen.set(String(n.id),{x:w/2+this.camera.panX+p.x*this.camera.zoom,y:h/2+this.camera.panY+p.y*this.camera.zoom})}
      const zoom=this.camera.zoom;
      let edges=this.edges;
      if(zoom<.75&&edges.length>120)edges=[...edges].sort((a,b)=>((this.degree.get(String(b.source))||0)+(this.degree.get(String(b.target))||0))-((this.degree.get(String(a.source))||0)+(this.degree.get(String(a.target))||0))).slice(0,Math.max(70,Math.round(edges.length*.35)));
      ctx.strokeStyle=css('--line-strong','#bcc8ca');ctx.lineWidth=1;
      for(const e of edges){const a=this.screen.get(String(e.source)),b=this.screen.get(String(e.target));if(!a||!b)continue;ctx.globalAlpha=zoom<.8?.09:.16;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      ctx.globalAlpha=1;
      const labels=[];
      for(const n of this.nodes){
        const id=String(n.id),p=this.screen.get(id);if(!p||p.x<-30||p.x>w+30||p.y<-30||p.y>h+30)continue;
        const deg=this.degree.get(id)||0,rad=n.virtual?5.5:4.5;
        ctx.beginPath();ctx.arc(p.x,p.y,rad,0,Math.PI*2);ctx.fillStyle=KIND_COLOR[n.kind]||css('--accent','#087f83');ctx.fill();
        const priority=n.kind==='project'?900+deg:n.kind==='tag'?500+deg:deg>=this.threshold(.78)?700+deg:zoom>=1.15?300+deg:0;
        if(priority>0)labels.push({n,p,rad,priority});
      }
      labels.sort((a,b)=>b.priority-a.priority);const placed=[];let shown=0,maxLabels=zoom<.75?12:zoom<1.15?22:36;
      for(const x of labels){if(shown>=maxLabels)break;const text=String(x.n.label||'').slice(0,18),font=`${x.n.kind==='project'?'700':'500'} 10px Microsoft YaHei, sans-serif`;ctx.font=font;const key=font+'|'+text;let width=this.labelWidths.get(key);if(width==null){width=ctx.measureText(text).width;this.labelWidths.set(key,width)}const left=x.p.x+x.rad+4,box={l:left-2,t:x.p.y-8,r:left+width+3,b:x.p.y+7};if(placed.some(r=>!(box.r<r.l||box.l>r.r||box.b<r.t||box.t>r.b)))continue;placed.push(box);ctx.globalAlpha=.78;ctx.fillStyle=css('--muted','#68777c');ctx.fillText(text,left,x.p.y+3);shown++}
      ctx.globalAlpha=1;
    }

    hit(x,y){let best=null,dist=18;for(const n of this.nodes){const p=this.screen.get(String(n.id));if(!p)continue;const d=Math.hypot(x-p.x,y-p.y);if(d<dist){dist=d;best=String(n.id)}}return best}
    bind(){
      const c=this.canvas;c.style.cursor='grab';
      c.onpointerdown=e=>{this.pressId=this.hit(e.offsetX,e.offsetY);this.dragMoved=false;this.drag={x:e.offsetX,y:e.offsetY};c.setPointerCapture?.(e.pointerId)};
      c.onpointermove=e=>{if(!this.drag)return;const dx=e.offsetX-this.drag.x,dy=e.offsetY-this.drag.y;if(Math.hypot(dx,dy)>1)this.dragMoved=true;this.camera.panX+=dx;this.camera.panY+=dy;this.drag.x=e.offsetX;this.drag.y=e.offsetY;c.style.cursor='grabbing';this.requestRender()};
      c.onpointerup=e=>{const id=this.hit(e.offsetX,e.offsetY),moved=this.dragMoved;try{c.releasePointerCapture?.(e.pointerId)}catch{}this.drag=null;c.style.cursor='grab';if(!moved&&id&&id===this.pressId)this.openFullGraph(id);this.pressId=null};
      c.onpointercancel=e=>{this.drag=null;this.pressId=null;c.style.cursor='grab';try{c.releasePointerCapture?.(e.pointerId)}catch{}};
      c.onwheel=e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const old=this.camera.zoom,next=clamp(old*Math.exp(-e.deltaY*.0015),.4,3);const r=c.getBoundingClientRect(),cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2,lx=(cx-this.camera.panX)/old,ly=(cy-this.camera.panY)/old;this.camera.zoom=next;this.camera.panX=cx-lx*next;this.camera.panY=cy-ly*next;this.requestRender()};
    }

    openFullGraph(id){
      sessionStorage.setItem('erw:pending-graph-focus',id);
      location.hash='graph';
      focusWhenReady();
    }
  }

  let instance=null,loading=false;
  async function enhance(){
    if(loading||route()!==ROUTE)return;
    const old=document.querySelector('#overview-graph');
    if(!old||old.dataset.modernOverviewGraph==='1')return;
    loading=true;
    try{
      const res=await fetch(`/api/graph/overview?limit=${MAX_NODES}`);if(!res.ok)throw new Error(`HTTP ${res.status}`);const graph=await res.json();
      if(route()!==ROUTE||!old.isConnected)return;
      instance?.destroy();
      const canvas=old.cloneNode(false);canvas.dataset.modernOverviewGraph='1';canvas.setAttribute('aria-label','新版知识关系预览');old.replaceWith(canvas);
      instance=new OverviewGraph(canvas,graph);
      window.__overviewKnowledgeGraph=instance;
    }catch(err){console.warn('[overview-graph]',err)}finally{loading=false}
  }

  function focusWhenReady(){
    if(route()!=='graph')return;
    const id=sessionStorage.getItem('erw:pending-graph-focus');if(!id)return;
    let tries=0;const timer=setInterval(()=>{
      tries++;
      const engine=window.__knowledgeGraphEngine;
      if(engine?.nodeMap?.has?.(id)){clearInterval(timer);sessionStorage.removeItem('erw:pending-graph-focus');engine.selectNode(id,true)}
      else if(tries>50){clearInterval(timer)}
    },60);
  }

  function schedule(){
    if(route()!==ROUTE){instance?.destroy();instance=null;focusWhenReady();return}
    requestAnimationFrame(enhance);
  }

  const observer=new MutationObserver(schedule);
  window.addEventListener('DOMContentLoaded',()=>{observer.observe(document.querySelector('#main')||document.body,{childList:true,subtree:true});schedule()});
  window.addEventListener('hashchange',()=>setTimeout(schedule,0));
})();
