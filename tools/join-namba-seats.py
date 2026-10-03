"""Extend only same-run seat surfaces to shared midlines; never move labels or centers.
Consecutive seats must also have source bounds within 25 units (aisles start at
110 units in this map). A 200-unit center-distance cap prevents remote joins.
Missing seat numbers and aisle gaps remain disconnected. Half-plane clipping
keeps curved neighbors from overlapping. No machine or live data is edited.
"""
import json,math,pathlib
root=pathlib.Path(__file__).resolve().parents[1];hall=json.loads((root/'data/rakuen-namba.json').read_text());path=root/'data/positions-rakuen-namba.json';raw=json.loads(path.read_text());source={s['seat']:s['provenance']['source_bounds'] for s in hall['seats']};centers={int(n):(p[0]+25,p[1]+25) for n,p in raw.items()};neighbors={n:[] for n in centers};edges=[]
for n,a in source.items():
 if n+1 not in source:continue
 b=source[n+1];gap=math.hypot(max(a[0]-b[0]-b[2],b[0]-a[0]-a[2],0),max(a[1]-b[1]-b[3],b[1]-a[1]-a[3],0));d=math.dist(centers[n],centers[n+1])
 if gap<=25 and d<=200:
  neighbors[n].append(n+1);neighbors[n+1].append(n);edges.append([n,n+1])
def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
def hull(points):
 points=sorted(set(points));lo=[];hi=[]
 for p in points:
  while len(lo)>1 and cross(lo[-2],lo[-1],p)<=0:lo.pop()
  lo.append(p)
 for p in reversed(points):
  while len(hi)>1 and cross(hi[-2],hi[-1],p)<=0:hi.pop()
  hi.append(p)
 return lo[:-1]+hi[:-1]
def clip(poly,nx,ny,k):
 out=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  da=a[0]*nx+a[1]*ny-k;db=b[0]*nx+b[1]*ny-k
  if da<=1e-8:out.append(a)
  if (da<0<db) or (db<0<da):
   t=da/(da-db);out.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
 return out
for key,p in raw.items():
 n=int(key);cx,cy=centers[n];points=[(cx+dx,cy+dy) for dx,dy in [(-25,-25),(25,-25),(25,25),(-25,25)]]
 for other in neighbors[n]:
  ox,oy=centers[other];dx=ox-cx;dy=oy-cy;d=math.hypot(dx,dy);mx=(cx+ox)/2;my=(cy+oy)/2
  points.extend([(mx-dy/d*25,my+dx/d*25),(mx+dy/d*25,my-dx/d*25)])
 poly=hull(points)
 for other in neighbors[n]:
  ox,oy=centers[other];dx=ox-cx;dy=oy-cy;poly=clip(poly,dx,dy,dx*(cx+ox)/2+dy*(cy+oy)/2)
 raw[key]=p[:4]+[[[round(x,6),round(y,6)] for x,y in hull(poly)]]
path.write_text('{\n'+',\n'.join('  '+json.dumps(k)+': '+json.dumps(v,separators=(',',':')) for k,v in raw.items())+'\n}\n')
print('generated',len(raw),'seat surfaces and',len(edges),'shared boundaries')
