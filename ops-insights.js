/* 儀表板 v2｜B 組計算：影響度排名（B1）、週報草稿（B2）、連續未達標預警（B3）、異常日（B4）。
 * 純計算，不碰資料庫與畫面；輸入是「每日 × 餐廳」的格子（cells），由 analysis-dashboard.js 從成績 ByOrder 整理後傳入。
 * cell：{date, code, name, area, tc, fa, d7Y, d7N, d25Y, d25N, wait}
 * 口徑與儀表板相同：D7／D25 只算非獨立店、排除第三方（FA）單；FA 佔比＝FA／TC（全部餐廳）。 */
(function(root){
  'use strict';
  const EPS=1e-9;
  const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const weekday=d=>['日','一','二','三','四','五','六'][new Date(d+'T12:00:00Z').getUTCDay()];
  const md=d=>Number(d.slice(5,7))+'/'+Number(d.slice(8,10));
  const rate=(y,n)=>y+n>0?y/(y+n):null;
  const pct=(v,d=1)=>v===null||v===undefined||!Number.isFinite(v)?'—':(v*100).toFixed(d)+'%';
  const pts=v=>(v>=0?'+':'−')+Math.abs(v*100).toFixed(1)+' 點';
  const int=v=>Number(v||0).toLocaleString('zh-TW');

  const METRICS={
    d7:{label:'D7',kind:'rate',targetKey:'d7',note:'d7'},
    d25:{label:'D25',kind:'rate',targetKey:'d25',note:'d7'},
    fa:{label:'FA 佔比',kind:'share',targetKey:'faShareMax',note:'fa'},
    waiting:{label:'等餐',kind:'count',targetKey:null,note:'waiting'}
  };

  function blank(x){return {code:x.code||'',name:x.name||x.code||'未分類餐廳',area:x.area||'',tc:0,fa:0,d7Y:0,d7N:0,d25Y:0,d25N:0,wait:0,days:0};}
  function addInto(t,x){t.tc+=x.tc||0;t.fa+=x.fa||0;t.d7Y+=x.d7Y||0;t.d7N+=x.d7N||0;t.d25Y+=x.d25Y||0;t.d25N+=x.d25N||0;t.wait+=x.wait||0;return t;}

  /** 期間內依餐廳加總；excluded＝不計成績的日期。 */
  function byStore(cells,start,end,excluded=new Set()){
    const map=new Map();
    for(const c of cells){if(c.date<start||c.date>end||excluded.has(c.date))continue;const key=c.code||c.name;const t=map.get(key)||blank(c);addInto(t,c);t.days++;map.set(key,t);}
    return [...map.values()];
  }
  /** 中心合計：D7／D25 用非獨立店，TC／FA／等餐用全部餐廳。 */
  function center(stores,independent=new Set()){
    const t=blank({code:'',name:'中心'});
    for(const s of stores){t.tc+=s.tc;t.fa+=s.fa;t.wait+=s.wait;if(!independent.has(s.code)){t.d7Y+=s.d7Y;t.d7N+=s.d7N;t.d25Y+=s.d25Y;t.d25N+=s.d25N;}}
    return t;
  }
  function value(x,metric){
    if(metric==='d7')return rate(x.d7Y,x.d7N);
    if(metric==='d25')return rate(x.d25Y,x.d25N);
    if(metric==='fa')return x.tc>0?x.fa/x.tc:null;
    if(metric==='waiting')return x.wait;
    return null;
  }
  /** 是否未達標：達成率低於目標、FA 佔比高於上限。 */
  function fails(v,metric,target){if(v===null||v===undefined||target===null||target===undefined)return false;return METRICS[metric]?.kind==='share'?v>target+EPS:v<target-EPS;}
  /** 這家（或中心）還差幾單：達成率要多幾張達成單；FA 要少幾張 FA 單；等餐為登記筆數。 */
  function need(x,metric,target){
    if(metric==='d7'||metric==='d25'){const y=x[metric+'Y'],n=y+x[metric+'N'];if(!n||target===null)return 0;return Math.max(0,Math.ceil(target*n-y-EPS));}
    if(metric==='fa'){if(!x.tc||target===null)return 0;return Math.max(0,x.fa-Math.floor(target*x.tc+EPS));}
    if(metric==='waiting')return x.wait;
    return 0;
  }

  /** B1 影響度排名：依「補齊這家能幫中心補回幾單」排序。 */
  function impact(stores,metric,{targets={},independent=new Set(),acOf=()=>null}={}){
    const spec=METRICS[metric];if(!spec)throw new Error('不支援的指標：'+metric);
    const target=spec.targetKey?targets[spec.targetKey]??null:null;
    const scoped=stores.filter(s=>(metric==='d7'||metric==='d25')?!independent.has(s.code)&&(s[metric+'Y']+s[metric+'N'])>0:s.tc>0);
    const total=center(scoped,independent),centerValue=value(total,metric);
    const gap=metric==='waiting'?null:need(total,metric,target);
    // 百分比排名（最差＝1），用來對照「百分比最差不等於影響最大」
    const worstOrder=scoped.filter(s=>value(s,metric)!==null).sort((a,b)=>spec.kind==='share'||metric==='waiting'?value(b,metric)-value(a,metric):value(a,metric)-value(b,metric));
    const pctRank=new Map(worstOrder.map((s,i)=>[s.code||s.name,i+1]));
    const list=scoped.map(s=>({code:s.code,name:s.name,area:s.area,ac:acOf(s.code),orders:metric==='d7'||metric==='d25'?s[metric+'Y']+s[metric+'N']:s.tc,value:value(s,metric),need:need(s,metric,target),pctRank:pctRank.get(s.code||s.name)||null}))
      .filter(s=>s.need>0)
      .sort((a,b)=>b.need-a.need||(spec.kind==='share'||metric==='waiting'?(b.value??0)-(a.value??0):(a.value??1)-(b.value??1))||a.name.localeCompare(b.name,'zh-Hant'));
    const sumNeed=list.reduce((n,s)=>n+s.need,0);let cum=0,cut=-1;
    for(let i=0;i<list.length;i++){cum+=list[i].need;list[i].cum=cum;list[i].share=gap?list[i].need/gap:sumNeed?list[i].need/sumNeed:null;list[i].cumShare=gap?cum/gap:sumNeed?cum/sumNeed:null;if(cut<0&&gap>0&&cum>=gap)cut=i;}
    const acs=new Map();for(const s of list){const k=s.ac||'未設定 AC',a=acs.get(k)||{name:k,stores:0,need:0};a.stores++;a.need+=s.need;acs.set(k,a);}
    const days=Math.max(1,...scoped.map(s=>s.days||1));
    return {metric,label:spec.label,kind:spec.kind,target,center:{...total,value:centerValue,orders:metric==='d7'||metric==='d25'?total[metric+'Y']+total[metric+'N']:total.tc},gap,perDay:gap!==null?gap/days:null,days,stores:list,cut,sumNeed,acs:[...acs.values()].sort((a,b)=>b.need-a.need||a.name.localeCompare(b.name,'zh-Hant')),sentence:impactSentence({label:spec.label,kind:spec.kind,metric,value:centerValue,gap,list,cut,sumNeed})};
  }
  function impactSentence({label,kind,metric,value:v,gap,list,cut,sumNeed}){
    if(metric==='waiting'){if(!sumNeed)return '本期沒有等餐登記。';const top=list.slice(0,3);return `等餐登記 ${int(sumNeed)} 筆；${top.map(s=>s.name).join('、')} 這 ${top.length} 家占 ${pct(top.reduce((n,s)=>n+s.need,0)/sumNeed,0)}。`;}
    if(v===null)return `${label} 本期沒有可判讀的訂單。`;
    if(!gap)return `${label} ${pct(v)}，已達標。`;
    const k=cut>=0?Math.min(cut+1,4):Math.min(list.length,4),top=list.slice(0,k),covered=top.reduce((n,s)=>n+s.need,0);
    return `${label} ${pct(v)}，${kind==='share'?'要少':'差'} ${int(gap)} 單；${top.map(s=>s.name).join('、')} 這 ${top.length} 家占 ${pct(covered/gap,0)}。`;
  }

  /** 連續幾期未達標（由最新一期往回數；沒有資料就停）。 */
  function streak(values,metric,target){let n=0;for(let i=values.length-1;i>=0;i--){const v=values[i];if(v===null||v===undefined||!fails(v,metric,target))break;n++;}return n;}

  /** B3 連續未達標預警。
   * weeks：由舊到新，最後一期是所選週；days：由舊到新，最後一天是所選期間最後一天。
   * weekSummary(week)→{sstg,tplh}（中心，來自原本的成績計算，可為 null）。 */
  function alerts({cells,weeks,days,targets={},independent=new Set(),excluded=new Set(),acOf=()=>null,weekSummary=()=>null,minOrders=20,weekRule=2,dayRule=3}){
    const out=[];
    const weekStores=weeks.map(w=>byStore(cells,w.start,w.end,excluded));
    const weekCenter=weekStores.map(list=>list.length?center(list,independent):null);
    const last=weekStores.at(-1)||[];
    // 中心｜週指標
    for(const metric of ['d7','d25','fa']){
      const target=targets[METRICS[metric].targetKey],values=weekCenter.map(c=>c?value(c,metric):null),n=streak(values,metric,target);
      if(n>=weekRule){const imp=impact(last,metric,{targets,independent,acOf});out.push({level:n>=3?'red':'orange',scope:'center',metric,weeks:n,title:`中心 ${METRICS[metric].label}｜連續 ${n} 週未達標`,detail:trend(weeks,values,n)+`（${targetText(metric,target)}）`+(imp.gap?`，本週${METRICS[metric].kind==='share'?'要少':'還差'} ${int(imp.gap)} 單；`+(imp.cut>=0?`補齊 ${imp.stores.slice(0,Math.min(imp.cut+1,5)).map(s=>s.name).join('、')}${imp.cut+1>5?' 等':' 這'} ${imp.cut+1} 家即可達標。`:'各店補齊仍不足，需全面提升。'):'。'),link:{tab:'impact',metric}});}
    }
    for(const [key,label,target,isShare] of [['sstg','SSTG',targets.sstg,false],['tplh','TPLH',targets.tplh,false]]){
      const values=weeks.map(w=>{const s=weekSummary(w);return s?s[key]??null:null;});let n=0;for(let i=values.length-1;i>=0;i--){const v=values[i];if(v===null||v===undefined||target===null||target===undefined||(isShare?v<=target:v>=target))break;n++;}
      if(n>=weekRule)out.push({level:n>=3?'red':'orange',scope:'center',metric:key,weeks:n,title:`中心 ${label}｜連續 ${n} 週未達標`,detail:weeks.slice(-n).map((w,i)=>w.label+' '+(key==='tplh'?fmtNum(values[values.length-n+i],2):pct(values[values.length-n+i]))).join(' → ')+`（目標 ${key==='tplh'?fmtNum(target,1):(target>0?'+':'')+pct(target)}）。`});
    }
    // 餐廳｜週指標（每週至少 minOrders 單才判斷，避免小店一兩單就上榜）
    for(const metric of ['d7','d25','fa']){
      const target=targets[METRICS[metric].targetKey];if(target===null||target===undefined)continue;
      const keys=new Set(last.map(s=>s.code||s.name));
      for(const key of keys){
        const series=weekStores.map(list=>{const s=list.find(x=>(x.code||x.name)===key);if(!s)return null;if(metric!=='fa'&&independent.has(s.code))return null;const orders=metric==='fa'?s.tc:s[metric+'Y']+s[metric+'N'];return orders>=minOrders?value(s,metric):null;});
        const n=streak(series,metric,target);if(n<weekRule)continue;
        const s=last.find(x=>(x.code||x.name)===key),gap=need(s,metric,target),ac=acOf(s.code);
        out.push({level:n>=3?'red':'orange',scope:'store',metric,weeks:n,code:s.code,name:s.name,ac,need:gap,title:`${s.code?s.code+' ':''}${s.name}｜${METRICS[metric].label} 連續 ${n} 週未達標`,detail:trend(weeks,series,n)+`（${targetText(metric,target)}），本週${METRICS[metric].kind==='share'?'要少':'還要多'} ${int(gap)} 單。`+(ac?`AC：${ac}`:''),link:{tab:'impact',metric}});
      }
    }
    // 中心｜日指標（連續 dayRule 天）
    const usableDays=days.filter(d=>!excluded.has(d));
    const dayCenter=usableDays.map(d=>{const list=byStore(cells,d,d,excluded);return list.length?center(list,independent):null;});
    for(const metric of ['d7','d25','fa']){
      const target=targets[METRICS[metric].targetKey],values=dayCenter.map(c=>c?value(c,metric):null),n=streak(values,metric,target);
      if(n>=dayRule){const recent=values.slice(-n),avg=recent.reduce((a,b)=>a+b,0)/n;out.push({level:'yellow',scope:'center-day',metric,days:n,title:`中心 ${METRICS[metric].label}｜連續 ${n} 天未達標`,detail:`${md(usableDays[usableDays.length-n])}–${md(usableDays.at(-1))} 平均 ${pct(avg)}（${targetText(metric,target)}）。`});}
    }
    const order={red:0,orange:1,yellow:2},scopeOrder={center:0,'center-day':1,store:2};
    return out.sort((a,b)=>order[a.level]-order[b.level]||scopeOrder[a.scope]-scopeOrder[b.scope]||(b.weeks||0)-(a.weeks||0)||(b.need||0)-(a.need||0));
  }
  function fmtNum(v,d){return v===null||v===undefined||!Number.isFinite(v)?'—':Number(v).toFixed(d);}
  function targetText(metric,target){return METRICS[metric].kind==='share'?`上限 ${pct(target,0)}`:`目標 ${pct(target,0)}`;}
  function trend(weeks,values,n){return weeks.slice(-Math.max(n,2)).map((w,i,arr)=>w.label+' '+pct(values[values.length-arr.length+i])).join(' → ');}

  /** B4 異常日：和前 4 個同一星期幾比較。
   * context(date)→{rainMm, campaigns:[名稱], note}；tcThreshold＝單量差距比例，rateThreshold＝達成率差距（百分點）。 */
  function anomalies({cells,dates,excluded=new Set(),independent=new Set(),context=()=>({}),tcThreshold=0.15,rateThreshold=0.05,closedMin=10,lookback=4}){
    const has=new Set(cells.map(c=>c.date)),out=[];
    const dayStores=new Map(),get=d=>{if(!dayStores.has(d))dayStores.set(d,byStore(cells,d,d,excluded));return dayStores.get(d);};
    for(const d of dates){
      if(excluded.has(d)||!has.has(d))continue;
      const base=[];for(let k=1;k<=lookback;k++){const b=addDays(d,-7*k);if(has.has(b)&&!excluded.has(b))base.push(b);}
      if(base.length<2)continue;
      const today=center(get(d),independent),bases=base.map(b=>center(get(b),independent));
      const avgTc=bases.reduce((n,x)=>n+x.tc,0)/bases.length,diffTc=avgTc?today.tc/avgTc-1:null;
      const avgRate=m=>{const v=bases.map(x=>value(x,m)).filter(x=>x!==null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
      const ctx=context(d)||{},flags=[];
      if(diffTc!==null&&Math.abs(diffTc)>=tcThreshold)flags.push({kind:'tc',metric:'TC',value:today.tc,avg:avgTc,diff:diffTc,text:`TC ${int(today.tc)}，比近 ${base.length} 個週${weekday(d)}平均${diffTc<0?'少':'多'} ${pct(Math.abs(diffTc),0)}`});
      for(const m of ['d7','d25']){const v=value(today,m),a=avgRate(m);if(v!==null&&a!==null&&Math.abs(v-a)>=rateThreshold)flags.push({kind:'rate',metric:METRICS[m].label,value:v,avg:a,diff:v-a,text:`${METRICS[m].label} ${pct(v)}，比近 ${base.length} 個週${weekday(d)}平均${v<a?'低':'高'} ${Math.abs((v-a)*100).toFixed(1)} 點`});}
      { const v=value(today,'fa'),a=avgRate('fa');if(v!==null&&a!==null&&Math.abs(v-a)>=rateThreshold)flags.push({kind:'rate',metric:'FA 佔比',value:v,avg:a,diff:v-a,text:`FA 佔比 ${pct(v)}，平常約 ${pct(a)}`}); }
      // 平常有單、當天 0 單：可能停業或系統問題
      const todayCodes=new Map(get(d).map(s=>[s.code||s.name,s])),closed=[];
      const usual=new Map();for(const b of base)for(const s of get(b)){const k=s.code||s.name,u=usual.get(k)||{code:s.code,name:s.name,tc:0};u.tc+=s.tc;usual.set(k,u);}
      for(const [k,u] of usual){const avg=u.tc/base.length,t=todayCodes.get(k);if(avg>=closedMin&&(!t||t.tc===0))closed.push({code:u.code,name:u.name,avg});}
      if(!flags.length&&!closed.length)continue;
      const reasons=[];
      if(ctx.rainMm>0)reasons.push(`當天雨量 ${fmtNum(ctx.rainMm,ctx.rainMm<10?1:0)} mm`);
      if(ctx.campaigns?.length)reasons.push(`當天有優惠券：${ctx.campaigns.join('、')}`);
      if(ctx.note)reasons.push(`特殊事項：${ctx.note}`);
      if(closed.length)reasons.push(`${closed.map(s=>s.name).join('、')} 當天 0 單（平常約 ${closed.map(s=>Math.round(s.avg)).join('／')} 單），可能停業或系統問題，請確認`);
      if(!ctx.rainMm&&!ctx.campaigns?.length&&!ctx.note&&!closed.length)reasons.push('沒有記錄到天氣、優惠券或特殊事項');
      const worst=flags.slice().sort((a,b)=>Math.abs(b.kind==='tc'?b.diff/3:b.diff)-Math.abs(a.kind==='tc'?a.diff/3:a.diff))[0];
      const icon=ctx.rainMm>=5?'🌧️':ctx.campaigns?.length?'🎟️':closed.length||flags.some(f=>f.kind==='tc')?'📦':'📉';
      out.push({main:worst||null,others:flags.filter(f=>f!==worst),date:d,label:`${md(d)}（${weekday(d)}）`,icon,flags,closed,reasons,baseDates:base,title:`${md(d)}（${weekday(d)}）`+(worst?worst.text:'有餐廳 0 單'),bad:flags.some(f=>(f.kind==='tc'&&f.diff<0)||(f.kind==='rate'&&f.metric!=='FA 佔比'&&f.diff<0)||(f.metric==='FA 佔比'&&f.diff>0))||closed.length>0});
    }
    return out.sort((a,b)=>b.date.localeCompare(a.date));
  }

  /** B2 週報草稿：每個指標一段，依影響排序；問題與證據自動產生，根源與行動由使用者填。
   * input：{week:{start,end,label}, weeks（含所選週，由舊到新）, weekCells, targets, independent, acOf, weekSummary, anomalies, notes:[週行動紀錄], prevWeekStart, weekStoreValue(start,end,code,metric)} */
  function weeklyDraft({week,weeks,cells,targets={},independent=new Set(),excluded=new Set(),acOf=()=>null,weekSummary=()=>null,anomalyList=[],notes=[],dataDays=null}){
    const stores=byStore(cells,week.start,week.end,excluded),sections=[];
    const prevStart=addDays(week.start,-7),note=(key,start)=>notes.find(x=>x.week_start===start&&x.metric_key===key)||null;
    const series=metric=>weeks.map(w=>{const list=byStore(cells,w.start,w.end,excluded);return list.length?value(center(list,independent),metric):null;});
    const summary=weekSummary(week)||{},prevSummary=weekSummary({start:prevStart,end:addDays(prevStart,6),label:''})||{};
    const weekAnoms=anomalyList.filter(a=>a.date>=week.start&&a.date<=week.end);
    const followup=(key,valueNow,valuePrev,label,fmt)=>{const prev=note(key,prevStart);if(!prev||!String(prev.action_plan||'').trim())return null;const mentioned=stores.filter(s=>s.name&&String(prev.action_plan).includes(s.name)).slice(0,3);return {text:prev.action_plan,center:{label,before:valuePrev,after:valueNow,fmt},stores:mentioned.map(s=>s.code||s.name)};};

    // 一、D7／D25
    for(const metric of ['d7','d25']){
      const imp=impact(stores,metric,{targets,independent,acOf}),values=series(metric),n=streak(values,metric,imp.target),v=imp.center.value;
      if(v===null)continue;
      const evidence=[{text:`五週 ${imp.label}：`+weeks.map((w,i)=>w.label+' '+pct(values[i])).join('、')+'。',src:'成績 ByOrder'}];
      if(imp.gap)evidence.push({text:imp.sentence.replace(/^[^；]*；/,''),src:'影響度排名',link:{tab:'impact',metric}});
      for(const a of weekAnoms.filter(a=>a.flags.some(f=>f.metric===imp.label&&f.diff<0)))evidence.push({text:a.title+(a.reasons.length?'；'+a.reasons.join('；'):'')+'。',src:'異常日'});
      const waitTop=stores.filter(s=>s.wait>0&&!independent.has(s.code)).sort((a,b)=>b.wait-a.wait).slice(0,2);
      const clues=metric!=='d7'?[]:[...waitTop.map(s=>`${s.name}：等餐登記 ${int(s.wait)} 筆`),...weekAnoms.filter(a=>a.reasons.some(r=>r.includes('雨量'))).map(a=>`${a.label}下雨`)];
      sections.push({key:'d7',metric,label:imp.label+' 準時率',met:!imp.gap,score:imp.gap?imp.gap/Math.max(1,imp.center.orders):0,
        issue:imp.gap?`${imp.label} ${pct(v)}，${targetText(metric,imp.target)}，還差 ${int(imp.gap)} 單`+(n>=2?`；連續 ${n} 週未達標。`:'。'):`${imp.label} ${pct(v)}，達標（${targetText(metric,imp.target)}）。`,
        evidence,clues,followup:metric==='d7'?followup('d7',v,values.at(-2)??null,'中心 D7','pct'):null});
    }
    // 二、FA 佔比／TPLH
    { const imp=impact(stores,'fa',{targets,independent,acOf}),values=series('fa'),v=imp.center.value,tplh=summary.tplh??null,tplhMet=tplh===null||targets.tplh===null||targets.tplh===undefined||tplh>=targets.tplh;
      if(v!==null){const evidence=[{text:'五週 FA 佔比：'+weeks.map((w,i)=>w.label+' '+pct(values[i])).join('、')+'。',src:'成績 ByOrder'}];if(imp.gap)evidence.push({text:imp.sentence.replace(/^[^；]*；/,''),src:'影響度排名',link:{tab:'impact',metric:'fa'}});if(tplh!==null)evidence.push({text:`TPLH ${fmtNum(tplh,2)}（目標 ${fmtNum(targets.tplh,1)}）。`,src:'成績＋工時'});
        if(dataDays&&dataDays.hours!==null&&dataDays.hours<7)evidence.push({text:dataDays.hours>0?`本週工時只有 ${dataDays.hours} 天有登記，TPLH 只算這幾天。`:'本週工時未登記，無法計算 TPLH。',src:'資料完整度'});
        const issue=[imp.gap?`FA 佔比 ${pct(v)}，上限 ${pct(imp.target,0)}，要少 ${int(imp.gap)} 張 FA 單。`:`FA 佔比 ${pct(v)}，在上限內。`,tplhMet?'':`TPLH ${fmtNum(tplh,2)}，低於目標 ${fmtNum(targets.tplh,1)}。`].filter(Boolean).join('');
        sections.push({key:'fa',metric:'fa',label:'FA 佔比／人力效率（TPLH）',met:!imp.gap&&tplhMet,score:(imp.gap?imp.gap/Math.max(1,imp.center.tc):0)+(tplhMet?0:(targets.tplh-tplh)/targets.tplh),issue,evidence,clues:weekAnoms.filter(a=>a.flags.some(f=>f.metric==='FA 佔比'&&f.diff>0)).map(a=>`${a.label} FA 偏高`+(a.reasons[0]?'，'+a.reasons[0]:'')),followup:followup('fa',v,values.at(-2)??null,'中心 FA 佔比','pct')});}
    }
    // 三、營業額 SSTG
    { const v=summary.sstg??null,target=targets.sstg;
      if(v!==null){const met=target===null||target===undefined||v>=target;sections.push({key:'sstg',metric:'sstg',label:'營業額（SSTG）',met,score:met?0:(target-v),issue:met?`SSTG ${pct(v)}，達標（目標 ${(target>0?'+':'')+pct(target)}）。`:`SSTG ${pct(v)}，目標 ${(target>0?'+':'')+pct(target)}。`,
        evidence:[{text:`本週 TC ${int(summary.tc)}，去年同期 ${int(summary.prior)}。`,src:'成績＋去年同期'},...weekAnoms.filter(a=>a.flags.some(f=>f.kind==='tc')).map(a=>({text:a.title+(a.reasons.length?'；'+a.reasons.join('；'):'')+'。',src:'異常日'}))],
        clues:weekAnoms.flatMap(a=>a.closed.map(s=>`${a.label} ${s.name} 0 單`)),followup:followup('sstg',v,prevSummary.sstg??null,'中心 SSTG','pct')});}
    }
    // 四、等餐
    { const imp=impact(stores,'waiting',{targets,independent,acOf});
      sections.push({key:'waiting',metric:'waiting',label:'等餐',met:imp.sumNeed===0,score:0,issue:imp.sumNeed?`等餐登記 ${int(imp.sumNeed)} 筆。`:'本週沒有等餐登記（不代表實際沒有等餐）。',evidence:imp.sumNeed?[{text:imp.sentence,src:'等餐登記',link:{tab:'impact',metric:'waiting'}}]:[],clues:[],followup:null,info:true});
    }
    // 排序：未達標依缺口比例在前，達標在後；等餐只當參考，放最後
    const ordered=sections.filter(s=>!s.info).sort((a,b)=>(a.met-b.met)||b.score-a.score).concat(sections.filter(s=>s.info));
    // 同一筆紀錄（key）可能有兩段（D7、D25），在週報上合併成一段
    const merged=[];for(const s of ordered){const same=merged.find(x=>x.key===s.key);if(same){same.parts.push(s);same.met=same.met&&s.met;}else merged.push({key:s.key,label:s.key==='d7'?'D7／D25 準時率':s.label,met:s.met,parts:[s],note:note(s.key,week.start)});}
    const problems=merged.filter(m=>!m.met&&m.key!=='waiting');
    const missing=[];if((summary.sstg??null)===null)missing.push('SSTG（缺去年同期資料）');if((summary.tplh??null)===null)missing.push('TPLH（缺工時）');
    return {week,missing,sections:merged,headline:problems.length?`本週 ${problems.length} 個問題，依影響排序：${problems.map(p=>p.label).join('、')}。`:'本週主要指標都達標。'};
  }

  /** 週報純文字（複製用）。fills：{[key]:{root_cause,action_plan}} */
  function weeklyText(draft,{title='',fills={}}={}){
    const cn=['一','二','三','四','五','六'],lines=[title,draft.headline,''];
    draft.sections.forEach((sec,i)=>{lines.push(`${cn[i]||i+1}、${sec.label}`);for(const p of sec.parts){lines.push('＊發現問題：'+p.issue);if(p.evidence.length){lines.push('＊提出證據：');for(const e of p.evidence)lines.push('  ・'+e.text+`（${e.src}）`);}}
      const f=fills[sec.key]||{};if(!sec.met||f.root_cause||f.action_plan){lines.push('＊根源：'+(f.root_cause||'（待填）'));lines.push('＊制定行動：'+(f.action_plan||'（待填）'));}lines.push('');});
    return lines.join('\n').trim()+'\n';
  }

  /** C1 時段 × 星期熱圖。orders：{date, hour, code, fa, d7, d25, wait}；hour 為落單時間的小時（台灣時間），沒有時間的單另計 skipped。
   *  口徑同上：D7／D25 只算非獨立店的非 FA 單；FA 佔比、等餐用全部單。單數少於 minOrders 的格子不給值，避免一兩張單就變紅。 */
  const WEEKDAYS=['一','二','三','四','五','六','日'];
  function heatmap(orders,metric,{independent=new Set(),minOrders=5}={}){
    if(!METRICS[metric])throw new Error('不支援的指標：'+metric);
    const grid=new Map(),hours=new Set(),all=blank({});let skipped=0;
    const add=(t,o)=>{t.tc++;if(o.fa)t.fa++;else if(!independent.has(String(o.code||''))){const d7=String(o.d7||'').toUpperCase(),d25=String(o.d25||'').toUpperCase();if(d7==='Y')t.d7Y++;if(d7==='N')t.d7N++;if(d25==='Y')t.d25Y++;if(d25==='N')t.d25N++;}if(o.wait)t.wait++;};
    for(const o of orders){
      const h=Number(o.hour);
      if(o.hour===null||o.hour===undefined||!Number.isInteger(h)||h<0||h>23){skipped++;continue;}
      const wd=(new Date(o.date+'T12:00:00Z').getUTCDay()+6)%7,key=wd+'|'+h;
      let t=grid.get(key);if(!t){t=blank({});grid.set(key,t);}
      add(t,o);add(all,o);hours.add(h);
    }
    const base=x=>metric==='d7'||metric==='d25'?x[metric+'Y']+x[metric+'N']:x.tc;
    const list=[...hours].sort((a,b)=>a-b);
    const rows=WEEKDAYS.map((label,wd)=>({weekday:label,cells:list.map(h=>{const t=grid.get(wd+'|'+h)||blank({}),n=base(t),enough=metric==='waiting'?t.tc>0:n>=minOrders;return {hour:h,n,tc:t.tc,value:enough?value(t,metric):null};})}));
    const overall=value(all,metric);
    // 明顯差的格子：達成率比整體低（FA 比整體高）至少 5 點；等餐取筆數最多。最多 3 格。
    const cells=rows.flatMap(r=>r.cells.map(c=>({...c,weekday:r.weekday}))).filter(c=>c.value!==null);
    let worst;
    if(metric==='waiting')worst=cells.filter(c=>c.value>0).sort((a,b)=>b.value-a.value||b.tc-a.tc).slice(0,3);
    else if(overall===null)worst=[];
    else{const gap=c=>METRICS[metric].kind==='share'?c.value-overall:overall-c.value;worst=cells.filter(c=>gap(c)>=0.05-EPS).sort((a,b)=>gap(b)-gap(a)||b.n-a.n).slice(0,3);}
    return {metric,hours:list,rows,overall,skipped,total:all.tc+skipped,minOrders,worst};
  }
  /** 依 AC 分組（中心 → AC 層）。acOf(code) 取不到的歸「未分配」。 */
  function byAc(stores,acOf=()=>null,independent=new Set()){
    const map=new Map();
    for(const s of stores){const name=acOf(s.code)||'未分配';const g=map.get(name)||{name,stores:[]};g.stores.push(s);map.set(name,g);}
    return [...map.values()].map(g=>({name:g.name,stores:g.stores,total:center(g.stores,independent)}));
  }

  // ===== C5 排班與成績對照、C6 派單時間 =====
  const DAY_KEYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  /** 指休時段文字 → [[開始分, 結束分]]；空白回 []，看不懂回 null（與後台人力建議同一套規則）。 */
  function parseRanges(value){
    const s=String(value||'').trim();if(!s)return [];
    const out=[];
    for(const part of s.split(/[，,、;；/\n]+/).map(x=>x.trim()).filter(Boolean)){
      const m=part.match(/^(\d{1,2})(?::(\d{2}))?\s*[-~～至]\s*(\d{1,2})(?::(\d{2}))?$/);if(!m)return null;
      const sh=+m[1],sm=+(m[2]||0),eh=+m[3],em=+(m[4]||0),a=sh*60+sm,b=eh*60+em;
      if(sh>23||eh>24||sm>59||em>59||a>=b||b>1440)return null;out.push([a,b]);
    }
    return out;
  }
  /** 指休排班：每人每週取最後一次正式提交（測試資料不算），算每天有填可上班時段的人數與時數。 */
  function shiftByDate(rows,dates){
    const latest=new Map();
    for(const r of [...(rows||[])].filter(r=>r&&r.is_test!==true).sort((a,b)=>String(b.submitted_at||'').localeCompare(String(a.submitted_at||'')))){const k=String(r.employee_id)+'|'+r.week_start;if(!latest.has(k))latest.set(k,r);}
    const out=new Map();
    for(const d of dates){
      let people=0,hours=0,unreadable=0,submitted=0;
      for(const r of latest.values()){
        const off=Math.round((Date.parse(d+'T12:00:00Z')-Date.parse(String(r.week_start)+'T12:00:00Z'))/86400000);if(!(off>=0&&off<=6))continue;
        submitted++;const ranges=parseRanges(r[DAY_KEYS[new Date(d+'T12:00:00Z').getUTCDay()]]);
        if(ranges===null){unreadable++;continue;}
        if(ranges.length){people++;hours+=ranges.reduce((n,[a,b])=>n+(b-a)/60,0);}
      }
      out.set(d,{people,hours,unreadable,submitted});
    }
    return out;
  }
  /** 逐日排班對照。day：{date, tc, nonfa, hours（實際工時，缺為 null）, d7（中心非獨立店，缺為 null）, excluded}
   *  建議工時＝自送單（扣 FA）÷ 標準 TPLH；排太多＝實際比建議多 overHours 小時以上；偏少＝實際低於建議且當天 D7 未達標。 */
  function staffing(days,{shift=new Map(),tplh=2.5,overHours=30,d7Target=null}={}){
    const rows=days.map(x=>{
      const s=shift.get(x.date)||null,base={date:x.date,tc:x.tc,nonfa:x.nonfa,people:s?s.people:null,shiftHours:s?s.hours:null,unreadable:s?s.unreadable:0,hours:x.hours,d7:x.d7};
      if(x.excluded)return {...base,verdict:'excluded',tplh:null,suggest:null,diff:null};
      if(!x.tc)return {...base,verdict:'noscore',tplh:null,suggest:null,diff:null};
      const suggest=tplh>0?x.nonfa/tplh:null;
      if(x.hours===null||x.hours===undefined||!(x.hours>0))return {...base,verdict:'nohours',tplh:null,suggest,diff:null};
      const diff=suggest===null?null:x.hours-suggest,low=d7Target!==null&&x.d7!==null&&x.d7!==undefined&&x.d7<d7Target-EPS;
      const verdict=diff===null?'ok':diff>=overHours-EPS?'over':diff<0&&low?'under':'ok';
      return {...base,verdict,tplh:x.nonfa/x.hours,suggest,diff};
    });
    const judged=rows.filter(r=>r.diff!==null),sum=k=>judged.reduce((n,r)=>n+(r[k]||0),0);
    return {rows,over:rows.filter(r=>r.verdict==='over').length,under:rows.filter(r=>r.verdict==='under').length,
      total:judged.length?{nonfa:sum('nonfa'),hours:sum('hours'),suggest:sum('suggest'),diff:sum('diff'),tplh:sum('hours')>0?sum('nonfa')/sum('hours'):null}:null};
  }
  const SLOTS=[['11 時前',0,10],['11–13 時',11,13],['14–16 時',14,16],['17–20 時',17,20],['21 時後',21,23]];
  /** 派單時間。order：{code, name, late（true／false／null）, stayMin（留店分鐘或 null）, hour（落單時，0–23 或 null）}
   *  晚派比例的分母＝有派單與預計抵達時間可判讀的單；只列至少 minOrders 張可判讀的餐廳。 */
  function dispatch(orders,{minOrders=20}={}){
    const acc=()=>({orders:0,known:0,late:0,stay:0,stayN:0}),put=(t,o)=>{t.orders++;if(o.late!==null&&o.late!==undefined){t.known++;if(o.late)t.late++;}if(Number.isFinite(o.stayMin)){t.stay+=o.stayMin;t.stayN++;}},out=t=>({...t,share:t.known?t.late/t.known:null,avgStay:t.stayN?t.stay/t.stayN:null});
    const stores=new Map(),slots=SLOTS.map(()=>acc()),all=acc();let noHour=0;
    for(const o of orders){
      const k=o.code||o.name;if(!stores.has(k))stores.set(k,{code:o.code||'',name:o.name||o.code||'未分類餐廳',...acc()});put(stores.get(k),o);put(all,o);
      if(o.hour===null||o.hour===undefined){noHour++;continue;}const i=SLOTS.findIndex(([,a,b])=>o.hour>=a&&o.hour<=b);if(i>=0)put(slots[i],o);
    }
    const list=[...stores.values()].map(out),ranked=list.filter(s=>s.known>=minOrders&&s.late>0).sort((a,b)=>b.late-a.late||b.share-a.share||a.code.localeCompare(b.code));
    return {all:out(all),stores:ranked,small:list.filter(s=>s.known<minOrders).length,slots:SLOTS.map(([label],i)=>({label,...out(slots[i])})).filter(s=>s.orders),noHour,minOrders};
  }

  // ===== E2 匯出：工作表名稱、純文字表格、Word 文件外框 =====
  /** Excel 工作表名稱：去掉不允許的字元、最多 31 字、重複時加序號。 */
  function sheetNames(list){
    const used=new Set();
    return list.map((raw,i)=>{
      const base=(String(raw||'').replace(/[\[\]:*?\/\\]/g,' ').replace(/\s+/g,' ').trim()||'表'+(i+1)).slice(0,31);
      let name=base,n=2;while(used.has(name.toLowerCase())){const tail='（'+n+++'）';name=base.slice(0,31-tail.length)+tail;}
      used.add(name.toLowerCase());return name;
    });
  }
  /** 表格轉成貼到 LINE 也看得懂的文字：每列一行，欄位用「｜」隔開；空白格寫「—」。 */
  function tableText(rows){return rows.filter(r=>r.some(c=>String(c??'').trim())).map(r=>r.map(c=>String(c??'').replace(/\s+/g,' ').trim()||'—').join('｜')).join('\n');}
  /** Word 可直接開啟的 HTML 文件（.doc）。body 需已跳脫。 */
  function wordDoc(title,body){
    const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>'+esc(title)+'</title>'+
      '<style>body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;font-size:11pt;line-height:1.6}h1{font-size:16pt}h2,h3{font-size:13pt;margin:14pt 0 6pt}table{border-collapse:collapse;margin:6pt 0}th,td{border:1px solid #999;padding:3pt 6pt;font-size:10pt}th{background:#f2f2f2}p,li{margin:3pt 0}</style></head><body><h1>'+esc(title)+'</h1>'+body+'</body></html>';
  }

  const api={METRICS,addDays,byStore,center,value,fails,need,impact,streak,alerts,anomalies,weeklyDraft,weeklyText,pct,heatmap,byAc,WEEKDAYS,parseRanges,shiftByDate,staffing,dispatch,SLOTS,sheetNames,tableText,wordDoc};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsInsights=api;
})(typeof window!=='undefined'?window:globalThis);
