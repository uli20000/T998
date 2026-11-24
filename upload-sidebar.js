/* Current-center upload page (full content area) and queue. Files stay in this browser until removed from the queue.
 * Routes to existing importers; selecting files never writes to the server. */
(function(){
  'use strict';
  const E=id=>document.getElementById(id),side=document.querySelector('.ui-side');
  if(!side||!window.UploadRouter)return;
  const center=String(window.CENTER_CONFIG?.center||window.CenterBusinessConfig?.center||'');
  const scope=[center,window.CENTER_CONFIG?.environment,window.CENTER_CONFIG?.schema,window.CENTER_CONFIG?.supabaseUrl].join('|');
  let tab;
  try{tab=sessionStorage.getItem('upload-tab');if(!tab){tab=crypto.randomUUID();sessionStorage.setItem('upload-tab',tab);}}
  catch(e){tab=crypto.randomUUID();}
  const key=scope+'|'+tab,activeKey='upload-active|'+scope;
  const isAdmin=!!E('adminApp'),labels={scores:'每日成績',staffing:'TC／工時',bi:'BI 週 SSSG',feedback:'GES／0800／4128'};
  let queue=[],done=[],busy=false,storage;
  const doneKey='done|'+scope;
  // 獨立上傳頁：佔用主內容區（側欄、頂部列保留），不插進總覽或其他頁面。
  const frame=side.closest('.ui-frame'),main=frame.querySelector('.ui-main'),content=main.querySelector('.ui-content');
  const TYPES=[['scores','每日成績','ByDate＋ByOrder 各一份，日期範圍相同'],['staffing','TC／工時','每日 TC、實際工時，可放同一個 Excel'],['bi','BI 週 SSSG','含 SSSG%_wk 的 Power BI 週檔，可用 CSV'],['feedback','GES／0800／4128','GES 問卷、0800 客訴、4128 工單']];
  const page=document.createElement('section');page.className='us-page';page.id='fileUploadPage';page.hidden=true;page.setAttribute('aria-labelledby','usPageTitle');
  page.innerHTML='<div class="us-page-head"><button type="button" class="us-back">‹ 返回</button><h1 id="usPageTitle" tabindex="-1">檔案上傳</h1><span class="us-center">T'+center+'</span></div>'+
    '<div class="us-grid">'+
      '<section class="us-card us-pick"><h2>選擇檔案</h2><label class="us-picker"><b>＋ 選擇檔案或拖放到這裡</b><small>可一次選多個 Excel／CSV，系統依內容自動分配</small><input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" aria-label="上傳並自動分配檔案"></label>'+
        '<p class="us-message" role="status" aria-live="polite"></p>'+
        '<ul class="us-types">'+TYPES.map(([k,l,d])=>'<li data-route="'+k+'"><b>'+l+'</b><small>'+d+'</small><em></em></li>').join('')+'</ul></section>'+
      '<section class="us-card us-queue"><h2>待辦檔案</h2><p class="us-empty us-queue-empty">尚未選擇檔案</p><div class="us-list"></div><button type="button" class="us-clear" hidden>清空待辦檔案</button><div class="us-done" hidden><h3>最近已匯入</h3><ul></ul></div></section>'+
    '</div>'+
    '<section class="us-card us-workspace" id="uploadWorkspace"><h2>核對與匯入</h2><p id="uploadWorkspaceStatus" class="us-ws-status" role="status"></p><p class="us-empty us-ws-empty">在待辦檔案按「開啟核對」後，預覽比對與匯入結果會留在這裡。</p><div class="us-slot"></div></section>';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='ui-item us-trigger';
  trigger.innerHTML='<span class="ui-ic" aria-hidden="true">📤</span><span class="ui-label">檔案上傳</span>';
  trigger.setAttribute('aria-controls',page.id);trigger.setAttribute('aria-expanded','false');
  side.append(trigger);main.append(page);
  const slot=page.querySelector('.us-slot');
  // 借用既有匯入區塊（原元素、原事件）；離開上傳頁時放回原位，再進來時接回，結果一併保留。
  let borrowed=[],pageTitle='',pageActive=[];
  function attachBorrowed(){for(const b of borrowed){slot.append(b.node);if(b.reveal){b.node.hidden=false;b.node.classList.remove('hidden');}}slot.hidden=!borrowed.length;page.querySelector('.us-ws-empty').hidden=!!borrowed.length;}
  function detachBorrowed(){for(const b of borrowed){b.mark.after(b.node);b.node.hidden=b.hidden;b.node.className=b.cls;}}
  function borrow(nodes,reveal){
    detachBorrowed();for(const b of borrowed)b.mark.remove();
    borrowed=nodes.filter(Boolean).map(node=>{const mark=document.createComment('upload-page');node.before(mark);return {node,mark,hidden:node.hidden,cls:node.className,reveal};});
    attachBorrowed();
  }
  function closeMore(){frame.classList.remove('ui-more-open');document.querySelector('.ui-tabbar [data-tab="more"]')?.setAttribute('aria-expanded','false');}
  function setPage(open,{restoreTitle=true,focus=true}={}){
    if(open&&!gateOpen())return;
    if(open===!page.hidden)return;
    page.hidden=!open;main.classList.toggle('us-page-open',open);trigger.classList.toggle('active',open);trigger.setAttribute('aria-expanded',String(open));
    const title=E('uiPageTitle');
    if(open){
      pageTitle=title?.textContent||'';if(title)title.textContent='檔案上傳';
      pageActive=[...side.querySelectorAll('.ui-nav .ui-item.active')];pageActive.forEach(x=>x.classList.remove('active'));
      closeMore();attachBorrowed();scrollTo(0,0);if(focus)page.querySelector('h1').focus({preventScroll:true});
    }else{
      detachBorrowed();if(restoreTitle){if(title)title.textContent=pageTitle;pageActive.forEach(x=>x.classList.add('active'));}pageActive=[];scrollTo(0,0);
    }
  }
  trigger.onclick=()=>setPage(page.hidden);
  page.querySelector('.us-back').onclick=()=>{setPage(false);trigger.focus({preventScroll:true});};
  // 點側欄其他項目或手機分頁就離開上傳頁（標題交給外框重設）
  side.addEventListener('click',e=>{const item=e.target.closest('.ui-item');if(item&&item!==trigger&&!page.hidden)setPage(false,{restoreTitle:false});});
  document.querySelector('.ui-tabbar')?.addEventListener('click',e=>{const t=e.target.closest('[data-tab]');if(t&&t.dataset.tab!=='more'&&!page.hidden)setPage(false,{restoreTitle:t.dataset.tab!=='home'});});
  const gate=E(isAdmin?'adminApp':'dashboard');
  const gateOpen=()=>!gate.hidden&&!gate.classList.contains('hidden')&&gate.style.display!=='none';
  const syncGate=()=>{trigger.hidden=!gateOpen();if(!gateOpen())setPage(false);};syncGate();
  new MutationObserver(syncGate).observe(gate,{attributes:true,attributeFilter:['class','style','hidden']});
  const picker=page.querySelector('.us-picker input'),drop=page.querySelector('.us-picker'),message=page.querySelector('.us-message'),list=page.querySelector('.us-list'),clear=page.querySelector('.us-clear');
  function openStorage(){
    if(storage)return storage;
    storage=new Promise((resolve,reject)=>{
      const request=indexedDB.open('center-upload-queue',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('queues');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });return storage;
  }
  async function persist(value){
    const db=await openStorage();
    return new Promise((resolve,reject)=>{const tx=db.transaction('queues','readwrite');tx.objectStore('queues').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }
  async function restore(k=key){
    const db=await openStorage();
    return new Promise((resolve,reject)=>{const r=db.transaction('queues').objectStore('queues').get(k);r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
  }
  async function persistDone(value){
    const db=await openStorage();
    return new Promise((resolve,reject)=>{const tx=db.transaction('queues','readwrite');tx.objectStore('queues').put(value,doneKey);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  }
  // 匯入成功後：移出待辦、記到「最近已匯入」（本機保留最近 20 筆）
  const RESULT={staffing:['staffingImportMessage',t=>/^已匯入/.test(t)],scores:['opsScoreMessage',t=>/^完成匯入/.test(t)],
    feedback:['opsFeedbackMessage',t=>/^完成匯入/.test(t)],bi:['biStatus',t=>/已正式匯入並讀回|無重複/.test(t)&&!/失敗|不一致/.test(t)]};
  function watchResult(group){
    const [id,ok]=RESULT[group.route]||[];const node=id&&E(id);if(!node)return;
    const before=node.textContent;
    const obs=new MutationObserver(()=>{const t=node.textContent.trim();if(t===before||!ok(t))return;obs.disconnect();markDone(group,t).catch(fail);});
    obs.observe(node,{childList:true,characterData:true,subtree:true});
  }
  async function markDone(group,summary){
    const at=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
    done=[{route:group.route,names:group.items.map(x=>x.file.name),at,summary:summary.split('\n')[0].slice(0,80)},...done].slice(0,20);
    queue=queue.filter(x=>x.id!==group.id);await persist(queue);await persistDone(done);render();
    message.textContent='已匯入並移出待辦：'+group.items.map(x=>x.file.name).join('、');
  }
  function setBusy(value){busy=value;picker.disabled=value;clear.disabled=value;list.querySelectorAll('button').forEach(b=>b.disabled=value);}
  function render(){
    list.replaceChildren();clear.hidden=!queue.length;page.querySelector('.us-queue-empty').hidden=!!queue.length;
    for(const li of page.querySelectorAll('.us-types li')){const n=queue.filter(g=>!g.error&&g.route===li.dataset.route).length;li.classList.toggle('us-has',n>0);li.querySelector('em').textContent=n?'待辦 '+n+' 批':'';}
    for(const group of queue){
      const card=document.createElement('div');card.className='us-item'+(group.error?' us-error':'');
      const title=document.createElement('strong');title.textContent=labels[group.route]||'未分配';card.append(title);
      for(const item of group.items){const name=document.createElement('span');name.className='us-file';name.textContent=item.file.name;card.append(name);}
      const status=document.createElement('span');status.className='us-status';status.textContent=group.error||group.status||('T'+center+'・已分配，待核對');card.append(status);
      const actions=document.createElement('div');actions.className='us-actions';
      if(!group.error){const button=document.createElement('button');button.type='button';button.className='us-open';button.textContent=group.route==='bi'?'開啟核對／確認匯入':'開啟核對';button.onclick=()=>activate(group).catch(fail);actions.append(button);}
      const remove=document.createElement('button');remove.type='button';remove.textContent='移除待辦';remove.onclick=async()=>{
        if(importBusy()){message.textContent='匯入處理中，請等候結果後再移除。';return;}
        const next=queue.filter(x=>x.id!==group.id);try{await persist(next);queue=next;render();}catch(e){fail(e);}
      };actions.append(remove);card.append(actions);list.append(card);
    }
    const box=page.querySelector('.us-done'),ul=box.querySelector('ul');ul.replaceChildren();box.hidden=!done.length;
    for(const d of done){const li=document.createElement('li');li.textContent=d.at+'｜'+(labels[d.route]||'')+'｜'+d.names.join('、')+'｜'+d.summary;ul.append(li);}
    setBusy(busy);
  }
  function fail(e){message.textContent='處理失敗：'+(e.message||e)+'；原檔保留，請重試。';if(gateOpen())setPage(true,{focus:false});}
  function importBusy(){return ['opsScoreFiles','biFiles'].some(id=>E(id)?.disabled)||E('staffingImportBtn')?.disabled===true||/^(讀取與篩選|匯入資料中|匯入中)/.test(E('opsFeedbackMessage')?.textContent||'');}
  async function selectFiles(files){
    if(busy)return;
    if(importBusy()){message.textContent='目前正在核對或匯入，請等候結果後再選檔。';return;}
    setBusy(true);message.textContent='辨識檔案內容中…';
    try{
      if(!window.XLSX)throw new Error('Excel 元件尚未載入，請重新整理');
      const items=queue.flatMap(g=>g.items),seen=new Set(items.map(x=>x.hash));
      for(const file of files){
        let item={file};
        try{
          if(!/\.(xlsx|xls|xlsm|csv)$/i.test(file.name))throw new Error('不支援這種檔案格式');
          const bytes=await file.arrayBuffer();
          item.hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
          if(seen.has(item.hash))continue;seen.add(item.hash);
          const book=XLSX.read(bytes,{type:'array',cellDates:true});
          const sheets=book.SheetNames.map(name=>({name,matrix:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:true})}));
          Object.assign(item,UploadRouter.classify(sheets));
          if(item.centers.length&&item.centers.some(c=>c!==center))throw new Error('檔案標示中心 '+item.centers.join('／')+'，與目前 T'+center+' 不符');
          if(item.route!=='bi'&&/\.csv$/i.test(file.name))throw new Error('此匯入流程需要 Excel，請匯出為 .xlsx');
        }catch(e){item.error=e.message||'檔案無法讀取';}
        items.push(item);
      }
      const next=UploadRouter.groups(items).map(g=>({...g,id:crypto.randomUUID()}));
      await persist(next);queue=next;render();
      const errors=queue.filter(x=>x.error).length;
      message.textContent='T'+center+'｜已分配 '+queue.filter(x=>!x.error).length+' 批'+(errors?'，'+errors+' 批待處理':'')+'；請開啟核對。';
    }catch(e){fail(e);}finally{picker.value='';setBusy(false);}
  }
  picker.addEventListener('change',()=>selectFiles([...picker.files]));
  for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();if(!busy)drop.classList.add('us-drag');});
  for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('us-drag');});
  drop.addEventListener('drop',e=>selectFiles([...(e.dataTransfer?.files||[])]));
  clear.onclick=async()=>{if(importBusy()){message.textContent='匯入處理中，請等候結果。';return;}try{await persist([]);queue=[];render();message.textContent='待辦已清空。';}catch(e){fail(e);}};
  function sendFiles(input,items,dispatch=true){
    if(!input)throw new Error('找不到匯入入口');
    if(input.disabled)throw new Error('匯入入口正在處理，請稍後再試');
    const dt=new DataTransfer();for(const item of items){const f=item.file;dt.items.add(f instanceof File?f:new File([f],f.name,{type:f.type,lastModified:f.lastModified}));}
    input.files=dt.files;if(dispatch)input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function reveal(node){
    for(let p=node?.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
    node?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function activate(group){
    if(busy||importBusy())throw new Error('有檔案正在處理，請稍後再試');
    if(!gateOpen())throw new Error('請先登入後台');
    setBusy(true);
    try{await openGroup(group);}finally{setBusy(false);}
  }
  async function openGroup(group){
    const adminRoute=['scores','staffing'].includes(group.route);
    if(adminRoute!==isAdmin){
      await persist(queue);sessionStorage.setItem(activeKey,group.id);
      location.href=adminRoute?'admin.html':'analysis.html';return;
    }
    setPage(true,{focus:false});
    const workspace=E('uploadWorkspace'),files='T'+center+'｜'+labels[group.route]+'｜'+group.items.map(x=>x.file.name).join('、');
    if(isAdmin){
      const input=E(group.route==='scores'?'opsScoreFiles':'staffingImportFile');
      borrow([input.closest(group.route==='scores'?'.ops-upload-block':'.staffing-panel')],false);
      E('uploadWorkspaceStatus').textContent=files;
      sendFiles(input,group.items,group.route!=='scores');
      if(group.route==='scores')await window.UploadImportAdapters.prepareScores();
    }else{
      // Reuse the real controls in the upload page, independent of report loading.
      const footer=E(group.route==='bi'?'biUploadFooter':'feedbackUploadFooter');
      borrow([footer],true);
      const input=E(group.route==='bi'?'biFiles':'opsFeedbackFiles');
      sendFiles(input,group.items,false);
      if(group.route==='feedback')await window.UploadImportAdapters.prepareFeedback();
      E('uploadWorkspaceStatus').textContent=files;
      if(group.route==='bi'){
        let button=E('uploadBiConfirm');
        if(!button){button=document.createElement('button');button.id='uploadBiConfirm';button.type='button';button.className='bi-upload-button';button.textContent='確認匯入 BI 週檔';footer.prepend(button);
        button.onclick=async()=>{button.disabled=true;setBusy(true);try{await input.onchange();}finally{setBusy(false);button.disabled=false;}};}
        E('biStatus').textContent='已分配到 BI 週 SSSG；尚未匯入。請確認目前中心與來源檔案，再按確認匯入。';
        E('biPreview').replaceChildren();
      }
    }
    reveal(workspace);watchResult(group);
    group.status='已開啟核對；預覽與結果在「核對與匯入」';await persist(queue);render();
  }
  // Resume a destination only after the existing sign-in gate has opened.
  async function start(){
    try{
      queue=await restore();try{done=await restore(doneKey);}catch(e){done=[];}
      // Recheck files rejected by the previous mixed-format classifier after this update.
      if(queue.some(g=>g.items.some(i=>i.error?.includes('同檔含多種匯入格式')))){
        const retryFiles=queue.flatMap(g=>g.items.map(i=>i.file));queue=[];await selectFiles(retryFiles);
      }
      render();message.textContent='T'+center+'｜自動分配至目前中心';
      const wanted=sessionStorage.getItem(activeKey);if(!wanted)return;
      const group=queue.find(x=>x.id===wanted);if(!group)return;
      const gate=E(isAdmin?'adminApp':'dashboard');
      const resume=()=>{if(gate.hidden||gate.classList.contains('hidden')||gate.style.display==='none')return false;
        sessionStorage.removeItem(activeKey);activate(group).catch(fail);return true;};
      if(!resume()){const observer=new MutationObserver(()=>{if(resume())observer.disconnect();});observer.observe(gate,{attributes:true,attributeFilter:['class','style','hidden']});}
    }catch(e){message.textContent='無法保存待辦檔案：'+(e.message||e)+'。請使用原本的匯入入口。';picker.disabled=true;}
  }
  start();
})();
