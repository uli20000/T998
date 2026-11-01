/* Original workbooks are archived before any score RPC. No retention or deletion. */
(function(root){
 'use strict';
 const bucket='t998-score-source-archive',table='t998_score_source_archives';
 async function digest(blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');}
 async function archivePair(db,items){
  if(items.length!==2||new Set(items.map(x=>x.type)).size!==2)throw Error('請選擇 ByDate 與 ByOrder');
  const ids=[];
  for(const item of items){
   if(!item.file.size||item.file.size>50*1024*1024)throw Error('單檔需介於 1 byte 與 50 MiB');
   const sha=await digest(item.file),extension=item.file.name.split('.').pop().toLowerCase();
   if(!['xlsx','xls','xlsm'].includes(extension))throw Error('不支援的檔案格式');
   const path='998/'+item.type+'/'+sha+'.'+extension;
   const existing=await db.from(table).select('*').eq('storage_path',path).maybeSingle();if(existing.error)throw Error(existing.error.message);
   // A stored hash is not enough: verify the actual private object on reuse.
   if(existing.data){const got=await db.storage.from(bucket).download(path);if(got.error)throw Error('既有封存檔無法取回');if(await digest(got.data)!==sha)throw Error('既有封存檔雜湊不符');ids.push(existing.data.id);continue;}
   const prior=await db.storage.from(bucket).download(path);
   if(prior.data){if(await digest(prior.data)!==sha)throw Error('既有物件雜湊不符');}
   else{const uploaded=await db.storage.from(bucket).upload(path,item.file,{upsert:false,contentType:item.file.type||'application/octet-stream'});if(uploaded.error)throw Error(uploaded.error.message);}
   const got=await db.storage.from(bucket).download(path);if(got.error||await digest(got.data)!==sha)throw Error('封存檔取回驗證失敗');
   const session=await db.auth.getUser();if(session.error||!session.data.user)throw Error('請重新登入');
   const row={storage_path:path,source_file:item.file.name,report_type:item.type,sha256:sha,file_size:item.file.size,period_start:item.dates[0],period_end:item.dates.at(-1),row_count:item.rows.length,uploaded_by:session.data.user.id,status:'archived'};
   const saved=await db.from(table).insert(row).select('*').single();if(saved.error)throw Error('原檔已保存，但索引未完成：'+saved.error.message);ids.push(saved.data.id);
  }
  return ids;
 }
 async function mark(db,ids,status,error){for(const id of ids){const r=await db.from(table).update({status,last_error:String(error||'').slice(0,1000)}).eq('id',id);if(r.error)throw Error(r.error.message);}}
 root.T998Archive={archivePair,mark};
})(typeof window==='undefined'?globalThis:window);
