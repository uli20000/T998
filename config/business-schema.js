(function(root){
  'use strict';
  const CENTERS=['994','995','996','997','998','981'];
  function validate(config,expectedCenter){
    if(!config||!CENTERS.includes(config.center))throw new Error('尚未提供有效中心營運設定');
    if(expectedCenter&&String(expectedCenter)!==config.center)throw new Error('營運設定中心不符，已停止載入');
    if(config.verified!==true)throw new Error('中心營運設定尚未核對，不能套用其他中心設定');
    if(!Array.isArray(config.areas)||!config.areas.length)throw new Error('缺少區域清單');
    const codes=config.areas.map(x=>x[0]);
    if(config.areas.some(x=>!Array.isArray(x)||x.length!==2||!String(x[0]).match(/^[A-Z0-9]+$/)||!x[1])||new Set(codes).size!==codes.length)throw new Error('區域設定格式錯誤');
    for(const key of ['acAssignments','nonDeliveryStores','removedStores','removedNames','removedAreas','weatherCities'])if(!Array.isArray(config[key]))throw new Error('缺少設定：'+key);
    if(config.removedAreas.some(code=>!codes.includes(code)))throw new Error('移除區域不在區域清單');
    // 有移除店／區域時必須有生效日；完全沒有範圍異動的中心可為 null，不可為了通過驗證而補假日期。
    const hasScopeChange=config.removedStores.length>0||config.removedNames.length>0||config.removedAreas.length>0;
    const validDate=/^\d{4}-\d{2}-\d{2}$/.test(config.scopeEffectiveDate);
    if(hasScopeChange?!validDate:(config.scopeEffectiveDate!==null&&!validDate))throw new Error('範圍生效日期格式錯誤');
    if(typeof config.regionLabel!=='string'||!config.regionLabel)throw new Error('缺少設定：regionLabel');
    if(!config.centerName||!config.weatherCityByArea||!config.weeklySalesNotes||!config.forecast)throw new Error('中心營運設定不完整');
    if(!Number.isFinite(config.forecast.growth)||!Number.isFinite(config.forecast.tplh)||config.forecast.tplh<=0)throw new Error('預估參數錯誤');
    for(const key of ['sstg','d7','d25','faShareMax','tplh']){
      const value=config.kpiTargets?.[key];
      if(value===null)continue;
      const bounds=key==='sstg'?value>=-1:key==='tplh'?value>0:value>=0&&value<=1;
      if(!Number.isFinite(value)||!bounds)throw new Error('KPI 目標設定錯誤：'+key);
    }
    return config;
  }
  const api={CENTERS,validate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CenterBusinessSchema=api;
})(typeof window!=='undefined'?window:globalThis);
