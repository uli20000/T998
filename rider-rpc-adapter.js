/* Integration adapter loaded by index.html; atomic feature disabled by default.
 * Enable ONLY after isolated schema, caller permissions/RLS, and concurrency tests
 * have passed. Never fall back to direct inserts when an RPC fails.
 * A selected roster name is not proof of the human's identity.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RiderRpcAdapter=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SCHEMA='shared_test_995';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function required(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} is required`);return value;}
  function uuid(value,label){if(!UUID.test(value||''))throw new Error(`${label} must be a UUID`);return value;}
  function create(client,options={}){
    const enabled=options.enabled===true;
    if(options.schema!==undefined&&options.schema!==SCHEMA)throw new Error('Only the isolated shared_test_995 schema is supported');
    if(options.boundSchema!==undefined&&options.boundSchema!==SCHEMA)throw new Error('Bound client must use the isolated shared_test_995 schema');
    async function call(name,params){
      if(!enabled)throw new Error('Rider atomic RPC adapter is disabled pending isolated database validation');
      if(!client)throw new Error('A Supabase client is required');
      const target=options.boundSchema===SCHEMA?client:(typeof client.schema==='function'?client.schema(SCHEMA):null);
      if(!target||typeof target.rpc!=='function')throw new Error('A schema-bound Supabase client is required');
      const result=await target.rpc(name,params);
      if(result.error)throw result.error;
      if(!result.data||typeof result.data!=='object'||!result.data.id)throw new Error('RPC returned no confirmed record; check outcome before retrying with the same request ID');
      return result.data;
    }
    return Object.freeze({
      enabled,schema:SCHEMA,
      async claim(input){
        return call('rider_claim_atomic',{
          p_request_id:uuid(input.requestId,'requestId'),
          p_employee_id:uuid(input.employeeId,'employeeId'),
          p_employee_name:required(input.employeeName,'employeeName'),
          p_vehicle_id:uuid(input.vehicleId,'vehicleId'),
          p_claim_point:required(input.claimPoint,'claimPoint'),
          p_recorder_number:required(input.recorderNumber,'recorderNumber'),
          p_oil_card_status:required(input.oilCardStatus,'oilCardStatus'),
          p_battery_number:input.batteryNumber??null
        });
      },
      async returnVehicle(input){
        if(!Number.isInteger(input.mileage)||input.mileage<0)throw new Error('mileage must be a nonnegative integer');
        return call('rider_return_atomic',{
          p_request_id:uuid(input.requestId,'requestId'),
          p_employee_id:uuid(input.employeeId,'employeeId'),
          p_employee_name:required(input.employeeName,'employeeName'),
          p_claim_id:uuid(input.claimId,'claimId'),
          p_mileage:input.mileage,p_checks:input.checks,p_notes:input.notes??{}
        });
      }
    });
  }
  function createWorkflow(client,options={}){
    const adapter=create(client,options);
    // In-memory attempts survive same-page retries. Never persist names or inspection
    // details in browser storage. A page reload requires outcome reconciliation.
    const claimAttempts=new Map(),returnAttempts=new Map();
    const pendingClaims=new Map(),pendingReturns=new Map();
    function once(pending,key,run){
      if(pending.has(key))return pending.get(key);
      const promise=Promise.resolve().then(run).finally(()=>pending.delete(key));
      pending.set(key,promise);return promise;
    }
    const newId=options.requestIdFactory||(()=>globalThis.crypto.randomUUID());
    function signature(input){return JSON.stringify(input);}
    return Object.freeze({
      enabled:adapter.enabled,
      async submitClaim(input){
        if(!adapter.enabled)throw new Error('Rider atomic RPC workflow is disabled');
        const key=signature(input);
        const snapshot=JSON.parse(key);
        return once(pendingClaims,key,async()=>{
          if(!claimAttempts.has(key))claimAttempts.set(key,{...snapshot,requestId:newId()});
          const data=await adapter.claim(claimAttempts.get(key));
          claimAttempts.delete(key);return data;
        });
      },
      async submitReturn(input){
        if(!adapter.enabled)throw new Error('Rider atomic RPC workflow is disabled');
        const key=signature(input);
        const snapshot=JSON.parse(key);
        return once(pendingReturns,key,async()=>{
          if(!returnAttempts.has(key)){
            // Resolve the original claim once, retain it across uncertain retries.
            const target=options.boundSchema===SCHEMA?client:client?.schema?.(SCHEMA);
            if(!target||typeof target.from!=='function')throw new Error('A schema-bound read client is required');
            const result=await target.from('claim_records')
              .select('id,employee_id,claimant_name,claimed_at,returned_at')
              .eq('vehicle_id',snapshot.vehicleId).order('claimed_at',{ascending:false})
              .order('id',{ascending:false}).limit(1).maybeSingle();
            if(result.error)throw result.error;
            if(!result.data)throw new Error('查無本車領車紀錄，請管理員核對。');
            if(result.data.employee_id!==snapshot.employeeId)throw new Error('只允許原領車人還車；舊紀錄需先核對員工連結。');
            if(result.data.returned_at)throw new Error('這次領車已還車，請勿重複送出。');
            returnAttempts.set(key,{...snapshot,claimId:result.data.id,requestId:newId()});
          }
          const data=await adapter.returnVehicle(returnAttempts.get(key));
          returnAttempts.delete(key);return data;
        });
      }
    });
  }
  return {create,createWorkflow};
});
