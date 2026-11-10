/* 營運頁（UI 改版第 3 步）：等餐、劃線簽名頁頂部加「依 AC」橫條與前三名餐廳。
 * 數字取自 OpsReport.overview（與匯總資料同一套計算），日期與期間跟營運頁日期控制同步。 */
(function(){
  'use strict';
  const E=id=>document.getElementById(id);
  if(!window.OpsReport?.overview||!window.UiOverview||!E('opsDelayPanel'))return;
  const blocks={delay:document.createElement('section'),line:document.createElement('section')};
  blocks.delay.className=blocks.line.className='uo-card ui-ops-ac';
  blocks.delay.innerHTML='<h2>等餐（依 AC）</h2><div class="ui-ops-body"></div>';
  blocks.line.innerHTML='<h2>劃線簽名（依 AC）</h2><div class="ui-ops-body"></div>';
  E('opsDelayPanel').prepend(blocks.delay);E('opsLinePanel').prepend(blocks.line);
  let req=0;
  async function refresh(){
    const tab=document.querySelector('.ops-tab.active')?.dataset.opsTab;
    if(E('opsModePage').style.display!=='block'||!blocks[tab])return;
    const dc=window.OpsDateControl||{},id=++req,body=blocks[tab].querySelector('.ui-ops-body');
    body.innerHTML='<p class="uo-empty">讀取中…</p>';
    try{const o=await window.OpsReport.overview(dc.date||opsToday(),dc.period||'day');if(id!==req)return;
      body.innerHTML=tab==='delay'?window.UiOverview.waitHtml(o):window.UiOverview.lineHtml(o);}
    catch(e){if(id===req)body.innerHTML='<p class="uo-empty">讀取失敗：'+(e.message||e)+'</p>';}
  }
  document.querySelectorAll('.ops-tab').forEach(t=>t.addEventListener('click',()=>setTimeout(refresh,0)));
  const dc=window.OpsDateControl;
  if(dc&&typeof dc.set==='function'){const set=dc.set.bind(dc);dc.set=function(...a){const r=set(...a);setTimeout(refresh,0);return r;};}
  const original=window.showAdminMode;
  window.showAdminMode=showAdminMode=function(mode){original(mode);if(mode==='ops')setTimeout(refresh,0);};

  // 篩選列：AC（等餐、劃線）＋狀態（等餐）。只隱藏畫面上的列，不改資料與既有查詢。
  const acs=()=>{const M=window.OpsMetrics,d=(window.OpsDateControl||{}).date||opsToday();return M&&M.acAssignmentsForDate?M.acAssignmentsForDate(d):((window.CenterBusinessConfig||{}).acAssignments||[]);};
  function filterBar(listId,codeCell,withStatus){
    const list=E(listId);if(!list)return;
    const bar=document.createElement('div');bar.className='ui-filter-bar';
    bar.innerHTML='<label>AC<select data-f="ac"><option value="">全部 AC</option></select></label>'+(withStatus?'<label>狀態<select data-f="st"><option value="">全部狀態</option><option>待回覆</option><option>已回覆</option></select></label>':'')+'<span class="ui-filter-count"></span>';
    list.before(bar);
    const acSel=bar.querySelector('[data-f=ac]'),stSel=bar.querySelector('[data-f=st]'),count=bar.querySelector('.ui-filter-count');
    const fillAc=()=>{const cur=acSel.value;acSel.innerHTML='<option value="">全部 AC</option>'+acs().map(a=>'<option>'+a.name+'</option>').join('');acSel.value=cur;};
    function apply(){
      const ac=acSel.value?new Set((acs().find(a=>a.name===acSel.value)||{stores:[]}).stores):null,st=stSel?stSel.value:'';
      let shown=0,total=0;
      list.querySelectorAll('tbody tr').forEach(tr=>{
        const cells=tr.querySelectorAll('td');if(!cells.length)return;total++;
        const code=((cells[codeCell]?.textContent||'').trim().match(/^[\w-]+/)||[''])[0];
        const ok=(!ac||ac.has(code))&&(!st||tr.textContent.includes(st));
        tr.hidden=!ok;if(ok)shown++;
      });
      count.textContent=(ac||st)&&total?'顯示 '+shown+'／'+total+' 筆':'';
    }
    fillAc();bar.addEventListener('change',apply);
    new MutationObserver(()=>{fillAc();apply();}).observe(list,{childList:true});
  }
  filterBar('opsDelayList',1,true);
  filterBar('opsLineList',0,false);

  // 成績匯入：拖放上傳（等同選檔，交給原本的檢查流程）＋最近匯入紀錄
  const fileInput=E('opsScoreFiles'),upload=document.querySelector('#opsScoresPanel .ops-upload-block');
  if(fileInput&&upload){
    upload.classList.add('ui-dropzone');
    const tip=document.createElement('p');tip.className='ui-drop-tip';tip.textContent='也可以把 BY ORDER、BY DATE 兩個 Excel 一起拖到這裡';
    upload.querySelector('.ops-score-upload')?.after(tip);
    ['dragenter','dragover'].forEach(t=>upload.addEventListener(t,e=>{e.preventDefault();if(!fileInput.disabled)upload.classList.add('ui-drag');}));
    ['dragleave','drop'].forEach(t=>upload.addEventListener(t,e=>{e.preventDefault();upload.classList.remove('ui-drag');}));
    upload.addEventListener('drop',e=>{
      if(fileInput.disabled||!e.dataTransfer?.files?.length)return;
      fileInput.files=e.dataTransfer.files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));
    });
    // 預設收起，標題列只顯示最新一筆；點開看最近 10 筆
    const hist=document.createElement('details');hist.className='uo-card ui-import-history';
    hist.innerHTML='<summary><h2>最近匯入紀錄</h2><span class="ui-hist-latest">讀取中…</span></summary><div class="ui-hist-body"><p class="uo-empty">讀取中…</p></div>';
    upload.after(hist);
    const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function loadHistory(){
      const r=await db.from('t998_score_import_batches').select('report_date,report_type,source_file,row_count,imported_at').order('imported_at',{ascending:false}).limit(10);
      const body=hist.querySelector('.ui-hist-body');
      const latest=hist.querySelector('.ui-hist-latest');
      if(r.error){latest.textContent='讀取失敗';body.innerHTML='<p class="uo-empty">讀取失敗：'+esc(r.error.message)+'</p>';return;}
      const top=r.data[0];latest.textContent=top?'最新：'+top.report_date+' '+top.report_type+'（'+(top.imported_at?fmt(top.imported_at):'—')+' 匯入）':'尚無匯入紀錄';
      body.innerHTML=r.data.length?'<table class="ui-table"><thead><tr><th>成績日</th><th>類型</th><th class="num">筆數</th><th>檔名</th><th>匯入時間</th></tr></thead><tbody>'+r.data.map(x=>'<tr><td>'+esc(x.report_date)+'</td><td>'+esc(x.report_type)+'</td><td class="num">'+esc(x.row_count)+'</td><td>'+esc(x.source_file)+'</td><td>'+esc(x.imported_at?fmt(x.imported_at):'—')+'</td></tr>').join('')+'</tbody></table>':'<p class="uo-empty">尚無匯入紀錄</p>';
    }
    document.querySelector('.ops-tab[data-ops-tab="scores"]')?.addEventListener('click',()=>setTimeout(loadHistory,0));
    new MutationObserver(()=>{if(/完成匯入/.test(E('opsScoreMessage')?.textContent||''))loadHistory();}).observe(E('opsScoreMessage'),{childList:true,characterData:true,subtree:true});
  }

  // 等餐：點一列 → 右側抽屜顯示明細與回覆歷史（唯讀；刪除、退回仍用列上的按鈕）
  const drawer=document.createElement('aside');drawer.className='ui-drawer';drawer.setAttribute('aria-label','等餐明細');drawer.hidden=true;
  drawer.innerHTML='<div class="ui-drawer-head"><b>等餐明細</b><button type="button" class="ui-drawer-close" aria-label="關閉">✕</button></div><div class="ui-drawer-body"></div>';
  document.body.appendChild(drawer);
  const dEsc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dTime=v=>v?fmt(v):'—';
  const revisionsEnabled=window.CENTER_CONFIG?.features?.adminReturnReplies===true;
  drawer.querySelector('.ui-drawer-close').onclick=()=>{drawer.hidden=true;};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')drawer.hidden=true;});
  E('opsDelayList')?.addEventListener('click',async e=>{
    if(e.target.closest('button,a,input,select'))return;
    const tr=e.target.closest('tbody tr'),id=tr?.querySelector('[data-delete-delay]')?.dataset.deleteDelay;if(!id)return;
    const body=drawer.querySelector('.ui-drawer-body');drawer.hidden=false;body.innerHTML='<p class="uo-empty">讀取中…</p>';
    const [o,h]=await Promise.all([db.from('t998_delay_orders').select('record_date,store_code,restaurant_name,order_number,status,reason,created_at,responded_at').eq('id',id).maybeSingle(),
      // 退回歷史只在「回覆退回」功能啟用的中心才有資料表；未啟用就不讀也不顯示
      revisionsEnabled?db.from('delay_reply_revisions').select('revision_no,prior_reason,prior_responded_at,return_reason,returned_at').eq('delay_order_id',id).order('revision_no',{ascending:false}):Promise.resolve(null)]);
    if(o.error||!o.data){body.innerHTML='<p class="uo-empty">讀取失敗：'+dEsc(o.error?.message||'查無資料')+'</p>';return;}
    const x=o.data,row=(k,v)=>'<div class="ui-kv"><span>'+k+'</span><b>'+dEsc(v)+'</b></div>';
    body.innerHTML=row('日期',x.record_date)+row('餐廳',x.store_code+' '+x.restaurant_name)+row('訂單編號',x.order_number)+row('狀態',x.status==='completed'?'已回覆':'待回覆')+row('登記時間',dTime(x.created_at))+row('回覆時間',dTime(x.responded_at))+
      '<h3>目前回覆</h3><p class="ui-reason">'+dEsc(x.reason||'尚未回覆')+'</p>'+(h===null?'':'<h3>退回歷史</h3>'+
      (h.error?'<p class="uo-empty">無法讀取歷史：'+dEsc(h.error.message)+'</p>':h.data?.length?h.data.map(r=>'<div class="ui-rev"><b>第 '+r.revision_no+' 版（'+dTime(r.returned_at)+' 退回）</b><p>原回覆：'+dEsc(r.prior_reason)+'</p><p>退回原因：'+dEsc(r.return_reason)+'</p></div>').join(''):'<p class="uo-empty">沒有退回紀錄</p>'));
  });
})();
