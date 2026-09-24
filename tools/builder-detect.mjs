// Trace the centerline of colored/dark bands. Seat counts remain provisional.
// No network calls, OCR, file-name presets or source-image upload.
const around=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function family(r,g,b,a){
 if(a<128)return 0;
 const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
 if(hi<85&&delta<45)return 7;
 if(delta<48||hi<65)return 0;
 let h=hi===r?(g-b)/delta:hi===g?2+(b-r)/delta:4+(r-g)/delta;
 h=(h*60+360)%360;
 return h<28||h>=345?1:h<78?2:h<165?3:h<205?4:h<265?5:6;
}
function open(mask,w,h){
 const eroded=new Uint8Array(mask.length),out=new Uint8Array(mask.length);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;let all=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!mask[p+dy*w+dx])all=false;if(all)eroded[p]=1;}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if(eroded[p])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)out[p+dy*w+dx]=1;}
 return out;
}
function fillSmallHoles(m,w,h,maxArea){
 const seen=new Uint8Array(m.length),q=new Int32Array(m.length);
 for(let p=0;p<m.length;p++)if(!m[p]&&!seen[p]){
  let head=0,tail=1,edge=false;q[0]=p;seen[p]=1;
  while(head<tail){const k=q[head++],x=k%w,y=(k/w)|0;if(x===0||y===0||x===w-1||y===h-1)edge=true;
   for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const xx=x+dx,yy=y+dy,t=yy*w+xx;if(xx>=0&&yy>=0&&xx<w&&yy<h&&!m[t]&&!seen[t]){seen[t]=1;q[tail++]=t;}}
  }
  if(!edge&&tail<=maxArea)for(let j=0;j<tail;j++)m[q[j]]=1;
 }
}
function thin(mask,w,h){
 const m=mask.slice();let changed=true,iterations=0;
 while(changed&&iterations++<90){changed=false;
  for(let pass=0;pass<2;pass++){const del=[];
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if(!m[p])continue;
    const n=[m[p-w],m[p-w+1],m[p+1],m[p+w+1],m[p+w],m[p+w-1],m[p-1],m[p-w-1]];
    const sum=n.reduce((a,b)=>a+b,0);if(sum<2||sum>6)continue;let transitions=0;for(let k=0;k<8;k++)if(!n[k]&&n[(k+1)%8])transitions++;if(transitions!==1)continue;
    if(pass===0?(n[0]*n[2]*n[4]||n[2]*n[4]*n[6]):(n[0]*n[2]*n[6]||n[0]*n[4]*n[6]))continue;del.push(p);
   }
   if(del.length)changed=true;for(const p of del)m[p]=0;
  }
 }
 return m;
}
function longestPath(m,w,h){
 const ids=[];for(let p=0;p<m.length;p++)if(m[p])ids.push(p);if(!ids.length)return [];
 function walk(start){const dist=new Int32Array(m.length).fill(-1),prev=new Int32Array(m.length).fill(-1),q=[start];dist[start]=0;let far=start;
  for(let j=0;j<q.length;j++){const p=q[j],x=p%w,y=(p/w)|0;if(dist[p]>dist[far])far=p;
   for(const[dx,dy]of around){const xx=x+dx,yy=y+dy,t=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||!m[t]||dist[t]>=0)continue;dist[t]=dist[p]+1;prev[t]=p;q.push(t);}
  }return {far,prev};
 }
 const a=walk(ids[0]).far,b=walk(a),path=[];for(let p=b.far;p!==-1;p=b.prev[p])path.push([p%w,(p/w)|0]);return path;
}
function resample(path,count){
 const ds=[0];for(let i=1;i<path.length;i++)ds.push(ds.at(-1)+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
 return Array.from({length:count},(_,i)=>{const d=ds.at(-1)*i/Math.max(1,count-1);let j=1;while(j<ds.length-1&&ds[j]<d)j++;const f=(d-ds[j-1])/(ds[j]-ds[j-1]||1);return [path[j-1][0]+(path[j][0]-path[j-1][0])*f,path[j-1][1]+(path[j][1]-path[j-1][1])*f];});
}
export function detectIslands({data,width:w,height:h},scale=1,options={}){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||w*h>1800000||data.length!==w*h*4||!(scale>0))throw Error('検出画像のサイズが不正です');
 const region=options.region||{x:0,y:0,width:w,height:h};
 const inside=(x,y)=>x>=region.x&&y>=region.y&&x<region.x+region.width&&y<region.y+region.height;
 const classes=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(inside(x,y))classes[p]=family(...data.subarray(p*4,p*4+4));}
 const result=[],minLength=options.minLength||Math.max(22,Math.min(w,h)*.045),minArea=options.minArea||40;
 for(let color=1;color<=7;color++){
  let mask=new Uint8Array(w*h);for(let p=0;p<mask.length;p++)mask[p]=classes[p]===color?1:0;
  mask=open(mask,w,h);const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  for(let seed=0;seed<mask.length;seed++)if(mask[seed]&&!seen[seed]){
   let head=0,tail=1,minX=w,minY=h,maxX=0,maxY=0;queue[0]=seed;seen[seed]=1;
   while(head<tail){const p=queue[head++],x=p%w,y=(p/w)|0;minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY);
    for(const[dx,dy]of around){const xx=x+dx,yy=y+dy,t=yy*w+xx;if(xx>=0&&yy>=0&&xx<w&&yy<h&&mask[t]&&!seen[t]){seen[t]=1;queue[tail++]=t;}}
   }
   const bw=maxX-minX+1,bh=maxY-minY+1;
   if(tail<minArea||Math.max(bw,bh)<minLength||Math.min(bw,bh)<4||tail>w*h*.14)continue;
   if(minX<2||minY<2||maxX>w-3||maxY>h-3)continue;
   if(bw>w*.5&&(minY<h*.12||maxY>h*.9))continue;
   const cw=bw+4,ch=bh+4,local=new Uint8Array(cw*ch);
   for(let i=0;i<tail;i++){const p=queue[i];local[(((p/w)|0)-minY+2)*cw+p%w-minX+2]=1;}
   fillSmallHoles(local,cw,ch,Math.min(160,tail*.09));
   const skeleton=thin(local,cw,ch);let path=longestPath(skeleton,cw,ch),closed=false;
   // Fit a smooth band from its area, so lettering cannot bend the seat row.
   const pixels=[];let sx=0,sy=0;
   for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(local[y*cw+x]){pixels.push([x,y]);sx+=x;sy+=y;}
   const mx=sx/pixels.length,my=sy/pixels.length;let aa=0,bb=0,ab=0,rx=0,ry=0;
   for(const[x,y]of pixels){const dx=x-mx,dy=y-my,r=dx*dx+dy*dy;aa+=dx*dx;bb+=dy*dy;ab+=dx*dy;rx+=dx*r/2;ry+=dy*r/2;}
   const determinant=aa*bb-ab*ab;let fitted=false;
   if(determinant>1){
    const ox=(rx*bb-ry*ab)/determinant,oy=(ry*aa-rx*ab)/determinant,cx=mx+ox,cy=my+oy;
    const radius=Math.sqrt((aa+bb)/pixels.length+ox*ox+oy*oy),angles=[];let error=0;
    for(const[x,y]of pixels){error+=(Math.hypot(x-cx,y-cy)-radius)**2;angles.push((Math.atan2(y-cy,x-cx)+Math.PI*2)%(Math.PI*2));}
    error=Math.sqrt(error/pixels.length)/radius;angles.sort((a,b)=>a-b);let gap=0,start=0;
    for(let j=0;j<angles.length;j++){const next=j===angles.length-1?angles[0]+Math.PI*2:angles[j+1];if(next-angles[j]>gap){gap=next-angles[j];start=next%(Math.PI*2);}}
    const sweep=Math.PI*2-gap;
    if(error<.17&&radius<Math.max(w,h)&&sweep>.65){
     closed=sweep>6.05;const extent=closed?Math.PI*2:sweep;
     const steps=Math.max(3,Math.ceil(radius*extent));path=Array.from({length:steps+1},(_,i)=>[cx+radius*Math.cos(start+extent*i/steps),cy+radius*Math.sin(start+extent*i/steps)]);fitted=true;
    }
   }
   const eigen=Math.sqrt((aa-bb)**2+4*ab*ab),ratio=(aa+bb-eigen)/Math.max(1,aa+bb+eigen);
   if(!fitted&&ratio<.1){
    const theta=.5*Math.atan2(2*ab,aa-bb),ux=Math.cos(theta),uy=Math.sin(theta);
    const projections=pixels.map(([x,y])=>(x-mx)*ux+(y-my)*uy).sort((a,b)=>a-b);
    const lo=projections[Math.floor(projections.length*.035)],hi=projections[Math.floor(projections.length*.965)];
    path=Array.from({length:Math.ceil(hi-lo)+1},(_,i)=>{const t=lo+(hi-lo)*i/Math.ceil(hi-lo);return[mx+t*ux,my+t*uy];});
   }
   // A closed ring has no endpoints. A graph diameter would retain only half.
   if(!fitted&&Math.max(bw,bh)/Math.min(bw,bh)<1.25){
    const cx=(bw-1)/2+2,cy=(bh-1)/2+2;let rs=0,r2=0,n=0;
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(local[y*cw+x]){const r=Math.hypot(x-cx,y-cy);rs+=r;r2+=r*r;n++;}
    const radius=rs/n,cv=Math.sqrt(Math.max(0,r2/n-radius*radius))/radius;
    if(cv<.25&&!local[Math.round(cy)*cw+Math.round(cx)]){
     const bins=new Set();for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(local[y*cw+x])bins.add(Math.floor((Math.atan2(y-cy,x-cx)+Math.PI)*18/Math.PI));
     if(bins.size>=35){closed=true;path=Array.from({length:Math.ceil(radius*2*Math.PI)+1},(_,i)=>{const a=2*Math.PI*i/Math.ceil(radius*2*Math.PI);return [cx+radius*Math.cos(a),cy+radius*Math.sin(a)];});}
    }
   }
   if(path.length<minLength)continue;
   let length=0;for(let i=1;i<path.length;i++)length+=Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]);
   const thickness=tail/Math.max(1,length);
   options.debug?.push({color,minX,minY,bw,bh,tail,length,thickness});
   if(thickness<3||thickness>Math.min(w,h)*.115||length/thickness<2.5)continue;
   // Reject labels/text: a usable band must have ink around its centerline.
   let support=0;const rr=Math.max(1,Math.floor(thickness*.22));
   for(const[fx,fy]of path){const x=Math.round(fx),y=Math.round(fy);let hit=0;for(const[dx,dy]of [[0,0],[rr,0],[-rr,0],[0,rr],[0,-rr]])if(local[(y+dy)*cw+x+dx])hit++;support+=hit/5;}
   support/=path.length;if(support<.65)continue;
   const size=Math.max(4,Math.min(26,thickness*.8))*scale,pitch=size*1.32;
   const count=Math.max(2,Math.min(150,Math.round(length*scale/pitch)+1));
   const sampled=resample(path,closed?count+1:count).slice(0,count).map(([x,y])=>[(x+minX-2)*scale,(y+minY-2)*scale]);
   if(sampled[0][1]>sampled.at(-1)[1]+size||Math.abs(sampled[0][1]-sampled.at(-1)[1])<size&&sampled[0][0]>sampled.at(-1)[0])sampled.reverse();
   const ps=sampled.map(([x,y])=>[Math.max(0,Math.min(w*scale-size,x-size/2)),Math.max(0,Math.min(h*scale-size,y-size/2)),size,size]);
   result.push({shape:'custom',closed,points:ps,x:ps[0][0],y:ps[0][1],count,size,pitch,angle:0,radius:100,sweep:120,numbers:[],confirmed:false,area:tail,confidence:support,source:'image-centerline',estimatedCount:true});
  }
 }
 // Keep overlapping color edges from becoming duplicate rows.
 const accepted=[];for(const c of result.sort((a,b)=>b.area-a.area)){
  const duplicate=accepted.some(a=>c.points.filter(p=>a.points.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<Math.min(p[2],q[2])*.6)).length>c.count*.6);
  if(!duplicate)accepted.push(c);
 }
 return accepted.slice(0,180).sort((a,b)=>a.y-b.y||a.x-b.x);
}
