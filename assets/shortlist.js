/* Local-only shortlist. Existing FLOOR777 backups and storage keys remain compatible. */
function Floor777Shortlist({hall,bySeat,svg,onDetail,onMap}) {
  const key=`floor777:picks:${hall.id}:v1`, host=document.getElementById('shortlistPanel'), esc=Floor777.escapeHTML;
  let picks=[], selected=null, loadError=false;
  const stored=Floor777.storage.get(key);
  function validate(rows){
    if(!Array.isArray(rows)||rows.length>100||rows.some(p=>!p||!Number.isInteger(p.seat)||p.seat<=0||typeof p.note!=='string'||p.note.length>300)||new Set(rows.map(p=>p.seat)).size!==rows.length)throw Error('Invalid shortlist');
    return rows.map(p=>({seat:p.seat,note:p.note}));
  }
  try { picks=validate(stored?JSON.parse(stored):[]); } catch { loadError=true; }
  host.innerHTML=`<div class="section-head"><div><div class="eyebrow">MY PICKS</div><h2>当日の狙い台</h2></div><button class="btn ghost" id="clearPicks">全削除</button></div><p class="muted">上から優先順。メモ・追加・並べ替えを、この端末のブラウザーに自動保存します。</p><p id="pickSaveStatus" role="status" aria-live="polite"></p><form id="bulkForm"><label for="bulkSeats">台番号をまとめて追加</label><textarea id="bulkSeats" class="input" maxlength="3000" placeholder="561、562、570&#10;580 581 582"></textarea><div class="pick-actions"><button class="btn" type="submit">まとめて追加</button><span class="muted">全角数字・改行・スペース・カンマ区切りOK</span></div></form><div id="pickCards"></div><details class="backup-panel"><summary>バックアップ・復元</summary><p class="muted">別の端末へ移すときや、ブラウザーのデータを消す前に保存してください。</p><div class="pick-actions"><button id="exportPicks" class="btn secondary">バックアップ保存</button><label class="btn secondary import-label">ファイルから復元<input id="importPicks" class="sr-only" type="file" accept="application/json,.json"></label></div></details>`;
  const status=host.querySelector('#pickSaveStatus');
  if(loadError)status.textContent='保存データを読み込めませんでした。バックアップを保存してから復元してください。元データは上書きしません。';
  function save(){
    if(loadError){status.textContent='元データを保護しています。バックアップ保存後、ファイルから復元してください。';return false;}
    const ok=Floor777.storage.set(key,JSON.stringify(picks));status.textContent=ok?'✓ 自動保存しました':'保存できません。画面を閉じる前にバックアップを保存してください。';
    if(!ok)Floor777.toast('狙い台を保存できません。バックアップを保存してください。');return ok;
  }
  function paint(){const chosen=new Set(picks.map(p=>p.seat));svg.querySelectorAll('.seat').forEach(g=>g.classList.toggle('picked',chosen.has(Number(g.dataset.seat))));}
  function select(n){selected=n;const b=document.getElementById('detailPickBtn');const added=picks.some(p=>p.seat===n);b.textContent=added?'✓ 狙い台に追加済み':'＋ 狙い台に追加';b.disabled=added||loadError;}
  function render(){
    document.getElementById('pickCount').textContent=picks.length;
    host.querySelector('#clearPicks').disabled=!picks.length||loadError;
    host.querySelector('#bulkForm button').disabled=loadError;
    host.querySelector('#pickCards').innerHTML=picks.length?picks.map((p,i)=>`<article class="pick-card"><div class="pick-heading"><span class="recommend-rank">${i+1}</span><div><strong>${p.seat}番台</strong><div class="muted">${esc(bySeat.get(p.seat)?.machine||'現在の配置にない台')}</div></div></div><label>メモ<input class="input" data-note="${p.seat}" maxlength="300" value="${esc(p.note)}" placeholder="確認したいこと・立ち回りなど"></label><div class="pick-actions"><button class="btn secondary" data-action="detail" data-seat="${p.seat}" ${bySeat.has(p.seat)?'':'disabled'}>詳細</button><button class="btn secondary" data-action="map" data-seat="${p.seat}" ${bySeat.has(p.seat)?'':'disabled'}>島図</button><button class="btn ghost" data-action="up" data-seat="${p.seat}" aria-label="${p.seat}番台を上へ" ${i===0?'disabled':''}>↑</button><button class="btn ghost" data-action="down" data-seat="${p.seat}" aria-label="${p.seat}番台を下へ" ${i===picks.length-1?'disabled':''}>↓</button><button class="btn ghost" data-action="remove" data-seat="${p.seat}">削除</button></div></article>`).join(''):'<div class="empty-state">台の詳細や上の入力欄から、気になる台を追加できます。</div>';
    paint();if(selected!==null)select(selected);
  }
  function add(n){if(loadError||picks.some(p=>p.seat===n))return;if(picks.length>=100){Floor777.toast('狙い台は100台までです');return}picks.push({seat:n,note:''});const saved=save();render();if(saved)Floor777.toast(`${n}番台を狙い台に追加しました`);}
  document.getElementById('detailPickBtn').onclick=()=>{if(selected!==null)add(selected)};
  host.addEventListener('input',e=>{if(e.target.matches('[data-note]')){const p=picks.find(p=>p.seat===Number(e.target.dataset.note));if(p){p.note=e.target.value;save()}}});
  host.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const n=Number(b.dataset.seat),i=picks.findIndex(p=>p.seat===n);switch(b.dataset.action){case'detail':onDetail(n);return;case'map':onMap(n);return;case'remove':if(i>=0)picks.splice(i,1);break;case'up':case'down':{const j=i+(b.dataset.action==='up'?-1:1);if(i>=0&&j>=0&&j<picks.length)[picks[i],picks[j]]=[picks[j],picks[i]];break;}}save();render();});
  host.querySelector('#bulkForm').onsubmit=e=>{e.preventDefault();if(loadError)return;const values=host.querySelector('#bulkSeats').value.normalize('NFKC').trim().split(/[\s,、，]+/).filter(Boolean);if(!values.length){Floor777.toast('台番号を入力してください');return}const invalid=values.filter(v=>!/^\d+$/.test(v)||!bySeat.has(Number(v)));if(invalid.length){Floor777.toast('台番号を確認してください：'+invalid.slice(0,4).join('、'));return}const added=[...new Set(values.map(Number))].filter(n=>!picks.some(p=>p.seat===n));if(picks.length+added.length>100){Floor777.toast('合計100台まで追加できます');return}picks.push(...added.map(seat=>({seat,note:''})));const saved=save();render();host.querySelector('#bulkSeats').value='';if(saved)Floor777.toast(`${added.length}台追加しました。重複は除外しています。`);};
  host.querySelector('#clearPicks').onclick=()=>{if(confirm(`狙い台${picks.length}台とメモをすべて削除しますか？`)){picks=[];save();render()}};
  host.querySelector('#exportPicks').onclick=()=>{const payload=loadError?stored:JSON.stringify({hall:hall.id,picks},null,2);const url=URL.createObjectURL(new Blob([payload],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${hall.id}-shortlist.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  host.querySelector('#importPicks').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw Error();const v=JSON.parse(await file.text());if(v.hall!==hall.id)throw Error();const next=validate(v.picks);if(confirm('現在の狙い台を、このバックアップの内容に置き換えますか？')){picks=next;loadError=false;save();render();}}catch{Floor777.toast('この店舗の有効なバックアップを選んでください。')}finally{e.target.value=''}};
  render();return {paint,select};
}
