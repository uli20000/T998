/* Only identifies destinations. No database access or writes. */
(function(root){
  'use strict';
  const clean=v=>String(v??'').trim().replace(/\s+/g,' ');
  const centers={'995':'桃園','996':'台中','998':'台南','981':'高雄','994':'新北','997':'台北'};
  function classify(sheets){
    const hits=new Set(),sourceCenters=new Set(),dates=new Set();
    for(const {matrix} of sheets){
      for(const row of matrix){
        const cells=row.map(clean),has=(...keys)=>keys.every(k=>cells.includes(k));
        if(has('訂單號碼','QT')&&cells.some(x=>x.includes('門市名稱／代號')))hits.add('ByDate');
        if(cells.some(x=>x.toLowerCase()==='reg order id')&&has('落單時間','D25'))hits.add('ByOrder');
        if(has('STR_SN','SSSG%_wk'))hits.add('BI');
        if(has('訂單編號','工作單號','餐廳'))hits.add('4128');
        if(has('建議種類','被抱怨型態','重點','項目1'))hits.add('0800');
        if(has('問卷 OSAT','# 回應數','餐廳'))hits.add('GES');
        const store=['STR_SN','餐廳','餐廳名稱','CenterName','中心名稱','中心'].some(x=>cells.includes(x));
        if(store&&['DATE','日期','Date'].some(x=>cells.includes(x))){
          if(['實際外送TC','今年TC','今年 TC','TC(System)','TC (System)','總TC','T_C','TC','去年單數','去年TC','去年 TC','扣除第三方TC','扣除第三方 TC','扣除第三方'].some(x=>cells.includes(x)))hits.add('TC');
          if(['實際總工時','實際工時','實際安排工時','實際使用工時','使用工時','工時','實際TPLH','實際 TPLH','TPLH','實際TPLH (FA)','實際 TPLH (FA)','第三方使用率','第三方使用率%','第三方使用率 %','FA使用率%','第三方率'].some(x=>cells.includes(x)))hits.add('actuals');
        }
      }
      // Center evidence is restricted to explicit center columns; a restaurant name is not a center.
      const header=matrix.findIndex(row=>row.some(x=>['RC','CenterName','中心名稱','中心'].includes(clean(x))));
      if(header>=0){
        const indexes=matrix[header].map((v,i)=>['RC','CenterName','中心名稱','中心'].includes(clean(v))?i:-1).filter(i=>i>=0);
        for(const row of matrix.slice(header+1))for(const i of indexes){
          const value=clean(row[i]);
          for(const [id,name] of Object.entries(centers))if(value===id||value==='T'+id||value===name+'外送中心'||value===name+'中心')sourceCenters.add(id);
        }
      }
    }
    // TC plus actual-hours in one workbook is supported by the existing unified staffing importer.
    const types=[...hits].filter(x=>!hits.has('TC')||!['actuals','BI'].includes(x));
    if(types.length!==1)throw new Error(types.length?'同檔含多種匯入格式，請分開匯出':'無法辨識內容；請確認欄位與檔案格式');
    const type=types[0],route=['ByDate','ByOrder'].includes(type)?'scores':['TC','actuals'].includes(type)?'staffing':type==='BI'?'bi':'feedback';
    if(route==='scores'){
      const grid=sheets[0]?.matrix||[],headers=(grid[0]||[]).map(clean),i=headers.indexOf(type==='ByDate'?'訂單日期':'落單時間');
      for(const row of grid.slice(1)){
        let v=row[i];
        if(v instanceof Date)v=v.toISOString().slice(0,10);
        else if(typeof v==='number'&&root.XLSX?.SSF){const d=root.XLSX.SSF.parse_date_code(v);v=d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}
        const match=clean(v).match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if(match)dates.add(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
      }
    }
    return {type,route,centers:[...sourceCenters],dates:[...dates].sort()};
  }
  function groups(items){
    const out=[],scores=new Map();
    for(const item of items){
      if(item.error){out.push({items:[item],error:item.error});continue;}
      if(item.route!=='scores'){out.push({route:item.route,items:[item]});continue;}
      const key=JSON.stringify(item.dates),list=scores.get(key)||[];list.push(item);scores.set(key,list);
    }
    for(const list of scores.values()){
      const ready=list.length===2&&new Set(list.map(x=>x.type)).size===2&&list.every(x=>x.dates.length);
      out.push({route:'scores',items:list,error:ready?'':'請提供同日期範圍各一份 ByOrder、ByDate，重複檔請移除後重選'});
    }
    return out;
  }
  const api={classify,groups};root.UploadRouter=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
