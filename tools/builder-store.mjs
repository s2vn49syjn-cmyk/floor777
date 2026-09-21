let db;
export function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('floor777-builder-v2',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'key'});r.onsuccess=()=>{db=r.result;resolve();};r.onerror=()=>reject(r.error);});}
function tx(mode,action){return new Promise((resolve,reject)=>{if(!db)return reject(Error('保存領域を開けません'));const t=db.transaction('projects',mode),r=action(t.objectStore('projects'));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('保存が中断されました'));});}
export const saveProject=p=>tx('readwrite',s=>s.put(p));
export const listProjects=()=>tx('readonly',s=>s.getAll());
export const deleteProject=key=>tx('readwrite',s=>s.delete(key));
