/* 前台改版（外送員手機版）：只改呈現，不改流程與資料。
 * - 首頁：領車／還車放大，其他功能縮成兩欄
 * - 巡檢：顯示已檢查幾項（不提供「全部正常」，每項都要點）
 * - 跳窗改為頁面內提示；有未還車時附「去還車」按鈕 */
(function(){
  'use strict';
  const E=id=>document.getElementById(id);
  const menu=E('modeMenu');
  if(!menu||document.body.classList.contains('front-v2'))return;
  document.body.classList.add('front-v2');

  // 鎖定縮放：iOS Safari／LINE 內建瀏覽器不理會 user-scalable=no，另外擋雙指縮放與連點放大
  ['gesturestart','gesturechange'].forEach(t=>document.addEventListener(t,e=>e.preventDefault(),{passive:false}));
  document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
  let lastTouchEnd=0;
  document.addEventListener('touchend',e=>{const now=Date.now();if(now-lastTouchEnd<=300&&!e.target.closest('input,textarea,select'))e.preventDefault();lastTouchEnd=now;},{passive:false});

  // 首頁
  const hello=document.createElement('div');hello.className='fv-hello';hello.textContent='今天要做什麼？';
  menu.prepend(hello);
  const other=document.createElement('div');other.className='fv-other';other.textContent='其他';
  const battery=E('batteryModeBtn');if(battery)menu.insertBefore(other,battery);
  for(const [id,text] of [['claimModeBtn','上班前'],['returnModeBtn','下班＋巡檢']]){
    const b=E(id);if(b&&!b.querySelector('.fv-sub')){const s=document.createElement('span');s.className='fv-sub';s.textContent=text;b.appendChild(s);}
  }
  const syncHome=()=>document.body.classList.toggle('fv-home',getComputedStyle(menu).display!=='none');
  new MutationObserver(syncHome).observe(menu,{attributes:true,attributeFilter:['style']});syncHome();

  // 領車：6 張卡合併成兩張（人／點／車、設備／油卡），元素原樣搬移、id 不變
  const claimForm=E('claimForm');
  if(claimForm){
    const cards=[...claimForm.querySelectorAll(':scope > section.card')];
    const merge=(target,list)=>{for(const c of list){while(c.firstChild)target.appendChild(c.firstChild);c.remove();}target.classList.add('fv-merged');};
    if(cards.length>=6){merge(cards[0],cards.slice(1,3));merge(cards[3],cards.slice(4,6));}
  }
  // 還車：領車人／車牌／里程合併成一張卡（巡檢卡不動）
  const inspForm=E('inspectionForm');
  if(inspForm){
    const cards=[...inspForm.querySelectorAll(':scope > section.card')].filter(c=>!c.contains(E('checks')));
    if(cards.length>=3){for(const c of cards.slice(1,3)){while(c.firstChild)cards[0].appendChild(c.firstChild);c.remove();}cards[0].classList.add('fv-merged');}
  }

  // 固定在底部的送出鈕不能蓋住正在輸入的欄位
  document.addEventListener('focusin',e=>{
    const el=e.target;if(!el.matches||!el.matches('input,select,textarea'))return;
    setTimeout(()=>{
      for(const id of ['claimSaveBtn','saveBtn']){
        const b=E(id);if(!b||!b.offsetParent)continue;
        const br=b.getBoundingClientRect(),r=el.getBoundingClientRect();
        if(r.bottom>br.top-8&&r.top<br.bottom)window.scrollBy({top:r.bottom-br.top+16,behavior:'smooth'});
      }
    },350);
  });

  // 巡檢計數
  const checks=E('checks');
  if(checks){
    const head=document.createElement('div');head.className='fv-check-count';
    checks.before(head);
    const hint=document.createElement('p');hint.className='fv-hint';
    const save=E('saveBtn');if(save)save.after(hint);
    const update=()=>{
      const items=checks.querySelectorAll('.check-item'),done=checks.querySelectorAll('.check-item .option.selected').length,total=items.length;
      const bad=checks.querySelectorAll('.option.abnormal.selected').length;
      head.innerHTML='<span>安全檢查 '+done+'／'+total+'</span><small>每項都要點選</small>';
      hint.textContent=!total?'':done<total?'還有 '+(total-done)+' 項未檢查':bad?'有 '+bad+' 項異常，請寫說明；送出後會通知後台':total+' 項都已檢查';
    };
    new MutationObserver(update).observe(checks,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});update();
  }

  // 跳窗 → 頁面內提示
  let banner=null;
  function closeBanner(){if(banner){banner.remove();banner=null;}}
  window.alert=function(message){
    closeBanner();
    const text=String(message??'');
    const info=/完成|成功|已送出|已儲存|已登記/.test(text)&&!/失敗|錯誤|無法|請/.test(text);
    banner=document.createElement('div');banner.className='fv-banner'+(info?' fv-info':'');banner.setAttribute('role','alert');
    const title=document.createElement('b');title.textContent=info?'完成':'請注意';
    const p=document.createElement('p');p.textContent=text;
    const actions=document.createElement('div');actions.className='fv-actions';
    if(/未還車紀錄/.test(text)&&E('returnModeBtn')){
      const go=document.createElement('button');go.type='button';go.className='fv-go';go.textContent='去還車';
      go.onclick=()=>{closeBanner();const back=E('claimBackBtn');if(back)back.click();setTimeout(()=>E('returnModeBtn').click(),0);};
      actions.appendChild(go);
    }
    const ok=document.createElement('button');ok.type='button';ok.textContent='知道了';ok.onclick=closeBanner;
    actions.appendChild(ok);
    banner.append(title,p,actions);document.body.appendChild(banner);
    ok.focus({preventScroll:true});
  };
})();
