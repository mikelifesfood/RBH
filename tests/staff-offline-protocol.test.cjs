/* Run with: node --test tests/staff-offline-protocol.test.cjs */
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('../staff-offline-protocol.js');
const scope={organizationId:'rbh',userId:'employee',reportId:'report',actionId:'action',generation:2,step:'completion'};
const observed='2026-11-18T12:30:00.000Z';
const valid={authenticated:true,active:true,canPerform:true,userId:'employee',organizationId:'rbh',
 reportId:'report',actionId:'action',generation:2,revision:observed,current:true};
function draft(){return p.buildIntent({scope,kind:'submit_action_completion',observedRevision:observed,payload:{note:'completed work'}})}
test('sensitive workflow always requires explicit online consent',()=>{
 const intent=draft();
 assert.throws(()=>p.explicitConfirm(intent,valid,true),/NOT_READY/);
 const ready=p.markReady(p.stageForConnection(intent),valid);
 assert.throws(()=>p.explicitConfirm(ready,valid,false),/EXPLICIT/);
 assert.equal(p.explicitConfirm(ready,valid,true).status,p.STATES.UPLOADING);
});
test('stale revision, changed tenant, role, assignment and generation cause Needs review',()=>{
 for(const override of [{revision:'new'},{organizationId:'other'},{userId:'other'},{canPerform:false},{active:false},{authenticated:false},{generation:3},{actionId:'different'},{current:false}])
  assert.equal(p.markReady(draft(),{...valid,...override}).status,p.STATES.REVIEW);
});
test('verification and close cannot silently submit',()=>{
 for(const kind of ['verify_action','request_action_changes','close_report','assign_report_owner']){
  const i=p.buildIntent({scope,kind,observedRevision:observed,payload:{reason:'test'}});
  assert.throws(()=>p.explicitConfirm(i,valid,true),/NOT_READY/);
 }
});
test('only verified matching server receipt can mark operation synced',()=>{
 const i=draft(),sending=p.explicitConfirm(p.markReady(i,valid),valid,true);
 assert.throws(()=>p.markSynced(sending,{ok:true,committed:true,operationId:'different'}),/VERIFIED/);
 assert.throws(()=>p.markSynced(sending,{ok:true,committed:false,operationId:i.operationId}),/VERIFIED/);
 const receipt={ok:true,committed:true,operationId:i.operationId};
 assert.equal(p.markSynced(p.markPendingReceipt(sending),receipt).status,p.STATES.SYNCED);
});
test('unknown operations and missing server revision are rejected',()=>{
 assert.throws(()=>p.buildIntent({scope,kind:'delete_all',observedRevision:observed,payload:{}}),/OPERATION/);
 assert.throws(()=>p.buildIntent({scope,kind:'close_report',observedRevision:'',payload:{}}),/REVISION/);
});
