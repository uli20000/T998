/* 後台外框（UI 改版第 1、4 步）：常駐側欄＋共用頂部列，後台（admin.html）與分析儀表板（analysis.html）共用。
 * 只改呈現：後台導覽一律觸發既有按鈕（保留原本的載入、權限與事件），不動資料讀寫。
 * 儀表板頁的側欄以連結回後台（admin.html#ui=<頁面>），登入後自動切到該頁。 */
(function(){
  'use strict';
  const E=id=>document.getElementById(id);
  const adminApp=E('adminApp'),dashboard=E('dashboard');
  const isAdmin=!!adminApp,isAnalysis=!isAdmin&&!!dashboard;
  if(!isAdmin&&!isAnalysis)return;
  if(document.body.dataset.uiShell)return;
  document.body.dataset.uiShell='1';
  const biz=window.CenterBusinessConfig||{};

  // mode：showAdminMode 的模式；tab：營運頁分頁（data-ops-tab）
  const NAV=[
    {key:'home',label:'總覽',ic:'🏠',mode:'home'},
    {group:'營運'},
    {key:'ops:scores',label:'每日成績',ic:'📥',mode:'ops',tab:'scores',sub:true},
    {key:'ops:delay',label:'等餐紀錄',ic:'⏱️',mode:'ops',tab:'delay',sub:true},
    {key:'ops:line',label:'劃線簽名',ic:'✍️',mode:'ops',tab:'line',sub:true},
    {key:'ops:summary',label:'報表匯出',ic:'📊',mode:'ops',tab:'summary',sub:true},
    {key:'analysis',label:'分析儀表板',ic:'📈',href:'analysis.html',sub:true},
    {group:'車隊與設備'},
    {key:'vehicle',label:'車輛／巡檢',ic:'🛵',btn:'vehicleModeBtn',sub:true},
    {key:'battery',label:'電池／紀錄器',ic:'🔋',btn:'batteryModeBtn',sub:true},
    {group:'人員'},
    {key:'roster',label:'在職名單',ic:'👥',btn:'rosterModeBtn',sub:true},
    {key:'shift',label:'指休',ic:'🗓️',btn:'shiftModeBtn',sub:true},
    {key:'defensive',label:'防禦駕駛',ic:'🛡️',btn:'defensiveModeBtn',sub:true},
    {key:'survey',label:'意向調查',ic:'📋',btn:'surveyModeBtn',sub:true},
    {group:'設定'},
    {key:'analysis:targets',label:'目標值',ic:'⚙️',href:'analysis.html#tab=targets',sub:true}
  ];
  const TITLES=Object.fromEntries(NAV.filter(n=>n.key).map(n=>[n.key,n.label]));

  // 版面：容器 > .ui-frame > [aside.ui-side, div.ui-main > (div.ui-top, div.ui-content > 原本內容)]
  const host=isAdmin?adminApp:document.body;
  const frame=document.createElement('div');frame.className='ui-frame';
  const side=document.createElement('aside');side.className='ui-side';side.setAttribute('aria-label','後台導覽');
  const main=document.createElement('div');main.className='ui-main';
  const top=document.createElement('div');top.className='ui-top';top.setAttribute('role','banner');
  const content=document.createElement('div');content.className='ui-content';
  for(const node of [...host.childNodes]){
    if(node.nodeType===1&&(node.id==='centerEnvironment'||node.tagName==='SCRIPT'))continue;
    content.appendChild(node);
  }
  const oldHeader=content.querySelector(':scope > .header, :scope > header');if(oldHeader){oldHeader.classList.add('ui-old-header');main.appendChild(oldHeader);}
  main.append(top,content);frame.append(side,main);
  const env0=E('centerEnvironment');
  if(isAdmin)host.appendChild(frame);else (env0?env0.after(frame):host.prepend(frame));
  if(isAdmin)adminApp.classList.add('ui-shell');
  document.body.classList.add('ui-shell-body',isAdmin?'ui-page-admin':'ui-page-analysis');

  const center=(window.CENTER_CONFIG&&window.CENTER_CONFIG.center)||biz.center||'';
  side.innerHTML='<div class="ui-brand"><span class="ui-logo">KFC</span><div><b>'+(biz.centerName||'外送中心')+'</b><small>T'+center+' 管理後台</small></div></div><nav class="ui-nav"></nav>';
  const nav=side.querySelector('.ui-nav');
  for(const n of NAV){
    if(n.group){const g=document.createElement('div');g.className='ui-group';g.textContent=n.group;nav.appendChild(g);continue;}
    const link=n.href||!isAdmin;
    const el=document.createElement(link?'a':'button');
    el.className='ui-item'+(n.sub?' ui-sub':'');el.dataset.uiKey=n.key;el.title=n.label;
    if(link)el.href=n.href||('admin.html#ui='+n.key);else el.type='button';
    el.innerHTML='<span class="ui-ic" aria-hidden="true">'+n.ic+'</span><span class="ui-label">'+n.label+'</span>';
    if(!link)el.addEventListener('click',()=>go(n));
    nav.appendChild(el);
  }

  const env=(window.CENTER_CONFIG&&window.CENTER_CONFIG.environment)==='test'?'<span class="ui-env">測試環境</span>':'';
  top.innerHTML='<button type="button" class="ui-collapse" aria-label="收合側欄" title="收合側欄">☰</button><span class="ui-title" id="uiPageTitle"></span><span class="ui-spacer"></span>'+env+'<button type="button" class="ui-theme" data-display-mode-toggle aria-pressed="false">☀️</button>';
  const session=E('adminSessionBar');if(session)top.appendChild(session);
  top.querySelector('.ui-collapse').addEventListener('click',()=>{
    const narrow=matchMedia('(max-width:1100px)').matches;
    frame.classList.toggle(narrow?'ui-expanded':'ui-collapsed');
  });

  // 手機（≤760px，儀表板 v2 E1）：底部三個分頁（儀表板內的工具只在頁內分頁列，不重複放）；「更多」打開完整選單，選了項目就收起
  const tabbar=document.createElement('nav');tabbar.className='ui-tabbar';tabbar.setAttribute('aria-label','手機分頁');
  const TABS=[['home','🏠','總覽',isAdmin?null:'admin.html'],['analysis','📈','儀表板',isAnalysis?null:'analysis.html'],['more','☰','更多',null]];
  tabbar.innerHTML=TABS.map(([k,ic,l,href])=>(href?'<a href="'+href+'"':'<button type="button"')+' data-tab="'+k+'"'+(k==='more'?' aria-expanded="false"':'')+'><span aria-hidden="true">'+ic+'</span>'+l+(href?'</a>':'</button>')).join('');
  frame.after(tabbar);
  const setMore=open=>{frame.classList.toggle('ui-more-open',open);tabbar.querySelector('[data-tab="more"]').setAttribute('aria-expanded',String(open));};
  tabbar.addEventListener('click',e=>{const t=e.target.closest('[data-tab]');if(!t)return;const k=t.dataset.tab;if(k==='more'){setMore(!frame.classList.contains('ui-more-open'));return;}setMore(false);if(k==='home'&&isAdmin)go(NAV[0]);});
  nav.addEventListener('click',e=>{if(e.target.closest('.ui-item'))setMore(false);});
  function mark(key){
    tabbar.querySelectorAll('[data-tab]').forEach(t=>{const on=t.dataset.tab===key;t.classList.toggle('active',on);if(t.tagName==='A'||t.dataset.tab==='home'){if(on)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current');}});
    nav.querySelectorAll('.ui-item').forEach(b=>b.classList.toggle('active',b.dataset.uiKey===key));
    const t=E('uiPageTitle');if(t)t.textContent=TITLES[key]||'';
  }
  if(isAnalysis){mark(location.hash==='#tab=targets'?'analysis:targets':'analysis');addEventListener('hashchange',()=>mark(location.hash==='#tab=targets'?'analysis:targets':'analysis'));window.UiShell={mark};return;}

  function go(n){
    if(n.mode==='home'){showAdminMode('home');return;}
    if(n.mode==='ops'){
      if(E('opsModePage').style.display!=='block')E('opsModeBtn').click();
      const tab=document.querySelector('.ops-tab[data-ops-tab="'+n.tab+'"]');if(tab)tab.click();
      mark(n.key);return;
    }
    const b=E(n.btn);if(b)b.click();
  }

  // 追蹤目前頁面：包住 showAdminMode（在所有既有包裝之後載入）
  const MODE_KEY={home:'home',vehicle:'vehicle',battery:'battery',roster:'roster',shift:'shift',defensive:'defensive',survey:'survey'};
  const original=window.showAdminMode;
  window.showAdminMode=showAdminMode=function(mode){
    original(mode);
    if(mode==='ops'){const t=document.querySelector('.ops-tab.active');mark('ops:'+(t?t.dataset.opsTab:'delay'));}
    else if(MODE_KEY[mode])mark(MODE_KEY[mode]);
  };
  document.querySelectorAll('.ops-tab').forEach(t=>t.addEventListener('click',()=>mark('ops:'+t.dataset.opsTab)));
  const shiftPage=E('shiftModePage');
  if(shiftPage)new MutationObserver(()=>{if(shiftPage.style.display==='block')mark('shift');}).observe(shiftPage,{attributes:true,attributeFilter:['style']});
  mark('home');
  const goKey=key=>{const n=NAV.find(x=>x.key===key);if(n&&!n.href)go(n);};
  window.UiShell={mark,go:goKey};

  // 從儀表板側欄回來（admin.html#ui=<頁面>）：登入流程切到總覽後，再切到該頁
  let wanted=(location.hash.match(/^#ui=([\w:]+)$/)||[])[1],until=0;
  if(wanted){
    history.replaceState(null,'',location.pathname+location.search);
    const wrapped=window.showAdminMode;
    window.showAdminMode=showAdminMode=function(mode){
      wrapped(mode);
      // 登入時 getSession 與 onAuthStateChange 可能各切一次總覽；3 秒內再被切回總覽就再導一次
      if(wanted&&mode==='home'&&adminApp.style.display==='block'){const k=wanted;if(!until)until=Date.now()+3000;if(Date.now()<=until)setTimeout(()=>goKey(k),0);else wanted=null;}
    };
  }
})();
