(function(root){
  'use strict';
  if(root.CENTER_CONFIG?.dryRun&&typeof document!=='undefined'){
    document.addEventListener('DOMContentLoaded',()=>{
      const label=document.createElement('div');
      label.id='centerEnvironment';
      label.setAttribute('role','status');
      label.textContent='T'+root.CENTER_CONFIG.center+' 正式版離線演練｜資料庫連線停用';
      document.body.prepend(label);
    });
  }
  root.CenterRuntime={
    createClient(url,key){
      const config=root.CENTER_CONFIG;
      if(config?.environment!=='production'||url!==config.supabaseUrl||key!==config.publishableKey||config.schema!=='public')
        throw new Error('正式環境設定不符，已停止連線');
      if(config.dryRun){
        const error={message:'正式版離線演練，資料庫連線停用'};
        const fail=async()=>({data:null,error});
        const query=new Proxy({},{get:(_,prop)=>prop==='then'?(resolve,reject)=>fail().then(resolve,reject):()=>query});
        return {
          from:()=>query,rpc:fail,
          auth:{getSession:async()=>({data:{session:null},error:null}),getUser:fail,signInWithPassword:fail,
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:fail},
          storage:{from:()=>({upload:fail,remove:fail,createSignedUrl:fail})},functions:{invoke:fail}
        };
      }
      if(config.productionConfirmed!==true)throw new Error('正式部署尚未確認，已停止連線');
      // 沿用 supabase-js 預設的登入儲存位置（跟各中心舊站相同），切換後不必重新登入
      return root.supabase.createClient(url,key);
    }
  };
})(typeof window!=='undefined'?window:globalThis);
