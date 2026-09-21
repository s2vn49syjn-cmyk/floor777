import {newProject,makeIsland,points,moveIsland,resizeIsland,assign,validate,importProject,fromLegacy,exportFiles,copy,uid} from './builder-model.mjs';
import {openDB,saveProject,listProjects,deleteProject} from './builder-store.mjs';
import {zipFiles} from './builder-zip.mjs';
const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
let project=newProject(),selected=null,history=[],future=[],projects=[],view={x:0,y:0,w:1400,h:1000},mode='home',ready=false,saving=Promise.resolve(),toastTimer,candidates=[],worker=null;
const island=()=>project.islands.find(i=>i.key===selected);
const node=(tag,attrs={},text)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:3500);}
function guard(fn){return async(...args)=>{try{await fn(...args);}catch(e){toast(e.message||String(e),true);}};}
function snapshot(){history.push(copy(project));if(history.length>60)history.shift();future=[];}
function save(){
 project.updated_at=new Date().toISOString();const data=copy(project);$('saveState').textContent='保存中…';
 const job=saving.catch(()=>{}).then(()=>saveProject(data));saving=job;
 job.then(()=>{if(project.key===data.key)$('saveState').textContent='✓ 自動保存済み';projects=projects.filter(p=>p.key!==data.key);projects.push(data);renderProjects();}).catch(()=>{$('saveState').textContent='保存失敗：JSON保存してください';toast('端末への保存に失敗しました。「プロジェクト保存」でJSONを保存してください。',true);});return job;
}
function changed(){render();void save();}
function renderProjects(){const frag=document.createDocumentFragment();for(const p of [...projects].sort((a,b)=>b.updated_at.localeCompare(a.updated_at))){const b=document.createElement('button');b.className='project-card'+(p.key===project.key?' active':'');const title=document.createElement('strong'),small=document.createElement('small');title.textContent=p.name;small.textContent=`${p.islands.length}島 · ${p.islands.reduce((n,i)=>n+i.count,0)}台`;b.append(title,small);b.onclick=guard(async()=>{await saving;load(p);document.body.classList.remove('show-library');});frag.append(b);}$('projects').replaceChildren(frag);}
function load(p){project=copy(p);selected=project.islands[0]?.key||null;history=[];future=[];renderMeta();fit();render();renderProjects();}
function renderMeta(){for(const k of ['name','id','prefecture','city','minrepo_url','layout_date','width','height'])$(k).value=project[k];}
function render(){
 $('projectTitle').textContent=project.name;
 const total=project.islands.reduce((s,i)=>s+i.count,0),done=project.islands.reduce((s,i)=>s+i.numbers.filter(Number.isInteger).length,0),pending=project.islands.filter(i=>!i.confirmed).length;
 $('progress').textContent=`${project.islands.length}島 · ${total}台　番号 ${done}/${total}台　配置確認待ち ${pending}島`;
 $('empty').hidden=!!project.image||!!project.islands.length;
 for(const id of ['canvasBg','gridBg','underlay']){const n=$(id);n.setAttribute('width',project.width);n.setAttribute('height',project.height);}
 if(project.image)$('underlay').setAttribute('href',project.image);else $('underlay').removeAttribute('href');
 const frag=document.createDocumentFragment();
 for(const i of project.islands){const g=node('g',{'data-key':i.key,class:`island ${i.key===selected?'selected':''} ${i.numbers.length===i.count&&i.numbers.every(Number.isInteger)?'numbered':''} ${i.confirmed?'':'unconfirmed'}`});const ps=points(i);
  ps.forEach((p,k)=>{const [x,y,w,h]=p;g.append(node('rect',{x,y,width:w,height:h,rx:3,class:'seat','data-index':k}));g.append(node('text',{x:x+w/2,y:y+h/2,'font-size':Math.max(5,Math.min(w*.32,w/(String(i.numbers[k]||'·').length*.7))),class:'seat-label'},i.numbers[k]??'·'));});
  if(ps.length){const [x,y,w,h]=ps[0];g.append(node('text',{x,y:y-12,class:'island-label'},i.name));if(i.key===selected){g.append(node('text',{x:x+w/2,y:y+h+21,class:'start-label'},'①'));if(ps.length>1){const a=ps[0],b=ps[1],dx=b[0]+b[2]/2-a[0]-a[2]/2,dy=b[1]+b[3]/2-a[1]-a[3]/2,ang=Math.atan2(dy,dx),ex=b[0]+b[2]/2,ey=b[1]+b[3]/2;g.append(node('path',{d:`M${a[0]+a[2]/2} ${a[1]+a[3]/2} L${ex} ${ey} M${ex-8*Math.cos(ang-.5)} ${ey-8*Math.sin(ang-.5)} L${ex} ${ey} L${ex-8*Math.cos(ang+.5)} ${ey-8*Math.sin(ang+.5)}`,class:'order-line'}));}}}frag.append(g);
 }
 $('islands').replaceChildren(frag);$('islandSelect').replaceChildren(...project.islands.map((i,k)=>{const o=document.createElement('option');o.value=i.key;o.textContent=`${k+1}. ${i.name} (${i.count}台)${i.numbers.length===i.count?' ✓':''}`;return o;}));if(selected)$('islandSelect').value=selected;
 $('undo').disabled=!history.length;$('redo').disabled=!future.length;$('deleteIsland').disabled=!island();renderInspector();applyView();
}
function renderInspector(){const i=island();$('islandForm').hidden=!i;$('noIsland').hidden=!!i;if(!i)return;for(const k of ['shape','count','size','x','y','angle','pitch','radius','sweep','machine'])$(k).value=typeof i[k]==='number'?Math.round(i[k]*100)/100:i[k];$('islandName').value=i.name;$('confirmed').checked=i.confirmed;$('fieldConfirmed').checked=i.confirmed;$('numberCount').value=i.count;
 $('count').disabled=i.shape==='custom';for(const k of ['angle','pitch','radius','sweep'])$(k).disabled=i.shape==='custom';$('shape').querySelector('[value=custom]').disabled=i.shape!=='custom';
 $('numberCount').title='変更時は島の全長を保って台を再配置します';
}
function select(key,focus=false){selected=key;$('skipNumbers').value='';$('explicitNumbers').value='';$('reverse').value='forward';$('startNumber').value=island()?.numbers[0]||'';render();if(focus)focusIsland();}
function applyView(){$('map').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);$('zoomLabel').textContent=Math.round(project.width/view.w*100)+'%';}
function fit(){view={x:-20,y:-20,w:project.width+40,h:project.height+40};applyView();}
function focusIsland(){const i=island();if(!i)return;const p=points(i),x=Math.min(...p.map(p=>p[0]))-60,y=Math.min(...p.map(p=>p[1]))-60;view={x,y,w:Math.max(200,Math.max(...p.map(p=>p[0]+p[2]))-x+60),h:Math.max(160,Math.max(...p.map(p=>p[1]+p[3]))-y+60)};applyView();}
function zoom(f,cx=view.x+view.w/2,cy=view.y+view.h/2){const w=Math.max(80,Math.min(project.width*5,view.w*f)),k=w/view.w;view={x:cx+(view.x-cx)*k,y:cy+(view.y-cy)*k,w,h:view.h*k};applyView();}
function setMode(m){mode=m;document.body.classList.toggle('field',m==='field');$('homeMode').classList.toggle('active',m==='home');$('fieldMode').classList.toggle('active',m==='field');$('modeTitle').textContent=m==='field'?'現地入力モード':'島の設定';if(m==='field'){document.body.classList.remove('show-library');const i=island();if(i&&(i.numbers.length!==i.count||i.numbers.some(n=>!Number.isInteger(n))))focusIsland();else nextMissing();}}
function nextMissing(){if(!project.islands.length)return;const idx=project.islands.findIndex(i=>i.key===selected);for(let k=1;k<=project.islands.length;k++){const i=project.islands[(idx+k)%project.islands.length];if(i.numbers.length!==i.count||i.numbers.some(n=>!Number.isInteger(n))){select(i.key,true);return;}}toast('すべての島に台番号が入力されています');}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function jsonDownload(d,name){download(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),name);}
function exportBundle(){download(zipFiles(exportFiles(project)),`FLOOR777-${project.id}.zip`);toast('FLOOR777用のJSON一式を出力しました');}
function report(){const r=validate(project),body=$('reportBody');body.replaceChildren();const p=document.createElement('p');p.textContent=`${project.islands.length}島 / ${r.total}台　番号未入力 ${r.missing}台　配置確認待ち ${r.unchecked}島`;body.append(p);for(const [items,cls]of [[r.errors,'error-list'],[r.warnings,'warning-list']]){const ul=document.createElement('ul');ul.className=cls;for(const text of items){const li=document.createElement('li');li.textContent=text;ul.append(li);}body.append(ul);}if(!r.errors.length){const p=document.createElement('p');p.className='success';p.textContent='✓ 重複・未入力・重なり・範囲外のチェックを通過しました。JSON一式を出力できます。';body.append(p);}$('reportExport').disabled=!!r.errors.length;$('report').showModal();}
for(const k of ['name','id','prefecture','city','minrepo_url','layout_date','width','height'])$(k).addEventListener('change',guard(()=>{const v=['width','height'].includes(k)?Number($(k).value):$(k).value.trim();if(typeof v==='number'&&(!Number.isFinite(v)||v<100||v>20000)){renderMeta();throw Error('幅と高さは100〜20000で入力してください');}snapshot();project[k]=v;changed();}));
$('newProject').onclick=guard(async()=>{await saving;load(newProject());await save();document.body.classList.add('show-library');});
$('cloneProject').onclick=guard(async()=>{await saving;const p=copy(project);p.key=uid();p.name+=' のコピー';p.id='';load(p);await save();});
$('deleteProject').onclick=guard(async()=>{if(!confirm(`「${project.name}」をこの端末から削除しますか？`))return;await saving;await deleteProject(project.key);projects=projects.filter(p=>p.key!==project.key);load(projects[0]||newProject());if(!projects.length)await save();});
$('showProjects').onclick=()=>document.body.classList.toggle('show-library');$('homeMode').onclick=()=>setMode('home');$('fieldMode').onclick=()=>setMode('field');
$('backup').onclick=()=>jsonDownload(project,`${project.id||'floor777'}-project.json`);
$('saveLayout').onclick=()=>{const p=copy(project);for(const i of p.islands)i.numbers=[];jsonDownload(p,`${project.id||'floor777'}-layout-only.json`);toast('番号を含まない島図を保存しました。編集画面の番号は保持しています');};
$('importButton').onclick=()=>$('importFile').click();
$('importFile').onchange=guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(f.size>20000000)throw Error('JSONは20MB以下で読み込んでください');const d=JSON.parse(await f.text()),p=d.version===2?importProject(d):fromLegacy(d);await saving;load(p);await save();toast('別のプロジェクトとして読み込みました');});
$('imageButton').onclick=()=>$('imageFile').click();
$('imageFile').onchange=guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>20000000)throw Error('20MB以下のPNG・JPEG・WebPを選んでください');const img=await createImageBitmap(f),scale=Math.min(1,2400/Math.max(img.width,img.height)),w=Math.round(img.width*scale),h=Math.round(img.height*scale),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);img.close();snapshot();if(!project.islands.length){project.width=Math.max(100,w);project.height=Math.max(100,h);}project.image=canvas.toDataURL('image/jpeg',.9);renderMeta();changed();fit();toast('画像を保存しました。島の自動検出、または手動追加で進められます');});
$('opacity').oninput=()=>$('underlay').setAttribute('opacity',$('opacity').value);
for(const b of document.querySelectorAll('[data-add]'))b.onclick=guard(()=>{if(project.islands.reduce((n,i)=>n+i.count,0)+12>3000)throw Error('1店舗3000台までです');snapshot();const shape=b.dataset.add,i=makeIsland({shape,name:`島 ${project.islands.length+1}`,x:Math.max(40,view.x+view.w*.25),y:Math.max(40,view.y+view.h*.3)});project.islands.push(i);selected=i.key;$('startNumber').value='';$('explicitNumbers').value='';changed();});
$('applyGeometry').onclick=guard(()=>{const i=island();if(!i)return;const next={...copy(i),name:$('islandName').value.trim()||'島',shape:$('shape').value,machine:$('machine').value.trim(),confirmed:$('confirmed').checked};for(const k of ['count','size','x','y','angle','pitch','radius','sweep'])next[k]=Number($(k).value);
 if(!Number.isInteger(next.count)||next.count<1||next.count>1000||project.islands.filter(x=>x.key!==i.key).reduce((n,x)=>n+x.count,0)+next.count>3000)throw Error('台数は1〜1000、1店舗3000台までです');
 for(const k of ['size','x','y','angle','pitch','radius','sweep'])if(!Number.isFinite(next[k]))throw Error('設定値を数値で入力してください');
 if(next.size<4||next.size>300||next.pitch<4||next.radius<1||Math.abs(next.sweep)>360||Math.abs(next.x)>20000||Math.abs(next.y)>20000)throw Error('台サイズ4〜300・間隔4以上・半径1以上・曲がる角度±360以内で指定してください');
 if(next.count!==i.count&&i.numbers.length&&!confirm('台数を変更すると、この島の番号を消去します。続けますか？'))return;
 if(next.shape==='custom'){const dx=next.x-i.x,dy=next.y-i.y;next.points=i.points.map(p=>[p[0]+dx,p[1]+dy,next.size===i.size?p[2]:next.size,next.size===i.size?p[3]:next.size]);}
 if(next.count!==i.count)next.numbers=[];
 snapshot();Object.assign(i,next);changed();});
