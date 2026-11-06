(function(){
  'use strict';
  const M=window.OpsMetrics,S=window.OpsSummary,E=id=>document.getElementById(id),escape=opsEscape,labels=new Map(M.AREAS);
  const state={context:'scores',cache:null,monthCache:new Map(),monthLoads:new Map(),request:0,saveQueue:Promise.resolve(),saveError:null,stores:[],catalog:new Map(),weather:new Map(),weatherLoads:new Map(),weatherError:new Map(),records:{delay:[],line:[]}};
  E('opsWeekTabs')?.remove();
  const fmt=(v,d=0)=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
  const pct=v=>v===null||v===undefined?'—':fmt(v*100,1)+'%';
  const time=v=>v===null||v===undefined?'—':Math.floor(Math.round(v)/60)+'分'+String(Math.round(v)%60).padStart(2,'0')+'秒';
  const selectedDate=()=>window.OpsDateControl?.date||opsToday();
  const period=()=>window.OpsDateControl?.period||'day';
  const notify=(message,context=state.context)=>{E(context==='summary'?'opsSummaryStatus':'opsReportStatus').textContent=message;};
  const error=e=>notify(e.message||String(e));
  async function paged(table,columns,filter,order='record_date'){
    const rows=[];for(let offset=0;;offset+=1000){let q=filter(db.from(table).select(columns));if(order)q=q.order(order);q=table==='t998_score_import_rows'?q.order('row_number'):q.order('id');const r=await q.range(offset,offset+999);if(r.error)throw r.error;rows.push(...(r.data||[]));if((r.data||[]).length<1000)return rows;}
  }
  async function loadDirectory(){
    if(state.stores.length)return state.stores;
    const result=await db.from('t998_restaurants').select('store_code,restaurant_name').eq('enabled',true).order('store_code');if(result.error)throw result.error;
    state.stores=result.data||[];state.catalog=new Map(state.stores.map(s=>[s.store_code,s]));return state.stores;
  }
  async function loadMonth(date,force=false){
    const month=date.slice(0,7);if(state.monthLoads.has(month))return state.monthLoads.get(month);if(!force&&state.monthCache.has(month))return state.monthCache.get(month);
    const work=(async()=>{
      await loadDirectory();const r=S.range(date,'month');
      const [batchRows,reportResult,reference,powerbiData]=await Promise.all([
        paged('t998_score_import_batches','*',q=>q.gte('report_date',r.start).lte('report_date',r.end),'report_date'),
        db.from('t998_operations_daily_reports').select('*').gte('record_date',r.start).lte('record_date',r.end).order('record_date'),
        db.rpc('t998_get_operations_reference',{p_month:r.start}),
        window.OpsForecast.load(db,r.start,r.end)
      ]);
      if(reportResult.error)throw reportResult.error;if(reference.error)throw reference.error;
      const batches=M.latestBatches(batchRows),ids=batches.map(b=>b.id),rows=ids.length?await paged('t998_score_import_rows','batch_id,row_number,store_code,restaurant_name,order_number,payload',q=>q.in('batch_id',ids),'batch_id'):[];
      return {rows,batches,reports:reportResult.data||[],history:reference.data?.history||[],mapping:reference.data?.mapping||[],powerbiData};
    })();state.monthLoads.set(month,work);
    try{const data=await work;state.monthCache.set(month,data);return data;}finally{state.monthLoads.delete(month);}
  }
  async function loadRange(r,force=false){
    const parts=await Promise.all(S.months(r.start,r.end).map(d=>loadMonth(d,force))),data={};
    for(const key of ['rows','batches','reports','history','mapping'])data[key]=parts.flatMap(p=>p[key]);data.powerbiData={history:parts.flatMap(p=>p.powerbiData.history)};return data;
  }
  function model(date,p,data=state.cache){return M.build({...data,mapping:new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code])),catalog:state.catalog,...S.range(date,p)});}
  function metricsRows(s){return [
    ['去年單數',s.forecast===null?null:s.prior,'單'],['預估單數',s.forecast,'單'],['實際總單數',s.tc,'單'],['SSTG%',s.sstg,'%'],['TC預估達成率',s.tcAchievement,'%'],['實際工時',s.actualHours,'hrs'],['TPLH（扣FA）',s.tplh,''],['第三方佔比',s.faShare,'%'],['D7達成率',s.d7,'%'],['D25達成率',s.d25,'%'],
    ['FA單數',s.fa,'單'],['預估工時',s.forecastHours,'hrs'],['SSTG%（扣FA）',s.sstgExFA,'%'],['預估工時達成率',s.hoursAchievement,'%'],['QT',s.qt,'分'],['平均留店時間',s.d7Avg,'秒'],['平均送達時間',s.d25Avg,'秒']
  ];}
  function formattedMetric(key,value,unit){return unit==='%'?pct(value):unit==='秒'?time(value):fmt(value,['hrs','分',''].includes(unit)?2:0);}
  function renderMetrics(v){
    const hasScores=[...v.days.values()].some(day=>day.types.has('ByOrder')&&!day.scoreExcluded);
    const primary=['實際總單數','SSTG%','TPLH（扣FA）','第三方佔比','D7達成率','D25達成率','實際工時','TC預估達成率'];
    const all=metricsRows(v.summary);
    const card=([key,value,unit])=>'<article class="ops-kpi-card"><h4>'+escape(({'實際總單數':'實際 TC','D7達成率':'D7','D25達成率':'D25','SSTG%':'SSTG','TPLH（扣FA）':'TPLH','TC預估達成率':'TC 預估達成率'})[key]||key)+'</h4><strong>'+(!hasScores&&key!=='實際工時'?'—':formattedMetric(key,value,unit))+'</strong></article>';
    E('opsSummaryMetrics').innerHTML='<h3 class="ops-summary-period">'+escape(periodTitle(selectedDate(),period()))+'</h3><div class="ops-kpi-cards">'+primary.map(key=>card(all.find(row=>row[0]===key))).join('')+'</div><details class="ops-secondary"><summary>其他指標</summary><div class="ops-kpi-cards ops-secondary-cards">'+all.filter(row=>!primary.includes(row[0])).map(card).join('')+'</div></details>';
  }
  function warnings(v,isDay,date){
    const messages=[];if(v.missingPairs.length)messages.push('尚缺另一份成績檔：'+v.missingPairs.map(x=>x.slice(5)).join('、'));
    if(v.missingHourDays.length)messages.push(isDay?'尚有 '+v.days.get(date).missingAreas+' 區未填工時':'尚有 '+v.missingHourDays.length+' 天工時未填完整');
    if(v.hoursWithoutScores.length)messages.push('有工時但尚無成績：'+v.hoursWithoutScores.map(x=>x.slice(5)).join('、'));
    if(v.invalidHourDays.length)messages.push('調出工時超過可用工時：'+v.invalidHourDays.map(x=>x.slice(5)).join('、'));
    if(v.missingBaselineDays.length)messages.push('去年 TC 缺少資料：'+v.missingBaselineDays.map(x=>x.slice(5)).join('、'));
    if(v.areas.has('?'))messages.push('有餐廳尚未設定區域');return messages;
  }
  function periodTitle(date,p){const r=S.range(date,p);return p==='day'?date:(p==='week'?S.weekLabel(date)+'　':'')+r.start+' ～ '+r.end;}
  function periodRecords(date,p,v){
    const days=[...v.days.values()],notes=days.filter(d=>String(d.report?.special_notes||'').trim()),excluded=days.filter(d=>d.report?.score_excluded);
    const list='<div class="ops-context-list">'+(excluded.length?'<div><b>不計成績</b>　'+excluded.map(d=>d.date.slice(5).replace('-','/')+(d.report?.special_notes?' '+escape(d.report.special_notes):'')).join('、')+'</div>':'')+(notes.length?notes.filter(d=>!d.report?.score_excluded).map(d=>'<div><b>'+d.date.slice(5).replace('-','/')+' 特殊事項</b>　'+escape(d.report.special_notes)+'</div>').join(''):'')+(!excluded.length&&!notes.length?'<div>本期尚無特殊事項</div>':'')+'</div>';
    if(state.context==='summary'){
      let target=E('opsSummaryContext');if(!target){target=document.createElement('section');target.id='opsSummaryContext';target.className='ops-report-card';E('opsSummaryMetrics').after(target);}target.hidden=!notes.length&&!excluded.length;target.innerHTML='<h3>'+(p==='day'?'當日特殊備註':'期間特殊備註')+'</h3>'+list;return;
    }
    const target=E('opsAnalysisSummary');if(!target)return;
    if(p!=='day'){target.innerHTML='<section class="ops-report-card"><h3>週期特殊事項</h3>'+list+'</section>';return;}
    const day=v.days.get(date),report=day?.report||{};
    target.innerHTML='<section class="ops-report-card ops-daily-context"><h3>當日成績設定</h3><label class="ops-exclude-row"><input id="opsScoreExcluded" type="checkbox" '+(report.score_excluded?'checked':'')+'> 不計本日成績</label><label class="ops-note-field">當日特殊事項<textarea id="opsSpecialNotes" maxlength="2000" rows="3" placeholder="輸入當日特殊事項">'+escape(report.special_notes||'')+'</textarea></label><button id="opsSaveDailyContext" class="action-btn primary" type="button">儲存當日設定</button><div id="opsDailyContextStatus" class="ops-message" role="status"></div></section>';
    E('opsSaveDailyContext').onclick=async()=>{
      const excluded=E('opsScoreExcluded').checked,notes=E('opsSpecialNotes').value.trim(),status=E('opsDailyContextStatus');status.textContent='儲存中…';
      try{const exists=await db.from('t998_operations_daily_reports').select('record_date').eq('record_date',date).maybeSingle();if(exists.error)throw exists.error;const payload={score_excluded:excluded,special_notes:notes,updated_by:(await db.auth.getUser()).data.user?.id||null,updated_at:new Date().toISOString()};const saved=exists.data?await db.from('t998_operations_daily_reports').update(payload).eq('record_date',date):await db.from('t998_operations_daily_reports').insert({record_date:date,...payload});if(saved.error)throw saved.error;status.textContent='已儲存';await refresh(true);}catch(e){status.textContent='儲存失敗：'+e.message;}
    };
  }
  function valueInput(area,date,value){return '<input class="ops-area-hour" type="number" min="0" max="9999" step="0.25" inputmode="decimal" data-area="'+area+'" data-date="'+date+'" value="'+(value===null?'':value)+'" aria-label="'+escape(labels.get(area))+'總工時">';}
  function renderScores(date,v){
    const p=period(),day=v.days.get(date),isDay=p==='day',s=v.summary,hasScores=[...v.days.values()].some(d=>d.types.has('ByOrder'));
    E('opsPeriodLabel').textContent='區域成績　'+periodTitle(date,p);
    E('opsFileStatus').innerHTML=['ByDate','ByOrder'].map(type=>{const b=state.cache.batches.find(x=>x.report_date===date&&x.report_type===type);return '<div class="ops-file-card '+(b?'ready':'')+'"><b>'+type+'</b><span>'+date+'</span><strong>'+(b?'已匯入 '+fmt(b.row_count)+' 筆':'尚未匯入')+'</strong></div>';}).join('');
    const areaRows=[...M.AREAS,...(v.areas.has('?')?[['?','未分類']]:[])];
    const cells=x=>'<td data-label="TC">'+(hasScores?fmt(x.tc):'—')+'</td><td data-label="FA">'+(hasScores?fmt(x.fa):'—')+'</td><td data-label="第三方佔比">'+pct(x.faShare)+'</td><td data-label="D7">'+pct(x.d7)+'</td><td data-label="D25">'+pct(x.d25)+'</td>';
    E('opsAnalysisTable').innerHTML='<table class="ops-area-table"><thead><tr><th>區域</th><th>TC</th><th>FA</th><th>第三方佔比</th><th>D7</th><th>D25</th><th>總工時</th></tr></thead><tbody>'+areaRows.map(([a,label])=>{const hours=isDay?M.number(day?.report?.area_hours?.[a]):v.hourTotals.get(a)?.count?v.hourTotals.get(a).hours:null;return '<tr><th>'+label+'</th>'+cells(v.areas.get(a))+'<td data-label="總工時">'+(isDay&&a!=='?'?valueInput(a,date,hours):fmt(hours,2))+'</td></tr>';}).join('')+'</tbody><tfoot><tr><th>合計</th>'+cells(s)+'<td data-label="總工時">'+fmt(s.totalHours,2)+'</td></tr></tfoot></table>';
    const report=day?.report;
    E('opsLaborAdjustments').innerHTML='<div class="ops-labor-grid"><label>合計總工時<output>'+fmt(s.totalHours,2)+'</output></label><label>調出工時'+(isDay?'<input id="opsTransferOut" type="number" min="0" max="9999" step="0.25" inputmode="decimal" value="'+(report?.transfer_out_hours??0)+'">':'<output>'+fmt(s.transferOut,2)+'</output>')+'</label><label>調入工時'+(isDay?'<input id="opsTransferIn" type="number" min="0" max="9999" step="0.25" inputmode="decimal" value="'+(report?.transfer_in_hours??0)+'">':'<output>'+fmt(s.transferIn,2)+'</output>')+'</label><label>實際工時<output>'+fmt(s.actualHours,2)+'</output></label></div>';
    bindHours();renderMonthHours(date);renderDayList(S.range(date,p));periodRecords(date,p,v);
  }
  function renderRank(target,result,key,details,empty){
    E(target).innerHTML=result.top.length?'<ol class="ops-rank-list">'+result.top.map(x=>'<li><span class="ops-rank-number">'+x.rank+'</span><div><strong>'+escape(x.store_code)+' '+escape(x.restaurant_name)+'</strong><span>'+details(x)+'</span></div><b>'+x[key]+(key==='count'?' 筆':' 項')+'</b></li>').join('')+'</ol>':'<div class="ops-empty">'+empty+'</div>';
  }
  function renderSummary(date,v){
    const p=period(),r=S.range(date,p);
    renderMetrics(v);
    const acStoreCodes=new Set(M.AC_ASSIGNMENTS.flatMap(ac=>ac.stores).filter(code=>!M.NON_DELIVERY_STORES.has(code)));
    const eligibleDelay=state.records.delay.filter(x=>acStoreCodes.has(String(x.store_code)));
    const grouped=new Map();for(const row of eligibleDelay){if(row.record_date<r.start||row.record_date>r.end)continue;const key=String(row.store_code),entry=grouped.get(key)||{store_code:key,restaurant_name:row.restaurant_name,count:0,pending:0};entry.count++;if(row.status!=='completed')entry.pending++;grouped.set(key,entry);}const sorted=[...grouped.values()].sort((a,b)=>b.count-a.count||a.store_code.localeCompare(b.store_code)),cutoff=sorted[Math.min(2,sorted.length-1)]?.count;let last=null,rank=0;const delayTop=sorted.filter(x=>x.count>=cutoff).map((x,i)=>{if(last!==x.count)rank=i+1;last=x.count;return {...x,rank};});
    E('opsDelayRank').innerHTML=renderPriorityRestaurants(delayTop,x=>x.count+' 筆',x=>'待回覆 '+x.pending+' 筆','本期沒有等餐紀錄');
    renderAcWaitSummary(state.records.delay,r,v);renderAcLineSummary(state.records.line,r);renderSummaryCounts(v,r);periodRecords(date,p,v);
  }
  function renderAcWaitSummary(records,r,v){
    const acByStore=new Map();for(const ac of M.AC_ASSIGNMENTS)for(const code of ac.stores)if(!M.NON_DELIVERY_STORES.has(code))acByStore.set(code,ac.name);
    const counts=new Map(M.AC_ASSIGNMENTS.map(ac=>[ac.name,0]));
    for(const row of records){if(row.record_date<r.start||row.record_date>r.end||M.NON_DELIVERY_STORES.has(String(row.store_code)))continue;const name=acByStore.get(String(row.store_code));if(name)counts.set(name,(counts.get(name)||0)+1);}
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    const pending=new Map(),orders=new Map();
    for(const row of records){if(row.record_date<r.start||row.record_date>r.end||row.status==='completed')continue;const name=acByStore.get(String(row.store_code));if(name)pending.set(name,(pending.get(name)||0)+1);}
    if(v)for(const day of v.days.values())for(const order of day.orders){const name=acByStore.get(String(order.store_code));if(name)orders.set(name,(orders.get(name)||0)+1);}
    E('opsDelayAcSummary').innerHTML='<table class="ops-summary-ac-table"><thead><tr><th>AC</th><th>登記</th><th>待回覆</th><th>等餐／TC</th></tr></thead><tbody>'+ranked.map(([name,count])=>'<tr><td>'+escape(name)+'</td><td>'+count+' 筆</td><td>'+(pending.get(name)||0)+'</td><td>'+pct(orders.get(name)?count/orders.get(name):null)+'</td></tr>').join('')+'</tbody></table>';
  }
  function renderAcLineSummary(records,r){
    const acByStore=new Map();for(const ac of M.AC_ASSIGNMENTS)for(const code of ac.stores)if(!M.NON_DELIVERY_STORES.has(code))acByStore.set(code,ac.name);
    const acStats=new Map(M.AC_ASSIGNMENTS.map(ac=>[ac.name,{count:0,done:0}])),storeStats=new Map();
    for(const row of records){if(row.record_date<r.start||row.record_date>r.end||M.NON_DELIVERY_STORES.has(String(row.store_code)))continue;const code=String(row.store_code),name=acByStore.get(code);if(!name)continue;const done=Number(!!row.line_completed)+Number(!!row.signature_completed),a=acStats.get(name);a.count++;a.done+=done;const s=storeStats.get(code)||{store_code:code,restaurant_name:row.restaurant_name,count:0,done:0};s.count++;s.done+=done;storeStats.set(code,s);}
    const acRates=[...acStats].map(([name,x])=>({name,count:x.count,rate:x.count?x.done/(x.count*2):null})).sort((a,b)=>a.rate===null?(b.rate===null?a.name.localeCompare(b.name):1):b.rate===null?-1:a.rate-b.rate||a.name.localeCompare(b.name));
    const expected=new Map();
    const end=typeof opsToday==='function'&&opsToday()<r.end?opsToday():r.end;
    for(const date of S.dates(r.start,end))for(const ac of M.AC_ASSIGNMENTS){
      expected.set(ac.name,(expected.get(ac.name)||0)+ac.stores.filter(code=>!M.NON_DELIVERY_STORES.has(code)).length);
    }
    E('opsLineAcSummary').innerHTML='<table class="ops-summary-ac-table"><thead><tr><th>AC</th><th>達成率</th><th>已登記</th><th>待檢查</th></tr></thead><tbody>'+acRates.map(x=>'<tr><td>'+escape(x.name)+'</td><td>'+(x.rate===null?'—':(x.rate*100).toFixed(1)+'%')+'</td><td>'+x.count+'</td><td>'+Math.max(0,(expected.get(x.name)||0)-x.count)+'</td></tr>').join('')+'</tbody></table>';
    const worstStores=[...storeStats.values()].map(x=>({...x,rate:x.done/(x.count*2)})).filter(x=>x.rate<1).sort((a,b)=>a.rate-b.rate||a.store_code.localeCompare(b.store_code));const cutoff=worstStores[Math.min(2,worstStores.length-1)]?.rate;const worstTied=worstStores.filter(x=>x.rate<=cutoff);let lastRate=null,rank=0;worstTied.forEach((x,i)=>{if(x.rate!==lastRate)rank=i+1;x.rank=rank;lastRate=x.rate;});
    E('opsLineRank').innerHTML=renderPriorityRestaurants(worstTied,x=>(x.rate*100).toFixed(1)+'%',x=>'已登記 '+x.count+' 次','本期沒有待改善紀錄');
  }
  function renderSummaryCounts(v,r){
    const dates=S.dates(r.start,r.end<opsToday()?r.end:opsToday());
    const activeCodes=date=>new Set(M.AC_ASSIGNMENTS.flatMap(ac=>ac.stores).filter(code=>!M.NON_DELIVERY_STORES.has(code)));
    const delays=state.records.delay.filter(row=>row.record_date>=r.start&&row.record_date<=r.end&&activeCodes(row.record_date).has(String(row.store_code)));
    const tail=value=>String(value||'').trim().slice(-4);
    const orderKeys=new Set([...v.days.values()].flatMap(day=>day.orders.map(order=>day.date+'|'+order.store_code+'|'+tail(order.order_number))));
    const matched=delays.filter(row=>orderKeys.has(row.record_date+'|'+row.store_code+'|'+tail(row.order_number))).length;
    const tiles=items=>'<div class="ops-summary-counts">'+items.map(([name,value])=>'<div><span>'+name+'</span><b>'+fmt(value)+'</b></div>').join('')+'</div>';
    E('opsDelayCounts').innerHTML=tiles([['登記筆數',delays.length],['待回覆',delays.filter(row=>row.status!=='completed').length],['已配對',matched],['未配對',delays.length-matched]]);
    const byKey=new Map(state.records.line.map(row=>[row.record_date+'|'+row.store_code,row]));
    let registered=0,unregistered=0,missingLine=0,missingSignature=0;
    for(const date of dates)for(const code of activeCodes(date)){
      const row=byKey.get(date+'|'+code);
      if(!row){unregistered++;continue;}
      registered++;
      if(!row.line_completed)missingLine++;
      if(!row.signature_completed)missingSignature++;
    }
    const suffix=period()==='day'?'餐廳':'店日';
    E('opsLineCounts').innerHTML=tiles([['已登記'+suffix,registered],['待檢查'+suffix,unregistered],['劃線缺項'+(period()==='day'?'':'店日'),missingLine],['簽名缺項'+(period()==='day'?'':'店日'),missingSignature]]);
  }
  function renderPriorityRestaurants(rows,metric,details,empty){
    if(!rows.length)return '<div class="ops-summary-priority-empty">'+empty+'</div>';
    const item=(x,i)=>'<li><span class="ops-summary-priority-rank">'+(x.rank||i+1)+'</span><div><strong>'+escape(x.store_code)+' '+escape(x.restaurant_name)+'</strong><span>'+details(x)+'</span></div><b>'+metric(x)+'</b></li>';
    return '<ol class="ops-summary-priority-list">'+rows.slice(0,3).map(item).join('')+'</ol>'+(rows.length>3?'<details class="ops-summary-ties"><summary>其餘同分餐廳（'+(rows.length-3)+' 間）</summary><ol class="ops-summary-priority-list">'+rows.slice(3).map((x,i)=>item(x,i+3)).join('')+'</ol></details>':'');
  }
  function render(){
    if(!state.cache)return;const d=selectedDate(),p=period(),v=model(d,p),messages=warnings(v,p==='day',d),target=E(state.context==='summary'?'opsSummaryWarnings':'opsReportWarnings');target.textContent=messages.join('；');target.hidden=state.context==='summary'||!messages.length;
    if(state.context==='summary')renderSummary(d,v);else renderScores(d,v);renderWeather();
  }
  function monthHourRows(date,data=state.cache){
    const v=model(date,'month',data),rows=[['日期',...M.AREAS.map(([,n])=>n+'工時'),'合計總工時','調出工時','調入工時','實際工時']];
    for(const d of v.days.values())rows.push([d.date,...M.AREAS.map(([a])=>M.number(d.report?.area_hours?.[a])),d.hours,d.report?Number(d.report.transfer_out_hours):null,d.report?Number(d.report.transfer_in_hours):null,d.actualHours]);
    rows.push(['月合計',...M.AREAS.map(([a])=>v.hourTotals.get(a).count?v.hourTotals.get(a).hours:null),v.summary.totalHours,v.summary.transferOut,v.summary.transferIn,v.summary.actualHours]);return rows;
  }
  function renderMonthHours(date){const rows=monthHourRows(date);E('opsMonthHours').innerHTML='<h3>'+date.slice(0,7)+' 各區工時</h3><div class="ops-table-wrap"><table class="ops-month-hours"><thead><tr>'+rows[0].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(1).map(row=>'<tr><th>'+row[0]+'</th>'+row.slice(1).map(x=>'<td>'+fmt(x,2)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  function renderDayList(r){
    const rows=S.dates(r.start,r.end).filter(date=>date<=opsToday()).map(date=>{const v=model(date,'day'),d=v.days.get(date),s=v.summary,active=d.types.has('ByOrder')&&!d.scoreExcluded;return '<tr><th><button type="button" data-report-date="'+date+'">'+date.slice(5).replace('-','/')+'</button></th><td>'+(active?fmt(s.tc):'—')+'</td><td>'+(active?pct(s.sstg):'—')+'</td><td>'+(active?pct(s.tcAchievement):'—')+'</td><td>'+(!d.scoreExcluded?fmt(s.actualHours,2):'—')+'</td><td>'+(active?fmt(s.tplh,2):'—')+'</td><td>'+(active?pct(s.faShare):'—')+'</td><td>'+(active?pct(s.d7):'—')+'</td><td>'+(active?pct(s.d25):'—')+'</td><td>'+(d.scoreExcluded?'不計成績':d.types.size===2?'齊全':d.types.size?'缺一檔':'待匯入')+(d.report?.special_notes?'｜'+escape(d.report.special_notes):'')+'</td></tr>';});
    E('opsDayList').innerHTML='<table class="ops-daily-table"><thead><tr><th>日期</th><th>TC</th><th>SSTG</th><th>預估達成率</th><th>實際工時</th><th>TPLH</th><th>FA佔比</th><th>D7</th><th>D25</th><th>成績檔</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
    E('opsDayList').querySelectorAll('[data-report-date]').forEach(b=>b.onclick=()=>window.OpsDateControl.set(b.dataset.reportDate,'day'));
  }
  function bindHours(){
    E('opsAnalysisTable').querySelectorAll('.ops-area-hour').forEach(input=>input.onchange=()=>{const hours=M.number(input.value);if(input.value!==''&&(hours===null||hours<0||hours>9999)){notify('工時請填入 0～9999');return;}queueSave({p_record_date:input.dataset.date,p_area_code:input.dataset.area,p_area_hours:hours});});
    for(const [id,param] of [['opsTransferOut','p_transfer_out'],['opsTransferIn','p_transfer_in']]){const input=E(id);if(input)input.onchange=()=>{const value=M.number(input.value)??0;if(value<0||value>9999){notify('調整工時請填入 0～9999');return;}queueSave({p_record_date:selectedDate(),[param]:value});};}
  }
  function queueSave(args){
    notify('儲存中…','scores');state.saveQueue=state.saveQueue.catch(()=>{}).then(async()=>{
      const r=await db.rpc('t998_save_operations_report',args);if(r.error)throw r.error;state.saveError=null;const row=r.data;
      for(const cache of [state.cache,state.monthCache.get(row.record_date.slice(0,7))]){if(!cache)continue;const i=cache.reports.findIndex(x=>x.record_date===row.record_date);if(i>=0)cache.reports[i]=row;else cache.reports.push(row);}
      notify('已儲存','scores');const focused=document.activeElement,key=focused?.dataset.area,id=focused?.id,value=focused?.value;render();const next=key?E('opsAnalysisTable').querySelector('[data-area="'+key+'"]'):(['opsTransferOut','opsTransferIn'].includes(id)?E(id):null);if(next&&state.context==='scores'){next.value=value;next.focus();}
    }).catch(e=>{state.saveError=e;notify('儲存失敗：'+e.message,'scores');});return state.saveQueue;
  }
  async function loadRecords(r){const [delay,line]=await Promise.all([paged('t998_delay_orders','*',q=>q.gte('record_date',r.start).lte('record_date',r.end)),paged('t998_line_signature_records','*',q=>q.gte('record_date',r.start).lte('record_date',r.end))]);return {delay,line};}
  async function refresh(force=false){
    const id=++state.request,d=selectedDate(),r=S.range(d,period()),context=state.context;notify('讀取中…',context);
    try{const [data,records]=await Promise.all([loadRange(r,force),context==='summary'?loadRecords(r):Promise.resolve(state.records)]);if(id!==state.request)return;state.cache=data;state.records=records;notify('',context);render();loadWeatherRange(r,force).then(()=>{if(id===state.request)renderWeather();});}catch(e){if(id===state.request)notify(e.message,context);throw e;}
  }
  async function loadWeather(month,force=false){
    month=month.slice(0,7);if(state.weatherLoads.has(month))return state.weatherLoads.get(month);if(!force&&state.weather.has(month))return;
    const work=(async()=>{try{const result=await db.functions.invoke('t998-operations-weather',{body:{month:month+'-01'}});if(result.error||result.data?.error)throw new Error(result.data?.error||'天氣暫時無法讀取');state.weather.set(month,result.data);state.weatherError.delete(month);}catch(e){state.weatherError.set(month,e.message);}})();state.weatherLoads.set(month,work);try{await work;}finally{state.weatherLoads.delete(month);}
  }
  async function loadWeatherRange(r,force=false){await Promise.all(S.months(r.start,r.end).map(d=>loadWeather(d,force)));}
  function weatherRow(date,city){return state.weather.get(date.slice(0,7))?.rows?.find(x=>x.date===date&&x.city===city);}
  function weatherText(row){if(!row)return '尚無天氣資料';if(['current','partial_current'].includes(row.status))return (row.weather||'最新觀測')+(row.stale?'（上次資料）':'');if(['pending','missing','unavailable','future'].includes(row.status))return {pending:'當日觀測尚未公布',missing:'測站無觀測資料',unavailable:'天氣查詢暫時失敗',future:'尚未到該日期'}[row.status];return row.trace?'微量降雨':row.precipitation===null?'雨量缺值':row.precipitation>0?'有降雨':'未測得降雨';}
  const weatherValue=row=>{if(!row||!['observed','partial','current','partial_current'].includes(row.status))return '';const current=['current','partial_current'].includes(row.status),values=[];if(row.temperature!==null)values.push((current?'氣溫 ':'均溫 ')+fmt(row.temperature,1)+' °C');if(row.trace)values.push('雨量 微量');else if(row.precipitation!==null)values.push((current?'累積雨量 ':'日雨量 ')+fmt(row.precipitation,1)+' mm');if(current&&row.observed_at)values.push(row.observed_at.slice(11,16)+' 觀測');return values.join(' ／ ');};
  function renderWeather(){
    const d=selectedDate(),p=period(),r=S.range(d,p),target=E(state.context==='summary'?'opsSummaryWeather':'opsWeather'),months=S.months(r.start,r.end),hasData=months.some(m=>state.weather.has(m.slice(0,7)));
    if(!hasData){target.textContent=months.map(m=>state.weatherError.get(m.slice(0,7))).find(Boolean)||'讀取中央氣象署觀測資料中…';return;}
    if(p==='day')target.innerHTML='<div class="ops-weather-cards">'+window.T998Config.weatherCities.map(city=>{const row=weatherRow(d,city);return '<article class="ops-weather-card"><h4>'+city+'　'+d+'</h4><strong>'+weatherText(row)+'</strong><div>'+weatherValue(row)+'</div><span>'+(row?escape(row.station_name)+'站 '+row.station_id:'')+'</span></article>';}).join('')+'</div>';
    else target.innerHTML='<div class="ops-table-wrap"><table class="ops-weather-table"><thead><tr><th>日期</th>'+window.T998Config.weatherCities.map(city=>'<th>'+escape(city)+'</th>').join('')+'</tr></thead><tbody>'+S.dates(r.start,r.end).filter(date=>date<=opsToday()).map(date=>'<tr><th>'+date.slice(5)+'</th>'+window.T998Config.weatherCities.map(city=>{const row=weatherRow(date,city);return '<td>'+weatherText(row)+'<br>'+weatherValue(row)+(row?'<br>'+escape(row.station_name)+'站 '+escape(row.station_id):'')+'</td>';}).join('')+'</tr>').join('')+'</tbody></table></div>';
    target.insertAdjacentHTML('beforeend','<div class="ops-weather-source"><a href="https://codis.cwa.gov.tw/StationData" target="_blank" rel="noopener">中央氣象署</a> · 各縣市代表測站</div>');
  }
  function appendTable(wb,name,rows,headers,percent=[]){
    const ws=XLSX.utils.json_to_sheet(rows,{header:headers});ws['!cols']=headers.map(h=>({wch:Math.max(14,h.length*2+2)}));
    for(let i=0;i<rows.length;i++)for(const key of percent){const address=XLSX.utils.encode_cell({r:i+1,c:headers.indexOf(key)});if(ws[address]?.t==='n')ws[address].z='0.0%';}XLSX.utils.book_append_sheet(wb,ws,name);
  }
  function appendScores(wb,data,r){
    const daily=[],areas=[];
    for(const date of S.dates(r.start,r.end)){
      const v=model(date,'day',data),d=v.days.get(date),s=v.summary,active=d.types.has('ByOrder')&&!d.scoreExcluded;
      daily.push({日期:date,週次:S.week(date).year+'-'+S.weekLabel(date),不計成績:d.scoreExcluded?'是':'否',特殊事項:d.report?.special_notes||'',去年單:s.forecast===null?null:s.prior,預估單:s.forecast,實際單:active?s.tc:null,FA:active?s.fa:null,SSTG:active?s.sstg:null,預估達成率:active?s.tcAchievement:null,合計工時:d.scoreExcluded?null:s.totalHours,調出工時:d.scoreExcluded?null:s.transferOut,調入工時:d.scoreExcluded?null:s.transferIn,實際工時:d.scoreExcluded?null:s.actualHours,TPLH:active?s.tplh:null,第三方佔比:active?s.faShare:null,D7:active?s.d7:null,D25:active?s.d25:null,D7達成單:active?s.d7Y:null,D7有效單:active?s.d7Y+s.d7N:null,D25達成單:active?s.d25Y:null,D25有效單:active?s.d25Y+s.d25N:null,ByDate已匯入:d.types.has('ByDate')?'是':'否',ByOrder已匯入:d.types.has('ByOrder')?'是':'否',工時完整:d.scoreExcluded?'不計':d.actualHours!==null?'是':'否',去年單完整:d.baselineComplete?'是':'否'});
      for(const [a,label] of [...M.AREAS,...(v.areas.has('?')?[['?','未分類']]:[])]){const x=v.areas.get(a);areas.push({日期:date,不計成績:d.scoreExcluded?'是':'否',特殊事項:d.report?.special_notes||'',區域代碼:a,區域:label,TC:active?x.tc:null,FA:active?x.fa:null,FA佔比:active?x.faShare:null,D7:active?x.d7:null,D25:active?x.d25:null,區域工時:d.scoreExcluded?null:M.number(d.report?.area_hours?.[a]),D7達成單:active?x.d7Y:null,D7有效單:active?x.d7Y+x.d7N:null,D25達成單:active?x.d25Y:null,D25有效單:active?x.d25Y+x.d25N:null});}
    }
    appendTable(wb,'每日成績',daily,['日期','週次','不計成績','特殊事項','去年單','預估單','實際單','FA','SSTG','預估達成率','合計工時','調出工時','調入工時','實際工時','TPLH','第三方佔比','D7','D25','D7達成單','D7有效單','D25達成單','D25有效單','ByDate已匯入','ByOrder已匯入','工時完整','去年單完整'],['SSTG','預估達成率','第三方佔比','D7','D25']);
    appendTable(wb,'區域每日成績',areas,['日期','不計成績','特殊事項','區域代碼','區域','TC','FA','FA佔比','D7','D25','區域工時','D7達成單','D7有效單','D25達成單','D25有效單'],['FA佔比','D7','D25']);
  }
  async function exportCombined(p){
    const buttons=[...E('opsSummaryPanel').querySelectorAll('.ops-export-bottom button')];buttons.forEach(b=>b.disabled=true);
    try{
      await state.saveQueue;if(state.saveError)throw new Error('工時尚未儲存成功，請先重新儲存');
      const d=selectedDate(),r=S.range(d,p);if(r.start>opsToday())throw new Error('所選日期尚未到');notify('匯出中…','summary');
      const [data,records]=await Promise.all([loadRange(r,true),loadRecords(r),loadWeatherRange(r)]);const v=M.build({...data,mapping:new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code])),catalog:state.catalog,...r}),wb=XLSX.utils.book_new(),hasScores=[...v.days.values()].some(x=>x.types.has('ByOrder')&&!x.scoreExcluded);
      const summary=[['起始日期',r.start],['結束日期',r.end],['成績已匯入日數',[...v.days.values()].filter(x=>x.types.size===2).length],...metricsRows(v.summary).map(([k,value,unit])=>[k,!hasScores&&!['去年單數','預估單數','預估工時','實際工時'].includes(k)?null:value,unit])];
      const ws=XLSX.utils.aoa_to_sheet([['營運總覽','數值','單位'],...summary,['預估公式',window.OpsForecast.FORMULA,'']]);ws['!cols']=[{wch:24},{wch:22},{wch:12}];summary.forEach((r,i)=>{if(r[2]==='%'&&ws['B'+(i+2)])ws['B'+(i+2)].z='0.0%';});XLSX.utils.book_append_sheet(wb,ws,'營運總覽');appendScores(wb,data,r);
      appendTable(wb,'劃線簽名',S.lineExport(state.stores,records.line,r.start,r.end,opsToday()),['日期','店號','餐廳','是否登記','劃線','簽名','登記時間','更新時間']);
      appendTable(wb,'等餐紀錄',records.delay.map(x=>({日期:x.record_date,店號:x.store_code,餐廳:x.restaurant_name,訂單編號:x.order_number,狀態:x.status==='completed'?'已回覆':'待回覆',等餐原因:x.reason||'',登記時間:x.created_at,回覆時間:x.responded_at||''})),['日期','店號','餐廳','訂單編號','狀態','等餐原因','登記時間','回覆時間']);
      const weather=S.dates(r.start,r.end).flatMap(date=>window.T998Config.weatherCities.map(city=>{const x=weatherRow(date,city),realtime=['current','partial_current'].includes(x?.status);return {日期:date,城市:city,測站:x?.station_name||'',測站代碼:x?.station_id||'',觀測類型:realtime?'即時觀測':'日觀測',平均氣溫:realtime?null:x?.temperature??null,即時氣溫:realtime?x?.temperature??null:null,觀測時間:x?.observed_at||'',降雨毫米:x?.precipitation??null,微量降雨:x?.trace?'是':'否',觀測狀態:x?.status||'unavailable',來源:x?.source_url||'https://codis.cwa.gov.tw/StationData',查詢時間:state.weather.get(date.slice(0,7))?.fetched_at||''};}));
      appendTable(wb,'天氣觀測',weather,['日期','城市','測站','測站代碼','觀測類型','平均氣溫','即時氣溫','觀測時間','降雨毫米','微量降雨','觀測狀態','來源','查詢時間']);
      appendTable(wb,'預估依據',v.forecastDetails.map(x=>({日期:x.date,區域:x.area,去年對應日期:x.baselineDate,去年TC:x.baselineTc,預估TC:x.totalTc,需求工時:x.recommended,不計成績:x.excluded?'是':'否',缺漏餐廳:x.missingStores.join('、')})),['日期','區域','去年對應日期','去年TC','預估TC','需求工時','不計成績','缺漏餐廳']);
      XLSX.writeFile(wb,'營運'+({day:'日報',week:'週報',month:'月報'}[p])+'_'+r.start+(r.end===r.start?'':'_'+r.end)+'.xlsx');notify('已匯出成績、劃線簽名與等餐紀錄','summary');
    }catch(e){notify('匯出失敗：'+e.message,'summary');}finally{buttons.forEach(b=>b.disabled=false);}
  }
  async function findRestaurant(inputId,chooseUnique=true){
    await loadDirectory();const input=E(inputId),code=input.value.trim().replace(/\D/g,'').slice(0,3),list=E(inputId+'Choices'),name=E(inputId+'Name');input.value=code;
    if(!code){name.textContent='';list.replaceChildren();return null;}
    const matches=state.stores.filter(s=>s.store_code.startsWith(code)),selected=matches.find(s=>s.store_code===code)||(chooseUnique&&matches.length===1?matches[0]:null);
    if(selected){input.value=selected.store_code;name.textContent=selected.restaurant_name;list.replaceChildren();return selected;}
    name.textContent=matches.length?'請選擇餐廳':'查無此店號';list.innerHTML=matches.map(s=>'<button type="button" data-store-code="'+s.store_code+'">'+s.store_code+'　'+escape(s.restaurant_name)+'</button>').join('');
    list.querySelectorAll('button').forEach(b=>b.onclick=async()=>{input.value=b.dataset.storeCode;await findRestaurant(inputId);if(inputId==='opsLineStore')await fillLineState(input.value);});return null;
  }
  async function fillLineState(code,date=window.OpsDateControl?.date||opsToday()){
    const r=await db.from('t998_line_signature_records').select('line_completed,signature_completed').eq('record_date',date).eq('store_code',code).maybeSingle();if(E('opsLineStore').value!==code)return;if(r.error){E('opsLineMessage').textContent=r.error.message;return;}opsSetToggle('opsLineMark',!!r.data?.line_completed);opsSetToggle('opsSignMark',!!r.data?.signature_completed);
  }
  window.opsFindRestaurant=findRestaurant;
  for(const id of ['opsDelayStore','opsLineStore'])E(id).oninput=async()=>{if(id==='opsLineStore'){opsSetToggle('opsLineMark',false);opsSetToggle('opsSignMark',false);}try{const store=await findRestaurant(id);if(store&&id==='opsLineStore')await fillLineState(store.store_code);}catch(e){E(id+'Name').textContent=e.message;}};
  E('opsExportSelected').onclick=()=>exportCombined(period());
  window.opsLoadDailyAnalytics=()=>{state.context='scores';return refresh(true);};
  window.OpsReport={readRows:paged,directory:loadDirectory,fillLineState,open:(context,force=true)=>{state.context=context;return refresh(force);}};
})();
