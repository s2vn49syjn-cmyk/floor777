// Local color segmentation. Results are candidates, never confirmed seat counts.
export function detectIslands({data,width,height},scale=1,{saturation=45,minArea=45}={}){
 const n=width*height,mask=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n),out=[];
 for(let p=0;p<n;p++){const r=data[p*4],g=data[p*4+1],b=data[p*4+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);if(hi-lo>=saturation&&hi>60&&data[p*4+3]>128)mask[p]=1;}
 for(let seed=0;seed<n;seed++){
  if(!mask[seed]||seen[seed])continue;let head=0,tail=1;queue[0]=seed;seen[seed]=1;let sx=0,sy=0,sxx=0,syy=0,sxy=0,minX=width,maxX=0,minY=height,maxY=0;
  while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;const q=yy*width+xx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q;}}
  }
  const bw=maxX-minX+1,bh=maxY-minY+1;if(tail<minArea||bw<7||bh<7||bw*bh>n*.65)continue;
  const cx=sx/tail,cy=sy/tail,a=sxx/tail-cx*cx,b=syy/tail-cy*cy,c=sxy/tail-cx*cy,theta=.5*Math.atan2(2*c,a-b);
  const root=Math.sqrt((a-b)**2+4*c*c),major=(a+b+root)/2,minor=Math.max(1,(a+b-root)/2),ratio=major/minor;
  let lo=Infinity,hi=-Infinity,rad=0,rad2=0;const angles=[];
  for(let k=0;k<tail;k++){const x=queue[k]%width-cx,y=Math.floor(queue[k]/width)-cy,t=x*Math.cos(theta)+y*Math.sin(theta),r=Math.hypot(x,y);lo=Math.min(lo,t);hi=Math.max(hi,t);rad+=r;rad2+=r*r;angles.push((Math.atan2(y,x)+Math.PI*2)%(Math.PI*2));}
  rad/=tail;const cv=Math.sqrt(Math.max(0,rad2/tail-rad*rad))/Math.max(1,rad),size=Math.max(10,Math.min(32,Math.sqrt(minor)*1.4))*scale;
  const base={x:(cx+lo*Math.cos(theta))*scale,y:(cy+lo*Math.sin(theta))*scale,shape:'line',angle:theta*180/Math.PI,size,pitch:size*1.3,radius:rad*scale,sweep:120};
  // Fit a circle around the colored component to recognize open arcs too.
  // Centered least-squares circle: 2*a*dx + 2*b*dy + c = dx²+dy².
  let xxx=0,yyy=0,xxy=0,xyy=0;
  for(let k=0;k<tail;k++){const x=queue[k]%width-cx,y=Math.floor(queue[k]/width)-cy;xxx+=x*x*x;yyy+=y*y*y;xxy+=x*x*y;xyy+=x*y*y;}
  const det=a*b-c*c;
  let fitted=false;
  if(det>1){const rx=(xxx+xyy)/tail/2,ry=(xxy+yyy)/tail/2,ox=(rx*b-ry*c)/det,oy=(ry*a-rx*c)/det,R=Math.sqrt(a+b+ox*ox+oy*oy);let residual=0;const as=[];
   for(let k=0;k<tail;k++){const x=queue[k]%width-cx-ox,y=Math.floor(queue[k]/width)-cy-oy;residual+=(Math.hypot(x,y)-R)**2;as.push((Math.atan2(y,x)+Math.PI*2)%(Math.PI*2));}
   const err=Math.sqrt(residual/tail)/Math.max(1,R);as.sort((a,b)=>a-b);let gap=0,start=0;
   for(let k=0;k<as.length;k++){const next=k===as.length-1?as[0]+Math.PI*2:as[k+1],g=next-as[k];if(g>gap){gap=g;start=next%(Math.PI*2);}}
   const extent=360-gap*180/Math.PI;
   if(err<.14&&R<Math.max(width,height)*1.5&&extent>45&&extent<340){base.shape='arc';base.x=(cx+ox)*scale;base.y=(cy+oy)*scale;base.radius=R*scale;base.angle=start*180/Math.PI;base.sweep=extent;base.size=Math.max(8,Math.min(28,Math.sqrt(residual/tail)*1.5))*scale;base.pitch=base.size*1.4;base.count=Math.max(3,Math.round(R*scale*extent*Math.PI/180/base.pitch));fitted=true;}
  }
  if(fitted){}else if(ratio<2.1&&cv<.3){base.shape='circle';base.x=cx*scale;base.y=cy*scale;base.count=Math.max(4,Math.round(2*Math.PI*rad*scale/base.pitch));}
  else {base.count=Math.max(2,Math.round((hi-lo)*scale/base.pitch)+1);}
  base.count=Math.min(150,base.count);base.x=Math.max(size,base.x);base.y=Math.max(size,base.y);out.push({...base,confirmed:false,area:tail});
 }
 return out.sort((a,b)=>b.area-a.area).slice(0,150).sort((a,b)=>a.y-b.y||a.x-b.x);
}
