import {parseList,makeIsland,points,copy,uid,resizeIsland,assign} from './builder-model.mjs';
import {seatsAlongStroke,arcThroughThreePoints} from './builder-draw.mjs';

// A table must identify its number column; never treat payout/game columns as seats.
export function parseRoster(text){
 const lines=String(text).normalize('NFKC').trim().split(/\r?\n/).filter(x=>x.trim());
 if(!lines.length)throw Error('台番号一覧を貼り付けてください');
 const split=line=>line.split(line.includes('\t')?'\t':',').map(x=>x.trim().replace(/^"(.*)"$/,'$1'));
 const header=split(lines[0]),numberCol=header.findIndex(x=>/^(台番号|台番|番号)$/.test(x)),machineCol=header.findIndex(x=>/^(機種|機種名)$/.test(x));
 const entries=[];
 for(const [index,line] of lines.entries()){
  if(index===0&&numberCol>=0)continue;
  if(numberCol<0&&line.includes('\t'))throw Error('表を貼り付ける場合は「台番」見出しの行も含めてください');
  let machine='',raw=line.trim();
  if(numberCol>=0){const cells=split(line);raw=cells[numberCol]||'';machine=machineCol>=0?cells[machineCol]||'':'';}
  else if(/[：:]/.test(raw)){const at=raw.search(/[：:]/);machine=raw.slice(0,at).trim();raw=raw.slice(at+1).trim();}
  if(!raw||!/^[\d\s,、\-〜～~]+$/.test(raw))throw Error(`${index+1}行目：台番号だけ、または「機種名: 101-110」の形式にしてください。表には「台番」見出しが必要です`);
  const numbers=parseList(raw.replace(/[〜～~]/g,'-'));
  if(!numbers.length)throw Error(`${index+1}行目に台番号がありません`);
  for(const number of numbers)entries.push({number,machine:machine.slice(0,200)});
  if(entries.length>3000)throw Error('一覧は3000台までです');
 }
 const seen=new Set();for(const {number} of entries){if(number<1||number>99999||seen.has(number))throw Error(`台番号 ${number} が重複または範囲外です`);seen.add(number);}
 return entries;
}
export function quickIsland(project,{anchors,kind,count,size,numbers=[],machine=''}){
 if(!Number.isInteger(count)||count<1||count>1000||project.islands.reduce((n,i)=>n+i.count,0)+count>3000)throw Error('台数は1〜1000、店舗合計3000台までです');
 if(numbers.length&&numbers.length!==count)throw Error('台数と番号の数が一致しません');
 const used=new Set(project.islands.flatMap(i=>i.numbers));
 if(numbers.some(n=>used.has(n))||new Set(numbers).size!==numbers.length)throw Error('配置済みの台番号が含まれています');
 const path=kind==='arc'?arcThroughThreePoints(...anchors):anchors;
 if(path.length<2||Math.hypot(path.at(-1)[0]-path[0][0],path.at(-1)[1]-path[0][1])<1)throw Error('始点と終点を離してください');
 const placed=seatsAlongStroke(path,count,size,project.width,project.height);
 return makeIsland({shape:'custom',name:machine||`島 ${project.islands.length+1}`,machine,count,size,points:placed,x:placed[0][0],y:placed[0][1],numbers:[...numbers],confirmed:false,estimatedCount:!numbers.length,source:kind==='arc'?'three-point-arc':'two-point-line'});
}
export function assignRoster(project,key,numbers,machine){
 const next=copy(project),target=next.islands.find(i=>i.key===key);
 if(!target)throw Error('先に割り当てる島を選んでください');
 if(!numbers.length||numbers.length>1000||next.islands.filter(i=>i!==target).reduce((n,i)=>n+i.count,0)+numbers.length>3000)throw Error('割り当てる番号を選んでください（1島1000台まで）');
 if(target.count!==numbers.length)resizeIsland(target,numbers.length);assign(next,key,{explicit:numbers.join(','),count:numbers.length});target.machine=machine||target.machine;target.confirmed=false;target.estimatedCount=false;
 return next;
}
export function duplicateBank(project,key){
 const original=project.islands.find(i=>i.key===key);if(!original)throw Error('複製する島を選んでください');
 if(project.islands.reduce((n,i)=>n+i.count,0)+original.count>3000)throw Error('店舗合計3000台までです');
 const i=copy(original),ps=points(i),a=ps[0],b=ps.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
 const distance=i.size*1.6,dx=-(b[1]-a[1])/length*distance,dy=(b[0]-a[0])/length*distance;
 i.key=uid();i.name+=' コピー';i.shape='custom';i.points=ps.map(p=>[p[0]+dx,p[1]+dy,p[2],p[3]]);i.x=i.points[0][0];i.y=i.points[0][1];i.numbers=[];i.confirmed=false;i.estimatedCount=true;
 if(i.points.some(([x,y,w,h])=>x<0||y<0||x+w>project.width||y+h>project.height))throw Error('複製先が画像の外になります。元の島を少し内側へ移動してください');
 return i;
}
