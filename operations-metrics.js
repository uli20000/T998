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
  const inCenterTotal=F.inCenterTotal;
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
  // 該日 Power BI 單量：日期有任一在範圍內餐廳的 Power BI 列才採用。
  // 缺列的餐廳不推定為 0，交給 buildOrders 用該店 DMS 補並標暫估（missing）。
  // 全店皆 0（可疑匯出）、同鍵衝突或缺自送數時不採用，退回 DMS。
  function powerBiDay(source,date,{centerOnly=false}={}){
    const eligible=centerOnly?source.centerEligible(date):source.eligible(date);
    const suspect=centerOnly?source.centerSuspectDates:source.suspectDates;
    if(!eligible.length||suspect.has(date))return null;
    const keys=eligible.map(s=>date+'|'+s.name);if(!keys.some(k=>source.index.has(k)))return null;
    if(keys.some(k=>source.conflicts.has(k)))return null;
    const stores=[],missing=[];for(const s of eligible){if(!source.index.has(date+'|'+s.name)){missing.push({code:s.code,name:s.restaurant_name,area:s.area});continue;}const v=source.actual(s.name,date);if(!v||v.fa===null)return null;stores.push({code:s.code,name:s.restaurant_name,area:s.area,tc:v.tc,fa:v.fa});}
    return {stores,missing};
  }
  function orderVolume(source,date,orders,hasDms,{centerOnly=false}={}){
    const dms=new Map();
    for(const o of orders){
      const code=String(o.store_code||''),name=o.restaurant_name,area=o.area_code;
      if(centerOnly&&!inCenterTotal(code,name))continue;
      const key=code||clean(name),v=dms.get(key)||{code,name,area,tc:0,fa:0};
      v.tc++;if(o.fa)v.fa++;dms.set(key,v);
    }
    const pbi=powerBiDay(source,date,{centerOnly});
    if(!pbi)return {source:hasDms?'dms':null,stores:[...dms.values()],missing:[],closed:[]};
    const matched=x=>dms.get(String(x.code)||clean(x.name));
    const filled=pbi.missing.filter(matched).map(x=>({...x,tc:matched(x).tc,fa:matched(x).fa,source:'dms'}));
    const missing=hasDms?filled:pbi.missing,closed=hasDms?pbi.missing.filter(x=>!matched(x)):[];
    return {source:missing.length?'mixed':'powerbi',stores:[...pbi.stores,...filled],missing,closed};
  }
  const centerDelayRows=rows=>rows?.filter(r=>inCenterTotal(r.store_code,r.restaurant_name));
  function dailySales(source,{start,end},reports=[]){
    const excluded=new Set(reports.filter(r=>r.score_excluded).map(r=>String(r.record_date).slice(0,10)));
    const emptySales=()=>({sales:null,pairedSales:null,priorYearSales:null,ticketSales:null,ticketTc:null});
    const total=emptySales(),stores=new Map();
    let hasDailySales=false;
    const cell=(name,date)=>{
      const key=date+'|'+name;
      return source.salesConflicts.has(key)?null:source.index.get(key);
    };
    function addValue(t,key,value){t[key]=(t[key]??0)+value;}
    for(const date of dates(start,end))for(const store of source.eligible(date)){
      const row=cell(store.name,date),sales=number(row?.sales);
      // SSSG：原始營業額÷去年同日原始營業額（新店計入），不排除停班日、不替換比較日
      const prior=number(row?.prior_year_sales),inCenter=inCenterTotal(store.code,store.restaurant_name);
      if(sales===null&&prior===null)continue;
      if(sales!==null)hasDailySales=true;
      const key=store.code||store.name;
      if(!stores.has(key))stores.set(key,{...emptySales(),code:store.code,name:store.restaurant_name,area:store.area});
      // 客單價＝營業額÷總 TC（不含 FA＝餐廳自接第三方平台單，總 TC 含自送與委外派送）
      const tc=number(row.total_tc);
      // 中心值（營業額、SSSG、客單價）都不含獨立店；店別照列
      for(const target of inCenter?[total,stores.get(key)]:[stores.get(key)]){
        if(sales!==null)addValue(target,'sales',sales);
        addValue(target,'pairedSales',sales??0);addValue(target,'priorYearSales',prior??0);
        if(sales!==null&&tc!==null&&tc>0){addValue(target,'ticketSales',sales);addValue(target,'ticketTc',tc);}
      }
    }
    const finish=x=>{
      const growth=ratio(x.pairedSales,x.priorYearSales);
      return {...x,sssg:growth===null?null:growth-1,averageTicket:ratio(x.ticketSales,x.ticketTc)};
    };
    return {...finish(total),hasDailySales,stores:new Map([...stores].map(([key,value])=>[key,finish(value)]))};
  }
  function salesSssg(daily,weekly){
    return daily.hasDailySales?{value:daily.sssg,source:'daily'}:
      {value:weekly?.value??null,source:weekly?'weekly':null};
  }
  function compareSales(current,previous){
    const change=(value,prior)=>{const q=ratio(value??null,prior??null);return q===null?null:q-1;};
    return {priorAverageTicket:previous?.averageTicket??null,
      ticketChange:change(current?.averageTicket,previous?.averageTicket),
      tcChange:change(current?.ticketTc,previous?.ticketTc),salesChange:change(current?.ticketSales,previous?.ticketSales)};
  }
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
    // 單量（TC／FA）以 Power BI 為準；該日尚未上傳 Power BI 時先用 DMS ByOrder 暫估，上傳後自動改用 Power BI。D7／D25／QT 一律用 DMS。
    for(const day of days.values()){
      const hasDms=day.types.has('ByOrder'),volume=orderVolume(priorSource,day.date,day.orders,hasDms);
      const center=orderVolume(priorSource,day.date,day.orders,hasDms,{centerOnly:true});
      const addVolume=(a,x)=>{
        a.tc+=x.tc;a.fa+=x.fa;
        if(F.isNewStore(x.code,day.date,x.name)){a.newTc+=x.tc;a.newFa+=x.fa;}
      };
      day.areaTcSource=volume.source;
      day.dmsTc=hasDms&&volume.source!=='dms'?day.orders.length:null;
      if(volume.source==='powerbi'||volume.source==='mixed'){
        for(const a of day.areas.values())a.tc=a.fa=a.newTc=a.newFa=0;
        for(const x of volume.stores){
          if(!day.areas.has(x.area))day.areas.set(x.area,empty());
          addVolume(day.areas.get(x.area),x);
        }
        day.storeTc=volume.stores;
      }
      day.tcSource=center.source;
      day.pbiMissingStores=center.missing.map(x=>x.code);
      day.closedStores=volume.closed.map(({code,name})=>({code,name}));
      day.centerStoreTc=center.stores;
      day.centerCounts=empty();
      for(const x of center.stores)addVolume(day.centerCounts,x);
      for(const o of day.orders){
        if(o.fa||!inCenterTotal(o.store_code,o.restaurant_name))continue;
        for(const [key,field] of [['d7','D7'],['d25','D25']]){
          const flag=String(o.payload?.[field]||'').toUpperCase();
          if(flag==='Y'||flag==='N')day.centerCounts[key+flag]++;
        }
      }
    }
    for(const day of days.values()){
      const eligible=priorSource.eligible(day.date);
      day.baselineDate=F.priorDate(day.date);
      day.baselineSubstitution=F.priorSubstitution(day.date);
      day.baselineMissingAreas=new Set();
      day.newStores=[];
      let expected=0;
      for(const store of eligible){
        const a=day.areas.get(store.area);if(!a)continue;
        const inCenter=inCenterTotal(store.code,store.name);
        if(F.isNewStore(store.code,day.date,store.name)){if(inCenter)day.newStores.push(store.name);continue;}
        if(inCenter){
          expected++;
          const substitution=F.priorSubstitution(day.date,store.code);
          if(substitution&&substitution.used!==day.baselineDate)
            (day.storeSubstitutions||=[]).push({...substitution,store:store.name});
        }
        const value=priorSource.priorYear(store.name,day.date);
        if(value===null){day.baselineMissingAreas.add(store.area);continue;}
        a.prior+=value;a.priorN++;
        if(inCenter){day.centerCounts.prior+=value;day.centerCounts.priorN++;}
      }
      day.baselineCount=day.centerCounts.priorN;
      day.baselineComplete=expected>0&&day.baselineCount===expected;
    }
    const areas=new Map(rangeAreas.map(([a])=>[a,empty()]));if([...days.values()].some(d=>d.areas.has('?')))areas.set('?',empty());
    const total=empty(),hourTotals=new Map(rangeAreas.map(([a])=>[a,{hours:0,count:0}]));
    let totalHours=0,transferOut=0,transferIn=0,completeHours=true,hasHours=false,tplhOrders=0,hasCenterTc=false;
    const missingPairs=[],missingHourDays=[],missingBaselineDays=[],hoursWithoutScores=[],invalidHourDays=[];
    for(const day of days.values()){
      day.scoreExcluded=!!day.report?.score_excluded;
      const active=!!day.tcSource&&!day.scoreExcluded,areaActive=!!day.areaTcSource&&!day.scoreExcluded;
      if(day.types.size&&day.types.size<2&&!day.scoreExcluded)missingPairs.push(day.date);
      const center=empty(),all=empty();
      if(!day.scoreExcluded&&(active||start===end))add(center,day.centerCounts);
      if(areaActive||!day.scoreExcluded&&start===end)for(const [code,x] of day.areas){
        add(all,x);
        if(!areas.has(code))areas.set(code,empty());
        add(areas.get(code),x);
      }
      for(const key of ['qtSum','qtN','d7Seconds','d7TimeN','d25Seconds','d25TimeN'])center[key]=all[key];
      day.tplhVolume={tc:all.tc,nonfa:all.tc-all.fa};
      tplhOrders+=day.tplhVolume.nonfa;
      hasCenterTc ||= active;
      add(total,center);
      day.metrics=derived(center);
      if(!active)for(const key of ['tc','fa','nonfa','sstg','sstgExFA'])day.metrics[key]=null;
      if(!day.baselineComplete||!day.metrics.priorN){day.metrics.prior=null;day.metrics.sstg=null;day.metrics.sstgExFA=null;}
      day.hours=null;day.actualHours=null;
      const saved=day.report?.area_hours||{};let sum=0,entered=0,missing=0;
      for(const [a] of areasForDate(day.date)){const n=number(saved[a]);if(n!==null){sum+=n;entered++;if(!day.scoreExcluded){const x=hourTotals.get(a);x.hours+=n;x.count++;}}else if((day.areas.get(a)?.tc||0)>0)missing++;}
      if((day.areas.get('?')?.tc||0)>0)missing++;
      if(entered){day.hours=sum;if(!day.scoreExcluded){hasHours=true;totalHours+=sum;}}
      if(entered&&!areaActive&&!day.scoreExcluded)hoursWithoutScores.push(day.date);
      const out=number(day.report?.transfer_out_hours)??0,inside=number(day.report?.transfer_in_hours)??0;if(!day.scoreExcluded){transferOut+=out;transferIn+=inside;}
      if(areaActive&&(!entered||missing)){completeHours=false;missingHourDays.push(day.date);}
      if(entered&&!missing){day.actualHours=sum-out+inside;if(day.actualHours<0){day.actualHours=null;completeHours=false;invalidHourDays.push(day.date);}}
      if((active||start===end)&&!day.scoreExcluded&&!day.baselineComplete)missingBaselineDays.push(day.date);
      day.missingAreas=missing;
    }
    const summary=derived(total),actualHours=hasHours&&completeHours?totalHours-transferOut+transferIn:null;
    if(!hasCenterTc)for(const key of ['tc','fa','nonfa'])summary[key]=null;
    if(missingBaselineDays.length||!summary.priorN){summary.prior=null;summary.sstg=null;summary.sstgExFA=null;}
    if(!hasCenterTc){summary.sstg=null;summary.sstgExFA=null;}
    const areaResults=new Map([...areas].map(([a,x])=>{
      const value=derived(x);
      if([...days.values()].some(d=>!d.scoreExcluded&&(d.areaTcSource||start===end)&&d.baselineMissingAreas.has(a))){
        value.prior=null;value.sstg=null;value.sstgExFA=null;
      }
      return [a,value];
    }));
    const activeDays=[...days.values()].filter(d=>!d.scoreExcluded&&d.tcSource);
    const baselineSubstitutions=activeDays.flatMap(d=>[d.baselineSubstitution,...(d.storeSubstitutions||[])]).filter(Boolean);
    return {priorSource,days,areas:areaResults,summary:{...summary,totalHours:hasHours?totalHours:null,transferOut,transferIn,actualHours,
      tplh:hoursWithoutScores.length?null:ratio(tplhOrders,actualHours)},hourTotals,missingPairs,missingHourDays,missingBaselineDays,
      hoursWithoutScores,invalidHourDays,baselineSubstitutions,newStores:[...new Set([...days.values()].flatMap(d=>d.newStores||[]))],
      provisionalDays:activeDays.filter(d=>d.tcSource!=='powerbi').map(d=>d.date),powerBiDays:activeDays.filter(d=>d.tcSource==='powerbi').map(d=>d.date)};
  }
  function build(args){
    const v=buildOrders(args);
    const prepared=v.priorSource;
    const forecastDetails=[];
    const today=args.today||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const sumForecast=rows=>rows.length&&rows.every(x=>x.totalTc!==null)?rows.reduce((n,x)=>n+x.totalTc,0):null;
    // 預估不計入缺去年 TC 的店時，達成率的實際 TC 也同步扣除這些店，避免分子分母範圍不同而灌高達成率。
    const decorate=(base,forecasts,uncounted=0)=>{
      const forecast=sumForecast(forecasts),forecastHours=forecast===null?null:forecast/FORECAST_TPLH;
      return {...base,forecast,forecastHours,uncountedTc:uncounted,tcAchievement:ratio(base.tc===null?null:base.tc-uncounted,forecast)};
    };
    const storeKey=(code,name)=>{const c=String(code??'').trim();return [c?'c:'+(/^\d+$/.test(c)?c.padStart(3,'0'):c):null,name?'n:'+clean(name):null].filter(Boolean);};
    function uncountedOrders(stores,forecasts){
      const keys=new Set();
      for(const f of forecasts)if(f.totalTc!==null)for(const st of f.missingPriorStores||[])
        for(const k of storeKey(st.code,st.name))keys.add(k);
      const byArea=new Map();let total=0;
      for(const x of stores)if(storeKey(x.code,x.name).some(k=>keys.has(k))){
        total+=x.tc;byArea.set(x.area,(byArea.get(x.area)||0)+x.tc);
      }
      return {total,byArea};
    }
    const areaForecasts=[];
    for(const day of v.days.values()){
      const f=prepared.forecast(day.date,{centerOnly:true});
      const useSame=prepared.eligible(day.date).every(s=>inCenterTotal(s.code,s.name));
      const regional=useSame?f:prepared.forecast(day.date);
      if(day.scoreExcluded)for(const x of [...f,...regional])x.excluded=true;
      forecastDetails.push(...f);
      areaForecasts.push(...regional);
      day.tcComplete=!!day.tcSource&&!day.scoreExcluded;
      const unc=uncountedOrders(day.centerStoreTc,f);
      const regionalStores=day.storeTc||day.orders.map(o=>({code:o.store_code,name:o.restaurant_name,area:o.area_code,tc:1}));
      const areaUnc=useSame&&day.areaTcSource===day.tcSource?unc:uncountedOrders(regionalStores,regional);
      day.uncountedTc=unc.total;day.uncountedByArea=areaUnc.byArea;
      day.metrics=decorate(day.metrics,f,unc.total);
      day.attainmentEligible=day.tcComplete&&day.date<=today;
      day.areaAttainmentEligible=!!day.areaTcSource&&!day.scoreExcluded&&day.date<=today;
      if(!day.attainmentEligible)day.metrics.tcAchievement=null;
      day.metrics.hoursAchievement=ratio(day.actualHours,day.metrics.forecastHours);
      for(const [area,base] of day.areas){
        const value=derived(base);
        if(day.baselineMissingAreas.has(area)){value.prior=null;value.sstg=null;value.sstgExFA=null;}
        const decorated=decorate(value,regional.filter(x=>x.area===area),areaUnc.byArea.get(area)||0);
        if(!day.areaAttainmentEligible)decorated.tcAchievement=null;
        day.areas.set(area,decorated);
      }
    }
    const includedForecasts=forecastDetails.filter(x=>!x.excluded);
    v.summary=decorate(v.summary,includedForecasts);
    v.summary.hoursAchievement=v.hoursWithoutScores.length?null:ratio(v.summary.actualHours,v.summary.forecastHours);
    for(const [area,base] of v.areas)v.areas.set(area,decorate(base,areaForecasts.filter(x=>!x.excluded&&x.area===area)));
    // Keep full-period forecasts for planning, but attainment compares matching elapsed source days only.
    const attainmentDays=[...v.days.values()].filter(day=>day.attainmentEligible);
    const attainmentForecasts=forecastDetails.filter(x=>!x.excluded&&v.days.get(x.date)?.attainmentEligible);
    v.summary.attainmentForecast=sumForecast(attainmentForecasts);
    v.summary.attainmentActual=attainmentDays.length?attainmentDays.reduce((sum,day)=>sum+day.metrics.tc-(day.uncountedTc||0),0):null;
    v.summary.tcAchievement=ratio(v.summary.attainmentActual,v.summary.attainmentForecast);
    const regionalDays=[...v.days.values()].filter(day=>day.areaAttainmentEligible);
    for(const [area,value] of v.areas){
      value.attainmentForecast=sumForecast(areaForecasts.filter(x=>!x.excluded&&x.area===area&&v.days.get(x.date)?.areaAttainmentEligible));
      value.attainmentActual=regionalDays.length?regionalDays.reduce((sum,day)=>sum+(day.areas.get(area)?.tc||0)-(day.uncountedByArea.get(area)||0),0):null;
      value.tcAchievement=ratio(value.attainmentActual,value.attainmentForecast);
    }
    v.forecastDetails=forecastDetails;
    v.missingTcDays=[...v.days.values()].filter(day=>day.date<=today&&!day.scoreExcluded&&!day.tcSource).map(day=>day.date);
    v.powerbi=prepared;
    v.forecastWarnings=[];
    if(v.provisionalDays.length)v.forecastWarnings.push('尚未上傳 Power BI，單量先用 DMS 暫估：'+v.provisionalDays.join('、'));
    if(v.missingTcDays.length)v.forecastWarnings.push('預估達成率已排除缺少單量（Power BI 與 ByOrder 皆無）的日期（實際與預估同時排除）：'+v.missingTcDays.join('、'));
    if([...v.days.values()].some(day=>day.date>today))v.forecastWarnings.push('預估達成率僅計算截至今日已匯入 ByOrder 的日期；今日採整日預估');
    const missing=includedForecasts.filter(x=>x.totalTc===null);
    if(missing.length)v.forecastWarnings.push('去年對應週TC缺漏：'+missing.length+'組區域／日期無法預估');
    const partialNames=[...new Set(includedForecasts.filter(x=>x.totalTc!==null).flatMap(x=>(x.missingPriorStores||[]).map(st=>st.name||st.code)))];
    if(partialNames.length)v.forecastWarnings.push('預估未計入缺去年TC的店，達成率的實際TC同步扣除：'+partialNames.join('、'));
    if(prepared.conflicts.size)v.forecastWarnings.push('Power BI重複鍵內容衝突：'+prepared.conflicts.size+'筆，待核對');
    return v;
  }
  const api={BUSINESS,AREAS,AC_ASSIGNMENTS,HISTORICAL_AC_ASSIGNMENTS,SCOPE_EFFECTIVE_DATE,REMOVED_STORES,storeInScope,areasForDate,
    acAssignmentsForDate,scopeData,NON_DELIVERY_STORES,GROWTH,FORECAST_TPLH,number,ratio,clean,duration,addDays,range,dates,weeks,
    latestBatches,areaFor,inCenterTotal,powerBiDay,orderVolume,centerDelayRows,dailySales,salesSssg,compareSales,build};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsMetrics=api;
})(typeof window!=='undefined'?window:globalThis);

