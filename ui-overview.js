/* 總覽頁（UI 改版第 2 步）。數字一律取自 OpsReport.overview（與匯總資料同一套計算），
 * 待處理清單只讀資料表，不寫入。缺資料顯示「資料不足」，不顯示 0。 */
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
    {key:'tc',label:'TC',fmt:v=>num(v),target:s=>s.forecast,targetText:s=>s.forecast==null?'預估資料不足':'預估 '+num(s.forecast),ok:(v,s)=>s.forecast==null?null:v>=s.forecast},
    {key:'sstg',label:'SSTG',fmt:pct,...goal('sstg',v=>(v>0?'+':'')+percent(v),min)},
    {key:'d7',label:'D7',scope:'全部餐廳',fmt:pct,...goal('d7',percent,min)},
    {key:'d25',label:'D25',scope:'全部餐廳',fmt:pct,...goal('d25',percent,min)},
    {key:'faShare',label:'FA 佔比',fmt:pct,...goal('faShareMax',v=>'≤'+percent(v),max)},
    {key:'tplh',label:'TPLH',fmt:v=>num(v,2),...goal('tplh',v=>num(v,1),min)}
  ];
  const shift=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const sharedDate={key:'t998-shared-date-v1',get(){try{const x=JSON.parse(localStorage.getItem(this.key)||'null');if(x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&['day','week','month'].includes(x.period)&&Date.now()-x.at<43200000)return x;}catch(e){}return null;},set(date,period){try{localStorage.setItem(this.key,JSON.stringify({date,period,at:Date.now()}));}catch(e){}}};
  let date=sharedDate.get()?.date||opsToday(),req=0;

  const page=document.createElement('section');page.id='uiOverviewPage';page.className='ui-overview';
  page.innerHTML='<div class="uo-head"><h1 id="uoTitle">營運成績</h1><div class="uo-date"><button type="button" data-d="-1" aria-label="前一天">‹</button><b id="uoDate"></b><button type="button" data-d="1" aria-label="後一天">›</button><button type="button" data-d="0">今天</button></div></div>'+
    '<div id="uoKpis" class="uo-kpis"></div>'+
    '<div class="uo-grid2"><article class="uo-card"><h2>等餐（依 AC）</h2><div id="uoWait"></div></article><article class="uo-card"><h2>劃線簽名（依 AC）</h2><div id="uoLine"></div></article></div>'+
    '<p id="uoFoot" class="uo-foot"></p><p id="uoStatus" class="uo-status" role="status"></p>';
  content.prepend(page);
  page.querySelector('.uo-date').addEventListener('click',e=>{const b=e.target.closest('[data-d]');if(!b)return;const d=+b.dataset.d;date=d===0?opsToday():shift(date,d);if(date>opsToday())date=opsToday();sharedDate.set(date,sharedDate.get()?.period||'day');if(window.OpsDateControl)window.OpsDateControl.set(date,window.OpsDateControl.period,false);load();});

  const bar=(label,value,max,text,cls='')=>'<div class="uo-bar-row"><span>'+esc(label)+'</span><div class="uo-bar"><div class="'+cls+'" style="width:'+(max?Math.max(2,Math.round(value/max*100)):0)+'%"></div></div><b>'+esc(text)+'</b></div>';
  const empty=t=>'<p class="uo-empty">'+esc(t)+'</p>';
  const top3=(rows,metric,sub)=>rows.length?'<ol class="uo-top">'+rows.map(x=>'<li><b>'+esc(x.store_code+' '+(x.restaurant_name||''))+'</b><small>'+esc(sub(x))+'</small><em>'+esc(metric(x))+'</em></li>').join('')+'</ol>':'';

  function renderKpis(o){
    E('uoKpis').innerHTML=KPI.map(k=>{
      const v=o.hasScores||k.key==='tc'&&o.summary.tc?o.summary[k.key]:null,shown=v==null?null:k.fmt(v),ok=shown==null?null:k.ok(v,o.summary);
      const cls=shown==null?'na':ok===null?'':ok?'ok':'bad';
      return '<button type="button" class="uo-kpi '+cls+'" data-go="analysis"><span>'+k.label+(k.scope?'<small class="scope-note">'+k.scope+'</small>':'')+'</span><b>'+(shown??'資料不足')+'</b><em>'+esc(k.targetText(o.summary))+'</em></button>';
    }).join('');
  }
  function waitHtml(o){
    const max=Math.max(0,...o.acWait.map(x=>x.count));
    return (o.acWait.length?o.acWait.map(x=>bar(x.name,x.count,max,x.count+' 筆'+(x.pending?'（待回覆 '+x.pending+'）':''),'red')).join(''):empty('沒有 AC 設定'))+
      '<h3>等餐最多的餐廳</h3>'+(top3(o.delayTop,x=>x.count+' 筆',x=>(x.ac?x.ac+'｜':'')+'待回覆 '+x.pending)||empty('這天沒有等餐紀錄'))+(o.delayTiedOthers?'<p class="uo-note">另有 '+o.delayTiedOthers+' 家同筆數並列</p>':'');
  }
  function renderWait(o){E('uoWait').innerHTML=waitHtml(o);}
  function lineHtml(o){
    const lineEmpty=o.lineRegistered===0?'尚無餐廳登記劃線簽名':'已登記的餐廳都完成';
    return (o.acLine.length?o.acLine.map(x=>bar(x.name,x.rate??0,1,x.rate===null?'尚未登記':(x.rate*100).toFixed(1)+'%'+(x.missing?'（待檢查 '+x.missing+'）':''),x.rate===null?'na':x.rate>=1?'ok':'warn')).join(''):empty('沒有 AC 設定'))+
      '<h3>缺漏最多的餐廳</h3>'+(top3(o.lineWorst,x=>(x.rate*100).toFixed(1)+'%',x=>(x.ac?x.ac+'｜':'')+'已登記 '+x.count+' 次')||empty(lineEmpty));
  }
  function renderLine(o){E('uoLine').innerHTML=lineHtml(o);}
  window.UiOverview={waitHtml,lineHtml};
  async function load(){
    const id=++req,wd='日一二三四五六'[new Date(date+'T12:00:00Z').getUTCDay()];E('uoDate').textContent=date+'（'+wd+'）';E('uoTitle').textContent='T'+((window.CENTER_CONFIG&&window.CENTER_CONFIG.center)||(window.CenterBusinessConfig||{}).center||'')+' '+((window.CenterBusinessConfig||{}).centerName||'外送中心')+'｜營運成績';E('uoStatus').textContent='讀取中…';E('uoFoot').textContent='';
    try{
      const o=await window.OpsReport.overview(date,'day');if(id!==req)return;
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
    if(mode==='home'&&E('adminApp').style.display==='block'){loaded=true;date=sharedDate.get()?.date||date;load();}};
  page.style.display='block';
  new MutationObserver(()=>{if(!loaded&&E('adminApp').style.display==='block'&&page.style.display!=='none'){loaded=true;load();}}).observe(E('adminApp'),{attributes:true,attributeFilter:['style']});
  if(E('adminApp').style.display==='block'){loaded=true;load();}
})();
