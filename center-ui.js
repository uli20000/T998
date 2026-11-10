(function(){
  'use strict';
  const B=window.CenterBusinessConfig;
  if(!B)return;
  for(const id of ['pageTitle','adminTitle']){
    const title=document.getElementById(id);
    if(title)title.textContent=B.regionLabel+'-Rider Center';
  }
  for(const el of document.querySelectorAll('[data-center-weather-title]')){
    el.textContent=B.weatherCities.length?B.weatherCities.join('／')+'天氣':'天氣（待核對）';
  }
  for(const el of document.querySelectorAll('[data-center-number]'))el.textContent=B.center;
  for(const el of document.querySelectorAll('[data-staffing-goals]')){
    el.textContent='TPLH '+B.forecast.tplh+'｜第三方 ≤'+new Intl.NumberFormat('zh-TW',{style:'percent'}).format(B.forecast.thirdParty);
  }
  for(const el of document.querySelectorAll('[data-center-forecast-formula]'))el.textContent=B.forecastFormula;
  if(B.legacySelectOptions){
    for(const [id,options] of Object.entries(B.legacySelectOptions)){
      const select=document.getElementById(id);
      if(select)for(const [value,label] of options)select.add(new Option(label,value));
    }
    return;
  }
  if(!Array.isArray(B.restaurants))return;
  const active=B.restaurants.filter(r=>r.enabled!==false).slice().sort((a,b)=>String(a.store_code).localeCompare(String(b.store_code)));
  const opt=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;};
  function fill(id,placeholder,items){const el=document.getElementById(id);if(el)el.replaceChildren(opt('',placeholder),...items);}
  const named=()=>active.map(r=>opt(r.store_code,r.restaurant_name+'（'+r.store_code+'）'));
  fill('batteryRestaurant','請選擇餐廳名稱',named());
  fill('deviceRegisterRestaurant','請選擇電池所在餐廳',named());
  fill('batteryRegisterRestaurant','請選擇店號',active.map(r=>opt(r.store_code,r.store_code)));
  fill('employeeAreaInput','選擇區域',(B.areas||[]).map(([code,label])=>opt(code,label)));
  // 領車點：優先用設定的 pickupPoints（使用者提供的名稱），否則用 pickup_point:true 的餐廳；沒有資料時不猜測
  const pickup=Array.isArray(B.pickupPoints)?B.pickupPoints:active.filter(r=>r.pickup_point===true).map(r=>r.restaurant_name);
  fill('claimPoint',pickup.length?'請選擇領車點':'領車點尚未設定，請洽管理員',pickup.map(name=>opt(name,name)));
})();
