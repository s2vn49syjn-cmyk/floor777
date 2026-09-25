function projectPoints(island) {
  if (island.shape === 'custom') return island.points.map(point => [...point]);
  const {x,y,count,size,pitch,angle,radius,sweep,shape} = island;
  return Array.from({length:count}, (_, index) => {
    const degrees=angle+(shape==='circle'?360*index/count:shape==='arc'?sweep*index/Math.max(1,count-1):0);
    const radians=degrees*Math.PI/180;
    return shape==='line'
      ? [x+Math.cos(radians)*pitch*index,y+Math.sin(radians)*pitch*index,size,size]
      : [x+radius*Math.cos(radians)-size/2,y+radius*Math.sin(radians)-size/2,size,size];
  });
}

function validateProject(project) {
  const errors=[], all=[], seen=new Set();
  let missing=0, unchecked=0;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id||'')) errors.push('店舗IDを半角英数字・ハイフンで入力してください');
  for (const [key,label] of [['name','店舗名'],['prefecture','都道府県'],['city','市区町村']]) if (!project[key]?.trim()) errors.push(`${label}が未入力です`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(project.layout_date||'') || !Number.isFinite(Date.parse(project.layout_date)) || new Date(project.layout_date).toISOString().slice(0,10)!==project.layout_date) errors.push('配置確認日が不正です');
  if (project.minrepo_url) {
    try {
      const url=new URL(project.minrepo_url);
      if (url.protocol!=='https:' || url.hostname!=='min-repo.com' || !url.pathname.startsWith('/tag/') || url.username || url.password) throw Error();
    } catch { errors.push('みんレポURLは https://min-repo.com/tag/…/ を指定してください'); }
  }
  if (!Number.isFinite(project.width) || !Number.isFinite(project.height) || project.width<100 || project.height<100 || project.width>20000 || project.height>20000) errors.push('キャンバスサイズが不正です');
  if (!Array.isArray(project.islands) || !project.islands.length) errors.push('島を追加してください');
  for (const island of project.islands||[]) {
    if (!['line','arc','circle','custom'].includes(island.shape) || !Number.isInteger(island.count) || island.count<1 || island.count>1000) { errors.push('島の形・台数が不正です'); continue; }
    if (!island.confirmed) unchecked++;
    let points=[];
    try { points=projectPoints(island); } catch { errors.push(`${island.name||'島'}の座標が不正です`); continue; }
    if (points.length!==island.count) errors.push(`${island.name||'島'}の座標数が台数と一致しません`);
    points.forEach((point,index) => {
      const number=island.numbers?.[index];
      if (!Number.isInteger(number) || number<1 || number>99999) missing++;
      else if (seen.has(number)) errors.push(`${number}番台が重複しています`);
      else seen.add(number);
      if (!Array.isArray(point) || point.length!==4 || !point.every(Number.isFinite) || point[0]<0 || point[1]<0 || point[2]<=0 || point[3]<=0 || point[0]+point[2]>project.width || point[1]+point[3]>project.height) errors.push(`${island.name||'島'}の${index+1}台目がキャンバス範囲外です`);
      all.push({point,label:number||`${island.name||'島'} #${index+1}`});
    });
  }
  if (missing) errors.push(`台番号未入力：${missing}台`);
  if (unchecked) errors.push(`配置・台数の確認待ち：${unchecked}島`);
  if (all.length>3000) errors.push('1店舗3000台までです');
  let overlaps=0;
  for (let i=0;i<all.length;i++) for (let j=i+1;j<all.length;j++) {
    const a=all[i].point,b=all[j].point;
    if (a[0]<b[0]+b[2]-.1 && a[0]+a[2]>b[0]+.1 && a[1]<b[1]+b[3]-.1 && a[1]+a[3]>b[1]+.1) {
      if (overlaps++<5) errors.push(`台が重なっています：${all[i].label} / ${all[j].label}`);
    }
  }
  if (overlaps>5) errors.push(`ほか${overlaps-5}件の重なり`);
  return [...new Set(errors)];
}

export function expandLayout(d) {
  if(d.version===2){
    const errors=validateProject(d);if(errors.length)throw Error(errors.join('\n'));
    const positions={},seats=[];
    for(const i of d.islands)projectPoints(i).forEach((p,k)=>{positions[i.numbers[k]]=p;seats.push({seat:i.numbers[k],machine:i.machine||'機種確認中'});});
    return {positions,seats};
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id || '')) throw Error('店舗IDは半角英数字とハイフンで入力してください');
  for (const k of ['name','prefecture','city']) if (typeof d[k] !== 'string' || !d[k].trim()) throw Error(`${k}が未入力です`);
  const u = new URL(d.minrepo_url);
  if (u.protocol !== 'https:' || u.hostname !== 'min-repo.com' || !u.pathname.startsWith('/tag/')) throw Error('みんレポの店舗URL（https://min-repo.com/tag/…/）を指定してください');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.layout_date || '') || !Number.isFinite(Date.parse(d.layout_date)) || new Date(d.layout_date).toISOString().slice(0,10)!==d.layout_date) throw Error('正しい配置確認日を入力してください');
  if (!Array.isArray(d.rows) || !d.rows.length) throw Error('台の列を追加してください');
  const positions = {}, seats = [];
  for (const row of d.rows) {
    const numbers = row.numbers;
    if (!Array.isArray(numbers) || !numbers.length) throw Error('台番号が空の列があります');
    if (numbers.length+seats.length>3000) throw Error('1店舗3000台までです');
    const {x,y,direction} = row;
    if (![x,y].every(v => Number.isFinite(v) && v >= 0 && v <= 20000)) throw Error('座標は0〜20000にしてください');
    if (!['right','left','down','up'].includes(direction)) throw Error('並ぶ方向が不正です');
    numbers.forEach((n,i) => {
      if (!Number.isSafeInteger(n) || n < 1 || n > 99999 || positions[n]) throw Error(`台番号が不正または重複しています：${n}`);
      const px=x+(direction==='right'?48*i:direction==='left'?-48*i:0);
      const py=y+(direction==='down'?48*i:direction==='up'?-48*i:0);
      if(px<0 || py<0 || px>20000 || py>20000) throw Error('台が範囲外に出ています。開始位置を調整してください');
      positions[n]=[px,py,44,44]; seats.push({seat:n,machine:row.machine?.trim() || '機種確認中'});
    });
  }
  if(seats.length>3000) throw Error('1店舗3000台までです');
  const entries=Object.entries(positions);
  for(let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++) {
    const [a,p]=entries[i], [b,q]=entries[j];
    if(Math.abs(p[0]-q[0])<44 && Math.abs(p[1]-q[1])<44) throw Error(`${a}番と${b}番の台が重なっています`);
  }
  return {positions,seats};
}
export function parseNumbers(value) {
  const result=[];
  for(const part of value.normalize('NFKC').split(/[,、\s]+/).filter(Boolean)) {
    const m=part.match(/^(\d+)(?:[-〜~](\d+))?$/);
    if(!m) throw Error('台番号は101-120、または101,102,105の形で入力してください');
    const start=Number(m[1]), end=Number(m[2] || m[1]), step=start<=end?1:-1;
    if(Math.abs(end-start)>3000) throw Error('台番号の範囲が大きすぎます');
    for(let n=start; ; n+=step) {result.push(n);if(n===end)break;}
  }
  return result;
}
