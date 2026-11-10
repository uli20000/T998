/* Shared rider rules. Dates are always interpreted in Asia/Taipei. */
(function(root, factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RiderRules=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function dayKey(value=new Date()){
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function dayBounds(now=new Date()) {const key=dayKey(now);const start=new Date(`${key}T00:00:00+08:00`);return {start:start.toISOString(),end:new Date(start.getTime()+86400000).toISOString()};}
  function timeMinutes(value){const match=/^(\d{2}):(00|30)$/.exec(String(value));if(!match)return null;const minutes=Number(match[1])*60+Number(match[2]);return minutes>=600&&minutes<=1350?minutes:null;}
  function formatMinutes(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
  function validateSlots(slots){
    if(!Array.isArray(slots)||slots.length<1||slots.length>2)return {error:'每天限一至兩個時段。'};
    if(slots.some(s=>!s.start||!s.end))return {error:'請同時選擇開始與結束時間。'};
    const intervals=slots.map(s=>[timeMinutes(s.start),timeMinutes(s.end)]);
    if(intervals.some(s=>s.includes(null)))return {error:'時間限 10:00–22:30，分鐘只能選 00 或 30。'};
    if(intervals.some(([a,b])=>a>=b))return {error:'結束時間需晚於開始時間。'};
    intervals.sort((a,b)=>a[0]-b[0]);
    if(intervals.length>1&&intervals[1][0]<intervals[0][1])return {error:'時段不能重疊。'};
    return {intervals,value:intervals.map(([a,b])=>`${formatMinutes(a)}-${formatMinutes(b)}`).join('/')};
  }
  function hasReturn(claim,reports){return reports.some(r=>r.vehicle_id===claim.vehicle_id&&r.reporter_name===claim.claimant_name&&new Date(r.reported_at)>=new Date(claim.claimed_at));}
  function pendingClaimsToday(claims,reports,now=new Date()){return claims.filter(c=>dayKey(c.claimed_at)===dayKey(now)&&!hasReturn(c,reports));}
  function canTrain(year,month,now=new Date()){const key=dayKey(now);return Number(year)===Number(key.slice(0,4))&&Number.isInteger(Number(month))&&Number(month)>=1&&Number(month)<=Number(key.slice(5,7));}
  return {dayKey,dayBounds,timeMinutes,formatMinutes,validateSlots,hasReturn,pendingClaimsToday,canTrain};
});
