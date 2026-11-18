// RBH / TeamWorkt PWA push dispatch: dedicated sb_secret backend invocation only.
// Scheduled every minute; requires explicit company enable, device opt-in, and valid VAPID secrets.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const allowed=new Set(["new_report","report_owner_assignment","action_assignment","corrective_action_assignment","corrective_action_verification_requested","corrective_action_changes_requested","report_transfer_requested","report_transfer_declined","report_owner_transferred_from","corrective_action_reassigned_from"]);
const providerOk=(endpoint:string)=>{
  try{const u=new URL(endpoint),h=u.hostname.toLowerCase();
    return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&
      (h==="fcm.googleapis.com"||h==="updates.push.services.mozilla.com"||
       h==="web.push.apple.com"||h==="api.push.apple.com"||h==="android.googleapis.com"||(h.endsWith(".push.apple.com")||h.endsWith(".notify.windows.com")||h.endsWith(".wns.windows.com")));
  }catch{return false;}
};
Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  // A dedicated modern Supabase secret key (not a JWT) authorizes scheduled calls.
  // RBH API key name: rbh_push_dispatch. It never belongs in frontend code.
  let configuredKey="";
  try{
    const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    configuredKey=typeof keys.rbh_push_dispatch==="string"?keys.rbh_push_dispatch:"";
  }catch{}
  const suppliedKey=req.headers.get("apikey")||"";
  if(!configuredKey||!suppliedKey||!suppliedKey.startsWith("sb_secret_")||suppliedKey.length!==configuredKey.length)
    return json({error:"NOT_AUTHORIZED"},403);
  const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  const [providedHash,expectedHash]=await Promise.all([digest(suppliedKey),digest(configuredKey)]);
  let diff=0;for(let i=0;i<providedHash.length;i++)diff|=providedHash[i]^expectedHash[i];
  if(diff!==0)return json({error:"NOT_AUTHORIZED"},403);
  const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url=Deno.env.get("SUPABASE_URL");
  if(!url||!secret)return json({error:"NOT_CONFIGURED"},503);
  const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:settings,error:settingsError}=await service.from("push_delivery_settings").select("enabled").eq("id",true).maybeSingle();
  if(settingsError||!settings?.enabled)return json({enabled:false,processed:0});
  const publicKey=Deno.env.get("VAPID_PUBLIC_KEY"),privateKey=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT");
  if(!publicKey||!privateKey||!subject||!/^mailto:|^https:\/\//.test(subject))return json({error:"VAPID_NOT_CONFIGURED"},503);
  try{webpush.setVapidDetails(subject,publicKey,privateKey);}
  catch{return json({error:"VAPID_INVALID"},503);}
  const {data:claims,error:claimError}=await service.rpc("teamworkt_push_claim",{p_limit:10});
  if(claimError)return json({error:"QUEUE_UNAVAILABLE"},503);
  const summary={processed:0,accepted:0,expired:0,cancelled:0,retry:0,failed:0};
  for(const task of claims||[]){
    summary.processed++;
    const now=new Date().toISOString();
    // Current source row and recipient must still authorize the notification.
    const [{data:event},{data:device}]=await Promise.all([
      service.from("report_user_notifications").select("id,organization_id,recipient_user_id,notification_type,report_id,corrective_action_id,acknowledged_at,resolved_at,created_at").eq("id",task.notification_id).maybeSingle(),
      service.from("user_push_subscriptions").select("id,organization_id,user_id,auth_session_id,endpoint,p256dh,auth_secret,disabled_at").eq("id",task.subscription_id).maybeSingle()
    ]);
    let permitted=!!event&&!!device&&!device.disabled_at&&
      event.organization_id===task.organization_id&&device.organization_id===task.organization_id&&
      event.recipient_user_id===device.user_id&&allowed.has(event.notification_type)&&!event.acknowledged_at&&!event.resolved_at&&
      Date.now()-new Date(event.created_at).getTime()<48*60*60*1000&&
      providerOk(device.endpoint);
    let profile:any=null,report:any=null,action:any=null;
    if(permitted){
      if(!device.auth_session_id){permitted=false;}
      else{
        const session=await service.rpc("teamworkt_push_session_active",{p_user_id:device.user_id,p_session_id:device.auth_session_id});
        permitted=!session.error&&session.data===true;
      }
    }
    if(permitted){
      const {data:p}=await service.from("profiles").select("id,is_active,access_deleted_at,app_role,organization_id,current_organization_id").eq("id",device.user_id).maybeSingle();
      profile=p;
      permitted=!!p&&p.is_active===true&&!p.access_deleted_at&&
        (p.current_organization_id||p.organization_id)===event.organization_id;
    }
    if(permitted){
      const [{data:org},{data:pushTenant}]=await Promise.all([
        service.from("organizations").select("id,status").eq("id",event.organization_id).maybeSingle(),
        service.from("push_organization_settings").select("enabled").eq("organization_id",event.organization_id).maybeSingle()
      ]);
      permitted=!!org&&pushTenant?.enabled===true&&
        !["inactive","suspended","deleted"].includes(String(org.status||"").toLowerCase());
    }
    if(permitted){
      const {data:r}=await service.from("reports")
        .select("id,organization_id,report_owner_user_id,report_owner_assigned_by,assigned_user_id,status")
        .eq("id",event.report_id).maybeSingle();
      report=r;permitted=!!r&&r.organization_id===event.organization_id;
    }
    if(permitted&&event.corrective_action_id){
      const {data:a}=await service.from("report_corrective_actions")
        .select("id,organization_id,report_id,owner_user_id,verifier_user_id,status,updated_by,activated_by")
        .eq("id",event.corrective_action_id).maybeSingle();
      action=a;permitted=!!a&&a.organization_id===event.organization_id&&a.report_id===report.id;
    }
    if(permitted){
      const uid=event.recipient_user_id;
      const role=String(profile.app_role||"").toLowerCase();
      const manager=["admin","safety_manager"].includes(role);
      const workRole=manager||role==="supervisor";
      if(["closed","no_action","duplicate"].includes(String(report.status||"").toLowerCase()))permitted=false;
      if(event.notification_type!=="new_report"&&!workRole)permitted=false;
      if(!permitted){
        // Preserve suppressed-item audit; never send stale or read-only work.
      }else switch(event.notification_type){
        case "new_report": permitted=manager;break;
        case "report_owner_assignment": permitted=report.report_owner_user_id===uid;break;
        case "report_transfer_requested": {
          const {data:t}=await service.from("rbh_report_transfer_requests").select("id")
            .eq("report_id",report.id).eq("to_user_id",uid).eq("status","pending")
            .gt("expires_at",new Date().toISOString()).limit(1).maybeSingle();
          permitted=manager&&!!t;break;
        }
        case "report_transfer_declined": {
          const {data:t}=await service.from("rbh_report_transfer_requests").select("id")
            .eq("report_id",report.id).eq("from_user_id",uid).eq("status","declined")
            .order("decided_at",{ascending:false}).limit(1).maybeSingle();
          permitted=manager&&!!t&&report.report_owner_user_id===uid;break;
        }
        case "report_owner_transferred_from": {
          const [{data:transfer},{data:override}]=await Promise.all([
            service.from("rbh_report_transfer_requests").select("id")
              .eq("report_id",report.id).eq("from_user_id",uid).eq("status","accepted")
              .order("decided_at",{ascending:false}).limit(1).maybeSingle(),
            service.from("rbh_report_ownership_overrides").select("id")
              .eq("report_id",report.id).eq("previous_owner_id",uid)
              .order("created_at",{ascending:false}).limit(1).maybeSingle()
          ]);
          permitted=manager&&report.report_owner_user_id!==uid&&!!(transfer||override);break;
        }
        case "action_assignment":
          permitted=(action&&action.owner_user_id===uid)||report.assigned_user_id===uid;break;
        case "corrective_action_assignment":
        case "corrective_action_changes_requested":
          permitted=!!action&&action.owner_user_id===uid;break;
        case "corrective_action_reassigned_from": {
          const {data:t}=await service.from("rbh_corrective_action_reassignments").select("id")
            .eq("corrective_action_id",event.corrective_action_id).eq("old_owner_id",uid)
            .order("created_at",{ascending:false}).limit(1).maybeSingle();
          permitted=!!action&&workRole&&action.owner_user_id!==uid&&!!t;break;
        }
        case "corrective_action_verification_requested":
          permitted=!!action&&(action.verifier_user_id===uid||report.report_owner_user_id===uid||manager);break;
        default: permitted=false;
      }
    }
    // Self-assignment still lives in the user's dashboard work queue.
    // Do not send a redundant push when they assigned the work to themselves.
    if(permitted&&["report_owner_assignment","action_assignment","corrective_action_assignment"].includes(event.notification_type)){
      const same=(a:any,b:any)=>!!a&&!!b&&String(a)===String(b);
      if(event.notification_type==="report_owner_assignment"&&
        same(report.report_owner_assigned_by,event.recipient_user_id))permitted=false;
      if(event.notification_type==="corrective_action_assignment"&&action&&
        same(action.updated_by||action.activated_by,event.recipient_user_id))permitted=false;
    }
    if(!permitted){
      await service.from("push_delivery_outbox").update({status:"cancelled",last_error_code:"RECIPIENT_NOT_CURRENT",updated_at:now}).eq("id",task.id).eq("status","claimed");
      summary.cancelled++;continue;
    }
    try{
      const response=await webpush.sendNotification(
        {endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth_secret}},
        JSON.stringify({tag:event.id.replace(/-/g,""),type:event.notification_type}),{TTL:3600,urgency:"normal"}
      );
      await service.from("push_delivery_outbox").update({status:"accepted",last_http_status:response.statusCode,updated_at:now}).eq("id",task.id).eq("status","claimed");
      await service.from("user_push_subscriptions").update({last_success_at:now,failure_count:0,updated_at:now}).eq("id",device.id);
      summary.accepted++;
    }catch(e){
      const status=Number((e as {statusCode?:number})?.statusCode)||null;
      const expired=status===404||status===410;
      const transient=!status||status===408||status===429||status>=500;
      const retry=transient&&task.attempts<5;
      const outcome=expired?"expired":retry?"retry":"failed";
      if(expired)await service.from("user_push_subscriptions").update({disabled_at:now,last_failure_at:now,updated_at:now}).eq("id",device.id);
      else await service.from("user_push_subscriptions").update({last_failure_at:now,failure_count:1,updated_at:now}).eq("id",device.id);
      await service.from("push_delivery_outbox").update({
        status:outcome,last_http_status:status,last_error_code:expired?"ENDPOINT_GONE":retry?"TRANSIENT":"PROVIDER_REJECTED",
        next_attempt_at:new Date(Date.now()+Math.min(60,2**task.attempts)*60000).toISOString(),updated_at:now
      }).eq("id",task.id).eq("status","claimed");
      summary[outcome as "expired"|"retry"|"failed"]++;
    }
  }
  return json({enabled:true,...summary});
});
