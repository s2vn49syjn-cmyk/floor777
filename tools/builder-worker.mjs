import {detectIslands} from './builder-detect.mjs';
self.onmessage=e=>{try{self.postMessage({islands:detectIslands(e.data.image,e.data.scale,e.data.options)});}catch(error){self.postMessage({error:error.message});}};
