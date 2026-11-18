/* 後台「0800 A項」分頁：列出 A 項客訴與餐廳回覆（配餐人員／根源／行動），可退回重填。 */
(function(){
  'use strict';
  const E=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // A 項回饋需要新版月份回覆連結（monthReplyGatewayReady）與 feedback_a_replies 表；未開通的中心不顯示入口
  if(window.CENTER_CONFIG?.features?.monthReplyGatewayReady!==true){
    const hide=()=>{document.querySelector('.ops-tab[data-ops-tab="a0800"]')?.remove();E('opsAPanel')?.remove();const h=document.querySelector('.ops-month-link-controls h3');if(h)h.textContent='等餐回覆連結';};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hide);else hide();
    return;
  }
  const isA=t=>window.FeedbackAReply?FeedbackAReply.isAItem(t):/^A(\s|$)/.test(String(t||'').trim());
  const state={rows:[],request:0,label:''};const returning=new Set();
  function enabled(){const f=window.CENTER_CONFIG?.features;return f?.monthReplyGatewayReady===true;}
  // 期間內 0800 A 項＋回覆（後台清單與報表匯出共用）
  async function readRange(range){
    const fb=await window.OpsReport.readRows('t998_feedback_import_rows','id,record_date,store_code,restaurant_name,main_topic,item_1,item_2,content,work_order,invoice_number',q=>q.eq('source_type','0800').gte('record_date',range.start).lte('record_date',range.end));
    const rows=fb.filter(x=>isA(x.main_topic)),ids=rows.map(x=>x.id),replies=new Map();
    for(let i=0;i<ids.length;i+=150){const r=await db.from('feedback_a_replies').select('feedback_id,status,packer,root_cause,action_plan,responded_at,reply_version').in('feedback_id',ids.slice(i,i+150));if(r.error)throw r.error;for(const x of r.data||[])replies.set(x.feedback_id,x);}
    return rows.map(x=>({...x,reply:replies.get(x.id)||null}));
  }
  const statusText=x=>x.reply?.status==='completed'?'已回覆':x.reply?'退回待重填':'待回覆';
  async function exportRows(range){
    const rows=await readRange(range),fmt=t=>t?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t)):'';
    return rows.sort((a,b)=>a.record_date.localeCompare(b.record_date)||String(a.store_code).localeCompare(String(b.store_code))).map(x=>{const done=x.reply?.status==='completed';return {日期:x.record_date,店號:x.store_code||'',餐廳:x.restaurant_name||'',項目:x.item_1||'',品項:x.item_2||'',顧客回饋內容:x.content||'',工作單號:x.work_order||'',發票號碼:x.invoice_number||'',回覆狀態:statusText(x),配餐人員:done?x.reply.packer:'',根源:done?x.reply.root_cause:'',行動:done?x.reply.action_plan:'',回覆時間:done?fmt(x.reply.responded_at):''};});
  }
  async function load(range,label){
    if(!E('opsAList'))return;const request=++state.request;state.label=label||'';E('opsAList').innerHTML='<div class="ops-empty">讀取中…</div>';
    try{
      const rows=await readRange(range);
      if(request!==state.request)return;
      state.rows=rows.slice().sort((a,b)=>b.record_date.localeCompare(a.record_date)||String(a.store_code).localeCompare(String(b.store_code)));render();
    }catch(e){if(request===state.request){state.rows=[];E('opsAList').textContent='讀取失敗：'+(e.message||e);}}
  }
  function render(){
    const search=E('opsASearch').value.trim().toLowerCase(),status=E('opsAStatus').value;
    const done=x=>x.reply?.status==='completed';
    const rows=state.rows.filter(x=>(!search||[x.store_code,x.restaurant_name].some(v=>String(v||'').toLowerCase().includes(search)))&&(!status||(status==='completed')===done(x)));
    const total=state.rows.length,answered=state.rows.filter(done).length;
    E('opsAListTitle').textContent='A 項回饋　'+state.label+'　已回覆 '+answered+'／'+total;
    E('opsAList').innerHTML=rows.length?'<table class="ops-table ops-records-table ops-a-table"><thead><tr><th class="a-nw">日期</th><th>店號／餐廳</th><th class="a-txt">抱怨內容</th><th class="a-nw">狀態</th><th class="a-txt">餐廳回饋</th><th class="a-nw">操作</th></tr></thead><tbody>'+rows.map(x=>{const r=x.reply,ok=done(x);return '<tr><td class="a-nw" data-label="日期">'+escape(x.record_date)+'</td><td data-label="店號／餐廳">'+escape(x.store_code||'—')+'<br><span class="a-nw">'+escape(x.restaurant_name)+'</span></td><td class="a-txt a-complaint" data-label="抱怨內容"><b>'+escape([x.item_1,x.item_2].filter(Boolean).join('｜')||x.main_topic)+'</b>'+(x.content?'<div class="a-full">'+escape(x.content)+'</div>':'')+'</td><td class="a-nw" data-label="狀態">'+(ok?'<span class="ops-status done">已回覆</span>':'<span class="ops-status">'+(r?'退回待重填':'待回覆')+'</span>')+'</td><td class="a-txt a-reply" data-label="餐廳回饋">'+(ok?'<div><b>配餐人員</b>'+escape(r.packer)+'</div><div><b>根源</b>'+escape(r.root_cause)+'</div><div><b>行動</b>'+escape(r.action_plan)+'</div>':'—')+'</td><td class="a-nw" data-label="操作">'+(ok?'<button type="button" class="ops-row-btn" data-return-a="'+escape(x.id)+'"'+(enabled()?' title="退回請餐廳重填"':' disabled title="月回覆入口尚未啟用"')+'>退回</button>':'')+'</td></tr>';}).join('')+'</tbody></table>':'<div class="ops-empty">'+(total?'沒有符合條件的案件。':'這段期間沒有 0800 A 項客訴（或尚未匯入 0800 檔）。')+'</div>';
  }
  async function returnReply(id,button){
    const msg=E('opsAMessage'),row=state.rows.find(x=>String(x.id)===String(id));
    if(!row||row.reply?.status!=='completed'){msg.textContent='回覆狀態已變更，請重新整理。';return;}
    if(returning.has(id))return;
    const reason=prompt('請填寫退回原因（原回覆會保留歷史版本）：');if(reason===null)return;
    if(!reason.trim()||reason.trim().length>500){msg.textContent='退回原因需填寫1至500字。';return;}
    if(!confirm('將 '+row.record_date+' '+row.restaurant_name+' 的 A 項回覆退回修改？餐廳可用同月份連結重填。'))return;
    returning.add(id);button.disabled=true;msg.textContent='退回中…';
    try{const r=await db.rpc('return_a_reply',{p_feedback_id:row.id,p_expected_version:row.reply.reply_version,p_return_reason:reason.trim()});if(r.error)throw r.error;
      if(r.data?.id!==row.id||r.data?.status!=='pending')throw new Error('回傳結果不完整，請重新整理核對');
      msg.textContent='已退回，原回覆已保存為第 '+r.data.archived_revision+' 版。';
    }catch(e){msg.textContent='未確認退回完成：'+(e.message||e)+'；請重新整理核對。';}
    finally{returning.delete(id);E('opsGlobalRefresh')?.click();}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    E('opsASearch')?.addEventListener('input',render);E('opsAStatus')?.addEventListener('change',render);
    E('opsAList')?.addEventListener('click',e=>{const b=e.target.closest('[data-return-a]');if(b)returnReply(b.dataset.returnA,b);});
  });
  window.OpsAReplyAdmin={load,exportRows,readRange};
})();
