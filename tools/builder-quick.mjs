import {parseRoster,quickIsland,assignRoster,duplicateBank} from './builder-quick-model.mjs';
import {parseList} from './builder-model.mjs';

export function setupQuickBuilder(api){
 const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
 const panel=document.createElement('section');panel.className='quick-builder home-only';
 panel.innerHTML=`<strong>かんたん配置</strong><span>台数か番号を入力 → 島の端をクリック → 確定</span>
 <div class="quick-fields"><label>台数<input id="quickCount" type="number" min="1" max="1000" value="12"></label><label>共通の台サイズ<input id="quickSize" type="number" min="4" max="300" step="0.1" value="12"></label><label class="quick-numbers">この島の台番号（任意・台数を自動計算）<input id="quickNumbers" placeholder="101-110,112-115"></label><button id="quickRoster">番号一覧から選ぶ</button></div>
 <div class="quick-actions"><button id="quickLine">2点で直線</button><button id="quickArc">3点で円弧</button><button id="quickApply" class="primary" disabled>この位置で確定</button><button id="quickCancel" hidden>配置を中止</button><button id="quickDuplicate">選択島を複製</button><button id="quickAssign">選択島に番号を割り当て</button></div>
 <p id="quickStatus" role="status">台番号が不明でも台数だけで配置できます。</p><small id="quickRemaining"></small>`;
 document.querySelector('.inspector .section-title').after(panel);
 for(const [selector,title]of [['.batch-tools','一括生成・全体のサイズ調整・重なり修復'],['.add-tools','手書き・その他の作成方法']]){const content=document.querySelector(selector),details=document.createElement('details'),summary=document.createElement('summary');details.className='quick-advanced home-only';summary.textContent=title;content.before(details);details.append(summary,content);}
 const reverseButton=document.createElement('button');reverseButton.id='quickReverse';reverseButton.textContent='番号順を反転';panel.querySelector('.quick-actions').append(reverseButton);
 const dialog=document.createElement('dialog');dialog.id='rosterDialog';dialog.innerHTML=`<div class="dialog-heading"><h2>台番号一覧</h2><button id="rosterClose">閉じる</button></div><p>対象の貸し出し区分だけを貼り付けてください。島図と同じ時期の資料を使い、別の島に分かれる機種は今回使う番号だけ選びます。</p><details open><summary>一覧を読み込む・入れ替える</summary><label>番号一覧<textarea id="rosterText" rows="5" placeholder="ジャグラー: 101-120&#10;北斗: 201-210&#10;&#10;または「台番」「機種名」見出し付きの表を貼り付け"></textarea></label><button id="rosterParse">内容を確認</button><p id="rosterReview" role="status"></p><button id="rosterSave" disabled>この一覧を保存</button></details><label>機種で絞り込み<select id="rosterMachine"></select></label><div class="quick-actions"><button id="rosterAll">表示中の未配置を選択</button><button id="rosterNone">選択解除</button></div><div id="rosterSeats"></div><p id="rosterSelected"></p><button id="rosterUse" class="primary">選んだ番号を配置欄へ</button>`;
 document.body.append(dialog);
 const overlay=document.createElementNS(ns,'g');overlay.setAttribute('pointer-events','none');$('map').append(overlay);
 let kind=null,anchors=[],candidate=null,pendingRoster=null,machine='',projectKey=null,sizeKey=null;
 const safe=fn=>(...args)=>{try{fn(...args);}catch(e){api.toast(e.message,true);}};
 function numbers(){const raw=$('quickNumbers').value.normalize('NFKC').trim();if(!raw)return [];if(!/^[\d\s,、\-〜～~]+$/.test(raw))throw Error('番号は101-110,112のように入力してください');const nums=parseList(raw.replace(/[〜～~]/g,'-'));if(new Set(nums).size!==nums.length)throw Error('台番号が重複しています');return nums;}
 function options(){const nums=numbers();if(nums.length)$('quickCount').value=nums.length;$('quickCount').disabled=!!nums.length;return {kind,anchors,count:Number($('quickCount').value),size:Number($('quickSize').value),numbers:nums,machine};}
 function mark(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;overlay.append(n);}
 function preview(cursor){
  overlay.replaceChildren();candidate=null;$('quickApply').disabled=true;if(!kind)return;
  const needed=kind==='arc'?3:2,path=anchors.length<needed&&cursor?[...anchors,cursor]:anchors;
  for(const [x,y]of anchors)mark('circle',{cx:x,cy:y,r:4,fill:'#facc15'});
  if(path.length>=2)mark('polyline',{points:path.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#facc15','stroke-width':2});
  if(path.length!==needed)return;
  try{
   const draft=quickIsland(api.project(),{...options(),anchors:path});
   for(const [j,p]of draft.points.entries()){mark('rect',{x:p[0],y:p[1],width:p[2],height:p[3],fill:'#facc1555',stroke:'#facc15','stroke-width':1});if(draft.numbers[j])mark('text',{x:p[0]+p[2]/2,y:p[1]+p[3]/2,'text-anchor':'middle','dominant-baseline':'central','font-size':Math.max(4,p[2]/4),fill:'#fff'},draft.numbers[j]);}
   if(anchors.length===needed){candidate=draft;$('quickApply').disabled=false;$('quickStatus').textContent=`${draft.count}台をプレビュー中。台数・サイズを変えるとすぐ反映します。「この位置で確定」で追加。`;}
  }catch(e){$('quickStatus').textContent=e.message;}
 }
 function cancel(){kind=null;anchors=[];candidate=null;overlay.replaceChildren();$('quickApply').disabled=true;$('quickCancel').hidden=true;for(const id of ['quickLine','quickArc'])$(id).classList.remove('active');$('map').classList.remove('drawing');}
 function start(value){api.stopModes();cancel();kind=value;$('quickCancel').hidden=false;$(value==='arc'?'quickArc':'quickLine').classList.add('active');$('map').classList.add('drawing');$('quickStatus').textContent=value==='arc'?'最初の台の中心 → 曲がりの途中 → 最後の台の中心を押してください。':'最初の台の中心 → 最後の台の中心を押してください。';}
 $('quickLine').onclick=()=>start('line');$('quickArc').onclick=()=>start('arc');$('quickCancel').onclick=cancel;
 $('map').addEventListener('pointerdown',e=>{if(!kind||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();e.stopImmediatePropagation();if(anchors.length===(kind==='arc'?3:2))anchors=[];const p=api.point(e);anchors.push([Math.max(0,Math.min(api.project().width,p.x)),Math.max(0,Math.min(api.project().height,p.y))]);preview();},true);
 $('map').addEventListener('pointermove',e=>{if(!kind)return;const p=api.point(e);preview([p.x,p.y]);},true);
 for(const id of ['quickCount','quickSize','quickNumbers'])$(id).addEventListener('input',safe(()=>{options();preview();}));
 $('quickNumbers').addEventListener('input',()=>{machine='';});
 reverseButton.onclick=safe(()=>{const nums=numbers();if(!nums.length)throw Error('先に台番号を入力してください');$('quickNumbers').value=nums.reverse().join(',');preview();});
 $('quickApply').onclick=safe(()=>{if(!candidate)throw Error('先に島の位置を指定してください');const i=quickIsland(api.project(),options());api.add(i);$('quickNumbers').value='';$('quickCount').disabled=false;machine='';anchors=[];preview();$('quickStatus').textContent=`${i.count}台を追加しました。同じ台数・サイズで次の島を続けて置けます。`;});
 $('quickDuplicate').onclick=safe(()=>{cancel();api.add(duplicateBank(api.project(),api.selected()));api.toast('同じ形の島を隣に複製しました。ドラッグで位置を合わせてください。番号は空欄です');});
 $('quickAssign').onclick=safe(()=>{const nums=numbers(),i=api.project().islands.find(i=>i.key===api.selected());if(!i)throw Error('割り当てる島を選んでください');const next=assignRoster(api.project(),i.key,nums,machine);if(i.numbers.length&&!confirm(`${i.name}の番号を選択した${nums.length}台で置き換えます。よろしいですか？`))return;cancel();api.replace(next);$('quickNumbers').value='';$('quickCount').disabled=false;api.toast(`${nums.length}台に揃えて番号を割り当てました`);});
 function summary(){const p=api.project(),used=new Set(p.islands.flatMap(i=>i.numbers)),roster=p.seatCatalog||[],done=roster.filter(r=>used.has(r.number)).length;$('quickRemaining').textContent=roster.length?`一覧 ${roster.length}台 ／ 配置済み ${done}台 ／ 未配置 ${roster.length-done}台`:'番号一覧を保存すると、店舗ごとの未配置台数を確認できます。';}
 function renderSeats(){const p=api.project(),used=new Set(p.islands.flatMap(i=>i.numbers)),filter=$('rosterMachine').value;const frag=document.createDocumentFragment();for(const entry of p.seatCatalog||[]){if(filter!=='*'&&entry.machine!==filter)continue;const l=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span');box.type='checkbox';box.value=entry.number;box.disabled=used.has(entry.number);text.textContent=`${entry.number}${box.disabled?' 配置済み':''}`;l.append(box,text);frag.append(l);} $('rosterSeats').replaceChildren(frag);selectionSummary();}
 function selectionSummary(){$('rosterSelected').textContent=`${$('rosterSeats').querySelectorAll('input:checked').length}台を選択`;$('rosterUse').disabled=!$('rosterSeats').querySelector('input:checked');}
 function renderRoster(){const select=$('rosterMachine');select.replaceChildren();for(const [value,label]of [['*','すべての機種'],...[...new Set((api.project().seatCatalog||[]).map(r=>r.machine))].map(m=>[m,m||'機種名なし'])]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}renderSeats();}
 $('quickRoster').onclick=()=>{cancel();pendingRoster=null;$('rosterSave').disabled=true;$('rosterReview').textContent='';renderRoster();dialog.showModal();};$('rosterClose').onclick=()=>dialog.close();
 $('rosterText').oninput=()=>{pendingRoster=null;$('rosterSave').disabled=true;$('rosterReview').textContent='';};
 $('rosterParse').onclick=safe(()=>{pendingRoster=null;$('rosterSave').disabled=true;pendingRoster=parseRoster($('rosterText').value);$('rosterReview').textContent=`${pendingRoster.length}台・${new Set(pendingRoster.map(r=>r.machine)).size}グループ。番号: ${pendingRoster.slice(0,20).map(r=>r.number).join(', ')}${pendingRoster.length>20?' …':''}。保存後に全番号を選んで確認できます。`;$('rosterSave').disabled=false;});
 $('rosterSave').onclick=safe(()=>{if(!pendingRoster)return;api.catalog(pendingRoster);pendingRoster=null;$('rosterSave').disabled=true;$('rosterReview').textContent='一覧を保存しました。配置済みの島はそのままです。';renderRoster();});
 $('rosterMachine').onchange=renderSeats;$('rosterSeats').onchange=selectionSummary;
 $('rosterAll').onclick=()=>{for(const box of $('rosterSeats').querySelectorAll('input:not(:disabled)'))box.checked=true;selectionSummary();};$('rosterNone').onclick=()=>{for(const box of $('rosterSeats').querySelectorAll('input'))box.checked=false;selectionSummary();};
 $('rosterUse').onclick=()=>{const nums=[...$('rosterSeats').querySelectorAll('input:checked')].map(b=>Number(b.value));$('quickNumbers').value=nums.join(',');$('quickCount').value=nums.length;$('quickCount').disabled=true;const names=new Set((api.project().seatCatalog||[]).filter(r=>nums.includes(r.number)).map(r=>r.machine));machine=names.size===1?[...names][0]:'';dialog.close();$('quickStatus').textContent=`${nums.length}台を選びました。2点／3点で置くか、選択島に割り当ててください。`;};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open)cancel();});
 // Switching to an existing editing action must end the quick placement gesture.
 document.addEventListener('click',e=>{if(e.target.closest('.quick-builder')||e.target.closest('#rosterDialog')||!e.target.closest('button,select'))return;cancel();},true);
 return {render(){const p=api.project();if(projectKey!==p.key){cancel();projectKey=p.key;$('quickNumbers').value='';$('quickCount').disabled=false;$('rosterText').value='';machine='';}const dimensions=`${p.key}/${p.width}/${p.height}`;if(sizeKey!==dimensions){sizeKey=dimensions;$('quickSize').value=p.islands[0]?.size||Math.max(4,Math.min(24,p.width/60));}summary();},cancel};
}
