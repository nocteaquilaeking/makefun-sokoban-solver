// Deterministic push-level A* with independent rooms and exact goal matching.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const letters='udlr', INF=1000000;
function parse(text) {
  const rows=text.replace(/\r/g,'').trimEnd().split('\n'),w=Math.max(...rows.map(r=>r.length));
  const floor=[],boxes=[],goals=[]; let player=-1;
  rows.forEach((row,y)=>{for(let x=0;x<row.length;x++) {
    const c=row[x],p=y*w+x;
    if(!' .$*@+'.includes(c)) continue;
    floor.push(p); if('$*'.includes(c)) boxes.push(p);
    if('.*+'.includes(c)) goals.push(p); if('@+'.includes(c)) player=p;
  }});
  return {w,floor,boxes,goals,player};
}
function board(l,cells,boxes,goals) {
  cells=cells.slice().sort((a,b)=>a-b);
  const index=new Map(cells.map((p,i)=>[p,i])),delta=[-l.w,l.w,-1,1];
  const adj=cells.map(p=>delta.map(d=>index.get(p+d)??-1));
  const squares=cells.map(p=>[0,1].flatMap(v=>[2,3].map(h=>
    [p,p+delta[v],p+delta[h],p+delta[v]+delta[h]].map(x=>index.get(x)??-1))));
  const gs=goals.map(p=>index.get(p)), target=new Uint8Array(cells.length);
  for(const g of gs) target[g]=1;
  return {cells,adj,squares,gs,target,boxes:boxes.map(p=>index.get(p)).sort((a,b)=>a-b),player:index.get(l.player)};
}
// Hungarian assignment for the larger whole-level fallback.
function matching(cost) {
  const n=cost.length,u=new Float64Array(n+1),v=new Float64Array(n+1),p=new Int32Array(n+1),way=new Int32Array(n+1);
  for(let i=1;i<=n;i++) {
    p[0]=i; const min=new Float64Array(n+1).fill(INF),used=new Uint8Array(n+1); let j=0;
    do {
      used[j]=1; const row=p[j]; let step=INF,next=0;
      for(let k=1;k<=n;k++) if(!used[k]) {
        const c=cost[row-1][k-1]-u[row]-v[k];
        if(c<min[k]) {min[k]=c;way[k]=j;}
        if(min[k]<step) {step=min[k];next=k;}
      }
      if(step>=INF) return INF;
      for(let k=0;k<=n;k++) if(used[k]) {u[p[k]]+=step;v[k]-=step;} else min[k]-=step;
      j=next;
    }while(p[j]);
    do {const prev=way[j];p[j]=p[prev];j=prev;}while(j);
  }
  return -v[0];
}
function search(b,budget,weight=1,nodeLimit=350000) {
  const {cells,adj,squares,gs,target}=b,n=cells.length,count=gs.length;
  const priority=(g,h)=>weight===0?h:g+weight*h;
  const dist=gs.map(g=>{
    const ds=new Int32Array(n).fill(INF),q=[g];ds[g]=0;
    for(let i=0;i<q.length;i++) for(let d=0;d<4;d++) {
      const prev=adj[q[i]][d^1];
      if(prev>=0&&adj[prev][d^1]>=0&&ds[prev]===INF) {ds[prev]=ds[q[i]]+1;q.push(prev);}
    }
    return ds;
  });
  const live=cells.map((_,p)=>dist.some(ds=>ds[p]<INF));
  const compact=Number.isSafeInteger(n**(count+1));
  const boxKey=bs=>compact?bs.reduce((k,p)=>k*n+p,0):String.fromCharCode(...bs);
  const stateKey=(k,p)=>compact?k*n+p:k+String.fromCharCode(p);
  const cache=new Map();
  function estimate(bs,k) {
    if(cache.has(k)) return cache.get(k);
    let h;
    if(count<=4) {
      const dp=new Int32Array(1<<count).fill(INF);dp[0]=0;
      for(let mask=0;mask<dp.length;mask++) {
        let used=0;for(let m=mask;m;m&=m-1) used++;
        if(used===count||dp[mask]>=INF) continue;
        for(let g=0;g<count;g++) if(!(mask&(1<<g))) {
          const next=mask|(1<<g),v=dp[mask]+dist[g][bs[used]];
          if(v<dp[next]) dp[next]=v;
        }
      }
      h=dp[dp.length-1];
    }else h=matching(bs.map(p=>dist.map(ds=>ds[p])));
    if(cache.size<180000) cache.set(k,h);return h;
  }
  const occupied=new Uint8Array(n),seen=new Int32Array(n),q=new Int32Array(n);let stamp=0;
  function reach(p) {
    stamp++;let head=0,tail=1,min=p;q[0]=p;seen[p]=stamp;
    while(head<tail) {
      const x=q[head++];if(x<min) min=x;
      for(const y of adj[x]) if(y>=0&&!occupied[y]&&seen[y]!==stamp) {seen[y]=stamp;q[tail++]=y;}
    }
    return min;
  }
  function frozen(p) {
    for(const square of squares[p]) {
      if(square.every(x=>x<0||occupied[x])&&square.some(x=>x>=0&&occupied[x]&&!target[x])) return true;
    }
    return false;
  }
  const nodes=[],heap=[],best=new Map();
  function less(a,b) {const x=nodes[a],y=nodes[b];return x.f<y.f||(x.f===y.f&&(x.h<y.h||(x.h===y.h&&a<b)));}
  function add(s) {
    const id=nodes.length;nodes.push(s);best.set(s.key,id);
    let i=heap.length;heap.push(id);
    while(i) {const p=(i-1)>>1;if(!less(id,heap[p])) break;heap[i]=heap[p];i=p;}heap[i]=id;
  }
  function pop() {
    const first=heap[0],last=heap.pop();
    if(heap.length) {
      let i=0;
      while(i*2+1<heap.length) {
        let c=i*2+1;if(c+1<heap.length&&less(heap[c+1],heap[c])) c++;
        if(!less(heap[c],last)) break;heap[i]=heap[c];i=c;
      }
      heap[i]=last;
    }
    return first;
  }
  for(const p of b.boxes) occupied[p]=1;
  const start=reach(b.player),bk=boxKey(b.boxes),h=estimate(b.boxes,bk);
  if(h>=INF) return {path:null,exhausted:false};
  add({bs:b.boxes,p:start,key:stateKey(bk,start),g:0,h,f:priority(0,h),parent:-1,src:-1,d:-1});
  let expanded=0;
  while(heap.length&&expanded<budget&&nodes.length<nodeLimit) {
    const id=pop(),s=nodes[id];if(best.get(s.key)!==id) continue;
    if(s.h===0) {
      const path=[];for(let t=id;nodes[t].parent>=0;t=nodes[t].parent) path.push([cells[nodes[t].src],nodes[t].d]);
      return {path:path.reverse(),exhausted:false};
    }
    expanded++;occupied.fill(0);for(const p of s.bs) occupied[p]=1;reach(s.p);
    const accessible=seen.map(v=>v===stamp?1:0);
    for(let i=0;i<s.bs.length;i++) for(let d=0;d<4;d++) {
      const src=s.bs[i],dst=adj[src][d],stand=adj[src][d^1];
      if(dst<0||stand<0||occupied[dst]||!accessible[stand]||!live[dst]) continue;
      occupied[src]=0;occupied[dst]=1;
      if(!frozen(dst)) {
        const bs=s.bs.slice();bs[i]=dst;bs.sort((a,b)=>a-b);
        const k=boxKey(bs),h=estimate(bs,k);
        if(h<INF) {
          const p=reach(src),key=stateKey(k,p),prev=best.get(key),g=s.g+1;
          if(prev===undefined||nodes[prev].g>g) add({bs,p,key,g,h,f:priority(g,h),parent:id,src,d});
        }
      }
      occupied[dst]=0;occupied[src]=1;
    }
  }
  return {path:null,exhausted:heap.length>0};
}
function roomsOf(l) {
  // The initial player is in the guaranteed horizontal hallway. Cutting its
  // row yields precisely the separate rooms, including their door squares.
  const row=Math.floor(l.player/l.w),allowed=new Set(l.floor.filter(p=>Math.floor(p/l.w)!==row));
  const rooms=[],delta=[-l.w,l.w,-1,1];
  while(allowed.size) {
    const first=allowed.values().next().value,cells=[first];allowed.delete(first);
    for(let i=0;i<cells.length;i++) for(const d of delta) if(allowed.delete(cells[i]+d)) cells.push(cells[i]+d);
    const set=new Set(cells),boxes=l.boxes.filter(p=>set.has(p)),goals=l.goals.filter(p=>set.has(p));
    if(!boxes.length&&!goals.length) continue;
    if(boxes.length!==goals.length||boxes.length>4||cells.length>37) return null;
    rooms.push({cells,boxes,goals});
  }
  return rooms.length&&rooms.reduce((s,r)=>s+r.boxes.length,0)===l.boxes.length?rooms:null;
}
function replay(l,pushes) {
  if(pushes===null) return '';
  const floor=new Set(l.floor),boxes=new Set(l.boxes),delta=[-l.w,l.w,-1,1];
  let player=l.player,moves='';
  for(const [src,d] of pushes) {
    const stand=src-delta[d],dst=src+delta[d],parent=new Map([[player,null]]),q=[player];
    if(!boxes.has(src)||boxes.has(dst)||!floor.has(dst)) return '';
    for(let i=0;i<q.length&&!parent.has(stand);i++) for(let j=0;j<4;j++) {
      const p=q[i]+delta[j];
      if(floor.has(p)&&!boxes.has(p)&&!parent.has(p)) {parent.set(p,[q[i],j]);q.push(p);}
    }
    if(!parent.has(stand)) return '';
    const walk=[];for(let p=stand;p!==player;) {const [prev,j]=parent.get(p);walk.push(letters[j]);p=prev;}
    moves+=walk.reverse().join('')+letters[d].toUpperCase();boxes.delete(src);boxes.add(dst);player=src;
  }
  const goals=new Set(l.goals);return [...boxes].every(p=>goals.has(p))&&moves.length<65536?moves:'';
}
function solve(l) {
  const rooms=roomsOf(l);
  if(rooms) {
    const hall=l.floor.filter(p=>Math.floor(p/l.w)===Math.floor(l.player/l.w));
    const pushes=[];let success=true;
    for(const room of rooms) {
      const b=board(l,[...room.cells,...hall],room.boxes,room.goals);
      // Retry budget exhaustion once with four times both node allowances.
      // A zero weight selects greedy best-first for the emergency fallback.
      let result=search(b,160000);
      if(result.path===null&&result.exhausted) result=search(b,640000,1,1400000);
      const path=result.path??search(b,60000,0).path;
      if(path===null) {success=false;break;}pushes.push(...path);
    }
    if(success) {const moves=replay(l,pushes);if(moves||!l.boxes.length) return moves;}
  }
  return replay(l,search(board(l,l.floor,l.boxes,l.goals),40000).path);
}
const input=process.argv[2]??'/input',output=process.argv[3]??'/output';
for(let i=1;i<=5;i++) {
  const id='i'+String(i).padStart(3,'0'),moves=solve(parse(readFileSync(join(input,id,'level.txt'),'utf8')));
  mkdirSync(join(output,id),{recursive:true});writeFileSync(join(output,id,'solution.txt'),moves+'\n');
}
