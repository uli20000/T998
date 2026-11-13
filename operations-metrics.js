(function(root){
  'use strict';
  const isNode=typeof module!=='undefined'&&module.exports;
  const schema=isNode?require('./config/business-schema.js'):root.CenterBusinessSchema;
  if(!schema)throw new Error('尚未載入中心營運設定驗證器');
  const BUSINESS=schema.validate(isNode?(root.CenterBusinessConfig||require('./config/998-business.js')):root.CenterBusinessConfig,root.CENTER_CONFIG?.center);
  const AREAS=BUSINESS.areas;
  const HISTORICAL_AC_ASSIGNMENTS=BUSINESS.acAssignments;
  const NON_DELIVERY_STORES=new Set(BUSINESS.nonDeliveryStores);
  const SCOPE_EFFECTIVE_DATE=BUSINESS.scopeEffectiveDate;
  const REMOVED_STORES=new Set(BUSINESS.removedStores);
  const REMOVED_NAMES=new Set(BUSINESS.removedNames);
  const storeInScope=(code,date,name='')=>!date||date<SCOPE_EFFECTIVE_DATE||!(REMOVED_STORES.has(String(code||'').padStart(3,'0'))||REMOVED_NAMES.has(String(name||'').normalize('NFKC').replace(/\s+/g,'')));
  const areasForDate=date=>AREAS.filter(([code])=>date<SCOPE_EFFECTIVE_DATE||!BUSINESS.removedAreas.includes(code));
  const acAssignmentsForDate=date=>HISTORICAL_AC_ASSIGNMENTS.map(ac=>({...ac,stores:ac.stores.filter(code=>storeInScope(code,date))}));
  const AC_ASSIGNMENTS=acAssignmentsForDate(SCOPE_EFFECTIVE_DATE);
  function scopeData(data){
    const byBatch=new Map((data.batches||[]).map(b=>[b.id,b]));
    const out={...data};
    if(data.rows)out.rows=data.rows.filter(row=>storeInScope(row.store_code,byBatch.get(row.batch_id)?.report_date,row.restaurant_name));
    for(const key of ['delays','line','delay','feedback'])if(data[key])out[key]=data[key].filter(row=>storeInScope(row.store_code,row.record_date||row.period_start,row.restaurant_name));
    return out;
  }

  const F=typeof module!=='undefined'&&module.exports?require('./operations-forecast.js'):root.OpsForecast;
  const GROWTH=F.SETTINGS.growth,FORECAST_TPLH=F.SETTINGS.tplh;
  const number=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
  const ratio=(a,b)=>a!==null&&b!==null&&b>0?a/b:null;
  const clean=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').trim();
  const isoDate=d=>new Date(d).toISOString().slice(0,10);
  const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return isoDate(d);};
  function duration(v){
    if(v===null||v===undefined||String(v).trim()===''||v==='-')return null;
    if(typeof v==='number')return v>=0&&v<1?v*86400:null;
    const m=String(v).trim().match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    return m&&+m[2]<60&&+m[3]<60?(+m[1]*3600+ +m[2]*60+ +m[3]):null;
  }
  function range(date,period){
    const first=date.slice(0,7)+'-01',next=new Date(first+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
    const last=addDays(isoDate(next),-1);
    if(period==='month')return {start:first,end:last};
    if(period==='week'){const day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;return {start:[first,addDays(date,-day)].sort().at(-1),end:[last,addDays(date,6-day)].sort()[0]};}
    return {start:date,end:date};
  }
  function dates(start,end){const out=[];for(let d=start;d<=end;d=addDays(d,1))out.push(d);return out;}
  function weeks(date){const r=range(date,'month'),out=[];for(let d=r.start;d<=r.end;){const w=range(d,'week');out.push(w);d=addDays(w.end,1);}return out;}
  function latestBatches(rows){const map=new Map();for(const b of [...rows].sort((a,b)=>String(b.imported_at).localeCompare(String(a.imported_at)))){const key=b.report_date+'|'+b.report_type;if(!map.has(key))map.set(key,b);}return [...map.values()];}
  function areaFor(row,mapping,catalog){
    const p=row.payload||{},name=clean(row.restaurant_name),code=String(row.store_code||'');
    const canonical=catalog.get(code);const mapped=mapping.get(name)||mapping.get(clean(canonical?.restaurant_name));
    if(mapped)return mapped;
    const ac=String(p.AC||'').match(new RegExp(BUSINESS.center+'[-\\s]?([A-Z0-9]+)$','i'));return ac&&AREAS.some(([code])=>code===ac[1].toUpperCase())?ac[1].toUpperCase():'?';
  }
  function empty(){return {tc:0,fa:0,newTc:0,newFa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,qtSum:0,qtN:0,d7Seconds:0,d7TimeN:0,d25Seconds:0,d25TimeN:0,prior:0,priorN:0};}
  function add(target,source){for(const k of Object.keys(empty()))target[k]+=source[k]||0;return target;}
  function derived(x){const nonfa=x.tc-x.fa,forecast=null;return {...x,nonfa,forecast,forecastHours:forecast===null?null:forecast/FORECAST_TPLH,faShare:ratio(x.fa,x.tc),sstg:x.priorN&&x.prior>0?(x.tc-x.newTc)/x.prior-1:null,sstgExFA:x.priorN&&x.prior>0?(nonfa-(x.newTc-x.newFa))/x.prior-1:null,tcAchievement:ratio(x.tc,forecast),d7:ratio(x.d7Y,x.d7Y+x.d7N),d25:ratio(x.d25Y,x.d25Y+x.d25N),qt:ratio(x.qtSum,x.qtN),d7Avg:ratio(x.d7Seconds,x.d7TimeN),d25Avg:ratio(x.d25Seconds,x.d25TimeN)};}
  function buildOrders({rows,batches,history,mapping,catalog,reports,start,end,powerbiData}){
    rows=scopeData({rows,batches}).rows;
    const rangeAreas=areasForDate(start);
    const days=new Map(dates(start,end).map(date=>[date,{date,areas:new Map(areasForDate(date).map(([a])=>[a,empty()])),types:new Set(),orders:[],raw:[],report:reports.find(x=>x.record_date===date)||null}]));
    const byBatch=new Map(batches.map(b=>[b.id,b]));
    // An imported zero-row day is still a known source day.
    for(const batch of batches){if(days.has(batch.report_date))days.get(batch.report_date).types.add(batch.report_type);}
    const seen=new Set();
    for(const row of rows){const b=byBatch.get(row.batch_id);if(!b||!days.has(b.report_date))continue;const day=days.get(b.report_date);day.types.add(b.report_type);const key=b.report_date+'|'+b.report_type+'|'+(row.order_number||row.row_number);if(seen.has(key))continue;seen.add(key);const code=areaFor(row,mapping,catalog);if(!day.areas.has(code))day.areas.set(code,empty());const a=day.areas.get(code),p=row.payload||{};day.raw.push({...row,report_date:b.report_date,report_type:b.report_type,area_code:code});
      if(b.report_type==='ByOrder'){
        a.tc++;const fa=String(p['自動/手動']||'').trim()==='第三方';if(fa)a.fa++;
        else{const f7=String(p.D7||'').toUpperCase(),f25=String(p.D25||'').toUpperCase();if(f7==='Y')a.d7Y++;if(f7==='N')a.d7N++;if(f25==='Y')a.d25Y++;if(f25==='N')a.d25N++;}
        // 新店單量照算 TC，但 SSTG 只比同店：另記新店單數，計算 SSTG 時扣除。
        if(F.isNewStore(row.store_code,b.report_date,row.restaurant_name)){a.newTc++;if(fa)a.newFa++;}
        day.orders.push({...row,area_code:code,fa});
      }else{
        const qt=number(p.QT),t7=duration(p['留店時間']),t25=duration(p['外送達成時間（D30)']);
        if(qt!==null&&qt>=0){a.qtSum+=qt;a.qtN++;}if(t7!==null){a.d7Seconds+=t7;a.d7TimeN++;}if(t25!==null){a.d25Seconds+=t25;a.d25TimeN++;}
      }
    }
    // Actual DMS orders stay unchanged; comparisons share the forecast's target-date cohort and prior-week source.
    const priorSource=F.prepare({history:powerbiData?.history||history,mapping,catalog,batches:powerbiData?.batches||batches,reports:powerbiData?.reports||reports,inScope:storeInScope});
    for(const day of days.values()){
      const eligible=priorSource.eligible(day.date),covered=new Set();
      day.baselineDate=F.priorDate(day.date);day.baselineSubstitution=F.priorSubstitution(day.date);day.baselineMissingAreas=new Set();day.newStores=[];let expected=0;
      for(const store of eligible){
        const a=day.areas.get(store.area);if(!a)continue;
        if(F.isNewStore(store.code,day.date,store.name)){day.newStores.push(store.name);continue;}
        expected++;
        {const ss=F.priorSubstitution(day.date,store.code);if(ss&&ss.used!==day.baselineDate)(day.storeSubstitutions||=[]).push({...ss,store:store.name});}
        const value=priorSource.priorYear(store.name,day.date);
        if(value===null){day.baselineMissingAreas.add(store.area);continue;}
        a.prior+=value;a.priorN++;covered.add(store.name);
      }
      day.baselineCount=covered.size;day.baselineComplete=expected>0&&covered.size===expected;
    }
    const areas=new Map(rangeAreas.map(([a])=>[a,empty()]));if([...days.values()].some(d=>d.areas.has('?')))areas.set('?',empty());
    const total=empty(),hourTotals=new Map(rangeAreas.map(([a])=>[a,{hours:0,count:0}]));let totalHours=0,transferOut=0,transferIn=0,completeHours=true,hasHours=false;
    const missingPairs=[],missingHourDays=[],missingBaselineDays=[],hoursWithoutScores=[],invalidHourDays=[];
    for(const day of days.values()){
      day.scoreExcluded=!!day.report?.score_excluded;const active=day.types.has('ByOrder')&&!day.scoreExcluded;if(day.types.size&&day.types.size<2&&!day.scoreExcluded)missingPairs.push(day.date);
      day.metrics=empty();for(const [code,x] of day.areas){if(!day.scoreExcluded&&(active||start===end)){add(total,x);add(day.metrics,x);if(!areas.has(code))areas.set(code,empty());add(areas.get(code),x);}}
      day.metrics=derived(day.metrics);if(!day.baselineComplete){day.metrics.prior=null;day.metrics.sstg=null;day.metrics.sstgExFA=null;}day.hours=null;day.actualHours=null;
      const saved=day.report?.area_hours||{};let sum=0,entered=0,missing=0;
      for(const [a] of areasForDate(day.date)){const n=number(saved[a]);if(n!==null){sum+=n;entered++;if(!day.scoreExcluded){const x=hourTotals.get(a);x.hours+=n;x.count++;}}else if((day.areas.get(a)?.tc||0)>0)missing++;}
      if((day.areas.get('?')?.tc||0)>0)missing++;
      if(entered){day.hours=sum;if(!day.scoreExcluded){hasHours=true;totalHours+=sum;}}
      if(entered&&!active&&!day.scoreExcluded)hoursWithoutScores.push(day.date);
      const out=number(day.report?.transfer_out_hours)??0,inside=number(day.report?.transfer_in_hours)??0;if(!day.scoreExcluded){transferOut+=out;transferIn+=inside;}
      if(active&&(!entered||missing)){completeHours=false;missingHourDays.push(day.date);}
      if(entered&&!missing){day.actualHours=sum-out+inside;if(day.actualHours<0){day.actualHours=null;completeHours=false;invalidHourDays.push(day.date);}}
      if((active||start===end)&&!day.scoreExcluded&&!day.baselineComplete)missingBaselineDays.push(day.date);
      day.missingAreas=missing;
    }
    const summary=derived(total),actualHours=hasHours&&completeHours?totalHours-transferOut+transferIn:null;
    if(missingBaselineDays.length){summary.forecast=null;summary.forecastHours=null;summary.prior=null;summary.sstg=null;summary.sstgExFA=null;summary.tcAchievement=null;}
    return {priorSource,days,areas:new Map([...areas].map(([a,x])=>{const value=derived(x);if([...days.values()].some(d=>!d.scoreExcluded&&(d.types.has('ByOrder')||start===end)&&d.baselineMissingAreas.has(a))){value.prior=null;value.sstg=null;value.sstgExFA=null;}return [a,value];})),summary:{...summary,totalHours:hasHours?totalHours:null,transferOut,transferIn,actualHours,tplh:hoursWithoutScores.length?null:ratio(summary.nonfa,actualHours),hoursAchievement:hoursWithoutScores.length?null:ratio(actualHours,summary.forecastHours)},hourTotals,missingPairs,missingHourDays,missingBaselineDays,hoursWithoutScores,invalidHourDays,baselineSubstitutions:[...days.values()].filter(d=>!d.scoreExcluded&&d.types.has('ByOrder')).flatMap(d=>[d.baselineSubstitution,...(d.storeSubstitutions||[])]).filter(Boolean),newStores:[...new Set([...days.values()].flatMap(d=>d.newStores||[]))]};
  }
  function build(args){
    const v=buildOrders(args),{start,end,mapping,catalog}=args;
    const prepared=v.priorSource;
    const forecastDetails=[];
    const today=args.today||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const sumForecast=rows=>rows.length&&rows.every(x=>x.totalTc!==null)?rows.reduce((n,x)=>n+x.totalTc,0):null;
    // 預估不計入缺去年 TC 的店時，達成率的實際 TC 也同步扣除這些店，避免分子分母範圍不同而灌高達成率。
    const decorate=(base,forecasts,uncounted=0)=>{
      const forecast=sumForecast(forecasts),forecastHours=forecast===null?null:forecast/FORECAST_TPLH;
      return {...base,forecast,forecastHours,uncountedTc:uncounted,tcAchievement:ratio(base.tc-uncounted,forecast)};
    };
    const storeKey=(code,name)=>{const c=String(code??'').trim();return [c?'c:'+(/^\d+$/.test(c)?c.padStart(3,'0'):c):null,name?'n:'+clean(name):null].filter(Boolean);};
    function uncountedOrders(day,forecasts){
      const keys=new Set();for(const f of forecasts)if(f.totalTc!==null)for(const st of f.missingPriorStores||[])for(const k of storeKey(st.code,st.name))keys.add(k);
      const byArea=new Map();let total=0;if(!keys.size)return {total,byArea};
      for(const o of day.orders){if(storeKey(o.store_code,o.restaurant_name).some(k=>keys.has(k))){total++;byArea.set(o.area_code,(byArea.get(o.area_code)||0)+1);}}
      return {total,byArea};
    }
    for(const day of v.days.values()){
      const f=prepared.forecast(day.date);
      if(day.scoreExcluded)for(const x of f)x.excluded=true;
      forecastDetails.push(...f);
      day.tcComplete=day.types.has('ByOrder')&&!day.scoreExcluded;
      const unc=uncountedOrders(day,f);day.uncountedTc=unc.total;day.uncountedByArea=unc.byArea;
      day.metrics=decorate(day.metrics,f,unc.total);
      day.attainmentEligible=day.tcComplete&&day.date<=today;
      if(!day.attainmentEligible)day.metrics.tcAchievement=null;
      day.metrics.hoursAchievement=ratio(day.actualHours,day.metrics.forecastHours);
      for(const [area,base] of day.areas){const value=derived(base);if(day.baselineMissingAreas.has(area)){value.prior=null;value.sstg=null;value.sstgExFA=null;}const decorated=decorate(value,f.filter(x=>x.area===area),unc.byArea.get(area)||0);if(!day.attainmentEligible)decorated.tcAchievement=null;day.areas.set(area,decorated);}
    }
    const includedForecasts=forecastDetails.filter(x=>!x.excluded);
    v.summary=decorate(v.summary,includedForecasts);
    v.summary.hoursAchievement=v.hoursWithoutScores.length?null:ratio(v.summary.actualHours,v.summary.forecastHours);
    for(const [area,base] of v.areas)v.areas.set(area,decorate(base,includedForecasts.filter(x=>x.area===area)));
    // Keep full-period forecasts for planning, but attainment compares matching elapsed source days only.
    const attainmentDays=[...v.days.values()].filter(day=>day.attainmentEligible);
    const attainmentForecasts=forecastDetails.filter(x=>!x.excluded&&v.days.get(x.date)?.attainmentEligible);
    v.summary.attainmentForecast=sumForecast(attainmentForecasts);
    v.summary.attainmentActual=attainmentDays.length?attainmentDays.reduce((sum,day)=>sum+day.metrics.tc-(day.uncountedTc||0),0):null;
    v.summary.tcAchievement=ratio(v.summary.attainmentActual,v.summary.attainmentForecast);
    for(const [area,value] of v.areas){
      value.attainmentForecast=sumForecast(attainmentForecasts.filter(x=>x.area===area));
      value.attainmentActual=attainmentDays.length?attainmentDays.reduce((sum,day)=>sum+(day.areas.get(area)?.tc||0)-(day.uncountedByArea?.get(area)||0),0):null;
      value.tcAchievement=ratio(value.attainmentActual,value.attainmentForecast);
    }
    v.forecastDetails=forecastDetails;
    v.missingTcDays=[...v.days.values()].filter(day=>day.date<=today&&!day.scoreExcluded&&!day.types.has('ByOrder')).map(day=>day.date);
    v.powerbi=prepared;
    v.forecastWarnings=[];
    if(v.missingTcDays.length)v.forecastWarnings.push('預估達成率已排除缺少 ByOrder 的日期（實際與預估同時排除）：'+v.missingTcDays.join('、'));
    if([...v.days.values()].some(day=>day.date>today))v.forecastWarnings.push('預估達成率僅計算截至今日已匯入 ByOrder 的日期；今日採整日預估');
    const missing=includedForecasts.filter(x=>x.totalTc===null);
    if(missing.length)v.forecastWarnings.push('去年對應週TC缺漏：'+missing.length+'組區域／日期無法預估');
    const partialNames=[...new Set(includedForecasts.filter(x=>x.totalTc!==null).flatMap(x=>(x.missingPriorStores||[]).map(st=>st.name||st.code)))];
    if(partialNames.length)v.forecastWarnings.push('預估未計入缺去年TC的店，達成率的實際TC同步扣除：'+partialNames.join('、'));
    if(prepared.conflicts.size)v.forecastWarnings.push('Power BI重複鍵內容衝突：'+prepared.conflicts.size+'筆，待核對');
    return v;
  }
  const api={BUSINESS,AREAS,AC_ASSIGNMENTS,HISTORICAL_AC_ASSIGNMENTS,SCOPE_EFFECTIVE_DATE,REMOVED_STORES,storeInScope,areasForDate,acAssignmentsForDate,scopeData,NON_DELIVERY_STORES,GROWTH,FORECAST_TPLH,number,ratio,clean,duration,addDays,range,dates,weeks,latestBatches,areaFor,build};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsMetrics=api;
})(typeof window!=='undefined'?window:globalThis);

