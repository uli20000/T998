(function(root){
  'use strict';
  const C=typeof module!=='undefined'&&module.exports?require('./operations-calendar.js'):root.OpsCalendar;
  const isNode=typeof module!=='undefined'&&module.exports;
  const schema=isNode?require('./config/business-schema.js'):root.CenterBusinessSchema;
  if(!schema)throw new Error('尚未載入中心營運設定驗證器');
  const BUSINESS=schema.validate(isNode?(root.CenterBusinessConfig||require('./config/998-business.js')):root.CenterBusinessConfig,root.CENTER_CONFIG?.center);
  const SETTINGS=Object.freeze({...BUSINESS.forecast});
  const clean=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').trim();
  const number=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
  const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const comparisonDate=date=>addDays(date,-364);
  const weekStart=date=>addDays(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
  const dates=(start,end)=>{const out=[];for(let d=start;d<=end;d=addDays(d,1))out.push(d);return out;};
  const sampleStart=start=>addDays(weekStart(start),-SETTINGS.weeks*7);
  const FORMULA=BUSINESS.forecastFormula;
  function prepare({history=[],mapping=[],catalog=new Map(),batches=[],reports=[],inScope=()=>true}){
    const mapped=Array.isArray(mapping)?mapping:[...mapping].map(([restaurant_name,area_code])=>({restaurant_name,area_code}));
    const directory=new Map([...catalog.values()].map(s=>[clean(s.restaurant_name),String(s.store_code)]));
    const stores=[...new Map(mapped.map(s=>[clean(s.restaurant_name),{name:clean(s.restaurant_name),restaurant_name:s.restaurant_name,area:s.area_code,code:directory.get(clean(s.restaurant_name))||s.store_code||''}])).values()];
    const index=new Map(),conflicts=new Set();
    for(const h of history){if(h.period_code!=='full_day')continue;const name=clean(h.restaurant_name),date=String(h.record_date).slice(0,10),key=date+'|'+name,old=index.get(key);if(old&&['total_tc','tc_ex_third_party','prior_year_tc'].some(k=>number(old[k])!==number(h[k])))conflicts.add(key);else if(!old)index.set(key,h);}
    const eligible=date=>stores.filter(s=>!BUSINESS.nonDeliveryStores.includes(s.code)&&inScope(s.code,date,s.restaurant_name));
    const dmsDates=new Set(batches.filter(b=>b.report_type==='ByOrder'&&Number(b.row_count)>0).map(b=>b.report_date));
    const suspectDates=new Set();
    for(const date of dmsDates){const list=eligible(date);if(list.length&&list.every(s=>{const h=index.get(date+'|'+s.name);return h&&number(h.total_tc)===0;}))suspectDates.add(date);}
    function actual(name,date){const key=date+'|'+clean(name),h=index.get(key);if(!h||conflicts.has(key)||suspectDates.has(date))return null;const tc=number(h.total_tc),self=number(h.tc_ex_third_party);return tc===null||tc<0?null:{tc,self:self!==null&&self>=0&&self<=tc?self:null,fa:self!==null&&self>=0&&self<=tc?tc-self:null,row:h};}
    function priorYear(name,date){
      const previous=comparisonDate(date),value=actual(name,previous);
      return value?value.tc:null;
    }
    const reportMap=new Map(reports.map(r=>[String(r.record_date).slice(0,10),r]));
    const closure=date=>{const r=reportMap.get(date);return !!r&&(r.score_excluded||/停班(?:停課|課)?|停課/.test(String(r.special_notes||'')));};
    const weekday=date=>{const n=new Date(date+'T12:00:00Z').getUTCDay();return n>0&&n<6;};
    function forecast(date){
      const start=weekStart(date),offset=dates(start,date).length-1,groups=new Map();
      for(const s of eligible(date)){if(!groups.has(s.area))groups.set(s.area,[]);groups.get(s.area).push(s);}
      return [...groups].map(([area,list])=>{
        const samples=[],excludedSamples=[];
        const ordinary=weekday(date)&&!C.holiday(date)&&!closure(date);
        for(let w=1;w<=SETTINGS.weeks;w++){
          const d=addDays(start,offset-w*7);
          const reason=closure(d)?'停班課／不計成績':ordinary&&(!C.known(date)||!C.known(d))?'日曆資料不足':ordinary&&C.holiday(d)?C.holiday(d):null;
          if(reason){excludedSamples.push({date:d,reason});continue;}
          const values=list.map(s=>actual(s.name,d));
          if(values.every(Boolean))samples.push({date:d,tc:values.reduce((sum,x)=>sum+x.tc,0)});
        }
        const average=samples.length?samples.reduce((sum,s)=>sum+s.tc,0)/samples.length:null;
        const priors=list.map(s=>priorYear(s.name,date));
        const baseline=priors.every(x=>x!==null)?priors.reduce((n,x)=>n+x,0):null;
        const recentGrowth=baseline>0&&average!==null?average/baseline-1:null;
        const method=baseline!==null?'prior_year':'missing';
        const selected=baseline;
        const tc=selected===null?null:Math.max(0,Math.ceil(selected*(1+SETTINGS.growth)-1e-9));
        return {date,area,totalTc:tc,averageTc:average,baselineTc:baseline,baselineDate:comparisonDate(date),recentGrowth,method,switchThreshold:SETTINGS.switchThreshold,recommended:tc===null?null:tc/SETTINGS.tplh,thirdPartyCap:tc===null?null:tc*SETTINGS.thirdParty,historyWeeks:samples.length,targetWeeks:SETTINGS.weeks,samples,excludedSamples,excluded:!!reportMap.get(date)?.score_excluded};
      });
    }
    return {stores,index,eligible,actual,priorYear,forecast,suspectDates,conflicts};
  }
  async function load(db,start,end,options={}){
    if(root.CENTER_CONFIG?.features?.scoreRevisions===true&&!root.ScoreReadSource&&!options.scoreBatches)throw Error("Revision reader is required; legacy fallback is disabled");
    const first=sampleStart(start),history=[],batches=[],reports=[],months=new Set();
    for(const d of dates(first,end))months.add(d.slice(0,7)+'-01');
    for(const d of dates(addDays(start,-364),addDays(end,-364)))months.add(d.slice(0,7)+'-01');
    const refs=await Promise.all([...months].map(p_month=>db.rpc('t998_get_operations_reference',{p_month})));
    for(const r of refs){if(r.error)throw r.error;history.push(...(r.data?.history||[]));}
    const revisionSnapshot=options.scoreBatches?{batches:options.scoreBatches}:root.ScoreReadSource?await root.ScoreReadSource.load(db,first,end):null;
    if(revisionSnapshot)batches.push(...revisionSnapshot.batches.filter(x=>x.report_type==='ByOrder'&&x.report_date>=first&&x.report_date<=end));
    else for(let offset=0;;offset+=1000){const r=await db.from('t998_score_import_batches').select('report_date,report_type,row_count').gte('report_date',first).lte('report_date',end).eq('report_type','ByOrder').order('report_date').range(offset,offset+999);if(r.error)throw r.error;batches.push(...(r.data||[]));if((r.data||[]).length<1000)break;}
    for(let offset=0;;offset+=1000){const r=await db.from('t998_operations_daily_reports').select('record_date,score_excluded,special_notes').gte('record_date',first).lte('record_date',end).order('record_date').range(offset,offset+999);if(r.error)throw r.error;reports.push(...(r.data||[]));if((r.data||[]).length<1000)break;}
    return {history,batches,reports};
  }
  const api={SETTINGS,FORMULA,clean,number,addDays,comparisonDate,weekStart,dates,sampleStart,prepare,load};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsForecast=api;
})(typeof window!=='undefined'?window:globalThis);

