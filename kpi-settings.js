/* 儀表板 v2｜D2 目標值集中設定：從資料庫 t998_kpi_settings 讀目標值與預警規則，覆蓋設定檔預設值。
 * 資料表還沒建立或讀取失敗時，一律沿用設定檔（不擋畫面）。總覽、儀表板、影響度、預警、週報都讀同一份 kpiTargets。 */
(function(root){
  'use strict';
  const TABLE='t998_kpi_settings',CHANGES='t998_kpi_setting_changes';
  const TARGET_KEYS=['d7','d25','sstg','faShareMax','tplh'];
  const RULE_DEFAULTS={alertDays:3,alertWeeks:2,anomalyTc:0.15,anomalyRate:0.05};
  const FIELDS=[
    {key:'d7',label:'D7',unit:'%',dir:'越高越好',group:'target'},
    {key:'d25',label:'D25',unit:'%',dir:'越高越好',group:'target'},
    {key:'sstg',label:'SSTG',unit:'%',dir:'越高越好',group:'target',signed:true},
    {key:'faShareMax',label:'FA 佔比',unit:'%',dir:'越低越好（上限）',group:'target'},
    {key:'tplh',label:'TPLH',unit:'',dir:'越高越好',group:'target'},
    {key:'alertDays',label:'日指標連續未達標',unit:'天',group:'rule',min:2,max:14,int:true},
    {key:'alertWeeks',label:'週指標連續未達標',unit:'週',group:'rule',min:1,max:8,int:true},
    {key:'anomalyTc',label:'異常日：單量差距',unit:'%',group:'rule'},
    {key:'anomalyRate',label:'異常日：達成率差距',unit:'個百分點',group:'rule',points:true}
  ];
  const state={loaded:false,available:null,rows:[],rules:{...RULE_DEFAULTS},defaults:null};
  function targetObjects(){const list=[];const a=root.CenterBusinessConfig?.kpiTargets,b=root.OpsMetrics?.BUSINESS?.kpiTargets;if(a)list.push(a);if(b&&b!==a)list.push(b);return list;}
  function apply(rows){
    const objs=targetObjects();
    if(!state.defaults&&objs[0])state.defaults={...objs[0]};
    for(const o of objs)Object.assign(o,state.defaults||{});
    state.rules={...RULE_DEFAULTS};
    for(const row of rows){const v=Number(row.value);if(!Number.isFinite(v))continue;if(TARGET_KEYS.includes(row.key))for(const o of objs)o[row.key]=v;else if(row.key in RULE_DEFAULTS)state.rules[row.key]=v;}
  }
  async function load(db,{force=false}={}){
    if(state.loaded&&!force)return state;
    try{const r=await db.from(TABLE).select('key,value,updated_at');if(r.error)throw r.error;state.rows=r.data||[];state.available=true;}
    catch(e){state.rows=[];state.available=false;state.error=e.message||String(e);}
    apply(state.rows);state.loaded=true;return state;
  }
  async function save(db,values){
    const current=new Map(state.rows.map(r=>[r.key,Number(r.value)])),defaults=state.defaults||{};
    const rows=Object.entries(values).filter(([k,v])=>Number.isFinite(v)&&v!==(current.has(k)?current.get(k):(k in RULE_DEFAULTS?RULE_DEFAULTS[k]:defaults[k]))).map(([key,value])=>({key,value}));
    if(!rows.length)return 0;
    const r=await db.from(TABLE).upsert(rows,{onConflict:'key'});if(r.error)throw r.error;
    await load(db,{force:true});return rows.length;
  }
  async function changes(db,limit=30){const r=await db.from(CHANGES).select('key,old_value,new_value,changed_at').order('changed_at',{ascending:false}).limit(limit);if(r.error)throw r.error;return r.data||[];}
  const api={FIELDS,TARGET_KEYS,RULE_DEFAULTS,state,load,save,changes,apply,rules:()=>state.rules,defaults:()=>state.defaults||{...(targetObjects()[0]||{})}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KpiSettings=api;
})(typeof window!=='undefined'?window:globalThis);
