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
  async function fetchRows(batches){const rows=[];for(let i=0;i<batches.length;i+=10){const ids=batches.slice(i,i+10).map(x=>x.id);rows.push(...await paged('t998_score_import_rows','batch_id,row_number,store_code,restaurant_name,order_number,payload',q=>q.in('batch_id',ids),'batch_id'));}return rows;}
  async function loadRange(r,force=false){
    const key=state.period+'|'+r.start+'|'+r.end;if(!window.ScoreReadSource.enabled()&&!force&&state.cache.has(key))return state.cache.get(key);await loadDirectory();
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
    const batches=M.latestBatches(rawBatches),rows=revisionReport?revisionReport.rows:batches.length?await fetchRows(batches):[],refs=references.map(x=>x.data||{});
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
    for(const day of byDayStore.values()){day.prior=source.priorYear(day.name,day.date);const key=day.code||M.clean(day.name),store=byStore.get(key);if(store){store.activeDays++;if(day.prior!==null){store.prior+=day.prior;store.priorN++;}}}
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
  function feedbackSidebarRows(data){const first=(source)=>feedbackGroups(data,source)[0];const a=first('0800'),b=first('4128'),ges=(data.feedback||[]).filter(x=>x.source_type==='GES'&&x.osat_survey!==null&&x.osat_survey!==undefined).sort((x,y)=>Number(x.osat_survey)-Number(y.osat_survey));return [{label:'0800',name:a?.name||'尚無資料',value:a?fmt(a.count)+' 筆':'—'},{label:'4128',name:b?.name||'尚無資料',value:b?fmt(b.count)+' 筆':'—'},{label:'GES OSAT最低',name:ges[0]?.restaurant_name||'尚無資料',value:ges[0]?pct(ges[0].osat_survey):'—'}];}
  function renderMetricTabs(){
    const labels=[['sstg','SG／TG'],['d7','D7／D25'],['fa','TPLH／FA'],['waiting','等餐'],['feedback','GES／080']];
    const nav=$('metricTabs');
    if(!nav.dataset.bound){nav.addEventListener('click',event=>{const button=event.target.closest('[data-metric]');if(!button)return;state.metric=button.dataset.metric;syncMetricTab();try{renderMetric(state.data,state.previous,range());}catch(error){status('此成績頁載入失敗：'+(error.message||error),true);}});nav.dataset.bound='true';}
    nav.innerHTML=labels.map(([key,label])=>'<button type="button" class="'+(state.metric===key?'active':'')+'" data-metric="'+key+'" aria-pressed="'+(state.metric===key)+'">'+label+'</button>').join('');nav.classList.remove('hidden');
  }
  function syncMetricTab(){document.querySelectorAll('[data-metric]').forEach(button=>{const active=button.dataset.metric===state.metric;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});}
  function metricTitle(metric){return labels[metric]||labels.sstg;}
  function sstgPage(data,rows,r){const weatherGroups=new Map(),daily=dailyStoreAnalytics(data,r),current=model(data,r);for(const x of daily){const city=cityForStore(x.storeCode,x.area),wx=weatherRow(x.date,city),condition=!wx?'無天氣資料':Number(wx.precipitation)>0||wx.trace?'有降雨':'未測得降雨',key=x.area,g=weatherGroups.get(key)||{conditions:new Set(),storeDays:0};g.conditions.add(condition);g.storeDays++;weatherGroups.set(key,g);}const areas=M.areasForDate(r.start).map(([code,name])=>{const x=current.areas.get(code),w=weatherGroups.get(code);return {code,name,tc:x?.tc??null,prior:x?.prior??null,sstg:x?.sstg??null,stores:rows.filter(s=>s.area===code).length,weather:w?[...w.conditions].sort().join('、'):'無天氣資料',storeDays:w?.storeDays||0};}).filter(x=>x.stores>0).sort((a,b)=>(b.sstg??-Infinity)-(a.sstg??-Infinity)),ranked=rankedStores(rows,'sstg'),rankRows=ranked.map((x,i)=>[i<3?'前三':'後五',x.code,x.name,regionName(x.area),pct(x.sstg)]);return sssgRanking(data,r)+'<section class="analysis-panel"><h3>本期餐廳 SSTG 排名｜'+goalText('sstg',goalSstg)+'</h3>'+table(['區段','店號','餐廳','商圈','SSTG'],rankRows)+'</section><section class="analysis-panel"><h3>商圈 SSTG 與天氣</h3>'+table(['商圈','天氣','餐廳數','餐廳日','TC','去年同期 TC','SSTG'],areas.map(x=>[x.name,x.weather,fmt(x.stores),fmt(x.storeDays),fmt(x.tc),fmt(x.prior),pct(x.sstg)]))+'</section>';}
  function orderMoment(value,date){const direct=dateTime(value);if(direct!==null)return direct;const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);return m?Date.parse(date+'T'+String(m[1]).padStart(2,'0')+':'+m[2]+':'+(m[3]||'00')+'+08:00'):null;}
  function analysisOrders(data,r){
    const batches=new Map(data.batches.map(b=>[b.id,b])),excluded=new Set(data.reports.filter(x=>x.score_excluded).map(x=>x.record_date)),waitSet=new Set(data.delays.map(x=>String(x.record_date)+'|'+String(x.store_code||'')+'|'+orderTail(x.order_number))),byDateOrders=new Map(),orders=[],seen=new Set(),areaMap=new Map(data.mapping.map(x=>[M.clean(x.restaurant_name),x.area_code]));
    for(const row of data.rows){const b=batches.get(row.batch_id);if(!b||b.report_type!=='ByDate'||b.report_date<r.start||b.report_date>r.end||excluded.has(b.report_date))continue;const key=b.report_date+'|'+String(row.store_code||'')+'|'+orderTail(row.order_number);if(!byDateOrders.has(key))byDateOrders.set(key,row);}
    for(const row of data.rows){const b=batches.get(row.batch_id);if(!b||b.report_type!=='ByOrder'||b.report_date<r.start||b.report_date>r.end||excluded.has(b.report_date))continue;const p=row.payload||{},code=String(row.store_code||''),identity=b.report_date+'|'+code+'|'+orderTail(row.order_number);if(seen.has(identity))continue;seen.add(identity);const moment=orderMoment(p['落單時間']||p['下單時間']||p['訂單時間'],b.report_date),dateRow=byDateOrders.get(identity),distanceText=String(dateRow?.payload?.['距離']??''),distanceMatch=distanceText.match(/[0-9]+(?:\.[0-9]+)?/),distanceKm=distanceMatch?Number(distanceMatch[0]):null,assigned=dateTime(p['指派時間']),eta=dateTime(p['到達時間'])??dateTime(p['預計送達時間']),late=eta!==null&&assigned!==null?eta-assigned<=20*60000:null,courierDayId=String(p._courier_day_id||''),courierStoreCount=Number(p._courier_day_store_count),departure=orderMoment(p['外送出發'],b.report_date);orders.push({date:b.report_date,code,name:row.restaurant_name||state.catalog.get(code)?.restaurant_name||'未分類餐廳',area:M.areaFor(row,areaMap,state.catalog),order:String(row.order_number||''),fa:String(p['自動/手動']||'').trim()==='第三方',d7:String(p.D7||'').trim().toUpperCase(),d25:String(p.D25||'').trim().toUpperCase(),wait:waitSet.has(identity),moment,assigned,eta,late,departure,hasByDate:!!dateRow,distanceKm,courierDayId,courierStoreCount:Number.isFinite(courierStoreCount)?courierStoreCount:null,departureGroupSize:null,cluster:false});}
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
    const all=data.feedback||[],prior=previous?.feedback||[],c0800=all.filter(x=>x.source_type==='0800'),c4128=all.filter(x=>x.source_type==='4128'),ges=['week','month'].includes(state.period)?all.filter(x=>x.source_type==='GES'&&x.period_start===r.start&&x.period_end===r.end):[],prev0800=prior.filter(x=>x.source_type==='0800');
    const topics=complaintCodeCounts(c0800),prevTopics=new Map(complaintCodeCounts(prev0800).map(x=>[x.name,x.count])),stores0800=feedbackGroups(data,'0800').filter(x=>!/外送中心/.test(x.name)&&!x.rows.some(row=>/外送中心/.test(String(row.area_name||'')))),stores4128=feedbackGroups(data,'4128'),rankGes=ges.filter(x=>x.osat_survey!==null&&x.osat_survey!==undefined).sort((a,b)=>Number(a.osat_survey)-Number(b.osat_survey)||Number(b.response_count||0)-Number(a.response_count||0));
    const complete=p=>!!p&&p.start>='2026-10-01'&&p.end<='2026-10-31',priorRange=state.comparisonRange,topicRows=[...new Set([...topics.map(x=>x.name),...prevTopics.keys()])].map(name=>{const cur=topics.find(x=>x.name===name)?.count||0,prev=prevTopics.get(name)||0;return [name,cur?fmt(cur):complete(r)?'0':'—',prev?fmt(prev):complete(priorRange)?'0':'—',complete(r)&&complete(priorRange)?fmt(cur-prev):'—'];});
    const by0800Code=new Map(stores0800.filter(x=>x.code).map(x=>[String(x.code),x])),by0800Name=new Map(stores0800.map(x=>[M.clean(x.name),x]));
    const topTies=(list,n)=>{const cutoff=list[Math.min(n,list.length)-1]?.count;return cutoff===undefined?[]:list.filter(x=>x.count>=cutoff);};const matchedGes=rankGes.map(x=>{const complaint=(x.store_code&&by0800Code.get(String(x.store_code)))||by0800Name.get(M.clean(x.restaurant_name));return complaint?{ges:x,complaint}:null;}).filter(Boolean).sort((a,b)=>b.complaint.count-a.complaint.count||Number(a.ges.osat_survey)-Number(b.ges.osat_survey));
    const gesRows=rankGes.map((x,i)=>[i+1,x.store_code||'—',x.restaurant_name,fmt(x.response_count),pct(x.osat_survey),pct(x.score_1sat),pct(x.osat_delivery),pct(x.score_accuracy),pct(x.score_service),pct(x.score_speed),pct(x.score_food)]);
    const compareRows=matchedGes.map(({ges:x,complaint},i)=>{return [i+1,x.store_code||complaint.code||'—',complaint.name,fmt(complaint.count),restaurantComplaintCodes(complaint.rows),fmt(x.response_count),pct(x.osat_survey),pct(x.score_accuracy),pct(x.score_service),pct(x.score_speed)];});
    const gesRanges=[...new Set(all.filter(x=>x.source_type==='GES').map(x=>x.period_start+'～'+x.period_end))],gesNote=!ges.length&&gesRanges.length?'<p>現有 GES 期間 '+escape(gesRanges.join('、'))+'，與所選期間不一致，未直接比較。</p>':'';const gesPanel=state.period==='week'?'<section class="analysis-panel"><h3>週 GES 與 0800 餐廳對照</h3>'+table(['名次','店號','餐廳','0800 抱怨','抱怨代碼','GES 回應數','問卷 OSAT','餐點正確性','服務','服務速度'],compareRows)+gesNote+'</section>':state.period==='month'?'<section class="analysis-panel"><h3>GES 餐廳排行｜問卷 OSAT 低至高</h3>'+table(['名次','店號','餐廳','回應數','問卷 OSAT','1SAT','外送平台 OSAT','餐點正確性','服務','服務速度','餐點好吃度'],gesRows)+gesNote+'</section>':'';
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
      return {issue,evidence};
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
  function renderMetric(data,previous,r){const rows=storeAnalytics(data,r),titles={sstg:'SSSG／SSTG 成績與原因分析',d7:'D7／D25 分析',d25:'D7／D25 分析',fa:'FA／TPLH 分析',waiting:'等餐細項分析',feedback:'GES／080 分析'};$('metricTitle').textContent=titles[state.metric];$('metricSubtitle').textContent=periodLabel(r);let content='';if(state.metric==='sstg')content=sstgPage(data,rows,r);else if(state.metric==='d7'||state.metric==='d25')content=d7d25Page(data,rows,r);else if(state.metric==='fa')content=faPage(data,previous,rows,r);else if(state.metric==='waiting')content=waitingPage(rows,data,r);else content=feedbackPage(data,previous,r);content+=problemWorkflow(data,rows,r,state.metric,previous);const evidence=trackingEvidence(data,r),cut=evidence.indexOf('<details class="analysis-panel">'),mainEvidence=cut<0?evidence:evidence.slice(0,cut),coverage=cut<0?'':evidence.slice(cut);$('metricContent').innerHTML=trackingOverview(data,r)+periodNotes(data,r)+trackingComparison()+mainEvidence+content+(state.metric==='feedback'?feedbackVolume(data):'')+coverage;if(state.period==='week')bindWeeklyActionForm(state.metric);$('biUploadFooter').classList.toggle('hidden',state.metric!=='sstg');$('feedbackUploadFooter').classList.toggle('hidden',state.metric!=='feedback');renderMetricTabs();syncMetricTab();}
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
    const ges=data.feedback.filter(row=>row.source_type==='GES'&&row.period_start===r.start&&row.period_end===r.end);
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

  async function loadReport(force=false){sharedDate.set(state.date,state.period);const id=++state.request,r=range();renderChoices();$('report').classList.add('hidden');$('metricTabs').classList.add('hidden');$('refresh').disabled=true;status('讀取成績中…');try{const data=await loadRange(r,force);if(id!==state.request)return;const pr=previousRange(r,data);const timeline=state.period==='day'?[]:await Promise.all([-2,-1,0,1,2].map(async offset=>{const span=state.period==='week'?fullWeek(M.addDays(r.start,offset*7)):M.range(addMonths(r.start,offset),'month');if(span.start>today())return {range:span,offset,data:null};try{return {range:span,offset,data:offset===0?data:await loadRange(span,force)};}catch(error){return {range:span,offset,data:null,error:error.message};}}));if(id!==state.request)return;if(state.period==='week'){try{await readWeeklySales(timeline);}catch(e){$('biStatus').textContent='週 SSSG 讀取失敗：'+e.message;}if(id!==state.request)return;}state.data=data;state.timeline=timeline;state.comparisonRange=pr;state.previous=timeline.find(x=>x.offset===-1)?.data||null;try{await weatherForRange(r);}catch(e){}if(id!==state.request)return;status('');$('report').classList.remove('hidden');renderMetric(data,state.previous,r);$('export').onclick=()=>renderTrackingExport(data,r);}catch(e){if(id===state.request)status('載入失敗：'+e.message,true);}finally{if(id===state.request)$('refresh').disabled=false;}}
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{const changed=state.period!==b.dataset.period;state.period=b.dataset.period;state.month=state.date.slice(0,7);if(changed)$('periodPicker').classList.remove('hidden');else $('periodPicker').classList.toggle('hidden');renderChoices();loadReport();});$('periodDate').onchange=()=>{state.date=$('periodDate').value||today();state.month=state.date.slice(0,7);renderChoices();loadReport();};$('periodPrev').onclick=()=>changePeriod(-1);$('periodNext').onclick=()=>changePeriod(1);$('refresh').onclick=()=>loadReport(true);
  (async()=>{try{const {data,error}=await db.auth.getSession();if(error)throw error;if(!data.session){$('authMessage').classList.remove('hidden');$('authMessage').innerHTML='請先登入營運後台，再開啟分析儀表板。<br><a href="admin.html">前往登入</a>';return;}const recent=window.ScoreReadSource.enabled()?{data:[],error:null}:await db.from('t998_score_import_batches').select('report_date').lte('report_date',today()).order('report_date',{ascending:false}).limit(1);if(recent.error)throw recent.error;const shared=sharedDate.get();state.date=shared?.date||recent.data?.[0]?.report_date||today();if(shared)state.period=shared.period;state.month=state.date.slice(0,7);$('dashboard').classList.remove('hidden');await loadReport();}catch(e){$('authMessage').classList.remove('hidden');$('authMessage').textContent='登入狀態讀取失敗：'+e.message;}})();
})();

