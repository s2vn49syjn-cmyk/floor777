// Geometry and project data are independent of the screen and network.
export const VERSION=2;
export const uid=()=>globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const copy=x=>JSON.parse(JSON.stringify(x));
export function newProject(){return {version:VERSION,key:uid(),id:'',name:'新しい店舗',prefecture:'大阪府',city:'',minrepo_url:'',layout_date:new Date().toLocaleDateString('sv-SE'),width:1400,height:1000,image:null,islands:[],updated_at:new Date().toISOString()};}
export function makeIsland(o={}){return {key:uid(),name:'島',shape:'line',x:200,y:200,count:12,size:24,pitch:36,angle:0,radius:150,sweep:120,confirmed:false,numbers:[],machine:'',...o};}
// Use one seat size per map. Keep each detected seat centered on its original position.
export function unifyGeneratedSeatSize(islands,width,height,requestedSize){
 const generated=islands.filter(i=>i.shape==='custom'&&i.estimatedCount&&!i.confirmed&&!i.numbers.length&&i.points?.length);
 if(!generated.length)return 0;
 const gaps=generated.flatMap(i=>i.points.slice(1).map((p,k)=>{
  const a=i.points[k];return Math.hypot(p[0]+p[2]/2-a[0]-a[2]/2,p[1]+p[3]/2-a[1]-a[3]/2);
 })).filter(n=>Number.isFinite(n)&&n>1).sort((a,b)=>a-b);
 const sizes=generated.map(i=>i.size).sort((a,b)=>a-b);
 const automatic=gaps.length?gaps[Math.floor((gaps.length-1)*.5)]:sizes[Math.floor((sizes.length-1)*.5)];
 const target=Math.max(4,Math.min(300,requestedSize??automatic));
 for(const i of generated){
  i.points=i.points.map(([x,y,w,h])=>{
   const cx=x+w/2,cy=y+h/2;
   return [Math.max(0,Math.min(width-target,cx-target/2)),Math.max(0,Math.min(height-target,cy-target/2)),target,target];
  });
  i.x=i.points[0][0];i.y=i.points[0][1];i.size=target;i.pitch=target*1.32;
 }
 return target;
}
// Normalize every island, including numbered hand-drawn and geometric islands.
// Keep seat centers and number order; shift an entire island only if the new
// rectangles would otherwise extend beyond the canvas.
export function unifyAllSeatSizes(islands,width,height,requestedSize){
 if(!islands.length)return 0;
 const sizes=islands.map(i=>i.size).filter(Number.isFinite).sort((a,b)=>a-b);
 const target=requestedSize??sizes[Math.floor(sizes.length/2)];
 if(!Number.isFinite(target)||target<4||target>300)throw Error('台サイズは4〜300で指定してください');
 for(const island of islands){
  const oldSize=island.size;
  if(island.shape==='custom')island.points=island.points.map(([x,y,w,h])=>[x+w/2-target/2,y+h/2-target/2,target,target]);
  else if(island.shape==='line'){island.x+=(oldSize-target)/2;island.y+=(oldSize-target)/2;}
  island.size=target;
  if(island.shape==='custom'){island.x=island.points[0][0];island.y=island.points[0][1];}
  const placed=points(island),left=Math.min(...placed.map(p=>p[0])),top=Math.min(...placed.map(p=>p[1])),right=Math.max(...placed.map(p=>p[0]+p[2])),bottom=Math.max(...placed.map(p=>p[1]+p[3]));
  if(right-left>width||bottom-top>height)throw Error(`${island.name}はこの台サイズでは画像内に収まりません`);
  const dx=left<0?-left:right>width?width-right:0,dy=top<0?-top:bottom>height?height-bottom:0;
  if(dx||dy)moveIsland(island,dx,dy);
 }
 return target;
}
export function countSeatOverlaps(project){
 const seats=project.islands.flatMap(i=>points(i));let count=0;
 for(let a=0;a<seats.length;a++)for(let b=a+1;b<seats.length;b++){
  const p=seats[a],q=seats[b];
  if(p[0]<q[0]+q[2]-.1&&p[0]+p[2]>q[0]+.1&&p[1]<q[1]+q[3]-.1&&p[1]+p[3]>q[1]+.1)count++;
 }
 return count;
}
// Relax colliding seats while retaining size, seat order and number mapping.
// The caller should apply this to a copy so Undo can restore the exact draft.
export function repairSeatOverlaps(project,maxIterations=180){
 const seats=project.islands.flatMap((island,group)=>points(island).map((p,index)=>({group,index,w:p[2],h:p[3],x:p[0]+p[2]/2,y:p[1]+p[3]/2,oldX:p[0]+p[2]/2,oldY:p[1]+p[3]/2})));
 const overlaps=()=>{let count=0;for(let a=0;a<seats.length;a++)for(let b=a+1;b<seats.length;b++){const p=seats[a],q=seats[b],ox=(p.w+q.w)/2-Math.abs(p.x-q.x),oy=(p.h+q.h)/2-Math.abs(p.y-q.y);if(ox>.1&&oy>.1)count++;}return count;};
 const before=overlaps();if(!before)return {before,after:0,movedSeats:0,maxMove:0,iterations:0};
 let iterations=0;
 for(;iterations<maxIterations;iterations++){
  const shifts=seats.map(()=>[0,0]);let collisions=0;
  for(let a=0;a<seats.length;a++)for(let b=a+1;b<seats.length;b++){
   const p=seats[a],q=seats[b],dx=q.x-p.x,dy=q.y-p.y,ox=(p.w+q.w)/2-Math.abs(dx),oy=(p.h+q.h)/2-Math.abs(dy);
   if(ox<=.1||oy<=.1)continue;collisions++;
   let ux=0,uy=0,distance;
   if(p.group===q.group&&q.index===p.index+1){
    const span=Math.hypot(dx,dy),tx=span>.01?dx/span:1,ty=span>.01?dy/span:0;
    const neededX=Math.abs(tx)>.05?ox/Math.abs(tx):Infinity,neededY=Math.abs(ty)>.05?oy/Math.abs(ty):Infinity;
    distance=Math.min(neededX,neededY)+.3;ux=tx;uy=ty;
   }else if(ox<=oy){distance=ox+.3;ux=dx>=0?1:-1;}
   else{distance=oy+.3;uy=dy>=0?1:-1;}
   const push=Math.min(8,distance*.45);
   shifts[a][0]-=ux*push;shifts[a][1]-=uy*push;
   shifts[b][0]+=ux*push;shifts[b][1]+=uy*push;
  }
  if(!collisions)break;
  for(let index=0;index<seats.length;index++){
   const seat=seats[index],shift=shifts[index];
   seat.x=Math.max(seat.w/2,Math.min(project.width-seat.w/2,seat.x+Math.max(-8,Math.min(8,shift[0]))));
   seat.y=Math.max(seat.h/2,Math.min(project.height-seat.h/2,seat.y+Math.max(-8,Math.min(8,shift[1]))));
  }
 }
 const after=overlaps();let movedSeats=0,maxMove=0,offset=0;
 for(const island of project.islands){
  const group=seats.slice(offset,offset+island.count);offset+=island.count;
  const moved=group.some(s=>Math.hypot(s.x-s.oldX,s.y-s.oldY)>.01);
  if(!moved)continue;
  island.shape='custom';island.points=group.map(s=>[s.x-s.w/2,s.y-s.h/2,s.w,s.h]);
  island.x=island.points[0][0];island.y=island.points[0][1];island.confirmed=false;island.source='overlap-repair';
  for(const s of group){const distance=Math.hypot(s.x-s.oldX,s.y-s.oldY);if(distance>.01)movedSeats++;maxMove=Math.max(maxMove,distance);}
 }
 return {before,after,movedSeats,maxMove,iterations};
}
export function points(island){
 if(island.shape==='custom')return island.points.map(p=>[...p]);
 const {x,y,count,size,pitch,angle,radius,sweep,shape}=island;
 return Array.from({length:count},(_,i)=>{
  const a=(angle+(shape==='circle'?360*i/count:shape==='arc'?sweep*i/Math.max(1,count-1):0))*Math.PI/180;
  return shape==='line'?[x+Math.cos(a)*pitch*i,y+Math.sin(a)*pitch*i,size,size]:[x+radius*Math.cos(a)-size/2,y+radius*Math.sin(a)-size/2,size,size];
 });
}
export function moveIsland(island,dx,dy){island.x+=dx;island.y+=dy;if(island.shape==='custom')island.points=island.points.map(p=>[p[0]+dx,p[1]+dy,p[2],p[3]]);}
// Best-fit straight line through the centers of a hand-placed island.
export function straightenIsland(island){
 if(island.shape!=='custom'||!Array.isArray(island.points)||!island.points.length)throw Error('個別配置の島を選んでください');
 const centers=island.points.map(([x,y,w,h])=>[x+w/2,y+h/2]);
 const mx=centers.reduce((sum,p)=>sum+p[0],0)/centers.length,my=centers.reduce((sum,p)=>sum+p[1],0)/centers.length;
 const xx=centers.reduce((sum,p)=>sum+(p[0]-mx)**2,0),yy=centers.reduce((sum,p)=>sum+(p[1]-my)**2,0),xy=centers.reduce((sum,p)=>sum+(p[0]-mx)*(p[1]-my),0);
 let angle=centers.length>1?.5*Math.atan2(2*xy,xx-yy):0;
 let ux=Math.cos(angle),uy=Math.sin(angle);
 const travel=(centers.at(-1)[0]-centers[0][0])*ux+(centers.at(-1)[1]-centers[0][1])*uy;
 if(travel<0){angle+=Math.PI;ux=-ux;uy=-uy;}
 const projections=centers.map(([x,y])=>(x-mx)*ux+(y-my)*uy),lo=Math.min(...projections),hi=Math.max(...projections);
 const size=island.size,pitch=centers.length>1?Math.max(4,(hi-lo)/(centers.length-1)):Math.max(4,island.pitch);
 const midpoint=centers.length>1?(lo+hi)/2:0,start=midpoint-pitch*(centers.length-1)/2;
 return {...island,shape:'line',x:mx+ux*start-size/2,y:my+uy*start-size/2,angle:(angle*180/Math.PI+360)%360,pitch,confirmed:false,source:'straightened',points:undefined};
}
// Straighten only a consecutive run of hand-placed seats. Keep the two ends
// fixed so the untouched parts of the island stay connected in the same order.
export function straightenSeatRange(island,startIndex,endIndex){
 if(island.shape!=='custom'||!Array.isArray(island.points))throw Error('個別配置の島を選んでください');
 if(!Number.isInteger(startIndex)||!Number.isInteger(endIndex)||startIndex<0||endIndex>=island.points.length||endIndex-startIndex<2)throw Error('連続する3台以上を選んでください');
 const first=island.points[startIndex],last=island.points[endIndex];
 const begin=[first[0]+first[2]/2,first[1]+first[3]/2],finish=[last[0]+last[2]/2,last[1]+last[3]/2];
 const result={...island,points:island.points.map(p=>[...p]),confirmed:false,source:'partially-straightened'};
 for(let index=startIndex+1;index<endIndex;index++){
  const original=result.points[index],ratio=(index-startIndex)/(endIndex-startIndex);
  result.points[index]=[begin[0]+(finish[0]-begin[0])*ratio-original[2]/2,begin[1]+(finish[1]-begin[1])*ratio-original[3]/2,original[2],original[3]];
 }
 return result;
}
// Rotate a consecutive part of a custom island around its own center.
// Seat order and numbers stay on their original indices.
export function rotateSeatRange(island,startIndex,endIndex,degrees){
 if(island.shape!=='custom'||!Array.isArray(island.points))throw Error('個別配置の島を選んでください');
 if(!Number.isInteger(startIndex)||!Number.isInteger(endIndex)||startIndex<0||endIndex>=island.points.length||endIndex-startIndex<1)throw Error('連続する2台以上を選んでください');
 if(!Number.isFinite(degrees)||Math.abs(degrees)>360)throw Error('角度は-360〜360度で指定してください');
 const selected=island.points.slice(startIndex,endIndex+1),cx=selected.reduce((sum,p)=>sum+p[0]+p[2]/2,0)/selected.length,cy=selected.reduce((sum,p)=>sum+p[1]+p[3]/2,0)/selected.length;
 const angle=degrees*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
 const result={...island,points:island.points.map(p=>[...p]),confirmed:false,source:'partially-rotated'};
 for(let index=startIndex;index<=endIndex;index++){
  const original=result.points[index],dx=original[0]+original[2]/2-cx,dy=original[1]+original[3]/2-cy;
  result.points[index]=[cx+dx*cos-dy*sin-original[2]/2,cy+dx*sin+dy*cos-original[3]/2,original[2],original[3]];
 }
 return result;
}
export function rotateProjectLayout(project,clockwise=true){
 const w=project.width,h=project.height,turn=clockwise?90:-90;
 const rect=([x,y,a,b])=>clockwise?[h-y-b,x,b,a]:[y,w-x-a,b,a];
 for(const i of project.islands){
  if(i.shape==='custom'){
   i.points=i.points.map(rect);[i.x,i.y]=i.points[0];
  }else if(i.shape==='line'){
   [i.x,i.y]=rect([i.x,i.y,i.size,i.size]);i.angle=(i.angle+turn+360)%360;
  }else{
   [i.x,i.y]=clockwise?[h-i.y,i.x]:[i.y,w-i.x];i.angle=(i.angle+turn+360)%360;
  }
 }
 if(project.detectionRegion){const r=project.detectionRegion;const [x,y,width,height]=rect([r.x,r.y,r.width,r.height]);project.detectionRegion={x,y,width,height};}
 project.width=h;project.height=w;
}
export function resizeIsland(island,count){
 if(!Number.isInteger(count)||count<1||count>1000)throw Error('台数は1〜1000で入力してください');
 if(count===island.count)return;
 if(island.shape==='line'&&island.count>1&&count>1)island.pitch*=((island.count-1)/(count-1));
 if(island.shape==='custom'){
  const ps=points(island);if(island.closed&&ps.length>1)ps.push([...ps[0]]);const lengths=[0];for(let k=1;k<ps.length;k++)lengths.push(lengths[k-1]+Math.hypot(ps[k][0]-ps[k-1][0],ps[k][1]-ps[k-1][1]));
  const total=lengths.at(-1);
  island.points=Array.from({length:count},(_,k)=>{if(!total)return [ps[0][0]+k*island.pitch,ps[0][1],ps[0][2],ps[0][3]];const d=total*k/Math.max(1,island.closed?count:count-1);let j=1;while(j<ps.length-1&&lengths[j]<d)j++;const f=(d-lengths[j-1])/(lengths[j]-lengths[j-1]||1),a=ps[j-1],b=ps[j];return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2],a[3]];});
 }
 island.count=count;island.numbers=[];island.confirmed=false;
}
export function parseList(value){
 const out=[];
 for(const part of String(value).normalize('NFKC').split(/[\s,、]+/).filter(Boolean)){
  const m=part.match(/^(\d+)(?:[-〜~](\d+))?$/);if(!m)throw Error('番号は 101-110 または 101,102,105 の形式です');
  const a=Number(m[1]),b=Number(m[2]||m[1]);if(a<1||b>99999||b<1||a>99999||Math.abs(a-b)>3000)throw Error('番号は1〜99999、1回3000台までです');
  for(let n=a;;n+=a<=b?1:-1){out.push(n);if(n===b)break;if(out.length>3000)throw Error('番号が多すぎます');}
 }
 if(out.length>3000)throw Error('1店舗3000台までです');return out;
}
export function assign(project,key,{start,count,reverse=false,skip='',explicit=''}){
 const island=project.islands.find(i=>i.key===key);if(!island)throw Error('島を選んでください');
 if(count!==island.count)throw Error(`島は${island.count}台です。台数を変更する場合は作成モードで形状を修正してください`);
 let numbers;
 if(explicit.trim()){numbers=parseList(explicit);if(numbers.length!==count)throw Error(`番号を${count}個指定してください（現在${numbers.length}個）`);}
 else {if(!Number.isInteger(start)||start<1)throw Error('開始番号を入力してください');const omitted=new Set(parseList(skip));numbers=[];for(let n=start;n<=99999&&numbers.length<count;n++)if(!omitted.has(n))numbers.push(n);if(numbers.length!==count)throw Error('番号が99999を超えます');}
 if(reverse)numbers.reverse();
 const other=new Set(project.islands.filter(i=>i.key!==key).flatMap(i=>i.numbers).filter(n=>n!==null));
 if(new Set(numbers).size!==numbers.length||numbers.some(n=>other.has(n)))throw Error('台番号が他の島または入力内で重複しています');
 island.numbers=numbers;return numbers;
}
export function validate(project){
 const errors=[],warnings=[],all=[],seen=new Set();let missing=0,unchecked=0;
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id))errors.push('店舗IDを半角英数字・ハイフンで入力してください');
 for(const [k,label]of [['name','店舗名'],['prefecture','都道府県'],['city','市区町村']])if(!project[k]?.trim())errors.push(`${label}が未入力です`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(project.layout_date)||!Number.isFinite(Date.parse(project.layout_date))||new Date(project.layout_date).toISOString().slice(0,10)!==project.layout_date)errors.push('配置確認日が不正です');
 if(project.minrepo_url){try{const u=new URL(project.minrepo_url);if(u.protocol!=='https:'||u.hostname!=='min-repo.com'||!u.pathname.startsWith('/tag/')||u.username||u.password)throw Error();}catch{errors.push('みんレポURLは https://min-repo.com/tag/…/ を指定してください');}}else warnings.push('みんレポURL未設定：収集設定は出力されません');
 if(!project.islands.length)errors.push('島を追加してください');
 for(const island of project.islands){if(!island.confirmed)unchecked++;const ps=points(island);ps.forEach((p,k)=>{
  const n=island.numbers[k];if(!Number.isInteger(n)||n<1||n>99999)missing++;else {if(seen.has(n))errors.push(`${n}番台が重複しています`);seen.add(n);}
  if(!p.every(Number.isFinite)||p[0]<0||p[1]<0||p[2]<=0||p[3]<=0||p[0]+p[2]>project.width||p[1]+p[3]>project.height)errors.push(`${island.name}の${k+1}台目がキャンバス範囲外です`);
  all.push({p,label:n||`${island.name} #${k+1}`});
 });}
 if(missing)errors.push(`台番号未入力：${missing}台`);if(unchecked)errors.push(`配置・台数の確認待ち：${unchecked}島`);
 if(all.length>3000)errors.push('1店舗3000台までです');
 let overlaps=0;
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i].p,b=all[j].p;if(a[0]<b[0]+b[2]-.1&&a[0]+a[2]>b[0]+.1&&a[1]<b[1]+b[3]-.1&&a[1]+a[3]>b[1]+.1){if(overlaps++<5)errors.push(`台が重なっています：${all[i].label} / ${all[j].label}`);}}
 if(overlaps>5)errors.push(`ほか${overlaps-5}件の重なり`);
 if(project.seatCatalog?.length){const assigned=new Set(project.islands.flatMap(i=>i.numbers)),missingCatalog=project.seatCatalog.filter(r=>!assigned.has(r.number));if(missingCatalog.length)errors.push(`台番号一覧のうち${missingCatalog.length}台が未配置です：${missingCatalog.slice(0,20).map(r=>r.number).join(', ')}${missingCatalog.length>20?' …':''}`);}
 if(project.islands.some(i=>!i.machine))warnings.push('機種名未設定の台があります。公開前に収集データと照合してください');
 return {errors:[...new Set(errors)],warnings,missing,unchecked,total:all.length};
}
export function importProject(d){
 if(!d||typeof d!=='object'||d.version!==VERSION||!Array.isArray(d.islands)||d.islands.length>1000)throw Error('FLOOR777ビルダーのプロジェクトJSONではありません');
 const p=newProject();for(const k of ['id','name','prefecture','city','minrepo_url','layout_date']){if(typeof d[k]!=='string'||d[k].length>2000)throw Error('店舗情報が不正です');p[k]=d[k];}
 if(d.seatCatalog!==undefined){const seen=new Set();if(!Array.isArray(d.seatCatalog)||d.seatCatalog.length>3000)throw Error('台番号一覧が不正です');p.seatCatalog=d.seatCatalog.map(r=>{if(!r||!Number.isInteger(r.number)||r.number<1||r.number>99999||seen.has(r.number)||typeof r.machine!=='string'||r.machine.length>200)throw Error('台番号一覧に不正・重複した番号があります');seen.add(r.number);return {number:r.number,machine:r.machine};});}
 for(const k of ['width','height']){if(!Number.isFinite(d[k])||d[k]<100||d[k]>20000)throw Error('キャンバスサイズが不正です');p[k]=d[k];}
 if(d.detectionRegion){const r=d.detectionRegion;if(!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>p.width||r.y+r.height>p.height)throw Error('生成範囲が不正です');p.detectionRegion={x:r.x,y:r.y,width:r.width,height:r.height};}
 if(d.image!==null&&d.image!==undefined){if(typeof d.image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d.image)||d.image.length>16000000)throw Error('画像形式が不正です');p.image=d.image;}
 let total=0;const keys=new Set();
 p.islands=d.islands.map(src=>{
  if(!['line','arc','circle','custom'].includes(src.shape)||!Number.isInteger(src.count)||src.count<1||src.count>1000||(total+=src.count)>3000)throw Error('島の形・台数が不正です');
  for(const k of ['x','y','size','pitch','angle','radius','sweep'])if(!Number.isFinite(src[k])||Math.abs(src[k])>40000)throw Error('島の座標が不正です');
  if(src.size<4||src.size>300||src.pitch<4||src.radius<1||Math.abs(src.sweep)>360)throw Error('台サイズ・間隔・曲率が不正です');
  const i=makeIsland({...src,key:typeof src.key==='string'?src.key:uid(),name:String(src.name||'島').slice(0,100),machine:String(src.machine||'').slice(0,200),confirmed:src.confirmed===true});
  if(keys.has(i.key))throw Error('島IDが重複しています');keys.add(i.key);
  if(!Array.isArray(src.numbers)||src.numbers.length>src.count||src.numbers.some(n=>n!==null&&(!Number.isInteger(n)||n<1||n>99999)))throw Error('台番号が不正です');i.numbers=[...src.numbers];
  if(i.shape==='custom'){if(!Array.isArray(src.points)||src.points.length!==i.count||src.points.some(p=>!Array.isArray(p)||p.length!==4||!p.every(Number.isFinite)||p.some(v=>Math.abs(v)>40000)||p[2]<4||p[3]<4))throw Error('個別座標が不正です');i.points=src.points.map(p=>[...p]);}else delete i.points;
  return i;
 });return p;
}
export function fromLegacy(d){
 const p=newProject();for(const k of ['id','name','prefecture','city','minrepo_url','layout_date'])if(typeof d[k]==='string')p[k]=d[k];
 if(!Array.isArray(d.rows))throw Error('旧形式のrowsがありません');
 p.islands=d.rows.map((r,j)=>makeIsland({name:`島 ${j+1}`,x:r.x,y:r.y,size:44,pitch:48,count:r.numbers.length,numbers:r.numbers,machine:r.machine||'',angle:({right:0,down:90,left:180,up:270})[r.direction],confirmed:false}));
 const ps=p.islands.flatMap(points);p.width=Math.max(1400,...ps.map(p=>p[0]+p[2]+50));p.height=Math.max(1000,...ps.map(p=>p[1]+p[3]+50));return importProject(p);
}
export function exportFiles(project){
 const check=validate(project);if(check.errors.length)throw Error(check.errors.join('\n'));
 const positions={},seats=[];
 for(const i of project.islands)points(i).forEach((p,k)=>{const n=i.numbers[k];positions[n]=p.map(v=>Math.round(v*100)/100);seats.push({seat:n,machine:i.machine||'機種確認中'});});seats.sort((a,b)=>a.seat-b.seat);
 const {id,name,prefecture,city,layout_date}=project;
 const hall={id,name,prefecture,city,floor:'スロット',seat_count:seats.length,updated_at:layout_date,layout_updated_at:layout_date,preserve_layout:true,source:{name:'FLOOR777島図ビルダー',url:project.minrepo_url,note:'現地で台番号・配置確認。機種名と実績は別途照合。'},seats};
 const registration={id,name,prefecture,city,category:'スロット',seat_count:seats.length,updated_at:layout_date,path:`halls/${id}/`,status:'draft',features:['機種名検索','台番号検索','島図','向き切替']};
 const files={[`data/positions-${id}.json`]:JSON.stringify(positions,null,2),[`data/${id}.json`]:JSON.stringify(hall,null,2),'registration.json':JSON.stringify(registration,null,2),'layout-draft.json':JSON.stringify({...project,image:null},null,2)};
 if(project.minrepo_url)files['collector-entry.json']=JSON.stringify({[id]:{name,collector:'minrepo',tag_url:project.minrepo_url,source_name:'みんレポ',source_url:project.minrepo_url,expected_machine_count:seats.length,backfill_reports:6,public_days:14,public_filename:`${id}-stats.json`}},null,2);
 files['CHECKLIST.md']=`# ${name}\n\n${seats.length}台。番号・位置・欠番を現地資料と照合してください。\n\n1. このZIPは店舗のデータ一式です。画像・実績データは含みません。\n2. layout-draft.json を node tools/build-hall.mjs layout-draft.json --out 新しいフォルダ に渡すと店舗ページも生成できます。\n3. data と生成した halls をFLOOR777へ配置します。既存店舗は内容を比較してから更新してください。\n4. registration.json を data/halls.json の halls に追加します（同じIDを重複登録しない）。\n5. collector-entry.json があれば非公開収集repoの halls.json に統合します。\n6. 機種名と実績JSONの台番号を確認します。未知の差枚を0にしないでください。\n7. 確認後にstatusをpublishedへ変更、店舗ページのnoindexを削除しサイトマップへ登録します。\n\nこの出力だけでは公開・収集は開始されません。\n`;
 return files;
}
