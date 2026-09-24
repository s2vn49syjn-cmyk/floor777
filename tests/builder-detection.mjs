import assert from 'node:assert/strict';
import {detectIslands} from '../tools/builder-detect.mjs';
import {makeIsland,resizeIsland} from '../tools/builder-model.mjs';
const width=600,height=400,data=new Uint8ClampedArray(width*height*4).fill(255);
function ink(test,color){for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(test(x,y))data.set([...color,255],(y*width+x)*4);}
ink((x,y)=>x>=60&&x<78&&y>=60&&y<330,[25,25,25]);
ink((x,y)=>x>=120&&x<138&&y>=60&&y<330,[20,80,230]);
ink((x,y)=>Math.abs(Math.hypot(x-380,y-190)-85)<8,[180,25,170]);
const rows=detectIslands({width,height,data});assert.equal(rows.length,3);
const lines=rows.filter(r=>r.x<200);assert.equal(lines.length,2);
for(const r of lines){const xs=r.points.map(p=>p[0]);assert(Math.max(...xs)-Math.min(...xs)<2);assert(r.points.at(-1)[1]-r.points[0][1]>220);}
const ring=rows.find(r=>r.closed);assert(ring);const centers=ring.points.map(p=>[p[0]+p[2]/2,p[1]+p[3]/2]);assert(centers.every(([x,y])=>Math.abs(Math.hypot(x-380,y-190)-85)<3));
for(const r of rows){assert.deepEqual(r.numbers,[]);assert.equal(r.confirmed,false);assert(r.points.every(([x,y,w,h])=>x>=0&&y>=0&&x+w<=width&&y+h<=height));}
const selected=detectIslands({width,height,data},1,{region:{x:30,y:30,width:65,height:340}});assert.equal(selected.length,1);assert(selected[0].x<80);
const resized=makeIsland(ring);resizeIsland(resized,32);assert.equal(resized.points.length,32);assert(Math.hypot(resized.points[0][0]-resized.points[31][0],resized.points[0][1]-resized.points[31][1])>5);
assert.equal(detectIslands({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)}).length,0);
console.log('PASS: separate dark/blue rows, straight centerlines, complete ring, bounds, ROI, blank input, closed-path resizing');
