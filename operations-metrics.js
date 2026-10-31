(function(root){
  'use strict';
  const AREAS=window.T998Config.areas;
  const AC_ASSIGNMENTS=['Amber','Chili','Nemo','Eason'].map(name=>({name,stores:window.T998Config.restaurants.filter(x=>x.ac_name===name).map(x=>x.store_code)}));
  const NON_DELIVERY_STORES=new Set();
  // 23:00 回饋範本：L3=L5*1.04，L7=L3/2，L10=L4/L5-1。
  const GROWTH=0.042,FORECAST_TPLH=2;
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
    const ac=String(p.AC||'').match(/998[-\s]?([A-G])$/i);return ac?ac[1].toUpperCase():'?';
  }
  function empty(){return {tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,qtSum:0,qtN:0,d7Seconds:0,d7TimeN:0,d25Seconds:0,d25TimeN:0,prior:0,priorN:0};}
  function add(target,source){for(const k of Object.keys(empty()))target[k]+=source[k]||0;return target;}
  function derived(x){const nonfa=x.tc-x.fa,forecast=x.priorN?x.prior*(1+GROWTH):null;return {...x,nonfa,forecast,forecastHours:forecast===null?null:forecast/FORECAST_TPLH,faShare:ratio(x.fa,x.tc),sstg:x.priorN&&x.prior>0?x.tc/x.prior-1:null,sstgExFA:x.priorN&&x.prior>0?nonfa/x.prior-1:null,tcAchievement:ratio(x.tc,forecast),d7:ratio(x.d7Y,x.d7Y+x.d7N),d25:ratio(x.d25Y,x.d25Y+x.d25N),qt:ratio(x.qtSum,x.qtN),d7Avg:ratio(x.d7Seconds,x.d7TimeN),d25Avg:ratio(x.d25Seconds,x.d25TimeN)};}
  function build({rows,batches,history,mapping,catalog,reports,start,end}){
    const days=new Map(dates(start,end).map(date=>[date,{date,areas:new Map(AREAS.map(([a])=>[a,empty()])),types:new Set(),orders:[],raw:[],report:reports.find(x=>x.record_date===date)||null}]));
    const byBatch=new Map(batches.map(b=>[b.id,b]));
    const seen=new Set();
    for(const row of rows){const b=byBatch.get(row.batch_id);if(!b||!days.has(b.report_date))continue;const day=days.get(b.report_date);day.types.add(b.report_type);const key=b.report_date+'|'+b.report_type+'|'+(row.order_number||row.row_number);if(seen.has(key))continue;seen.add(key);const code=areaFor(row,mapping,catalog);if(!day.areas.has(code))day.areas.set(code,empty());const a=day.areas.get(code),p=row.payload||{};day.raw.push({...row,report_date:b.report_date,report_type:b.report_type,area_code:code});
      if(b.report_type==='ByOrder'){
        a.tc++;const fa=String(p['自動/手動']||'').trim()==='第三方';if(fa)a.fa++;
        else{const f7=String(p.D7||'').toUpperCase(),f25=String(p.D25||'').toUpperCase();if(f7==='Y')a.d7Y++;if(f7==='N')a.d7N++;if(f25==='Y')a.d25Y++;if(f25==='N')a.d25N++;}
        day.orders.push({...row,area_code:code,fa});
      }else{
        const qt=number(p.QT),t7=duration(p['留店時間']),t25=duration(p['外送達成時間（D30)']);
        if(qt!==null&&qt>=0){a.qtSum+=qt;a.qtN++;}if(t7!==null){a.d7Seconds+=t7;a.d7TimeN++;}if(t25!==null){a.d25Seconds+=t25;a.d25TimeN++;}
      }
    }
    // Baselines are keyed by report date + restaurant. Full-day history must not be summed with meal periods.
    const hmap=new Map();for(const h of history){if(h.period_code!=='full_day')continue;const key=h.record_date+'|'+clean(h.restaurant_name);if(!hmap.has(key))hmap.set(key,h);}
    for(const day of days.values()){
      const exact=[...hmap.values()].filter(h=>h.record_date===day.date);
      const priorDate=(Number(day.date.slice(0,4))-1)+day.date.slice(4);
      const hs=exact.length?exact:[...hmap.values()].filter(h=>h.record_date===priorDate);
      const covered=new Set();
      for(const h of hs){const name=clean(h.restaurant_name),aCode=mapping.get(name);if(!aCode||!day.areas.has(aCode))continue;const val=number(exact.length?h.prior_year_tc:h.total_tc);if(val===null)continue;const a=day.areas.get(aCode);a.prior+=val;a.priorN++;covered.add(name);}
      day.baselineCount=covered.size;day.baselineComplete=covered.size>=mapping.size&&mapping.size>0;
    }
    const areas=new Map(AREAS.map(([a])=>[a,empty()]));if([...days.values()].some(d=>d.areas.has('?')))areas.set('?',empty());
    const total=empty(),hourTotals=new Map(AREAS.map(([a])=>[a,{hours:0,count:0}]));let totalHours=0,transferOut=0,transferIn=0,completeHours=true,hasHours=false;
    const missingPairs=[],missingHourDays=[],missingBaselineDays=[],hoursWithoutScores=[],invalidHourDays=[];
    for(const day of days.values()){
      day.scoreExcluded=!!day.report?.score_excluded;const active=day.types.has('ByOrder')&&!day.scoreExcluded;if(day.types.size&&day.types.size<2&&!day.scoreExcluded)missingPairs.push(day.date);
      day.metrics=empty();for(const [code,x] of day.areas){if(!day.scoreExcluded&&(active||start===end)){add(total,x);add(day.metrics,x);if(!areas.has(code))areas.set(code,empty());add(areas.get(code),x);}}
      day.metrics=derived(day.metrics);day.hours=null;day.actualHours=null;
      const saved=day.report?.area_hours||{};let sum=0,entered=0,missing=0;
      for(const [a] of AREAS){const n=number(saved[a]);if(n!==null){sum+=n;entered++;if(!day.scoreExcluded){const x=hourTotals.get(a);x.hours+=n;x.count++;}}else if((day.areas.get(a)?.tc||0)>0)missing++;}
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
    if(missingBaselineDays.length){summary.forecast=null;summary.forecastHours=null;summary.sstg=null;summary.sstgExFA=null;summary.tcAchievement=null;}
    return {days,areas:new Map([...areas].map(([a,x])=>[a,derived(x)])),summary:{...summary,totalHours:hasHours?totalHours:null,transferOut,transferIn,actualHours,tplh:hoursWithoutScores.length?null:ratio(summary.nonfa,actualHours),hoursAchievement:hoursWithoutScores.length?null:ratio(actualHours,summary.forecastHours)},hourTotals,missingPairs,missingHourDays,missingBaselineDays,hoursWithoutScores,invalidHourDays};
  }
  const api={AREAS,AC_ASSIGNMENTS,NON_DELIVERY_STORES,GROWTH,FORECAST_TPLH,number,ratio,clean,duration,addDays,range,dates,weeks,latestBatches,areaFor,build};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsMetrics=api;
})(typeof window!=='undefined'?window:globalThis);
