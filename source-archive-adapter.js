/* Disabled by default. The trusted gateway hashes actual bytes; browser hashes are not receipts. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SourceArchiveAdapter=api;})(typeof globalThis==='undefined'?this:globalThis,()=>{
 function create({enabled=false,transport,uuid=()=>globalThis.crypto.randomUUID()}={}){
  const requests=new WeakMap();let running=false;
  return {async archivePair(pair){
   if(!enabled)throw new Error('內容去重封存尚未啟用，未上傳檔案。');
   if(!transport?.upload||!transport?.markImport)throw new Error('隔離封存閘道未設定，禁止改用正式Storage。');
   if(running)throw new Error('封存進行中，請勿重複送出。');
   const items=['ByDate','ByOrder'].map(type=>pair?.byType?.[type]);
   if(items.some(item=>!item?.file)||!pair?.dates?.length)throw new Error('缺少完整成對報表。');
   running=true;const receipts=[];
   try{for(const item of items){
    if(!requests.has(item.file))requests.set(item.file,uuid());
    const requestId=requests.get(item.file);
    const receipt=await transport.upload({requestId,file:item.file,reportType:item.type,periodStart:pair.dates[0],periodEnd:pair.dates.at(-1),rowCount:item.rows.length});
    if(receipt?.requestId!==requestId||receipt?.verified!==true||receipt?.status!=='archived'||!/^[0-9a-f]{64}$/.test(receipt?.sha256||''))throw new Error('伺服器封存結果不完整，未確認成功，請重試原檔。');
    receipts.push(receipt);
   }return receipts;}finally{running=false;}
  },async markImport(ids,status,note=''){
   if(!enabled||!transport?.markImport)throw new Error('隔離封存閘道未啟用。');
   if(!['archived','partial','imported'].includes(status))throw new Error('無效匯入狀態');
   return transport.markImport({requestIds:ids,status,note});
  },complete(pair){for(const item of Object.values(pair?.byType||{}))if(item.file)requests.delete(item.file);}};
 }
 return {create};
});
