// RBH ownership transfer / reassignment transactional Brevo dispatcher.
// Invoked from a database trigger with the existing, server-held webhook secret.
// No browser may supply recipient, message type, or report contents.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const allowed = new Set([
  "report_transfer_requested","report_transfer_declined","report_owner_transferred_from",
  "report_owner_assignment","corrective_action_reassigned_from","corrective_action_assignment"
]);
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const esc=(s:unknown)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isActive=(p:any,org:string)=>!!p&&p.is_active===true&&!p.access_deleted_at&&(p.current_organization_id||p.organization_id)===org;
function link(base:string,reportId:string){try{const u=new URL(base);u.searchParams.set("report",reportId);return u.toString();}catch{return "";}}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  const configured=Deno.env.get("WEBHOOK_SECRET_NEXT")||"";
  const provided=req.headers.get("x-webhook-secret")||"";
  // Fixed length + SHA-256 digest comparison; never log or reflect secrets.
  if(configured.length<32||provided.length!==configured.length)return json({error:"UNAUTHORIZED"},401);
  const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([hash(provided),hash(configured)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff!==0)return json({error:"UNAUTHORIZED"},401);
  const body=await req.json().catch(()=>({}));
  const id=typeof body?.notificationId==="string"?body.notificationId:"";
  if(!uuid.test(id))return json({error:"INVALID_ID"},400);
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const brevo=Deno.env.get("BREVO_API_KEY")||"",sender=Deno.env.get("MAIL_FROM_EMAIL")||"";
  if(!url||!key||!brevo||!sender)return json({error:"SERVER_CONFIG_MISSING"},503);
  const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:n,error:ne}=await service.from("report_user_notifications")
     .select("id,organization_id,report_id,corrective_action_id,recipient_user_id,notification_type,created_at,resolved_at")
     .eq("id",id).maybeSingle();
  if(ne||!n||!allowed.has(n.notification_type))return json({error:"NOTIFICATION_NOT_FOUND"},404);
  const [{data:p},{data:r}]=await Promise.all([
    service.from("profiles").select("id,email,full_name,is_active,access_deleted_at,organization_id,current_organization_id,app_role,preferred_language").eq("id",n.recipient_user_id).maybeSingle(),
    service.from("reports").select("id,organization_id,report_owner_user_id,ref_no,status").eq("id",n.report_id).maybeSingle()
  ]);
  if(!r||r.organization_id!==n.organization_id||!p||!isActive(p,n.organization_id)||!String(p.email||"").trim())
    return json({ok:true,skipped:true,reason:"RECIPIENT_NOT_ACTIVE"});
  const type=n.notification_type;
  let permitted=false;
  // Check the current authoritative ledger, not request-provided fields.
  if(type==="report_transfer_requested"||type==="report_transfer_declined"||type==="report_owner_transferred_from"){
    const field=type==="report_transfer_requested"?"to_user_id":"from_user_id";
    const [{data:transfer},{data:override}]=await Promise.all([
      service.from("rbh_report_transfer_requests").select("id,status,expires_at,from_user_id,to_user_id,decided_at,created_at")
        .eq("report_id",r.id).eq(field,p.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
      type==="report_owner_transferred_from"
       ?service.from("rbh_report_ownership_overrides").select("id,created_at")
          .eq("report_id",r.id).eq("previous_owner_id",p.id).order("created_at",{ascending:false}).limit(1).maybeSingle()
       :Promise.resolve({data:null})
    ]);
    if(type==="report_transfer_requested") permitted=!!transfer&&transfer.status==="pending"&&new Date(transfer.expires_at).getTime()>Date.now();
    if(type==="report_transfer_declined") permitted=!!transfer&&transfer.status==="declined"&&r.report_owner_user_id===p.id;
    if(type==="report_owner_transferred_from") permitted=r.report_owner_user_id!==p.id&&!!((transfer&&transfer.status==="accepted")||override);
  }else if(type==="report_owner_assignment"){
    // Existing initial-assignment email remains handled by the original sender.
    // This dispatcher handles accepted transfers, not arbitrary notifications.
    const {data:t}=await service.from("rbh_report_transfer_requests").select("id,decided_at")
      .eq("report_id",r.id).eq("to_user_id",p.id).eq("status","accepted")
      .order("decided_at",{ascending:false}).limit(1).maybeSingle();
    permitted=r.report_owner_user_id===p.id&&!!t&&
      Math.abs(new Date(n.created_at).getTime()-new Date(t.decided_at).getTime())<120000;
  }else{
    const [{data:a},{data:t}]=await Promise.all([
      service.from("report_corrective_actions").select("id,report_id,organization_id,owner_user_id,status").eq("id",n.corrective_action_id).maybeSingle(),
      service.from("rbh_corrective_action_reassignments")
        .select("id,created_at,new_owner_id,old_owner_id").eq("corrective_action_id",n.corrective_action_id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    permitted=!!a&&a.report_id===r.id&&a.organization_id===r.organization_id&&!!t&&
      Math.abs(new Date(n.created_at).getTime()-new Date(t.created_at).getTime())<120000&&
      (type==="corrective_action_assignment"?a.owner_user_id===p.id&&t.new_owner_id===p.id:
         a.owner_user_id!==p.id&&t.old_owner_id===p.id);
  }
  if(!permitted)return json({ok:true,skipped:true,reason:"NO_CURRENT_OWNERSHIP_EVENT"});
  const eventKey="ownership-event/"+n.id+"/"+p.id;
  const {data:existing,error:ee}=await service.from("report_notification_events")
    .select("id,status,created_at").eq("event_key",eventKey).maybeSingle();
  if(ee)return json({error:"AUDIT_UNAVAILABLE"},503);
  if(existing?.status==="sent")return json({ok:true,duplicate:true});
  if(existing?.status==="sending"&&Date.now()-new Date(existing.created_at).getTime()<600000)
    return json({ok:true,inProgress:true});
  let logId=existing?.id;
  if(logId){
    const {error:e}=await service.from("report_notification_events").update({status:"sending",updated_at:new Date().toISOString(),error_message:null}).eq("id",logId);
    if(e)return json({error:"AUDIT_UPDATE_FAILED"},503);
  }else{
    const {data:entry,error:e}=await service.from("report_notification_events")
      .insert({organization_id:n.organization_id,report_id:r.id,corrective_action_id:n.corrective_action_id,
        recipient_user_id:p.id,recipient_email:p.email,notification_type:type,event_key:eventKey,provider:"brevo",status:"sending"})
      .select("id").single();
    if(e)return json({error:"AUDIT_RESERVATION_FAILED"},503);
    logId=entry.id;
  }
  const en={
    report_transfer_requested:["Report ownership request","Another Safety Manager has offered to transfer a report to you. Please accept or decline the request in RBH Safety."],
    report_transfer_declined:["Report transfer declined","The proposed recipient declined your report transfer. You remain the owner."],
    report_owner_transferred_from:["Report ownership changed","You are no longer the Report Owner. The report is available to view but not edit."],
    report_owner_assignment:["Report ownership accepted","You are now the Report Owner. Open RBH Safety to continue the work."],
    corrective_action_reassigned_from:["Corrective action reassigned","A corrective action previously assigned to you has been transferred to another employee."],
    corrective_action_assignment:["Corrective action assigned","A corrective action has been reassigned to you. Open RBH Safety to review it."]
  } as Record<string,[string,string]>;
  const es={
    report_transfer_requested:["Solicitud de transferencia de reporte","Se le ha ofrecido la responsabilidad de un reporte. Acepte o rechace la solicitud en RBH Safety."],
    report_transfer_declined:["Transferencia rechazada","La persona propuesta rechazó la transferencia del reporte. Usted sigue siendo el responsable."],
    report_owner_transferred_from:["Responsable del reporte cambiado","Usted ya no es responsable de este reporte. Puede verlo, pero no modificarlo."],
    report_owner_assignment:["Transferencia de reporte aceptada","Ahora usted es responsable del reporte. Abra RBH Safety para continuar."],
    corrective_action_reassigned_from:["Acción correctiva reasignada","Una acción correctiva que tenía asignada se transfirió a otra persona."],
    corrective_action_assignment:["Acción correctiva asignada","Se le ha asignado una acción correctiva. Abra RBH Safety para revisarla."]
  } as Record<string,[string,string]>;
  const copy=(p.preferred_language==="es"?es:en)[type];
  const reportNo=r.ref_no||String(r.id).slice(0,8);
  const subject="[RBH Safety] "+copy[0]+" — Report #"+reportNo;
  const target=link(Deno.env.get("DASHBOARD_URL")||"",String(r.id));
  const html='<div style="font:15px Arial,sans-serif;color:#17212c;max-width:600px;margin:auto">'+
    '<h2 style="color:#183f68">RBH Safety</h2><h3>'+esc(copy[0])+'</h3>'+
    '<p>'+esc(copy[1])+'</p><p>Report #'+esc(reportNo)+'</p>'+
    (target?'<p><a href="'+esc(target)+'" style="color:#1760a6">Open RBH Safety</a></p>':'')+
    '<p style="color:#667085;font-size:12px">This message contains no incident details. Sign in to review the report securely.</p></div>';
  let messageId="";
  try{
    const response=await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",headers:{"Content-Type":"application/json","api-key":brevo},
      body:JSON.stringify({sender:{email:sender,name:Deno.env.get("MAIL_FROM_NAME")||"RBH Safety"},
        to:[{email:p.email,name:p.full_name||p.email}],subject,htmlContent:html,
        tags:["rbh-ownership-transfer"],headers:{"X-RBH-Event":n.id}})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error("BREVO_HTTP_"+response.status);
    messageId=String(data.messageId||"");
  }catch(e){
    await service.from("report_notification_events").update({status:"failed",error_message:String(e instanceof Error?e.message:"SEND_ERROR").slice(0,160),
      updated_at:new Date().toISOString()}).eq("id",logId);
    return json({error:"EMAIL_SEND_FAILED"},502);
  }
  const {error:successError}=await service.from("report_notification_events").update({
    status:"sent",provider_message_id:messageId,sent_at:new Date().toISOString(),updated_at:new Date().toISOString()
  }).eq("id",logId);
  if(successError)return json({error:"EMAIL_SENT_AUDIT_UPDATE_FAILED"},503);
  return json({ok:true,sent:true});
});
