/* 儀表板 v2｜B 組計算：影響度排名（B1）、週報草稿（B2）、連續未達標預警（B3）、異常日（B4）。
 * 純計算，不碰資料庫與畫面；輸入是「每日 × 餐廳」的格子（cells），由 analysis-dashboard.js 從成績 ByOrder 整理後傳入。
 * cell：{date, code, name, area, tc, fa, d7Y, d7N, d25Y, d25N, wait}
 * 口徑與儀表板相同：D7／D25 只算非獨立店、排除第三方（FA）單；中心 FA 佔比＝非獨立店 FA／TC。 */
(function(root){
  'use strict';
  const EPS=1e-9;
  const Summary=root.OpsSummary||(typeof module!=='undefined'&&module.exports?require('./operations-summary.js'):null);
  const M=root.OpsMetrics||(typeof module!=='undefined'&&module.exports?require('./operations-metrics.js'):null);
  const inCenter=(s,independent)=>M.inCenterTotal(s.code,s.name,independent);
  const addDays=(date,n)=>Summary.addDays(date,n);
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
    for(const c of cells){
      if(c.date<start||c.date>end||excluded.has(c.date))continue;
      const key=c.code||c.name,t=map.get(key)||blank(c);
      t.centerTc=(t.centerTc||0)+(c.centerTc??c.tc??0);
      t.centerFa=(t.centerFa||0)+(c.centerFa??c.fa??0);
      addInto(t,c);t.days++;map.set(key,t);
    }
    return [...map.values()];
  }
  /** 中心指標使用非獨立店，店別仍保留自身的數字。 */
  function center(stores,independent){
    const t=blank({code:'',name:'中心'});
    for(const s of stores)if(inCenter(s,independent))addInto(t,{...s,tc:s.centerTc??s.tc,fa:s.centerFa??s.fa});
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
  function impact(stores,metric,{targets={},independent,acOf=()=>null}={}){
    const spec=METRICS[metric];if(!spec)throw new Error('不支援的指標：'+metric);
    const target=spec.targetKey?targets[spec.targetKey]??null:null;
    const isRate=metric==='d7'||metric==='d25',eligible=s=>isRate?s[metric+'Y']+s[metric+'N']>0:metric==='waiting'?s.wait>0:s.tc>0;
    const scoped=stores.filter(eligible);
    const centerStoreRows=stores.filter(s=>inCenter(s,independent))
      .map(s=>({...s,tc:s.centerTc??s.tc,fa:s.centerFa??s.fa})).filter(eligible);
    const total=center(centerStoreRows,independent),centerValue=value(total,metric);
    const gap=metric==='waiting'?null:need(total,metric,target);
    const compare=(a,b)=>spec.kind==='share'||metric==='waiting'?b.value-a.value:a.value-b.value;
    function rank(list){
      const rows=list.map(s=>({code:s.code,name:s.name,area:s.area,ac:acOf(s.code),
        orders:isRate?s[metric+'Y']+s[metric+'N']:s.tc,value:value(s,metric),need:need(s,metric,target)}));
      const ranks=new Map(rows.slice().sort(compare).map((s,i)=>[s.code||s.name,i+1]));
      return rows.filter(s=>s.need>0).sort((a,b)=>b.need-a.need||compare(a,b)||a.name.localeCompare(b.name,'zh-Hant'))
        .map(s=>({...s,pctRank:ranks.get(s.code||s.name)}));
    }
    const centerStores=rank(centerStoreRows),sumNeed=centerStores.reduce((n,s)=>n+s.need,0);
    const centerShares=new Map(),acs=new Map();
    let cum=0,cut=-1;
    for(const [i,s] of centerStores.entries()){
      cum+=s.need;
      const divisor=gap||sumNeed;
      s.cum=cum;s.share=divisor?s.need/divisor:null;s.cumShare=divisor?cum/divisor:null;
      centerShares.set(s.code||s.name,s);
      if(cut<0&&gap>0&&cum>=gap)cut=i;
      const k=s.ac||'未設定 AC',a=acs.get(k)||{name:k,stores:0,need:0};
      a.stores++;a.need+=s.need;acs.set(k,a);
    }
    const list=rank(scoped).map(s=>{
      const c=centerShares.get(s.code||s.name);
      return {...s,share:c?.share??null,cumShare:c?.cumShare??null};
    });
    const days=Math.max(1,...centerStoreRows.map(s=>s.days||1));
    const orders=isRate?total[metric+'Y']+total[metric+'N']:total.tc;
    return {metric,label:spec.label,kind:spec.kind,target,center:{...total,value:centerValue,orders},
      gap,perDay:gap!==null?gap/days:null,days,stores:list,centerStores,cut,sumNeed,
      acs:[...acs.values()].sort((a,b)=>b.need-a.need||a.name.localeCompare(b.name,'zh-Hant')),
      sentence:impactSentence({label:spec.label,kind:spec.kind,metric,value:centerValue,gap,list:centerStores,cut,sumNeed})};
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
  function alerts({cells,weeks,days,targets={},independent,excluded=new Set(),acOf=()=>null,weekSummary=()=>null,minOrders=20,weekRule=2,dayRule=3}){
    const out=[];
    const weekStores=weeks.map(w=>byStore(cells,w.start,w.end,excluded));
    const weekCenter=weekStores.map(list=>list.length?center(list,independent):null);
    const last=weekStores.at(-1)||[];
    // 中心｜週指標
    for(const metric of ['d7','d25','fa']){
      const target=targets[METRICS[metric].targetKey],values=weekCenter.map(c=>c?value(c,metric):null),n=streak(values,metric,target);
      if(n<weekRule)continue;
      const imp=impact(last,metric,{targets,independent,acOf}),share=METRICS[metric].kind==='share',nStores=imp.cut+1;
      const names=imp.centerStores.slice(0,Math.min(nStores,5)).map(s=>s.name).join('、');
      const plan=nStores?`補齊 ${names}${nStores>5?' 等':' 這'} ${nStores} 家即可達標。`:'各店補齊仍不足，需全面提升。';
      const gap=imp.gap?`，本週${share?'要少':'還差'} ${int(imp.gap)} 單；${plan}`:'。';
      out.push({level:n>=3?'red':'orange',scope:'center',metric,weeks:n,
        title:`中心 ${METRICS[metric].label}｜連續 ${n} 週未達標`,
        detail:trend(weeks,values,n)+`（${targetText(metric,target)}）`+gap,link:{tab:'impact',metric}});
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
        const series=weekStores.map(list=>{
          const s=list.find(x=>(x.code||x.name)===key);
          if(!s||metric!=='fa'&&!inCenter(s,independent))return null;
          const orders=metric==='fa'?s.tc:s[metric+'Y']+s[metric+'N'];
          return orders>=minOrders?value(s,metric):null;
        });
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

  const WEEKLY_MIN_ORDERS=30;
  const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const validOrders=(total,metric)=>['d7','d25'].includes(metric)?total[metric+'Y']+total[metric+'N']:total.tc;
  function sameWeekdays(date,lookback,usable){
    return Array.from({length:lookback},(_,i)=>addDays(date,-7*(i+1))).filter(usable);
  }

  /** B4 異常日：和前 4 個同一星期幾比較。
   * context(date)→{rainMm, campaigns:[名稱], note}；tcThreshold＝單量差距比例，rateThreshold＝達成率差距（百分點）。 */
  function anomalies({cells,dates,excluded=new Set(),independent,context=()=>({}),
    tcThreshold=0.15,rateThreshold=0.05,closedMin=10,lookback=4,inScope=()=>true,minOrders=0}){
    const has=new Set(cells.map(c=>c.date)),out=[];
    const centerScored=new Set(cells.filter(c=>c.centerScored??inCenter(c,independent)).map(c=>c.date));
    const dayStores=new Map(),get=d=>{if(!dayStores.has(d))dayStores.set(d,byStore(cells,d,d,excluded));return dayStores.get(d);};
    for(const d of dates){
      if(excluded.has(d)||!has.has(d))continue;
      const base=sameWeekdays(d,lookback,b=>has.has(b)&&!excluded.has(b));
      if(base.length<2)continue;
      // 基準日只算目標日仍在範圍內的店（例如 995 苗栗三店 11/1 起移出，前幾週的苗栗不能拿來比）
      const getBase=b=>get(b).filter(s=>inScope(s.code,d,s.name));
      const today=center(get(d),independent),centerBase=base.filter(b=>centerScored.has(b));
      const bases=centerBase.map(b=>center(getBase(b),independent));
      const usable=bases.filter(x=>x.tc>=minOrders);
      const baseline=vs=>centerScored.has(d)&&centerBase.length>=2&&vs.length>=(minOrders?2:1)?average(vs):null;
      const avgTc=baseline(usable.map(x=>x.tc)),diffTc=avgTc&&today.tc>=minOrders?today.tc/avgTc-1:null;
      const dayRate=(x,m)=>x.tc>=minOrders&&validOrders(x,m)>=minOrders?value(x,m):null;
      const avgRate=m=>baseline(usable.map(x=>dayRate(x,m)).filter(x=>x!==null));
      const ctx=context(d)||{},flags=[];
      if(diffTc!==null&&Math.abs(diffTc)>=tcThreshold){
        const text=`TC ${int(today.tc)}，比近 ${centerBase.length} 個週${weekday(d)}平均${diffTc<0?'少':'多'} ${pct(Math.abs(diffTc),0)}`;
        flags.push({kind:'tc',metric:'TC',value:today.tc,avg:avgTc,diff:diffTc,text});
      }
      for(const m of ['d7','d25']){
        const v=dayRate(today,m),a=avgRate(m),label=METRICS[m].label;
        if(v!==null&&a!==null&&Math.abs(v-a)>=rateThreshold)flags.push({kind:'rate',metric:label,value:v,avg:a,diff:v-a,
          text:`${label} ${pct(v)}，比近 ${centerBase.length} 個週${weekday(d)}平均${v<a?'低':'高'} ${Math.abs((v-a)*100).toFixed(1)} 點`});
      }
      { const v=dayRate(today,'fa'),a=avgRate('fa');
        if(v!==null&&a!==null&&Math.abs(v-a)>=rateThreshold)flags.push({kind:'rate',metric:'FA 佔比',value:v,avg:a,diff:v-a,
          text:`FA 佔比 ${pct(v)}，平常約 ${pct(a)}`}); }
      const priorWait=usable.filter(x=>x.tc>0&&x.wait>0).map(x=>x.wait/x.tc),a=baseline(priorWait);
      if(today.tc>0&&today.tc>=minOrders&&today.wait>0&&a!==null){
        const v=today.wait/today.tc;
        if(Math.abs(v-a)>=rateThreshold)flags.push({kind:'rate',metric:'等餐',value:v,avg:a,diff:v-a,
          text:`等餐 ${pct(v)}，平常約 ${pct(a)}`});
      }
      // 平常有單、當天 0 單：可能停業或系統問題
      const todayCodes=new Map(get(d).map(s=>[s.code||s.name,s])),closed=[];
      const usual=new Map();for(const b of base)for(const s of getBase(b)){const k=s.code||s.name,u=usual.get(k)||{code:s.code,name:s.name,tc:0};u.tc+=s.tc;usual.set(k,u);}
      for(const [k,u] of usual){const avg=u.tc/base.length,t=todayCodes.get(k);if(avg>=closedMin&&(!t||t.tc===0))closed.push({code:u.code,name:u.name,avg});}
      if(!flags.length&&!closed.length)continue;
      const reasons=[];
      if(ctx.rainMm>0)reasons.push(`當天雨量 ${fmtNum(ctx.rainMm,ctx.rainMm<10?1:0)} mm`);
      if(ctx.campaigns?.length)reasons.push(`當天有優惠券：${ctx.campaigns.join('、')}`);
      if(ctx.note)reasons.push(`特殊事項：${ctx.note}`);
      if(!reasons.length)reasons.push('沒有記錄到天氣、優惠券或特殊事項');
      const worst=flags.slice().sort((a,b)=>Math.abs(b.kind==='tc'?b.diff/3:b.diff)-Math.abs(a.kind==='tc'?a.diff/3:a.diff))[0];
      const label=`${md(d)}（${weekday(d)}）`;
      if(worst){
        const icon=ctx.rainMm>=5?'🌧️':ctx.campaigns?.length?'🎟️':flags.some(f=>f.kind==='tc')?'📦':'📉';
        const bad=flags.some(f=>['FA 佔比','等餐'].includes(f.metric)?f.diff>0:f.diff<0);
        out.push({scope:'center-day',main:worst,others:flags.filter(f=>f!==worst),date:d,label,icon,flags,closed:[],
          reasons,context:ctx,baseDates:centerBase,title:label+worst.text,bad});
      }
      for(const store of closed){
        const title=label+store.name+' 當天 0 單';
        out.push({scope:'store',main:null,others:[],date:d,label,icon:'📦',flags:[],closed:[store],context:ctx,baseDates:base,title,bad:true,
          reasons:[`平常約 ${Math.round(store.avg)} 單，可能停業或系統問題，請確認`]});
      }
    }
    return out.sort((a,b)=>b.date.localeCompare(a.date));
  }

  /** B2 週報：結論、四項 KPI、其他發現、080／GES／4128、事件每日附錄。
   * 純計算共用於畫面及複製；只以既有資料判讀，未知值保持 null。 */
  const CN=['一','二','三','四','五','六','七','八'];
  const WAIT_REPLY_KEYWORDS={
    待確認:['沒有等餐','未有等餐','已準備好','已備好'],
    量能:['人力','單多','集中','一小時','工時','配餐不及','只有'],
    缺貨:['蛋塔','蛋撻','雞','飯','薯','漢堡','斷','缺','等產品']
  };
  const FOOD_SAFETY_KEYWORDS=['食安','就醫','醫療','衛生','異物','毛髮','不舒服','腹瀉'];
  const FOOD_SAFETY_PHRASES=/(?:尚未|沒有|未|已|將)?(?:就醫|通報衛生(?:單位|局|所))/g;
  const EXTERNAL_EVENTS=new Set(['優惠券','天氣','停班']);
  const FORECAST_REASON='排班依預估，未含活動影響';
  const sgn=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(v>0?'+':v<0?'-':'')+Math.abs(v*100).toFixed(1)+'%';
  const dpt=(a,b)=>a===null||b===null||a===undefined||b===undefined?'':`（較上週 ${(a-b)>=0?'+':'-'}${Math.abs((a-b)*100).toFixed(1)} 點）`;
  const num2=d=>`${d>=0?'+':'−'}${fmtNum(Math.abs(d),2)}`;
  /** 「D7 82.3%（上週 80.1%，+2.2 點）」；缺本週或上週就註明 */
  function vsPrev(label,now,prev,fmt,dfmt){
    const ok=v=>v!==null&&v!==undefined&&Number.isFinite(v);
    if(!ok(now)&&!ok(prev))return `${label} 本週與上週都沒有資料`;
    if(!ok(now))return `${label} 本週沒有資料（上週 ${fmt(prev)}）`;
    if(!ok(prev))return `${label} ${fmt(now)}（上週沒有資料）`;
    return `${label} ${fmt(now)}（上週 ${fmt(prev)}，${dfmt(now-prev)}）`;
  }
  const wan=v=>v>=10000?(v/10000).toFixed(1)+' 萬':int(Math.round(v));
  function topShare(list,gap,max=4){
    if(!gap||!list.length)return null;let k=list.length;let cum=0;for(let i=0;i<list.length;i++){cum+=list[i].need;if(cum>=gap){k=i+1;break;}}
    k=Math.min(k,max);const top=list.slice(0,k),covered=top.reduce((n,s)=>n+s.need,0);
    return `${top.map(s=>s.name).join('、')} 這 ${top.length} 家占缺口 ${pct(Math.min(1,covered/gap),0)}`;
  }
  function countText(map){return Object.entries(map||{}).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join('、');}
  const sum=map=>Object.values(map||{}).reduce((n,v)=>n+(v||0),0);

  const known=v=>typeof v==='number'&&Number.isFinite(v);
  const improve=(a,b,lower=false)=>known(a)&&known(b)?(a-b)*(lower?-1:1):null;
  const storeKey=s=>s.code||s.name;
  const delayStoreKey=x=>String(x.store_code||x.restaurant_name||'未分類餐廳');
  const rateOf=(num,den)=>den>0?num/den:null;
  const WEEKLY_NO_REASON='找不到明顯原因';
  const replyText=entries=>entries.map(([label,n])=>`${label} ${n} 筆`).join('、');
  const mostReplies=counts=>[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant')).slice(0,2);
  function groupBy(values,keyOf){
    const groups=new Map();
    for(const item of values){
      const key=keyOf(item);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(item);
    }
    return groups;
  }
  function mergeEvents(events){
    const sorted=events.filter(e=>e.date&&e.name).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const groups=[];
    for(const e of sorted){
      const prev=groups.findLast(g=>g.name===e.name&&g.kind===e.kind&&g.end>=addDays(e.date,-1));
      if(prev){prev.end=e.date;prev.metrics=[...new Set([...prev.metrics,...(e.metrics||[])])];}
      else groups.push({name:e.name,kind:e.kind,start:e.date,end:e.date,metrics:[...(e.metrics||[])]});
    }
    return groups;
  }
  function forecastGap(summary,complete){
    const {tc,forecast,actualHours,forecastHours}=summary;
    if(!complete||!known(tc)||tc<0||!known(forecast)||forecast<=0)return '';
    const ratio=tc/forecast;
    if(Math.abs(ratio-1)<.2-EPS)return '';
    return `實際單量為預估的 ${ratio.toFixed(2)} 倍；實際工時 ${fmtNum(actualHours,1)}／需求工時 ${fmtNum(forecastHours,1)}`;
  }
  function complaintFields(row){
    return [row.complaint_type,row.main_topic,row.item_1,row.item_2,row.content]
      .map(x=>String(x??'').normalize('NFKC').trim());
  }
  function urgentFeedback(rows){
    return rows.flatMap(row=>{
      const fields=complaintFields(row),terms=FOOD_SAFETY_KEYWORDS.filter(k=>fields.some(s=>s.includes(k)));
      if(!terms.length)return [];
      const phrases=[...new Set(fields.flatMap(s=>s.match(FOOD_SAFETY_PHRASES)||[]))];
      const topics=[...phrases,...terms.filter(k=>!phrases.some(s=>s.includes(k)))];
      const summary=Array.from(row.source_type+' '+topics.join('、'));
      const short=summary.length>40?summary.slice(0,39).join('')+'…':summary.join('');
      return [`${md(row.record_date)} ${row.restaurant_name||row.store_code||'—'}｜${short}`];
    });
  }
  function contradictoryFeedback(rows,stores,independent){
    const normalize=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'');
    const codeKey=s=>{const code=normalize(s);return /^\d+$/.test(code)?code.padStart(3,'0'):code;};
    const byCode=new Map(stores.filter(s=>s.code).map(s=>[codeKey(s.code),s]));
    const byName=groupBy(stores,s=>normalize(s.name)),counts=new Map(),seen=new Set();
    for(const row of rows){
      if(row.feedback_kind==='其他/建議')continue;
      const fields=complaintFields(row),[,topic]=fields;
      const late=row.source_type==='0800'?/^(?:S\b|S速度|速度)/i.test(topic):
        fields.some(s=>/遲到/.test(s.replace(/(?:沒有|並未|未|無)遲到/g,'')));
      if(!late)continue;
      const sameName=byName.get(normalize(row.restaurant_name));
      const store=row.store_code?byCode.get(codeKey(row.store_code)):sameName?.length===1?sameName[0]:null;
      if(!store||!inCenter(store,independent))continue;
      const caseId=normalize(row.work_order)||normalize(row.source_key);
      const key=caseId?JSON.stringify([row.source_type,storeKey(store),caseId]):null;
      if(key&&seen.has(key))continue;
      if(key)seen.add(key);
      counts.set(store,(counts.get(store)||0)+1);
    }
    const total=center(stores,independent),d7=value(total,'d7'),d25=value(total,'d25');
    if(!known(d7)||!known(d25))return [];
    return [...counts].filter(([s,n])=>n>=3&&known(value(s,'d7'))&&known(value(s,'d25'))&&
      value(s,'d7')>d7+EPS&&value(s,'d25')>d25+EPS)
      .sort(([a,x],[b,y])=>y-x||a.name.localeCompare(b.name,'zh-Hant'))
      .map(([s,n])=>`${s.name} 遲到客訴 ${n} 件，但 D7 ${pct(value(s,'d7'))}／D25 ${pct(value(s,'d25'))} 優於中心，請查時段或外送員`);
  }
  function weeklyDelays({delays,orders=[],week,summary={},excluded=new Set(),inScope=()=>true,scoreDates=null,independent}){
    const available=Array.isArray(delays);
    const rows=(delays||[]).filter(x=>x.record_date>=week.start&&x.record_date<=week.end&&
      inScope(String(x.store_code||''),x.record_date,x.restaurant_name));
    const eligible=scoreDates?new Set(scoreDates):null;
    const counted=rows.filter(x=>!excluded.has(x.record_date)&&(!eligible||eligible.has(x.record_date)));
    const isCenter=row=>M.inCenterTotal(row.store_code,row.restaurant_name,independent);
    const centerRows=rows.filter(isCenter),centerCounted=counted.filter(isCenter);
    const ratio=available&&rows.length>0&&known(summary.tc)&&summary.tc>0&&eligible?centerCounted.length/summary.tc:null;
    const by=new Map(),reasons=new Map(),byReason=new Map(),replyGroups=new Map(),hours=new Map(),pending=new Set();
    let replied=0,unmatched=0;
    const orderGroups=groupBy(orders,o=>o.date+'|'+storeKey(o));
    for(const row of rows){
      const code=String(row.store_code||''),name=row.restaurant_name||code||'未分類餐廳',key=code||name;
      const s=by.get(key)||{code,name,n:0};s.n++;by.set(key,s);
      const scoped=isCenter(row);
      if(row.status==='completed'){
        if(scoped)replied++;
        const reason=String(row.reason||'').trim().replace(/\s+/g,' ');
        if(reason){
          const storeReasons=byReason.get(key)||new Map();
          storeReasons.set(reason,(storeReasons.get(reason)||0)+1);byReason.set(key,storeReasons);
          if(scoped)reasons.set(reason,(reasons.get(reason)||0)+1);
          const normalized=reason.normalize('NFKC').replace(/\s+/g,'');
          const kind=Object.keys(WAIT_REPLY_KEYWORDS).find(k=>WAIT_REPLY_KEYWORDS[k].some(word=>normalized.includes(word)))||'其他';
          if(scoped)replyGroups.set(kind,(replyGroups.get(kind)||0)+1);
        }
      }else if(scoped)pending.add(name);
      const same=orderGroups.get(row.record_date+'|'+key)||[];
      const full=String(row.order_number||'').trim(),exact=full?same.filter(o=>o.order===full):[];
      const tail=full.match(/\d{4}$/)?.[0];
      const matches=exact.length?exact:tail?same.filter(o=>String(o.order).endsWith(tail)):[];
      const hour=matches.length===1?matches[0].hour:null;
      if(scoped){if(known(hour))hours.set(hour,(hours.get(hour)||0)+1);else unmatched++;}
    }
    const ranked=[...by.values()].sort((a,b)=>b.n-a.n||a.name.localeCompare(b.name,'zh-Hant'));
    return {count:available&&rows.length?centerRows.length:null,ratio,ranked,rows,counted,centerCounted,byReason,
      replied:rows.length?replied:null,expected:rows.length?centerRows.length:null,pending:[...pending],unmatched,
      reasons:mostReplies(reasons),replyGroups:['缺貨','量能','待確認','其他'].flatMap(k=>replyGroups.has(k)?[[k,replyGroups.get(k)]]:[]),
      hours:[...hours].sort((a,b)=>b[1]-a[1]).slice(0,3)};
  }
  function weeklyCommitments(actions,week,getValue){
    if(!Array.isArray(actions))return {text:'上週行動：資料不足',items:[]};
    const items=actions.filter(a=>a.owner==='週報'&&a.week_start===week.start&&!a.archived).map(a=>{
      const status=String(a.status??a.completion_status??'').trim().toLowerCase();
      let done=null,inferred=false;
      if(['completed','complete','done','已完成','完成','closed'].includes(status))done=true;
      else if(['pending','open','in_progress','未完成','進行中','待處理'].includes(status))done=false;
      else if(!status){
        const d=improve(getValue(a,week.start),getValue(a,addDays(week.start,-7)),['fa','waiting'].includes(a.metric_key));
        if(d!==null){done=d>EPS;inferred=true;}
      }
      return {...a,done,inferred};
    });
    const completed=items.filter(a=>a.done===true).length,unfinished=items.filter(a=>a.done===false),unknown=items.filter(a=>a.done===null);
    if(!items.length)return {text:'上週行動：無',items};
    let text=`上週行動 ${items.length} 項：完成 ${completed}，未完成 ${unfinished.length}`;
    if(unknown.length)text+=`，待確認 ${unknown.length}`;
    if(items.some(a=>a.inferred))text+='（KPI 改善輔助判讀，完成狀態待確認）';
    const pending=[...unfinished,...unknown];if(pending.length)text+='；'+pending.map(a=>a.action).join('；');
    return {text,items};
  }
  function weeklyStoreRanks(metrics,stores,waiting,sstg){
    const lists=metrics.map(metric=>{
      if(metric==='waiting')return waiting.ranked.map(s=>({...s,metric,value:s.n}));
      const higherIsWorse=metric==='fa';
      const source=metric==='sstg'?sstg:stores;
      return source.map(s=>({...s,metric,value:metric==='sstg'?s.value:value(s,metric)})).filter(s=>known(s.value))
        .sort((a,b)=>(higherIsWorse?b.value-a.value:a.value-b.value)||a.name.localeCompare(b.name,'zh-Hant'));
    });
    const top=new Map(),depth=Math.max(0,...lists.map(list=>list.length));
    for(let rank=0;rank<depth;rank++){
      for(const list of lists){
        const s=list[rank];
        if(s&&!top.has(storeKey(s)))top.set(storeKey(s),s);
      }
    }
    return [...top.values()];
  }
  function clusteredOrders(orders){
    let n=0;
    for(const day of groupBy(orders,o=>o.date).values()){
      const times=day.map(o=>o.moment).sort((a,b)=>a-b);
      let right=0,covered=0;
      for(let left=0;left<times.length;left++){
        while(right<times.length&&times[right]-times[left]<=30*60000)right++;
        if(right-left>=6){n+=right-Math.max(left,covered);covered=right;}
      }
    }
    return n;
  }
  function weeklyStoreReasons({cells,stores,orders,wait,independent,storeContext,storeSstgDay,rateThreshold}){
    const dayKey=(date,key)=>date+'|'+key;
    const positiveTc=new Set(cells.filter(c=>c.tc>0).map(c=>dayKey(c.date,storeKey(c))));
    const waitingByDay=groupBy(wait.rows,x=>dayKey(x.record_date,delayStoreKey(x)));
    const counted=wait.counted.filter(x=>positiveTc.has(dayKey(x.record_date,delayStoreKey(x))));
    const countedByStore=groupBy(counted,delayStoreKey);
    const centerTotals=center(stores,independent),storeMap=new Map(stores.map(s=>[storeKey(s),s]));
    const waitAverage=rateOf(counted.length,centerTotals.tc);
    const byStoreDay=groupBy(cells,storeKey);
    const timed=orders.filter(o=>!o.fa&&inCenter(o,independent)&&known(o.moment));
    const timeByStore=groupBy(timed,storeKey);
    const clusters=new Map([...timeByStore].map(([key,list])=>[key,clusteredOrders(list)]));
    const centerCluster=rateOf([...clusters.values()].reduce((n,count)=>n+count,0),timed.length);
    const hourOf=o=>new Date(o.moment+8*3600000).getUTCHours();
    const failures=(list,metric)=>groupBy(list.filter(o=>o[metric]==='N'),hourOf);
    const centerFailures=Object.fromEntries(['d7','d25'].map(k=>[k,{
      hours:failures(timed,k),count:timed.filter(o=>o[k]==='N').length
    }]));
    const high=(v,a,margin=rateThreshold)=>known(v)&&known(a)&&v>a+EPS&&v-a>=margin-EPS;
    const datedEvent=(key,metric)=>{
      let worst=null;
      for(const c of byStoreDay.get(key)||[]){
        const n=metric==='sstg'?storeSstgDay(c):metric==='waiting'?waitingByDay.get(dayKey(c.date,key))?.length??null:value(c,metric);
        const lower=metric!=='fa'&&metric!=='waiting';
        if(known(n)&&(!worst||(lower?n<worst.n:n>worst.n)))worst={c,n};
      }
      if(!worst)return null;
      const {c}=worst,ctx=storeContext(c)||{};
      const matches=[...(ctx.rainMm>0||ctx.trace?['降雨']:[]),...(ctx.campaigns||[]).map(n=>'優惠券「'+n+'」')];
      return matches.length?`最差日 ${md(c.date)} 遇到${matches.join('、')}`:null;
    };
    return (row)=>{
      const key=storeKey(row),s=storeMap.get(key),out=[];
      const waitingCount=countedByStore.get(key)?.length||0,waitRate=rateOf(waitingCount,s?.tc);
      if(waitingCount>=2&&high(waitRate,waitAverage,.01)){
        out.push((row.metric==='waiting'?'':`等餐 ${int(waitingCount)} 筆，`)+`佔 TC ${pct(waitRate)}（中心 ${pct(waitAverage)}）`);
      }
      const replies=mostReplies(wait.byReason.get(key)||[]);
      if(replies.length&&(out.length||row.metric==='waiting'))out.push('餐廳回覆：'+replyText(replies));
      const storeTimed=timeByStore.get(key)||[],n=clusters.get(key);
      const clusterShare=rateOf(n,storeTimed.length);
      if(n>=6&&high(clusterShare,centerCluster))out.push(`集中單 ${int(n)} 單（${pct(clusterShare)}，中心 ${pct(centerCluster)}）`);
      const reference=centerFailures[row.metric];
      if(reference){
        const [peak]=[...failures(storeTimed,row.metric)].sort((a,b)=>b[1].length-a[1].length||a[0]-b[0]);
        if(peak){
          const [hour,list]=peak,share=rateOf(list.length,storeTimed.filter(o=>o[row.metric]==='N').length);
          const base=rateOf(reference.hours.get(hour)?.length||0,reference.count);
          if(list.length>=3&&high(share,base))out.push(`${METRICS[row.metric].label} 未達成單集中於 ${hour} 時 ${pct(share)}（中心 ${pct(base)}）`);
        }
      }
      const fa=s?value(s,'fa'):null,faAverage=value(centerTotals,'fa');
      // FA 段本身就是 FA；SSTG 是單量成長，FA 不是它的原因
      if(!['fa','sstg'].includes(row.metric)&&high(fa,faAverage))out.push(`FA 佔比 ${pct(fa)}（中心 ${pct(faAverage)}）`);
      const event=datedEvent(key,row.metric);
      if(event)out.push(event);
      return out.slice(0,2);
    };
  }
  function weeklyDraft({week,weeks=[],cells=[],targets={},independent,excluded=new Set(),
    weekSummary=()=>null,anomalyList=[],notes=[],dataDays=null,inScope=()=>true,sssg=[],sstgStores=()=>[],storeSstgDay=()=>null,
    storeContext=()=>({}),rateThreshold=.05,daily=[],bigOrders=null,feedback=null,feedbackRows=[],newStores=new Set(),
    delays=null,orders=[],scoreDates=null,events=[],actions=null,salesComparison=null,storeClosures=[]}){
    const rawNote=(key,start)=>notes.find(x=>x.week_start===start&&x.metric_key===key)||null;
    const note=(key,start)=>{
      const a=rawNote(key,start),partner={fa:'tplh',d7:'d25'}[key];if(!partner)return a;
      const b=rawNote(partner,start);if(!b)return a;if(!a)return b;
      const join=k=>[a[k],b[k]].map(x=>String(x||'').trim()).filter(Boolean).join('\n');
      return {...a,issue:join('issue'),evidence:join('evidence'),root_cause:join('root_cause'),action_plan:join('action_plan'),
        updated_at:[a.updated_at,b.updated_at].filter(Boolean).sort().at(-1)||null};
    };
    const prevStart=addDays(week.start,-7),range=start=>({start,end:addDays(start,6)});
    const history=[...new Map([...weeks.filter(w=>w.start<=week.start),{...week}].map(w=>[w.start,w])).values()]
      .sort((a,b)=>a.start.localeCompare(b.start));
    const summaries=new Map(),storesAt=new Map(),waits=new Map();
    const sumAt=start=>{
      if(!summaries.has(start))summaries.set(start,weekSummary(range(start))||{});
      return summaries.get(start);
    };
    const storeAt=start=>{
      if(!storesAt.has(start))storesAt.set(start,byStore(cells,start,addDays(start,6),excluded)
        .filter(s=>inScope(s.code,week.end,s.name)));
      return storesAt.get(start);
    };
    const waitingAt=start=>{
      if(!waits.has(start))waits.set(start,weeklyDelays({delays,orders,week:range(start),summary:sumAt(start),excluded,inScope,scoreDates,independent}));
      return waits.get(start);
    };
    const valAt=(metric,start,code='')=>{
      const list=storeAt(start),s=code?list.find(x=>String(x.code)===String(code)):null;
      if(code){
        if(!s)return null;
        if(metric==='waiting')return waitingAt(start).ranked.find(x=>x.code===String(code))?.n??null;
        if(metric==='sstg'||metric==='tplh')return null;
        return !inCenter(s,independent)&&['d7','d25'].includes(metric)?null:value(s,metric);
      }
      if(metric==='waiting')return waitingAt(start).ratio;
      if(metric==='sstg'||metric==='tplh')return sumAt(start)[metric]??null;
      const total=list.length?center(list,independent):null;
      return total?value(total,metric):null;
    };
    const summary=sumAt(week.start),previous=sumAt(prevStart),stores=storeAt(week.start),kpi=[];
    const completeTc=!scoreDates||Summary.dates(week.start,week.end).every(d=>excluded.has(d)||scoreDates.includes(d));
    const gapText=forecastGap(summary,completeTc);
    const complaints=feedbackRows.filter(x=>['0800','4128'].includes(x.source_type)&&typeof x.record_date==='string'&&
      x.record_date>=week.start&&x.record_date<=week.end).sort((a,b)=>a.record_date.localeCompare(b.record_date));
    const relativeChange=(now,prev)=>known(now)&&known(prev)&&prev!==0?(now-prev)/Math.abs(prev):null;
    const verifyChange=d=>known(d)&&Math.abs(d)>.3+EPS;
    const metrics={sstg:['SSTG',false,sgn],d7:['D7',false,pct],d25:['D25',false,pct],
      fa:['FA 佔比',true,pct],tplh:['TPLH',false,v=>fmtNum(v,2)],waiting:['等餐／TC',true,pct]};
    const metric=(key)=>{
      const [label,lower,format]=metrics[key],now=valAt(key,week.start),prev=valAt(key,prevStart);
      const target=targets[key==='fa'?'faShareMax':key],judged=known(now)&&known(target);
      const met=judged?(lower?now<=target+EPS:now>=target-EPS):null;
      const delta=improve(now,prev,lower),values=history.map(w=>valAt(key,w.start));
      let n=0;
      for(let i=history.length-1;i>0;i--){
        if(addDays(history[i-1].start,7)!==history[i].start)break;
        const d=improve(values[i],values[i-1],lower);if(d===null||d>=-EPS)break;n++;
      }
      const trend=delta===null?'—':delta>EPS?'▲':delta<-EPS?'▼':'→';
      const status=!known(now)?'資料不足':key==='waiting'?'':!judged?'目標資料不足':met?'達標':lower?'超過上限':'未達標';
      const notice=key==='sstg'&&verifyChange(relativeChange(now,prev))?'｜請確認資料':'';
      const header=`${label} ${format(now)}（上週 ${format(prev)}）${trend}`+(status?'｜'+status:'')+(n>=2?`｜連續第 ${n} 週退步`:'')+notice;
      return {key,label,lower,format,now,prev,target,met,judged,delta,values,n,header};
    };
    const records=Object.fromEntries(Object.keys(metrics).map(k=>[k,metric(k)]));
    const anoms=anomalyList.filter(a=>a.date>=week.start&&a.date<=week.end);
    const eventRows=events.slice();
    for(const a of anoms){
      if(a.scope==='store')continue;
      const kinds=a.flags.map(f=>f.metric==='TC'?'sstg':f.metric==='FA 佔比'?'fa':f.metric==='等餐'?'waiting':f.metric.toLowerCase());
      const ctx=a.context||{};
      for(const name of ctx.campaigns||[])eventRows.push({date:a.date,name,kind:'優惠券',metrics:kinds});
      if(ctx.rainMm>0)eventRows.push({date:a.date,name:'降雨',kind:'天氣',metrics:kinds});
      if(ctx.note)eventRows.push({date:a.date,name:ctx.note,kind:/停班|颱風|天氣/.test(ctx.note)?'停班':'事項',metrics:kinds});
      if(!(ctx.campaigns||[]).length&&!(ctx.rainMm>0)&&!ctx.note&&kinds.length)eventRows.push({date:a.date,name:'未記錄原因',kind:'異常日',metrics:kinds});
    }
    const merged=mergeEvents(eventRows.filter(e=>e.date>=week.start&&e.date<=week.end));
    const eventText=e=>{const span=md(e.start)+(e.end!==e.start?'–'+md(e.end):'');
      return e.kind==='異常日'?`異常日 ${span}（原因未記錄）`:`${e.kind}「${e.name}」（${span}）`;};
    const wait=waitingAt(week.start),prevWait=waitingAt(prevStart);
    const scopedCells=cells.filter(c=>!excluded.has(c.date)&&inScope(c.code,c.date,c.name));
    const weekCells=scopedCells.filter(c=>c.date>=week.start&&c.date<=week.end&&inScope(c.code,week.end,c.name));
    const reasonsForStore=weeklyStoreReasons({cells:weekCells,stores,wait,independent,storeContext,storeSstgDay,rateThreshold,
      orders:orders.filter(o=>o.date>=week.start&&o.date<=week.end&&!excluded.has(o.date)&&
        inScope(o.code,o.date,o.name)&&inScope(o.code,week.end,o.name))});
    const available=new Set(history.map(w=>w.start));
    const primary=(keys)=>{
      const byWeek=new Map();
      const ranked=start=>{
        if(!byWeek.has(start)){
          const sales=keys.includes('sstg')?sstgStores(range(start)).filter(s=>inScope(s.code||'',week.end,s.name)):[];
          byWeek.set(start,weeklyStoreRanks(keys,storeAt(start),keys.includes('waiting')?waitingAt(start):null,sales));
        }
        return byWeek.get(start);
      };
      const top=start=>ranked(start).slice(0,3);
      const priority=({long,n})=>long?2:n>1?1:0;
      return ranked(week.start).flatMap((s,i)=>{
        let n=1,start=prevStart;
        while(available.has(start)&&top(start).some(p=>storeKey(p)===storeKey(s))){n++;start=addDays(start,-7);}
        const long=n>=4||!inCenter(s,independent)||newStores.has(storeKey(s));
        const metric=records[s.metric],centerValue=metric.now;
        // 從前三以外補入時，仍須有劣於中心的表現。
        const worse=improve(s.value,centerValue,metric.lower);
        return i<3||s.metric==='waiting'||(known(worse)&&worse<-EPS)?[{s,n,long}]:[];
      }).sort((a,b)=>priority(a)-priority(b)).slice(0,3).map(({s,n,long},i)=>{
        const isWait=s.metric==='waiting',label=isWait?'等餐':metrics[s.metric][0];
        const fmt=isWait?v=>known(v)?int(v)+' 筆':'—':metrics[s.metric][2];
        const total=isWait?wait.count:records[s.metric].now;
        const text=`${CIRCLE[i]} ${s.name} ${label} ${fmt(s.value)}（中心 ${fmt(total)}）`+
          (n>=2?`｜連續 ${n} 週`:'')+(long?'｜長期':'');
        const reasons=reasonsForStore(s);
        return {text,reasons,store:s};
      });
    };
    const followup=(key,keys)=>{
      const prev=note(key,prevStart);if(!String(prev?.action_plan||'').trim())return null;
      const compare=keys.map(k=>`${metrics[k][0]} ${metrics[k][2](valAt(k,prevStart))} → ${metrics[k][2](valAt(k,week.start))}`);
      for(const s of stores.filter(s=>s.name&&prev.action_plan.includes(s.name)).slice(0,3)){
        for(const k of keys.filter(k=>['d7','d25','fa','waiting'].includes(k))){
          const format=k==='waiting'?v=>known(v)?int(v)+' 筆':'—':metrics[k][2],label=k==='waiting'?'等餐':metrics[k][0];
          compare.push(`${s.name} ${label} ${format(valAt(k,prevStart,s.code))} → ${format(valAt(k,week.start,s.code))}`);
        }
      }
      return {text:prev.action_plan,compare};
    };
    const cellsByDate=groupBy(scopedCells,c=>c.date),dailyByDate=new Map(daily.map(d=>[d.date,d]));
    const totalOn=(date,targetDate=date)=>{
      const list=(cellsByDate.get(date)||[]).filter(s=>inScope(s.code,targetDate,s.name));
      return list.length?center(list,independent):null;
    };
    const delayRows=(delays||[]).filter(x=>inScope(String(x.store_code||''),x.record_date,x.restaurant_name));
    const delaysByDate=groupBy(delayRows,x=>x.record_date);
    const dayValue=(k,date,targetDate)=>{
      const total=totalOn(date,targetDate);
      if(!total||total.tc<WEEKLY_MIN_ORDERS||validOrders(total,k)<WEEKLY_MIN_ORDERS)return null;
      if(k==='sstg')return total.tc;
      if(k==='waiting'){
        const rows=(delaysByDate.get(date)||[]).filter(x=>inScope(String(x.store_code||''),targetDate,x.restaurant_name));
        return rows.length||(!Array.isArray(delays)&&total.wait)||null;
      }
      return value(total,k);
    };
    const eventImpact=(e,keys)=>{
      const comparisons=[];
      for(const k of keys){
        if(!e.metrics.includes(k)||k==='tplh')continue;
        const paired=Summary.dates(e.start,e.end).flatMap(date=>{
          const now=dayValue(k,date,date);
          if(!known(now))return [];
          const baseline=sameWeekdays(date,4,day=>cellsByDate.has(day)).map(day=>dayValue(k,day,date)).filter(known);
          return baseline.length>=2?[{now,usual:average(baseline)}]:[];
        });
        const count=k==='sstg'||k==='waiting',fmt=count?n=>fmtNum(n,1).replace(/\.0$/,''):metrics[k][2];
        const label=k==='sstg'?'TC':k==='waiting'?'等餐筆數':metrics[k][0];
        comparisons.push(label+' '+(paired.length?`平均 ${fmt(average(paired.map(x=>x.now)))} vs 平常 ${fmt(average(paired.map(x=>x.usual)))}`:'資料不足'));
      }
      return comparisons.length?'：'+comparisons.join('、'):'';
    };
    const eventReason=(related,keys)=>related.map(e=>eventText(e)+eventImpact(e,keys)).join('；');
    const section=(key,label,keys)=>{
      const recs=keys.map(k=>records[k]),related=merged.filter(e=>e.metrics.some(k=>keys.includes(k)));
      const suggestion=gapText&&['fa','waiting'].includes(key)?FORECAST_REASON:'';
      const uncontrolled=!suggestion&&related.length>0&&related.every(e=>EXTERNAL_EVENTS.has(e.kind));
      const countIncreased=key==='waiting'&&known(wait.count)&&known(prevWait.count)&&wait.count>prevWait.count;
      const problem=!!suggestion||countIncreased||recs.some(x=>x.met===false||known(x.delta)&&x.delta<-EPS);
      const met=recs.every(x=>x.met===true),judged=recs.every(x=>x.judged);
      const compact=met&&!problem&&!related.length&&recs.every(x=>known(x.delta));
      const stored=note(key,week.start);
      const evidence=[],top=primary(keys.filter(k=>k!=='tplh'));
      if(top.length){
        evidence.push({text:'最差 '+top.length+' 家'});
        for(const row of top)evidence.push({text:row.text,details:row.reasons});
      }else evidence.push({text:'最差餐廳：資料不足'});
      const reply=key==='waiting'&&wait.reasons.length?'餐廳回覆：'+replyText(wait.reasons):'';
      const reasons={};
      for(const k of keys){
        const rec=records[k],needsReason=rec.met===false||known(rec.delta)&&rec.delta<-EPS;
        const first=needsReason?top.find(x=>x.store.metric===k&&x.reasons.length):null;
        reasons[k]=[reply,eventReason(related.filter(e=>e.metrics.includes(k)),[k])].filter(Boolean).join('；')||
          (first?first.store.name+' '+first.reasons[0]:'');
      }
      const reason=[reply,eventReason(related,keys)].filter(Boolean).join('；')||
        (suggestion||top.some(x=>x.reasons.length)?'':WEEKLY_NO_REASON);
      const s={key,label,metrics:recs,issue:recs.map(x=>x.header).join('\n'),reason,reasons,evidence,problem,met,judged,
        compact,control:uncontrolled?'uncontrollable':'controllable',suggestion,followup:followup(key,keys),note:stored};
      kpi.push(s);return s;
    };
    const sales=section('sstg','SSSG／SSTG',['sstg']);
    const sw=sssg[weeks.findIndex(w=>w.start===week.start)],ps=sssg[weeks.findIndex(w=>w.start===prevStart)];
    const sd=improve(sw?.value,ps?.value);
    if(known(sw?.value)||known(ps?.value))sales.issue=`SSSG ${sgn(sw?.value)}（上週 ${sgn(ps?.value)}）`+
      (sd===null?'—':sd>EPS?'▲':sd<-EPS?'▼':'→')+'\n'+sales.issue;
    if(known(sd)&&sd<-EPS){sales.problem=true;sales.compact=false;}
    if(known(sw?.value)!==known(ps?.value))sales.compact=false;
    if(salesComparison){
      const {tcChange,ticketChange,salesChange}=salesComparison;
      sales.issue+=`\n單量 ${sgn(tcChange)}、客單價 ${sgn(ticketChange)}、營業額 ${sgn(salesChange)}`;
    }
    const scored=start=>!scoreDates||scoreDates.some(d=>d>=start&&d<=addDays(start,6)&&!excluded.has(d));
    const tcChange=scored(week.start)&&scored(prevStart)?relativeChange(summary.tc,previous.tc):null;
    if(verifyChange(tcChange))sales.issue+=`\nTC ${int(summary.tc)}（上週 ${int(previous.tc)}，${sgn(tcChange)}）｜請確認資料`;
    if(bigOrders&&(bigOrders.now.n||bigOrders.prev.n))sales.evidence.push({text:
      `大單：上週 ${int(bigOrders.prev.n)} 筆 → 本週 ${int(bigOrders.now.n)} 筆`});
    section('d7','D7／D25',['d7','d25']);
    section('fa','TPLH／FA',['fa','tplh']);
    const waiting=section('waiting','等餐',['waiting']);
    waiting.issue=`等餐 ${known(wait.count)?int(wait.count):'—'} 筆，佔 TC ${pct(wait.ratio)}`+
      `（上週 ${known(prevWait.count)?int(prevWait.count):'—'} 筆／${pct(prevWait.ratio)}）`+
      (records.waiting.delta===null?'—':records.waiting.delta>EPS?'▲':records.waiting.delta<-EPS?'▼':'→')+
      (records.waiting.n>=2?`｜連續第 ${records.waiting.n} 週退步`:'');
    waiting.evidence.push({text:`餐廳回覆：${known(wait.replied)?int(wait.replied):'—'}／${known(wait.expected)?int(wait.expected):'—'}`+
      (wait.pending.length?'；待回覆：'+wait.pending.join('、'):'')});
    if(wait.replyGroups.length)waiting.evidence.push({text:'回覆分類：'+replyText(wait.replyGroups)});
    waiting.evidence.push({text:'集中時段：'+(wait.hours.length?wait.hours.map(([h,n])=>`${h} 時 ${n} 筆`).join('、'):'資料不足')+
      (wait.unmatched?`；${wait.unmatched} 筆缺時段或無法唯一配對`:'')});
    const missingTc=known(wait.count)&&scoreDates?wait.count-wait.centerCounted.length:0;
    if(missingTc>0)waiting.evidence.push({text:`${missingTc} 筆等餐缺對應成績日或不計成績`});
    waiting.wait=wait;
    // 店休：Power BI 與 DMS 都沒有單的店日（系統判定），同店連續日期合併
    const closedKey=new Set(storeClosures.map(x=>x.date+'|'+x.name));
    const closed=anoms.flatMap(a=>(a.closed||[]).filter(s=>!closedKey.has(a.date+'|'+s.name)).map(s=>`${md(a.date)} ${s.name} 0 單／未見訂單，待確認`));
    const shut=[];for(const x of storeClosures.filter(x=>x.date>=week.start&&x.date<=week.end).sort((a,b)=>a.name.localeCompare(b.name)||a.date.localeCompare(b.date))){
      const last=shut.at(-1);if(last&&last.name===x.name&&addDays(last.end,1)===x.date)last.end=x.date;else shut.push({name:x.name,start:x.date,end:x.date});}
    const shutText=shut.length?['店休：'+shut.map(x=>md(x.start)+(x.end!==x.start?'–'+md(x.end):'')+' '+x.name).join('、')]:[];
    const findingsList=[...shutText,...closed,...contradictoryFeedback(complaints,stores,independent)];
    const findings={key:'findings',label:'其他發現',info:true,issue:findingsList.join('\n')||'無',evidence:[],
      followup:null,note:note('findings',week.start)};
    // 080／GES／4128（每週都列在總結）
    let fb={key:'feedback',label:'080／GES／4128',met:true,judged:false,info:true,diff:'080 未匯入\nGES 本週未匯入\n4128 未匯入',
      issue:'本週未匯入 080／GES／4128',evidence:[],followup:followup('feedback',[])};
    if(feedback){
      const now=feedback.now||{},prev=feedback.prev||{},n080=Object.keys(now.c0800||{}).length?sum(now.c0800):null,
      n4128=Object.keys(now.c4128||{}).length?sum(now.c4128):null,evidence=[];
      const lines=[];
      if(n080)lines.push(`080 抱怨 ${n080} 通（${countText(now.c0800)}）`);
      if(n4128)lines.push(`4128 投訴 ${n4128} 通（${countText(now.c4128)}）`);
      const p080=Object.keys(prev.c0800||{}).length?sum(prev.c0800):null;
      const p4128=Object.keys(prev.c4128||{}).length?sum(prev.c4128):null;
      const comparison=(label,n,p)=>`${label} ${n===null?'未匯入':n+' 通'}`+(n===null&&p===null?'':`（上週 ${p===null?'未匯入':p+' 通'}）`);
      const diff=[comparison('080',n080,p080),comparison('4128',n4128,p4128)];
      const g=now.ges,pg=prev.ges;
      if(g){const item=(label,k)=>g[k]===null||g[k]===undefined?null:`${label} ${pct(g[k],0)}`;
        const gd=[['好吃度','food'],['服務速度','speed'],['正確度','accuracy'],['外送 OSAT','delivery']].filter(([,k])=>g[k]!==null&&g[k]!==undefined).map(([label,k])=>vsPrev(label,g[k],pg?pg[k]??null:null,x=>pct(x,0),pts));if(gd.length)diff.push('GES '+gd.join('、'));
        const s=[item('好吃度','food'),item('服務速度','speed'),item('正確度','accuracy'),item('外送 OSAT','delivery')].filter(Boolean);if(s.length)evidence.push({text:'GES：'+s.join('、')+(g.responses?`；回覆 ${int(g.responses)} 份`:''),src:'GES'});}
      const sCount=Object.entries(now.c0800||{}).filter(([k])=>/^S\b|^S /.test(k)).reduce((n,[,v])=>n+v,0);
      if(sCount)evidence.push({text:`S 項抱怨 ${sCount} 通`,src:'080'});
      const aItems=now.aItems||[];
      if(aItems.length){const done=aItems.filter(x=>x.reply);evidence.push({text:`A 項（產品正確）${aItems.length} 筆，餐廳已回覆 ${done.length} 筆`+(done.length<aItems.length?`；待回覆：${[...new Set(aItems.filter(x=>!x.reply).map(x=>x.name))].join('、')}`:''),src:'080 A 項回覆'});
        for(const x of done.slice(0,5))evidence.push({text:`${x.name}${x.item?'（'+x.item+'）':''}：配餐 ${x.reply.packer}；根源 ${x.reply.root_cause}；行動 ${x.reply.action_plan}`,src:'080 A 項回覆'});}
      if((now.stores||[]).length)evidence.push({text:'客訴最多：'+now.stores.slice(0,3).map(s=>`${s.name} ${s.n} 通`).join('、'),src:'080／4128'});
      if(!g)diff.push('GES 本週未匯入');
      const issue=lines.length?lines.join('\n'):g?'本週沒有 080／4128 客訴紀錄':'本週未匯入 080／GES／4128';
      fb={key:'feedback',label:'080／GES／4128',met:true,judged:false,info:true,diff:diff.join('\n'),issue,evidence,followup:followup('feedback',[])};
    }

    fb.note=note('feedback',week.start);
    const sections=[...kpi,findings,fb],missing=[];
    if(!known(sw?.value))missing.push('SSSG');
    if(!known(summary.sstg))missing.push('SSTG（缺去年同期資料）');
    if(!known(summary.tplh))missing.push('TPLH（缺工時）');
    if(dataDays&&known(dataDays.hours)&&dataDays.hours<7)missing.push(`工時僅 ${dataDays.hours} 天`);
    if(scoreDates){
      const scored=scoreDates.filter(d=>d>=week.start&&d<=week.end&&!excluded.has(d)).length;
      const expected=Summary.dates(week.start,week.end).filter(d=>!excluded.has(d)).length;
      if(scored<expected)missing.push(`本週成績僅 ${scored}／${expected} 天`);
    }
    if(!known(wait.count))missing.push('等餐（無登記資料）');
    if(!known(wait.ratio))missing.push('等餐／TC（缺可比較資料）');
    if(!fb.evidence.length&&/未匯入/.test(fb.issue))missing.push('080／GES／4128（本週未匯入）');
    const rankedMetrics=Object.values(records),scale=x=>x.key==='tplh'?Math.max(Math.abs(x.target||1),EPS):1;
    const good=rankedMetrics.filter(x=>x.met===true&&known(x.delta)&&x.delta>EPS)
      .sort((a,b)=>b.delta/scale(b)-a.delta/scale(a))[0];
    const failed=rankedMetrics.filter(x=>x.met===false);
    const gap=x=>Math.abs(x.now-x.target)/scale(x);
    const bad=failed.slice().sort((a,b)=>gap(b)-gap(a))[0]||
      rankedMetrics.filter(x=>known(x.delta)&&x.delta<-EPS).sort((a,b)=>a.delta/scale(a)-b.delta/scale(b))[0];
    const reasonFor=k=>kpi.find(s=>s.metrics.some(m=>m.key===k))?.reasons[k]||'';
    const withReason=(text,k,separator='，')=>reasonFor(k)?text+separator+reasonFor(k):text;
    const positive=good?withReason(`${good.label} ${good.format(good.now)}，較上週進步且達標`,good.key,'；'):
      rankedMetrics.some(x=>known(x.delta))?'本週沒有達標且較上週進步的 KPI':'進步重點：資料不足';
    let negative=failed.length?withReason(`未達標：${failed.map(x=>x.label).join('、')}；${bad.label} ${bad.format(bad.now)}`,bad.key):
      bad?withReason(`${bad.label} ${bad.format(bad.now)}，較上週退步`,bad.key,'；'):
      rankedMetrics.some(x=>known(x.delta))?'本週沒有已知未達標或退步的 KPI':'退步重點：資料不足';
    const countIncreased=known(wait.count)&&known(prevWait.count)&&wait.count>prevWait.count;
    const ratioIncreased=known(records.waiting.delta)&&records.waiting.delta<-EPS;
    if((countIncreased||ratioIncreased)&&bad?.key!=='waiting'){
      const change=countIncreased?`等餐增加至 ${int(wait.count)} 筆（佔 TC ${pct(wait.ratio)}）`:`等餐比例增至 ${pct(wait.ratio)}`;
      negative+='；'+withReason(change,'waiting');
    }
    if(gapText)negative=gapText+'。'+negative;
    const conclusion={text:`1. ${positive}\n2. ${negative}\n3. 接下來的行動：（待填）`,note:rawNote('conclusion',week.start)};
    const commitments=weeklyCommitments(actions,week,(a,start)=>valAt(a.metric_key,start,a.store_code||''));
    const eventDates=new Set(anoms.map(a=>a.date));
    for(const e of merged)for(const d of Summary.dates(e.start,e.end))eventDates.add(d);
    const appendix=[...eventDates].sort().map(date=>{
      const row=dailyByDate.get(date),total=totalOn(date);
      const field=(key,fallback)=>row&&Object.hasOwn(row,key)?row[key]:fallback;
      const tc=field('tc',total?.tc>0?total.tc:null);
      const sampleTc=tc??(total?.tc>0?total.tc:null);
      const lowTc=known(sampleTc)&&sampleTc<WEEKLY_MIN_ORDERS;
      const lowD25=!!total&&validOrders(total,'d25')<WEEKLY_MIN_ORDERS;
      const d25=field('d25',total?value(total,'d25'):null);
      const lowD25Rate=lowD25&&known(sampleTc);
      const waiting=delaysByDate.get(date)?.length||(!Array.isArray(delays)&&total?.wait)||null;
      return {date,tc,d25:lowTc||lowD25?null:d25,fa:lowTc?null:field('fa',total?value(total,'fa'):null),
        waiting:field('waiting',waiting),sampleInsufficient:lowTc||lowD25Rate};
    });
    const problems=kpi.filter(s=>s.problem);
    return {week,missing,sections,summary:[],conclusion,commitments,appendix,urgent:urgentFeedback(complaints),
      headline:missing.length?'本週資料不足':problems.length?`本週 ${problems.length} 項 KPI 需追蹤`:'本週 KPI 都達標。'};
  }
  function weeklyMeta(note){
    try{const m=JSON.parse(note?.last_week_followup||'null');return m?.v===3?m:null;}catch(e){return null;}
  }
  // 同一份縮排文字用於儲存與複製，讀取舊週時仍支援一行一項的證據。
  function weeklyEvidenceLines(evidence){
    return (evidence||[]).flatMap(e=>[e.text,...(e.details||[]).map(text=>'  ・'+text)]);
  }
  function restoreEvidence(value){
    const evidence=[];
    for(const text of value?String(value).split('\n'):[]){
      const last=evidence.at(-1);
      if(last&&text.startsWith('  ・'))(last.details??=[]).push(text.slice(3));
      else evidence.push({text});
    }
    return evidence;
  }
  function restoreWeekly(draft){
    const saved=weeklyMeta(draft.conclusion.note),sections=draft.sections.map(s=>{
      const n=s.note;if(!n?.updated_at)return s;
      const meta=weeklyMeta(n);
      return {...s,issue:n.issue??s.issue,evidence:restoreEvidence(n.evidence),compact:meta?.compact===true,
        ...(meta?{reason:meta.reason,control:typeof meta.compact==='boolean'?meta.control:s.control,
          problem:meta.problem,met:meta.met,judged:meta.judged,
          followup:meta.followup,diff:meta.diff??s.diff,suggestion:meta.suggestion||''}:{}),legacy:!meta};
    });
    return {...draft,sections,conclusion:{...draft.conclusion,text:draft.conclusion.note?.issue??draft.conclusion.text},
      urgent:saved?.urgentSaved?(draft.conclusion.note.evidence||'').split('\n').filter(Boolean):draft.urgent,
      ...(saved?{appendix:saved.appendix||[],commitments:saved.commitments||draft.commitments}: {})};
  }
  function weeklyNeedsAction(sec){
    if(sec.key==='findings')return !!sec.issue&&sec.issue!=='無';
    if(sec.key==='feedback')return !!sec.issue&&!/未匯入|本週沒有/.test(sec.issue);
    return !sec.compact&&sec.control!=='uncontrollable'&&(!!sec.problem||!!sec.legacy);
  }
  function compactWeeklyIssue(sec){
    const lines=sec.issue.split('\n');
    const index=sec.key==='sstg'?lines.findIndex(line=>line.startsWith('單量 ')&&line.includes('、客單價 ')):-1;
    const [salesLine]=index<0?[]:lines.splice(index,1);
    return {headingText:lines.join('｜'),salesLine};
  }
  function weeklyText(draft,{title='',fills={},appendix=true,sections=true}={}){
    const lines=title?[title,'']:[];
    lines.push('【結論】',fills.conclusion?.issue??draft.conclusion.text,'');
    if(draft.urgent?.length)lines.push('⚠ 需立即處理',...draft.urgent,'');
    lines.push(draft.commitments.text,'');
    if(sections)draft.sections.forEach((sec,i)=>{
      const f=fills[sec.key]||{},n=sec.note||{};
      const heading=`${CN[i]||i+1}、${sec.label}`;
      if(sec.compact){
        const {headingText,salesLine}=compactWeeklyIssue(sec);
        lines.push(heading+'　'+headingText);
        if(salesLine)lines.push(salesLine);
      }
      else{
        lines.push(heading,sec.issue);
        if(sec.key==='feedback'&&sec.diff&&sec.diff!==sec.issue)lines.push(sec.diff);
        if(sec.reason)lines.push('原因：'+sec.reason);
        if(sec.suggestion)lines.push('可能原因：'+sec.suggestion);
        lines.push(...weeklyEvidenceLines(sec.evidence));
      }
      const actionable=weeklyNeedsAction(sec),root=f.root_cause??n.root_cause,action=f.action_plan??n.action_plan;
      if(actionable||root)lines.push('根源：'+(root||'（待填）'));
      if(actionable||action)lines.push('行動（負責人／完成日）：'+(action||'（待填）'));
      if(sec.followup&&actionable)lines.push('上週行動：'+sec.followup.text,'本週數字：'+sec.followup.compare.join('；'));
      lines.push('');
    });
    if(appendix)lines.push(weeklyAppendix(draft));
    return lines.join('\n').trim()+'\n';
  }
  function weeklyAppendix(draft){
    const rows=draft.appendix||[];
    return '附錄：每日明細\n'+(rows.length?rows.map(x=>`${md(x.date)}｜TC ${known(x.tc)?int(x.tc):'—'}`+
      `｜D25 ${pct(x.d25)}｜FA ${pct(x.fa)}｜等餐 ${known(x.waiting)?int(x.waiting):'—'}`+
      (x.sampleInsufficient?'｜樣本不足':'')).join('\n'):'無');
  }
  /** 總結用的證據：略過近三週走勢（與上週差異已經寫了），取前三條；沒有其他證據才用走勢 */
  function summaryEvidence(sec,max=3){const ev=sec.evidence||[],key=ev.filter(e=>!e.trend);return (key.length?key:ev).slice(0,max);}
  const CIRCLE=['①','②','③','④','⑤','⑥'];


  /** C1 時段 × 星期熱圖。orders：{date, hour, code, fa, d7, d25, wait}；hour 為落單時間的小時（台灣時間），沒有時間的單另計 skipped。
   *  口徑同上：D7／D25 只算非獨立店的非 FA 單；中心熱圖排除獨立店。單數少於 minOrders 的格子不給值，避免一兩張單就變紅。 */
  const WEEKDAYS=['一','二','三','四','五','六','日'];
  function heatmap(orders,metric,{independent,minOrders=5,hourList=null,centerOnly=true}={}){
    if(!METRICS[metric])throw new Error('不支援的指標：'+metric);
    const grid=new Map(),hours=new Set(),all=blank({});let skipped=0;
    const add=(t,o)=>{
      t.tc++;
      if(o.fa)t.fa++;
      else if(inCenter(o,independent)){
        for(const key of ['d7','d25']){
          const flag=String(o[key]||'').toUpperCase();
          if(flag==='Y'||flag==='N')t[key+flag]++;
        }
      }
      if(o.wait)t.wait++;
    };
    for(const o of orders){
      if(centerOnly&&!inCenter(o,independent))continue;
      const h=Number(o.hour);
      if(o.hour===null||o.hour===undefined||!Number.isInteger(h)||h<0||h>23){skipped++;continue;}
      const wd=(new Date(o.date+'T12:00:00Z').getUTCDay()+6)%7,key=wd+'|'+h;
      let t=grid.get(key);if(!t){t=blank({});grid.set(key,t);}
      add(t,o);add(all,o);hours.add(h);
    }
    const base=x=>metric==='d7'||metric==='d25'?x[metric+'Y']+x[metric+'N']:x.tc;
    // hourList：固定顯示的小時欄（外送時段），沒有就列出有訂單的小時
    const list=hourList?hourList.slice():[...hours].sort((a,b)=>a-b);
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
  function byAc(stores,acOf=()=>null,independent){
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

  const api={METRICS,CN,WEEKLY_NO_REASON,
    addDays,byStore,center,value,fails,need,impact,streak,alerts,anomalies,weeklyDraft,weeklyText,compactWeeklyIssue,
    restoreWeekly,weeklyMeta,weeklyNeedsAction,weeklyAppendix,weeklyEvidenceLines,mergeEvents,weeklyDelays,weeklyCommitments,WEEKLY_MIN_ORDERS,
    summaryEvidence,CIRCLE,pct,heatmap,byAc,WEEKDAYS,parseRanges,shiftByDate,staffing,dispatch,SLOTS,sheetNames,tableText,wordDoc};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpsInsights=api;
})(typeof window!=='undefined'?window:globalThis);
