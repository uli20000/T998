(function(){
  'use strict';
  const M=window.OpsMetrics,S=window.OpsSummary,$=id=>document.getElementById(id);
  const db=window.CenterRuntime.createClient(window.CENTER_CONFIG.supabaseUrl,window.CENTER_CONFIG.publishableKey);window.t998SupabaseClient=db;
  const labels={sstg:'SSTG',d7:'D7',d25:'D25',fa:'第三方佔比',waiting:'等餐',feedback:'080'};
  const independentStoreCodes=new Set(M.BUSINESS.independentStores||[]);
  const sharedDate={key:'t998-shared-date-v1',get(){try{const x=JSON.parse(localStorage.getItem(this.key)||'null');if(x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&['day','week','month'].includes(x.period)&&Date.now()-x.at<43200000)return x;}catch(e){}return null;},set(date,period){try{localStorage.setItem(this.key,JSON.stringify({date,period,at:Date.now()}));}catch(e){}}};
  const state={period:'day',date:null,month:null,metric:'sstg',stores:[],catalog:new Map(),cache:new Map(),weather:new Map(),data:null,previous:null,comparisonRange:null,request:0};
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>M.number(v);
  const fmt=(v,d=0)=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
  const pct=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':fmt(v*100,1)+'%';
  const targets=M.BUSINESS.kpiTargets;
  const goalPercent=value=>new Intl.NumberFormat('zh-TW',{style:'percent',maximumFractionDigits:2}).format(value);
  const goalSstg=value=>(value>0?'+':'')+goalPercent(value);
  const goalText=(key,format=goalPercent)=>targets[key]===null?'目標待核對':'目標 '+format(targets[key]);
  const goalFa=value=>goalPercent(value)+' 以下';
  const goalTplh=value=>fmt(value,1);
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const monthStart=d=>d.slice(0,7)+'-01';
  const addMonths=(d,n)=>{const x=new Date(monthStart(d)+'T12:00:00Z');x.setUTCMonth(x.getUTCMonth()+n);return x.toISOString().slice(0,10);};
  const selected=()=>state.period==='month'?state.month+'-01':state.date;
  const shiftDate=(d,n)=>M.addDays(d,n);
  const dateLabel=d=>{const weekday=['日','一','二','三','四','五','六'][new Date(d+'T12:00:00Z').getUTCDay()];return '星期'+weekday;};
  const monthLabel=d=>new Intl.DateTimeFormat('zh-TW',{timeZone:'UTC',year:'numeric',month:'long'}).format(new Date(d+'T12:00:00Z'));
  const shiftMonth=(d,n)=>addMonths(d,n);
  const fullWeek=d=>{const monday=M.addDays(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));return {start:monday,end:M.addDays(monday,6)};};
  const range=()=>state.period==='week'?fullWeek(state.date):M.range(selected(),state.period);
  const dates=(r)=>S.dates(r.start,r.end);
  function monthWeeks(d){const month=M.range(d,'month'),first=fullWeek(month.start).start,rows=[];for(let start=first;start<=month.end;start=M.addDays(start,7))rows.push(fullWeek(start));return rows;}
  function quarterMonths(d){const m=Number(d.slice(5,7)),q=Math.floor((m-1)/3)*3+1,y=d.slice(0,4);return [0,1,2].map(i=>y+'-'+String(q+i).padStart(2,'0'));}
  function weekIndex(d){const weeks=monthWeeks(d),r=fullWeek(d);return Math.max(0,weeks.findIndex(w=>w.start===r.start));}
  function periodLabel(r){return state.period==='day'?r.start:state.period==='week'?S.weekLabel(r.start)+'　'+r.start+' ～ '+r.end:state.month;}
  function status(message,error=false){$('status').textContent=message;$('status').className='period-status'+(error?' error':'');}
  async function paged(table,columns,filter,order='record_date'){
    const rows=[];for(let offset=0;;offset+=1000){let q=filter(db.from(table).select(columns));if(order)q=q.order(order);if(table==='t998_score_import_rows')q=q.order('row_number');const result=await q.range(offset,offset+999);if(result.error)throw result.error;rows.push(...(result.data||[]));if(!result.data||result.data.length<1000)return rows;}
  }
  async function loadDirectory(){if(state.stores.length)return;const result=await db.from('t998_restaurants').select('store_code,restaurant_name').eq('enabled',true).order('store_code');if(result.error)throw result.error;state.stores=result.data||[];state.catalog=new Map(state.stores.map(x=>[x.store_code,x]));}
  // 成績明細：每個匯入批次（id＋匯入時間）只下載一次，之後換週、換分頁直接重用；同時最多 6 個批次一起下載
  const rowCache=new Map(),ROW_CACHE_MAX=400;
  async function fetchRows(batches){
    const keyOf=b=>b.id+'|'+(b.imported_at||''),todo=batches.filter(b=>!rowCache.has(keyOf(b)));let next=0;
    const worker=async()=>{while(next<todo.length){const b=todo[next++];const rows=await paged('t998_score_import_rows','batch_id,row_number,store_code,restaurant_name,order_number,payload',q=>q.eq('batch_id',b.id),'batch_id');rowCache.set(keyOf(b),rows);}};
    await Promise.all(Array.from({length:Math.min(6,todo.length)},worker));
    while(rowCache.size>ROW_CACHE_MAX)rowCache.delete(rowCache.keys().next().value);
    return batches.flatMap(b=>rowCache.get(keyOf(b))||[]);
  }
  async function loadRange(r,force=false,{orderOnly=false}={}){
    const key=state.period+'|'+r.start+'|'+r.end+(orderOnly?'|order':'');if(!window.ScoreReadSource.enabled()&&!force&&state.cache.has(key))return state.cache.get(key);await loadDirectory();
    const monthRange=M.range(r.start,'month'),months=S.months(r.start,r.end);
    const firstWeek=fullWeek(r.start).start,lastWeek=fullWeek(r.end).start;
    const revisionSnapshot=await window.ScoreReadSource.load(db,window.OpsForecast.sampleStart(r.start),r.end);
    const revisionReport=revisionSnapshot?window.ScoreReadSource.within(revisionSnapshot,r.start,r.end):null;
    const [rawBatches,reports,monthReports,references,delays,campaigns,feedbackDaily,feedbackPeriod,weeklyNotesResult,powerbiData]=await Promise.all([
      revisionReport?Promise.resolve(revisionReport.batches):paged('t998_score_import_batches','id,report_date,report_type,imported_at,row_count',q=>q.gte('report_date',r.start).lte('report_date',r.end),'report_date'),
      db.from('t998_operations_daily_reports').select('*').gte('record_date',r.start).lte('record_date',r.end).order('record_date'),
      db.from('t998_operations_daily_reports').select('*').gte('record_date',monthRange.start).lte('record_date',r.end).order('record_date'),
      Promise.all(months.map(m=>db.rpc('t998_get_operations_reference',{p_month:m}))),
      paged('t998_delay_orders','record_date,store_code,restaurant_name,order_number,status,reason,responded_at,created_at',q=>q.gte('record_date',r.start).lte('record_date',r.end),'record_date'),
      db.from('t998_operations_coupon_campaigns').select('*').lte('active_from',r.end).gte('active_to',r.start).order('active_from'),
      paged('t998_feedback_import_rows','*',q=>q.in('source_type',['0800','4128']).gte('record_date',r.start).lte('record_date',r.end),'record_date'),
      ['week','month'].includes(state.period)?paged('t998_feedback_import_rows','*',q=>q.eq('source_type','GES').lte('period_start',r.end).gte('period_end',r.start),'restaurant_name'):Promise.resolve([]),
      db.from('t998_weekly_metric_action_notes').select('*').gte('week_start',M.addDays(firstWeek,-7)).lte('week_start',lastWeek).order('week_start').order('metric_key'),
      window.OpsForecast.load(db,r.start,r.end,revisionSnapshot?{scoreBatches:revisionSnapshot.batches}:{})
    ]);
    if(reports.error)throw reports.error;if(monthReports.error)throw monthReports.error;if(campaigns.error)throw campaigns.error;if(weeklyNotesResult.error)throw weeklyNotesResult.error;for(const x of references)if(x.error)throw x.error;
    const batches=M.latestBatches(rawBatches),rows=revisionReport?revisionReport.rows:batches.length?await fetchRows(orderOnly?batches.filter(b=>b.report_type==='ByOrder'):batches):[],refs=references.map(x=>x.data||{});
    const mapping=[...new Map(refs.flatMap(x=>x.mapping||[]).map(x=>[M.clean(x.restaurant_name),x])).values()],history=refs.flatMap(x=>x.history||[]);
    const data=M.scopeData({rows,batches,powerbiData,reports:reports.data||[],monthReports:monthReports.data||[],history,mapping,delays:delays||[],campaigns:campaigns.data||[],feedback:[...(feedbackDaily||[]),...(feedbackPeriod||[])],weeklyNotes:weeklyNotesResult.data||[]});state.cache.set(key,data);return data;
  }
  function model(data,r){return M.build({...data,mapping:new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code])),catalog:state.catalog,...r});}
  function previousRange(r,data=state.data){if(state.period==='day'){const report=(data?.reports||[]).find(x=>x.record_date===r.start),special=!!report&&(report.score_excluded||/特殊節日|國定假日|連假|停班課|颱風/.test(String(report.special_notes||'')));const dow=new Date(r.start+'T12:00:00Z').getUTCDay(),d=special?M.addDays(r.start,(6-dow+7)%7):M.addDays(r.start,-7);return {start:d,end:d,special};}if(state.period==='week')return fullWeek(M.addDays(r.start,-7));const d=addMonths(r.start,-1);return M.range(d,'month');}
  async function loadWeather(month){const key=String(month).slice(0,7),normalized=key+'-01';if(state.weather.has(key))return;const result=await db.functions.invoke('t998-operations-weather',{body:{month:normalized}});if(result.error||result.data?.error)throw new Error(result.data?.error||'天氣資料無法讀取');state.weather.set(key,result.data);}
  async function weatherForRange(r){await Promise.all(S.months(r.start,r.end).map(loadWeather));}
  function weatherRow(date,city){return state.weather.get(date.slice(0,7))?.rows?.find(x=>x.date===date&&x.city===city)||null;}
  function cityForArea(code){return M.BUSINESS.weatherCityByArea[code]||null;}
  // 依餐廳所在縣顯示天氣；沒有逐店設定時才用區域對應
  function cityForStore(storeCode,area){const map=M.BUSINESS.weatherCityByStore||{};return Object.prototype.hasOwnProperty.call(map,storeCode)?map[storeCode]:cityForArea(area);}
  function regionName(code){return M.AREAS.find(x=>x[0]===code)?.[1]||'未分類';}
  function baselineSource(data){return window.OpsForecast.prepare({history:data.powerbiData?.history||data.history,mapping:data.mapping,catalog:state.catalog,inScope:M.storeInScope});}
  function dateTime(value){const s=String(value??'').trim();if(!s||s==='-'||s==='—')return null;const match=s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);if(!match)return null;return Date.parse(match[1]+'T'+match[2]+':'+match[3]+':'+(match[4]||'00')+'+08:00');}
  function orderTail(v){const m=String(v||'').match(/(\d{4})$/);return m?m[1]:String(v||'').trim();}
  function storeAnalytics(data,r){
    const source=baselineSource(data);
    const excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),byStore=new Map(),byDayStore=new Map(),orders=[],byBatch=new Map(data.batches.map(b=>[b.id,b])),seen=new Set(),areaMap=new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code]));
    const storeOf=row=>{const code=String(row.store_code||'').trim(),catalog=state.catalog.get(code),name=row.restaurant_name||catalog?.restaurant_name||'',area=M.areaFor(row,areaMap,state.catalog);return {code,name:catalog?.restaurant_name||name||'未分類餐廳',area};};
    for(const row of data.rows){const batch=byBatch.get(row.batch_id);if(!batch||batch.report_type!=='ByOrder'||batch.report_date<r.start||batch.report_date>r.end||excluded.has(batch.report_date))continue;const identity=batch.report_date+'|'+(row.order_number||row.row_number);if(seen.has(identity))continue;seen.add(identity);const store=storeOf(row),key=store.code||M.clean(store.name),p=row.payload||{},x=byStore.get(key)||{key,...store,tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,lateY:0,lateN:0,lateKnown:0,wait:0,qtSum:0,qtN:0,nonFa:0,prior:0,priorN:0,activeDays:0};
      x.tc++;const fa=String(p['自動/手動']||'').trim()==='第三方',d7=String(p.D7||'').trim().toUpperCase(),d25=String(p.D25||'').trim().toUpperCase();if(fa)x.fa++;else{x.nonFa++;if(d7==='Y')x.d7Y++;if(d7==='N')x.d7N++;if(d25==='Y')x.d25Y++;if(d25==='N')x.d25N++;}
      const eta=dateTime(p['到達時間'])??dateTime(p['預計送達時間']),assigned=dateTime(p['指派時間']),late=eta!==null&&assigned!==null?assigned>eta-20*60000:null;if(late!==null){x.lateKnown++;if(late)x.lateY++;else x.lateN++;}const order={date:batch.report_date,store:key,storeCode:store.code,restaurant:store.name,area:store.area,order:String(row.order_number||''),fa,d7,d25,late,wait:false};orders.push(order);const dayKey=batch.report_date+'|'+key,day=byDayStore.get(dayKey)||{date:batch.report_date,...store,tc:0,prior:0};day.tc++;byDayStore.set(dayKey,day);byStore.set(key,x);
    }
    const delayByStore=new Map(),waitKeys=new Set();for(const row of data.delays){const key=String(row.store_code||'')||M.clean(row.restaurant_name),x=delayByStore.get(key)||{count:0,pending:0,replied:0,rows:[]};x.count++;if(row.status==='completed')x.replied++;else x.pending++;x.rows.push(row);delayByStore.set(key,x);waitKeys.add(String(row.record_date)+'|'+key+'|'+orderTail(row.order_number));}
    for(const order of orders){if(waitKeys.has(order.date+'|'+order.store+'|'+orderTail(order.order)))order.wait=true;}
    for(const row of data.rows){const batch=byBatch.get(row.batch_id);if(!batch||batch.report_type!=='ByDate'||batch.report_date<r.start||batch.report_date>r.end||excluded.has(batch.report_date))continue;const store=storeOf(row),key=store.code||M.clean(store.name),x=byStore.get(key);if(!x)continue;const qt=num((row.payload||{}).QT);if(qt!==null){x.qtSum+=qt;x.qtN++;}}
    // Include zero-order restaurant days when the center's ByOrder file exists, so weekly/monthly denominators remain complete.
    const activeDates=[...new Set(data.rows.map(row=>byBatch.get(row.batch_id)).filter(b=>b&&b.report_type==='ByOrder'&&b.report_date>=r.start&&b.report_date<=r.end&&!excluded.has(b.report_date)).map(b=>b.report_date))];
    for(const date of activeDates)for(const s of source.eligible(date)){
      const key=s.code||s.name;
      if(!byStore.has(key))byStore.set(key,{key,code:s.code,name:s.restaurant_name,area:s.area,tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,lateY:0,lateN:0,lateKnown:0,wait:0,qtSum:0,qtN:0,nonFa:0,prior:0,priorN:0,activeDays:0});
      if(!byDayStore.has(date+'|'+key))byDayStore.set(date+'|'+key,{date,code:s.code,name:s.restaurant_name,tc:0});
    }
    for(const day of byDayStore.values()){day.prior=window.OpsForecast?.isNewStore?.(day.code,day.date,day.name)?null:source.priorYear(day.name,day.date);const key=day.code||M.clean(day.name),store=byStore.get(key);if(store){store.activeDays++;if(day.prior!==null){store.prior+=day.prior;store.priorN++;}}}
    return [...byStore.values()].map(x=>{const wait=delayByStore.get(x.key)?.count||0;return {...x,prior:x.priorN===x.activeDays?x.prior:null,delayRows:delayByStore.get(x.key)?.rows||[],sstg:x.priorN===x.activeDays&&x.prior>0?x.tc/x.prior-1:null,d7:x.d7Y+x.d7N?x.d7Y/(x.d7Y+x.d7N):null,d25:x.d25Y+x.d25N?x.d25Y/(x.d25Y+x.d25N):null,faShare:x.tc?x.fa/x.tc:null,lateShare:x.lateKnown?x.lateY/x.lateKnown:null,wait,waitRatio:x.tc?wait/x.tc:null,qt:x.qtN?x.qtSum/x.qtN:null};}).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
  }
  function dailyStoreAnalytics(data,r){
    const source=baselineSource(data);
    const excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),stores=new Map(),byBatch=new Map(data.batches.map(b=>[b.id,b])),map=new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code])),seen=new Set();
    for(const row of data.rows){const b=byBatch.get(row.batch_id);if(!b||b.report_type!=='ByOrder'||b.report_date<r.start||b.report_date>r.end||excluded.has(b.report_date))continue;const storeCode=String(row.store_code||''),catalog=state.catalog.get(storeCode),name=catalog?.restaurant_name||row.restaurant_name||'',storeKey=storeCode||M.clean(name),identity=b.report_date+'|'+storeKey+'|'+(row.order_number||row.row_number);if(seen.has(identity))continue;seen.add(identity);const key=b.report_date+'|'+storeKey;let item=stores.get(key);if(!item){item={key,date:b.report_date,storeCode,name,area:M.areaFor(row,map,state.catalog),tc:0,prior:source.priorYear(name,b.report_date)};stores.set(key,item);}item.tc++;}
    return [...stores.values()];
  }
  function storeMetric(x,key){return key==='sstg'?x.sstg:key==='d7'?x.d7:key==='d25'?x.d25:key==='fa'?x.faShare:x.wait;}
  function sortedFor(rows,key){const usable=rows.filter(x=>storeMetric(x,key)!==null&&storeMetric(x,key)!==undefined);return usable.sort((a,b)=>(key==='fa'?storeMetric(a,key)-storeMetric(b,key):storeMetric(b,key)-storeMetric(a,key))||a.name.localeCompare(b.name,'zh-Hant'));}
  function worstFor(rows,key){const usable=rows.filter(x=>storeMetric(x,key)!==null&&storeMetric(x,key)!==undefined);return usable.sort((a,b)=>(key==='fa'?storeMetric(b,key)-storeMetric(a,key):storeMetric(a,key)-storeMetric(b,key))||a.name.localeCompare(b.name,'zh-Hant'));}
  function rankedStores(rows,key){const top=sortedFor(rows,key).slice(0,3),bottom=worstFor(rows,key).slice(0,5);return [...top,...bottom.filter(x=>!top.includes(x))];}
  function table(head,rows){return rows.length?'<div class="scroll"><table class="table"><thead><tr>'+head.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+escape(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<div class="empty">此期間沒有可用資料</div>';}
  function couponImpact(data,r){const groups=new Map(),campaigns=data.campaigns||[];for(const x of dailyStoreAnalytics(data,r)){if(!(x.prior>0))continue;const active=campaigns.filter(c=>c.active_from<=x.date&&c.active_to>=x.date),name=active.length?active.map(c=>c.campaign_name).sort().join('、'):'未記錄優惠券',g=groups.get(name)||{name,days:0,tc:0,prior:0};g.days++;g.tc+=x.tc;g.prior+=x.prior;groups.set(name,g);}return [...groups.values()].map(x=>[x.name,fmt(x.days),fmt(x.tc),fmt(x.prior),pct(x.prior?x.tc/x.prior-1:null)]);}
  function periodNotes(data,r){const reports=data.reports.filter(x=>x.record_date>=r.start&&x.record_date<=r.end&&(x.score_excluded||String(x.special_notes||'').trim()));if(!reports.length)return '';return '<section class="analysis-panel"><h3>期間特殊事項</h3>'+table(['日期','成績是否納入','特殊事項'],reports.map(x=>[x.record_date,x.score_excluded?'不計成績':'計入',x.special_notes||'—']))+'</section>';}
  function rankList(rows,key,startRank=1){return '<div class="rank-list">'+rows.map((x,i)=>'<div class="rank-row"><span class="rank-num">'+(startRank+i)+'</span><span class="rank-store">'+escape(x.code)+' '+escape(x.name)+'</span><span class="rank-metric">'+escape(key==='waiting'?fmt(x.wait)+' 筆':pct(storeMetric(x,key)))+'</span></div>').join('')+'</div>';}
  function feedbackGroups(data,source){const map=new Map();for(const x of data.feedback||[]){if(x.source_type!==source)continue;const key=x.restaurant_name||'未分類餐廳',v=map.get(key)||{name:key,code:x.store_code||'',count:0,rows:[]};v.count++;v.rows.push(x);if(!v.code&&x.store_code)v.code=x.store_code;map.set(key,v);}return [...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-Hant'));}
  // GES：週檢視用該週的檔；月檢視沒有整月檔時，把「週四落在該月」的每週資料依回應數加權匯總
  const GES_SCORES=['score_1sat','osat_survey','osat_google','osat_delivery','score_accuracy','score_environment','score_service','score_speed','score_food'];
  function gesForRange(all,r){
    const ges=(all||[]).filter(x=>x.source_type==='GES'&&x.period_start&&x.period_end),exact=ges.filter(x=>x.period_start===r.start&&x.period_end===r.end);
    if(exact.length||state.period!=='month')return exact;
    const weekly=ges.filter(x=>M.addDays(x.period_start,6)===x.period_end&&M.addDays(x.period_start,3)>=r.start&&M.addDays(x.period_start,3)<=r.end);
    const by=new Map();for(const x of weekly){const k=x.store_code||M.clean(x.restaurant_name);let t=by.get(k);if(!t){t={source_type:'GES',period_start:r.start,period_end:r.end,restaurant_name:x.restaurant_name,store_code:x.store_code,response_count:0,_w:{},_s:{},_weeks:new Set()};by.set(k,t);}
      const c=Number(x.response_count)||0;t.response_count+=c;t._weeks.add(x.period_start);for(const f of GES_SCORES){const v=Number(x[f]);if(x[f]===null||x[f]===undefined||!Number.isFinite(v)||!c)continue;t._s[f]=(t._s[f]||0)+v*c;t._w[f]=(t._w[f]||0)+c;}}
    const out=[...by.values()].map(t=>{const row={...t};for(const f of GES_SCORES)row[f]=t._w[f]?t._s[f]/t._w[f]:null;row.weeks=t._weeks.size;delete row._w;delete row._s;delete row._weeks;return row;});
    out.aggregatedWeeks=new Set(weekly.map(x=>x.period_start)).size;return out;
  }
  function feedbackSidebarRows(data){const first=(source)=>feedbackGroups(data,source)[0];const a=first('0800'),b=first('4128'),ges=gesForRange(data.feedback,range()).filter(x=>x.osat_survey!==null&&x.osat_survey!==undefined).sort((x,y)=>Number(x.osat_survey)-Number(y.osat_survey));return [{label:'0800',name:a?.name||'尚無資料',value:a?fmt(a.count)+' 筆':'—'},{label:'4128',name:b?.name||'尚無資料',value:b?fmt(b.count)+' 筆':'—'},{label:'GES OSAT最低',name:ges[0]?.restaurant_name||'尚無資料',value:ges[0]?pct(ges[0].osat_survey):'—'}];}
  function renderMetricTabs(){
    const labels=[['sstg','SG／TG'],['d7','D7／D25'],['fa','TPLH／FA'],['waiting','等餐'],['feedback','GES／080'],['alerts','🔔 預警'],['impact','🎯 影響度'],['weekly','📝 週報草稿'],['store','🏪 餐廳頁'],['actions','✅ 行動追蹤'],['drill','🔍 明細熱圖'],['staff','👷 排班派單']];
    const nav=$('metricTabs');
    if(!nav.dataset.bound){nav.addEventListener('click',event=>{const button=event.target.closest('[data-metric]');if(!button)return;state.metric=button.dataset.metric;syncMetricTab();try{renderMetric(state.data,state.previous,range());}catch(error){status('此成績頁載入失敗：'+(error.message||error),true);}});nav.dataset.bound='true';}
    nav.innerHTML=labels.map(([key,label])=>'<button type="button" class="'+(state.metric===key?'active':'')+'" data-metric="'+key+'" aria-pressed="'+(state.metric===key)+'">'+label+'</button>').join('');nav.classList.remove('hidden');
    const row=nav.parentElement,center=()=>{const on=nav.querySelector('.active');if(!on||row.scrollWidth<=row.clientWidth)return;const a=on.getBoundingClientRect(),b=row.getBoundingClientRect();if(a.width)row.scrollLeft+=a.left-b.left-(b.width-a.width)/2;};if(row&&typeof setTimeout==='function'){setTimeout(center,0);setTimeout(center,400);}
  }
  function syncMetricTab(){document.querySelectorAll('[data-metric]').forEach(button=>{const active=button.dataset.metric===state.metric;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});}
  function metricTitle(metric){return labels[metric]||labels.sstg;}
  function sstgPage(data,rows,r){const weatherGroups=new Map(),daily=dailyStoreAnalytics(data,r),current=model(data,r);for(const x of daily){const city=cityForStore(x.storeCode,x.area),wx=weatherRow(x.date,city),condition=!wx?'無天氣資料':Number(wx.precipitation)>0||wx.trace?'有降雨':'未測得降雨',key=x.area,g=weatherGroups.get(key)||{conditions:new Set(),storeDays:0};g.conditions.add(condition);g.storeDays++;weatherGroups.set(key,g);}const areas=M.areasForDate(r.start).map(([code,name])=>{const x=current.areas.get(code),w=weatherGroups.get(code);return {code,name,tc:x?.tc??null,prior:x?.prior??null,sstg:x?.sstg??null,stores:rows.filter(s=>s.area===code).length,weather:w?[...w.conditions].sort().join('、'):'無天氣資料',storeDays:w?.storeDays||0};}).filter(x=>x.stores>0).sort((a,b)=>(b.sstg??-Infinity)-(a.sstg??-Infinity)),ranked=rankedStores(rows,'sstg'),rankRows=ranked.map((x,i)=>[i<3?'前三':'後五',x.code,x.name,regionName(x.area),pct(x.sstg)]);return sssgRanking(data,r)+'<section class="analysis-panel"><h3>本期餐廳 SSTG 排名｜'+goalText('sstg',goalSstg)+'</h3>'+table(['區段','店號','餐廳','商圈','SSTG'],rankRows)+'</section><section class="analysis-panel"><h3>商圈 SSTG 與天氣</h3>'+table(['商圈','天氣','餐廳數','餐廳日','TC','去年同期 TC','SSTG'],areas.map(x=>[x.name,x.weather,fmt(x.stores),fmt(x.storeDays),fmt(x.tc),fmt(x.prior),pct(x.sstg)]))+'</section>';}
  function orderMoment(value,date){const direct=dateTime(value);if(direct!==null)return direct;const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);return m?Date.parse(date+'T'+String(m[1]).padStart(2,'0')+':'+m[2]+':'+(m[3]||'00')+'+08:00'):null;}
  function analysisOrders(data,r){
    const batches=new Map(data.batches.map(b=>[b.id,b])),excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),waitSet=new Set(data.delays.map(x=>String(x.record_date)+'|'+String(x.store_code||'')+'|'+orderTail(x.order_number))),byDateOrders=new Map(),orders=[],seen=new Set(),areaMap=new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code]));
    for(const row of data.rows){const b=batches.get(row.batch_id);if(!b||b.report_type!=='ByDate'||b.report_date<r.start||b.report_date>r.end||excluded.has(b.report_date))continue;const key=b.report_date+'|'+String(row.store_code||'')+'|'+orderTail(row.order_number);if(!byDateOrders.has(key))byDateOrders.set(key,row);}
    for(const row of data.rows){const b=batches.get(row.batch_id);if(!b||b.report_type!=='ByOrder'||b.report_date<r.start||b.report_date>r.end||excluded.has(b.report_date))continue;const p=row.payload||{},code=String(row.store_code||''),identity=b.report_date+'|'+code+'|'+orderTail(row.order_number);if(seen.has(identity))continue;seen.add(identity);const moment=orderMoment(p['落單時間']||p['下單時間']||p['訂單時間'],b.report_date),dateRow=byDateOrders.get(identity),distanceText=String(dateRow?.payload?.['距離']??''),distanceMatch=distanceText.match(/[0-9]+(?:\.[0-9]+)?/),distanceKm=distanceMatch?Number(distanceMatch[0]):null,assigned=dateTime(p['指派時間']),eta=dateTime(p['到達時間'])??dateTime(p['預計送達時間']),late=eta!==null&&assigned!==null?eta-assigned<=20*60000:null,courierDayId=String(p._courier_day_id||''),courierStoreCount=Number(p._courier_day_store_count),departure=orderMoment(p['外送出發'],b.report_date);orders.push({date:b.report_date,code,name:row.restaurant_name||state.catalog.get(code)?.restaurant_name||'未分類餐廳',area:M.areaFor(row,areaMap,state.catalog),order:String(row.order_number||''),fa:String(p['自動/手動']||'').trim()==='第三方',d7:String(p.D7||'').trim().toUpperCase(),d25:String(p.D25||'').trim().toUpperCase(),wait:waitSet.has(identity),moment,assigned,eta,late,departure,hasByDate:!!dateRow,distanceKm,courierDayId,courierStoreCount:Number.isFinite(courierStoreCount)?courierStoreCount:null,departureGroupSize:null,cluster:false,raw:p,dateRaw:dateRow?.payload||null});}
    const orderGroups=new Map(),departureGroups=new Map();for(const x of orders){if(x.moment!==null){const key=x.date+'|'+(x.code||M.clean(x.name)),list=orderGroups.get(key)||[];list.push(x);orderGroups.set(key,list);}if(x.courierDayId&&x.departure!==null){const key=x.date+'|'+x.courierDayId,list=departureGroups.get(key)||[];list.push(x);departureGroups.set(key,list);}}
    for(const list of orderGroups.values()){list.sort((a,b)=>a.moment-b.moment);let right=0;for(let left=0;left<list.length;left++){if(right<left)right=left;while(right<list.length&&list[right].moment-list[left].moment<=30*60000)right++;if(right-left>=6)for(let i=left;i<right;i++)list[i].cluster=true;}}
    for(const list of departureGroups.values()){
      list.sort((a,b)=>a.departure-b.departure||a.order.localeCompare(b.order));
      for(let left=0;left<list.length;){let right=left+1;while(right<list.length&&list[right].departure-list[left].departure<=3*60*1000)right++;const wave=list.slice(left,right),stores=new Set(wave.map(x=>x.code||M.clean(x.name)));if(stores.size===1)for(const x of wave)x.departureGroupSize=wave.length;left=right;}
    }
    return orders;
  }
  function periodSplit(orders){const groups={meal:{label:'餐期',orders:[]},nonmeal:{label:'非餐期',orders:[]}};for(const x of orders){if(x.moment===null)continue;const d=new Date(x.moment),hour=(d.getUTCHours()+8)%24,meal=(hour>=11&&hour<13)||(hour>=18&&hour<20);groups[meal?'meal':'nonmeal'].orders.push(x);}return Object.values(groups).map(g=>{const n=g.orders.length,fa=g.orders.filter(x=>x.fa).length,wait=g.orders.filter(x=>x.wait).length;return [g.label,fmt(n),fmt(fa),pct(n?fa/n:null),fmt(wait),pct(n?wait/n:null)];});}
  function concentrationRows(data,r){const orders=analysisOrders(data,r),timed=orders.filter(x=>x.moment!==null),groups=[{name:'集中單',list:timed.filter(x=>x.cluster)},{name:'非集中單',list:timed.filter(x=>!x.cluster)}];const rows=groups.map(g=>{const n=g.list.length,fa=g.list.filter(x=>x.fa).length,wait=g.list.filter(x=>x.wait).length;return [g.name,fmt(n),fmt(fa),pct(n?fa/n:null),fmt(wait),pct(n?wait/n:null)];});const missing=orders.filter(x=>x.moment===null).length;if(missing)rows.push(['資料不足',fmt(missing),'—','—','—','—']);return {orders,rows};}
  function mealOrder(x){const hour=(new Date(x.moment).getUTCHours()+8)%24;return (hour>=11&&hour<13)||(hour>=18&&hour<20);}
  function waitRankRows(orders,kind){const specs={cluster:['集中單等餐',x=>x.moment!==null&&x.cluster],noncluster:['非集中單等餐',x=>x.moment!==null&&!x.cluster],meal:['餐期等餐',x=>x.moment!==null&&mealOrder(x)],nonmeal:['非餐期等餐',x=>x.moment!==null&&!mealOrder(x)]},[label,test]=specs[kind],groups=new Map();for(const x of orders){if(!test(x))continue;const key=x.code||x.name,g=groups.get(key)||{code:x.code,name:x.name,total:0,wait:0};g.total++;if(x.wait)g.wait++;groups.set(key,g);}const rows=[...groups.values()].filter(x=>x.wait>0).sort((a,b)=>(b.wait/b.total)-(a.wait/a.total)||b.wait-a.wait||a.name.localeCompare(b.name,'zh-Hant')).slice(0,3).map((x,i)=>[i+1,x.code,x.name,fmt(x.wait),fmt(x.total),pct(x.total?x.wait/x.total:null)]);return {label,rows};}
  function waitRankPanel(orders,kind){const x=waitRankRows(orders,kind);return '<section class="analysis-panel"><h4>'+x.label+'｜前三名餐廳</h4>'+table(['名次','店號','餐廳','等餐筆數','該組訂單數','等餐比例'],x.rows)+'</section>';}
  function waitGroupSummaryPanel(orders,kind){const specs=kind==='cluster'?[['集中單',x=>x.moment!==null&&x.cluster],['非集中單',x=>x.moment!==null&&!x.cluster]]:[['餐期',x=>x.moment!==null&&mealOrder(x)],['非餐期',x=>x.moment!==null&&!mealOrder(x)]];const rows=specs.map(([label,test])=>{const group=orders.filter(test),wait=group.filter(x=>x.wait).length;return [label,fmt(group.length),fmt(wait),pct(group.length?wait/group.length:null)];});return '<section class="analysis-panel"><h4>'+(kind==='cluster'?'集中單／非集中單等餐比例':'餐期／非餐期等餐比例')+'</h4>'+table(['訂單群組','有效訂單','等餐單','等餐比例'],rows)+'</section>';}
  function factorComparisonPanel(orders,metric,title,groupFor){const key=String(metric).toLowerCase(),all=orders.filter(x=>!independentStoreCodes.has(x.code)&&!x.fa&&['Y','N'].includes(x[key])&&(!groupFor.include||groupFor.include(x))),known=all.filter(x=>groupFor(x)!==null),missing=all.filter(x=>groupFor(x)===null),groups=groupFor.groups.map(([label,test])=>{const list=known.filter(test),wins=list.filter(x=>x[key]==='Y').length;return [label,fmt(list.length),fmt(wins),pct(list.length?wins/list.length:null)];});if(missing.length)groups.push(['資料不足',fmt(missing.length),fmt(missing.filter(x=>x[key]==='Y').length),'—']);return '<section class="analysis-panel"><h4>'+title+'</h4>'+table([groupFor.columnLabel||'訂單群組','有效訂單','達成單','達成率'],groups)+'</section>';}
  function factorComparisonPanels(data,r,metric){const orders=analysisOrders(data,r),by=(fn,labels)=>{fn.groups=labels;return fn;},meal=x=>x.moment===null?null:mealOrder(x);return [
    factorComparisonPanel(orders,metric,'等餐分析',by(x=>x.wait,[['有等餐登記',x=>x.wait],['無等餐登記',x=>!x.wait]])),
    factorComparisonPanel(orders,metric,'晚派分析',by(x=>x.late,[['晚派（抵達前 20 分鐘內派單）',x=>x.late],['未晚派',x=>!x.late]])),
    factorComparisonPanel(orders,metric,'集中單分析',by(x=>x.moment===null?null:x.cluster,[['集中單',x=>x.cluster],['非集中單',x=>!x.cluster]])),
    factorComparisonPanel(orders,metric,'餐期單分析',by(meal,[['餐期',x=>meal(x)===true],['非餐期',x=>meal(x)===false]])),
    factorComparisonPanel(orders,metric,'距離分析',by(x=>x.distanceKm===null?null:x.distanceKm<=2,[['2 公里內',x=>x.distanceKm!==null&&x.distanceKm<=2],['超過 2 公里',x=>x.distanceKm!==null&&x.distanceKm>2]])),
    factorComparisonPanel(orders,metric,'併單分析｜同外送員同日離店 3 分鐘內',Object.assign(by(x=>x.departureGroupSize===null?null:x.departureGroupSize>=3,[['剛好 2 單',x=>x.departureGroupSize===2],['3 單以上',x=>x.departureGroupSize>=3]]),{include:x=>x.departureGroupSize>=2,columnLabel:'出門單量'}))
  ].join('');}
  function d7d25Page(data,rows,r){const nonIndependent=rows.filter(x=>!independentStoreCodes.has(String(x.code))),ranked7=rankedStores(nonIndependent,'d7'),ranked25=rankedStores(nonIndependent,'d25'),factors=metric=>'<section class="analysis-panel factor-section"><h3>'+metric+'｜非獨立店因素比較</h3><div class="analysis-grid factor-grid">'+factorComparisonPanels(data,r,metric)+'</div></section>';return '<div class="analysis-grid"><section class="analysis-panel"><h3>非獨立店 D7 排名｜前三名與後五名（'+goalText('d7')+'）</h3>'+table(['名次','店號','餐廳','商圈','D7','等餐／TC','晚派單比例'],ranked7.map((x,i)=>[i<3?'前三':'後五',x.code,x.name,regionName(x.area),pct(x.d7),pct(x.waitRatio),pct(x.lateShare)]))+'</section><section class="analysis-panel"><h3>非獨立店 D25 排名｜前三名與後五名（'+goalText('d25')+'）</h3>'+table(['名次','店號','餐廳','商圈','D25','等餐／TC','晚派單比例'],ranked25.map((x,i)=>[i<3?'前三':'後五',x.code,x.name,regionName(x.area),pct(x.d25),pct(x.waitRatio),pct(x.lateShare)]))+'</section></div>';}

  function faPage(data,previous,rows,r){const current=model(data,r),prior=previous?model(previous,previousRange(r)):null,areas=M.areasForDate(r.start).map(([code,name])=>{const a=current.areas.get(code),pa=prior?.areas.get(code),hours=current.hourTotals.get(code)?.hours||0,priorHours=prior?.hourTotals.get(code)?.hours||0,tplh=current.missingHourDays.length?null:M.ratio(a?.nonfa??null,hours),priorTplh=M.ratio(pa?.nonfa??null,priorHours);return {code,name,a,pa,tplh,priorTplh};}).filter(x=>x.a&&(x.a.tc||x.a.fa||x.a.prior));const ranked=rankedStores(rows.filter(x=>!independentStoreCodes.has(String(x.code))),'fa'),concentration=concentrationRows(data,r),period=periodSplit(concentration.orders);return '<section class="analysis-panel"><h3>非獨立店 FA 佔比排名｜前三名與後五名（'+goalText('faShareMax',goalFa)+'）</h3>'+table(['名次','店號','餐廳','商圈','FA佔比','FA單','TC','區域 TPLH'],ranked.map((x,i)=>[i<3?'較佳':'待改善',x.code,x.name,regionName(x.area),pct(x.faShare),fmt(x.fa),fmt(x.tc),fmt(areas.find(a=>a.code===x.area)?.tplh,2)]))+'</section>'+basicFactors(concentration.orders,'fa')+'<section class="analysis-panel"><h3>區域 TPLH｜'+goalText('tplh',goalTplh)+'</h3>'+table((state.period==='day'?['區域','FA佔比','實際工時','TPLH（扣 FA）']:['區域','FA佔比','實際工時','TPLH（扣 FA）','前期 TPLH','變化']),areas.map(x=>{const a=x.a;return (state.period==='day'?[x.name,pct(a.faShare),fmt(current.hourTotals.get(x.code)?.hours,2),fmt(x.tplh,2)]:[x.name,pct(a.faShare),fmt(current.hourTotals.get(x.code)?.hours,2),fmt(x.tplh,2),fmt(x.priorTplh,2),x.tplh!==null&&x.priorTplh!==null?fmt(x.tplh-x.priorTplh,2):'—']);}))+'</section>';}
  const reasonDefs=[['備餐／餐點製作',['製作','備餐','出餐','餐點','炸','烤','包裝','備料']],['尖峰／人力不足',['忙','尖峰','排隊','人力','人手','廚房','單多']],['設備／系統問題',['設備','機器','故障','系統','當機','印單','網路']],['訂單／交接溝通',['訂單','單號','通知','未收到','聯繫','溝通','交接','找不到']]];
  function reasonCategory(text){return reasonDefs.find(([,keys])=>keys.some(k=>String(text||'').includes(k)))?.[0]||'其他';}
  function waitingPage(rows,data,r){const delays=data.delays,category=new Map();for(const x of delays){if(x.status!=='completed'||!x.reason)continue;const key=reasonCategory(x.reason);category.set(key,(category.get(key)||0)+1);}const cats=[...category].sort((a,b)=>b[1]-a[1]),ranked=sortedFor(rows,'waiting').filter(x=>x.wait>0).slice(0,5),concentration=concentrationRows(data,r),detail=delays.slice().sort((a,b)=>String(b.record_date).localeCompare(String(a.record_date))||String(b.created_at).localeCompare(String(a.created_at))).slice(0,50).map(x=>[x.record_date,x.store_code,x.restaurant_name,x.order_number,x.status==='completed'?'已回覆':'待回覆',x.reason||'—']);const clusterGroup='<div class="wait-analytics-group"><h3>集中單／非集中單等餐比例</h3><div class="analysis-grid wait-rank-grid">'+waitRankPanel(concentration.orders,'cluster')+waitRankPanel(concentration.orders,'noncluster')+'</div></div>',mealGroup='<div class="wait-analytics-group"><h3>餐期／非餐期等餐比例</h3><div class="analysis-grid wait-rank-grid">'+waitRankPanel(concentration.orders,'meal')+waitRankPanel(concentration.orders,'nonmeal')+'</div></div>';return '<section class="analysis-panel"><h3>等餐筆數最高餐廳｜前五名</h3>'+table(['名次','店號','餐廳','商圈','等餐筆數','TC','等餐／TC'],ranked.map((x,i)=>[i+1,x.code,x.name,regionName(x.area),fmt(x.wait),fmt(x.tc),pct(x.waitRatio)]))+'</section>'+basicFactors(concentration.orders,'waiting')+clusterGroup+mealGroup+'<div class="analysis-grid"><section class="analysis-panel"><h3>等餐原因分類</h3>'+table(['原因類別','已回覆筆數'],cats.map(x=>[x[0],fmt(x[1])]))+'</section><section class="analysis-panel"><h3>等餐明細</h3>'+table(['日期','店號','餐廳','訂單編號','狀態','原因'],detail)+'</section></div>';}
  function complaintCode(row){const match=String(row?.main_topic||'').trim().match(/^([HASPCM])(?:\s|$)/i);return match?match[1].toUpperCase():'OTHER';}
  function complaintCodeCounts(rows){const counts=new Map();for(const row of rows){const code=complaintCode(row);counts.set(code,(counts.get(code)||0)+1);}const order=['H','A','S','P','C','M','OTHER'];return [...counts].map(([code,count])=>({name:code,count})).sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name)||b.count-a.count);}
  function restaurantComplaintCodes(rows){return complaintCodeCounts(rows).map(x=>x.name+'×'+fmt(x.count)).join('、')||'—';}
  function feedbackPage(data,previous,r){
    const all=data.feedback||[],prior=previous?.feedback||[],c0800=all.filter(x=>x.source_type==='0800'),c4128=all.filter(x=>x.source_type==='4128'),ges=['week','month'].includes(state.period)?gesForRange(all,r):[],prev0800=prior.filter(x=>x.source_type==='0800');
    const topics=complaintCodeCounts(c0800),prevTopics=new Map(complaintCodeCounts(prev0800).map(x=>[x.name,x.count])),stores0800=feedbackGroups(data,'0800').filter(x=>!/外送中心/.test(x.name)&&!x.rows.some(row=>/外送中心/.test(String(row.area_name||'')))),stores4128=feedbackGroups(data,'4128'),rankGes=ges.filter(x=>x.osat_survey!==null&&x.osat_survey!==undefined).sort((a,b)=>Number(a.osat_survey)-Number(b.osat_survey)||Number(b.response_count||0)-Number(a.response_count||0));
    const complete=p=>!!p&&p.start>='2026-10-01'&&p.end<='2026-10-31',priorRange=state.comparisonRange,topicRows=[...new Set([...topics.map(x=>x.name),...prevTopics.keys()])].map(name=>{const cur=topics.find(x=>x.name===name)?.count||0,prev=prevTopics.get(name)||0;return [name,cur?fmt(cur):complete(r)?'0':'—',prev?fmt(prev):complete(priorRange)?'0':'—',complete(r)&&complete(priorRange)?fmt(cur-prev):'—'];});
    const by0800Code=new Map(stores0800.filter(x=>x.code).map(x=>[String(x.code),x])),by0800Name=new Map(stores0800.map(x=>[M.clean(x.name),x]));
    const topTies=(list,n)=>{const cutoff=list[Math.min(n,list.length)-1]?.count;return cutoff===undefined?[]:list.filter(x=>x.count>=cutoff);};const matchedGes=rankGes.map(x=>{const complaint=(x.store_code&&by0800Code.get(String(x.store_code)))||by0800Name.get(M.clean(x.restaurant_name));return complaint?{ges:x,complaint}:null;}).filter(Boolean).sort((a,b)=>b.complaint.count-a.complaint.count||Number(a.ges.osat_survey)-Number(b.ges.osat_survey));
    const gesRows=rankGes.map((x,i)=>[i+1,x.store_code||'—',x.restaurant_name,fmt(x.response_count),pct(x.osat_survey),pct(x.score_1sat),pct(x.osat_delivery),pct(x.score_accuracy),pct(x.score_service),pct(x.score_speed),pct(x.score_food)]);
    const compareRows=matchedGes.map(({ges:x,complaint},i)=>{return [i+1,x.store_code||complaint.code||'—',complaint.name,fmt(complaint.count),restaurantComplaintCodes(complaint.rows),fmt(x.response_count),pct(x.osat_survey),pct(x.score_accuracy),pct(x.score_service),pct(x.score_speed)];});
    const gesRanges=[...new Set(all.filter(x=>x.source_type==='GES').map(x=>x.period_start+'～'+x.period_end))],gesNote=ges.aggregatedWeeks?'<p class="ins-foot">本月 GES 由 '+ges.aggregatedWeeks+' 週的週資料依回應數加權匯總（週四落在本月的週）。</p>':!ges.length&&gesRanges.length?'<p>現有 GES 期間 '+escape(gesRanges.join('、'))+'，與所選期間不一致，未直接比較。</p>':'';const gesPanel=state.period==='week'?'<section class="analysis-panel"><h3>週 GES 與 0800 餐廳對照</h3>'+table(['名次','店號','餐廳','0800 抱怨','抱怨代碼','GES 回應數','問卷 OSAT','餐點正確性','服務','服務速度'],compareRows)+gesNote+'</section>':state.period==='month'?'<section class="analysis-panel"><h3>GES 餐廳排行｜問卷 OSAT 低至高</h3>'+table(['名次','店號','餐廳','回應數','問卷 OSAT','1SAT','外送平台 OSAT','餐點正確性','服務','服務速度','餐點好吃度'],gesRows)+gesNote+'</section>':'';
    const volume='<section class="analysis-panel feedback-volume"><h3>本期資料量</h3>'+table(['來源','資料量'],[['0800 外送抱怨',fmt(c0800.length)],['4128 '+M.BUSINESS.centerName,fmt(c4128.length)],...(['week','month'].includes(state.period)?[['期間完全一致的 GES 餐廳彙總',fmt(ges.length)+' 間']]:[])])+'</section>';
    return '<div class="analysis-grid feedback-pair"><section class="analysis-panel"><h3>0800 抱怨分類</h3>'+table(state.period==='day'?['代碼','當日']:['代碼','本期','前期','差異'],state.period==='day'?topicRows.map(row=>row.slice(0,2)):topicRows)+'</section><section class="analysis-panel"><h3>0800 餐廳排行（排除外送中心）</h3>'+table(['名次','餐廳','抱怨筆數','抱怨代碼'],topTies(stores0800,10).map((x,i)=>[stores0800.findIndex(y=>y.count===x.count)+1,x.name,fmt(x.count),restaurantComplaintCodes(x.rows)]))+'</section></div><div class="analysis-grid feedback-pair"><section class="analysis-panel"><h3>4128 '+escape(M.BUSINESS.centerName)+'</h3>'+table(['名次','店號','餐廳','紀錄筆數'],topTies(stores4128,10).map((x,i)=>[stores4128.findIndex(y=>y.count===x.count)+1,x.code||'—',x.name,fmt(x.count)]))+'</section>'+gesPanel+'</div>';
  }
  function workflowProblem(rows,metric,r,data){
    if(metric==='d7'||metric==='d25'){
      const scope=rows.filter(x=>!independentStoreCodes.has(String(x.code))),counts=scope.reduce((a,x)=>({y:a.y+(Number(x[metric+'Y'])||0),n:a.n+(Number(x[metric+'N'])||0)}),{y:0,n:0}),rate=counts.y+counts.n?counts.y/(counts.y+counts.n):null,lowest=worstFor(scope,metric).slice(0,3),title=metric.toUpperCase();
      const orders=analysisOrders(data,r).filter(x=>!x.fa&&!independentStoreCodes.has(x.code)&&['Y','N'].includes(x[metric])),failed=orders.filter(x=>x[metric]==='N'),short=failed.filter(x=>x.distanceKm!==null&&x.distanceKm<=2),lowestName=lowest.map(x=>x.name+' '+pct(storeMetric(x,metric))).join('、');const issue=rate===null?`非獨立店本期沒有可判讀的 ${title} 訂單。`:`${title} ${pct(rate)}；${fmt(counts.n)} 筆未達，2 公里內 ${fmt(short.length)} 筆（占未達 ${pct(failed.length?short.length/failed.length:null)}）；較低餐廳：${lowestName||'資料不足'}。`;
      const evidence=rate===null?`${periodLabel(r)}：${independentStoreCodes.size?'排除獨立店 '+[...independentStoreCodes].join('、')+' 後，':''}無可判讀的 ${title} Y／N 訂單。`:`${periodLabel(r)}：非獨立店 ${fmt(counts.y+counts.n)} 筆有效單，達成 ${fmt(counts.y)} 筆，${title} ${pct(rate)}；${goalText(metric,pct)}。最低餐廳：${lowest.length?lowest.map(x=>`${x.name} ${pct(storeMetric(x,metric))}`).join('、'):'無可用排行'}。`;
      return {issue,evidence};
    }
    const title=metric==='fa'?'FA／TPLH':metric==='waiting'?'等餐':metric.toUpperCase(),eligible=metric==='waiting'?rows.filter(x=>x.wait>0):metric==='fa'?rows.filter(x=>!independentStoreCodes.has(String(x.code))):rows,ordered=worstFor(eligible,metric),focus=ordered[0],ranked=ordered.slice(0,5),summary=data?model(data,r).summary:null;
    if(metric==='sstg'){
      const target=targets.sstg,rate=summary?.sstg,issue=!focus?'本期沒有可用的 SSTG 餐廳資料。':rate===null||rate===undefined?`${focus.name} SSTG 資料可用，但去年同期涵蓋不足，暫無法判定整體目標。`:target===null?'SSTG 目標待核對。':rate<target?`${focus.name} SSTG 最低；整體 SSTG 未達 ${goalSstg(target)} 目標。`:`${focus.name} 為最低 SSTG；整體已達 ${goalSstg(target)} 目標。`;
      const evidence=focus?`${periodLabel(r)}：整體 SSTG ${pct(rate)}（TC ${fmt(summary.tc)}、去年同期 ${fmt(summary.prior)}）；${focus.name} SSTG ${pct(focus.sstg)}（TC ${fmt(focus.tc)}、去年同期 ${fmt(focus.prior)}）。`:`${periodLabel(r)}：沒有可比較的去年同期單數，無法計算 SSTG。`;
      const mm=model(data,r),subs=mm.baselineSubstitutions||[],newS=mm.newStores||[],md2=d=>d.slice(5).replace('-','/');
      const notes=[subs.length?`比較日遇停班改用鄰近週：${subs.map(x=>md2(x.original)+'→'+(x.used?md2(x.used):'資料不足')).join('、')}`:'',newS.length?`新店不列入 SSTG：${newS.join('、')}`:''].filter(Boolean);
      return {issue,evidence:notes.length?evidence+'（'+notes.join('；')+'）':evidence};
    }
    if(metric==='fa'){
      const faRate=summary?.faShare,tplh=summary?.tplh,issue=!focus?'本期沒有可用的 FA 餐廳資料。':faRate===null||faRate===undefined||tplh===null||tplh===undefined?`FA／TPLH 資料不完整，暫不判定達標；${focus.name} FA ${fmt(focus.fa)}／TC ${fmt(focus.tc)}（${pct(focus.faShare)}）為非獨立店最高。`:targets.faShareMax===null||targets.tplh===null?'FA／TPLH 目標待核對。':faRate>targets.faShareMax||tplh<targets.tplh?`整體 FA 佔比 ${pct(faRate)} 或 TPLH ${fmt(tplh,2)} 未達目標；${focus.name} FA ${fmt(focus.fa)}／TC ${fmt(focus.tc)}（${pct(focus.faShare)}）為非獨立店最高。`:`整體 FA 佔比與 TPLH 達標；${focus.name} FA 佔比最高，列為追蹤對象。`;
      const evidence=focus?`${periodLabel(r)}：FA ${fmt(summary.fa)}／TC ${fmt(summary.tc)}（${pct(faRate)}，${goalText('faShareMax',goalFa)}）；TPLH ${fmt(tplh,2)}（${goalText('tplh',goalTplh)}）；${focus.name} FA ${fmt(focus.fa)}／TC ${fmt(focus.tc)}（${pct(focus.faShare)}）。`:`${periodLabel(r)}：沒有可用 FA／TC 資料。`;
      return {issue,evidence};
    }
    if(metric==='waiting'){
      const highest=sortedFor(rows,'waiting').filter(x=>x.wait>0).sort((a,b)=>(b.waitRatio??0)-(a.waitRatio??0)||b.wait-a.wait)[0],issue=highest?`${highest.name} 等餐比例最高，${fmt(highest.wait)} 筆等餐／${fmt(highest.tc)} 筆 TC。`:'本期無等餐登記；不能推定實際沒有等餐。';
      const evidence=highest?`${periodLabel(r)}：全區登記等餐 ${fmt(rows.reduce((n,x)=>n+(x.wait||0),0))} 筆；${highest.name} 等餐比例 ${pct(highest.waitRatio)}，餐廳排行 ${fmt(rows.length)} 間。`:`${periodLabel(r)}：等餐紀錄 0 筆。`;
      return {issue,evidence};
    }
    const issue=focus?`${focus.name} 的 ${title} 成績最低，為本期優先檢視對象。`:`本期沒有可用的 ${title} 成績資料。`;
    const evidence=focus?`${periodLabel(r)}：${focus.name} ${pct(storeMetric(focus,metric))}；餐廳排名 ${fmt(rows.length)} 間，最低三名：${ranked.slice(0,3).map(x=>x.name+' '+pct(storeMetric(x,metric))).join('、')}。`:`${periodLabel(r)}：無可用成績或排行資料。`;
    return {issue,evidence};
  }
  function workflowText(data,metric,weekStart,field){return (data.weeklyNotes||[]).find(x=>x.week_start===weekStart&&x.metric_key===metric)?.[field]||'';}
  function issueEvidencePanels(issue,evidence,issueTitle='發現問題',evidenceTitle='提出證據'){return '<div class="analysis-grid workflow-issue-evidence"><section class="analysis-panel"><h3>'+issueTitle+'</h3><div class="workflow-copy">'+escape(issue)+'</div></section><section class="analysis-panel"><h3>'+evidenceTitle+'</h3><div class="workflow-copy">'+escape(evidence)+'</div></section></div>';}
  function comparisonValues(data,r,metric){const rows=storeAnalytics(data,r),summary=model(data,r).summary,total=key=>rows.reduce((n,x)=>n+(x[key]||0),0),tc=summary.tc;if(metric==='sstg')return [['SSTG',summary.tc!==null?summary.sstg:null,'rate'],['TC',summary.tc,'count']];if(metric==='d7'||metric==='d25'){const y7=total('d7Y'),n7=total('d7N'),y25=total('d25Y'),n25=total('d25N');return [['D7',y7+n7?y7/(y7+n7):null,'rate'],['D25',y25+n25?y25/(y25+n25):null,'rate']];}if(metric==='fa')return [['FA 佔比',summary.faShare,'rate'],['TPLH',summary.tplh,'decimal'],['TC',tc,'count']];if(metric==='waiting')return [['等餐筆數',data.delays.length,'count'],['等餐／TC',tc?data.delays.length/tc:null,'rate']];const fb=data.feedback||[];return [['0800 抱怨',fb.filter(x=>x.source_type==='0800').length,'count'],['4128 紀錄',fb.filter(x=>x.source_type==='4128').length,'count']];}
  function compareValue(a,b,type){if(type==='rate')return pct(a);if(type==='decimal')return fmt(a,2);return fmt(a);}
  function compareDelta(a,b,type){if(a===null||a===undefined||b===null||b===undefined||!Number.isFinite(Number(a))||!Number.isFinite(Number(b)))return '—';const d=Number(a)-Number(b);return type==='rate'?(d>0?'+':'')+fmt(d*100,1)+'%':(d>0?'+':'')+fmt(d,type==='decimal'?2:0);}
  function dailyComparisonPanel(data,previous,r,priorRange,metric){if(state.period!=='day')return '';const current=comparisonValues(data,r,metric),prior=previous?comparisonValues(previous,priorRange,metric):[],priorMap=new Map(prior.map(x=>[x[0],x])),label=priorRange?.special?'特殊日對當週六':'上週同日',rows=current.map(([name,value,type])=>{const old=priorMap.get(name);return [name,compareValue(value,old?.[1],type),compareValue(old?.[1],old?.[1],type),compareDelta(value,old?.[1],type)];});return '<section class="analysis-panel daily-comparison"><h3>日檢視差異對比｜'+label+'（'+(priorRange?.start||'—')+'）</h3>'+table(['指標','本日','比較日','差異'],rows)+'</section>';}
  function feedbackWorkflowProblem(data,previous,r){const all=data.feedback||[],c0800=all.filter(x=>x.source_type==='0800'),c4128=all.filter(x=>x.source_type==='4128'),topics=complaintCodeCounts(c0800).sort((a,b)=>b.count-a.count),topic=topics[0],priorTopics=new Map(complaintCodeCounts((previous?.feedback||[]).filter(x=>x.source_type==='0800')).map(x=>[x.name,x.count]));return {issue:topic?`0800 抱怨最高代碼為 ${topic.name}（${fmt(topic.count)} 筆）。`:'本期未讀取到符合條件的 0800 紀錄；尚未確認來源完整度。',evidence:topic?`${periodLabel(r)}：0800 共 ${fmt(c0800.length)} 筆；${topic.name} ${fmt(topic.count)} 筆。`:`${periodLabel(r)}：0800 ${fmt(c0800.length)} 筆、4128 ${fmt(c4128.length)} 筆。`};}
  function problemWorkflow(data,rows,r,metric,previous){
    const summary=metric==='feedback'?feedbackWorkflowProblem(data,previous,r):metric==='d7'?{issue:['d7','d25'].map(k=>'D'+k.slice(1)+'｜'+workflowProblem(rows,k,r,data).issue).join('\n'),evidence:['d7','d25'].map(k=>'D'+k.slice(1)+'｜'+workflowProblem(rows,k,r,data).evidence).join('\n')}:workflowProblem(rows,metric,r,data),{issue,evidence}=summary,weekStart=fullWeek(r.start).start,notes=data.weeklyNotes||[],metricNotes=notes.filter(x=>x.metric_key===metric),prevWeek=M.addDays(weekStart,-7),previousWeek=metricNotes.find(x=>x.week_start===prevWeek),weekLabel=S.weekLabel(weekStart),fields=[['issue','發現問題'],['evidence','提出證據'],['root_cause','找出根源'],['action_plan','制定行動'],['last_week_followup','追上週']];
    if(state.period==='day'&&metric==='d7'){const d7=workflowProblem(rows,'d7',r,data),d25=workflowProblem(rows,'d25',r,data);return issueEvidencePanels('D7｜'+d7.issue+'\nD25｜'+d25.issue,'D7｜'+d7.evidence+'\nD25｜'+d25.evidence,'本日發現問題','本日提出證據');}
    if(state.period==='day')return issueEvidencePanels(issue,evidence,'本日發現問題','本日提出證據');
    if(state.period==='week'){
      const saved=metricNotes.find(x=>x.week_start===weekStart)||{},defaults={issue:issue,evidence:evidence,root_cause:'',action_plan:'',last_week_followup:''};
      const lastSummary=previousWeek?(previousWeek.last_week_followup||previousWeek.action_plan||'上週尚無行動紀錄。'):'上週尚無行動紀錄。';
      const form='<section class="analysis-panel"><h3>'+weekLabel+'｜問題與行動追蹤</h3><div class="notice">上週紀錄：'+escape(lastSummary)+'</div><form id="weeklyActionForm" class="workflow-form" data-week-start="'+weekStart+'">'+fields.map(([key,label])=>'<label class="'+(key==='last_week_followup'?'workflow-wide':'')+'">'+label+'<textarea name="'+key+'" maxlength="5000" placeholder="輸入'+label+'">'+escape(saved[key]||defaults[key])+'</textarea></label>').join('')+'<div class="workflow-actions"><button class="primary" type="submit">儲存本週追蹤</button><span id="weeklyActionStatus" role="status"></span></div></form></section>';
      return form;
    }
    if(state.period==='month'){
      const monthWeekStarts=new Set(monthWeeks(state.month).map(x=>x.start)),monthNotes=metricNotes.filter(x=>monthWeekStarts.has(x.week_start));
      const summaries=[['找出根源',monthNotes.map(x=>`${S.weekLabel(x.week_start)}：${x.root_cause}`).filter(x=>x.trim()).join('；')||'本月週追蹤尚未填寫根源'],['制定行動',monthNotes.map(x=>`${S.weekLabel(x.week_start)}：${x.action_plan}`).filter(x=>x.trim()).join('；')||'本月週追蹤尚未填寫行動'],['追上週',monthNotes.map(x=>`${S.weekLabel(x.week_start)}：${x.last_week_followup}`).filter(x=>x.trim()).join('；')||'本月尚未有週追蹤結果']];
      const weeklyRows=monthNotes.map(x=>[S.weekLabel(x.week_start),x.issue,x.evidence,x.root_cause,x.action_plan,x.last_week_followup]);
      return issueEvidencePanels(issue,evidence,'月成績｜發現問題','月成績｜提出證據')+'<section class="analysis-panel"><h3>月成績｜根源與行動彙整</h3>'+table(['步驟','本月彙整'],summaries)+'</section><section class="analysis-panel"><h3>本月週追蹤紀錄</h3>'+table(['週次','發現問題','提出證據','找出根源','制定行動','追上週'],weeklyRows)+'</section>';
    }
    const currentNote=metricNotes.find(x=>x.week_start===weekStart);
    const rowsOut=[['發現問題',currentNote?.issue||issue],['提出證據',currentNote?.evidence||evidence],['找出根源',currentNote?.root_cause||'本週根源分析尚未填寫'],['制定行動',currentNote?.action_plan||'本週行動尚未填寫'],['追上週',currentNote?.last_week_followup||'本週追蹤結果尚未填寫']];
    return issueEvidencePanels(rowsOut[0][1],rowsOut[1][1],'本週發現問題','本週提出證據')+'<section class="analysis-panel"><h3>本週行動追蹤</h3>'+table(['步驟','本週紀錄'],rowsOut.slice(2))+'</section>';
  }
  function bindWeeklyActionForm(metric){const form=$('weeklyActionForm');if(!form)return;form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]'),status=$('weeklyActionStatus');button.disabled=true;status.textContent='儲存中…';const values=Object.fromEntries(new FormData(form).entries());try{const user=await db.auth.getUser();const result=await db.from('t998_weekly_metric_action_notes').upsert({week_start:form.dataset.weekStart,metric_key:metric,issue:values.issue||'',evidence:values.evidence||'',root_cause:values.root_cause||'',action_plan:values.action_plan||'',last_week_followup:values.last_week_followup||'',updated_by:user.data.user?.id||null,updated_at:new Date().toISOString()},{onConflict:'week_start,metric_key'});if(result.error)throw result.error;status.textContent='已保存';await loadReport(true);}catch(error){status.textContent='儲存失敗：'+error.message;button.disabled=false;}};}
  function renderMetric(data,previous,r){if(INSIGHT_TABS.has(state.metric)){renderInsight(r);return;}window.UiShell?.mark?.('analysis');$('metricContent').onclick=null;const rows=storeAnalytics(data,r),titles={sstg:'SSSG／SSTG 成績與原因分析',d7:'D7／D25 分析',d25:'D7／D25 分析',fa:'FA／TPLH 分析',waiting:'等餐細項分析',feedback:'GES／080 分析'};$('metricTitle').textContent=titles[state.metric];$('metricSubtitle').textContent=periodLabel(r);let content='';if(state.metric==='sstg')content=sstgPage(data,rows,r);else if(state.metric==='d7'||state.metric==='d25')content=d7d25Page(data,rows,r);else if(state.metric==='fa')content=faPage(data,previous,rows,r);else if(state.metric==='waiting')content=waitingPage(rows,data,r);else content=feedbackPage(data,previous,r);content+=problemWorkflow(data,rows,r,state.metric,previous);const evidence=trackingEvidence(data,r),cut=evidence.indexOf('<details class="analysis-panel">'),mainEvidence=cut<0?evidence:evidence.slice(0,cut),coverage=cut<0?'':evidence.slice(cut);$('metricContent').innerHTML=trackingOverview(data,r)+periodNotes(data,r)+trackingComparison()+mainEvidence+content+(state.metric==='feedback'?feedbackVolume(data):'')+coverage;if(state.period==='week')bindWeeklyActionForm(state.metric);$('biUploadFooter').classList.toggle('hidden',state.metric!=='sstg');$('feedbackUploadFooter').classList.toggle('hidden',state.metric!=='feedback');renderMetricTabs();syncMetricTab();}
  function renderChoices(){
    const box=$('periodChoices');box.dataset.period=state.period;$('periodDate').value=state.date;
    document.querySelectorAll('[data-period]').forEach(b=>{b.classList.toggle('active',b.dataset.period===state.period);b.setAttribute('aria-pressed',String(b.dataset.period===state.period));});
    if(state.period==='day'){
      box.innerHTML=Array.from({length:7},(_,i)=>{const d=shiftDate(state.date,i-3);return '<button type="button" class="'+(d===state.date?'active':'')+'" data-choice="'+d+'" aria-pressed="'+(d===state.date)+'"><span>'+dateLabel(d)+'</span><strong>'+d.slice(5).replace('-','/')+'</strong></button>';}).join('');
    }else if(state.period==='week'){
      const active=fullWeek(state.date);
      box.innerHTML=Array.from({length:5},(_,i)=>{const start=shiftDate(active.start,(i-2)*7),r=fullWeek(start),selected=r.start===active.start;return '<button type="button" class="'+(selected?'active':'')+'" data-choice="'+r.start+'" aria-pressed="'+selected+'"><strong>'+S.weekLabel(r.start)+'</strong><span>'+r.start.slice(5).replace('-','/')+'–'+r.end.slice(5).replace('-','/')+'</span></button>';}).join('');
    }else{
      box.innerHTML=[-2,-1,0,1,2].map(n=>shiftMonth(state.date,n)).map((d,i)=>'<button type="button" class="'+(i===2?'active':'')+'" data-choice="'+d+'" aria-pressed="'+(i===2)+'"><strong>'+monthLabel(d)+'</strong></button>').join('');
    }
    box.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{state.date=b.dataset.choice;state.month=state.date.slice(0,7);renderChoices();loadReport();});
  }
  function changePeriod(direction){const d=new Date(state.date+'T12:00:00Z');if(state.period==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);}else d.setUTCDate(d.getUTCDate()+direction*(state.period==='week'?7:1));state.date=d.toISOString().slice(0,10);state.month=state.date.slice(0,7);renderChoices();loadReport();}
  function renderExport(data,rows,r){const wb=XLSX.utils.book_new();const result=model(data,r),summary=result.summary;XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{週期:state.period,期間:periodLabel(r),TC來源:'DMS（ByOrder／ByDate）',預估公式:window.OpsForecast.FORMULA,預估TC:summary.forecast,預估工時:summary.forecastHours,TC預估達成率:summary.tcAchievement,達成率採計實際TC:summary.attainmentActual,達成率採計預估TC:summary.attainmentForecast,資料提示:model(data,r).forecastWarnings.join('；'),TC:summary.tc,去年同期TC:summary.prior,去年比較口徑:'前52週同星期，依當期餐廳範圍',FA:summary.fa,FA佔比:summary.faShare,SSTG:summary.sstg,D7:summary.d7,D25:summary.d25,實際工時:summary.actualHours,TPLH:summary.tplh,等餐筆數:data.delays.length,不計成績日期:data.reports.filter(x=>x.score_excluded).map(x=>x.record_date).join('、')}]),'營運摘要');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(result.forecastDetails.map(x=>({日期:x.date,區域:x.area,預估TC:x.excluded?null:x.totalTc,需求工時:x.excluded?null:x.recommended,預估依據:x.method,去年TC:x.baselineTc,去年對應日期:x.baselineDate,成長倍率:1+window.OpsForecast.SETTINGS.growth,前8週平均:x.averageTc,前8週成長率:x.recentGrowth,切換門檻:x.switchThreshold,有效週數:x.historyWeeks,目標週數:x.targetWeeks,不計成績:x.excluded?'是':'否',採用日期:x.baselineDate,排除日期:x.excludedSamples.map(s=>s.date+' '+s.reason).join('、')}))),'預估樣本');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.reports.filter(x=>x.score_excluded||String(x.special_notes||'').trim()).map(x=>({日期:x.record_date,不計成績:x.score_excluded?'是':'否',特殊事項:x.special_notes||''}))), '特殊事項');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((data.weeklyNotes||[]).map(x=>({週次:S.weekLabel(x.week_start),指標:x.metric_key,發現問題:x.issue,提出證據:x.evidence,找出根源:x.root_cause,制定行動:x.action_plan,追上週:x.last_week_followup}))), '週行動追蹤');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet((data.campaigns||[]).filter(x=>x.active_from<=r.end&&x.active_to>=r.start).map(x=>({活動名稱:x.campaign_name,活動內容:x.details,開始日期:x.active_from,結束日期:x.active_to,來源網址:x.source_url,記錄時間:x.researched_at}))), '優惠券活動');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.map(x=>({店號:x.code,餐廳:x.name,區域:regionName(x.area),TC:x.tc,去年同期TC:x.prior, SSTG:x.sstg,D7:x.d7,D25:x.d25,FA:x.fa,FA佔比:x.faShare,晚派單比例:x.lateShare,等餐筆數:x.wait,等餐比例:x.waitRatio,QT平均:x.qt}))), '餐廳指標');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.delays.map(x=>({日期:x.record_date,店號:x.store_code,餐廳:x.restaurant_name,訂單:x.order_number,狀態:x.status,原因:x.reason||''}))), '等餐明細');const feedbackRows=data.feedback||[];const exportFeedback=(x)=>({來源:x.source_type,日期:x.record_date||'',資料期間:x.period_start&&x.period_end?`${x.period_start}～${x.period_end}`:'',店號:x.store_code||'',餐廳:x.restaurant_name||'',區域:x.area_name||'',來源渠道:x.source_channel||'',抱怨型態:x.complaint_type||'',重點:x.main_topic||'',項目1:x.item_1||'',項目2:x.item_2||'',回饋內容:x.content||'',發票:x.invoice_number||'',訂單:x.order_number||'',工作單:x.work_order||'',回覆狀態:x.followup_status||'',回應數:x.response_count??'',問卷OSAT:x.osat_survey??'','1SAT':x.score_1sat??'',外送平台OSAT:x.osat_delivery??'',餐點正確性:x.score_accuracy??'',服務:x.score_service??'',服務速度:x.score_speed??'',餐點好吃度:x.score_food??''});XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(feedbackRows.map(exportFeedback)),'0800_4128_GES資料');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{發現問題:'依本期最差指標或最多抱怨分類填寫',提出證據:'填入排行、數量、期間與來源',根源分析:'待驗證；附查核結果',制定行動:'依SMART原則填寫',負責人:'',期限:'',追蹤結果:'下期更新',若未改善:'回到問題發現與證據確認'}]),'問題行動追蹤模板');XLSX.writeFile(wb,'T998_'+({day:'日報',week:'週報',month:'月報'}[state.period])+'_'+r.start+'.xlsx');}
  let weeklySales=[];
  function salesWeek(r){return state.period==='week'?weeklySales.find(x=>x.start===r.start&&x.end===r.end):null;}
  function sssgRanking(data,r){const sales=salesWeek(r);if(!sales)return '<section class="analysis-panel"><h3>本期餐廳 SSSG 排名</h3><p>'+'本期無可用的完整週營業額資料；日／月不拆分週數字。'+'</p></section>';const dir=new Map([...state.catalog.values()].map(x=>[M.clean(x.restaurant_name),x])),areas=new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code])),list=sales.stores.filter(x=>x.value!==null&&Number.isFinite(x.value)).map(x=>({...x,store:dir.get(M.clean(x.name)),area:areas.get(M.clean(x.name))})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'zh-Hant')),topCut=list[Math.min(2,list.length-1)]?.value,bottomCut=list[Math.max(0,list.length-5)]?.value,top=list.filter(x=>x.value>=topCut),bottom=list.filter(x=>x.value<=bottomCut&&!top.includes(x));return '<section class="analysis-panel"><h3>本期餐廳 SSSG 排名｜前三名與後五名</h3>'+table(['區段','店號','餐廳','商圈','SSSG'],[...top.map(x=>['前三',x.store?.store_code||'—',x.name,regionName(x.area),pct(x.value)]),...bottom.map(x=>['後五',x.store?.store_code||'—',x.name,regionName(x.area),pct(x.value)])])+'<p>來源：'+escape(sales.file)+' 的 SSSG%_wk；有效 '+list.length+' 間，缺值 '+(sales.stores.length-list.length)+' 間；同分保留。'+escape(weeklySalesNote(sales.start))+'</p></section>';}
  function feedbackVolume(data){const f=data.feedback||[];return '<section class="analysis-panel"><h3>本期資料量</h3>'+table(['來源','資料量'],[['0800 外送抱怨',fmt(f.filter(x=>x.source_type==='0800').length)],['4128 '+M.BUSINESS.centerName,fmt(f.filter(x=>x.source_type==='4128').length)],['GES 餐廳彙總',fmt(f.filter(x=>x.source_type==='GES').length)+' 間']])+'<p>2026 年 10 月以指定的兩份十月檔為準；查詢範圍超出十月時，其他日期來源完整度待確認。無匯入紀錄不表示零件。</p></section>';}
  function basicFactors(orders,kind){const groups=[['集中單',x=>x.moment!==null&&x.cluster],['非集中單',x=>x.moment!==null&&!x.cluster],['下單時間不足',x=>x.moment===null],['餐期',x=>x.moment!==null&&mealOrder(x)],['非餐期',x=>x.moment!==null&&!mealOrder(x)]];const total=orders.filter(x=>kind==='fa'?x.fa:x.wait).length;return '<section class="analysis-panel"><h3>'+(kind==='fa'?'FA':'等餐')+'｜因素與影響範圍</h3>'+table(['因素','有效訂單','FA單','FA佔比','占全部FA單','已配對等餐','等餐比例','占全部已配對等餐'],groups.map(([name,test])=>{const a=orders.filter(test),fa=a.filter(x=>x.fa).length,wait=a.filter(x=>x.wait).length,totalFA=orders.filter(x=>x.fa).length,totalWait=orders.filter(x=>x.wait).length;return [name,fmt(a.length),fmt(fa),pct(a.length?fa/a.length:null),pct(totalFA?fa/totalFA:null),fmt(wait),pct(a.length?wait/a.length:null),pct(totalWait?wait/totalWait:null)];}))+'<p>各因素分組分開計算；等餐只計可配對的登記，未配對另列。分時工時不足，無法計算分組 TPLH。</p></section>';}
  function trackingStats(data,r){
    const summary=model(data,r).summary,orders=analysisOrders(data,r),valid=key=>orders.filter(x=>!x.fa&&!independentStoreCodes.has(x.code)&&['Y','N'].includes(x[key])),rate=key=>{const list=valid(key);return list.length?list.filter(x=>x[key]==='Y').length/list.length:null;};
    const scoreDates=[...new Set(data.batches.filter(x=>x.report_type==='ByOrder'&&!data.reports.some(y=>y.record_date===x.report_date&&y.score_excluded)).map(x=>x.report_date))].sort();
    const fb=data.feedback||[],count=source=>fb.filter(x=>x.source_type===source).length,tc=scoreDates.length?summary.tc:null;
    return {summary,orders,scoreDates,values:[['SSSG',salesWeek(r)?.value??null,'rate'],['SSTG',summary.sstg,'rate'],['TC',tc,'count'],['去年TC',summary.priorN?summary.prior:null,'count'],['D7',rate('d7'),'rate'],['D7達成單',tc===null?null:valid('d7').filter(x=>x.d7==='Y').length,'count'],['D7有效單',tc===null?null:valid('d7').length,'count'],['D25',rate('d25'),'rate'],['D25達成單',tc===null?null:valid('d25').filter(x=>x.d25==='Y').length,'count'],['D25有效單',tc===null?null:valid('d25').length,'count'],['TPLH',summary.tplh,'decimal'],['自送TC',tc===null?null:summary.nonfa,'count'],['FA佔比',tc?summary.faShare:null,'rate'],['FA單數',tc!==null?summary.fa:null,'count'],['實際工時',summary.actualHours,'decimal'],['等餐登記',data.delays.length||null,'count'],['等餐／TC',tc&&data.delays.length?data.delays.length/tc:null,'rate'],['0800',count('0800')||null,'count'],['0800／千單',tc&&count('0800')&&r.start>='2026-10-01'&&r.end<='2026-10-31'&&!data.reports.some(d=>d.score_excluded&&fb.some(x=>x.source_type==='0800'&&x.record_date===d.record_date))?count('0800')/tc*1000:null,'decimal'],['4128',count('4128')||null,'count']]};
  }
  function statMap(stats){return new Map(stats.values.map(x=>[x[0],x]));}
  function trackingOverview(data,r) {
    const stats=trackingStats(data,r), values=statMap(stats);
    const replies=data.delays.filter(row=>row.status==='completed').length;
    values.set('已回覆',['已回覆',data.delays.length?replies:null,'count']);
    values.set('待回覆',['待回覆',data.delays.length?data.delays.length-replies:null,'count']);
    const ges=gesForRange(data.feedback,r);
    const validGes=ges.filter(row=>Number.isFinite(row.osat_survey)&&row.response_count>0);
    const responses=validGes.reduce((sum,row)=>sum+row.response_count,0);
    values.set('GES OSAT',['GES OSAT',responses?validGes.reduce((sum,row)=>sum+row.osat_survey*row.response_count,0)/responses:null,'rate']);
    const keys={
      sstg:['SSSG','SSTG','TC','去年TC'],d7:['D7','D25'],
      fa:['TPLH','FA佔比','FA單數','實際工時'],
      waiting:['等餐登記','等餐／TC','已回覆','待回覆'],
      feedback:['0800','4128','0800／千單','GES OSAT']
    }[state.metric];
    const inRange=stats.scoreDates.filter(d=>d>=r.start&&d<=r.end),lastScore=inRange.length?inRange[inRange.length-1]:'',cutoff=r.end<today()?r.end:today(),lastDay=lastScore>cutoff?lastScore:cutoff,elapsed=r.start>lastDay?0:Math.round((Date.parse(lastDay+'T00:00:00Z')-Date.parse(r.start+'T00:00:00Z'))/86400000)+1,scored=inRange.filter(d=>d<=lastDay).length;
    const coverage=elapsed>1&&scored<elapsed?'<small class="scope-note coverage-note" title="缺成績的日期不計入，數字只算有成績的天數">成績只有 '+scored+'／'+elapsed+' 天</small>':'';
    return '<section class="analysis-panel score-overview"><h3>本期成績'+coverage+'</h3><div class="score-tiles '+(keys.length===2?'two-tiles':'')+'">'+keys.map(key=>{
      const item=values.get(key);
      return '<article class="score-tile"><h4>'+escape(key)+(key==='D7'||key==='D25'?'<small class="scope-note">非獨立店</small>':'')+'</h4><strong>'+escape(compareValue(item?.[1],null,item?.[2]))+'</strong></article>';
    }).join('')+'</div></section>';
  }
  function trackingCharts(computed){const spec={sstg:['SSSG','SSTG'],d7:['D7','D25'],fa:['TPLH','FA佔比'],waiting:['等餐登記','等餐／TC'],feedback:['0800','4128']}[state.metric],same=['sstg','d7','feedback'].includes(state.metric),groups=same?[spec]:spec.map(x=>[x]);return groups.map(names=>{const series=names.map(name=>({name,values:computed.map(x=>x.stats&&statMap(x.stats).get(name))})),numbers=series.flatMap(x=>x.values.map(y=>y?.[1])).filter(v=>typeof v==='number'&&Number.isFinite(v));if(!numbers.length)return '<p class="tracking-note">'+names.join('／')+'：資料不足，暫無趨勢圖。</p>';const lo=Math.min(0,...numbers),hi=Math.max(...numbers),span=hi-lo||1,y=v=>155-(v-lo)/span*110,colors=['#bd1622','#287bb9'];let grid=[0,1,2,3,4].map(i=>'<line x1="75" y1="'+(45+i*27.5)+'" x2="875" y2="'+(45+i*27.5)+'" stroke="#dedede"/><text x="65" y="'+(49+i*27.5)+'" text-anchor="end" fill="#666">'+escape(compareValue(hi-i*span/4,null,series[0].values.find(Boolean)?.[2]))+'</text>').join('');let lines=series.map((series,j)=>{let prev=null,parts='';for(let i=0;i<5;i++){let item=series.values[i],value=item?.[1],x=100+i*190;if(value===null||value===undefined||!Number.isFinite(value)){prev=null;continue;}let py=y(value);if(prev)parts+='<line x1="'+prev.x+'" y1="'+prev.y+'" x2="'+x+'" y2="'+py+'" stroke="'+colors[j]+'" stroke-width="2.5"/>';parts+='<circle cx="'+x+'" cy="'+py+'" r="4" fill="'+colors[j]+'"/><text x="'+x+'" y="'+(py-9-j*13)+'" text-anchor="middle" fill="#555">'+escape(compareValue(value,null,item[2]))+'</text>';prev={x,y:py};}return parts;}).join('');return '<div class="line-chart"><h4>'+names.join('／')+' 趨勢</h4><svg viewBox="0 0 950 215" role="img" aria-label="'+names.join('及')+'五期折線圖">'+grid+lines+computed.map((x,i)=>'<text x="'+(100+i*190)+'" y="180" text-anchor="middle" fill="#666">'+escape(state.period==='week'?S.weekLabel(x.range.start):x.range.start.slice(0,7))+'</text>').join('')+'</svg><div class="line-legend">'+names.map((name,i)=>'<span><i style="background:'+colors[i]+'"></i>'+name+'</span>').join('')+'</div></div>';}).join('');}
  function trackingKeys(metric){return {sstg:['SSSG','SSTG','TC','去年TC'],d7:['D7','D7達成單','D7有效單','D25','D25達成單','D25有效單'],fa:['TPLH','自送TC','實際工時','FA佔比','FA單數','TC'],waiting:['等餐登記','TC','等餐／TC'],feedback:['0800','TC','0800／千單','4128']}[metric]||[];}
  function trackingComparison(){if(state.period==='day')return '';const timeline=state.timeline||[],computed=timeline.map(x=>({...x,stats:x.data?trackingStats(x.data,x.range):null})),names=trackingKeys(state.metric);
    const rows=names.map(name=>[name,...computed.map(x=>{const v=x.stats&&statMap(x.stats).get(name);return x.stats?compareValue(v?.[1],null,v?.[2]):'—';})]);
    rows.push(['資料狀態',...computed.map(x=>x.error?'載入失敗':!x.data?'尚未發生':!x.stats.scoreDates.length?'無 DMS 成績':x.stats.scoreDates.length+' 個成績日／截止 '+x.stats.scoreDates.at(-1))]);
    const deltas=names.map(name=>[name,...computed.map((x,i)=>{const current=x.stats&&statMap(x.stats).get(name),old=computed[i-1]?.stats&&statMap(computed[i-1].stats).get(name);if(!current||!old)return '—';const delta=compareDelta(current[1],old[1],current[2]);return delta;})]);
    const heads=['指標',...computed.map(x=>(x.offset===0?'★ ':'')+(state.period==='week'?S.weekLabel(x.range.start):x.range.start.slice(0,7)))];
    return '<section class="analysis-panel timeline"><h3>'+(state.period==='week'?'五週':'五個月')+'成績比較｜前兩期・本期・後兩期</h3>'+trackingCharts(computed)+table(heads,rows)+'<details><summary>查看各期與前一期差異</summary>'+table(heads,deltas)+'</details><p>各欄按實際有效資料計算；資料涵蓋不相同時，差異僅供查核。— 表示缺資料／無法計算；080 與等餐未確認完整來源時不填 0；080 十月以指定檔案為準，跨月或十一月可能不完整。</p></section>';
  }
  function trackingEvidence(data,r){const t=trackingStats(data,r),orders=t.orders,valid=orders.filter(x=>!x.fa&&!independentStoreCodes.has(x.code)),matched=orders.filter(x=>x.wait).length,notMatched=data.delays.filter(d=>!orders.some(x=>x.date===d.record_date&&x.code===String(d.store_code||'')&&orderTail(x.order)===orderTail(d.order_number))).length;
    const checks=[['去年同期TC（成績日）',Math.max(0,t.scoreDates.length-model(data,r).missingBaselineDays.length),t.scoreDates.length,'缺基準日：'+(model(data,r).missingBaselineDays.join('、')||'無')],['實際工時（成績日）',Math.max(0,t.scoreDates.length-model(data,r).missingHourDays.length),t.scoreDates.length,'缺工時日：'+(model(data,r).missingHourDays.join('、')||'無')],['配送距離',orders.filter(x=>x.distanceKm!==null).length,orders.length,'以 BY DATE 配對距離；未配對／空白不分入短距離'],['派單與預計抵達時間',orders.filter(x=>x.assigned!==null&&x.eta!==null).length,orders.length,'晚派＝預計抵達前 20 分鐘內才派單；時間欄位不是實際抵店紀錄'],['下單時間',orders.filter(x=>x.moment!==null).length,orders.length,'用於餐期與 30 分鐘至少 6 單集中單'],['可判讀併單',orders.filter(x=>x.departureGroupSize!==null).length,orders.length,'同外送員、同日、同店、離店 3 分鐘內；僅為批次線索，不推定路線順序'],['等餐配對',matched,data.delays.length,'未配對 '+notMatched+' 筆；無登記不等於沒有等餐']];
    let body='';
    if(state.metric==='sstg'){const days=dates(r).map(date=>{const hasScore=t.scoreDates.includes(date),excluded=data.reports.some(x=>x.record_date===date&&x.score_excluded);const tc=hasScore?storeAnalytics(data,{start:date,end:date}).reduce((n,x)=>n+x.tc,0):null;return [date,dateLabel(date),fmt(tc),excluded?'不計成績':hasScore?'已匯入':'缺成績'];});body='<h3>單量變化證據｜逐日／星期</h3>'+table(['日期','星期','TC','狀態'],days)+'<p>SSSG 依 BI 週資料；若缺日期拆分或範圍不一致則留空。客單價、暫停接單、取消單、大單與活動成效尚無足夠欄位，不能判定原因。天氣與活動僅供對照，不直接認定因果。</p>';}
    else if(state.metric==='d7'){const groups=[['距離 ≤2km',x=>x.distanceKm!==null&&x.distanceKm<=2],['距離 >2–4km',x=>x.distanceKm!==null&&x.distanceKm>2&&x.distanceKm<=4],['距離 >4km',x=>x.distanceKm!==null&&x.distanceKm>4],['距離資料不足',x=>x.distanceKm===null],['晚派',x=>x.late===true],['未晚派',x=>x.late===false],['派單時間不足',x=>x.late===null],['餐期',x=>x.moment!==null&&mealOrder(x)],['非餐期',x=>x.moment!==null&&!mealOrder(x)],['下單時間不足',x=>x.moment===null],['有等餐登記',x=>x.wait],['無等餐登記',x=>!x.wait],['集中單',x=>x.moment!==null&&x.cluster],['非集中單',x=>x.moment!==null&&!x.cluster],['單次出門 1 單',x=>x.departureGroupSize===1],['併單 2 單',x=>x.departureGroupSize===2],['併單 3 單以上',x=>x.departureGroupSize>=3],['併單資料不足',x=>x.departureGroupSize===null]];const failAll=k=>valid.filter(x=>x[k]==='N').length;body='<h3>D7／D25｜未達單量與影響範圍</h3>'+table(['因素','D7有效','D7','D7未達','占全部D7未達','D25有效','D25','D25未達','占全部D25未達'],groups.map(([label,test])=>{const list=valid.filter(test),metrics=k=>{const a=list.filter(x=>['Y','N'].includes(x[k])),n=a.filter(x=>x[k]==='N').length;return [a.length,pct(a.length?(a.length-n)/a.length:null),n,pct(failAll(k)?n/failAll(k):null)];};return [label,...metrics('d7'),...metrics('d25')];}))+'<p>每一種因素分開分組，跨因素不可相加；同距離與晚派的差異是關聯證據。尚缺完整實際抵店、備餐完成、送達與路線紀錄，不能直接歸責。</p>';}
    else if(state.metric==='fa'){body='<h3>供需線索｜逐日單量與工時</h3>'+table(['日期','總TC','自送TC','FA單','FA佔比','實際工時','TPLH'],dates(r).map(date=>{const d={start:date,end:date},s=model(data,d).summary,has=data.batches.some(x=>x.report_date===date&&x.report_type==='ByOrder');return [date,has?fmt(s.tc):'—',has?fmt(s.tc-s.fa):'—',has?fmt(s.fa):'—',has?pct(s.faShare):'—',fmt(s.actualHours,2),has?fmt(s.tplh,2):'—'];}))+'<p>TPLH 沿用自送 TC／有效實際工時；日工時不能拆成餐期人力。尚缺每時段出勤人數、可用人力及第三方改派原因，暫不判定人力不足。</p>';}
    else if(state.metric==='waiting'){const replies=data.delays.filter(x=>x.status==='completed').length;body='<h3>等餐紀錄完整度</h3>'+table(['登記筆數','已回覆','尚未回覆','配對訂單','未配對'],[[data.delays.length,replies,data.delays.length-replies,matched,notMatched]])+'<p>目前可分析餐廳、商圈、餐期、集中單與回覆原因。缺等餐開始／結束時間，不能計算平均或長時間等餐；原因空白不代表沒有備餐問題。</p>';}
    else {const rows=(data.feedback||[]),count=source=>rows.filter(x=>x.source_type===source).length;body='<h3>抱怨來源與缺項</h3>'+table(['來源','本期已讀取紀錄','狀態'],[['0800',count('0800'),count('0800')?'已讀取；完整度待確認':'無匯入紀錄，非確認零件'],['4128',count('4128'),count('4128')?'另列，不併入0800':'無匯入紀錄，非確認零件']])+'<p>0800／千單＝本期0800筆數÷本期有效TC×1000；來源或成績日不完整時不做表現判定。錯餐、漏給、延誤、無法配送與提早送達需依原始內容分開查核；尚未完成跨來源訂單配對與責任認定。</p>';}
    return '<section class="analysis-panel evidence">'+body+'</section><details class="analysis-panel"><summary>資料覆蓋與缺項清單</summary>'+table(['欄位','有資料／配對筆數','總筆數','限制'],checks)+'<p>分析來源：DMS BY ORDER／BY DATE、Power BI 去年TC、營運工時、等餐登記、0800／4128／GES。原始訂單與來源列由既有明細查核。</p></details>';
  }
  function renderTrackingExport(data,r){const wb=XLSX.utils.book_new(),t=trackingStats(data,r);XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(t.values.map(([name,value,type])=>({指標:name,數值:value,型態:type,開始:r.start,結束:r.end,有效成績日:t.scoreDates.length,截止:t.scoreDates.at(-1)||'',缺項:value===null?(name==='SSSG'?'缺資料或期間口徑未對齊':'缺資料或未確認完整來源'):''}))), '五大成績');const rows=(state.timeline||[]).flatMap(x=>x.data?trackingStats(x.data,x.range).values.filter(([name])=>trackingKeys(state.metric).includes(name)).map(([name,value])=>({開始:x.range.start,結束:x.range.end,指標:name,數值:value})): [{開始:x.range.start,結束:x.range.end,狀態:x.error||'尚未發生'}]);if(rows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'前後兩期比較');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{SSSG:M.BUSINESS.weeklySalesLimitation ,時段人力:'缺時段工時與出勤',等餐分鐘:'缺開始與結束時間',因果:'因素差異僅為關聯證據',範圍:M.BUSINESS.scopeNote,零值:'等餐與080無紀錄不視為完整零件'}]),'缺項與限制');document.querySelectorAll('#metricContent table').forEach((table,index)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.table_to_sheet(table),'畫面分析'+(index+1)));XLSX.writeFile(wb,'T998_測試追蹤_'+r.start+'.xlsx');}
  function isoWeekBounds(year,week){const anchor=new Date(Date.UTC(year,0,4,12)),dow=(anchor.getUTCDay()+6)%7;anchor.setUTCDate(anchor.getUTCDate()-dow+(week-1)*7);const start=anchor.toISOString().slice(0,10),end=M.addDays(start,6);if(S.week(start).year!==year||S.week(start).number!==week)return null;return {start,end};}
  function parseWeeklySales(book, file) {
    for (const sheet of book.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(book.Sheets[sheet], {header:1, defval:null, raw:true});
      const header = grid.findIndex(row => ['STR_SN', 'SSSG%_wk'].every(key => row.some(cell => String(cell ?? '').trim() === key)));
      if (header < 0) continue;
      const columns = grid[header].map(cell => String(cell ?? '').trim());
      const get = (row, name) => row[columns.indexOf(name)];
      const footer = grid.map(row => row.join(' ')).join('\n');
      const dates = footer.match(/DATE\s*在\s*(20\d{2}-\d{2}-\d{2})\s*當時或之後\s*及\s*在\s*(20\d{2}-\d{2}-\d{2})\s*之前/i);
      const year = footer.match(/^[ \t]*YEAR[ \t]*是[ \t]*(20\d{2})[ \t]*$/im);
      const week = footer.match(/^[ \t]*YWEEK[ \t]*是[ \t]*(\d{1,2})[ \t]*$/im);
      const hasWeekFilter = /^\s*YWEEK\s*是\s*/im.test(footer);
      const hasCenterFilter = /^\s*CenterName\s*是\s*/im.test(footer);
      const esc = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const center = new RegExp('^\\s*CenterName\\s*是\\s*' + esc(M.BUSINESS.centerName) + '\\s*$', 'im').test(footer);
      const area = !!M.BUSINESS.regionLabel && new RegExp('^\\s*Area\\s*是\\s*' + esc(M.BUSINESS.regionLabel) + '\\s*$', 'im').test(footer);
      if (!dates || !year || (hasWeekFilter && !week) || !(hasCenterFilter ? center : area)) {
        return {error:'無法確認' + M.BUSINESS.centerName + '、年份與日期範圍。'};
      }
      const start = dates[1];
      const iso = S.week(start);
      const range = week ? isoWeekBounds(Number(year[1]), Number(week[1])) : isoWeekBounds(iso.year, iso.number);
      const exactWeek = range && start === range.start && dates[2] === M.addDays(range.end, 1);
      const explicitCenterWeek = center && week && range && start <= range.start && dates[2] > range.end;
      if (!range || (!exactWeek && !explicitCenterWeek) || (!week && iso.year !== Number(year[1]))) {
        return {error:'檔案未涵蓋可確認的完整單週。'};
      }
      const rows = grid.slice(header + 1);
      const totalIndex = rows.findIndex(row => String(get(row, 'Area') ?? '').trim() === 'Total' && !get(row, 'STR_SN'));
      const value = totalIndex < 0 ? null : get(rows[totalIndex], 'SSSG%_wk');
      const stores = [];
      for (const [index, row] of rows.entries()) {
        const name = String(get(row, 'STR_SN') ?? '').trim();
        if (!name || name === 'Total' || M.clean(name) === M.clean(M.BUSINESS.centerName)) continue;
        const cell = get(row, 'SSSG%_wk');
        if (cell != null && String(cell).trim() !== '' && !Number.isFinite(cell)) {
          return {error:sheet + ' 第 ' + (header + index + 2) + ' 列 SSSG%_wk 格式無效。'};
        }
        stores.push({name, row:header + index + 2, value:Number.isFinite(cell) ? cell : null});
      }
      const directory = new Set([...state.catalog.values()].map(store => M.clean(store.restaurant_name)));
      const names = stores.map(store => M.clean(store.name));
      if (!Number.isFinite(value) || !stores.length || names.some(name => !directory.has(name)) || new Set(names).size !== names.length) {
        return {error:'中心總計、餐廳名稱或重複值無法通過檢查。'};
      }
      return {file:file.name, sheet, row:header + totalIndex + 2, ...range, value, stores};
    }
    return null;
  }  const weeklySalesTable = 't998_bi_weekly_sales';

  function rememberWeeklySales(row) {
    weeklySales = weeklySales.filter(week => week.start !== row.week_start);
    weeklySales.push({
      start: row.week_start, end: row.week_end, file: row.source_file,
      value: Number(row.center_sssg), stores: row.stores
    });
  }

  async function readWeeklySales(spans) {
    const starts = spans.map(span => span.range.start);
    const {data, error} = await db.from(weeklySalesTable).select('*').in('week_start', starts);
    if (error) throw error;
    for (const row of data) rememberWeeklySales(row);
  }

  function weeklySalesNote(start) {
    return M.BUSINESS.weeklySalesNotes[start]||'';
  }

  async function importWeeklySales(week) {
    const {data: reports, error: reportError} = await db.from('t998_operations_daily_reports')
      .select('record_date').gte('record_date', week.start).lte('record_date', week.end)
      .eq('score_excluded', true);
    if (reportError) throw reportError;
    const excludedDays = reports.map(row => row.record_date)
      .filter(date => date !== '2026-10-23' && date !== '2026-10-24');
    if (excludedDays.length) {
      return '含不計成績日 ' + excludedDays.join('、') + '，需逐日營業額';
    }

    const {data: inserted, error: insertError} = await db.from(weeklySalesTable).upsert({
      week_start: week.start, week_end: week.end, source_file: week.file,
      source_sheet: week.sheet, source_row: week.row, center_sssg: week.value, stores: week.stores
    }, {onConflict: 'week_start', ignoreDuplicates: true}).select('week_start');
    if (insertError) throw insertError;

    const {data: saved, error: readError} = await db.from(weeklySalesTable).select('*')
      .eq('week_start', week.start).single();
    if (readError) throw readError;
    rememberWeeklySales(saved);

    const values = new Map(saved.stores.map(store => [M.clean(store.name), store.value]));
    const same = Number(saved.center_sssg) === week.value && values.size === week.stores.length
      && week.stores.every(store => values.has(M.clean(store.name)) && values.get(M.clean(store.name)) === store.value);
    if (!same) return '同週資料不一致，保留已匯入版本';
    return inserted.length ? '已正式匯入並讀回' : '與已匯入資料一致，無重複';
  }

  $('biFiles').onchange = async () => {
    const input = $('biFiles');
    const files = [...input.files];
    if (!files.length) return;
    input.disabled = true;
    $('biStatus').textContent = '檢查並匯入中…';
    const results = [];
    try {
      for (const file of files) {
        let period = '—', count = '—', missingDetails = '—';
        try {
          const book = XLSX.read(await file.arrayBuffer(), {type:'array'});
          const week = parseWeeklySales(book, file);
          if (!week || week.error) {
            results.push([file.name, '—', '—', '—', week?.error || '找不到週 SSSG 欄位，無法匯入']);
            continue;
          }
          const missing = week.stores.filter(store => store.value === null);
          period = week.start + '～' + week.end;
          count = week.stores.length - missing.length;
          missingDetails = missing.map(store => week.sheet + ' 第 ' + store.row + ' 列 ' + store.name + '（SSSG%_wk 空白）').join('；') || '—';
          const result = await importWeeklySales(week);
          results.push([file.name, period, count, missingDetails, result]);
        } catch (error) {
          results.push([file.name, period, count, missingDetails, '無法確認匯入結果：' + error.message]);
        }
      }
      $('biPreview').innerHTML = table(['檔案', '週期', '有效餐廳筆數', '缺值明細', '匯入結果'], results);
      $('biStatus').textContent = '處理完成，請查看各檔案的匯入結果。';
      if (state.data && !$('report').classList.contains('hidden')) {
        renderMetric(state.data, state.previous, range());
      }
    } finally {
      input.value = '';
      input.disabled = false;
    }
  };

  window.t998RefreshFeedback = () => { state.cache.clear(); loadReport(true); };

  // ===== 儀表板 v2｜B 組：預警與異常日（B3、B4）、影響度排名（B1）、週報草稿（B2）。計算在 ops-insights.js =====
  const I=window.OpsInsights,INSIGHT_TABS=new Set(['alerts','impact','weekly','store','actions','targets','drill','staff']);
  state.impactMetric='d7';
  function acOfFor(date){const list=M.acAssignmentsForDate(date);return code=>list.find(a=>a.stores.includes(String(code)))?.name||null;}
  // 每日 × 餐廳格子：訂單來自成績 ByOrder（與 D7 頁同一套判讀），等餐筆數用等餐登記
  function insightCells(data,r){
    const map=new Map(),key=(d,code,name)=>d+'|'+(code||M.clean(name));
    for(const o of analysisOrders(data,r)){const k=key(o.date,o.code,o.name);let c=map.get(k);if(!c){c={date:o.date,code:o.code,name:o.name,area:o.area,tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,wait:0};map.set(k,c);}c.tc++;if(o.fa)c.fa++;else{if(o.d7==='Y')c.d7Y++;if(o.d7==='N')c.d7N++;if(o.d25==='Y')c.d25Y++;if(o.d25==='N')c.d25N++;}}
    for(const w of data.delays||[]){const d=String(w.record_date);if(d<r.start||d>r.end)continue;const code=String(w.store_code||''),k=key(d,code,w.restaurant_name);let c=map.get(k);if(!c){c={date:d,code,name:state.catalog.get(code)?.restaurant_name||w.restaurant_name||'未分類餐廳',area:'',tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,wait:0};map.set(k,c);}c.wait++;}
    return [...map.values()];
  }
  // 預警與週報要看前幾週：所選期間最後一週往前 5 週（異常日要比前 4 個同星期）
  async function insightContext(r){
    const lastWeek=fullWeek(r.end),start=[M.addDays(lastWeek.start,-49),fullWeek(r.start).start].sort()[0],span={start,end:r.end};
    // 預警、影響度、週報、餐廳頁、行動追蹤只用到 ByOrder；不下載 8 週的 ByDate，資料量少約四成
    const data=await loadRange(span,false,{orderOnly:true});
    try{await weatherForRange(span);}catch(e){}
    const excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),cells=insightCells(data,span);
    const weeks=[];for(let s=M.addDays(lastWeek.start,-49);s<=lastWeek.start;s=M.addDays(s,7))weeks.push({start:s,end:M.addDays(s,6),label:S.weekLabel(s)});
    const summaries=new Map(),weekSummary=w=>{if(!summaries.has(w.start)){let v=null;try{const m=model(data,{start:w.start,end:w.end});v={...m.summary,missingHourDays:m.missingHourDays||[]};}catch(e){v=null;}summaries.set(w.start,v);}return summaries.get(w.start);};
    const cities=[...new Set(cells.map(c=>cityForStore(c.code,c.area)).filter(Boolean))];
    const context=d=>{const rain=cities.map(city=>weatherRow(d,city)).filter(Boolean).map(w=>Number(w.precipitation)||0);const report=data.reports.find(x=>x.record_date===d);return {rainMm:rain.length?Math.max(...rain):0,campaigns:(data.campaigns||[]).filter(c=>c.active_from<=d&&c.active_to>=d).map(c=>c.campaign_name),note:String(report?.special_notes||'').trim()};};
    return {data,span,cells,excluded,weeks,weekSummary,context,acOf:acOfFor(r.end),independent:independentStoreCodes};
  }
  const levelDot={red:'🔴',orange:'🟠',yellow:'🟡'};
  function insightLink(link,text){return link?'<button type="button" class="ins-link" data-ins-tab="'+escape(link.tab)+'" data-ins-metric="'+escape(link.metric||'')+'">'+escape(text)+'</button>':'';}
  function alertsPage(ctx,r){
    const days=state.period==='day'?S.dates(M.addDays(r.end,-6),r.end):S.dates(r.start,r.end);
    const alerts=I.alerts({cells:ctx.cells,weeks:ctx.weeks,days:S.dates(M.addDays(r.end,-13),r.end),targets,independent:ctx.independent,excluded:ctx.excluded,acOf:ctx.acOf,weekSummary:ctx.weekSummary,weekRule:rules().alertWeeks,dayRule:rules().alertDays});
    const anomalies=I.anomalies({cells:ctx.cells,dates:days,excluded:ctx.excluded,independent:ctx.independent,context:ctx.context,tcThreshold:rules().anomalyTc,rateThreshold:rules().anomalyRate,inScope:M.storeInScope});
    const lastWeek=ctx.weeks.at(-1);
    const alertItem=a=>'<li class="ins-item ins-'+a.level+'"><span class="ins-dot" aria-hidden="true">'+levelDot[a.level]+'</span><div><b>'+escape(a.title)+'</b><p>'+escape(a.detail)+'</p>'+'<div class="ins-actions">'+(a.link?insightLink(a.link,'看影響度排名'):'')+(['d7','d25','fa','tplh','sstg','waiting'].includes(a.metric)?'<button type="button" class="ins-link" data-add-action="'+escape(a.metric)+'" data-store="'+escape(a.scope==='store'?a.code||'':'')+'">＋新增行動</button>':'')+'</div>'+'</div></li>',SHOW=8,alertHtml=alerts.length?'<ul class="ins-list">'+alerts.slice(0,SHOW).map(alertItem).join('')+'</ul>'+(alerts.length>SHOW?'<details class="ins-more"><summary>其他 '+(alerts.length-SHOW)+' 項</summary><ul class="ins-list">'+alerts.slice(SHOW).map(alertItem).join('')+'</ul></details>':''):'<div class="empty">沒有連續未達標的項目</div>';
    const anomalyHtml=anomalies.length?'<ul class="ins-list">'+anomalies.map(a=>'<li class="ins-item '+(a.bad?'ins-orange':'ins-blue')+'"><span class="ins-dot" aria-hidden="true">'+a.icon+'</span><div><b>'+escape(a.title)+'</b><p>'+escape([...a.others.map(f=>f.text),...a.reasons].join('；'))+'。</p><div class="ins-actions"><button type="button" class="ins-link" data-ins-day="'+a.date+'">看當天</button></div></div></li>').join('')+'</ul>':'<div class="empty">'+(days.length>1?'這段期間':'這天')+'沒有偏離平常的日子</div>';
    return '<p class="ins-lead">連續未達標以 '+escape(lastWeek.label)+'（'+lastWeek.start.slice(5).replace('-','/')+'–'+lastWeek.end.slice(5).replace('-','/')+'）為最新一週往回看；異常日看 '+escape(days[0].slice(5).replace('-','/')+(days.length>1?'–'+days.at(-1).slice(5).replace('-','/'):''))+'。</p>'+
      '<section class="analysis-panel ins-panel"><h3>🔔 連續未達標預警 <span class="ins-count">'+alerts.length+'</span></h3>'+alertHtml+'<p class="ins-foot">規則：週指標連續 '+rules().alertWeeks+' 週、日指標連續 '+rules().alertDays+' 天未達標就列入（可在「目標值」頁調整）；餐廳每週至少 20 單才判斷，避免小店一兩單就上榜。D7／D25 只算非獨立店。</p></section>'+
      '<section class="analysis-panel ins-panel"><h3>📉 異常日 <span class="ins-count">'+anomalies.length+'</span></h3>'+anomalyHtml+'<p class="ins-foot">比較基準：前 4 個同一星期幾（至少 2 個有成績）的平均；單量差 '+pct(rules().anomalyTc)+' 以上、D7／D25／FA 佔比差 '+fmt(rules().anomalyRate*100,1)+' 個百分點以上，或平常每天 10 單以上的餐廳當天 0 單，就列入。不計成績的日子不比較。</p></section>';
  }
  function impactPage(stores,r){
    const metric=state.impactMetric,imp=I.impact(stores,metric,{targets,independent:independentStoreCodes,acOf:acOfFor(r.end)}),isRate=imp.kind==='rate',isCount=imp.kind==='count';
    const tabs='<div class="ins-mtabs" role="group" aria-label="影響度指標">'+[['d7','D7'],['d25','D25'],['fa','FA 佔比'],['waiting','等餐']].map(([k,l])=>'<button type="button" data-impact-metric="'+k+'" class="'+(k===metric?'active':'')+'" aria-pressed="'+(k===metric)+'">'+l+'</button>').join('')+'</div>';
    const unit=state.period==='day'?'這天':state.period==='week'?'這週':'這個月';
    if(imp.center.value===null||(isCount&&!imp.sumNeed))return tabs+'<div class="empty">'+(isCount?'本期沒有等餐登記（不代表實際沒有等餐）':'本期沒有可判讀的訂單')+'</div>';
    const head=isCount?[['等餐登記',fmt(imp.sumNeed)+' 筆',fmt(imp.stores.length)+' 家有登記'],['最多的一家',imp.stores[0].name,fmt(imp.stores[0].need)+' 筆'],['前三家占',pct(imp.stores.slice(0,3).reduce((n,s)=>n+s.need,0)/imp.sumNeed),'依筆數，不依比例']]
      :[[imp.label+' '+unit+(isRate?'（非獨立店）':''),pct(imp.center.value),isRate?fmt(imp.center[metric+'Y'])+'／'+fmt(imp.center.orders)+' 單':fmt(imp.center.fa)+'／'+fmt(imp.center.tc)+' 單'],[isRate?'目標':'上限',pct(imp.target),isRate?'需 '+fmt(Math.ceil(imp.target*imp.center.orders-1e-9))+' 單':'最多 '+fmt(Math.floor(imp.target*imp.center.tc+1e-9))+' 張 FA 單'],['中心缺口',imp.gap?fmt(imp.gap)+' 單':'已達標',imp.gap&&imp.days>1?'每天約 '+fmt(imp.perDay,1)+' 單':''],['達標方案',imp.gap?(imp.cut>=0?'補齊前 '+(imp.cut+1)+' 家':'全部補齊仍不足'):'—',imp.gap?(imp.cut>=0?fmt(imp.stores[imp.cut].cum)+' ≥ '+fmt(imp.gap)+' 單':'各店缺口合計 '+fmt(imp.sumNeed)+' 單'):'']];
    const cards='<div class="ins-head">'+head.map(([a,b,c],i)=>'<div class="ins-m'+(!isCount&&i===2&&imp.gap?' bad':'')+'"><span>'+escape(a)+'</span><b>'+escape(b)+'</b><em>'+escape(c)+'</em></div>').join('')+'</div>';
    const maxNeed=Math.max(1,...imp.stores.map(s=>s.need));
    const verb=isCount?'等餐筆數':isRate?'還要多幾單':'要少幾張 FA';
    const rows=imp.stores.map((s,i)=>'<tr class="'+(i===imp.cut?'ins-cut':imp.cut>=0&&i>imp.cut?'ins-after':'')+'"><td>'+(i+1)+'</td><td class="ins-name">'+escape((s.code?s.code+' ':'')+s.name)+'</td><td>'+escape(s.ac||'—')+'</td><td>'+fmt(s.orders)+'</td>'+(isCount?'':'<td>'+pct(s.value)+'</td>')+'<td><div class="ins-bar"><i style="width:'+(s.need/maxNeed*100).toFixed(1)+'%"></i></div><b>'+fmt(s.need)+'</b></td><td>'+(i===0?pct(s.share,0):'<span class="ins-cum">累計</span> '+pct(s.cumShare,0))+'</td>'+(isCount?'':'<td class="ins-faint">'+fmt(s.pctRank)+'</td>')+'</tr>').join('');
    const table='<div class="scroll"><table class="table ins-table"><thead><tr><th>#</th><th>餐廳</th><th>AC</th><th>'+(isRate?'有效單':'訂單')+'</th>'+(isCount?'':'<th>'+escape(imp.label)+'</th>')+'<th>'+verb+'</th><th>'+(imp.gap?'占中心缺口':'占合計')+'</th>'+(isCount?'':'<th>百分比排名</th>')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
    const how=isCount?'依等餐登記筆數排序，不依比例：大店比例低但筆數多，一樣排前面。':imp.gap?('中心'+unit+(isRate?'要再多 '+fmt(imp.gap)+' 張 '+imp.label+' 達成單（訂單總數不變，是現有訂單裡要多 '+fmt(imp.gap)+' 張準時）。':'要少 '+fmt(imp.gap)+' 張 FA 單。')+(imp.cut>=0?imp.stores.slice(0,imp.cut+1).map(s=>s.name).join('、')+' 這 '+(imp.cut+1)+' 家各自補到'+(isRate?'目標':'上限內')+'，合計 '+fmt(imp.stores[imp.cut].cum)+' 單，中心就達標。':'各店都補到目標仍不夠，需要全面提升。')):imp.label+' 已達標；下表是仍未達標的餐廳，補齊可再拉高。';
    const worstPct=imp.stores.filter(s=>s.pctRank===1)[0];
    const note=worstPct&&imp.stores.indexOf(worstPct)>0?worstPct.name+'百分比最差，但'+(isRate?'有效單只有 '+fmt(worstPct.orders)+' 張':'訂單只有 '+fmt(worstPct.orders)+' 張')+'，補齊只多 '+fmt(worstPct.need)+' 單，排第 '+(imp.stores.indexOf(worstPct)+1)+'。':'';
    const acTable='<div class="scroll"><table class="table"><thead><tr><th>AC</th><th>'+(isCount?'有登記的店':'未達標店')+'</th><th>'+verb+'</th></tr></thead><tbody>'+imp.acs.map(a=>'<tr><td>'+escape(a.name)+'</td><td>'+fmt(a.stores)+'</td><td>'+fmt(a.need)+'</td></tr>').join('')+'</tbody></table></div>';
    const formula=isCount?'等餐筆數＝等餐登記筆數（含未配對到訂單的登記）。':isRate?'還要多幾單＝有效單 ×'+pct(imp.target,0)+' − 已達成單（無條件進位），只列未達標的店；有效單＝非獨立店、非第三方、D7／D25 為 Y 或 N 的單。':'要少幾張＝FA 單 − 訂單 × '+pct(imp.target,0)+'（無條件捨去），只列超過上限的店。';
    return tabs+'<p class="ins-lead">依「補齊這家能幫中心補回幾單」排序，不是依百分比。小店百分比再低，單量少，影響也小。</p>'+cards+
      '<div class="ins-how"><b>怎麼達標：</b>'+escape(how)+(note?' '+escape(note):'')+'</div>'+
      '<div class="ins-grid2"><section class="analysis-panel"><h3>餐廳｜依影響度</h3>'+table+'<p class="ins-foot">'+escape(formula)+(imp.cut>=0?' 紅色虛線以上的店補齊，中心就達標。':'')+'</p></section>'+
      '<div class="ins-col"><section class="analysis-panel"><h3>AC｜負責的'+(isCount?'等餐':'缺口')+'</h3>'+acTable+(imp.gap&&imp.sumNeed>imp.gap?'<p class="ins-foot">各店缺口加總 '+fmt(imp.sumNeed)+' 單，大於中心缺口 '+fmt(imp.gap)+' 單，因為有些店超過目標，抵掉了一部分。</p>':'')+'</section>'+
      '</div></div>';
  }
  // 週報草稿：照每週提交格式（KPI 四項＋當週發現與行動＋GES／080／4128）。
  // 編輯模式：發現問題、證據自動；根源（附候選）、行動自己填；整份一次儲存。存過的週直接顯示檢視模式（只有「複製全部」「編輯」）。
  const BIG_ORDER_MIN=3000;
  function weeklyInputs(ctx,week){
    const prevStart=M.addDays(week.start,-7),prev={start:prevStart,end:M.addDays(prevStart,6)};
    const inScope=o=>M.storeInScope(o.code,o.date,o.name);
    let orders=[],prevOrders=[];try{orders=analysisOrders(ctx.data,week).filter(inScope);prevOrders=analysisOrders(ctx.data,prev).filter(inScope);}catch(e){}
    // 熱圖最差時段（外送時段內）
    const dh=M.BUSINESS.deliveryHours||{start:'10:30',end:'22:30'},toMin=t=>{const [a,b]=String(t).split(':').map(Number);return a*60+(b||0);},s0=toMin(dh.start),s1=toMin(dh.end);
    const minuteOf=ms=>ms===null||ms===undefined||!Number.isFinite(ms)?null:Math.floor((ms+8*3600000)/60000)%1440;
    const inHours=orders.filter(o=>{const m=minuteOf(o.moment);return m!==null&&m>=s0&&m<=s1;}).map(o=>({date:o.date,hour:hourOf(o.moment),code:o.code,fa:o.fa,d7:o.d7,d25:o.d25,wait:o.wait}));
    const hourList=[];for(let h=Math.floor(s0/60);h<=Math.floor(s1/60);h++)hourList.push(h);
    const slots={};for(const k of ['d7','d25','fa']){try{const hm=I.heatmap(inHours,k,{independent:ctx.independent,hourList}),w=hm.worst[0];if(w)slots[k]={weekday:w.weekday,hour:w.hour,value:w.value,overall:hm.overall};}catch(e){}}
    // D7 未達成的集中單（同店 30 分鐘內 6 張以上）
    const cl=new Map();for(const o of orders)if(o.cluster&&!o.fa&&o.d7==='N'&&!ctx.independent.has(o.code))cl.set(o.name,(cl.get(o.name)||0)+1);
    const clusters=[...cl].map(([name,n])=>({name,n}));
    // 大單：餐點金額門檻以上，本週對上週
    const amt=o=>Number(String((o.raw||{})['餐點金額']??'').replace(/,/g,''));
    const big=list=>{const by=new Map();let n=0,amount=0;for(const o of list){const a=amt(o);if(!Number.isFinite(a)||a<BIG_ORDER_MIN)continue;n++;amount+=a;by.set(o.name,(by.get(o.name)||0)+1);}return {n,amount,by};};
    const bn=big(orders),bp=big(prevOrders),names=new Set([...bn.by.keys(),...bp.by.keys()]);
    const bigOrders=orders.length||prevOrders.length?{min:BIG_ORDER_MIN,now:{n:bn.n,amount:bn.amount},prev:{n:bp.n,amount:bp.amount},stores:[...names].map(name=>({name,now:bn.by.get(name)||0,prev:bp.by.get(name)||0}))}:null;
    // 每日 TC 對去年同期
    const daily=S.dates(week.start,week.end).map(d=>{try{return {date:d,sstg:model(ctx.data,{start:d,end:d}).summary.sstg??null};}catch(e){return {date:d,sstg:null};}});
    // GES／080／4128
    const fbAll=ctx.data.feedback||[];
    const fbOf=w=>{const daily=fbAll.filter(x=>x.record_date>=w.start&&x.record_date<=w.end&&x.feedback_kind!=='其他/建議');
      const c0800={},c4128={},st=new Map();
      for(const x of daily){if(x.source_type==='0800'){const k=String(x.main_topic||'未分類').trim();c0800[k]=(c0800[k]||0)+1;}else if(x.source_type==='4128'){const k=String(x.complaint_type||'未分類').trim()||'未分類';c4128[k]=(c4128[k]||0)+1;}else continue;const nm=x.restaurant_name||x.store_code||'未分類';st.set(nm,(st.get(nm)||0)+1);}
      const ges=fbAll.filter(x=>x.source_type==='GES'&&x.period_start&&x.period_end&&x.period_start<=w.end&&x.period_end>=w.start&&x.period_start>=M.addDays(w.start,-1)&&x.period_end<=M.addDays(w.end,1));
      const avg=k=>{let s=0,n=0;for(const x of ges){const v=Number(x[k]),c=Number(x.response_count)||1;if(x[k]===null||x[k]===undefined||!Number.isFinite(v))continue;s+=v*c;n+=c;}return n?s/n:null;};
      const g=ges.length?{food:avg('score_food'),speed:avg('score_speed'),accuracy:avg('score_accuracy'),delivery:avg('osat_delivery'),responses:ges.reduce((n,x)=>n+(Number(x.response_count)||0),0)}:null;
      return {c0800,c4128,ges:g,stores:[...st].map(([name,n])=>({name,n})).sort((a,b)=>b.n-a.n)};};
    const fn=fbOf(week),fp=fbOf(prev),hasFb=x=>Object.keys(x.c0800).length||Object.keys(x.c4128).length||x.ges;
    const feedback=hasFb(fn)||hasFb(fp)?{now:fn,prev:hasFb(fp)?fp:{}}:null;
    return {slots,clusters,bigOrders,daily,feedback};
  }
  function weeklyTitle(week){return M.BUSINESS.centerName?('T'+M.BUSINESS.center+' 營運週報｜'+week.label+'（'+week.start.slice(5).replace('-','/')+'–'+week.end.slice(5).replace('-','/')+'）'):'營運週報｜'+week.label;}
  // 存過的週：發現問題、證據用當時存下的文字，複製內容和儲存時一致
  function weeklySaved(draft){return draft.sections.some(s=>s.note&&s.note.updated_at);}
  function weeklyView(draft){return {...draft,sections:draft.sections.map(s=>{const n=s.note||{};return {...s,issue:n.issue||s.issue,evidence:n.evidence?String(n.evidence).split('\n').filter(Boolean).map(text=>({text})):s.evidence};})};}
  function weeklyFills(draft,box){const fills={};
    if(box&&box.querySelector('#wkForm'))box.querySelectorAll('#wkForm textarea[data-key]').forEach(t=>{(fills[t.dataset.key]=fills[t.dataset.key]||{})[t.name]=t.value.trim();});
    else for(const s of draft.sections){const n=s.note||{};fills[s.key]={root_cause:n.root_cause||'',action_plan:n.action_plan||''};}
    return fills;}
  function weeklyPage(ctx,r){
    if(state.period!=='week')return '<div class="ins-switch"><p>週報草稿以「週」產生。</p><button type="button" class="ins-link primary" data-ins-period="week">切換到週</button></div>';
    const week={start:r.start,end:r.end,label:S.weekLabel(r.start)},weeks=ctx.weeks.slice(-3);
    const sssg=weeks.map(w=>{const x=weeklySales.find(y=>y.start===w.start);return x?{value:x.value,stores:x.stores||[]}:null;});
    const anomalyList=I.anomalies({cells:ctx.cells,dates:S.dates(r.start,r.end),excluded:ctx.excluded,independent:ctx.independent,context:ctx.context,tcThreshold:rules().anomalyTc,rateThreshold:rules().anomalyRate,inScope:M.storeInScope});
    const sum=ctx.weekSummary(week),hoursDays=sum?7-(sum.missingHourDays||[]).filter(d=>d>=r.start&&d<=r.end).length:null;
    const draft=I.weeklyDraft({week,weeks,cells:ctx.cells,targets,independent:ctx.independent,excluded:ctx.excluded,acOf:ctx.acOf,weekSummary:ctx.weekSummary,anomalyList,notes:ctx.data.weeklyNotes||[],dataDays:{hours:hoursDays},inScope:M.storeInScope,sssg,...weeklyInputs(ctx,week)});
    state.weeklyDraft=draft;
    const title=weeklyTitle(week),editing=state.weeklyEdit===week.start||!weeklySaved(draft);
    const missing=draft.missing.length?'<p class="wk-missing">資料不齊：'+escape(draft.missing.join('、'))+'。</p>':'';
    if(!editing){
      const view=weeklyView(draft),text=I.weeklyText(view,{title,fills:weeklyFills(view,null)});
      const last=draft.sections.map(s=>s.note?.updated_at).filter(Boolean).sort().at(-1);
      return '<div class="wk-tools"><button type="button" class="ins-link primary" data-wk="copy">複製全部</button><button type="button" class="ins-link" data-wk="edit">編輯</button><span class="wk-status" id="wkToolStatus" role="status">'+(last?'已儲存 '+escape(new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(last))):'')+'</span></div>'+
        '<article class="wk-doc wk-viewdoc">'+missing+'<pre class="wk-view">'+escape(text)+'</pre></article>';
    }
    const fmtFollow=fu=>fu?'<div class="wk-prev"><b>上週行動：</b>'+escape(fu.text)+(fu.compare.length?'<br><b>本週數字：</b>'+escape(fu.compare.join('；')):'')+'</div>':'';
    const sections=draft.sections.map((sec,i)=>{
      const n=sec.note||{},f=sec.fields||{},isFind=sec.key==='findings';
      const badge=sec.info?'':sec.judged===false?' <span class="wk-na">無法判斷</span>':sec.met?' <span class="wk-ok">達標</span>':' <span class="wk-bad">未達標</span>';
      const cands=(sec.candidates||[]).map(c=>'<button type="button" class="wk-cand" data-wk-cand="'+escape(c)+'" data-key="'+sec.key+'">'+escape(c)+'</button>').join('');
      return '<section class="wk-sec'+(sec.met&&sec.judged!==false&&!sec.info?' wk-met':'')+'"><h3>'+(I.CN?.[i]||i+1)+'、'+escape(sec.label)+badge+'</h3>'+
        '<div class="wk-blk"><b>＊'+(isFind?'當週發現':'發現問題')+' <span class="wk-auto">自動</span></b><p class="wk-pre">'+escape(sec.issue)+'</p></div>'+
        (sec.evidence.length?'<div class="wk-blk"><b>＊提出證據 <span class="wk-auto">自動</span></b><ul>'+sec.evidence.map(e=>'<li>'+escape(e.text)+' <span class="wk-src">'+escape(e.src||'')+'</span>'+(e.link?' '+insightLink(e.link,'看排名'):'')+'</li>').join('')+'</ul></div>':'')+
        '<div class="wk-blk wk-fill"><b>＊'+escape(isFind?f.root_cause:'根源')+' <span class="wk-you">要你填</span></b>'+(cands?'<div class="wk-cands"><span>候選（點一下帶入）：</span>'+cands+'</div>':'')+'<textarea name="root_cause" data-key="'+sec.key+'" rows="3" placeholder="在這裡寫……">'+escape(n.root_cause||'')+'</textarea></div>'+
        '<div class="wk-blk wk-fill"><b>＊'+escape(isFind?f.action_plan:'制定行動')+' <span class="wk-you">要你填</span></b>'+fmtFollow(sec.followup)+'<textarea name="action_plan" data-key="'+sec.key+'" rows="3" placeholder="在這裡寫……">'+escape(n.action_plan||'')+'</textarea></div></section>';
    }).join('');
    const tools='<div class="wk-tools"><button type="button" class="ins-link" data-wk="regen">重新產生</button>'+(weeklySaved(draft)?'<button type="button" class="ins-link" data-wk="cancel">取消編輯</button>':'')+'<button type="submit" form="wkForm" class="ins-link primary">儲存週報</button><span class="wk-status" id="wkToolStatus" role="status"></span></div>';
    return tools+'<form id="wkForm"><article class="wk-doc"><h2>'+escape(title)+'</h2><div class="wk-meta"><span class="wk-auto">自動</span>＝系統產生　<span class="wk-you">要你填</span>＝根源與行動；存檔後變成可一鍵複製的週報</div><p class="wk-head">'+escape(draft.headline)+'</p>'+missing+sections+'</article></form>'+
      '<div class="wk-tools wk-bottom"><button type="submit" form="wkForm" class="ins-link primary">儲存週報</button></div>'+
      '<p class="ins-foot">D7／D25 只算非獨立店；大單＝餐點金額 '+fmt(BIG_ORDER_MIN)+' 元以上。根源與行動存在「週行動追蹤」，和各指標分頁下方的表單是同一筆紀錄。</p>';
  }
  async function saveWeekly(box,r){
    const draft=state.weeklyDraft,fills=weeklyFills(draft,box),user=await db.auth.getUser(),now=new Date().toISOString();
    const rows=draft.sections.map(s=>{const n=s.note||{},f=fills[s.key]||{};return {week_start:r.start,metric_key:s.key,issue:s.issue.slice(0,4000),evidence:s.evidence.map(e=>e.text).join('\n').slice(0,4000),root_cause:(f.root_cause||'').slice(0,4000),action_plan:(f.action_plan||'').slice(0,4000),last_week_followup:n.last_week_followup||'',updated_by:user.data.user?.id||null,updated_at:now};});
    const result=await db.from('t998_weekly_metric_action_notes').upsert(rows,{onConflict:'week_start,metric_key'});if(result.error)throw result.error;
    // KPI 段落的「制定行動」同步到行動追蹤（從下週一開始追蹤成效）；負責欄標「週報」，只更新這些自動建立的紀錄
    const next=M.addDays(r.start,7),kpi=draft.sections.filter(s=>['d7','sstg','fa','tplh'].includes(s.key));
    const ex=await db.from('t998_action_items').select('id,metric_key,action').eq('week_start',next).is('store_code',null).eq('owner','週報').eq('archived',false);if(ex.error)throw ex.error;
    for(const s of kpi){const action=((fills[s.key]||{}).action_plan||'').trim().slice(0,500),old=(ex.data||[]).find(x=>x.metric_key===s.key);
      if(!action){if(old){const u=await db.from('t998_action_items').update({archived:true}).eq('id',old.id);if(u.error)throw u.error;}continue;}
      if(old){if(old.action!==action){const u=await db.from('t998_action_items').update({action}).eq('id',old.id);if(u.error)throw u.error;}}
      else{const ins=await db.from('t998_action_items').insert({week_start:next,store_code:null,target_label:'中心（週報 '+S.weekLabel(r.start)+'）',action,metric_key:s.key,owner:'週報'});if(ins.error)throw ins.error;}}
    state.actions=null;
  }
  function bindInsights(ctx,r){
    const box=$('metricContent');
    box.onclick=async event=>{
      const t=event.target.closest('button');if(!t)return;
      if(drillClick(t)){renderMetric(state.data,state.previous,range());if(state.metric==='drill'&&t.dataset.drillOpen!==undefined)window.scrollTo({top:0,behavior:'smooth'});return;}
      if(t.dataset.impactMetric){state.impactMetric=t.dataset.impactMetric;renderMetric(state.data,state.previous,range());return;}
      if(t.dataset.insTab){state.metric=t.dataset.insTab;if(t.dataset.insMetric&&['d7','d25','fa','waiting'].includes(t.dataset.insMetric))state.impactMetric=t.dataset.insMetric;syncMetricTab();renderMetric(state.data,state.previous,range());window.scrollTo({top:0,behavior:'smooth'});return;}
      if(t.dataset.insDay){state.period='day';state.date=t.dataset.insDay;state.month=state.date.slice(0,7);state.metric='d7';loadReport();return;}
      if(t.dataset.insPeriod){state.period=t.dataset.insPeriod;state.month=state.date.slice(0,7);loadReport();return;}
      if(t.dataset.copy!==undefined){try{await navigator.clipboard.writeText(t.dataset.copy);t.textContent='已複製';}catch(e){t.textContent='無法複製，請手動選取';}return;}
      if(t.dataset.wk==='regen'){loadReport(true);return;}
      if(t.dataset.wk==='print'){window.print();return;}
      if(t.dataset.addAction){state.actionPrefill={metric:t.dataset.addAction,store:t.dataset.store||''};state.metric='actions';syncMetricTab();renderMetric(state.data,state.previous,range());window.scrollTo({top:0,behavior:'smooth'});return;}
      if(t.dataset.wkCand!==undefined){const ta=box.querySelector('#wkForm textarea[name="root_cause"][data-key="'+t.dataset.key+'"]');if(ta){const v=t.dataset.wkCand;if(!ta.value.includes(v))ta.value=(ta.value.trim()?ta.value.replace(/\s+$/,'')+'\n':'')+v;ta.focus();}return;}
      if(t.dataset.wk==='edit'){state.weeklyEdit=r.start;renderMetric(state.data,state.previous,range());return;}
      if(t.dataset.wk==='cancel'){state.weeklyEdit=null;renderMetric(state.data,state.previous,range());return;}
      if(t.dataset.wk==='copy'){const view=weeklyView(state.weeklyDraft),text=I.weeklyText(view,{title:weeklyTitle({start:r.start,end:r.end,label:S.weekLabel(r.start)}),fills:weeklyFills(view,null)});try{await navigator.clipboard.writeText(text);$('wkToolStatus').textContent='已複製週報，可以直接貼上';}catch(e){$('wkToolStatus').textContent='無法自動複製，請手動選取下方文字';}return;}
    };
    const wkForm=box.querySelector('#wkForm');
    if(wkForm)wkForm.onsubmit=async event=>{
      event.preventDefault();const status=$('wkToolStatus'),buttons=[...box.querySelectorAll('button[form="wkForm"]')];
      buttons.forEach(b=>b.disabled=true);status.textContent='儲存中…';
      try{await saveWeekly(box,r);state.weeklyEdit=null;state.cache.clear();await loadReport(true);}
      catch(error){status.textContent='儲存失敗：'+(error.message||error);buttons.forEach(b=>b.disabled=false);}
    };
  }
  // ===== 儀表板 v2｜C4 餐廳頁、D1／D3 行動追蹤與自訂比較、D2 目標值設定 =====
  const KS=window.KpiSettings;
  const rules=()=>KS?KS.rules():{alertDays:3,alertWeeks:2,anomalyTc:0.15,anomalyRate:0.05};
  const metricNames={d7:'D7',d25:'D25',fa:'FA 佔比',tplh:'TPLH',sstg:'SSTG',waiting:'等餐筆數'};
  const lowerBetter=k=>k==='fa'||k==='waiting';
  const metricTarget=k=>k==='fa'?targets.faShareMax:k==='waiting'?null:targets[k];
  const fmtMetric=(k,v)=>v===null||v===undefined||!Number.isFinite(v)?'—':k==='tplh'?fmt(v,2):k==='waiting'?fmt(v):k==='sstg'?(v>0?'+':'')+pct(v):pct(v);
  const fmtDelta=(k,d)=>d===null||!Number.isFinite(d)?'—':k==='tplh'?(d>=0?'+':'−')+fmt(Math.abs(d),2):k==='waiting'?(d>=0?'+':'−')+fmt(Math.abs(d)):(d>=0?'+':'−')+fmt(Math.abs(d*100),1)+' 點';
  // 一段期間的指標：餐廳（code）或中心（code 為空）；TPLH／SSTG 中心值用原本的成績計算
  function rangeMetrics(data,cells,range,code){
    const excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),stores=I.byStore(cells,range.start,range.end,excluded),x=code?stores.find(s=>s.code===code):I.center(stores,independentStoreCodes);
    const out={tc:x?x.tc:null,d7:x?I.value(x,'d7'):null,d25:x?I.value(x,'d25'):null,fa:x?I.value(x,'fa'):null,waiting:x?x.wait:null,tplh:null,sstg:null,hoursDays:null};
    try{if(code){const s=storeAnalytics(data,range).find(s=>s.code===code);out.sstg=s?.sstg??null;}else{const m=model(data,range);out.sstg=m.summary.sstg??null;out.tplh=m.summary.tplh??null;out.hoursDays=S.dates(range.start,range.end).length-(m.missingHourDays||[]).length;}}catch(e){}
    return out;
  }
  async function pagedLine(r){const rows=[];for(let o=0;;o+=1000){const x=await db.from('t998_line_signature_records').select('record_date,store_code,line_completed,signature_completed').gte('record_date',r.start).lte('record_date',r.end).order('record_date').range(o,o+999);if(x.error)throw x.error;rows.push(...(x.data||[]));if(!x.data||x.data.length<1000)return rows;}}
  state.storeCode=null;
  async function storePage(ctx,r){
    const stores=[...state.catalog.values()].filter(s=>M.storeInScope(s.store_code,r.end)).sort((a,b)=>a.store_code.localeCompare(b.store_code));
    if(!state.storeCode||!stores.some(s=>s.store_code===state.storeCode)){const worst=I.impact(I.byStore(ctx.cells,r.start,r.end,ctx.excluded),'d7',{targets,independent:independentStoreCodes}).stores[0];state.storeCode=worst?.code||stores[0]?.store_code||null;}
    const code=state.storeCode,store=state.catalog.get(code),ac=ctx.acOf(code),weeks=ctx.weeks.slice(-8);
    let lines=[];try{lines=await pagedLine({start:weeks[0].start,end:weeks.at(-1).end});}catch(e){lines=null;}
    const todayStr=today(),per=weeks.map(w=>{const m=rangeMetrics(ctx.data,ctx.cells,w,code),days=S.dates(w.start,[w.end,todayStr].sort()[0]).filter(d=>!ctx.excluded.has(d)&&ctx.cells.some(c=>c.date===d&&c.code===code&&c.tc>0)),signed=lines?days.filter(d=>lines.some(l=>l.record_date===d&&l.store_code===code&&l.line_completed&&l.signature_completed)).length:null;const ges=(ctx.data.feedback||[]).filter(f=>f.source_type==='GES'&&f.period_start<=w.end&&f.period_end>=w.start&&(f.store_code===code||M.clean(f.restaurant_name)===M.clean(store?.restaurant_name))).map(f=>Number(f.osat_survey)).filter(Number.isFinite);return {...m,line:lines?[signed,days.length]:null,ges:ges.length?ges.reduce((a,b)=>a+b,0)/ges.length:null};});
    const independent=independentStoreCodes.has(code);
    const rowsSpec=[['d7','D7'],['d25','D25'],['fa','FA 佔比'],['waiting','等餐筆數'],['line','劃線簽名'],['sstg','SSTG'],['ges','GES OSAT']];
    const cell=(k,v)=>k==='line'?(v&&v[1]>0?fmt(v[0])+'／'+fmt(v[1]):'—'):k==='ges'?(v===null?'—':pct(v)):fmtMetric(k,v);
    const isBad=(k,v)=>{if(v===null||v===undefined)return false;if(k==='line')return v&&v[1]>0&&v[0]<v[1];const t=metricTarget(k);if(t===null||t===undefined)return false;return I.fails(v,k==='fa'?'fa':'d7',t)&&(k==='fa'?v>t:v<t);};
    const streakOf=k=>{let n=0;for(let i=per.length-1;i>=0;i--){const v=k==='line'?per[i].line:per[i][k];if(!isBad(k,v))break;n++;}return n;};
    const targetCell=k=>k==='line'?'每天':k==='fa'?'≤'+pct(targets.faShareMax):k==='sstg'?(targets.sstg>0?'+':'')+pct(targets.sstg):['d7','d25'].includes(k)?pct(targets[k]):'—';
    const body=rowsSpec.map(([k,l])=>'<tr><th>'+l+(independent&&['d7','d25'].includes(k)?'<small>（獨立店）</small>':'')+'</th>'+per.map(p=>{const v=k==='line'?p.line:p[k];return '<td class="'+(isBad(k,v)?'st-bad':'')+'">'+cell(k,v)+'</td>';}).join('')+'<td class="ins-faint">'+targetCell(k)+'</td><td>'+(streakOf(k)>=2?'<b class="st-bad">'+streakOf(k)+' 週</b>':'—')+'</td></tr>').join('');
    // 系統觀察：只陳述數字，不推定原因
    const last=per.at(-1),base=per.slice(-5,-1),avg=k=>{const v=base.map(p=>p[k]).filter(x=>x!==null&&x!==undefined);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;},notes=[];
    for(const k of ['d7','d25','fa']){const a=avg(k);if(last[k]!==null&&a!==null&&Math.abs(last[k]-a)>=0.03)notes.push(metricNames[k]+' 本週 '+pct(last[k])+'，比前 4 週平均'+(last[k]>a?'高':'低')+' '+fmt(Math.abs(last[k]-a)*100,1)+' 點');}
    { const a=avg('tc');if(last.tc!==null&&a)notes.push('單量 '+fmt(last.tc)+'，前 4 週平均 '+fmt(a)+'（'+(last.tc>=a?'+':'−')+pct(Math.abs(last.tc/a-1))+'）'); }
    { const a=avg('waiting');if(last.waiting!==null&&a!==null&&last.waiting>a+2)notes.push('等餐登記 '+fmt(last.waiting)+' 筆，前 4 週平均 '+fmt(a,1)+' 筆'); }
    const reasons=new Map();for(const d of ctx.data.delays||[]){if(String(d.store_code)!==code||d.record_date<r.start||d.record_date>r.end)continue;const k=String(d.reason||'').trim()||'未填原因';reasons.set(k,(reasons.get(k)||0)+1);}
    const actions=(state.actions||[]).filter(a=>a.store_code===code&&!a.archived);
    return '<div class="st-pick"><label>餐廳 <select id="storePick">'+stores.map(s=>'<option value="'+escape(s.store_code)+'"'+(s.store_code===code?' selected':'')+'>'+escape(s.store_code+' '+s.restaurant_name)+'</option>').join('')+'</select></label><span class="ins-faint">AC：'+escape(ac||'未設定')+'</span></div>'+
      '<p class="ins-lead">一家店近 8 週的指標放在一起，看出是哪一項一直拖累。紅字＝未達標；「—」＝沒有資料，不是 0。</p>'+
      '<section class="analysis-panel"><h3>'+escape(code+' '+(store?.restaurant_name||''))+'｜近 8 週 <button type="button" class="ins-link" data-drill-open="'+escape(code)+'">🔍 看這家的明細與熱圖</button></h3><div class="scroll"><table class="table st-table"><thead><tr><th>指標</th>'+per.map((p,i)=>'<th>'+escape(weeks[i].label)+'</th>').join('')+'<th>目標</th><th>連續未達標</th></tr></thead><tbody>'+body+'</tbody></table></div>'+(lines===null?'<p class="ins-foot">劃線簽名資料讀取失敗。</p>':'')+'<p class="ins-foot">D7／D25 為這家店的非第三方訂單；劃線簽名＝有訂單的日子中，劃線和簽名都完成的天數。GES 只有月資料時，跨到的週都顯示同一個值。</p></section>'+
      '<div class="ins-grid2"><section class="analysis-panel"><h3>系統觀察（參考用）</h3>'+(notes.length?'<ul class="st-notes">'+notes.map(n=>'<li>'+escape(n)+'</li>').join('')+'</ul>':'<p class="ins-foot">本週沒有明顯變化。</p>')+'<p class="ins-foot">只比較數字，不代表原因。</p></section>'+
      '<section class="analysis-panel"><h3>等餐原因（'+escape(periodLabel(r).split('　')[0])+'）</h3>'+(reasons.size?'<ul class="st-notes">'+[...reasons].sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<li>'+escape(k)+'：'+fmt(v)+' 筆</li>').join('')+'</ul>':'<p class="ins-foot">本期沒有等餐登記。</p>')+(actions.length?'<h3>這家店的行動</h3><ul class="st-notes">'+actions.map(a=>'<li>'+escape(S.weekLabel(a.week_start)+'｜'+a.action+'（'+(metricNames[a.metric_key]||a.metric_key)+'）')+'</li>').join('')+'</ul>':'')+'</section></div>';
  }
  async function loadActions(){const r=await db.from('t998_action_items').select('*').eq('archived',false).order('week_start',{ascending:false}).limit(200);if(r.error)throw r.error;state.actions=r.data||[];return state.actions;}
  async function actionsPage(ctx,r){
    const pre=state.actionPrefill||{};state.actionPrefill=null;
    let actions=null,error='';try{actions=await loadActions();}catch(e){error=e.message||String(e);}
    const stores=[...state.catalog.values()].filter(s=>M.storeInScope(s.store_code,r.end)).sort((a,b)=>a.store_code.localeCompare(b.store_code)),acs=M.acAssignmentsForDate(r.end).map(a=>a.name);
    const thisWeek=fullWeek(r.end).start,lastData=ctx.cells.reduce((m,c)=>c.date>m?c.date:m,'');
    const rows=(actions||[]).map(a=>{
      const before={start:M.addDays(a.week_start,-14),end:M.addDays(a.week_start,-1)},after={start:a.week_start,end:M.addDays(a.week_start,13)},k=a.metric_key,store=a.store_code||'';
      const inSpan=before.start>=ctx.span.start,complete=after.end<=lastData;
      const b=inSpan?rangeMetrics(ctx.data,ctx.cells,before,store)[k]:null,f=inSpan&&after.start<=lastData?rangeMetrics(ctx.data,ctx.cells,{start:after.start,end:[after.end,lastData].sort()[0]},store)[k]:null;
      const d=b!==null&&f!==null&&b!==undefined&&f!==undefined?f-b:null,step=k==='tplh'?0.1:k==='waiting'?1:0.01,better=d===null?null:lowerBetter(k)?-d:d;
      const result=!inSpan?'<span class="ins-faint">超出讀取範圍</span>':!complete?'<span class="ac-tag ac-wait">追蹤中</span>':better===null?'—':better>step?'<span class="ac-tag ac-good">有改善</span>':better<-step?'<span class="ac-tag ac-bad">沒改善</span>':'<span class="ac-tag">變化小</span>';
      return '<tr><td>'+escape(S.weekLabel(a.week_start))+'</td><td class="ins-name">'+escape(a.target_label)+'</td><td class="ins-name">'+escape(a.action)+'</td><td>'+escape(metricNames[k]||k)+'</td><td>'+fmtMetric(k,b)+'</td><td>'+fmtMetric(k,f)+'</td><td>'+fmtDelta(k,d)+'</td><td>'+result+'</td><td>'+escape(a.owner||'—')+'</td><td><button type="button" class="ins-link" data-archive="'+a.id+'">封存</button></td></tr>';}).join('');
    const form='<form id="actionForm" class="ac-form"><label>週次<input type="date" name="week_start" value="'+thisWeek+'" required></label><label>對象<select name="store_code"><option value="">中心</option>'+stores.map(s=>'<option value="'+escape(s.store_code)+'"'+(pre.store===s.store_code?' selected':'')+'>'+escape(s.store_code+' '+s.restaurant_name)+'</option>').join('')+'</select></label><label>指標<select name="metric_key">'+Object.entries(metricNames).map(([k,l])=>'<option value="'+k+'"'+(pre.metric===k?' selected':'')+'>'+l+'</option>').join('')+'</select></label><label class="ac-wide">行動<input name="action" maxlength="500" required placeholder="例如：出餐前 5 分鐘通知外送員"></label><label>負責<input name="owner" list="acList" maxlength="40"><datalist id="acList">'+acs.map(a=>'<option value="'+escape(a)+'">').join('')+'</datalist></label><button type="submit" class="ins-link primary">新增行動</button><span class="wk-status" id="actionStatus" role="status"></span></form>';
    const tracking='<section class="analysis-panel"><h3>行動追蹤與成效</h3><p class="ins-foot" style="margin-top:0">每筆行動記下後，系統自動比較「行動前兩週」與「行動後兩週」（從行動那週的星期一算起）。</p>'+(actions===null?'<div class="empty">行動清單讀取失敗：'+escape(error)+'（資料表可能尚未建立）</div>':form+(actions.length?'<div class="scroll"><table class="table ins-table ac-table"><thead><tr><th>週次</th><th>對象</th><th>行動</th><th>指標</th><th>行動前</th><th>行動後</th><th>變化</th><th>結果</th><th>負責</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="empty">還沒有行動，從上面新增第一筆。</div>'))+'<p class="ins-foot">有改善＝往目標方向超過 1 個百分點（TPLH 0.1、等餐 1 筆）；行動後還不滿兩週顯示「追蹤中」。中心的 D7／D25 只算非獨立店。</p></section>';
    const a0=fullWeek(r.end),b0={start:M.addDays(a0.start,-7),end:M.addDays(a0.end,-7)};
    const compare='<section class="analysis-panel"><h3>自訂比較</h3><form id="compareForm" class="cmp-form"><span>A</span><input type="date" name="as" value="'+a0.start+'"><span>–</span><input type="date" name="ae" value="'+a0.end+'"><b>vs</b><span>B</span><input type="date" name="bs" value="'+b0.start+'"><span>–</span><input type="date" name="be" value="'+b0.end+'"><button type="submit" class="ins-link primary">比較</button></form><div class="cmp-quick">快速選 B：<button type="button" class="ins-link" data-cmp="7">上週</button><button type="button" class="ins-link" data-cmp="28">4 週前</button><button type="button" class="ins-link" data-cmp="364">去年同週</button></div><div id="compareOut"></div></section>';
    return tracking+compare;
  }
  async function runCompare(){
    const f=$('compareForm');if(!f)return;const A={start:f.as.value,end:f.ae.value},B={start:f.bs.value,end:f.be.value},out=$('compareOut');
    if(!A.start||!A.end||!B.start||!B.end||A.start>A.end||B.start>B.end){out.innerHTML='<div class="empty">日期區間不正確</div>';return;}
    out.innerHTML='<div class="empty">讀取中…</div>';
    try{const [da,dbb]=await Promise.all([loadRange(A),loadRange(B)]),ma=rangeMetrics(da,insightCells(da,A),A,''),mb=rangeMetrics(dbb,insightCells(dbb,B),B,'');
      const keys=[['tc','TC'],['d7','D7'],['d25','D25'],['fa','FA 佔比'],['waiting','等餐筆數'],['tplh','TPLH'],['sstg','SSTG']];
      const diff=(k,a,b)=>a===null||b===null||a===undefined||b===undefined?'—':k==='tc'?(b?((a/b-1)>=0?'+':'−')+pct(Math.abs(a/b-1)):'—'):fmtDelta(k,a-b);
      const v=(k,m)=>{const R=m===ma?A:B;return k==='tc'?fmt(m.tc):fmtMetric(k,m[k])+(k==='tplh'&&m.hoursDays!==null?' <small class="ins-faint">'+m.hoursDays+'／'+S.dates(R.start,R.end).length+' 天</small>':'');};
      out.innerHTML='<div class="scroll"><table class="table"><thead><tr><th>指標</th><th>A '+escape(A.start.slice(5)+'–'+A.end.slice(5))+'</th><th>B '+escape(B.start.slice(5)+'–'+B.end.slice(5))+'</th><th>差（A−B）</th></tr></thead><tbody>'+keys.map(([k,l])=>'<tr><th>'+l+'</th><td>'+v(k,ma)+'</td><td>'+v(k,mb)+'</td><td>'+diff(k,ma[k],mb[k])+'</td></tr>').join('')+'</tbody></table></div><p class="ins-foot">D7／D25 只算非獨立店；TPLH 後面的小字是有工時的天數。「—」＝沒有資料。</p>';
    }catch(e){out.innerHTML='<div class="empty">讀取失敗：'+escape(e.message||e)+'</div>';}
  }
  async function targetsPage(){
    if(!KS)return '<div class="empty">目標值模組未載入</div>';
    await KS.load(db,{force:true});const st=KS.state,defaults=KS.defaults(),rule=KS.rules(),saved=new Map(st.rows.map(x=>[x.key,x]));
    let log=[];try{log=st.available?await KS.changes(db):[];}catch(e){}
    const valueOf=f=>f.group==='rule'?rule[f.key]:targets[f.key],toInput=(f,v)=>v===null||v===undefined?'':f.unit==='%'||f.points?+(v*100).toFixed(2):v;
    const fieldRow=f=>'<tr><th>'+escape(f.label)+'</th><td><input type="number" step="'+(f.int?1:'any')+'" name="'+f.key+'" value="'+toInput(f,valueOf(f))+'"'+(st.available?'':' disabled')+'> '+escape(f.unit)+'</td><td class="ins-faint">'+escape(f.dir||'')+'</td><td class="ins-faint">'+(saved.has(f.key)?'已自訂':'預設 '+escape(String(toInput(f,f.group==='rule'?KS.RULE_DEFAULTS[f.key]:defaults[f.key]))+f.unit))+'</td></tr>';
    const labelOf=k=>KS.FIELDS.find(f=>f.key===k)?.label||k,show=(k,v)=>{const f=KS.FIELDS.find(x=>x.key===k);return v===null||v===undefined?'—':f&&(f.unit==='%'||f.points)?+(Number(v)*100).toFixed(2)+(f.points?' 點':'%'):String(+Number(v).toFixed(2));};
    return (st.available?'':'<div class="ins-how"><b>目標值資料表尚未建立</b>，目前沿用程式設定檔的數值，暫時不能在這裡修改。</div>')+
      '<p class="ins-lead">在這裡改一次，總覽、儀表板、影響度排名、預警、週報都一起更新。改動會留紀錄。</p><form id="targetsForm">'+
      '<section class="analysis-panel"><h3>營運指標</h3><div class="scroll"><table class="table tg-table"><thead><tr><th>指標</th><th>目標</th><th>方向</th><th>狀態</th></tr></thead><tbody>'+KS.FIELDS.filter(f=>f.group==='target').map(fieldRow).join('')+'</tbody></table></div><p class="ins-foot">SSTG 填 4.2 代表 +4.2%。指休排班的高標準（TPLH '+fmt(M.BUSINESS.forecast?.tplh,1)+'、第三方 ≤'+pct(M.BUSINESS.forecast?.thirdParty)+'）依你的決定和營運目標分開，不在這裡改。</p></section>'+
      '<section class="analysis-panel"><h3>預警規則</h3><div class="scroll"><table class="table tg-table"><tbody>'+KS.FIELDS.filter(f=>f.group==='rule').map(fieldRow).join('')+'</tbody></table></div></section>'+
      '<div class="wk-save"><button type="submit" class="ins-link primary"'+(st.available?'':' disabled')+'>儲存</button><span class="wk-status" id="targetsStatus" role="status"></span></div></form>'+
      '<section class="analysis-panel"><h3>變更紀錄</h3>'+(log.length?'<div class="scroll"><table class="table"><thead><tr><th>時間</th><th>項目</th><th>原本</th><th>改成</th></tr></thead><tbody>'+log.map(x=>'<tr><td>'+escape(String(x.changed_at).slice(0,16).replace('T',' '))+'</td><td>'+escape(labelOf(x.key))+'</td><td>'+show(x.key,x.old_value)+'</td><td>'+show(x.key,x.new_value)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="ins-foot">還沒有變更紀錄。</p>')+'</section>';
  }
  function bindV2(r){
    const pick=$('storePick');if(pick)pick.onchange=()=>{state.storeCode=pick.value;renderMetric(state.data,state.previous,range());};
    const af=$('actionForm');if(af)af.onsubmit=async e=>{e.preventDefault();const s=$('actionStatus'),b=af.querySelector('button[type="submit"]'),v=Object.fromEntries(new FormData(af).entries()),store=v.store_code||null,label=store?(store+' '+(state.catalog.get(store)?.restaurant_name||'')):'中心';
      b.disabled=true;s.textContent='儲存中…';try{const res=await db.from('t998_action_items').insert({week_start:fullWeek(v.week_start).start,store_code:store,target_label:label.trim().slice(0,60),action:String(v.action).trim(),metric_key:v.metric_key,owner:String(v.owner||'').trim()||null});if(res.error)throw res.error;s.textContent='已新增';renderMetric(state.data,state.previous,range());}catch(err){s.textContent='新增失敗：'+(err.message||err);b.disabled=false;}};
    const cf=$('compareForm');if(cf){cf.onsubmit=e=>{e.preventDefault();runCompare();};runCompare();}
    const tf=$('targetsForm');if(tf)tf.onsubmit=async e=>{e.preventDefault();const s=$('targetsStatus'),values={};for(const f of KS.FIELDS){const el=tf.elements[f.key];if(!el||el.value==='')continue;let v=Number(el.value);if(!Number.isFinite(v)){s.textContent=f.label+' 不是數字';return;}if(f.unit==='%'||f.points)v=v/100;if(f.int)v=Math.round(v);if(f.min!==undefined&&(v<f.min||v>f.max)){s.textContent=f.label+' 要在 '+f.min+'–'+f.max+' 之間';return;}values[f.key]=+v.toFixed(6);}
      s.textContent='儲存中…';try{const n=await KS.save(db,values);s.textContent=n?'已儲存 '+n+' 項':'沒有變更';state.cache.clear();renderMetric(state.data,state.previous,range());}catch(err){s.textContent='儲存失敗：'+(err.message||err);}};
    const box=$('metricContent');if(box.dataset.v2bound)return;box.dataset.v2bound='1';
    box.addEventListener('click',async ev=>{const t=ev.target.closest('button');if(!t)return;
      if(t.dataset.archive){if(!confirm('封存這筆行動？封存後不再顯示（資料保留）。'))return;t.disabled=true;const res=await db.from('t998_action_items').update({archived:true}).eq('id',Number(t.dataset.archive));if(res.error){alert('封存失敗：'+res.error.message);t.disabled=false;return;}renderMetric(state.data,state.previous,range());}
      if(t.dataset.cmp){const f=$('compareForm'),n=Number(t.dataset.cmp);f.bs.value=M.addDays(f.as.value,-n);f.be.value=M.addDays(f.ae.value,-n);runCompare();}
    });
  }
  // ===== 儀表板 v2｜C2 往下看明細（中心 → AC → 餐廳 → 逐日 → 訂單）、C1 時段 × 星期熱圖 =====
  state.drill={metric:'d7',ac:'',store:'',date:''};
  const DRILL_METRICS=[['d7','D7'],['d25','D25'],['fa','FA 佔比'],['waiting','等餐']];
  const hhmm=v=>{const m=String(v??'').match(/(\d{1,2}):(\d{2})/);return m?m[1].padStart(2,'0')+':'+m[2]:'—';};
  const durMin=v=>{const m=String(v??'').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);return m?fmt(Number(m[1])*60+Number(m[2])+(Number(m[3])>=30?1:0))+' 分':'—';};
  const hourOf=ms=>ms===null||ms===undefined||!Number.isFinite(ms)?null:new Date(ms+8*3600000).getUTCHours();
  const drillTarget=k=>k==='fa'?targets.faShareMax:k==='waiting'?null:targets[k];
  const drillFmt=(k,v)=>k==='waiting'?fmt(v):pct(v);
  const drillCls=(k,v)=>I.fails(v,k,drillTarget(k))?'st-bad':'';
  // 熱圖顏色：達成率／FA 和目標比，差 15 點以上最深；等餐依本表最大筆數
  function heatStyle(k,v,max){
    if(v===null||v===undefined)return '';
    if(k==='waiting'){if(!v)return '';const a=0.12+0.5*Math.min(1,v/Math.max(1,max));return 'background:rgba(214,120,30,'+a.toFixed(2)+')';}
    const t=drillTarget(k);if(t===null||t===undefined)return '';
    const diff=k==='fa'?t-v:v-t,a=0.1+0.5*Math.min(1,Math.abs(diff)/0.15);
    return 'background:'+(diff<0?'rgba(200,16,46,':'rgba(30,140,70,')+a.toFixed(2)+')';
  }
  async function drillPage(r){
    const D=state.drill,k=D.metric,data=state.data,independent=independentStoreCodes;
    try{await weatherForRange(r);}catch(e){}
    const excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),cells=insightCells(data,r),stores=I.byStore(cells,r.start,r.end,excluded),acOf=acOfFor(r.end);
    const needOf=x=>(k==='d7'||k==='d25')&&x.code&&independent.has(x.code)?null:I.need(x,k,drillTarget(k));
    const acs=I.byAc(stores,acOf,independent).sort((a,b)=>(needOf(b.total)||0)-(needOf(a.total)||0)||a.name.localeCompare(b.name,'zh-Hant'));
    if(D.store&&!stores.some(s=>s.code===D.store)){D.store='';D.date='';}
    if(D.store&&!D.ac)D.ac=acOf(D.store)||'未分配';
    if(D.ac&&!acs.some(a=>a.name===D.ac)){D.ac='';D.store='';D.date='';}
    if(D.date&&(D.date<r.start||D.date>r.end))D.date='';
    const ac=acs.find(a=>a.name===D.ac),store=stores.find(s=>s.code===D.store),total=I.center(stores,independent);
    const scope=store?[store]:ac?ac.stores:stores,scopeCodes=new Set(scope.map(s=>s.code));
    const orders=analysisOrders(data,r).filter(o=>!excluded.has(o.date));
    const name=s=>escape((s.code?s.code+' ':'')+(state.catalog.get(s.code)?.restaurant_name||s.name));
    const metricBtns='<div class="dr-metrics" role="group" aria-label="指標">'+DRILL_METRICS.map(([key,label])=>'<button type="button" class="ins-link'+(key===k?' primary':'')+'" data-drill-metric="'+key+'" aria-pressed="'+(key===k)+'">'+label+'</button>').join('')+'</div>';
    const crumb=[['center','中心 '+drillFmt(k,I.value(total,k))]];
    if(ac)crumb.push(['ac','AC '+ac.name+' '+drillFmt(k,I.value(ac.total,k))]);
    if(store)crumb.push(['store',name(store)+' '+drillFmt(k,I.value(store,k))]);
    if(store&&D.date)crumb.push(['date',S.dates(D.date,D.date).length?Number(D.date.slice(5,7))+'/'+Number(D.date.slice(8,10))+'（'+'日一二三四五六'[new Date(D.date+'T12:00:00Z').getUTCDay()]+'）':D.date]);
    const crumbs='<nav class="dr-crumbs" aria-label="目前位置">'+crumb.map(([lv,text],i)=>i===crumb.length-1?'<b>'+text+'</b>':'<button type="button" class="ins-link" data-drill-go="'+lv+'">'+text+'</button>').join('<span aria-hidden="true">›</span>')+'</nav>';
    const valHead=DRILL_METRICS.find(x=>x[0]===k)[1],needHead=k==='waiting'?'':k==='fa'?'要少幾張 FA':'還差幾單';
    const row=(attr,label,x,extra='')=>{const v=I.value(x,k),n=needOf(x);return '<tr><th><button type="button" class="dr-row" '+attr+'>'+label+'</button>'+extra+'</th><td>'+fmt(x.tc)+'</td><td class="'+drillCls(k,v)+'">'+drillFmt(k,v)+'</td>'+(needHead?'<td>'+(n===null?'—':n?fmt(n):'達標')+'</td>':'')+'</tr>';};
    const head=first=>'<thead><tr><th>'+first+'</th><th>TC</th><th>'+valHead+'</th>'+(needHead?'<th>'+needHead+'</th>':'')+'</tr></thead>';
    let level;
    if(!ac){
      level='<h3>各 AC</h3><div class="scroll"><table class="table dr-table">'+head('AC')+'<tbody>'+acs.map(a=>row('data-drill-ac="'+escape(a.name)+'"',escape(a.name)+' <small>'+a.stores.length+' 家</small>',a.total)).join('')+'</tbody></table></div>';
    }else if(!store){
      const list=ac.stores.slice().sort((a,b)=>(needOf(b)??-1)-(needOf(a)??-1)||(k==='waiting'?b.wait-a.wait:0)||a.code.localeCompare(b.code));
      level='<h3>AC '+escape(ac.name)+'｜各餐廳</h3><div class="scroll"><table class="table dr-table">'+head('餐廳')+'<tbody>'+list.map(s=>row('data-drill-store="'+escape(s.code)+'"',name(s),s,independent.has(s.code)?' <small>（獨立店）</small>':'')).join('')+'</tbody></table></div>';
    }else if(!D.date){
      const city=cityForStore(store.code,store.area),todayStr=today(),days=S.dates(r.start,[r.end,todayStr].sort()[0]);
      const countHead=k==='fa'?'FA 單':k==='waiting'?'':'達成';
      const body=days.map(d=>{const c=cells.find(x=>x.date===d&&x.code===store.code),skip=excluded.has(d),x=c||{tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,wait:0},v=skip?null:I.value(x,k),w=city?weatherRow(d,city):null,rain=w?Number(w.precipitation)||0:null;
        const cnt=k==='fa'?fmt(x.fa):k==='waiting'?'':fmt(x[k+'Y']);
        return '<tr><th>'+(x.tc&&!skip?'<button type="button" class="dr-row" data-drill-date="'+d+'">'+escape(Number(d.slice(5,7))+'/'+Number(d.slice(8,10))+' '+'日一二三四五六'[new Date(d+'T12:00:00Z').getUTCDay()])+'</button>':escape(Number(d.slice(5,7))+'/'+Number(d.slice(8,10))+' '+'日一二三四五六'[new Date(d+'T12:00:00Z').getUTCDay()]))+(skip?' <small>不計成績</small>':'')+'</th><td>'+(skip?'—':fmt(x.tc))+'</td>'+(countHead?'<td>'+(skip?'—':cnt)+'</td>':'')+'<td class="'+drillCls(k,v)+'">'+drillFmt(k,v)+'</td><td>'+(skip?'—':fmt(x.wait))+'</td><td>'+(rain===null?'—':rain>=1?'🌧️ '+fmt(rain,1)+' mm':'—')+'</td></tr>';}).join('');
      level='<h3>'+name(store)+'｜逐日</h3><div class="scroll"><table class="table dr-table"><thead><tr><th>日期</th><th>TC</th>'+(countHead?'<th>'+countHead+'</th>':'')+'<th>'+valHead+'</th><th>等餐登記</th><th>雨量'+(city?'（'+escape(city)+'）':'')+'</th></tr></thead><tbody>'+body+'</tbody></table></div>'+(independent.has(store.code)&&(k==='d7'||k==='d25')?'<p class="ins-foot">這家是獨立店：中心 D7／D25 不算它，這裡只顯示它自己的數字。</p>':'');
    }else{
      const reasons=new Map();for(const w of data.delays||[])if(String(w.record_date)===D.date&&String(w.store_code||'')===store.code)reasons.set(orderTail(w.order_number),String(w.reason||'').trim()||'未填原因');
      const dayOrders=orders.filter(o=>o.date===D.date&&o.code===store.code).sort((a,b)=>(a.moment??Infinity)-(b.moment??Infinity));
      const pick=k==='fa'?o=>o.fa:k==='waiting'?o=>o.wait:o=>!o.fa&&o[k]==='N';
      const list=dayOrders.filter(pick),shown=list.slice(0,100),what=k==='fa'?'第三方（FA）訂單':k==='waiting'?'有等餐登記的訂單':valHead+' 未達成訂單';
      const body=shown.map(o=>{const p=o.raw||{},q=o.dateRaw||{};return '<tr><td>…'+escape(orderTail(o.order))+'</td><td>'+hhmm(p['落單時間'])+'</td><td>'+hhmm(p['指派時間'])+'</td><td>'+hhmm(p['外送出發'])+'</td><td>'+hhmm(p['到達時間'])+'</td><td>'+durMin(q['留店時間'])+'</td><td>'+durMin(q['外送達成時間（D30)'])+'</td><td>'+escape(String(q['距離']??'').trim()||'—')+'</td><td>'+(reasons.has(orderTail(o.order))?escape(reasons.get(orderTail(o.order))):o.wait?'有登記':'—')+'</td></tr>';}).join('');
      level='<h3>'+name(store)+'｜'+escape(Number(D.date.slice(5,7))+'/'+Number(D.date.slice(8,10)))+' '+escape(what)+'（'+fmt(dayOrders.length)+' 筆中 '+fmt(list.length)+' 筆）</h3>'+(list.length?'<div class="scroll"><table class="table dr-table dr-orders"><thead><tr><th>訂單</th><th>落單</th><th>指派</th><th>外送出發</th><th>到達</th><th>留店</th><th>外送耗時</th><th>距離</th><th>等餐登記</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<p class="ins-foot">這天沒有符合的訂單。</p>')+(list.length>shown.length?'<p class="ins-foot">只列前 100 筆。</p>':'')+'<p class="ins-foot">落單、指派、出發、到達取自成績 ByOrder；留店、外送耗時、距離取自 ByDate，沒有對到的顯示「—」。</p>';
    }
    // 熱圖：範圍跟著上面選到的層級（中心／AC／餐廳），期間是上方選的日期範圍
    // 外送時段（預設 10:30–22:30）：時段外的訂單不列入熱圖，下方註明筆數
    const dh=M.BUSINESS.deliveryHours||{start:'10:30',end:'22:30'},toMin=t=>{const [a,b]=String(t).split(':').map(Number);return a*60+(b||0);},dhStart=toMin(dh.start),dhEnd=toMin(dh.end),minuteOf=ms=>ms===null||ms===undefined||!Number.isFinite(ms)?null:Math.floor((ms+8*3600000)/60000)%1440;
    const scoped=orders.filter(o=>scopeCodes.has(o.code)),inHours=scoped.filter(o=>{const m=minuteOf(o.moment);return m!==null&&m>=dhStart&&m<=dhEnd;}),outHours=scoped.filter(o=>{const m=minuteOf(o.moment);return m!==null&&(m<dhStart||m>dhEnd);}).length;
    const hourList=[];for(let h=Math.floor(dhStart/60);h<=Math.floor(dhEnd/60);h++)hourList.push(h);
    const hourHead=h=>h===Math.floor(dhStart/60)&&dhStart%60?dh.start:h+' 時';
    const hm=I.heatmap(inHours.map(o=>({date:o.date,hour:hourOf(o.moment),code:o.code,fa:o.fa,d7:o.d7,d25:o.d25,wait:o.wait})),k,{independent,hourList});
    const rows=hm.rows.filter(rw=>rw.cells.some(c=>c.tc>0)),max=Math.max(0,...rows.flatMap(rw=>rw.cells.map(c=>c.value||0)));
    const scopeLabel=store?name(store):ac?'AC '+escape(ac.name):'中心';
    const heat=!rows.length?'<p class="ins-foot">這段期間沒有可用的落單時間。</p>':'<div class="scroll"><table class="table dr-heat"><thead><tr><th></th>'+hm.hours.map(h=>'<th>'+hourHead(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(rw=>'<tr><th>週'+rw.weekday+'</th>'+rw.cells.map(c=>{const title=c.tc?'週'+rw.weekday+' '+c.hour+' 時：'+(k==='waiting'?'等餐 '+fmt(c.value)+' 筆／':'')+fmt(c.tc)+' 單':'沒有訂單';return '<td style="'+heatStyle(k,c.value,max)+'" title="'+escape(title)+'">'+(c.value===null?(c.tc?'<span class="ins-faint">·</span>':''):k==='waiting'?fmt(c.value):fmt(c.value*100,1))+'</td>';}).join('')+'</tr>').join('')+'</tbody></table></div>';
    const worstText=hm.worst.length?(k==='waiting'?'等餐最多的時段：':k==='fa'?'FA 佔比明顯偏高（比整體高 5 點以上）：':valHead+' 明顯偏低（比整體低 5 點以上）：')+hm.worst.map(c=>'週'+c.weekday+' '+c.hour+' 時（'+(k==='waiting'?fmt(c.value)+' 筆':pct(c.value))+'）').join('、')+'。':(k==='waiting'?'沒有等餐登記。':'沒有比整體差 5 點以上的時段。');
    const legend=k==='waiting'?'顏色越深＝等餐登記越多（只算對得到訂單的登記）。只列外送時段 '+dh.start+'–'+dh.end+(outHours?'，時段外 '+fmt(outHours)+' 單未列入':'')+'。':'紅＝未達目標、綠＝達標，差越多顏色越深；目標 '+(k==='fa'?'≤':'')+pct(drillTarget(k))+'。'+'只列外送時段 '+dh.start+'–'+dh.end+(outHours?'，時段外 '+fmt(outHours)+' 單未列入':'')+'。';
    return '<p class="ins-lead">從中心一路往下看到單筆訂單：點表格裡的名稱往下一層，點上方路徑回上一層。下方熱圖跟著目前這一層。</p>'+metricBtns+crumbs+
      '<section class="analysis-panel">'+level+'</section>'+
      '<section class="analysis-panel"><h3>'+valHead+' 時段 × 星期熱圖（'+scopeLabel+'）</h3>'+heat+'<p class="ins-lead" style="margin:10px 0 0">'+escape(worstText)+'</p><p class="ins-foot">'+legend+' 時段依落單時間；格子數字為 '+(k==='waiting'?'筆數':'百分比')+'，「·」＝單數不足 '+hm.minOrders+' 張不判斷。'+(hm.skipped?'有 '+fmt(hm.skipped)+' 張單沒有落單時間，未列入。':'')+(k==='d7'||k==='d25'?'D7／D25 只算非獨立店、非第三方單。':'')+'</p></section>';
  }
  function drillClick(t){
    const D=state.drill;
    if(t.dataset.drillMetric){D.metric=t.dataset.drillMetric;return true;}
    if(t.dataset.drillGo){const lv=t.dataset.drillGo;if(lv==='center'){D.ac='';D.store='';D.date='';}else if(lv==='ac'){D.store='';D.date='';}else if(lv==='store')D.date='';return true;}
    if(t.dataset.drillAc!==undefined){D.ac=t.dataset.drillAc;D.store='';D.date='';return true;}
    if(t.dataset.drillStore!==undefined){D.store=t.dataset.drillStore;D.date='';return true;}
    if(t.dataset.drillDate){D.date=t.dataset.drillDate;return true;}
    if(t.dataset.drillOpen!==undefined){D.ac='';D.store=t.dataset.drillOpen;D.date='';if(t.dataset.drillOpenMetric)D.metric=t.dataset.drillOpenMetric;state.metric='drill';syncMetricTab();return true;}
    return false;
  }
  // ===== 儀表板 v2｜C5 排班與成績對照、C6 派單時間。計算在 ops-insights.js =====
  const STAFF_OVER_HOURS=30;
  const stayMinutes=v=>{const m=String(v??'').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2])+Number(m[3])/60:null;};
  const dayText=d=>Number(d.slice(5,7))+'/'+Number(d.slice(8,10))+' '+'日一二三四五六'[new Date(d+'T12:00:00Z').getUTCDay()];
  const signed=(v,d=0)=>v===null||v===undefined||!Number.isFinite(v)?'—':(v>=0?'+':'−')+fmt(Math.abs(v),d);
  async function readShift(r){
    const rows=[];
    for(let o=0;;o+=1000){const x=await db.from('weekly_shift_availability').select('employee_id,week_start,monday,tuesday,wednesday,thursday,friday,saturday,sunday,submitted_at,is_test').gte('week_start',M.addDays(r.start,-6)).lte('week_start',r.end).order('submitted_at',{ascending:false}).range(o,o+999);if(x.error)throw x.error;rows.push(...(x.data||[]));if(!x.data||x.data.length<1000)return rows;}
  }
  async function staffPage(r){
    const data=state.data,excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),cells=insightCells(data,r),m=model(data,r),todayStr=today();
    const dates=S.dates(r.start,[r.end,todayStr].sort()[0]),std=Number(M.BUSINESS.forecast?.tplh)||2.5;
    let shift=null,shiftError='';try{shift=I.shiftByDate(await readShift(r),dates);}catch(e){shiftError=e.message||String(e);}
    const days=dates.map(d=>{const day=m.days.get?m.days.get(d):null,x=day?.metrics||{},c=I.center(I.byStore(cells,d,d,excluded),independentStoreCodes);return {date:d,tc:x.tc||0,nonfa:x.nonfa||0,hours:day?.actualHours??null,d7:I.value(c,'d7'),excluded:excluded.has(d)};});
    const st=I.staffing(days,{shift:shift||new Map(),tplh:std,overHours:STAFF_OVER_HOURS,d7Target:targets.d7});
    const tag=row=>row.verdict==='over'?'<span class="sf-tag bad">排太多</span>':row.verdict==='under'?'<span class="sf-tag warn">偏少（D7 '+pct(row.d7)+'）</span>':row.verdict==='ok'?'<span class="sf-tag ok">合理</span>':row.verdict==='nohours'?'<span class="sf-tag part">缺工時</span>':row.verdict==='excluded'?'<span class="sf-tag part">不計成績</span>':'<span class="sf-tag part">沒有成績</span>';
    const tplhCls=v=>v!==null&&Number.isFinite(targets.tplh)&&v<targets.tplh-1e-9?'st-bad':'';
    const body=st.rows.map(x=>'<tr><th>'+escape(dayText(x.date))+'</th><td>'+(x.tc?fmt(x.tc):'—')+'</td><td>'+(x.tc?fmt(x.nonfa):'—')+'</td><td>'+(x.people===null?'—':fmt(x.people)+(x.unreadable?' <small title="時段寫法看不懂，沒有算進去">＋'+fmt(x.unreadable)+' 未判讀</small>':''))+'</td><td>'+(x.hours===null||x.hours===undefined?'—':fmt(x.hours,1))+'</td><td class="'+tplhCls(x.tplh)+'">'+fmt(x.tplh,2)+'</td><td>'+(x.suggest===null?'—':fmt(Math.round(x.suggest)))+'</td><td class="'+(x.verdict==='over'?'st-bad':'')+'">'+signed(x.diff===null?null:Math.round(x.diff))+'</td><td>'+tag(x)+'</td></tr>').join('');
    const t=st.total,foot=t?'<tr class="sf-total"><th>合計（有工時的 '+fmt(st.rows.filter(x=>x.diff!==null).length)+' 天）</th><td></td><td>'+fmt(t.nonfa)+'</td><td></td><td>'+fmt(t.hours,1)+'</td><td class="'+tplhCls(t.tplh)+'">'+fmt(t.tplh,2)+'</td><td>'+fmt(Math.round(t.suggest))+'</td><td>'+signed(Math.round(t.diff))+'</td><td></td></tr>':'';
    const lead=st.over||st.under?('這段期間 '+(st.over?st.over+' 天排太多':'')+(st.over&&st.under?'、':'')+(st.under?st.under+' 天偏少':'')+(t?'；有工時的日子合計比建議'+(t.diff>=0?'多 ':'少 ')+fmt(Math.abs(Math.round(t.diff)))+' 小時':'')+'。'):(t?'這段期間沒有明顯排太多或偏少的日子。':'這段期間還沒有填實際工時，無法判斷。');
    const staffing='<section class="analysis-panel"><h3>逐日（中心）</h3><p class="ins-lead">'+escape(lead)+'</p><div class="scroll"><table class="table sf-table"><thead><tr><th>日期</th><th>TC</th><th>自送單（扣 FA）</th><th>指休排班（人）</th><th>實際工時</th><th>TPLH</th><th>建議工時（÷'+fmt(std,1)+'）</th><th>差</th><th>判斷</th></tr></thead><tbody>'+body+foot+'</tbody></table></div>'+
      '<p class="ins-foot">建議工時＝自送單（扣 FA）÷ 指休排班標準 TPLH '+fmt(std,1)+'。排太多＝實際工時比建議多 '+STAFF_OVER_HOURS+' 小時以上；偏少＝低於建議且當天 D7 低於目標 '+pct(targets.d7)+'。實際工時取營運日報各區工時（扣調出、加調入），有區域沒填就算缺工時。'+(shiftError?'':' 指休排班＝當天有填可上班時段的人數（每人取最後一次正式提交，測試資料不算），是「可排」不是實際出勤。')+'</p>'+(shiftError?'<p class="ins-foot">指休資料讀取失敗：'+escape(shiftError)+'，排班人數顯示「—」。</p>':'')+'</section>';
    // 派單時間只算外送時段（預設 10:30–22:30），和明細熱圖一致
    const dh=M.BUSINESS.deliveryHours||{start:'10:30',end:'22:30'},toMin=t=>{const [a,b]=String(t).split(':').map(Number);return a*60+(b||0);},dh0=toMin(dh.start),dh1=toMin(dh.end),minuteOf=ms=>ms===null||ms===undefined||!Number.isFinite(ms)?null:Math.floor((ms+8*3600000)/60000)%1440;
    const allOrders=analysisOrders(data,r).filter(o=>!excluded.has(o.date)),outside=allOrders.filter(o=>{const m=minuteOf(o.moment);return m!==null&&(m<dh0||m>dh1);}).length;
    const orders=allOrders.filter(o=>{const m=minuteOf(o.moment);return m===null||(m>=dh0&&m<=dh1);}).map(o=>({code:o.code,name:state.catalog.get(o.code)?.restaurant_name||o.name,late:o.late,hour:hourOf(o.moment),stayMin:stayMinutes(o.dateRaw?.['留店時間'])}));
    const dp=I.dispatch(orders,{minOrders:20}),SHOW=10,slotMax=Math.max(0,...dp.slots.map(x=>x.share??0));
    const storeRows=dp.stores.slice(0,SHOW).map(x=>'<tr><td>'+escape((x.code?x.code+' ':'')+x.name)+'</td><td>'+fmt(x.late)+'</td><td>'+pct(x.share)+'</td><td>'+(x.avgStay===null?'—':fmt(x.avgStay,1)+' 分')+'</td></tr>').join('');
    const storeHtml=dp.stores.length?'<div class="scroll"><table class="table sf-table"><thead><tr><th>餐廳</th><th>晚派單</th><th>晚派比例</th><th>平均留店</th></tr></thead><tbody>'+storeRows+'</tbody></table></div>':'<div class="empty">'+(dp.all.known?'沒有晚派的餐廳':'這段期間沒有可判讀的派單時間')+'</div>';
    const slotHtml=dp.slots.length?'<div class="scroll"><table class="table sf-table"><thead><tr><th>時段（落單）</th><th>訂單</th><th>晚派比例</th><th>平均留店</th></tr></thead><tbody>'+dp.slots.map(x=>'<tr><td>'+escape(x.label)+'</td><td>'+fmt(x.orders)+'</td><td class="'+(x.share!==null&&x.share===slotMax&&slotMax>0&&dp.slots.length>1?'st-bad':'')+'">'+pct(x.share)+'</td><td>'+(x.avgStay===null?'—':fmt(x.avgStay,1)+' 分')+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty">沒有落單時間可分時段</div>';
    const dispatchHtml='<p class="ins-lead">晚派＝預計抵達前 20 分鐘內才派單（和 D7 頁的晚派單比例同一個定義）。全中心 '+fmt(dp.all.known)+' 張可判讀的單中晚派 '+fmt(dp.all.late)+' 張（'+pct(dp.all.share)+'）'+(dp.all.avgStay!==null?'，平均留店 '+fmt(dp.all.avgStay,1)+' 分':'')+'。</p>'+
      '<div class="ins-grid2"><section class="analysis-panel"><h3>派單時間｜晚派最多的餐廳</h3>'+storeHtml+'<p class="ins-foot">依晚派單數排序，只列至少 '+dp.minOrders+' 張可判讀的餐廳'+(dp.stores.length>SHOW?'，顯示前 '+SHOW+' 家':'')+(dp.small?'；另有 '+fmt(dp.small)+' 家單數不足沒列':'')+'。留店取自成績 ByDate，沒有對到的不算。</p></section>'+
      '<section class="analysis-panel"><h3>派單時間｜時段</h3>'+slotHtml+(dp.noHour?'<p class="ins-foot">'+fmt(dp.noHour)+' 張沒有落單時間，不分時段。</p>':'')+''+'<p class="ins-foot">只算外送時段 '+escape(dh.start)+'–'+escape(dh.end)+(outside?'（時段外 '+fmt(outside)+' 單未列入）':'')+'。</p></section></div>';
    return '<p class="ins-lead">指休排的人力、實際工時、單量和 TPLH 並排，找出人排太多或太少的日子；下方看派單時間。</p>'+staffing+dispatchHtml;
  }
  // ===== 儀表板 v2｜E2 匯出選單：PDF（列印）、Word、本頁數字 Excel、複製文字。內容取自目前畫面，缺資料一樣是「—」 =====
  function exportTitle(){const t=$('metricTitle')?.textContent||'分析儀表板',w=state.metric==='weekly'&&$('metricContent').querySelector('.wk-doc h2');return w?w.textContent:(M.BUSINESS.centerName?'T'+M.BUSINESS.center+' ':'')+t+'｜'+($('metricSubtitle')?.textContent||'');}
  // 目前畫面的乾淨副本：去掉按鈕與表單外框，文字框換成填寫內容
  function exportClone(){
    const box=$('metricContent'),clone=box.cloneNode(true),src=[...box.querySelectorAll('textarea')];
    clone.querySelectorAll('textarea').forEach((t,i)=>{const p=document.createElement('p');p.textContent=(src[i]?.value||'').trim()||'（未填）';t.replaceWith(p);});
    clone.querySelectorAll('select').forEach(sel=>{const span=document.createElement('span');span.textContent=sel.selectedOptions?.[0]?.textContent||'';sel.replaceWith(span);});
    clone.querySelectorAll('button.dr-row').forEach(b=>b.replaceWith(document.createTextNode(b.textContent)));
    clone.querySelectorAll('button,input,.wk-tools,.wk-save,.ins-mtabs,.dr-metrics,script').forEach(x=>x.remove());
    clone.querySelectorAll('details').forEach(d=>d.setAttribute('open',''));
    return clone;
  }
  const cellRows=table=>[...table.rows].map(tr=>[...tr.cells].map(c=>c.textContent));
  function exportText(){
    if(state.metric==='weekly'&&state.weeklyDraft&&$('metricContent').querySelector('.wk-doc')){const box=$('metricContent'),editing=!!box.querySelector('#wkForm'),d=editing?state.weeklyDraft:weeklyView(state.weeklyDraft);return I.weeklyText(d,{title:exportTitle(),fills:weeklyFills(d,editing?box:null)});}
    const clone=exportClone(),out=[exportTitle()];
    const walk=node=>{for(const el of node.children){if(el.matches('table')){out.push(I.tableText(cellRows(el)));continue;}if(el.matches('h2,h3,h4')){out.push('','【'+el.textContent.trim()+'】');continue;}if(el.matches('p,li,.ins-how,.dr-crumbs,.empty')){const t=el.textContent.replace(/\s+/g,' ').trim();if(t)out.push(t);continue;}walk(el);}};
    walk(clone);return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}
  const fileBase=()=>exportTitle().replace(/[\\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
  function exportExcel(){
    const tables=[...$('metricContent').querySelectorAll('table')];if(!tables.length)return '這一頁沒有表格可匯出，請改用「完整成績 Excel」。';
    const names=I.sheetNames(tables.map(t=>t.closest('section')?.querySelector('h3')?.textContent||$('metricTitle').textContent)),wb=XLSX.utils.book_new();
    tables.forEach((t,i)=>{const c=t.cloneNode(true);c.querySelectorAll('button.dr-row').forEach(b=>b.replaceWith(document.createTextNode(b.textContent)));c.querySelectorAll('button').forEach(b=>b.remove());XLSX.utils.book_append_sheet(wb,XLSX.utils.table_to_sheet(c,{raw:true}),names[i]);});
    XLSX.writeFile(wb,fileBase()+'.xlsx');return '已下載 Excel（'+tables.length+' 張表）';
  }
  function exportWord(){const html=I.wordDoc(exportTitle(),exportClone().innerHTML);download(fileBase()+'.doc',new Blob(['﻿',html],{type:'application/msword'}));return '已下載 Word 檔';}
  function openExportMenu(){
    let sheet=$('exportSheet');
    if(!sheet){
      sheet=document.createElement('div');sheet.id='exportSheet';sheet.className='ex-backdrop hidden';
      sheet.innerHTML='<div class="ex-sheet" role="dialog" aria-modal="true" aria-labelledby="exportSheetTitle"><h2 id="exportSheetTitle">匯出</h2><div class="ex-opts"></div><p class="ex-note">匯出內容與畫面一致；缺資料的數字一樣標「—」或「只算幾天」。</p><p class="ex-status" role="status"></p><button type="button" class="ex-cancel" data-ex="close">取消</button></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click',async e=>{
        if(e.target===sheet){closeExportMenu();return;}
        const b=e.target.closest('[data-ex]');if(!b)return;const k=b.dataset.ex,msg=sheet.querySelector('.ex-status');
        try{
          if(k==='close'){closeExportMenu();return;}
          if(k==='pdf'){closeExportMenu();setTimeout(()=>window.print(),50);return;}
          if(k==='full'){closeExportMenu();state.fullExport?.();return;}
          if(k==='excel')msg.textContent=exportExcel();
          if(k==='word')msg.textContent=exportWord();
          if(k==='copy'){await navigator.clipboard.writeText(exportText());msg.textContent='已複製文字，可以貼到 LINE';}
        }catch(error){msg.textContent=(k==='copy'?'無法複製：':'匯出失敗：')+(error.message||error);}
      });
      sheet.addEventListener('keydown',e=>{if(e.key==='Escape')closeExportMenu();});
    }
    const weekly=state.metric==='weekly'&&!!$('metricContent').querySelector('.wk-doc'),what=weekly?'週報':'本頁';
    sheet.querySelector('.ex-opts').innerHTML=[['pdf','📄 '+what+' PDF',weekly?'給主管':'列印或存成 PDF'],['word','📝 '+what+' Word','可再編輯'],['excel','📊 本頁數字 Excel','含明細表格'],['copy','📋 複製文字','貼到 LINE'],['full','📗 完整成績 Excel','原本的匯出，含各店與訂單']].map(([k,a,b])=>'<button type="button" class="ex-opt" data-ex="'+k+'"><span>'+a+'</span><small>'+b+'</small></button>').join('');
    sheet.querySelector('.ex-status').textContent='';sheet.classList.remove('hidden');sheet.querySelector('.ex-opt')?.focus();
  }
  function closeExportMenu(){$('exportSheet')?.classList.add('hidden');$('export')?.focus();}
  async function renderInsight(r){
    window.UiShell?.mark?.(state.metric==='targets'?'analysis:targets':'analysis');
    const titles={alerts:'預警與異常日',impact:'影響度排名：還差幾單才達標',weekly:'週報草稿',store:'餐廳頁：近 8 週所有指標',actions:'行動追蹤與自訂比較',targets:'目標值設定',drill:'明細與熱圖',staff:'排班與派單'};
    $('metricTitle').textContent=titles[state.metric];$('metricSubtitle').textContent=periodLabel(r);
    $('biUploadFooter').classList.add('hidden');$('feedbackUploadFooter').classList.add('hidden');renderMetricTabs();syncMetricTab();
    const box=$('metricContent');
    if(state.metric==='impact'){box.innerHTML=impactPage(I.byStore(insightCells(state.data,r),r.start,r.end,new Set(state.data.reports.filter(x=>x.score_excluded).map(x=>x.record_date))),r);bindInsights(null,r);return;}
    if(state.metric==='weekly'&&state.period!=='week'){box.innerHTML=weeklyPage(null,r);bindInsights(null,r);return;}
    if(state.metric==='drill'){const id0=state.request;box.innerHTML='<div class="empty">整理明細中…</div>';try{const html=await drillPage(r);if(id0!==state.request||state.metric!=='drill')return;box.innerHTML=html;bindInsights(null,r);}catch(error){box.innerHTML='<div class="empty">讀取失敗：'+escape(error.message||error)+'</div>';}return;}
    if(state.metric==='staff'){const id0=state.request;box.innerHTML='<div class="empty">整理排班與派單中…</div>';try{const html=await staffPage(r);if(id0!==state.request||state.metric!=='staff')return;box.innerHTML=html;bindInsights(null,r);}catch(error){box.innerHTML='<div class="empty">讀取失敗：'+escape(error.message||error)+'</div>';}return;}
    if(state.metric==='targets'){const id0=state.request;box.innerHTML='<div class="empty">讀取目標值中…</div>';const html=await targetsPage();if(id0!==state.request||state.metric!=='targets')return;box.innerHTML=html;bindInsights(null,r);bindV2(r);return;}
    const id=state.request,metric=state.metric;box.innerHTML='<div class="empty">讀取前幾週成績中…</div>';
    try{const ctx=await insightContext(r);if(metric==='weekly'){try{await readWeeklySales(ctx.weeks.slice(-3).map(w=>({range:w})));}catch(e){}}if(id!==state.request||metric!==state.metric)return;const html=metric==='alerts'?alertsPage(ctx,r):metric==='weekly'?weeklyPage(ctx,r):metric==='store'?await storePage(ctx,r):await actionsPage(ctx,r);if(id!==state.request||metric!==state.metric)return;box.innerHTML=html;bindInsights(ctx,r);bindV2(r);}
    catch(error){if(id===state.request)box.innerHTML='<div class="empty">讀取失敗：'+escape(error.message||error)+'</div>';}
  }
  if(typeof window.addEventListener==='function')window.addEventListener('hashchange',()=>{const tab=(location.hash.match(/^#tab=(\w+)$/)||[])[1];if(!tab||!(INSIGHT_TABS.has(tab)||labels[tab])||!state.data)return;state.metric=tab;if(tab==='weekly'&&state.period!=='week'){state.period='week';loadReport();return;}syncMetricTab();renderMetric(state.data,state.previous,range());});
  async function loadReport(force=false){sharedDate.set(state.date,state.period);const id=++state.request,r=range();renderChoices();$('report').classList.add('hidden');$('metricTabs').classList.add('hidden');$('refresh').disabled=true;status('讀取成績中…');try{const data=await loadRange(r,force);if(id!==state.request)return;const pr=previousRange(r,data);const timeline=state.period==='day'?[]:await Promise.all([-2,-1,0,1,2].map(async offset=>{const span=state.period==='week'?fullWeek(M.addDays(r.start,offset*7)):M.range(addMonths(r.start,offset),'month');if(span.start>today())return {range:span,offset,data:null};try{return {range:span,offset,data:offset===0?data:await loadRange(span,force)};}catch(error){return {range:span,offset,data:null,error:error.message};}}));if(id!==state.request)return;if(state.period==='week'){try{await readWeeklySales(timeline);}catch(e){$('biStatus').textContent='週 SSSG 讀取失敗：'+e.message;}if(id!==state.request)return;}state.data=data;state.timeline=timeline;state.comparisonRange=pr;state.previous=timeline.find(x=>x.offset===-1)?.data||null;try{await weatherForRange(r);}catch(e){}if(id!==state.request)return;status('');$('report').classList.remove('hidden');renderMetric(data,state.previous,r);state.fullExport=()=>renderTrackingExport(data,r);$('export').onclick=()=>openExportMenu();$('export').textContent='匯出 ▾';$('export').setAttribute('aria-haspopup','dialog');}catch(e){if(id===state.request)status('載入失敗：'+e.message,true);}finally{if(id===state.request)$('refresh').disabled=false;}}
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{const changed=state.period!==b.dataset.period;state.period=b.dataset.period;state.month=state.date.slice(0,7);if(changed)$('periodPicker').classList.remove('hidden');else $('periodPicker').classList.toggle('hidden');renderChoices();loadReport();});$('periodDate').onchange=()=>{state.date=$('periodDate').value||today();state.month=state.date.slice(0,7);renderChoices();loadReport();};$('periodPrev').onclick=()=>changePeriod(-1);$('periodNext').onclick=()=>changePeriod(1);$('refresh').onclick=()=>loadReport(true);
  (async()=>{try{const {data,error}=await db.auth.getSession();if(error)throw error;if(!data.session){$('authMessage').classList.remove('hidden');$('authMessage').innerHTML='請先登入營運後台，再開啟分析儀表板。<br><a href="admin.html">前往登入</a>';return;}const recent=window.ScoreReadSource.enabled()?{data:[],error:null}:await db.from('t998_score_import_batches').select('report_date').lte('report_date',today()).order('report_date',{ascending:false}).limit(1);if(recent.error)throw recent.error;const shared=sharedDate.get();state.date=shared?.date||recent.data?.[0]?.report_date||today();if(shared)state.period=shared.period;const wantTab=(location.hash.match(/^#tab=(\w+)$/)||[])[1];if(wantTab&&(INSIGHT_TABS.has(wantTab)||labels[wantTab])){state.metric=wantTab;if(wantTab==='weekly')state.period='week';}state.month=state.date.slice(0,7);$('dashboard').classList.remove('hidden');if(KS)await KS.load(db);await loadReport();}catch(e){$('authMessage').classList.remove('hidden');$('authMessage').textContent='登入狀態讀取失敗：'+e.message;}})();
})();