$('deleteIsland').onclick=()=>{const i=island();if(!i||!confirm(`${i.name}を削除しますか？（元に戻せます）`))return;snapshot();project.islands=project.islands.filter(x=>x!==i);selected=project.islands[0]?.key||null;changed();};
$('islandSelect').onchange=e=>select(e.target.value,mode==='field');
function adjacent(d){const idx=project.islands.findIndex(i=>i.key===selected);if(project.islands.length)select(project.islands[(idx+d+project.islands.length)%project.islands.length].key,mode==='field');}
$('prevIsland').onclick=()=>adjacent(-1);$('nextIsland').onclick=()=>adjacent(1);$('nextMissing').onclick=nextMissing;
$('fieldConfirmed').onchange=()=>{if(!island())return;snapshot();island().confirmed=$('fieldConfirmed').checked;changed();};
function assignNumbers(next=false){const test=copy(project),target=test.islands.find(i=>i.key===selected),count=Number($('numberCount').value);if(!target)throw Error('島を選んでください');if(count!==target.count){if(!Number.isInteger(count)||count<1||count>1000||test.islands.filter(i=>i!==target).reduce((n,i)=>n+i.count,0)+count>3000)throw Error('台数は1〜1000、1店舗3000台までです');if(!confirm(`この島を${target.count}台から${count}台に変更して再配置します。配置の確認が必要です。続けますか？`))return;resizeIsland(target,count);}const nums=assign(test,selected,{start:Number($('startNumber').value),count:Number($('numberCount').value),reverse:$('reverse').value==='reverse',skip:$('skipNumbers').value,explicit:$('explicitNumbers').value});snapshot();project=test;changed();toast(`${nums.length}台の番号を入力しました`);if(next){nextMissing();$('startNumber').value=Math.max(...nums)+1;}}
$('assign').onclick=guard(()=>assignNumbers());$('assignNext').onclick=guard(()=>assignNumbers(true));
$('loadNumbers').onclick=()=>{$('explicitNumbers').value=island()?.numbers.map(n=>n??'').join(',')||'';$('reverse').value='forward';};
$('clearNumbers').onclick=()=>{if(!island()||!confirm('この島の台番号を消しますか？'))return;snapshot();island().numbers=[];$('startNumber').value='';$('explicitNumbers').value='';changed();};
$('undo').onclick=()=>{if(!history.length)return;future.push(copy(project));project=history.pop();if(!island())selected=project.islands[0]?.key||null;renderMeta();changed();};
$('redo').onclick=()=>{if(!future.length)return;history.push(copy(project));project=future.pop();if(!island())selected=project.islands[0]?.key||null;renderMeta();changed();};
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}});
$('fit').onclick=fit;$('focus').onclick=focusIsland;$('zoomIn').onclick=()=>zoom(.8);$('zoomOut').onclick=()=>zoom(1.25);
for(const k of ['check','checkTop'])$(k).onclick=report;$('closeReport').onclick=()=>$('report').close();$('reportExport').onclick=guard(exportBundle);$('export').onclick=guard(()=>{if(validate(project).errors.length)report();else exportBundle();});
// Pan/pinch and drag use SVG coordinates, including letterboxed mobile screens.
const pointers=new Map();let gesture=null;
function point(e){const p=new DOMPoint(e.clientX,e.clientY),m=$('map').getScreenCTM();return p.matrixTransform(m.inverse());}
$('map').addEventListener('pointerdown',e=>{
 if(e.button!==0&&e.pointerType==='mouse')return;const g=e.target.closest('[data-key]');pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});$('map').setPointerCapture(e.pointerId);
 if(pointers.size===2){if(gesture?.moved){changed();}const a=[...pointers.values()];gesture={type:'pinch',dist:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),view:{...view}};return;}
 if(g){if(selected!==g.dataset.key)select(g.dataset.key);const p=point(e);gesture={type:mode==='home'?'drag':'tap',start:p,client:{x:e.clientX,y:e.clientY},original:copy(island()),index:e.target.dataset.index!==undefined?Number(e.target.dataset.index):null,moved:false};}
 else gesture={type:'pan',start:point(e),view:{...view}};
});
$('map').addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(gesture.type==='pinch'&&pointers.size===2){const a=[...pointers.values()],d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);view={...gesture.view};zoom(gesture.dist/Math.max(1,d));return;}
 if(gesture.type==='pan'){const p=point(e);view.x+=gesture.start.x-p.x;view.y+=gesture.start.y-p.y;applyView();return;}
 if(gesture.type!=='drag')return;const p=point(e);let dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
 if(!gesture.moved&&Math.hypot(e.clientX-gesture.client.x,e.clientY-gesture.client.y)<4)return;
 if(!gesture.moved){snapshot();gesture.moved=true;}
 if($('snap').checked){dx=Math.round(dx/8)*8;dy=Math.round(dy/8)*8;}
 const i=island(),orig=gesture.original;if(!i)return;Object.assign(i,copy(orig));
 if($('seatMove').checked&&gesture.index!==null){i.shape='custom';i.points=points(orig);i.points[gesture.index][0]+=dx;i.points[gesture.index][1]+=dy;}
 else moveIsland(i,dx,dy);i.confirmed=false;render();
});
function endPointer(e){pointers.delete(e.pointerId);if(gesture?.moved){changed();}gesture=null;}
$('map').addEventListener('pointerup',endPointer);$('map').addEventListener('pointercancel',endPointer);
$('map').addEventListener('wheel',e=>{e.preventDefault();const p=point(e);zoom(e.deltaY>0?1.12:.89,p.x,p.y);},{passive:false});
$('detect').onclick=guard(async()=>{
 if(!project.image)throw Error('先に島図画像を読み込んでください');const detectionKey=project.key;$('detect').disabled=true;$('detect').textContent='検出中…';
 try{const img=new Image();img.src=project.image;await img.decode();const w=Math.min(900,img.width),h=Math.round(img.height*w/img.width),c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);const data=ctx.getImageData(0,0,w,h);worker=new Worker(new URL('./builder-worker.mjs',import.meta.url),{type:'module'});
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('検出が時間切れになりました。画像を小さくして試してください')),20000);worker.onmessage=e=>{clearTimeout(timer);e.data.error?reject(Error(e.data.error)):resolve(e.data.islands);};worker.onerror=()=>{clearTimeout(timer);reject(Error('検出処理を起動できませんでした'));};worker.postMessage({image:data,scale:project.width/w});});
 if(project.key!==detectionKey)throw Error('検出中に店舗が切り替わりました。現在の店舗で検出し直してください');
 candidates=result.map(c=>{const sy=(project.height/h)/(project.width/w);if(Math.abs(sy-1)<.01)return c;const ps=points(makeIsland(c)).map(p=>[p[0],p[1]*sy,p[2],p[3]*sy]);return {...c,shape:'custom',points:ps,y:c.y*sy};});if(!candidates.length){toast('色から島を見つけられませんでした。直線・曲線・円形ボタンで追加できます',true);return;}
 $('candidateSummary').textContent=`${candidates.length}候補。追加後も既存の島は残ります。`;$('candidateList').replaceChildren(...candidates.map((c,j)=>{const l=document.createElement('label');l.className='candidate-row';const box=document.createElement('input');box.type='checkbox';box.checked=true;box.dataset.index=j;const s=document.createElement('span');s.textContent=`候補 ${j+1}：${c.shape==='circle'?'円形':c.shape==='arc'?'曲線':c.shape==='custom'?'個別座標':'直線・斜め'} / 推定${c.count}台 / 位置 ${Math.round(c.x)}, ${Math.round(c.y)}`;l.append(box,s);return l;}));const preview=$('candidatePreview');preview.setAttribute('viewBox',`0 0 ${project.width} ${project.height}`);preview.replaceChildren(node('image',{href:project.image,width:project.width,height:project.height,opacity:.5}));
 candidates.forEach((c,j)=>{const ps=points(makeIsland(c)),g=node('g',{class:'candidate'});for(const p of ps)g.append(node('rect',{x:p[0],y:p[1],width:p[2],height:p[3],fill:'#ff8c2066',stroke:'#ffb466','stroke-width':2}));g.append(node('text',{x:ps[0][0],y:ps[0][1]-5},j+1));const box=$('candidateList').querySelector(`[data-index="${j}"]`);box.onchange=()=>g.classList.toggle('off',!box.checked);g.onclick=()=>{box.checked=!box.checked;box.onchange();};preview.append(g);});
 $('candidates').showModal();
 }finally{worker?.terminate();worker=null;$('detect').disabled=false;$('detect').textContent='島を自動検出';}
});
$('closeCandidates').onclick=()=>$('candidates').close();$('acceptCandidates').onclick=guard(()=>{const chosen=[...$('candidateList').querySelectorAll('input:checked')].map(x=>candidates[Number(x.dataset.index)]);if(!chosen.length)throw Error('候補を選んでください');if(project.islands.reduce((n,i)=>n+i.count,0)+chosen.reduce((n,i)=>n+i.count,0)>3000)throw Error('合計3000台を超えます。候補を減らしてください');snapshot();for(const c of chosen){const i=makeIsland({...c,name:`島 ${project.islands.length+1}`});delete i.area;project.islands.push(i);selected=i.key;}changed();$('candidates').close();fit();toast('候補を追加しました。形状・台数を修正して「確認済み」にしてください');});
function network(){$('network').textContent=navigator.onLine?'オンライン':'オフライン';}window.addEventListener('online',network);window.addEventListener('offline',network);network();
// Only the builder files are cached by this worker; it does not change site data.
if('serviceWorker'in navigator){navigator.serviceWorker.register('./builder-sw.js',{scope:'./'}).then(async reg=>{const active=reg.active;if(active)$('offlineState').textContent='✓ この端末でオフライン利用できます';else{const w=reg.installing||reg.waiting;if(w)w.addEventListener('statechange',()=>{if(w.state==='activated')$('offlineState').textContent='✓ この端末でオフライン利用できます';});}}).catch(()=>$('offlineState').textContent='オフライン画面の準備に失敗。通信できる状態で再読み込みしてください');}else $('offlineState').textContent='オフライン起動にはHTTPSで開いてください';
try{await openDB();projects=await listProjects();projects.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));if(projects.length)load(projects[0]);else{load(project);await save();}ready=true;$('saveState').textContent='✓ 自動保存済み';}catch{load(project);$('saveState').textContent='自動保存不可';toast('このブラウザでは自動保存を利用できません。JSONで保存してください。',true);}
window.addEventListener('beforeunload',e=>{if($('saveState').textContent==='保存中…')e.preventDefault();});
