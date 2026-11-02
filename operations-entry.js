(function(){
  'use strict';
  const E=id=>document.getElementById(id),S=window.OpsSummary,R=window.OpsReport,escape=opsEscape;
  const dateControl=window.OpsDateControl={date:opsToday(),period:'day',set(date,period=this.period,refresh=true){this.date=date||opsToday();this.period=period;paintToolbar();if(state.active==='line'&&E('opsLineStore').value)R.fillLineState(E('opsLineStore').value,this.date);if(refresh)refreshActive();}};
  const state={delay:[],line:[],stores:[],delayRequest:0,lineRequest:0,active:'delay',lineFilter:'all',choicesOpen:false};
  const periodRange=()=>S.range(dateControl.date,dateControl.period);
  const periodLabel=()=>{const r=periodRange(),p=dateControl.period;return p==='day'?r.start:p==='week'?S.weekLabel(r.start)+'　'+r.start+' ～ '+r.end:r.start.slice(0,7);};
  const shiftDate=(date,days)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const shiftMonth=(date,months)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10);};
  const dateText=date=>{const d=new Date(date+'T12:00:00Z'),weekday=['日','一','二','三','四','五','六'][d.getUTCDay()];return '週'+weekday;};
  const monthText=date=>new Intl.DateTimeFormat('zh-TW',{timeZone:'UTC',year:'numeric',month:'long'}).format(new Date(date+'T12:00:00Z'));
  function renderPeriodChoices(){
    const box=E('opsGlobalPeriodChoices'),period=dateControl.period;
    box.hidden=!state.choicesOpen;
    if(!state.choicesOpen){box.innerHTML='';return;}
    if(period==='day'){
      box.innerHTML='<div class="ops-choice-list" role="group" aria-label="選擇日期">'+Array.from({length:7},(_,i)=>{const date=shiftDate(dateControl.date,i-3);return '<button type="button" class="ops-choice-button '+(date===dateControl.date?'active':'')+'" data-choice-date="'+date+'" aria-label="'+date+' '+dateText(date)+'" aria-pressed="'+(date===dateControl.date)+'"><span>'+dateText(date)+'</span><strong>'+date.slice(5).replace('-','/')+'</strong></button>';}).join('')+'</div>';
    }else if(period==='week'){
      const start=S.range(dateControl.date,'week').start;
      box.innerHTML='<div class="ops-choice-list" role="group" aria-label="選擇週次">'+Array.from({length:5},(_,i)=>{const weekStart=shiftDate(start,(i-2)*7),range=S.range(weekStart,'week');return '<button type="button" class="ops-choice-button '+(range.start===S.range(dateControl.date,'week').start?'active':'')+'" data-choice-date="'+weekStart+'" aria-pressed="'+(range.start===S.range(dateControl.date,'week').start)+'"><strong>'+S.weekLabel(weekStart)+'</strong><span>'+range.start.slice(5).replace('-','/')+'<wbr>–'+range.end.slice(5).replace('-','/')+'</span></button>';}).join('')+'</div>';
    }else{
      const prev=shiftMonth(dateControl.date,-1),current=shiftMonth(dateControl.date,0),next=shiftMonth(dateControl.date,1);
      box.innerHTML='<div class="ops-month-choices" role="group" aria-label="選擇月份"><button type="button" class="ops-choice-button" data-choice-date="'+prev+'"><span>‹</span><strong>'+monthText(prev)+'</strong></button><button type="button" class="ops-choice-button active" data-choice-date="'+current+'" aria-pressed="true"><strong>'+monthText(current)+'</strong></button><button type="button" class="ops-choice-button" data-choice-date="'+next+'"><strong>'+monthText(next)+'</strong><span>›</span></button></div>';
    }
  }
  function paintToolbar(){
    E('opsGlobalDate').value=dateControl.date;
    E('opsGlobalPeriodTabs').querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b.dataset.period===dateControl.period));
    E('opsGlobalPeriodTabs').querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===dateControl.period)));
    renderPeriodChoices();
  }
  function shiftPeriod(direction){
    const d=new Date(dateControl.date+'T12:00:00Z'),period=dateControl.period;
    if(period==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);}else d.setUTCDate(d.getUTCDate()+direction*(period==='week'?7:1));
    dateControl.set(d.toISOString().slice(0,10));
  }
  function refreshActive(force=false){
    if(state.active==='delay')return loadDelay();
    if(state.active==='line')return loadLine();
    return R.open(state.active,force).catch(()=>{});
  }
  async function loadDelay(){
    const request=++state.delayRequest,r=periodRange();E('opsDelayList').innerHTML='<div class="ops-empty">讀取中…</div>';
    try{const rows=await R.readRows('t998_delay_orders','*',q=>q.gte('record_date',r.start).lte('record_date',r.end));if(request!==state.delayRequest)return;state.delay=rows.sort((a,b)=>b.record_date.localeCompare(a.record_date)||b.created_at.localeCompare(a.created_at));renderDelay();}catch(e){if(request===state.delayRequest){state.delay=[];E('opsDelayList').textContent='讀取失敗：'+e.message;}}
  }
  function renderDelay(){
    const search=E('opsDelaySearch').value.trim().toLowerCase(),rows=state.delay.filter(x=>!search||[x.store_code,x.restaurant_name].some(v=>String(v).toLowerCase().includes(search)));
    E('opsDelayListTitle').textContent='等餐紀錄　'+periodLabel();
    E('opsDelayList').innerHTML=rows.length?'<table class="ops-table ops-records-table"><thead><tr><th>日期</th><th>店號／餐廳</th><th>編號</th><th>狀態</th><th>等餐原因</th><th>操作</th></tr></thead><tbody>'+rows.map(x=>'<tr><td data-label="日期">'+x.record_date+'</td><td data-label="店號／餐廳">'+escape(x.store_code)+'／'+escape(x.restaurant_name)+'</td><td data-label="編號">'+escape(x.order_number)+'</td><td data-label="狀態">'+(x.status==='completed'?'已回覆':'待回覆')+'</td><td data-label="等餐原因">'+escape(x.reason||'—')+'</td><td data-label="操作"><button type="button" class="ops-delete-btn" data-delete-delay="'+x.id+'" aria-label="刪除 '+escape(x.restaurant_name)+' 訂單 '+escape(x.order_number)+'">刪除</button></td></tr>').join('')+'</tbody></table>':'<div class="ops-empty">沒有符合條件的紀錄</div>';
  }
  async function loadLine(){
    const request=++state.lineRequest;E('opsLineList').innerHTML='<div class="ops-empty">讀取中…</div>';
    const r=periodRange();
    try{const [rows,stores]=await Promise.all([R.readRows('t998_line_signature_records','id,record_date,store_code,restaurant_name,line_completed,signature_completed',q=>q.gte('record_date',r.start).lte('record_date',r.end)),R.directory()]);if(request!==state.lineRequest)return;state.line=rows;state.stores=stores;renderLine();}catch(e){if(request===state.lineRequest){state.line=[];E('opsLineList').textContent='讀取失敗：'+e.message;}}
  }
  function renderLine(){
    const search=E('opsLineSearch').value.trim().toLocaleLowerCase('zh-Hant'),nonDelivery=window.OpsMetrics.NON_DELIVERY_STORES;
    const catalog=new Map(state.stores.filter(x=>!nonDelivery.has(String(x.store_code))).map(x=>[String(x.store_code),x]));for(const row of state.line)if(!catalog.has(String(row.store_code))&&!nonDelivery.has(String(row.store_code)))catalog.set(String(row.store_code),{store_code:String(row.store_code),restaurant_name:row.restaurant_name});
    const registeredCodes=new Set(state.line.map(x=>String(x.store_code))),pendingStores=[...catalog.values()].filter(s=>!registeredCodes.has(String(s.store_code))),checkedCount=registeredCodes.size,pendingCount=pendingStores.length;
    E('opsLineStats').innerHTML='<div class="ops-line-stat"><span>全部餐廳</span><strong>'+catalog.size+'</strong></div><button type="button" class="ops-line-stat" data-line-filter="checked" aria-pressed="'+(state.lineFilter==='checked')+'"><span>已檢查</span><strong>'+checkedCount+'</strong></button><button type="button" class="ops-line-stat" data-line-filter="pending" aria-pressed="'+(state.lineFilter==='pending')+'"><span>待檢查</span><strong>'+pendingCount+'</strong></button>';
    const records=state.line.slice().sort((a,b)=>b.record_date.localeCompare(a.record_date)||String(a.store_code).localeCompare(String(b.store_code))).map(row=>({store:catalog.get(String(row.store_code))||{store_code:row.store_code,restaurant_name:row.restaurant_name},row}));
    let rows=state.lineFilter==='checked'?records:state.lineFilter==='pending'?pendingStores.map(store=>({store,row:null})):records.concat(pendingStores.map(store=>({store,row:null})).sort((a,b)=>a.store.store_code.localeCompare(b.store.store_code)));
    rows=rows.filter(({store})=>!search||[store.store_code,store.restaurant_name].some(v=>String(v).toLocaleLowerCase('zh-Hant').includes(search)));
    E('opsLineListTitle').textContent='餐廳狀態　'+periodLabel();
    E('opsLineList').innerHTML=rows.length?'<table class="ops-table ops-records-table ops-line-records"><thead><tr><th>店號／餐廳</th><th>檢查狀態</th><th>劃線</th><th>簽名</th><th>操作</th></tr></thead><tbody>'+rows.map(({store,row})=>'<tr><td data-label="店號／餐廳">'+escape(store.store_code)+'／'+escape(store.restaurant_name)+'</td><td data-label="檢查狀態">'+(row?'已檢查':'待檢查')+'</td><td data-label="劃線">'+(row?.line_completed?'完成':'未完成')+'</td><td data-label="簽名">'+(row?.signature_completed?'完成':'未完成')+'</td><td data-label="操作">'+(row?'<button type="button" class="ops-delete-btn" data-delete-line="'+row.id+'" aria-label="刪除 '+escape(store.restaurant_name)+' 劃線簽名紀錄">刪除</button>':'—')+'</td></tr>').join('')+'</tbody></table>':'<div class="ops-empty">沒有符合餐廳的資料</div>';
  }
  async function removeRecord(kind,id,button){
    const row=state[kind].find(x=>x.id===id);if(!row)return;
    const description=kind==='delay'?row.restaurant_name+' 訂單 '+row.order_number:row.restaurant_name+' 劃線簽名紀錄';
    if(!window.T998_PREVIEW&&!confirm('確定刪除 '+row.record_date+' '+description+'？'))return;
    const message=E(kind==='delay'?'opsDelayMessage':'opsLineMessage');button.disabled=true;
    try{
      const table=kind==='delay'?'t998_delay_orders':'t998_line_signature_records',result=await db.from(table).delete().eq('id',id).eq('record_date',row.record_date).select('id');if(result.error)throw result.error;if(!result.data?.length)throw new Error('紀錄已不存在或沒有刪除權限');
      message.textContent='已刪除';if(kind==='delay')await loadDelay();else{await loadLine();if(E('opsLineStore').value===row.store_code)await R.fillLineState(row.store_code);}
    }catch(e){message.textContent='刪除失敗：'+e.message;button.disabled=false;}
  }
  E('opsDelayList').onclick=e=>{const b=e.target.closest('[data-delete-delay]');if(b)removeRecord('delay',b.dataset.deleteDelay,b);};
  E('opsLineList').onclick=e=>{const b=e.target.closest('[data-delete-line]');if(b)removeRecord('line',b.dataset.deleteLine,b);};
  E('opsDelaySave').onclick=async()=>{
    const date=dateControl.date,order=E('opsDelayOrder').value.trim(),msg=E('opsDelayMessage');if(!/^[0-9]{4}$/.test(order)){msg.textContent='請輸入 4 碼訂單編號';return;}
    E('opsDelaySave').disabled=true;msg.textContent='儲存中…';
    try{const restaurant=await window.opsFindRestaurant('opsDelayStore');if(!restaurant)throw new Error('請選擇正確的店號');const result=await db.from('t998_delay_orders').insert({record_date:date,store_code:restaurant.store_code,restaurant_name:restaurant.restaurant_name,order_number:order,status:'pending'});if(result.error)throw result.error;
      E('opsDelayOrder').value='';E('opsDelaySearch').value='';await loadDelay();msg.textContent='已新增';E('opsDelayOrder').focus();
    }catch(e){msg.textContent=e.code==='23505'?'同日、同餐廳的訂單編號已存在':'新增失敗：'+e.message;}finally{E('opsDelaySave').disabled=false;}
  };
  for(const id of ['opsLineMark','opsSignMark'])E(id).onclick=()=>opsSetToggle(id,E(id).getAttribute('aria-pressed')!=='true');
  E('opsLineSave').onclick=async()=>{
    const date=dateControl.date,msg=E('opsLineMessage'),marked=E('opsLineMark').getAttribute('aria-pressed')==='true',signed=E('opsSignMark').getAttribute('aria-pressed')==='true';
    E('opsLineSave').disabled=true;msg.textContent='儲存中…';
    try{const restaurant=await window.opsFindRestaurant('opsLineStore');if(!restaurant)throw new Error('請選擇正確的店號');const result=await db.from('t998_line_signature_records').upsert({record_date:date,store_code:restaurant.store_code,restaurant_name:restaurant.restaurant_name,status:marked&&signed?'completed':'not_completed',line_completed:marked,signature_completed:signed,updated_at:new Date().toISOString()},{onConflict:'record_date,store_code'});if(result.error)throw result.error;await loadLine();msg.textContent='已新增';}catch(e){msg.textContent='新增失敗：'+e.message;}finally{E('opsLineSave').disabled=false;}
  };
  paintToolbar();
  E('opsGlobalDate').onchange=()=>dateControl.set(E('opsGlobalDate').value||opsToday());
  E('opsGlobalPeriodTabs').querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.choicesOpen=true;dateControl.set(dateControl.date,b.dataset.period);});
  E('opsGlobalPeriodChoices').onclick=e=>{const b=e.target.closest('[data-choice-date]');if(!b)return;dateControl.set(b.dataset.choiceDate);};
  E('opsGlobalPrev').onclick=()=>shiftPeriod(-1);E('opsGlobalNext').onclick=()=>shiftPeriod(1);
  E('opsGlobalRefresh').onclick=()=>refreshActive(true);
  E('opsDelaySearch').oninput=renderDelay;E('opsLineSearch').oninput=renderLine;
  E('opsLineStats').onclick=e=>{const b=e.target.closest('[data-line-filter]');if(!b)return;state.lineFilter=state.lineFilter===b.dataset.lineFilter?'all':b.dataset.lineFilter;renderLine();};
  const linkMonth=E('opsLinkMonth');
  const monthLabel=value=>value.slice(0,4)+'年'+value.slice(5)+'月';
  linkMonth.value=opsToday().slice(0,7);
  function clearMonthLink(){
    E('opsLinkResult').hidden=true;E('opsLinkUrl').value='';E('opsLinkMonthLabel').textContent='';
    E('opsLinkMonthPreview').textContent=/^\d{4}-(0[1-9]|1[0-2])$/.test(linkMonth.value)?'將建立 '+monthLabel(linkMonth.value)+' 的固定月份連結':'請選擇回覆月份';
  }
  linkMonth.onchange=()=>{clearMonthLink();E('opsLinkMessage').textContent='';};
  clearMonthLink();
  E('opsLinkCreate').onclick=async()=>{
    const msg=E('opsLinkMessage'),month=linkMonth.value,button=E('opsLinkCreate');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){msg.textContent='請選擇有效的回覆月份';return;}
    if(!confirm('建立 '+monthLabel(month)+' 的固定月份連結？同月重新產生會撤銷該月前一個新制連結；其他月份及既有舊連結不受影響。'))return;
    button.disabled=true;linkMonth.disabled=true;clearMonthLink();msg.textContent='正在建立 '+monthLabel(month)+' 連結…';
    try{
      const r=await db.rpc('t998_issue_month_reply_link',{p_month:month+'-01'});if(r.error)throw r.error;
      if(r.data?.month!==month||!/^[0-9a-f]{64}$/.test(r.data?.token||''))throw new Error('月份連結回應不完整，請重新確認');
      const url=new URL('reply.html',location.href);url.searchParams.set('kind','month');url.searchParams.set('token',r.data.token);
      E('opsLinkUrl').value=url.href;E('opsLinkMonthLabel').textContent='固定回覆月份：'+monthLabel(month);E('opsLinkResult').hidden=false;
      msg.textContent=monthLabel(month)+' 連結已建立，沒有固定到期日；跨月仍只顯示此月份。';
    }catch(e){msg.textContent='產生失敗：'+(e.message||'請檢查管理員權限及月份連結功能是否已部署');}
    finally{button.disabled=false;linkMonth.disabled=false;}
  };
  E('opsLinkCopy').onclick=async()=>{if(!E('opsLinkUrl').value||E('opsLinkResult').hidden)return;try{await navigator.clipboard.writeText(E('opsLinkUrl').value);E('opsLinkMessage').textContent='已複製'+E('opsLinkMonthLabel').textContent+'的連結';}catch{E('opsLinkUrl').select();document.execCommand('copy');E('opsLinkMessage').textContent='已複製'+E('opsLinkMonthLabel').textContent+'的連結';}};
  function openTab(name){
    state.active=name;document.querySelectorAll('.ops-tab').forEach(b=>b.classList.toggle('active',b.dataset.opsTab===name));
    for(const [tab,id] of Object.entries({delay:'opsDelayPanel',line:'opsLinePanel',scores:'opsScoresPanel',summary:'opsSummaryPanel'}))E(id).hidden=tab!==name;
    if(name==='delay')loadDelay();else if(name==='line')loadLine();else R.open(name).catch(()=>{});
  }
  document.querySelectorAll('.ops-tab').forEach(b=>b.onclick=()=>openTab(b.dataset.opsTab));
  const original=showAdminMode;showAdminMode=function(mode){original(mode);E('opsModePage').style.display=mode==='ops'?'block':'none';if(mode==='ops')openTab(state.active);};
  E('opsModeBtn').onclick=()=>showAdminMode('ops');E('opsBackBtn').onclick=()=>showAdminMode('home');
})();
