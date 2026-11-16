// TeamWorkt Safety - weekly Safety Pulse digest dispatch.
// NO live sends until an operator sets DIGEST_DISPATCH_SECRET, enables the
// scheduler, and explicitly releases each company's delivery_ready flag.
// Runs only in the company's Monday 08:00-08:14 local-time window.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const url = Deno.env.get("SUPABASE_URL") || "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const dispatchSecret = Deno.env.get("DIGEST_DISPATCH_SECRET") || "";
const brevoKey = Deno.env.get("BREVO_API_KEY") || "";
const senderEmail = Deno.env.get("MAIL_FROM_EMAIL") || "";
const senderName = Deno.env.get("MAIL_FROM_NAME") || "TeamWorkt Safety";
const dashboardUrl = Deno.env.get("DASHBOARD_URL") || "https://mikelifesfood.github.io/RBH/dashboard.html";
const json = (body:unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers:{"content-type":"application/json","cache-control":"no-store"}
});
const htmlEscape = (v:unknown) => String(v??"").replace(/[&<>"']/g, c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c] || c));
const mondayMorning = (timezone:string, now:Date) => {
  const p=new Intl.DateTimeFormat("en-US",{
    timeZone:timezone, weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(now);
  const get=(type:string)=>p.find(x=>x.type===type)?.value||"";
  return get("weekday")==="Mon" && Number(get("hour"))===8 && Number(get("minute"))<15;
};
type Row = Record<string,unknown>;
Deno.serve(async (req:Request) => {
  if(req.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);
  // This function does not accept user JWTs as dispatch authorization.
  // An unset secret disables the entire dispatcher.
  if(!dispatchSecret || req.headers.get("x-digest-dispatch-key")!==dispatchSecret)
    return json({error:"DISPATCH_DISABLED"},503);
  if(!url||!key||!brevoKey||!senderEmail) return json({error:"DELIVERY_NOT_CONFIGURED"},503);
  const svc=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=new Date();
  let checked=0,claimed=0,sent=0,failed=0;
  for(let page=0;page<100;page++){
    const {data:companies,error:companyError}=await svc.from("safety_pulse_digest_settings")
      .select("organization_id,enabled,delivery_ready,timezone,weekday,local_hour,local_minute")
      .eq("enabled",true).eq("delivery_ready",true)
      .range(page*100,(page+1)*100-1);
    if(companyError) return json({error:"CONFIGURATION_READ_FAILED"},500);
    if(!companies?.length)break;
    for(const config of companies){
      checked++;
      if(config.weekday!==1 || config.local_hour!==8 || config.local_minute!==0)continue;
      try {if(!mondayMorning(config.timezone,now))continue;}
      catch(e){console.error("Invalid digest timezone",config.organization_id,e);continue;}
      const orgId=String(config.organization_id);
      const {data:stats,error:statsError}=await svc.rpc("rbh_digest_service_snapshot",{
        p_organization_id:orgId,p_reference_at:now.toISOString()
      });
      if(statsError){console.error("Digest snapshot failed",orgId,statsError);failed++;continue;}
      const weekStart=String(stats.week_start);
      const {data:organization}=await svc.from("organizations").select("name").eq("id",orgId).single();
      const {data:profiles,error:profileError}=await svc.from("profiles")
        .select("id,email,full_name,app_role,is_active,access_deleted_at,organization_id,current_organization_id")
        .in("app_role",["admin","safety_manager"]).eq("is_active",true)
        .is("access_deleted_at",null);
      if(profileError){console.error("Digest recipients query failed",orgId,profileError);failed++;continue;}
      const recipients=(profiles||[]).filter(p=>
        String(p.current_organization_id||p.organization_id||"")===orgId &&
        !!String(p.email||"").trim()
      );
      const num=(k:string)=>Number((stats as Row)[k]||0).toLocaleString("en-US");
      const companyName=String(organization?.name||"Your company");
      const subject="Weekly Safety Pulse | "+companyName;
      const rows=[
        ["Overdue corrective actions","overdue_actions"],
        ["Waiting for verification","awaiting_review"],
        ["New reports last week","new_reports"],
        ["Reports closed last week","closed_reports"],
        ["Corrective actions completed last week","completed_actions"]
      ];
      const plain=rows.map(([label,k])=>label+": "+num(k)).join("\n");
      const htmlRows=rows.map(([label,k])=>'<tr><td style="padding:10px;border-bottom:1px solid #ddd">'+htmlEscape(label)+'</td><td style="padding:10px;text-align:right;border-bottom:1px solid #ddd"><b>'+num(k)+'</b></td></tr>').join("");
      const html='<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">'+
        '<h2>Weekly Safety Pulse</h2><p>'+htmlEscape(companyName)+'</p>'+
        '<p>Week of '+htmlEscape(stats.week_start)+' through '+htmlEscape(stats.week_end)+'</p>'+
        '<table style="width:100%;border-collapse:collapse">'+htmlRows+'</table>'+
        '<p style="margin-top:20px"><a href="'+htmlEscape(dashboardUrl)+'">Open the safety dashboard</a></p>'+
        '<p style="font-size:12px;color:#677085">This is a summary only. Sign in to view report details.</p></div>';
      for(const person of recipients){
        // Unique row claims a recipient/week before any email call.
        // Failed or ambiguous sends are not automatically retried, avoiding duplicates.
        const {data:claim,error:claimError}=await svc.from("safety_pulse_digest_deliveries")
          .insert({organization_id:orgId,week_start:weekStart,recipient_user_id:person.id,
            recipient_email:String(person.email).trim(),status:"claimed"})
          .select("id").single();
        if(claimError){if(claimError.code!=="23505")console.error("Digest claim failed",claimError);continue;}
        claimed++;
        try{
          const response=await fetch("https://api.brevo.com/v3/smtp/email",{
            method:"POST",headers:{"api-key":brevoKey,"content-type":"application/json",accept:"application/json"},
            body:JSON.stringify({
              sender:{name:senderName,email:senderEmail},
              to:[{email:String(person.email).trim(),name:person.full_name||undefined}],
              subject,htmlContent:html,
              textContent:"Weekly Safety Pulse\n"+companyName+"\nWeek of "+weekStart+
                " through "+String(stats.week_end)+"\n\n"+plain+"\n\nOpen the dashboard: "+dashboardUrl,
              tags:["safety-pulse-weekly"]
            })
          });
          const provider=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error("EMAIL_PROVIDER_"+response.status);
          await svc.from("safety_pulse_digest_deliveries").update({
            status:"sent",sent_at:new Date().toISOString(),
            provider_message_id:provider.messageId||provider.id||null
          }).eq("id",claim.id);
          sent++;
        }catch(e){
          failed++;
          console.error("Digest send failed",orgId,person.id,e);
          await svc.from("safety_pulse_digest_deliveries").update({
            status:"failed",error_message:String(e).slice(0,250)
          }).eq("id",claim.id);
        }
      }
    }
    if(companies.length<100)break;
  }
  return json({checked,claimed,sent,failed});
});
