import {expandLayout,parseNumbers} from './hall-model.mjs';
const $=id=>document.getElementById(id), ns='http://www.w3.org/2000/svg';
let rows=[], selected=-1, imageURL='', imageRatio=0.75, drag=null;
$('date').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const message=s=>$('status').textContent=s;
const run=fn=>{try{fn()}catch(e){message(e.message)}};
function draft(){return {version:1,id:$('hallId').value.trim(),name:$('hallName').value.trim(),prefecture:$('prefecture').value.trim(),city:$('city').value.trim(),minrepo_url:$('minrepo').value.trim(),layout_date:$('date').value,rows};}
function rowInput(){return {numbers:parseNumbers($('numbers').value),machine:$('machine').value.trim(),x:Number($('x').value),y:Number($('y').value),direction:$('direction').value};}
function select(i){selected=i;const r=rows[i];$('numbers').value=r.numbers.join(',');$('machine').value=r.machine||'';$('x').value=r.x;$('y').value=r.y;$('direction').value=r.direction;render();}
function element(tag,attrs,parent){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;}
function validateRows(next){expandLayout({id:'preview',name:'preview',prefecture:'preview',city:'preview',minrepo_url:'https://min-repo.com/tag/preview/',layout_date:$('date').value,rows:next});}
function render(){
 const svg=$('map');svg.replaceChildren();const iw=Number($('imageWidth').value)||1600;
 let w=iw,h=iw*imageRatio;
 if(imageURL)element('image',{href:imageURL,width:iw,height:h,opacity:$('opacity').value},svg);
 rows.forEach((r,index)=>r.numbers.forEach((n,i)=>{const x=r.x+(r.direction==='right'?48*i:r.direction==='left'?-48*i:0),y=r.y+(r.direction==='down'?48*i:r.direction==='up'?-48*i:0);w=Math.max(w,x+64);h=Math.max(h,y+64);const g=element('g',{'data-row':index,style:'cursor:move'},svg);element('rect',{x,y,width:44,height:44,rx:4,fill:index===selected?'#b62040':'#23344b','fill-opacity':0.85,stroke:'#fff'},g);const t=element('text',{x:x+22,y:y+27,fill:'white','text-anchor':'middle','font-size':12,'pointer-events':'none'},g);t.textContent=n;}));
 svg.setAttribute('width',w);svg.setAttribute('height',h);
 $('rows').replaceChildren();rows.forEach((r,i)=>{const b=document.createElement('button');b.textContent=`列${i+1}：${r.numbers[0]}〜${r.numbers.at(-1)}（${r.numbers.length}台）`;b.setAttribute('aria-pressed',String(selected===i));b.onclick=()=>select(i);$('rows').append(b);});
}
$('add').onclick=()=>run(()=>{const r=rowInput();validateRows([...rows,r]);rows.push(r);selected=rows.length-1;render();message(`${rows.reduce((n,r)=>n+r.numbers.length,0)}台を配置しました。JSONを保存してください。`)});
$('update').onclick=()=>run(()=>{if(selected<0)throw Error('列を選んでください');const next=rows.map((r,i)=>i===selected?rowInput():r);validateRows(next);rows=next;render();message('選択した列を更新しました');});
$('remove').onclick=()=>{if(selected>=0){rows.splice(selected,1);selected=-1;render();message('列を削除しました。保存済みJSONから復元できます。')}};
$('opacity').oninput=render;$('imageWidth').oninput=render;
$('mapImage').onchange=()=>{const f=$('mapImage').files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type)){message('PNG・JPEG・WebPを選んでください');return;}const url=URL.createObjectURL(f),img=new Image();img.onload=()=>{if(imageURL)URL.revokeObjectURL(imageURL);imageURL=url;imageRatio=img.height/img.width;render();};img.onerror=()=>{URL.revokeObjectURL(url);message('画像を読み込めませんでした');};img.src=url;};
$('save').onclick=()=>run(()=>{const d=draft();const {seats}=expandLayout(d);const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=d.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`${seats.length}台の設定を保存しました。画像も別途保管してください。`);});
$('import').onchange=async()=>{try{const f=$('import').files[0];if(!f)return;const d=JSON.parse(await f.text());expandLayout(d);for(const [id,key] of Object.entries({hallId:'id',hallName:'name',prefecture:'prefecture',city:'city',minrepo:'minrepo_url',date:'layout_date'}))$(id).value=d[key];rows=d.rows;selected=-1;if(imageURL)URL.revokeObjectURL(imageURL);imageURL='';render();message('設定を読み込みました。下敷き画像は必要に応じて選び直してください。');}catch(e){message(e.message)}};
$('map').onpointerdown=e=>{const g=e.target.closest('[data-row]');if(!g)return;const i=Number(g.dataset.row);select(i);drag={i,x:e.clientX,y:e.clientY,ox:rows[i].x,oy:rows[i].y};$('map').setPointerCapture(e.pointerId);};
$('map').onpointermove=e=>{if(!drag)return;const r=rows[drag.i];r.x=Math.round(Math.max(0,drag.ox+e.clientX-drag.x));r.y=Math.round(Math.max(0,drag.oy+e.clientY-drag.y));$('x').value=r.x;$('y').value=r.y;render();};
function end(){if(!drag)return;try{validateRows(rows);message('列を移動しました。JSONを保存してください。')}catch(e){rows[drag.i].x=drag.ox;rows[drag.i].y=drag.oy;message(e.message+'。移動前に戻しました。');}const i=drag.i;drag=null;select(i);}
$('map').onpointerup=end;$('map').onpointercancel=end;
window.addEventListener('beforeunload',e=>{if(rows.length){e.preventDefault();e.returnValue='';}});
render();
