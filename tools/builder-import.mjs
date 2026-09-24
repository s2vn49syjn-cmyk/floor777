import {newProject,makeIsland,unifyGeneratedSeatSize} from './builder-model.mjs';

export async function readMapImage(file){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20000000)throw Error('20MB以下のPNG・JPEG・WebPを選んでください');
 const image=await createImageBitmap(file);
 try{
  const ratio=Math.min(1,2400/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  if(canvas.width<100||canvas.height<100)throw Error('縦横100px以上の島図画像を選んでください');
  let encoded=canvas.toDataURL('image/png');
  if(encoded.length>16000000)encoded=canvas.toDataURL('image/jpeg',.92);
  if(encoded.length>16000000)throw Error('画像を小さくして読み込み直してください');
  return {image:encoded,width:canvas.width,height:canvas.height};
 }finally{image.close()}
}

export async function generateRows(project,{signal}={}){
 const image=new Image();image.src=project.image;await image.decode();
 if(signal?.aborted)throw new DOMException('中止しました','AbortError');
 const ratio=Math.min(1,1000/Math.max(image.width,image.height)),w=Math.round(image.width*ratio),h=Math.round(image.height*ratio);
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
 const region=project.detectionRegion;
 const options=region?{region:{x:region.x*w/project.width,y:region.y*h/project.height,width:region.width*w/project.width,height:region.height*h/project.height}}:{};
 const worker=new Worker(new URL('./builder-worker.mjs',import.meta.url),{type:'module'});
 try{
  const rows=await new Promise((resolve,reject)=>{
   const abort=()=>finish(new DOMException('中止しました','AbortError'));
   const timer=setTimeout(()=>finish(Error('生成が時間切れになりました。範囲を絞って再実行してください')),30000);
   function finish(error,value){clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)}
   signal?.addEventListener('abort',abort,{once:true});
   worker.onmessage=e=>e.data.error?finish(Error(e.data.error)):finish(null,e.data.islands);
   worker.onerror=()=>finish(Error('画像解析を起動できませんでした'));
   worker.postMessage({image:ctx.getImageData(0,0,w,h),scale:1,options});
  });
  const sx=project.width/w,sy=project.height/h;
  if(rows.reduce((n,r)=>n+r.count,0)>3000)throw Error('候補が3000台を超えました。画像を個別に開き、生成範囲を絞ってください');
  const islands=rows.map((r,i)=>makeIsland({...r,name:`自動生成 ${i+1}`,x:r.x*sx,y:r.y*sy,size:r.size*Math.min(sx,sy),pitch:r.pitch*Math.min(sx,sy),points:r.points.map(([x,y,a,b])=>[x*sx,y*sy,a*sx,b*sy]),numbers:[],confirmed:false}));
  unifyGeneratedSeatSize(islands,project.width,project.height);
  return islands;
 }finally{worker.terminate()}
}

export async function generateProjects(files,{onProject,onProgress,signal}={}){
 const images=[...files].filter(f=>['image/png','image/jpeg','image/webp'].includes(f.type));
 if(!images.length)throw Error('PNG・JPEG・WebP画像がありません');
 const result={created:[],failed:[],cancelled:false};
 for(let i=0;i<images.length;i++){
  if(signal?.aborted){result.cancelled=true;break;}
  const file=images[i];onProgress?.({index:i,total:images.length,name:file.name});
  try{
   const project={...newProject(),...await readMapImage(file),name:file.name.replace(/\.[^.]+$/,'')};
   project.islands=await generateRows(project,{signal});
   project.generation={source:file.name,created_at:new Date().toISOString(),reviewRequired:true};
   await onProject(project);result.created.push({key:project.key,name:project.name,rows:project.islands.length});
  }catch(error){if(error.name==='AbortError'){result.cancelled=true;break;}result.failed.push({name:file.name,error:error.message});}
 }
 return result;
}
