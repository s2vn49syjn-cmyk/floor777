// Turn a hand-drawn island centerline into evenly spaced seat rectangles.
export function seatsAlongStroke(stroke,count,size,width,height){
 if(!Array.isArray(stroke)||stroke.length<2||!Number.isInteger(count)||count<1||count>1000)throw Error('線を引いて台数を1〜1000で指定してください');
 if(!Number.isFinite(size)||size<4||size>300)throw Error('台サイズは4〜300で指定してください');
 const path=[stroke[0]],lengths=[0];
 for(const point of stroke.slice(1)){
  const prior=path.at(-1),distance=Math.hypot(point[0]-prior[0],point[1]-prior[1]);
  if(!Number.isFinite(distance)||distance<.01)continue;
  path.push(point);lengths.push(lengths.at(-1)+distance);
 }
 const total=lengths.at(-1);
 if(!Number.isFinite(total)||total<8)throw Error('島に沿って少し長めの線を引いてください');
 if(width<size||height<size)throw Error('台サイズが画像より大きすぎます');
 const centers=Array.from({length:count},(_,index)=>{
  const distance=total*(count===1?.5:index/(count-1));
  let segment=1;while(segment<lengths.length-1&&lengths[segment]<distance)segment++;
  const fraction=(distance-lengths[segment-1])/(lengths[segment]-lengths[segment-1]);
  const a=path[segment-1],b=path[segment];
  return [a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction];
 });
 return centers.map(([x,y])=>[Math.max(0,Math.min(width-size,x-size/2)),Math.max(0,Math.min(height-size,y-size/2)),size,size]);
}

export function suggestedDrawSize(stroke,count){
 const distance=stroke.slice(1).reduce((sum,p,index)=>sum+Math.hypot(p[0]-stroke[index][0],p[1]-stroke[index][1]),0);
 return Math.max(4,Math.min(28,Math.round(distance/Math.max(1,count-1)*.8)));
}

// Reduce pen jitter without moving the two chosen ends of the island.
export function smoothStroke(stroke,passes=2){
 let current=stroke.map(point=>[...point]);
 for(let pass=0;pass<passes&&current.length>2;pass++){
  current=current.map((point,index)=>index===0||index===current.length-1?point:[
   (current[index-1][0]+2*point[0]+current[index+1][0])/4,
   (current[index-1][1]+2*point[1]+current[index+1][1])/4,
  ]);
 }
 return current;
}

// A circular arc through start, mid and end. The mid-point determines which
// side of the circle is used, so a C-shaped bank retains its open gap.
export function arcThroughThreePoints(start,mid,end){
 const [ax,ay]=start,[bx,by]=mid,[cx,cy]=end;
 const denominator=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
 if(!Number.isFinite(denominator)||Math.abs(denominator)<.001)throw Error('3点がほぼ一直線です。途中の点を曲線側に置いてください');
 const aa=ax*ax+ay*ay,bb=bx*bx+by*by,cc=cx*cx+cy*cy;
 const ox=(aa*(by-cy)+bb*(cy-ay)+cc*(ay-by))/denominator;
 const oy=(aa*(cx-bx)+bb*(ax-cx)+cc*(bx-ax))/denominator;
 const radius=Math.hypot(ax-ox,ay-oy);
 if(!Number.isFinite(radius)||radius<4)throw Error('円弧が小さすぎます');
 const full=Math.PI*2,normal=value=>(value%full+full)%full;
 const a0=Math.atan2(ay-oy,ax-ox),am=Math.atan2(by-oy,bx-ox),a1=Math.atan2(cy-oy,cx-ox);
 const forward=normal(a1-a0),middle=normal(am-a0);
 const sweep=middle<=forward?forward:forward-full;
 if(Math.abs(sweep)<.05)throw Error('始点と終点を離して選んでください');
 const steps=Math.min(512,Math.max(32,Math.ceil(radius*Math.abs(sweep)/3)));
 const points=Array.from({length:steps+1},(_,index)=>{
  const angle=a0+sweep*index/steps;
  return [ox+radius*Math.cos(angle),oy+radius*Math.sin(angle)];
 });
 points[0]=[...start];points[points.length-1]=[...end];
 return points;
}
