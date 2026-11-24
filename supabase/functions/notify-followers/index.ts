import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const API_KEY = Deno.env.get("BREVO_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("MAIL_FROM_EMAIL") || "";
const FROM_NAME = Deno.env.get("MAIL_FROM_NAME") || "RBH Safety";
const SECRET = Deno.env.get("WEBHOOK_SECRET_NEXT") || "";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, ch =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[ch]);
}
function text(value: unknown): string { return String(value ?? "").trim(); }
function detailRow(label: string, value: unknown): string {
  if (!text(value)) return "";
  return `<tr><td style="padding:7px 12px;vertical-align:top;color:#666;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:7px 12px;color:#1d1d1d">${escapeHtml(value)}</td></tr>`;
}
function htmlShell(heading: string, intro: string, details: string, ending: string): string {
  return `<!doctype html><html><body style="background:#f4f5f5;margin:0;padding:22px 12px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#222"><div style="max-width:640px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #ddd">
    <div style="background:#151515;color:#fff;padding:20px 24px;border-bottom:4px solid #df374b"><b style="font-size:18px">RBH Safety</b></div>
    <div style="padding:23px 24px"><h2 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h2>
    <p>${escapeHtml(intro)}</p><table style="border-collapse:collapse;width:100%">${details}</table><p style="margin-top:22px">${escapeHtml(ending)}</p>
    <p style="color:#777;font-size:12px;border-top:1px solid #eee;padding-top:15px">This is an automated report follower notification from RBH Safety.</p></div></div></body></html>`;
}

