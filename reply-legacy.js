/* 舊制回覆流程（996／998 正式站現行）：新版月回覆 monthReplyGatewayReady 未啟用時使用。
   函式名稱寫 t998_，打包時會換成各中心前綴（t996_、t998_）。995 已啟用新版且已停用這些舊函式，不會走到這裡。 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReplyLegacy=api;})(globalThis,function(){
 'use strict';
 function create(client,options={}){
  const month=options.monthLink===true,token=String(options.token||'');
  const listRpc=month?'t998_public_list_month_delay_orders':'t998_public_list_shared_delay_orders';
  const submitRpc=month?'t998_public_submit_month_delay_reasons':'t998_public_submit_shared_delay_reasons';
  const busy=new Set();
  function shape(d,message='回覆資料格式不正確，請重新整理或聯絡值班人員。'){
   if(!d||typeof d!=='object'||Array.isArray(d)||!Array.isArray(d.orders)||(d.month!==undefined&&d.month!==null&&typeof d.month!=='string'))throw new Error(message);
   return {month:typeof d.month==='string'?d.month:'',orders:d.orders};
  }
  async function call(name,args){
   if(!/^[A-Za-z0-9_-]{16,128}$/.test(token))throw new Error('回覆連結無效。');
   const r=await client.rpc(name,{p_token:token,...args});if(r.error)throw r.error;return r.data;
  }
  return Object.freeze({legacy:true,
   // E01：格式不對時不能當成「沒有待回覆」；送出後回傳的清單必須能確認這筆已不在待回覆
   async list(){return shape(await call(listRpc,{}));},
   async submit(order,reason){
    reason=String(reason??'').trim();const id=String(order?.id??'');
    if(!id||!reason||[...reason].length>500)throw new Error('回覆內容需為 1 至 500 字。');
    if(busy.has(id))throw new Error('此訂單仍在送出中。');
    busy.add(id);
    try{const d=shape(await call(submitRpc,{p_updates:[{id,reason}]}),'送出結果無法確認，草稿已保留，請重新整理後核對。');
     if(d.orders.some(o=>String(o?.id??'')===id))throw new Error('這筆仍在待回覆清單，未確認送出成功，草稿已保留。');
     return d;}finally{busy.delete(id);}
   }
  });
 }
 return {create};
});
