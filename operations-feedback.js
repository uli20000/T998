(function(){
  'use strict';
  const $=id=>document.getElementById(id),db=window.t998SupabaseClient;
  if(!db)return;
  const prepared=[];let cachedStores;const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const text=v=>v instanceof Date?opsIsoDate(v):String(v??'').trim();
  function opsIsoDate(value){
    if(value instanceof Date&&!Number.isNaN(value.getTime())){const d=new Date(value.getTime()-value.getTimezoneOffset()*60000);return d.toISOString().slice(0,10);}
    if(typeof value==='number'&&window.XLSX?.SSF?.parse_date_code){const d=XLSX.SSF.parse_date_code(value);if(d?.y&&d?.m&&d?.d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
    const s=String(value??'').trim();let m=s.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m=s.match(/^(20\d{2})年(\d{1,2})月(\d{1,2})日?/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    return '';
  }
  function percentage(value){if(value===null||value===undefined||value==='')return null;if(typeof value==='number')return value>1?value/100:value;const s=String(value).trim();const n=Number(s.replace('%',''));return Number.isFinite(n)?(s.includes('%')||n>1?n/100:n):null;}
  function indexOf(headers,...names){for(const name of names){const i=headers.findIndex(h=>clean(h)===clean(name));if(i>=0)return i;}return -1;}
  function nonempty(rows){return rows.filter(r=>r.some(v=>v!==''&&v!==null&&v!==undefined));}
  function keyParts(parts){return parts.map(x=>clean(x).slice(0,500)).join('|');}
  async function stableHash(parts){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parts.map(x=>clean(x)).join('|')));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function restaurantDirectoryMap(rows){return {byName:new Map(rows.map(x=>[clean(x.restaurant_name),x])),byCode:new Map(rows.map(x=>[String(x.store_code),x]))};}
  async function restaurantDirectory(){if(cachedStores)return cachedStores;const {data,error}=await db.from('t998_restaurants').select('store_code,restaurant_name').eq('enabled',true);if(error)throw error;cachedStores=restaurantDirectoryMap(data||[]);return cachedStores;}
  function rowRecord(type,sourceKey,file,fields){return {source_type:type,source_key:String(sourceKey),source_file:file.name.slice(0,255),...fields,raw_fields:fields.raw_fields||{},imported_at:new Date().toISOString()};}
  async function parse0800(matrix,file){
    const headerRow=matrix.findIndex(row=>row.some(x=>clean(x)==='日期')&&row.some(x=>clean(x)==='建議種類')&&row.some(x=>clean(x)==='被抱怨型態'));
    if(headerRow<0)throw new Error('找不到 0800 欄位列（日期／建議種類／被抱怨型態）。');
    const headers=matrix[headerRow].map(clean),ix={date:indexOf(headers,'日期'),channel:indexOf(headers,'來源'),kind:indexOf(headers,'建議種類'),type:indexOf(headers,'被抱怨型態'),topic:indexOf(headers,'重點'),item1:indexOf(headers,'項目1'),item2:indexOf(headers,'項目2'),area:indexOf(headers,'區域'),manager:indexOf(headers,'區經理'),invoice:indexOf(headers,'發票號碼'),restaurant:indexOf(headers,'餐廳'),content:indexOf(headers,'顧客回饋內容'),follow:indexOf(headers,'是否- 完成跟進報告','是否-\n完成跟進報告','是否-完成跟進報告'),work:indexOf(headers,'工作單號')};
    if(ix.restaurant<0||ix.content<0)throw new Error('0800 檔缺少餐廳或顧客回饋內容欄。');
    const out=[],directory=await restaurantDirectory();
    for(const [offset,cells] of matrix.slice(headerRow+1).entries()){
      const get=k=>ix[k]>=0?cells[ix[k]]:'';
      const kind=clean(get('kind')),complaintType=clean(get('type')),area=clean(get('area')),restaurant=clean(get('restaurant'));
      if(kind!=='抱怨'||!['網路外送','外送'].includes(complaintType)||!(directory.byName.has(restaurant)||restaurant==='台南外送中心'))continue;
      const recordDate=opsIsoDate(get('date'));if(!recordDate)continue;
      const row={source_row:headerRow+offset+2,record_date:recordDate,area_name:area,restaurant_name:restaurant,source_channel:clean(get('channel')),feedback_kind:kind,complaint_type:complaintType,main_topic:clean(get('topic')),item_1:clean(get('item1')),item_2:clean(get('item2')),content:String(get('content')??'').trim(),invoice_number:clean(get('invoice')),work_order:clean(get('work')),followup_status:clean(get('follow')),raw_fields:Object.fromEntries(headers.map((h,i)=>[h||`欄位${i+1}`,cells[i] instanceof Date?opsIsoDate(cells[i]):cells[i]??'']))};
      const caseKey=row.work_order?`work:${row.work_order}:${row.main_topic}:${row.item_1}:${row.item_2}`:`hash:${await stableHash([recordDate,row.invoice_number,restaurant,row.main_topic,row.item_1,row.item_2,row.content])}`;
      out.push(rowRecord('0800',caseKey,file,row));
    }
    if(!out.length)throw new Error('此 0800 檔沒有符合條件的資料：抱怨＋外送＋998 餐廳或台南外送中心。');
    return out;
  }
  async function parse4128(matrix,file,stores){
    const headerRow=matrix.findIndex(row=>row.some(x=>clean(x)==='訂單編號')&&row.some(x=>clean(x)==='餐廳')&&row.some(x=>clean(x)==='工作單號'));
    if(headerRow<0)throw new Error('找不到 4128 欄位列（訂單編號／餐廳／工作單號）。');
    const headers=matrix[headerRow].map(clean),ix={date:indexOf(headers,'日期'),channel:indexOf(headers,'來源'),kind:indexOf(headers,'建議種類'),type:indexOf(headers,'被抱怨型態'),area:indexOf(headers,'區域'),manager:indexOf(headers,'區經理'),order:indexOf(headers,'訂單編號'),restaurant:indexOf(headers,'餐廳'),content:indexOf(headers,'顧客回饋內容'),follow:indexOf(headers,'是否- 完成跟進報告','是否-\n完成跟進報告','是否-完成跟進報告'),work:indexOf(headers,'工作單號')};
    const out=[];
    for(const [offset,cells] of matrix.slice(headerRow+1).entries()){
      const get=k=>ix[k]>=0?cells[ix[k]]:'';
      const sourceRestaurant=clean(get('restaurant'));if(!(sourceRestaurant==='台南外送中心'))continue;
      const recordDate=opsIsoDate(get('date')),orderNumber=clean(get('order')),storeCode=(orderNumber.match(/^(\d{3})/)||[])[1]||'';
      if(!recordDate||!storeCode)continue;
      const store=stores.byCode.get(storeCode),restaurantName=store?.restaurant_name||`未配對店號 ${storeCode}`;
      const row={source_row:headerRow+offset+2,record_date:recordDate,area_name:clean(get('area'))||'外送中心',store_code:storeCode,restaurant_name:restaurantName,source_channel:clean(get('channel')),feedback_kind:clean(get('kind')),complaint_type:clean(get('type')),content:String(get('content')??'').trim(),order_number:orderNumber,work_order:clean(get('work')),followup_status:clean(get('follow')),raw_fields:Object.fromEntries(headers.map((h,i)=>[h||`欄位${i+1}`,cells[i] instanceof Date?opsIsoDate(cells[i]):cells[i]??'']))};
      out.push(rowRecord('4128',keyParts([recordDate,orderNumber,row.work_order]),file,row));
    }
    if(!out.length)throw new Error('此 4128 檔沒有台南外送中心且可辨識前三碼店號的資料。');
    return out;
  }
  function parseGes(matrix,file,stores){
    const filterText=matrix.slice(0,16).map(row=>row.map(x=>String(x??'')).join(' ')).join(' ');
    if(!/服務方式\s*:\s*Delivery/i.test(filterText))throw new Error('GES 檔的服務方式不是 Delivery，未匯入。');
    const dateMatch=filterText.match(/日期範圍\s*:\s*(20\d{2})年(\d{1,2})月(\d{1,2})日?\s*至\s*(20\d{2})年(\d{1,2})月(\d{1,2})日?/);
    if(!dateMatch)throw new Error('GES 檔找不到日期範圍；請使用含「日期範圍」的匯出檔。');
    const start=`${dateMatch[1]}-${String(dateMatch[2]).padStart(2,'0')}-${String(dateMatch[3]).padStart(2,'0')}`,end=`${dateMatch[4]}-${String(dateMatch[5]).padStart(2,'0')}-${String(dateMatch[6]).padStart(2,'0')}`;
    const headerRow=matrix.findIndex(row=>row.some(x=>clean(x)==='餐廳')&&row.some(x=>clean(x)==='# 回應數')&&row.some(x=>clean(x)==='問卷 OSAT'));
    if(headerRow<0)throw new Error('找不到 GES 餐廳／回應數／問卷 OSAT 欄位。');
    const headers=matrix[headerRow].map(clean),ix={restaurant:indexOf(headers,'餐廳'),count:indexOf(headers,'# 回應數'),one:indexOf(headers,'1SAT'),survey:indexOf(headers,'問卷 OSAT'),google:indexOf(headers,'Google OSAT'),delivery:indexOf(headers,'外送平台 OSAT'),accuracy:indexOf(headers,'餐點正確性'),environment:indexOf(headers,'整體餐廳環境'),service:indexOf(headers,'服務'),speed:indexOf(headers,'服務速度'),food:indexOf(headers,'餐點好吃度')};
    const out=[];
    for(const cells of nonempty(matrix.slice(headerRow+1))){
      const restaurant=clean(cells[ix.restaurant]);if(!restaurant)continue;
      const store=stores.byName.get(restaurant);if(!store)continue;const row={period_start:start,period_end:end,restaurant_name:restaurant,store_code:store?.store_code||'',response_count:Number(cells[ix.count])||0,score_1sat:percentage(cells[ix.one]),osat_survey:percentage(cells[ix.survey]),osat_google:percentage(cells[ix.google]),osat_delivery:percentage(cells[ix.delivery]),score_accuracy:percentage(cells[ix.accuracy]),score_environment:percentage(cells[ix.environment]),score_service:percentage(cells[ix.service]),score_speed:percentage(cells[ix.speed]),score_food:percentage(cells[ix.food]),raw_fields:Object.fromEntries(headers.map((h,i)=>[h||`欄位${i+1}`,cells[i]??'']))};
      out.push(rowRecord('GES',keyParts([start,end,restaurant]),file,row));
    }
    if(!out.length)throw new Error('GES 檔沒有餐廳彙總列。');
    return out;
  }
  async function parseFile(file){
    if(!window.XLSX)throw new Error('Excel 元件尚未載入，請重新整理後再試。');
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});if(!workbook.SheetNames.length)throw new Error('活頁簿沒有工作表。');
    const all=[];for(const sheetName of workbook.SheetNames){const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});if(matrix.length)all.push({sheetName,matrix});}
    const flat=all.flatMap(x=>x.matrix);let rows,type;
    const stores=await restaurantDirectory();
    if(flat.some(r=>r.some(x=>clean(x)==='訂單編號')&&r.some(x=>clean(x)==='工作單號'))){type='4128';rows=await parse4128(flat,file,stores);}
    else if(flat.some(r=>r.some(x=>clean(x)==='建議種類')&&r.some(x=>clean(x)==='被抱怨型態')&&r.some(x=>clean(x)==='重點')&&r.some(x=>clean(x)==='項目1'))){type='0800';rows=await parse0800(flat,file);}
    else if(flat.some(r=>r.some(x=>clean(x)==='問卷 OSAT')&&r.some(x=>clean(x)==='# 回應數'))){type='GES';rows=parseGes(flat,file,stores);}
    else throw new Error('無法辨識檔案類型；請選 0800、4128 或 GES 格式。');
    const uniq=new Map(rows.map(r=>[r.source_type+'|'+r.source_key,r]));rows=[...uniq.values()];
    const start=rows.map(r=>r.record_date||r.period_start).filter(Boolean).sort()[0],end=rows.map(r=>r.record_date||r.period_end).filter(Boolean).sort().at(-1);
    return {file,type,rows,start,end,unmapped:rows.filter(r=>r.source_type==='4128'&&r.restaurant_name.startsWith('未配對店號')).length};
  }
  function render(errors=[]){
    const rows=[...prepared.map(x=>({file:x.file.name,type:x.type,period:x.start===x.end?x.start:`${x.start}～${x.end}`,count:x.rows.length,unmapped:x.unmapped,status:'待匯入'})),...errors.map(x=>({file:x.file,type:'—',period:'—',count:'—',unmapped:'—',status:x.error}))];
    $('opsFeedbackPreview').innerHTML=rows.length?'<table class="ops-table"><thead><tr><th>檔案</th><th>類型</th><th>日期／期間</th><th>符合篩選筆數</th><th>未配對店號</th><th>狀態</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+escape(x.file)+'</td><td>'+escape(x.type)+'</td><td>'+escape(x.period)+'</td><td>'+escape(x.count)+'</td><td>'+escape(x.unmapped)+'</td><td>'+escape(x.status)+'</td></tr>').join('')+'</tbody></table>':'';
    $('opsFeedbackImport').disabled=!prepared.length;
  }
  document.addEventListener('change',async event=>{
    const root=event.target.closest('#opsFeedbackFiles');if(!root)return;
    prepared.length=0;$('opsFeedbackImport').disabled=true;$('opsFeedbackMessage').textContent='讀取與篩選檔案中…';const errors=[];
    for(const file of [...(root.files||[])])try{prepared.push(await parseFile(file));}catch(e){errors.push({file:file.name,error:e.message||'無法讀取'});}
    render(errors);$('opsFeedbackMessage').textContent=errors.length?`完成辨識；${errors.length} 個檔案未匯入。`:prepared.length?`已辨識 ${prepared.length} 個檔案，共 ${prepared.reduce((n,x)=>n+x.rows.length,0)} 筆符合條件資料。`:'請選取 0800、4128 或 GES Excel 檔案。';
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('#opsFeedbackImport');if(!button||!prepared.length)return;const root=$('opsFeedbackFiles');if(!root)return;$('opsFeedbackImport').disabled=true;$('opsFeedbackMessage').textContent='匯入資料中…';let done=0,total=prepared.reduce((n,x)=>n+x.rows.length,0);
    try{
      for(const batch of prepared){
        for(let i=0;i<batch.rows.length;i+=150){const rows=batch.rows.slice(i,i+150),result=await db.from('t998_feedback_import_rows').upsert(rows,{onConflict:'source_type,source_key'});if(result.error)throw new Error(`${batch.file.name}：${result.error.message}`);done+=rows.length;$('opsFeedbackMessage').textContent=`匯入中 ${done.toLocaleString()}／${total.toLocaleString()} 筆`;
        }
      }
      $('opsFeedbackMessage').textContent=`完成匯入 ${done.toLocaleString()} 筆篩選資料；重複鍵值已更新。`;
      prepared.length=0;root.value='';render();
    }catch(e){$('opsFeedbackMessage').textContent='匯入中止：'+(e.message||'請檢查登入狀態與資料庫 migration')+'；重新上傳同檔可更新已匯入資料。';}
    finally{const currentButton=$('opsFeedbackImport');if(currentButton)currentButton.disabled=!prepared.length;}
  });
})();
