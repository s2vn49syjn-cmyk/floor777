import {expandLayout,parseNumbers} from './hall-model.mjs';
const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='hall-editor.css?v=2';document.head.append(stylesheet);
const $=id=>document.getElementById(id), ns='http://www.w3.org/2000/svg';
let rows=[], selected=-1, imageURL='', imageRatio=0.75, drag=null, placing=false, scale=1, fit=true, history=[];
const storageKey='floor777-editor-draft-v1';
$('date').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const message=s=>$('status').textContent=s;
const run=fn=>{try{fn()}catch(e){message(e.message)}};
function checkpoint(){history.push(JSON.stringify(rows));if(history.length>40)history.shift();}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify({draft:draft(),imageWidth:$('imageWidth').value,imageRatio}));$('saveState').textContent='この端末に下書き保存済み（画像は保存対象外）';}catch{$('saveState').textContent='自動保存できません。JSONを保存してください';}}
function point(e){const p=$('map').createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform($('map').getScreenCTM().inverse());}
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
 if(fit)scale=Math.max(.03,Math.min(1,(svg.parentElement.clientWidth||800)/w,(svg.parentElement.clientHeight||600)/h));
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('width',w*scale);svg.setAttribute('height',h*scale);svg.style.cursor=placing?'crosshair':'';
 if($('counter'))$('counter').textContent=`${rows.length}列・${rows.reduce((n,r)=>n+r.numbers.length,0)}台 ／ ${Math.round(scale*100)}%`;
 if($('undo'))$('undo').disabled=!history.length;
 $('add').textContent=placing?'配置をキャンセル':'画像上をクリックして列を追加';
 $('add').setAttribute('aria-pressed',String(placing));
 $('update').disabled=$('remove').disabled=selected<0;
 $('rows').replaceChildren();rows.forEach((r,i)=>{const b=document.createElement('button');b.textContent=`列${i+1}：${r.numbers[0]}〜${r.numbers.at(-1)}（${r.numbers.length}台）`;b.setAttribute('aria-pressed',String(selected===i));b.onclick=()=>select(i);$('rows').append(b);});
}
$('add').onclick=()=>run(()=>{if(!placing&&!parseNumbers($('numbers').value).length)throw Error('先に台番号を入力してください');placing=!placing;render();message(placing?'画像上で最初の台を置く場所をクリックしてください。':'配置をキャンセルしました');});
$('update').onclick=()=>run(()=>{if(selected<0)throw Error('列を選んでください');const next=rows.map((r,i)=>i===selected?rowInput():r);validateRows(next);checkpoint();rows=next;render();persist();message('選択した列を更新しました');});
$('remove').onclick=()=>{if(selected>=0){checkpoint();rows.splice(selected,1);selected=-1;render();persist();message('列を削除しました。「元に戻す」で復元できます。')}};
$('opacity').oninput=render;$('imageWidth').oninput=render;
$('mapImage').onchange=()=>{const f=$('mapImage').files[0];if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type)){message('PNG・JPEG・WebPを選んでください');return;}const url=URL.createObjectURL(f),img=new Image();img.onload=()=>{if(imageURL)URL.revokeObjectURL(imageURL);imageURL=url;imageRatio=img.height/img.width;render();};img.onerror=()=>{URL.revokeObjectURL(url);message('画像を読み込めませんでした');};img.src=url;};
$('save').onclick=()=>run(()=>{const d=draft();const {seats}=expandLayout(d);const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=d.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`${seats.length}台の設定を保存しました。画像も別途保管してください。`);});
$('import').onchange=async()=>{try{const f=$('import').files[0];if(!f)return;const d=JSON.parse(await f.text());expandLayout(d);for(const [id,key] of Object.entries({hallId:'id',hallName:'name',prefecture:'prefecture',city:'city',minrepo:'minrepo_url',date:'layout_date'}))$(id).value=d[key];rows=d.rows;selected=-1;history=[];placing=false;fit=true;if(imageURL)URL.revokeObjectURL(imageURL);imageURL='';render();persist();message('設定を読み込みました。下敷き画像は必要に応じて選び直してください。');}catch(e){message(e.message)}};
$('map').onpointerdown=e=>run(()=>{if(e.button!==undefined&&e.button!==0)return;const p=point(e);if(placing){const r={...rowInput(),x:Math.round(p.x),y:Math.round(p.y)};validateRows([...rows,r]);checkpoint();rows.push(r);placing=false;select(rows.length-1);persist();message('追加しました。ドラッグで調整できます。');return;}const g=e.target.closest('[data-row]');if(!g)return;const i=Number(g.dataset.row);select(i);drag={i,x:p.x,y:p.y,ox:rows[i].x,oy:rows[i].y,before:JSON.stringify(rows)};$('map').setPointerCapture(e.pointerId);});
$('map').onpointermove=e=>{if(!drag)return;const p=point(e),r=rows[drag.i];r.x=Math.round(Math.max(0,drag.ox+p.x-drag.x));r.y=Math.round(Math.max(0,drag.oy+p.y-drag.y));$('x').value=r.x;$('y').value=r.y;const wasFit=fit;fit=false;render();fit=wasFit;};
function end(cancel=false){if(!drag)return;try{if(cancel)throw Error('移動キャンセル');validateRows(rows);if(JSON.stringify(rows)!==drag.before){history.push(drag.before);if(history.length>40)history.shift();}message('列を移動しました。')}catch(e){rows=JSON.parse(drag.before);message(e.message+'。移動前に戻しました。');}const i=drag.i;drag=null;select(i);persist();}
$('map').onpointerup=()=>end();$('map').onpointercancel=()=>end(true);
window.addEventListener('beforeunload',e=>{if(rows.length){e.preventDefault();e.returnValue='';}});
const sidebar=document.querySelector('.layout>section'),meta=document.createElement('details');meta.innerHTML='<summary>店舗情報（保存時に入力）</summary>';
while(sidebar.firstElementChild&&sidebar.firstElementChild.tagName!=='FIELDSET')meta.append(sidebar.firstElementChild);sidebar.prepend(meta);
const imageField=$('mapImage').closest('fieldset'),rowField=$('numbers').closest('fieldset');
const settings=document.createElement('details');settings.innerHTML='<summary>画像の透明度・縮尺</summary>';for(const id of ['opacity','imageWidth'])settings.append($(id).closest('label'));imageField.append(settings);
const coords=document.createElement('details');coords.innerHTML='<summary>座標を数値で微調整</summary>';const pair=$('x').closest('.pair');pair.before(coords);coords.append(pair);
rowField.querySelector('p').textContent='台番号 → 方向 → 追加ボタン → 画像をクリック。配置済みの列はドラッグで移動できます。';
const canvas=$('map').parentElement,toolbar=document.createElement('div');toolbar.className='editor-toolbar';toolbar.innerHTML='<button id="fit">全体表示</button><button id="zoomIn" aria-label="拡大">＋</button><button id="zoomOut" aria-label="縮小">−</button><button id="undo">元に戻す</button><span id="counter"></span>';canvas.before(toolbar);
const state=document.createElement('p');state.id='saveState';$('save').before(state);
canvas.parentElement.querySelector('p').textContent='①画像を選ぶ　②台番号を入力　③画像上に配置';
$('undo').onclick=()=>{if(!history.length)return;rows=JSON.parse(history.pop());selected=-1;placing=false;render();persist();message('1つ前の配置に戻しました');};
$('fit').onclick=()=>{fit=true;render();};for(const [id,factor]of [['zoomIn',1.3],['zoomOut',1/1.3]])$(id).onclick=()=>{fit=false;scale=Math.max(.03,Math.min(3,scale*factor));render();};
for(const id of ['hallId','hallName','prefecture','city','minrepo','date','imageWidth'])$(id).addEventListener('input',persist);
window.addEventListener('resize',()=>{if(fit)render();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){placing=false;render();}if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.target.matches('input,textarea')){e.preventDefault();$('undo').click();}});
try{const s=JSON.parse(localStorage.getItem(storageKey)||'null');if(s?.draft){if(s.draft.rows.length)validateRows(s.draft.rows);for(const [id,k]of Object.entries({hallId:'id',hallName:'name',prefecture:'prefecture',city:'city',minrepo:'minrepo_url',date:'layout_date'}))$(id).value=s.draft[k]||'';rows=s.draft.rows;$('imageWidth').value=s.imageWidth||1600;imageRatio=s.imageRatio||.75;message('前回の下書きを復元しました。画像を選び直してください。');}}catch{message('保存済みの下書きを復元できません。JSONを読み込んでください。');}
render();
