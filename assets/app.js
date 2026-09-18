const NORMALIZE_MAP = new Map([
  ['東京グール','東京喰種'],['モンキー','モンキーターン'],['北斗','北斗の拳'],['マイジャグ','マイジャグラー'],
  ['ゴージャグ','ゴーゴージャグラー'],['ファンキー','ファンキージャグラー'],['リコリコ','リコリスリコイル'],
  ['カバネリ','甲鉄城のカバネリ'],['ヴヴヴ','ヴァルヴレイヴ'],['ミリゴ','ミリオンゴッド'],['SAO','ソードアートオンライン']
]);
function normalizeLiteral(s){return String(s).normalize('NFKC').toLowerCase().replace(/[\s・･\-‐ー~〜～ⅡⅢⅣⅤ]/g,'')}
function normalize(s=''){
  let v=normalizeLiteral(s);
  for(const [a,b] of NORMALIZE_MAP) v=v.replace(normalizeLiteral(a),normalizeLiteral(b));
  return v;
}
function shortName(name){
  const pairs=[['東京喰種','東京喰種'],['ミリオンゴッド','ミリゴ'],['戦国乙女5','乙女5'],['海門決戦','カバネリ'],['ファンキー','ファンキー'],['ネオアイム','ネオアイム'],['モンキーターン','モンキーV'],['北斗の拳','北斗'],['炎炎ノ消防隊2','炎炎2'],['マイジャグラー','マイジャグ'],['リコリス','リコリコ'],['ソードアート','SAO'],['ゴーゴー','ゴージャグ'],['ヴァルヴレイヴ','ヴヴヴ']];
  for(const [k,v] of pairs) if(name.includes(k)) return v;
  return name.replace(/^(スマスロ\s*|Lパチスロ\s*|パチスロ\s*|Lスマスロ\s*|スロット\s*|L)/,'').slice(0,10);
}
function escapeHtml(str){return String(str).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtNumber(v,signed=false,suffix=''){if(v===null||v===undefined||Number.isNaN(Number(v)))return '—';const n=Number(v);const txt=Math.round(n).toLocaleString('ja-JP');return `${signed&&n>0?'+':''}${txt}${suffix}`}
function diffClass(v){if(v===null||v===undefined||Number.isNaN(Number(v)))return '';return Number(v)>0?'plus':Number(v)<0?'minus':''}
function shortDate(s){if(!s)return '—';const p=String(s).split('-');return p.length===3?`${Number(p[1])}/${Number(p[2])}`:s}
function mapValue(v,mode){
  if(v===null||v===undefined||Number.isNaN(Number(v)))return '—';
  const n=Math.round(Number(v));
  if(mode==='diff')return `${n>0?'+':''}${n}`;
  if(mode==='spins')return `${n}G`;
  return String(n);
}

function compactPositions(raw){
  const entries=Object.entries(raw).map(([seat,p])=>[seat,p.map(Number)]);
  const intervals=entries.map(([,p])=>[p[1],p[1]+p[3]]).sort((a,b)=>a[0]-b[0]);
  if(!intervals.length) return {};
  let edge=intervals[0][0]; const gaps=[];
  for(const [start,end] of intervals){
    if(start-edge>24) gaps.push([edge,start,start-edge-24]);
    edge=Math.max(edge,end);
  }
  const minX=Math.min(...entries.map(([,p])=>p[0]));
  const minY=intervals[0][0];
  const out={};
  for(const [seat,p] of entries){
    const [x,y,w,h]=p;
    const cut=gaps.filter(([,end])=>y>=end).reduce((s,g)=>s+g[2],0);
    out[seat]=[x-minX+12,y-minY+62-cut,w,h];
  }
  return out;
}

async function initHallPage(){
  const app=document.querySelector('[data-hall-app]');
  if(!app) return;
  const base=app.dataset.base || '../../';
  const hallFile=app.dataset.hallFile || 'hyper-arrow-mihara.json';
  const posFile=app.dataset.positionFile || 'positions-mihara.json';
  const [hallRes,posRes]=await Promise.all([
    fetch(`${base}data/${hallFile}`,{cache:'no-store'}), fetch(`${base}data/${posFile}`,{cache:'no-store'})
  ]);
  if(!hallRes.ok || !posRes.ok) throw new Error('data load failed');
  const hall=await hallRes.json();
  const rawPositions=await posRes.json();
  const positions=compactPositions(rawPositions);
  let stats=null;
  const liveStatsUrl=`${base}data/live/${hall.id}-stats.json?v=${Date.now()}`;
  const statsCandidates=[liveStatsUrl,hall.stats_url].filter((u,i,a)=>u&&a.indexOf(u)===i);
  for(const url of statsCandidates){
    try{
      const statsRes=await fetch(url,{cache:'no-store'});
      if(statsRes.ok){
        const loaded=await statsRes.json();
        if(loaded?.seats && loaded?.hall_id===hall.id){stats=loaded;break}
      }
    }catch(err){console.warn('stats load failed',url,err)}
  }
  let seats=hall.seats.map(x=>({...x}));
  if(stats?.seats){
    seats=seats.map(x=>{const st=stats.seats[String(x.seat)];return st?.machine?{...x,machine:st.machine}:x});
  }
  const bySeat=new Map(seats.map(x=>[Number(x.seat),x]));
  const machineCount=new Map(); seats.forEach(x=>machineCount.set(x.machine,(machineCount.get(x.machine)||0)+1));
  const machineNames=[...machineCount.keys()].sort((a,b)=>a.localeCompare(b,'ja'));
  const svg=document.getElementById('floorMap');
  const resultBox=document.getElementById('resultSummary');
  const resultText=document.getElementById('resultText');
  const resultList=document.getElementById('resultList');
  const input=document.getElementById('machineSearch');
  const datalist=document.getElementById('machineNames');
  const modeButtons=[...document.querySelectorAll('[data-search-mode]')];
  const resultPrev=document.getElementById('resultPrev');
  const resultNext=document.getElementById('resultNext');
  const posValues=Object.values(positions);
  const mapW=Math.ceil(Math.max(...posValues.map(p=>p[0]+p[2]))+24);
  const mapH=Math.ceil(Math.max(...posValues.map(p=>p[1]+p[3]))+84);
  const full={x:0,y:0,w:mapW,h:mapH};
  let view={...full};
  let mode='machine',matches=[],selected=null,selectedIndex=-1;
  let sensorRotation=0;
  let flipped=localStorage.getItem(`floor777-orientation-${hall.id}`)==='180';
  let showNames=localStorage.getItem(`floor777-show-names-${hall.id}`)!=='0';
  let mapDisplay=localStorage.getItem(`floor777-map-display-${hall.id}`)||'seat';
  if(!['seat','diff','spins'].includes(mapDisplay))mapDisplay='seat';
  let showRecommendations=localStorage.getItem(`floor777-recommend-${hall.id}`)==='1';
  const recommendationRule=hall.recommendation||{method:'negative_top10',days:1,limit:10,label:'前日差枚マイナス上位10台'};
  function recommendationMetric(rec){
    const days=Number(recommendationRule.days||1);
    if(days===1)return rec?.latest?.diff;
    const p=rec?.periods?.[String(days)];
    return p?.complete?p.diff_sum:null;
  }
  const recommendedRows=Object.entries(stats?.seats||{})
    .map(([seat,rec])=>({seat:Number(seat),value:recommendationMetric(rec),rec}))
    .filter(x=>Number.isFinite(Number(x.value))&&Number(x.value)<0)
    .sort((a,b)=>Number(a.value)-Number(b.value))
    .slice(0,Number(recommendationRule.limit||10));
  const recommendedSeats=new Set(recommendedRows.map(x=>x.seat));

  Floor777.addRecent(hall.id);
  document.getElementById('hallUpdated').textContent=Floor777.formatDate(hall.layout_updated_at || hall.updated_at);
  const mu=document.getElementById('machineUpdated'); if(mu) mu.textContent=Floor777.formatDate(hall.machine_updated_at || hall.updated_at);
  document.getElementById('seatCount').textContent=Number(hall.seat_count).toLocaleString('ja-JP');
  document.getElementById('machineCount').textContent=machineNames.length.toLocaleString('ja-JP');
  document.getElementById('sourceName').textContent=hall.source.name;
  document.getElementById('sourceLink').href=hall.source.url;
  document.getElementById('sourceDate').textContent=Floor777.formatDate(stats?.latest_date || hall.machine_updated_at || hall.updated_at);
  const statsBadge=document.getElementById('statsBadge');
  if(stats?.latest_date){statsBadge.textContent=`台データ ${Floor777.formatDate(stats.latest_date)}`;statsBadge.classList.add('live');const mu2=document.getElementById('machineUpdated');if(mu2)mu2.textContent=Floor777.formatDate(stats.latest_date);if(stats.source?.name)document.getElementById('sourceName').textContent=stats.source.name;if(stats.source?.url)document.getElementById('sourceLink').href=stats.report_urls?.[stats.latest_date]||stats.source.url}
  else{statsBadge.textContent='台データ同期前';statsBadge.classList.add('warn')}
  datalist.innerHTML=machineNames.map(n=>`<option value="${escapeHtml(n)}"></option>`).join('');

  const favoriteBtn=document.getElementById('favoriteBtn');
  const updateFavorite=()=>{const fav=Floor777.isFavorite(hall.id);favoriteBtn.classList.toggle('active',fav);favoriteBtn.setAttribute('aria-pressed',String(fav));favoriteBtn.querySelector('[data-favorite-icon]').textContent=fav?'★':'☆';favoriteBtn.querySelector('[data-favorite-label]').textContent=fav?'お気に入り済み':'お気に入り'};
  favoriteBtn.addEventListener('click',()=>{const state=Floor777.toggleFavorite(hall.id);updateFavorite();Floor777.toast(state?'お気に入りに追加しました':'お気に入りから外しました')});updateFavorite();
  document.getElementById('shareBtn').addEventListener('click',async()=>{const ok=await Floor777.share({title:`${hall.name} 島図 | FLOOR777`,text:`${hall.name}の島図`,url:location.href});if(ok)Floor777.toast(navigator.share?'共有しました':'URLをコピーしました')});

  const NS='http://www.w3.org/2000/svg';
  function orientedPosition(p){
    const [x,y,w,h]=p;
    return flipped ? [full.w-(x+w),full.h-(y+h),w,h] : [x,y,w,h];
  }
  function renderMap(){
    svg.innerHTML='';
    svg.setAttribute('viewBox',`${full.x} ${full.y} ${full.w} ${full.h}`);
    const mapContent=document.createElementNS(NS,'g');mapContent.setAttribute('id','mapContent');svg.appendChild(mapContent);
    const bg=document.createElementNS(NS,'rect');bg.setAttribute('x','3');bg.setAttribute('y','3');bg.setAttribute('width',full.w-6);bg.setAttribute('height',full.h-6);bg.setAttribute('rx','18');bg.setAttribute('class','floor-bg');mapContent.appendChild(bg);
    const label=document.createElementNS(NS,'text');label.setAttribute('x','20');label.setAttribute('y','35');label.setAttribute('class','floor-label');label.textContent=`${hall.name} / ${flipped?'180°表示':'標準表示'}`;mapContent.appendChild(label);
    for(const item of seats){
      const raw=positions[String(item.seat)]; if(!raw) continue;
      const [x,y,w,h]=orientedPosition(raw);
      const rec=stats?.seats?.[String(item.seat)];
      const g=document.createElementNS(NS,'g');g.setAttribute('class','seat');g.dataset.seat=item.seat;g.dataset.machine=item.machine;g.setAttribute('role','button');g.setAttribute('tabindex','0');g.setAttribute('aria-label',`${item.seat}番台 ${item.machine}`);
      const r=document.createElementNS(NS,'rect');r.setAttribute('x',x);r.setAttribute('y',y);r.setAttribute('width',w);r.setAttribute('height',h);r.setAttribute('rx','3');
      const seatText=document.createElementNS(NS,'text');seatText.setAttribute('x',x+w/2);seatText.setAttribute('y',y+10);seatText.setAttribute('class','seat-number');
      seatText.textContent=mapDisplay==='diff'?mapValue(rec?.latest?.diff,'diff'):mapDisplay==='spins'?mapValue(rec?.latest?.spins,'spins'):item.seat;
      const nameText=document.createElementNS(NS,'text');nameText.setAttribute('x',x+w/2);nameText.setAttribute('y',y+27);nameText.setAttribute('class','seat-machine');nameText.textContent=shortName(item.machine).slice(0,7);nameText.style.display=showNames?'':'none';
      if(mapDisplay==='diff'&&Number.isFinite(Number(rec?.latest?.diff))){
        const d=Number(rec.latest.diff);
        g.classList.add(d>=4000?'diff-p4000':d>=3000?'diff-p3000':d>=2000?'diff-p2000':d>=1000?'diff-p1000':d>0?'diff-positive':d===0?'diff-zero':'diff-negative');
      }
      g.append(r,seatText,nameText);
      if(showRecommendations&&recommendedSeats.has(Number(item.seat))){
        g.classList.add('recommended');
        const star=document.createElementNS(NS,'text');star.setAttribute('x',x+w-5);star.setAttribute('y',y+7);star.setAttribute('class','recommend-star');star.textContent='★';g.appendChild(star);
      }
      mapContent.appendChild(g);
      g.addEventListener('click',()=>{if(!moved)selectSeat(item.seat,true,true)});g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectSeat(item.seat,true,true)}});
    }
    applySensorRotationToMap();
    applyClasses();
  }

  function rotatedBounds(angle=sensorRotation){
    const rad=angle*Math.PI/180,c=Math.abs(Math.cos(rad)),s=Math.abs(Math.sin(rad));
    const w=full.w*c+full.h*s,h=full.w*s+full.h*c,cx=full.x+full.w/2,cy=full.y+full.h/2;
    return{x:cx-w/2,y:cy-h/2,w,h};
  }
  function applySensorRotationToMap(){
    const g=svg.querySelector('#mapContent');if(!g)return;
    const cx=full.x+full.w/2,cy=full.y+full.h/2;
    g.setAttribute('transform',Math.abs(sensorRotation)>.01?`rotate(${sensorRotation} ${cx} ${cy})`:'');
  }
  function rotatePoint(x,y,angle=sensorRotation){
    if(Math.abs(angle)<.01)return{x,y};
    const cx=full.x+full.w/2,cy=full.y+full.h/2,rad=angle*Math.PI/180,co=Math.cos(rad),si=Math.sin(rad),dx=x-cx,dy=y-cy;
    return{x:cx+dx*co-dy*si,y:cy+dx*si+dy*co};
  }
  function rotatedPosition(p){
    const [x,y,w,h]=p,center=rotatePoint(x+w/2,y+h/2);
    return[center.x-w/2,center.y-h/2,w,h];
  }
  function clampView(v){
    const bounds=rotatedBounds();
    const w=Math.max(250,Math.min(bounds.w,v.w)),h=Math.max(220,Math.min(bounds.h,v.h));
    return{x:Math.max(bounds.x,Math.min(bounds.x+bounds.w-w,v.x)),y:Math.max(bounds.y,Math.min(bounds.y+bounds.h-h,v.y)),w,h};
  }
  function setView(v){view=clampView(v);svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`)}
  function fullMap(){setView(rotatedBounds())}
  function focusSeats(list){
    const ps=list.map(s=>positions[String(s)]).filter(Boolean).map(orientedPosition).map(rotatedPosition);if(!ps.length){fullMap();return}
    const minX=Math.min(...ps.map(p=>p[0])),maxX=Math.max(...ps.map(p=>p[0]+p[2])),minY=Math.min(...ps.map(p=>p[1])),maxY=Math.max(...ps.map(p=>p[1]+p[3]));
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2;let w=Math.max(430,(maxX-minX)+340),h=Math.max(360,(maxY-minY)+300);const aspect=svg.clientWidth/Math.max(1,svg.clientHeight);if(w/h<aspect)w=h*aspect;else h=w/aspect;w=Math.min(w,full.w);h=Math.min(h,full.h);setView({x:cx-w/2,y:cy-h/2,w,h});
  }
  function zoomAt(factor,cx=view.x+view.w/2,cy=view.y+view.h/2){const w=view.w/factor,h=view.h/factor,rx=(cx-view.x)/view.w,ry=(cy-view.y)/view.h;setView({x:cx-w*rx,y:cy-h*ry,w,h})}
  document.getElementById('mapFull').addEventListener('click',fullMap);document.getElementById('zoomIn').addEventListener('click',()=>zoomAt(1.35));document.getElementById('zoomOut').addEventListener('click',()=>zoomAt(.74));
  const orientationBtn=document.getElementById('orientationBtn');
  const updateOrientationLabel=()=>{orientationBtn.textContent=flipped?'↺ 標準':'↻ 180°';orientationBtn.title=flipped?'標準の向きに戻す':'島図を180度回転'};updateOrientationLabel();
  function applyFlip(next,announce=''){
    if(next===flipped)return;
    const old={...view};
    flipped=next;
    localStorage.setItem(`floor777-orientation-${hall.id}`,flipped?'180':'0');
    renderMap();
    setView({x:full.w-(old.x+old.w),y:full.h-(old.y+old.h),w:old.w,h:old.h});
    updateOrientationLabel();
    if(announce)Floor777.toast(announce);
  }
  orientationBtn.addEventListener('click',()=>{
    applyFlip(!flipped,flipped?'標準表示に戻しました':'島図を180°表示にしました');
    if(phoneOrientationOn&&currentHeading!==null){phoneBaseHeading=currentHeading;setSensorRotation(0,false);updatePhoneOrientationUI('この向きを新しい基準にしました')}
  });

  const pdfBtn=document.getElementById('pdfBtn');
  const clearPrintMode=()=>document.body.classList.remove('print-map');
  window.addEventListener('afterprint',clearPrintMode);
  pdfBtn?.addEventListener('click',()=>{
    document.body.classList.add('print-map');
    Floor777.toast('印刷画面から「PDFとして保存」を選べます');
    setTimeout(()=>window.print(),120);
    setTimeout(clearPrintMode,60000);
  });

  const phoneOrientationBtn=document.getElementById('phoneOrientationBtn');
  const phoneOrientationStatus=document.getElementById('phoneOrientationStatus');
  let phoneOrientationOn=false,phoneBaseHeading=null,lastHeadingAt=0,currentHeading=null,rotationFrame=0;
  function headingFromEvent(e){
    if(Number.isFinite(Number(e.webkitCompassHeading)))return (Number(e.webkitCompassHeading)+360)%360;
    if(Number.isFinite(Number(e.alpha)))return (360-Number(e.alpha)+360)%360;
    return null;
  }
  function normalizeAngle(v){return ((v+540)%360)-180}
  function smoothAngle(current,target,factor=.24){return normalizeAngle(current+normalizeAngle(target-current)*factor)}
  function updatePhoneOrientationUI(text=''){
    if(!phoneOrientationBtn)return;
    phoneOrientationBtn.classList.toggle('active',phoneOrientationOn);
    phoneOrientationBtn.textContent=phoneOrientationOn?'🧭 自動回転 ON':'🧭 自動回転';
    if(phoneOrientationStatus)phoneOrientationStatus.textContent=text||(phoneOrientationOn?'方角を取得中…':'自動回転 OFF');
  }
  function setSensorRotation(next,keepZoom=true){
    const oldBounds=rotatedBounds(sensorRotation);
    const wasFull=view.w>=oldBounds.w*.97&&view.h>=oldBounds.h*.97;
    sensorRotation=normalizeAngle(next);
    applySensorRotationToMap();
    if(wasFull||!keepZoom)fullMap();else setView(view);
  }
  function scheduleSensorRotation(target){
    sensorRotation=smoothAngle(sensorRotation,target);
    if(rotationFrame)return;
    rotationFrame=requestAnimationFrame(()=>{rotationFrame=0;setSensorRotation(sensorRotation)});
  }
  function handlePhoneOrientation(e){
    if(!phoneOrientationOn)return;
    const heading=headingFromEvent(e);if(heading===null)return;
    currentHeading=heading;lastHeadingAt=Date.now();
    if(phoneBaseHeading===null){
      phoneBaseHeading=heading;setSensorRotation(0,false);
      if(phoneOrientationStatus)phoneOrientationStatus.textContent='今の向きを基準にしました';
      return;
    }
    if(typeof pointers!=='undefined'&&pointers.size)return;
    const delta=normalizeAngle(heading-phoneBaseHeading);
    scheduleSensorRotation(-delta);
    if(phoneOrientationStatus)phoneOrientationStatus.textContent=`自動回転 ${Math.round(sensorRotation)}°`;
  }
  function stopPhoneOrientation(){
    phoneOrientationOn=false;phoneBaseHeading=null;currentHeading=null;
    window.removeEventListener('deviceorientationabsolute',handlePhoneOrientation,true);
    window.removeEventListener('deviceorientation',handlePhoneOrientation,true);
    setSensorRotation(0,false);updatePhoneOrientationUI();
  }
  async function startPhoneOrientation(){
    if(typeof DeviceOrientationEvent==='undefined'){Floor777.toast('この端末では自動回転を利用できません');return}
    try{
      if(typeof DeviceOrientationEvent.requestPermission==='function'){
        const result=await DeviceOrientationEvent.requestPermission();
        if(result!=='granted'){Floor777.toast('方角センサーの利用が許可されませんでした');return}
      }
    }catch(err){Floor777.toast('方角センサーの許可を取得できませんでした');return}
    phoneOrientationOn=true;phoneBaseHeading=null;currentHeading=null;lastHeadingAt=0;setSensorRotation(0,false);
    window.addEventListener('deviceorientationabsolute',handlePhoneOrientation,true);
    window.addEventListener('deviceorientation',handlePhoneOrientation,true);
    updatePhoneOrientationUI('今の島図が店内の向きと合う状態で基準設定中…');
    setTimeout(()=>{if(phoneOrientationOn&&!lastHeadingAt)Floor777.toast('端末の「動作と方向」センサーを確認してください')},1800);
  }
  phoneOrientationBtn?.addEventListener('click',()=>phoneOrientationOn?stopPhoneOrientation():startPhoneOrientation());
  updatePhoneOrientationUI();

  const namesBtn=document.getElementById('namesBtn');
  const updateNamesLabel=()=>{namesBtn.classList.toggle('active',showNames);namesBtn.textContent=showNames?'機種名 ON':'機種名 OFF'};updateNamesLabel();
  namesBtn.addEventListener('click',()=>{showNames=!showNames;localStorage.setItem(`floor777-show-names-${hall.id}`,showNames?'1':'0');svg.querySelectorAll('.seat-machine').forEach(x=>x.style.display=showNames?'':'none');updateNamesLabel()});

  const mapValueButtons=[...document.querySelectorAll('[data-map-value]')];
  function updateMapValueButtons(){mapValueButtons.forEach(btn=>btn.classList.toggle('active',btn.dataset.mapValue===mapDisplay))}
  mapValueButtons.forEach(btn=>btn.addEventListener('click',()=>{mapDisplay=btn.dataset.mapValue;localStorage.setItem(`floor777-map-display-${hall.id}`,mapDisplay);updateMapValueButtons();renderMap();setView(view)}));updateMapValueButtons();
  const recommendBtn=document.getElementById('recommendBtn');
  const recommendInfo=document.getElementById('recommendInfo');
  function updateRecommendUI(){
    if(!recommendBtn)return;
    recommendBtn.disabled=!stats||recommendedSeats.size===0;
    recommendBtn.classList.toggle('active',showRecommendations);
    recommendBtn.textContent=showRecommendations?'★ おすすめ ON':'☆ おすすめ OFF';
    if(recommendInfo)recommendInfo.textContent=stats?`${recommendationRule.label||'おすすめ台'}：${recommendedSeats.size}台`:'台データ同期後に利用できます';
  }
  recommendBtn?.addEventListener('click',()=>{showRecommendations=!showRecommendations;localStorage.setItem(`floor777-recommend-${hall.id}`,showRecommendations?'1':'0');updateRecommendUI();renderMap();setView(view)});updateRecommendUI();

  let dragging=false,lastPoint=null,downPoint=null,moved=false,pinch=null;
  const pointers=new Map();
  function pointerValues(){return [...pointers.values()]}
  function screenToMap(x,y){
    const g=svg.querySelector('#mapContent'),m=g?.getScreenCTM?.();if(!m)return null;
    try{const pt=svg.createSVGPoint();pt.x=x;pt.y=y;return pt.matrixTransform(m.inverse())}catch{return null}
  }
  function beginPinch(){
    const pts=pointerValues();if(pts.length<2)return;
    const a=pts[0],b=pts[1],cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,anchor=screenToMap(cx,cy);
    const start={...view};
    pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),startView:start,rx:anchor?(anchor.x-start.x)/start.w:.5,ry:anchor?(anchor.y-start.y)/start.h:.5};
    dragging=false;lastPoint=null;downPoint=null;moved=true;
  }
  svg.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    svg.setPointerCapture?.(e.pointerId);
    if(pointers.size===1){dragging=true;moved=false;downPoint={x:e.clientX,y:e.clientY};lastPoint={x:e.clientX,y:e.clientY};pinch=null}
    else beginPinch();
  });
  svg.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size>=2){
      const pts=pointerValues(),a=pts[0],b=pts[1];
      if(!pinch)beginPinch();
      const dist=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));
      const factor=dist/Math.max(1,pinch.distance);
      const start=pinch.startView,w=start.w/factor,h=start.h/factor;
      const anchorX=start.x+start.w*pinch.rx,anchorY=start.y+start.h*pinch.ry;
      setView({x:anchorX-w*pinch.rx,y:anchorY-h*pinch.ry,w,h});
      moved=true;return;
    }
    if(!dragging||!lastPoint)return;
    const dx=e.clientX-lastPoint.x,dy=e.clientY-lastPoint.y;
    if(downPoint&&Math.hypot(e.clientX-downPoint.x,e.clientY-downPoint.y)>10)moved=true;
    const prev=screenToMap(lastPoint.x,lastPoint.y),cur=screenToMap(e.clientX,e.clientY);
    if(prev&&cur)setView({x:view.x+(prev.x-cur.x),y:view.y+(prev.y-cur.y),w:view.w,h:view.h});
    lastPoint={x:e.clientX,y:e.clientY};
  });
  function endPointer(e){
    pointers.delete(e.pointerId);
    if(pointers.size>=2){beginPinch();return}
    pinch=null;
    if(pointers.size===1){
      const p=pointerValues()[0];dragging=true;lastPoint={...p};downPoint={...p};moved=true;
    }else{dragging=false;lastPoint=null;downPoint=null}
  }
  svg.addEventListener('pointerup',endPointer);svg.addEventListener('pointercancel',endPointer);
  svg.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')endPointer(e)});
  svg.addEventListener('wheel',e=>{e.preventDefault();const p=screenToMap(e.clientX,e.clientY);zoomAt(e.deltaY<0?1.18:.84,p?.x??view.x+view.w/2,p?.y??view.y+view.h/2)},{passive:false});

  function applyClasses(){const matchSet=new Set(matches);svg.querySelectorAll('.seat').forEach(g=>{const n=Number(g.dataset.seat);g.classList.toggle('match',matchSet.has(n));g.classList.toggle('selected',selected===n)})}
  function updateURL(){const url=new URL(location.href);url.search='';const q=input.value.trim();if(q){url.searchParams.set('mode',mode);url.searchParams.set('q',q)}if(selected)url.searchParams.set('seat',selected);history.replaceState(null,'',url)}
  function renderSeatStats(seat){
    const status=document.getElementById('detailStatsStatus'),box=document.getElementById('detailStats');
    const rec=stats?.seats?.[String(seat)];
    if(!rec){status.hidden=false;status.textContent=stats?'この台の公開データはありません。':'台データはまだ同期されていません。';box.hidden=true;return}
    status.hidden=true;box.hidden=false;
    const put=(id,value,cls='')=>{const el=document.getElementById(id);el.textContent=value;el.className=cls};
    put('statLatestDiff',fmtNumber(rec.latest?.diff,true,'枚'),diffClass(rec.latest?.diff));
    put('statLatestSpins',fmtNumber(rec.latest?.spins,false,'G'));
    put('stat3Diff',fmtNumber(rec.periods?.['3']?.diff_sum,true,'枚'),diffClass(rec.periods?.['3']?.diff_sum));
    put('stat3Spins',fmtNumber(rec.periods?.['3']?.avg_spins,false,'G'));
    put('stat7Diff',fmtNumber(rec.periods?.['7']?.diff_sum,true,'枚'),diffClass(rec.periods?.['7']?.diff_sum));
    put('stat7Spins',fmtNumber(rec.periods?.['7']?.avg_spins,false,'G'));
    document.getElementById('statsLatestDate').textContent=Floor777.formatDate(rec.latest?.date||stats.latest_date);
    const src=document.getElementById('statsSourceLink');src.textContent=stats.source?.name||hall.stats_source?.name||'出典';src.href=stats.report_urls?.[rec.latest?.date||stats.latest_date]||stats.source?.url||hall.stats_source?.url||hall.source.url;
    document.getElementById('statsGeneratedAt').textContent=stats.generated_at?`同期 ${new Date(stats.generated_at).toLocaleString('ja-JP')}`:'';
    document.getElementById('detailHistory').innerHTML=(rec.history||[]).map(r=>`<tr><td>${escapeHtml(shortDate(r.date))}</td><td class="${diffClass(r.diff)}">${fmtNumber(r.diff,true,'枚')}</td><td>${fmtNumber(r.spins,false,'G')}</td></tr>`).join('');
  }
  function selectSeat(seat,focus=false,update=true){const item=bySeat.get(Number(seat));if(!item)return;selected=item.seat;selectedIndex=Math.max(0,matches.indexOf(selected));applyClasses();document.getElementById('detailSeat').textContent=`${item.seat}番台`;document.getElementById('detailMachine').textContent=item.machine;document.getElementById('detailShort').textContent=shortName(item.machine);document.getElementById('detailEmpty').hidden=true;document.getElementById('detailData').hidden=false;renderSeatStats(item.seat);if(focus)focusSeats([item.seat]);updateNavButtons();if(update)updateURL()}
  function updateNavButtons(){const multi=matches.length>1;resultPrev.disabled=!multi;resultNext.disabled=!multi;document.getElementById('resultPos').textContent=matches.length?`${selectedIndex+1} / ${matches.length}`:'0 / 0'}
  function cycle(step){if(!matches.length)return;selectedIndex=(selectedIndex+step+matches.length)%matches.length;selectSeat(matches[selectedIndex],true,true)}resultPrev.addEventListener('click',()=>cycle(-1));resultNext.addEventListener('click',()=>cycle(1));

  function runSearch(focus=true){
    const q=input.value.trim();matches=[];selected=null;selectedIndex=-1;document.getElementById('detailEmpty').hidden=false;document.getElementById('detailData').hidden=true;
    if(!q){resultBox.classList.remove('show');applyClasses();fullMap();updateURL();return}
    if(mode==='seat'){
      const n=Number(q.replace(/[^0-9]/g,''));if(bySeat.has(n))matches=[n];
    }else{
      const nq=normalize(q);matches=seats.filter(x=>normalize(x.machine).includes(nq)).map(x=>Number(x.seat));
    }
    resultBox.classList.add('show');resultText.innerHTML=matches.length?`<strong>${escapeHtml(q)}</strong>：${matches.length}台見つかりました`:`<strong>${escapeHtml(q)}</strong>：該当台が見つかりません`;
    resultList.innerHTML=matches.slice(0,80).map(n=>`<button class="seat-pill" data-seat="${n}">${n}</button>`).join('')+(matches.length>80?`<span class="muted">ほか${matches.length-80}台</span>`:'');
    resultList.querySelectorAll('[data-seat]').forEach(b=>b.addEventListener('click',()=>selectSeat(Number(b.dataset.seat),true,true)));
    if(matches.length){selectedIndex=0;selected=matches[0];if(focus)focusSeats(matches.length<=12?matches:[matches[0]]);selectSeat(matches[0],false,false)}else fullMap();
    applyClasses();updateNavButtons();updateURL();
  }
  modeButtons.forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.searchMode;modeButtons.forEach(x=>x.classList.toggle('active',x===btn));input.placeholder=mode==='seat'?'例：821':'例：東京喰種 / モンキー / 北斗';input.value='';matches=[];selected=null;resultBox.classList.remove('show');applyClasses();fullMap();input.focus()}));
  document.getElementById('searchBtn').addEventListener('click',()=>runSearch(true));input.addEventListener('keydown',e=>{if(e.key==='Enter')runSearch(true)});document.getElementById('clearBtn').addEventListener('click',()=>{input.value='';runSearch(false);input.focus()});document.querySelectorAll('[data-quick]').forEach(b=>b.addEventListener('click',()=>{mode='machine';modeButtons.forEach(x=>x.classList.toggle('active',x.dataset.searchMode==='machine'));input.value=b.dataset.quick;runSearch(true)}));

  const recommendedList=document.getElementById('recommendedList');
  const recommendedRuleText=document.getElementById('recommendedRuleText');
  if(recommendedRuleText)recommendedRuleText.textContent=recommendationRule.label||'おすすめ候補';
  if(recommendedList){
    recommendedList.innerHTML=recommendedRows.length?recommendedRows.map((row,index)=>{
      const rec=row.rec||{};
      const machine=rec.machine||bySeat.get(row.seat)?.machine||'機種不明';
      const latestDiff=rec.latest?.diff;
      const latestSpins=rec.latest?.spins;
      const d3=rec.periods?.['3']?.diff_sum;
      const d7=rec.periods?.['7']?.diff_sum;
      return `<button class="recommended-row" type="button" data-recommend-seat="${row.seat}">
        <span class="recommend-rank">${index+1}</span>
        <span class="recommend-main"><strong>${row.seat}番台</strong><small>${escapeHtml(shortName(machine))}</small></span>
        <span class="recommend-metrics">
          <span class="recommend-metric"><em>前日</em><b class="${diffClass(latestDiff)}">${fmtNumber(latestDiff,true,'枚')}</b><small>${fmtNumber(latestSpins,false,'G')}</small></span>
          <span class="recommend-metric"><em>3日合計</em><b class="${diffClass(d3)}">${fmtNumber(d3,true,'枚')}</b></span>
          <span class="recommend-metric"><em>7日合計</em><b class="${diffClass(d7)}">${fmtNumber(d7,true,'枚')}</b></span>
        </span>
      </button>`;
    }).join(''):'<div class="empty-state compact">おすすめ候補を作れる台データがまだありません。</div>';
    recommendedList.querySelectorAll('[data-recommend-seat]').forEach(btn=>btn.addEventListener('click',()=>{
      const seat=Number(btn.dataset.recommendSeat);
      showRecommendations=true;
      localStorage.setItem(`floor777-recommend-${hall.id}`,'1');
      updateRecommendUI();
      renderMap();
      selectSeat(seat,true,true);
      document.querySelector('.map-card')?.scrollIntoView({behavior:'smooth',block:'start'});
    }));
  }

  document.getElementById('machineList').innerHTML=[...machineCount.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ja')).map(([name,count])=>`<button class="machine-row" type="button" data-machine="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><b>${count}台</b></button>`).join('');
  document.querySelectorAll('[data-machine]').forEach(b=>b.addEventListener('click',()=>{mode='machine';modeButtons.forEach(x=>x.classList.toggle('active',x.dataset.searchMode==='machine'));input.value=b.dataset.machine;document.getElementById('searchCard').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>runSearch(true),220)}));

  renderMap(); fullMap();
  const params=new URLSearchParams(location.search);if(params.get('mode')==='seat'){mode='seat';modeButtons.forEach(x=>x.classList.toggle('active',x.dataset.searchMode==='seat'));input.placeholder='例：821'}if(params.get('q')){input.value=params.get('q');runSearch(true)}if(params.get('seat'))selectSeat(Number(params.get('seat')),true,false);
}
initHallPage().catch(err=>{console.error(err);const el=document.getElementById('loadError');if(el)el.hidden=false});
