/* Competition ranking: 1, 2, 2, 4. Limits retain every tie at the cutoff. */
(function(root){
  'use strict';
  function rank(rows,value,descending=true){
    const sorted=rows.filter(x=>{const v=value(x);return v!==null&&v!==undefined&&Number.isFinite(v);}).slice().sort((a,b)=>(descending?value(b)-value(a):value(a)-value(b))||String(a.code||a.store_code||a.name||a.restaurant_name||'').localeCompare(String(b.code||b.store_code||b.name||b.restaurant_name||''),'zh-Hant'));
    return sorted.map((item,i)=>{let first=i;while(first>0&&value(sorted[first-1])===value(item))first--;return {item,rank:first+1,tied:(first<i)||(i+1<sorted.length&&value(sorted[i+1])===value(item))};});
  }
  function take(entries,limit){if(limit<=0||!entries.length)return [];const cutoff=entries[Math.min(limit,entries.length)-1].rank;return entries.filter(x=>x.rank<=cutoff);}
  const label=entry=>(entry.tied?'並列第 ':'第 ')+entry.rank+' 名';
  const api={rank,take,label};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsRanking=api;
})(typeof window!=='undefined'?window:globalThis);
