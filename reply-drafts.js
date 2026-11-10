(function(root){
 'use strict';
 function createDrafts(){
  const values=new Map();
  return {set(id,value){if(value)values.set(String(id),String(value));else values.delete(String(id));},get(id){return values.get(String(id))||'';},remove(id){values.delete(String(id));},get dirty(){return values.size>0;}};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={createDrafts};
 else root.ReplyDrafts={createDrafts};
})(typeof window==='undefined'?globalThis:window);
