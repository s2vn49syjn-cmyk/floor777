export function expandLayout(d) {
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
