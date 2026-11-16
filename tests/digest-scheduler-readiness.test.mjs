import test from "node:test";
import assert from "node:assert/strict";
import {isScheduledWindow,eligibleRecipient} from "../supabase/functions/safety-pulse-weekly-digest/core.ts";

const time=(s)=>new Date(s);
test("New York winter and summer Mondays at 8AM local",()=>{
 assert.equal(isScheduledWindow("America/New_York",time("2026-01-12T13:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-07-13T12:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-07-13T13:00:00Z")),false);
});
test("DST spring-forward week and fall-back week in New York",()=>{
 assert.equal(isScheduledWindow("America/New_York",time("2026-03-02T13:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-03-09T12:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-10-26T12:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-02T13:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-02T12:00:00Z")),false);
});
test("Company-local schedule across US and UK time zones",()=>{
 assert.equal(isScheduledWindow("America/Los_Angeles",time("2026-07-13T15:00:00Z")),true);
 assert.equal(isScheduledWindow("America/Los_Angeles",time("2026-01-12T16:00:00Z")),true);
 assert.equal(isScheduledWindow("Europe/London",time("2026-03-30T07:00:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-07-13T15:00:00Z")),false);
});
test("Wrong weekday, early/late clock or invalid configuration never sends",()=>{
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-16T12:59:00Z")),false);
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-16T13:14:00Z")),true);
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-16T13:15:00Z")),false);
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-17T13:00:00Z")),false);
 assert.equal(isScheduledWindow("",time("2026-11-16T13:00:00Z")),false);
 assert.equal(isScheduledWindow("America/New_York",time("2026-11-16T13:00:00Z"),1,8,15),false);
});
const base={id:"a",email:"worker@example.test",full_name:"Test Admin",app_role:"admin",is_active:true,
 access_deleted_at:null,organization_id:"company-a",current_organization_id:null};
test("Admins and Safety Managers are eligible, Supervisor and Read Only are excluded",()=>{
 assert.equal(eligibleRecipient(base,"company-a"),true);
 assert.equal(eligibleRecipient({...base,app_role:"safety_manager"},"company-a"),true);
 assert.equal(eligibleRecipient({...base,app_role:"supervisor"},"company-a"),false);
 assert.equal(eligibleRecipient({...base,app_role:"read_only"},"company-a"),false);
});
test("Inactive, deleted and blank-email recipients never send",()=>{
 assert.equal(eligibleRecipient({...base,is_active:false},"company-a"),false);
 assert.equal(eligibleRecipient({...base,access_deleted_at:"2026-11-01T00:00:00Z"},"company-a"),false);
 assert.equal(eligibleRecipient({...base,email:"  "},"company-a"),false);
});
test("Effective current company controls recipient tenant isolation",()=>{
 assert.equal(eligibleRecipient(base,"company-b"),false);
 assert.equal(eligibleRecipient({...base,current_organization_id:"company-b"},"company-a"),false);
 assert.equal(eligibleRecipient({...base,current_organization_id:"company-b"},"company-b"),true);
 assert.equal(eligibleRecipient({...base,organization_id:null,current_organization_id:null},"company-a"),false);
});
