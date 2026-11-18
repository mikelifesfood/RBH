import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../push-client.js',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');
const manager=fs.readFileSync(new URL('../supabase/functions/push-subscriptions/index.ts',import.meta.url),'utf8');
const sender=fs.readFileSync(new URL('../supabase/functions/push-dispatch/index.ts',import.meta.url),'utf8');
const mailer=fs.readFileSync(new URL('../supabase/functions/send-action-assignment-email/index.ts',import.meta.url),'utf8');
const selfAssignmentMigration=fs.readFileSync(new URL('../supabase/migrations/20261117_pwa_push_suppress_self_assignment.sql',import.meta.url),'utf8');
const selfTest=fs.readFileSync(new URL('../supabase/functions/push-test-device/index.ts',import.meta.url),'utf8');
const testMigration=fs.readFileSync(new URL('../supabase/migrations/20261117_pwa_push_controlled_device_test.sql',import.meta.url),'utf8');
const foundation=fs.readFileSync(new URL('../supabase/migrations/20261117_pwa_push_foundation_STAGED_NOT_APPLIED.sql',import.meta.url),'utf8');
const outbox=fs.readFileSync(new URL('../supabase/migrations/20261117_pwa_push_outbox_claim.sql',import.meta.url),'utf8');

function worker(){
  const handlers={},notifications=[],opened=[];
  const clients=[];
  const service={
    registration:{
      scope:'https://rbh.example/',
      showNotification:async (title,options)=>notifications.push({title,options})
    },
    clients:{
      matchAll:async()=>clients,
      openWindow:async url=>opened.push(url)
    },
    addEventListener:(name,fn)=>{handlers[name]=fn;}
  };
  vm.runInNewContext(sw,{self:service,URL,caches:{},fetch:async()=>{},Response,console});
  return {handlers,notifications,opened,clients};
}
test('worker never displays untrusted title/body or opens untrusted URL',async()=>{
  const w=worker();
  let p;
  const suspicious={title:'Injury narrative',body:'Employee medical details',url:'https://attacker.example/',tag:'valid_123'};
  w.handlers.push({data:{json:()=>suspicious},waitUntil:v=>p=v});
  await p;
  assert.equal(w.notifications.length,1);
  assert.equal(w.notifications[0].title,'RBH Safety');
  assert.ok(!JSON.stringify(w.notifications[0]).includes(suspicious.body));
  assert.ok(!JSON.stringify(w.notifications[0]).includes(suspicious.url));
  const n={data:{url:'https://attacker.example/'},close(){}};
  w.handlers.notificationclick({notification:n,waitUntil:v=>p=v});
  await p;
  assert.deepEqual(w.opened,['https://rbh.example/dashboard.html#notifications']);
});
test('worker focuses an existing staff dashboard before opening a new window',async()=>{
  const w=worker();let focused=0,p;
  w.clients.push({url:'https://rbh.example/dashboard.html',focus:async()=>{focused++;}});
  w.handlers.notificationclick({notification:{close(){}},waitUntil:v=>p=v});
  await p;
  assert.equal(focused,1);
  assert.equal(w.opened.length,0);
});
test('public offline shell remains separate from signed-in dashboard',()=>{
  assert.match(sw,/if\(publicForm&&response\.ok/);
  assert.match(sw,/if\(!publicForm&&!staffDashboard&&!staffWorkspace\)return/);
  assert.ok(!/cache\.put\(.*dashboard/i.test(sw));
  assert.match(dashboard,/dashboard\.webmanifest/);
  assert.match(dashboard,/id="rbhPushSettings"/);
  assert.match(dashboard,/push-client\.js/);
});
test('explicit permission request precedes network status calls',()=>{
  const start=ui.indexOf('async function enablePush()');
  const end=ui.indexOf('async function disablePush()',start);
  const body=ui.slice(start,end);
  assert.ok(body.indexOf('Notification.requestPermission()')>=0);
  assert.ok(body.indexOf('Notification.requestPermission()')<body.indexOf('call("status")'));
  assert.match(ui,/if\(ios\(\)&&!standalone\(\)\)/);
  assert.match(ui,/beforeSignOut/);
});
test('browser cannot directly query endpoint table and server derives account from JWT',()=>{
  assert.ok(!ui.includes('from("user_push_subscriptions")'));
  assert.match(manager,/auth\.getUser\(token\)/);
  assert.match(manager,/DEVICE_BELONGS_TO_ANOTHER_ACCOUNT/);
  assert.match(manager,/auth_session_id:sessionId/);
  assert.match(manager,/disable_all/);
  assert.match(foundation,/revoke all on public\.user_push_subscriptions from anon, authenticated/);
  assert.match(foundation,/unique\(notification_id,subscription_id\)/);
});
test('sender is gated and rechecks live assignments and sessions',()=>{
  assert.match(sender,/req\.headers\.get\("apikey"\)/);
  assert.match(sender,/SUPABASE_SECRET_KEYS/);
  assert.match(sender,/rbh_push_dispatch/);
  assert.match(sender,/NOT_AUTHORIZED/);
  assert.ok(!sender.includes('req.headers.get("Authorization")'));
  assert.match(sender,/if\(settingsError\|\|!settings\?\.enabled\)/);
  assert.match(sender,/teamworkt_push_session_active/);
  assert.match(sender,/push_organization_settings/);
  assert.match(sender,/report_owner_user_id===uid/);
  assert.match(sender,/action\.owner_user_id===uid/);
  assert.match(sender,/p\.is_active===true/); // verify profile current active checks remain present
  assert.match(outbox,/for update skip locked/);
  assert.match(outbox,/on conflict \(notification_id,subscription_id\) do nothing/);
  assert.match(outbox,/enabled=true/);
});

test('controlled test only targets authenticated current device, rate limited, no global activation',()=>{
  assert.match(selfTest,/auth\.getUser\(token\)/);
  assert.match(selfTest,/\.eq\("user_id",userId\)/);
  assert.match(selfTest,/\.eq\("organization_id",org\)/);
  assert.match(selfTest,/\.eq\("auth_session_id",sessionId\)/);
  assert.match(selfTest,/teamworkt_push_session_active/);
  assert.match(selfTest,/teamworkt_push_claim_test/);
  assert.match(selfTest,/webpush\.sendNotification/);
  assert.match(testMigration,/interval '2 minutes'/);
  assert.match(testMigration,/auth\.role\(\)/);
  assert.match(testMigration,/revoke all on function public\.teamworkt_push_claim_test/);
  assert.match(dashboard,/id="rbhPushTest"/);
  assert.match(ui,/functions\.invoke\("push-test-device"/);
  assert.ok(!selfTest.includes(".from(\"reports\")"));
});

test('typed Web Push shows only fixed privacy-safe copy and ignores caller-provided title and body',async()=>{
  const cases=[
    ['new_report','New safety report','A safety report is ready for review.'],
    ['report_owner_assignment','Report assigned','A report has been assigned to you.'],
    ['action_assignment','Corrective action assigned','You have a corrective action to complete.'],
    ['corrective_action_assignment','Corrective action assigned','You have a corrective action to complete.'],
    ['corrective_action_verification_requested','Verification required','A corrective action is ready for review.'],
    ['corrective_action_changes_requested','Changes requested','Your corrective action needs attention.']
  ];
  for(const [type,title,body] of cases){
    const w=worker();let promise;
    w.handlers.push({data:{json:()=>({type,tag:'00000000000000000000000000000001',title:'Sensitive data',body:'Private details',url:'https://attacker.example'})},waitUntil:v=>promise=v});
    await promise;
    assert.equal(w.notifications[0].title,title);
    assert.equal(w.notifications[0].options.body,body);
    assert.ok(!JSON.stringify(w.notifications[0]).includes('Sensitive data'));
    assert.ok(!JSON.stringify(w.notifications[0]).includes('Private details'));
  }
  const w=worker();let promise;
  w.handlers.push({data:{json:()=>({type:'malicious_custom',title:'Leaked injury',body:'Sensitive injury'})},waitUntil:v=>promise=v});
  await promise;
  assert.equal(w.notifications[0].title,'RBH Safety');
  assert.equal(w.notifications[0].options.body,'You have a safety item requiring attention. Sign in to review.');
  assert.match(sender,/type:event.notification_type/);
  assert.match(sender,/allowed.has\(event.notification_type\)/);
});
test('self-assignment suppression retains in-app records and does not suppress action follow-ups',()=>{
  assert.match(mailer,/reason: "SELF_ASSIGNMENT"/);
  assert.match(mailer,/String\(report.report_owner_assigned_by \|\| ""\) === String\(owner.id\)/);
  assert.match(mailer,/notificationType === "assignment" && String\(assignee.id\) === String\(userData.user.id\)/);
  assert.ok(!mailer.includes('notificationType === "changes_requested" && String(assignee.id) === String(userData.user.id)'));
  assert.match(selfAssignmentMigration,/auth.uid\(\)=new.recipient_user_id/);
  assert.match(selfAssignmentMigration,/report_owner_assigned_by=new.recipient_user_id/);
  assert.match(selfAssignmentMigration,/coalesce\(a.updated_by,a.activated_by\)=new.recipient_user_id/);
  assert.match(selfAssignmentMigration,/on conflict \(notification_id,subscription_id\) do nothing/);
  assert.ok(!selfAssignmentMigration.includes('delete from public.report_user_notifications'));
  assert.match(sender,/report_owner_assigned_by,event.recipient_user_id/);
  assert.match(sender,/action.updated_by\|\|action.activated_by,event.recipient_user_id/);
});