Deno.serve(async (req: Request) => {
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  if(!SECRET||req.headers.get("x-webhook-secret")!==SECRET)return new Response("Unauthorized",{status:401});
  if(!BASE||!SERVICE_KEY||!API_KEY||!FROM_EMAIL)return new Response("Mail configuration unavailable",{status:503});
  const body=await req.json().catch(()=>({}));
  const id=text(body?.eventId);
  if(!/^[0-9a-f-]{36}$/i.test(id))return new Response("Invalid event",{status:400});
  const db=createClient(BASE,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:event,error:eventError}=await db.from("rbh_report_follower_email_outbox").select("*").eq("id",id).maybeSingle();
  if(eventError||!event)return new Response("Event unavailable",{status:404});
  if(["sent","skipped"].includes(event.status))return Response.json({ok:true,duplicate:true});
  if(event.status==="sending")return Response.json({ok:true,inProgress:true});
  const {data:claimed,error:claimError}=await db.from("rbh_report_follower_email_outbox")
    .update({status:"sending",attempts:(event.attempts||0)+1,updated_at:new Date().toISOString(),error_message:null})
    .eq("id",id).in("status",["queued","failed"]).select("*").maybeSingle();
  if(claimError)return new Response("Event claim unavailable",{status:503});
  if(!claimed)return Response.json({ok:true,inProgress:true});
  async function mark(status:string, reason?:string, providerId?:string){
    await db.from("rbh_report_follower_email_outbox").update({
      status,error_message:reason||null,provider_message_id:providerId||null,
      sent_at:status==="sent"?new Date().toISOString():null,updated_at:new Date().toISOString()
    }).eq("id",id).eq("status","sending");
  }
  try{
    const [{data:follower,error:followerError},{data:report,error:reportError},{data:setting,error:settingError}]=await Promise.all([
      db.from("rbh_report_followers").select("*").eq("id",claimed.follower_id).single(),
      db.from("reports").select("*").eq("id",claimed.report_id).single(),
      db.from("report_email_settings").select("delivery_mode").eq("organization_id",claimed.organization_id).maybeSingle()
    ]);
    if(followerError||reportError||settingError)throw new Error("Report, follower, or notification settings could not be checked");
    if(!report||!follower||!follower.is_active||follower.email!==claimed.recipient_email
      ||report.organization_id!==claimed.organization_id||follower.organization_id!==claimed.organization_id
      ||follower.report_id!==report.id){
      await mark("skipped","Follower removed or no longer eligible");return Response.json({ok:true,skipped:true});
    }
    if(setting?.delivery_mode==="off"){await mark("skipped","Company email notifications disabled");return Response.json({ok:true,skipped:true});}
    const resolved=["closed","no_action","duplicate"].includes(report.status);
    if(claimed.event_type==="report_resolved"&&(!resolved||
      Number(report.workflow_restart_count||0)!==Number(claimed.workflow_restart_count||0)||
      Number(report.reopen_count||0)!==Number(claimed.reopen_count||0))){
      await mark("skipped","Report reopened before notification was sent");return Response.json({ok:true,skipped:true});
    }
    if(claimed.event_type==="follower_added"&&resolved){
      await mark("skipped","Report already resolved");return Response.json({ok:true,skipped:true});
    }
    const ref=String(report.ref_no||String(report.id).slice(0,8));
    const type=text(report.report_type)||"Safety report";
    const rows=[
      detailRow("Report","#"+ref),
      detailRow("Type",type),
      detailRow("Job site",report.job_site),
      detailRow("Location",report.site_location),
      detailRow("Hazard",report.hazard_category),
      detailRow("Potential severity",report.potential_severity),
      detailRow("Report summary",report.description)
    ];
    let subject="",heading="",intro="",ending="";
    if(claimed.event_type==="follower_added"){
      subject=`You have been added as a follower — RBH Report #${ref}`;
      heading="You have been added as a report follower";
      intro="You have been added as a follower of the safety report below. You will receive another email when the report is resolved.";
      ending="You are receiving this message because your email address was added to this report's follower list.";
    }else{
      subject=`Safety report resolved — RBH Report #${ref}`;
      heading="Safety report closeout";
      intro=report.status==="closed"
        ?"The safety report below has been closed. The corrective or mitigation outcome documented for this record appears below."
        :"The safety report below has been reviewed and closed with a documented disposition.";
      rows.push(detailRow("Final status",report.status==="closed"?"Closed / resolved":report.status==="no_action"?"Closed — no additional action":"Closed — duplicate"));
      if(report.status==="closed" && report.corrective_action_decision==="not_required"){
        rows.push(detailRow("Outcome","Investigation completed; no additional corrective action was required."));
        rows.push(detailRow("Why no additional action was needed",report.corrective_action_no_action_reason));
        rows.push(detailRow("Documented resolution",report.corrective_action_no_action_note));
      }else if(report.status==="closed"){
        const {data:actions,error:actionsError}=await db.from("report_corrective_actions")
          .select("action_number,description,completion_note,verification_note,status,workflow_generation,activation_reopen_count,retired_at")
          .eq("report_id",report.id).is("retired_at",null).order("action_number",{ascending:true});
        if(actionsError)throw new Error("Corrective-action details unavailable");
        const current=(actions||[]).filter((a:any)=>Number(a.workflow_generation||0)===Number(report.workflow_restart_count||0)
          &&Number(a.activation_reopen_count||0)===Number(report.reopen_count||0));
        if(current.length){
          current.forEach((a:any,i:number)=>{
            rows.push(detailRow("Corrective action "+(i+1)+" of "+current.length,a.description));
            rows.push(detailRow("Work performed "+(i+1),a.completion_note));
            rows.push(detailRow("Verification "+(i+1),a.verification_note));
          });
        }else{
          rows.push(detailRow("Corrective / mitigation action",report.corrective_action));
          rows.push(detailRow("Work performed",report.action_completion_note));
          rows.push(detailRow("Verification",report.action_verification_note));
        }
      }else{
        rows.push(detailRow("Outcome",report.status==="duplicate"?
          "This record was closed as a duplicate.":"The review determined that no additional corrective action was required."));
        rows.push(detailRow("Disposition reason",report.corrective_action_no_action_reason));
        rows.push(detailRow("Resolution explanation",report.corrective_action_no_action_note));
      }
      ending="This report is no longer open. Any recorded follow-up and corrective-action information is included above.";
    }
    const htmlContent=htmlShell(heading,intro,rows.join(""),ending);
    const plainLines=[heading,"",intro,"",...rows.map((r)=>r.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").trim()),"",ending].join("\n");
    const send=await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",headers:{"api-key":API_KEY,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({sender:{email:FROM_EMAIL,name:FROM_NAME},to:[{email:claimed.recipient_email}],subject,htmlContent,textContent:plainLines})
    });
    const provider=await send.json().catch(()=>({}));
    if(!send.ok)throw new Error(`Brevo ${send.status}: ${String(provider.message||"Failed to send").slice(0,170)}`);
    await mark("sent",undefined,text(provider.messageId));
    return Response.json({ok:true,sent:true});
  }catch(err){
    console.error("Follower email failed",err);
    await mark("failed",String(err instanceof Error?err.message:err).slice(0,350));
    return new Response("Follower email not delivered",{status:503});
  }
});