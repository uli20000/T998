/* Disabled-by-default adapter; server RPC and source-archive isolation must be verified first. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ScorePairAdapter=api;})(typeof globalThis==='undefined'?this:globalThis,()=>{
 function create({db,enabled=false,uuid=()=>globalThis.crypto.randomUUID()}){
  const requests=new Map(),results=new Map();let running=false;
  return {get results(){return [...results.entries()].map(([date,result])=>({date,...result}));},async importDays(pair){
   if(!enabled)throw new Error('原子匯入尚未啟用，沒有送出資料。');
   if(running)throw new Error('匯入進行中，請勿重複送出。');
   if(!pair?.dates?.length||!pair.byType?.ByDate||!pair.byType?.ByOrder)throw new Error('需要同日期的ByDate與ByOrder。');
   const planned=pair.dates.map(date=>({date,a:pair.byType.ByDate.rows.filter(x=>x.record_date===date),b:pair.byType.ByOrder.rows.filter(x=>x.record_date===date)}));
   if(planned.some(x=>!x.a.length||!x.b.length))throw new Error('兩份檔案日期必須相同且每天皆有資料。');
   running=true;
   try{for(const day of planned){
    const payload={p_report_date:day.date,p_by_date_filename:pair.byType.ByDate.file.name,p_by_date_rows:day.a,p_by_order_filename:pair.byType.ByOrder.file.name,p_by_order_rows:day.b};
    const signature=JSON.stringify(payload),prior=requests.get(day.date);
    if(!prior||prior.signature!==signature){requests.set(day.date,{signature,id:uuid()});results.delete(day.date);}
    if(results.get(day.date)?.status==='completed')continue;
    try{const r=await db.rpc('import_score_pair_atomic',{p_request_id:requests.get(day.date).id,...payload});if(r.error)throw r.error;results.set(day.date,{status:'completed',result:r.data});}
    catch(error){results.set(day.date,{status:'failed',error:error.message||String(error)});}
   }return this.results;}finally{running=false;}
  }};
 }
 return {create};
});
