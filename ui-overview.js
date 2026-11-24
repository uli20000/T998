/* 總覽頁（UI 改版第 2 步）。數字一律取自 OpsReport.overview（與匯總資料同一套計算），
 * 待處理清單只讀資料表，不寫入。缺資料顯示「—」。 */
(function(){
  'use strict';
  const E=id=>document.getElementById(id);
  const content=document.querySelector('#adminApp .ui-content');
  if(!content||!window.OpsReport?.overview)return;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,d=0)=>v===null||v===undefined||Number.isNaN(v)?null:Number(v).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
  const pct=v=>v===null||v===undefined?null:num(v*100,1)+'%';
  // 目標與分析儀表板一致（analysis-dashboard.js）
  const targets=window.CenterBusinessConfig.kpiTargets;
  const goal=(key,fmt,compare)=>({
    targetText:()=>targets[key]===null?'目標待核對':'目標 '+fmt(targets[key]),
    ok:value=>targets[key]===null?null:compare(value,targets[key])
  });
  const min=(value,target)=>value>=target,max=(value,target)=>value<=target;
  const percent=value=>num(value*100,Number.isInteger(value*100)?0:1)+'%';
  const KPI=[
    // 期間還沒過完：比「截至今日（有單量日期）的預估」，不比整期預估
    {key:'tc',label:'TC',fmt:v=>num(v),target:s=>s.cmpForecast,
      targetText:s=>s.cmpForecast==null?'預估資料不足':(s.toDate?'截至今日預估 ':'預估 ')+num(s.cmpForecast),
      ok:(_v,s)=>s.tcAchievement==null?null:s.tcAchievement>=1},
    {key:'sstg',label:'SSTG',fmt:pct,...goal('sstg',v=>(v>0?'+':'')+percent(v),min)},
    {key:'d7',label:'D7',fmt:pct,...goal('d7',percent,min)},
    {key:'d25',label:'D25',fmt:pct,...goal('d25',percent,min)},
    {key:'faShare',label:'FA 佔比',fmt:pct,...goal('faShareMax',v=>'≤'+percent(v),max)},
    {key:'tplh',label:'TPLH',fmt:v=>num(v,2),...goal('tplh',v=>num(v,1),min)}
  ];
  const shift=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const sharedDate={key:'t998-shared-date-v1',get(){try{const x=JSON.parse(localStorage.getItem(this.key)||'null');if(x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&['day','week','month'].includes(x.period)&&Date.now()-x.at<43200000)return x;}catch(e){}return null;},set(date,period){try{localStorage.setItem(this.key,JSON.stringify({date,period,at:Date.now()}));}catch(e){}}};
  let date=opsToday(),req=0,period=sharedDate.get()?.period||'day';
  // A01：總覽跟營運、分析共用日／週／月與日期
  const S=window.OpsSummary,PLABEL={day:'日',week:'週',month:'月'};
  const step=(d,n)=>{if(period==='day')return shift(d,n);if(period==='week')return shift(d,7*n);const x=new Date(d.slice(0,7)+'-01T12:00:00Z');x.setUTCMonth(x.getUTCMonth()+n);const last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0,12)).getUTCDate();return x.toISOString().slice(0,8)+String(Math.min(+d.slice(8,10),last)).padStart(2,'0');};
  const label=d=>{if(period==='day')return d.replace(/-/g,'/')+'（'+'日一二三四五六'[new Date(d+'T12:00:00Z').getUTCDay()]+'）';const r=S.range(d,period);return period==='week'?S.weekLabel(d)+'　'+r.start.slice(5).replace('-','/')+'–'+r.end.slice(5).replace('-','/'):r.start.slice(0,4)+' 年 '+(+r.start.slice(5,7))+' 月';};
  const sync=()=>{sharedDate.set(date,period);if(window.OpsDateControl)window.OpsDateControl.set(date,period,false);};

  const page=document.createElement('section');page.id='uiOverviewPage';page.className='ui-overview';
  page.innerHTML='<div class="uo-head"><h1 id="uoTitle">營運成績</h1><div class="uo-date"><span class="uo-period" role="group" aria-label="期間">'+['day','week','month'].map(p=>'<button type="button" data-p="'+p+'">'+PLABEL[p]+'</button>').join('')+'</span><button type="button" data-d="-1" aria-label="上一期">‹</button><label class="date-display"><b id="uoDate"></b><input id="uoDatePick" type="date" aria-label="選擇日期"></label><button type="button" data-d="1" aria-label="下一期">›</button><button type="button" data-d="0">今日</button></div></div>'+
    '<div id="uoKpis" class="uo-kpis"></div>'+
    '<div class="uo-pend-head"><h2 id="uoDayHead">依選定日期</h2><small></small></div>'+
    '<div class="uo-grid3 uo-pend uo-day"><article class="uo-card"><h2>🛵 車輛待處理</h2><div id="uoPendVehicle"></div></article><article class="uo-card"><h2>⏱️ 等餐（依 AC）</h2><div id="uoWait"></div></article><article class="uo-card"><h2>✍️ 劃線簽名（依 AC）</h2><div id="uoLine"></div></article></div>'+
    '<div class="uo-pend-head"><h2 id="uoMonthHead">整月待回饋</h2><small id="uoPendNote"></small></div>'+
    '<div class="uo-grid2 uo-pend"><article class="uo-card"><h2>⏱️ 等餐待回饋</h2><div id="uoPendDelay"></div></article><article class="uo-card"><h2>📝 A 項待回饋</h2><div id="uoPendA"></div></article></div>'+
    '<p id="uoFoot" class="uo-foot"></p><p id="uoStatus" class="uo-status" role="status"></p>';
  content.prepend(page);
  page.querySelector('.uo-date').addEventListener('click',e=>{const pb=e.target.closest('[data-p]');if(pb){period=pb.dataset.p;sync();load();return;}const b=e.target.closest('[data-d]');if(!b)return;const d=+b.dataset.d;date=d===0?opsToday():step(date,d);if(date>opsToday())date=opsToday();sync();load();});

  const pick=page.querySelector('#uoDatePick');pick.onclick=e=>{try{e.target.showPicker?.();}catch(_){}};pick.onchange=()=>{if(!pick.value)return;date=pick.value>opsToday()?opsToday():pick.value;sync();load();};
  const bar=(label,value,max,text,cls='')=>'<div class="uo-bar-row"><span>'+esc(label)+'</span><div class="uo-bar"><div class="'+cls+'" style="width:'+(max?Math.max(2,Math.round(value/max*100)):0)+'%"></div></div><b>'+esc(text)+'</b></div>';
  const empty=t=>'<p class="uo-empty">'+esc(t)+'</p>';
  const top3=(rows,metric,sub)=>rows.length?'<ol class="uo-top">'+rows.map(x=>'<li><b>'+esc(x.store_code+' '+(x.restaurant_name||''))+'</b><small>'+esc(sub(x))+'</small><em>'+esc(metric(x))+'</em></li>').join('')+'</ol>':'';

  // 單量類指標：尚未上傳 Power BI 的日期用 DMS 暫估
  const TC_KPIS=new Set(['tc','sstg','tplh','faShare'])
  function renderKpis(o){
    const toDate=o.range&&o.range.end>opsToday();o.summary={...o.summary,toDate,cmpForecast:toDate?o.summary.attainmentForecast:o.summary.forecast};
    E('uoKpis').innerHTML=KPI.map(k=>{
      const v=o.hasScores||k.key==='tplh'?o.summary[k.key]:null,shown=v==null?null:k.fmt(v),ok=shown==null?null:k.ok(v,o.summary);
      const cls=shown==null?'na':ok===null?'':ok?'ok':'bad';
      const scope=k.scope?'<small class="scope-note">'+k.scope+'</small>':'';
      const estimate=shown!=null&&(o.provisionalDays||[]).length&&TC_KPIS.has(k.key)?
        '<small class="scope-note" title="尚未上傳 Power BI，先用 DMS 單量，上傳後自動更新">暫估</small>':'';
      return '<button type="button" class="uo-kpi '+cls+'" data-go="analysis"><span>'+k.label+scope+estimate+
        '</span><b>'+(shown??'—')+'</b><em>'+esc(k.targetText(o.summary))+'</em></button>';
    }).join('');
  }
  function waitHtml(o){
    const max=Math.max(0,...o.acWait.map(x=>x.count));
    return (o.acWait.length?o.acWait.map(x=>bar(x.name,x.count,max,x.count+' 筆'+(x.pending?'（待回覆 '+x.pending+'）':''),'red')).join(''):empty('沒有 AC 設定'))+
      '<h3>等餐最多的餐廳'+(o.delayTiedOthers?'<small class="uo-tie">（另有 '+o.delayTiedOthers+' 家同筆數並列）</small>':'')+'</h3>'+(top3(o.delayTop,x=>x.count+' 筆',x=>(x.ac?x.ac+'｜':'')+'待回覆 '+x.pending)||empty(period==='day'?'這天沒有等餐紀錄':'這段期間沒有等餐紀錄'));
  }
  function renderWait(o){E('uoWait').innerHTML=waitHtml(o);}
  function lineHtml(o){
    const lineEmpty=o.lineRegistered===0?'尚無餐廳登記劃線簽名':'已登記的餐廳都完成';
    return (o.acLine.length?o.acLine.map(x=>bar(x.name,x.rate??0,1,x.rate===null?'尚未登記':(x.rate*100).toFixed(1)+'%'+(x.missing?'（待檢查 '+x.missing+'）':''),x.rate===null?'na':x.rate>=1?'ok':'warn')).join(''):empty('沒有 AC 設定'))+
      '<h3>缺漏最多的餐廳</h3>'+(top3(o.lineWorst,x=>(x.rate*100).toFixed(1)+'%',x=>(x.ac?x.ac+'｜':'')+'已登記 '+x.count+' 次')||empty(lineEmpty));
  }
  function renderLine(o){E('uoLine').innerHTML=lineHtml(o);}
  // ===== 待處理：車輛（目前狀態）、等餐與 A 項（所選日期的當月份），等餐／A 項依 AC 排、列前三家 =====
  const md=d=>String(d||'').slice(5,10).replace('-','/');
  const okBox=t=>'<p class="uo-pend-zero">✓ '+esc(t)+'</p>';
  const bigNum=(n,unit,text)=>'<div class="uo-pend-big"><b>'+num(n)+'</b><span>'+esc(unit+text)+'</span></div>';
  const link=(key,text)=>'<button type="button" class="uo-pend-go" data-go="'+key+'">'+esc(text)+' →</button>';
  function rankByAc(rows,monthStart){
    const M=window.OpsMetrics,assign=M.acAssignmentsForDate(monthStart),acOf=new Map();
    for(const ac of assign)for(const code of ac.stores)if(!M.NON_DELIVERY_STORES.has(code))acOf.set(String(code),ac.name);
    const ac=new Map(assign.map(a=>[a.name,0])),stores=new Map();let other=0;
    for(const x of rows){const code=String(x.store_code||''),name=acOf.get(code);if(name)ac.set(name,ac.get(name)+1);else other++;
      const k=code||x.restaurant_name;const s=stores.get(k)||{store_code:code,restaurant_name:x.restaurant_name||'',ac:name||'',rows:[]};s.rows.push(x);stores.set(k,s);}
    const acs=[...ac].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
    const list=[...stores.values()].sort((a,b)=>b.rows.length-a.rows.length||String(a.store_code).localeCompare(String(b.store_code)));
    const top=list.slice(0,3),cut=top.length?top[top.length-1].rows.length:0,tied=list.slice(3).filter(x=>x.rows.length===cut).length;
    return {acs,top,tied,other};
  }
  function acBars(acs){const max=Math.max(0,...acs.map(x=>x.count));return acs.map(x=>bar(x.name,x.count,max,x.count+' 筆','red')).join('');}
  function pendCard(rows,monthStart,o){
    if(!rows.length)return okBox(o.zero);
    const r=rankByAc(rows,monthStart),centerRows=o.centerRows??rows;
    const center=centerRows===rows?r:rankByAc(centerRows,monthStart);
    const other=center.other?'<p class="uo-note">另有 '+center.other+' 筆不在 AC 負責範圍（店號未對到）</p>':'';
    return '<div class="uo-split"><div>'+bigNum(centerRows.length,'筆',o.unit)+acBars(center.acs)+other+'</div>'+
      '<div><h3>待回饋最多的餐廳</h3>'+top3(r.top,x=>x.rows.length+' 筆',o.sub)+(r.tied?'<p class="uo-note">另有 '+r.tied+' 家同筆數並列</p>':'')+link(o.go,o.goText)+'</div></div>';
  }
  async function loadPendingVehicles(){
    const vr=await db.from('vehicles').select('id,plate4').eq('active',true);if(vr.error)throw vr.error;
    const plate=new Map((vr.data||[]).map(v=>[v.id,v.plate4]));if(!plate.size)return {abnormal:[],claimed:[]};
    const rr=await db.from('inspection_reports').select('vehicle_id,reported_at,abnormal_items,resolution_status').eq('overall_status','abnormal').in('vehicle_id',[...plate.keys()]).order('reported_at',{ascending:true});if(rr.error)throw rr.error;
    const by=new Map();for(const x of rr.data||[]){if(x.resolution_status==='resolved')continue;const v=by.get(x.vehicle_id)||{plate:plate.get(x.vehicle_id),first:x.reported_at,items:new Set(),n:0};v.n++;for(const it of Array.isArray(x.abnormal_items)?x.abnormal_items:String(x.abnormal_items||'').split(/[、,，]/))if(String(it).trim())v.items.add(String(it).trim());by.set(x.vehicle_id,v);}
    const today=new Date(opsToday()+'T12:00:00Z');
    // 已領未還：與車輛頁同規則——今天最新一次領車之後還沒有巡檢回報
    const dayStart=new Date(opsToday()+'T00:00:00+08:00').toISOString();
    const cr=await db.from('claim_records').select('vehicle_id,claimed_at,claimant_name').in('vehicle_id',[...plate.keys()]).gte('claimed_at',dayStart).order('claimed_at',{ascending:false});if(cr.error)throw cr.error;
    const latest=new Map();for(const c of cr.data||[])if(!latest.has(c.vehicle_id))latest.set(c.vehicle_id,c);
    let claimed=[];
    if(latest.size){const ir=await db.from('inspection_reports').select('vehicle_id,reported_at').in('vehicle_id',[...latest.keys()]).gte('reported_at',dayStart);if(ir.error)throw ir.error;
      const lastReport=new Map();for(const x of ir.data||[]){const t=new Date(x.reported_at).getTime();if(t>(lastReport.get(x.vehicle_id)||0))lastReport.set(x.vehicle_id,t);}
      claimed=[...latest.values()].filter(c=>!((lastReport.get(c.vehicle_id)||0)>new Date(c.claimed_at).getTime())).map(c=>({plate:plate.get(c.vehicle_id),who:c.claimant_name||'',at:c.claimed_at,hours:(Date.now()-new Date(c.claimed_at).getTime())/3600000})).sort((a,b)=>b.hours-a.hours);}
    const abnormal=[...by.values()].map(v=>({...v,days:Math.max(0,Math.round((today-new Date(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(v.first))+'T12:00:00Z'))/86400000))})).sort((a,b)=>b.days-a.days||String(a.plate).localeCompare(String(b.plate)));
    return {abnormal,claimed};
  }
  const hm=t=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
  function vehicleHtml({abnormal:list,claimed}){
    if(!list.length&&!claimed.length)return okBox('沒有待處理的車輛');
    const abHtml='<h3>巡檢異常未處理'+(list.length?' '+list.length+' 台':'')+'</h3>'+(list.length?'<ol class="uo-top">'+list.slice(0,3).map(v=>'<li><b>'+esc(v.plate||'—')+'</b><small>'+esc([...v.items].join('、')||'異常')+(v.n>1?'（'+v.n+' 筆回報）':'')+'</small><em class="'+(v.days>3?'uo-old':'')+'">'+v.days+' 天</em></li>').join('')+'</ol>'+(list.length>3?'<p class="uo-note">另有 '+(list.length-3)+' 台</p>':''):'<p class="uo-empty">沒有異常未處理的車</p>');
    const clHtml='<h3>已領未還（今天）'+(claimed.length?' '+claimed.length+' 台':'')+'</h3>'+(claimed.length?'<ol class="uo-top">'+claimed.slice(0,3).map(c=>'<li><b>'+esc(c.plate||'—')+'</b><small>'+esc((c.who?c.who+'｜':'')+hm(c.at)+' 領車')+'</small><em>'+(c.hours<1?Math.max(1,Math.round(c.hours*60))+' 分':Math.floor(c.hours)+' 小時')+'</em></li>').join('')+'</ol>'+(claimed.length>3?'<p class="uo-note">另有 '+(claimed.length-3)+' 台</p>':''):'<p class="uo-empty">沒有已領未還的車</p>');
    return bigNum(new Set([...list,...claimed].map(x=>x.plate)).size,'台','待處理｜異常 '+list.length+'、已領未還 '+claimed.length)+abHtml+clHtml+link('vehicle','到車輛／巡檢處理');
  }
  let pendReq=0;
  async function loadPending(){
    const id=++pendReq,m=S.range(date,'month'),label=m.start.slice(0,4)+'年'+(+m.start.slice(5,7))+'月';
    E('uoMonthHead').textContent=label+' 待回饋';E('uoDayHead').textContent='依選定日期｜'+E('uoDate').textContent;
    const set=(el,html)=>{if(id===pendReq)E(el).innerHTML=html;},fail=(el,e)=>set(el,'<p class="uo-empty">讀取失敗：'+esc(e.message||e)+'</p>');
    for(const el of ['uoPendVehicle','uoPendDelay','uoPendA'])E(el).innerHTML='<p class="uo-empty">讀取中…</p>';
    loadPendingVehicles().then(v=>set('uoPendVehicle',vehicleHtml(v)),e=>fail('uoPendVehicle',e));
    window.OpsReport.readRows('t998_delay_orders','store_code,restaurant_name,record_date,status',q=>q.gte('record_date',m.start).lte('record_date',m.end).eq('status','pending'))
      .then(rows=>{rows=window.OpsMetrics.scopeData({delay:rows}).delay.filter(x=>!window.OpsMetrics.NON_DELIVERY_STORES.has(String(x.store_code)));
        const centerRows=window.OpsMetrics.centerDelayRows(rows);
        set('uoPendDelay',pendCard(rows,m.start,{centerRows,zero:'餐廳都已回覆等餐原因',
          unit:'餐廳還沒回覆等餐原因',go:'ops:delay',goText:'到等餐紀錄',
          sub:x=>(x.ac?x.ac+'｜':'')+'最早 '+md(x.rows.map(r=>r.record_date).sort()[0])
        }));
      },e=>fail('uoPendDelay',e));
    if(!window.OpsAReplyAdmin?.readRange)set('uoPendA','<p class="uo-empty">此中心尚未開通 A 項回饋（需先啟用新版月份回覆連結）</p>');
    else window.OpsAReplyAdmin.readRange(m).then(rows=>{rows=rows.filter(x=>x.reply?.status!=='completed');
        set('uoPendA',pendCard(rows,m.start,{zero:'餐廳都已回饋 A 項',unit:'0800 A 項還沒填根源與行動',go:'ops:a0800',goText:'到 A 項回饋',sub:x=>{const c=new Map();for(const r of x.rows){const k=r.item_1||'其他';c.set(k,(c.get(k)||0)+1);}return (x.ac?x.ac+'｜':'')+[...c].map(([k,n])=>k+' '+n).join('、');}}));},e=>fail('uoPendA',e));
  }
  window.UiOverview={waitHtml,lineHtml,rankByAc};
  async function load(){
    const id=++req;E('uoDate').textContent=label(date);page.querySelectorAll('[data-p]').forEach(b=>b.classList.toggle('on',b.dataset.p===period));E('uoDatePick').value=date;E('uoDatePick').max=opsToday();E('uoTitle').textContent='T'+((window.CENTER_CONFIG&&window.CENTER_CONFIG.center)||(window.CenterBusinessConfig||{}).center||'')+' '+((window.CenterBusinessConfig||{}).centerName||'外送中心')+'｜營運成績';E('uoStatus').textContent='讀取中…';E('uoFoot').textContent='';
    loadPending();
    try{
      if(window.KpiSettings&&typeof db!=='undefined'){try{await window.KpiSettings.load(db);}catch(e){}}
      const o=await window.OpsReport.overview(date,period);if(id!==req)return;
      renderKpis(o);renderWait(o);renderLine(o);
      const now=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
      E('uoFoot').textContent='成績 BY ORDER '+(o.types.ByOrder?'已匯入':'未匯入')+'｜BY DATE '+(o.types.ByDate?'已匯入':'未匯入')+'｜劃線登記 '+o.lineRegistered+'／'+o.lineExpected+' 店｜產生時間 '+now;
      if(id===req)E('uoStatus').textContent='';
    }catch(e){if(id===req)E('uoStatus').textContent='讀取失敗：'+(e.message||e);}
  }
  page.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(!b)return;if(b.dataset.go==='analysis')location.href='analysis.html';else window.UiShell?.go(b.dataset.go);});

  // 只在總覽模式顯示；每次切回總覽都重新載入
  let loaded=false;
  const original=window.showAdminMode;
  window.showAdminMode=showAdminMode=function(mode){original(mode);page.style.display=mode==='home'?'block':'none';// 每次回到總覽都重讀，等餐、劃線在其他頁新增或修改後才會連動
    if(mode==='home'&&E('adminApp').style.display==='block'){loaded=true;const sd=sharedDate.get();date=sd?.date||date;period=sd?.period||period;load();}};
  page.style.display='block';
  new MutationObserver(()=>{if(!loaded&&E('adminApp').style.display==='block'&&page.style.display!=='none'){loaded=true;load();}}).observe(E('adminApp'),{attributes:true,attributeFilter:['style']});
  if(E('adminApp').style.display==='block'){loaded=true;load();}
})();
