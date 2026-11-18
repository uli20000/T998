/* 0800 A 項（產品正確）餐廳回覆：配餐人員＋根源＋行動。共用月份回覆連結（等餐同一個 token）。 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FeedbackAReply=api;})(globalThis,function(){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const LIMITS={packer:50,root_cause:500,action_plan:500};
 const clean=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
 /** 0800「重點」欄 A 開頭（例：「A 產品正確」）才算 A 項。 */
 function isAItem(mainTopic){return /^A(\s|$)/.test(clean(mainTopic));}
 /** 0800 的店號：餐廳欄寫「XX外送中心」時用發票號碼前三碼；其他用餐廳名稱對照店家清單。 */
 function storeFor0800(restaurant,invoice,directory,isCenterRow){
  const name=clean(restaurant);
  if(isCenterRow){
   const code=(clean(invoice).match(/^(\d{3})/)||[])[1]||'';
   if(!code)return {store_code:'',restaurant_name:name};
   const store=directory?.byCode?.get(code);
   return {store_code:code,restaurant_name:store?.restaurant_name||`未配對店號 ${code}`};
  }
  const store=directory?.byName?.get(name);
  return {store_code:store?String(store.store_code):'',restaurant_name:name};
 }
 function validate(fields){
  const out={};
  for(const [k,max] of Object.entries(LIMITS)){const v=String(fields?.[k]??'').trim();if(!v||[...v].length>max)return null;out[k]=v;}
  return out;
 }
 function create(client,options={}){
  const enabled=options.enabled===true,attempts=new Map(),busy=new Set();
  const newId=options.requestIdFactory||(()=>globalThis.crypto.randomUUID());
  async function call(name,args){
   if(!enabled)throw new Error('A 項回覆入口尚未啟用；未送出任何資料。');
   if(!(options.boundSchema==='shared_test_995'||(options.boundSchema==='public'&&options.production===true)))throw new Error('回覆入口的 schema 設定不正確。');
   if(typeof options.token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(options.token))throw new Error('月回覆連結無效。');
   const r=await client.rpc(name,{p_token:options.token,...args});if(r.error)throw r.error;return r.data;
  }
  return Object.freeze({enabled,
   async list(){const d=await call('list_month_a_replies',{});if(!d||!Array.isArray(d.items)||typeof d.month!=='string')throw new Error('A 項清單格式錯誤。');return d;},
   async submit(item,fields){
    const v=validate(fields);
    if(!UUID.test(item?.id)||!v)throw new Error('配餐人員（50 字內）、根源、行動（各 500 字內）都要填。');
    const version=item.reply_version||null;if(version!==null&&!UUID.test(version))throw new Error('回覆版本無效，請重新整理。');
    if(busy.has(item.id))throw new Error('這筆仍在送出中。');
    const key=JSON.stringify([v.packer,v.root_cause,v.action_plan]);
    let attempt=attempts.get(item.id);
    if(attempt&&(attempt.key!==key||attempt.version!==version))throw new Error('上次送出結果尚未確認；請先以原內容重試，或重新載入核對。');
    if(!attempt){attempt={requestId:newId(),version,key};attempts.set(item.id,attempt);}
    busy.add(item.id);
    try{const d=await call('submit_month_a_reply',{p_request_id:attempt.requestId,p_feedback_id:item.id,p_expected_version:version,p_packer:v.packer,p_root_cause:v.root_cause,p_action_plan:v.action_plan});
     if(!d||d.id!==item.id||d.request_id!==attempt.requestId||d.status!=='completed')throw new Error('尚未確認送出結果；請以相同內容重試。');
     attempts.delete(item.id);return d;
    }finally{busy.delete(item.id);}
   }
  });
 }
 return {create,isAItem,storeFor0800,validate,LIMITS};
});
