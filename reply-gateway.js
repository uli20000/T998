/* Offline integration. No legacy/public fallback; enable only after isolated API review. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReplyGateway=api;})(globalThis,function(){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function create(client,options={}){
  const enabled=options.enabled===true, attempts=new Map(),busy=new Set();
  const newId=options.requestIdFactory||(()=>globalThis.crypto.randomUUID());
  async function call(name,args){
   if(!enabled)throw new Error('月回覆入口尚未啟用；未送出任何資料。');
   if(!(options.boundSchema==='shared_test_995'||(options.boundSchema==='public'&&options.production===true)))throw new Error('回覆入口的 schema 設定不正確。');
   if(typeof options.token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(options.token))throw new Error('月回覆連結無效。');
   const r=await client.rpc(name,{p_token:options.token,...args});if(r.error)throw r.error;return r.data;
  }
  return Object.freeze({enabled,
   async list(){const d=await call('list_month_delay_replies',{});if(!d||!Array.isArray(d.orders)||typeof d.month!=='string')throw new Error('回覆清單格式錯誤。');return d;},
   async submit(order,reason){
    reason=String(reason??'').trim();
    if(!UUID.test(order.id)||!UUID.test(order.reply_version)||!reason||[...reason].length>500)throw new Error('訂單版本或回覆內容無效。');
    if(busy.has(order.id))throw new Error('此訂單仍在送出中。');
    let attempt=attempts.get(order.id);
    if(attempt&&(attempt.reason!==reason||attempt.version!==order.reply_version))throw new Error('上次送出結果尚未確認；請先以原內容重試，或重新載入核對。');
    if(!attempt){attempt={requestId:newId(),version:order.reply_version,reason};attempts.set(order.id,attempt);}
    busy.add(order.id);
    try{const d=await call('submit_month_delay_reply',{p_request_id:attempt.requestId,p_order_id:order.id,p_expected_version:attempt.version,p_reason:reason});
     if(!d||d.id!==order.id||d.request_id!==attempt.requestId||d.status!=='completed')throw new Error('尚未確認送出結果；請以相同內容重試。');
     attempts.delete(order.id);return d;
    }finally{busy.delete(order.id);}
   }
  });
 }
 return {create};
});
