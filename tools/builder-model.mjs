// Geometry and project data are independent of the screen and network.
export const VERSION=2;
export const uid=()=>globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const copy=x=>JSON.parse(JSON.stringify(x));
export function newProject(){return {version:VERSION,key:uid(),id:'',name:'新しい店舗',prefecture:'大阪府',city:'',minrepo_url:'',layout_date:new Date().toLocaleDateString('sv-SE'),width:1400,height:1000,image:null,islands:[],updated_at:new Date().toISOString()};}
export function makeIsland(o={}){return {key:uid(),name:'島',shape:'line',x:200,y:200,count:12,size:24,pitch:36,angle:0,radius:150,sweep:120,confirmed:false,numbers:[],machine:'',...o};}
// Use one seat size per map. Keep each detected seat centered on its original position.
export function unifyGeneratedSeatSize(islands,width,height){
 const generated=islands.filter(i=>i.shape==='custom'&&i.estimatedCount&&!i.confirmed&&!i.numbers.length&&i.points?.length);
 if(!generated.length)return 0;
 const sizes=generated.map(i=>i.size).sort((a,b)=>a-b);
 const target=Math.max(4,Math.min(300,sizes[Math.floor((sizes.length-1)*.35)]));
 for(const i of generated){
  i.points=i.points.map(([x,y,w,h])=>{
   const cx=x+w/2,cy=y+h/2;
   return [Math.max(0,Math.min(width-target,cx-target/2)),Math.max(0,Math.min(height-target,cy-target/2)),target,target];
  });
  i.x=i.points[0][0];i.y=i.points[0][1];i.size=target;i.pitch=target*1.32;
 }
 return target;
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
 if(project.islands.some(i=>!i.machine))warnings.push('機種名未設定の台があります。公開前に収集データと照合してください');
 return {errors:[...new Set(errors)],warnings,missing,unchecked,total:all.length};
}
export function importProject(d){
 if(!d||typeof d!=='object'||d.version!==VERSION||!Array.isArray(d.islands)||d.islands.length>1000)throw Error('FLOOR777ビルダーのプロジェクトJSONではありません');
 const p=newProject();for(const k of ['id','name','prefecture','city','minrepo_url','layout_date']){if(typeof d[k]!=='string'||d[k].length>2000)throw Error('店舗情報が不正です');p[k]=d[k];}
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
