(function(root){
  'use strict';
  const CONFIG=root.T998Config || (typeof window!=='undefined'?window.T998Config:null);
  const SETTINGS=Object.freeze({growth:0.06,tplh:2.5,thirdParty:0.20});
  const FORMULA='Power BI去年對應日（前364天／52週同星期）整天總TC×1.06，各區無條件進位後加總；需求工時÷2.5；不計入日排除；基準缺漏或衝突留空';
  const clean=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').trim();
  const number=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
  const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const comparisonDate=date=>addDays(date,-364);
  const dates=(start,end)=>{const out=[];for(let d=start;d<=end;d=addDays(d,1))out.push(d);return out;};
  function prepare({history=[],catalog=new Map(CONFIG.restaurants.map(s=>[s.store_code,s])),reports=[]}={}){
    // T998's enabled catalog is authoritative; no T995 store exclusions or calendar rules.
    const stores=[...catalog.values()].filter(s=>s.enabled!==false&&s.restaurant_name!=='台南外送中心').map(s=>({name:clean(s.restaurant_name),restaurant_name:s.restaurant_name,area:s.area_code||CONFIG.restaurants.find(x=>x.store_code===s.store_code)?.area_code,code:String(s.store_code)}));
    const names=new Set(stores.map(s=>s.name)),index=new Map(),conflicts=new Set();
    for(const h of history){if(h.period_code!=='full_day'||!names.has(clean(h.restaurant_name)))continue;const key=String(h.record_date).slice(0,10)+'|'+clean(h.restaurant_name),old=index.get(key);if(old&&number(old.total_tc)!==number(h.total_tc))conflicts.add(key);else if(!old)index.set(key,h);}
    const excluded=new Set(reports.filter(r=>r.score_excluded).map(r=>String(r.record_date).slice(0,10)));
    const eligible=()=>stores;
    function priorYear(name,date){const key=comparisonDate(date)+'|'+clean(name),row=index.get(key),tc=number(row?.total_tc);return !row||conflicts.has(key)||tc===null||tc<0?null:tc;}
    function forecast(date){const groups=new Map();for(const s of stores){if(!groups.has(s.area))groups.set(s.area,[]);groups.get(s.area).push(s);}return [...groups].map(([area,list])=>{const missingStores=list.filter(s=>priorYear(s.name,date)===null).map(s=>s.restaurant_name),baselineTc=missingStores.length?null:list.reduce((n,s)=>n+priorYear(s.name,date),0),isExcluded=excluded.has(date),totalTc=isExcluded||baselineTc===null?null:Math.max(0,Math.ceil(baselineTc*(1+SETTINGS.growth)-1e-9));return {date,area,baselineDate:comparisonDate(date),baselineTc,totalTc,recommended:totalTc===null?null:totalTc/SETTINGS.tplh,thirdPartyCap:totalTc===null?null:totalTc*SETTINGS.thirdParty,method:isExcluded?'excluded':baselineTc===null?'missing':'prior_year',excluded:isExcluded,missingStores};});}
    return {stores,index,conflicts,eligible,priorYear,forecast};
  }
  async function load(db,start,end){
    const months=new Set(dates(comparisonDate(start),comparisonDate(end)).map(d=>d.slice(0,7)+'-01'));
    const [refs,reports]=await Promise.all([
      Promise.all([...months].map(p_month=>db.rpc('t998_get_operations_reference',{p_month}))),
      db.from('t998_operations_daily_reports').select('record_date,score_excluded').gte('record_date',start).lte('record_date',end).order('record_date')
    ]);
    if(reports.error)throw reports.error;for(const r of refs)if(r.error)throw r.error;
    return {history:refs.flatMap(r=>r.data?.history||[]),reports:reports.data||[]};
  }
  const api={SETTINGS,FORMULA,clean,number,addDays,comparisonDate,dates,prepare,load};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsForecast=api;
})(typeof window!=='undefined'?window:globalThis);
