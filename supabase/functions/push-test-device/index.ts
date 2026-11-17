// RBH controlled one-device self-test. Explicit opt-in only; does NOT enable global dispatch.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,"0")).join("");
const validEndpoint=(endpoint:string)=>{try{
  const u=new URL(endpoint),h=u.hostname.toLowerCase();
  return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.hash&&(
    h==="fcm.googleapis.com"||h==="updates.push.services.mozilla.com"||h==="android.googleapis.com"||
    h==="web.push.apple.com"||h==="api.push.apple.com"||h.endsWith(".push.apple.com")||
    h.endsWith(".notify.windows.com")||h.endsWith(".wns.windows.com")
  );
}catch{return false;}};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!serviceKey)return json({error:"SERVICE_UNAVAILABLE"},503);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({error:"AUTH_REQUIRED"},401);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:identityError}=await auth.auth.getUser(token);
  if(identityError||!identity.user||identity.user.is_anonymous)return json({error:"AUTH_REQUIRED"},401);
  let sessionId="";
  try{
    const part=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    sessionId=String(JSON.parse(atob(part+"=".repeat((4-part.length%4)%4))).session_id||"");
  }catch{}
  if(!/^[0-9a-f-]{36}$/i.test(sessionId))return json({error:"VALID_SESSION_REQUIRED"},401);
  let body:Record<string,unknown>;
  try{body=await req.json();if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}catch{return json({error:"INVALID_JSON"},400);}
  if(body.action!=="send_test"||typeof body.endpoint!=="string"||body.endpoint.length>2048||!validEndpoint(body.endpoint))
    return json({error:"INVALID_TEST_DEVICE"},400);
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const userId=identity.user.id;
  const {data:profile,error:profileError}=await service.from("profiles")
    .select("id,is_active,access_deleted_at,organization_id,current_organization_id")
    .eq("id",userId).maybeSingle();
  if(profileError||!profile||profile.is_active!==true||profile.access_deleted_at)return json({error:"ACTIVE_ACCOUNT_REQUIRED"},403);
  const org=profile.current_organization_id||profile.organization_id;
  if(!org)return json({error:"COMPANY_REQUIRED"},403);
  const {data:company}=await service.from("organizations").select("id,status").eq("id",org).maybeSingle();
  if(!company||["inactive","suspended","deleted"].includes(String(company.status||"").toLowerCase()))
    return json({error:"COMPANY_INACTIVE"},403);
  const {data:sessionActive,error:sessionError}=await service.rpc("teamworkt_push_session_active",{p_user_id:userId,p_session_id:sessionId});
  if(sessionError||!sessionActive)return json({error:"SESSION_REVOKED"},403);
  const endpointHash=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body.endpoint)));
  const {data:device,error:deviceError}=await service.from("user_push_subscriptions")
    .select("id,user_id,organization_id,auth_session_id,endpoint,p256dh,auth_secret,disabled_at")
    .eq("endpoint_sha256",endpointHash).eq("user_id",userId).eq("organization_id",org).eq("auth_session_id",sessionId)
    .is("disabled_at",null).maybeSingle();
  if(deviceError||!device||device.endpoint!==body.endpoint)return json({error:"DEVICE_NOT_REGISTERED_FOR_YOU"},403);
  const publicKey=Deno.env.get("VAPID_PUBLIC_KEY"),privateKey=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT");
  if(!publicKey||!privateKey||!subject||!(/^(mailto:|https:\/\/)/.test(subject)))return json({error:"VAPID_NOT_CONFIGURED"},503);
  try{webpush.setVapidDetails(subject,publicKey,privateKey);}
  catch{return json({error:"VAPID_INVALID"},503);}
  const {data:claimed,error:claimError}=await service.rpc("teamworkt_push_claim_test",{
    p_subscription_id:device.id,p_user_id:userId,p_session_id:sessionId
  });
  if(claimError)return json({error:"TEST_RATE_LIMIT_UNAVAILABLE"},503);
  if(!claimed)return json({error:"TEST_RATE_LIMIT_TWO_MINUTES"},429);
  try{
    const result=await webpush.sendNotification(
      {endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth_secret}},
      JSON.stringify({tag:"rbh-self-test"}),{TTL:300,urgency:"normal"}
    );
    const now=new Date().toISOString();
    await service.from("user_push_subscriptions").update({last_success_at:now,failure_count:0,updated_at:now}).eq("id",device.id);
    return json({accepted:true,providerStatus:result.statusCode,message:"Test accepted by push provider. Check this device's notifications."});
  }catch(e){
    const status=Number((e as {statusCode?:number})?.statusCode)||null;
    if(status===404||status===410)
      await service.from("user_push_subscriptions").update({disabled_at:new Date().toISOString(),last_failure_at:new Date().toISOString()}).eq("id",device.id);
    return json({error:status===404||status===410?"SUBSCRIPTION_EXPIRED":"PUSH_PROVIDER_REJECTED",providerStatus:status},502);
  }
});
