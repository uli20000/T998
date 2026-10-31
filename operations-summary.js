(function(root){
  'use strict';
  const date=d=>new Date(d+'T12:00:00Z'),iso=d=>d.toISOString().slice(0,10);
  function addDays(d,n){const x=date(d);x.setUTCDate(x.getUTCDate()+n);return iso(x);}
  function dates(start,end){const out=[];for(let d=start;d<=end;d=addDays(d,1))out.push(d);return out;}
  function range(d,period){
    if(period==='week'){const offset=(date(d).getUTCDay()+6)%7,start=addDays(d,-offset);return {start,end:addDays(start,6)};}
    if(period==='month'){const start=d.slice(0,7)+'-01',next=date(start);next.setUTCMonth(next.getUTCMonth()+1);return {start,end:addDays(iso(next),-1)};}
    return {start:d,end:d};
  }
  function week(d){const thursday=date(addDays(d,3-(date(d).getUTCDay()+6)%7)),year=thursday.getUTCFullYear(),first=date(year+'-01-01');return {year,number:Math.ceil(((thursday-first)/86400000+1)/7)};}
  const weekLabel=d=>'W'+String(week(d).number).padStart(2,'0');
  function monthWeeks(d){const month=range(d,'month'),rows=[];for(let start=range(month.start,'week').start;start<=month.end;start=addDays(start,7))rows.push({start,end:addDays(start,6),anchor:start<month.start?month.start:start,label:weekLabel(start)});return rows;}
  function months(start,end){return [...new Set(dates(start,end).map(x=>x.slice(0,7)+'-01'))];}
  function rank(rows,key){
    const sorted=rows.filter(r=>r[key]>0).sort((a,b)=>b[key]-a[key]||a.store_code.localeCompare(b.store_code));let prev=null,rank=0;
    sorted.forEach((r,i)=>{if(r[key]!==prev)rank=i+1;r.rank=rank;prev=r[key];});
    const top=sorted.slice(0,3),last=top.at(-1),others=last?sorted.slice(3).filter(r=>r[key]===last[key]).length:0;return {top,tiedOthers:others};
  }
  function delayRanking(rows,start,end){const byStore=new Map();for(const row of rows){if(row.record_date<start||row.record_date>end)continue;const key=String(row.store_code),x=byStore.get(key)||{store_code:key,restaurant_name:row.restaurant_name,count:0,pending:0};x.count++;if(row.status!=='completed')x.pending++;byStore.set(key,x);}return rank([...byStore.values()],'count');}
  function lineRanking(stores,rows,start,end,today){
    const days=dates(start,end<today?end:today),byKey=new Map(rows.map(r=>[r.record_date+'|'+r.store_code,r]));
    const result=stores.map(s=>{
      let missingLine=0,missingSignature=0,unregistered=0;
      for(const d of days){const row=byKey.get(d+'|'+s.store_code);if(!row)unregistered++;if(!row?.line_completed)missingLine++;if(!row?.signature_completed)missingSignature++;}
      return {...s,missingLine,missingSignature,unregistered,missing:missingLine+missingSignature,days:days.length};
    });return rank(result,'missing');
  }
  function lineExport(stores,rows,start,end,today){
    const catalog=new Map(stores.map(s=>[s.store_code,s]));for(const row of rows)if(!catalog.has(row.store_code))catalog.set(row.store_code,{store_code:row.store_code,restaurant_name:row.restaurant_name});
    const byKey=new Map(rows.map(r=>[r.record_date+'|'+r.store_code,r]));
    return dates(start,end<today?end:today).flatMap(d=>[...catalog.values()].sort((a,b)=>a.store_code.localeCompare(b.store_code)).map(s=>{const row=byKey.get(d+'|'+s.store_code);return {日期:d,店號:s.store_code,餐廳:row?.restaurant_name||s.restaurant_name,是否登記:row?'是':'否',劃線:row?.line_completed?'完成':'未完成',簽名:row?.signature_completed?'完成':'未完成',登記時間:row?.created_at||'',更新時間:row?.updated_at||''};}));
  }
  const api={addDays,dates,range,week,weekLabel,monthWeeks,months,delayRanking,lineRanking,lineExport};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsSummary=api;
})(typeof window!=='undefined'?window:globalThis);
