/* TeamWorkt Build 7 — browser Turnstile integration.
 * This module uses the protected Edge Function only when explicitly enabled
 * by its server config. It never caches or stores Turnstile tokens in IndexedDB.
 * STAGING ONLY: legacy fallback stays allowed until verified secure cutover.
 */
(function(){
'use strict';
var BASE='https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/submit-public-report';
var STAGING_LEGACY_FALLBACK=true; // CHANGE TO false during enforced cutover, along with revoking anonymous RPC.
var PREVIEW=!!(window.location&&new URLSearchParams(window.location.search).get('build7_preview')==='1');
var config=null,configTime=0,configPromise=null,challengePromise=null,scriptPromise=null;
function spanish(){return (document.documentElement.lang||'en').indexOf('es')===0;}
function localized(en,es){return spanish()?es:en;}
function fail(message,code){var e=new Error(message);e.code=code;return e;}
async function getConfig(){
  if(navigator.onLine===false)throw fail('OFFLINE_NOT_SENT','OFFLINE_NOT_SENT');
  if(config&&Date.now()-configTime<15000)return config;
  if(configPromise)return configPromise;
  configPromise=(async function(){
    var response=await fetch(BASE+(PREVIEW?'?preview=1':''),{method:'GET',cache:'no-store'});
    if(!response.ok)throw fail('PROTECTION_CONFIG_UNAVAILABLE','PROTECTION_CONFIG_UNAVAILABLE');
    var result=await response.json();
    if(!result||!['protected','legacy','not_ready'].includes(result.mode))
      throw fail('PROTECTION_CONFIG_INVALID','PROTECTION_CONFIG_INVALID');
    config=result;configTime=Date.now();return config;
  })().catch(function(e){
    if(!STAGING_LEGACY_FALLBACK||PREVIEW)throw e;
    // During staging only. Production will fail closed with the explicit flag.
    console.warn('RBH intake protection is in legacy staging mode',e&&e.code||'CONFIG_UNAVAILABLE');
    return {mode:'legacy',ready:false};
  }).finally(function(){configPromise=null;});
  return configPromise;
}
function loadScript(){
  if(window.turnstile&&typeof window.turnstile.render==='function')return Promise.resolve();
  if(scriptPromise)return scriptPromise;
  scriptPromise=new Promise(function(resolve,reject){
    var script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;script.defer=true;
    script.onload=function(){window.turnstile&&window.turnstile.render?resolve():reject(fail('TURNSTILE_SCRIPT_UNAVAILABLE','VERIFICATION_REQUIRED'));};
    script.onerror=function(){reject(fail('TURNSTILE_SCRIPT_UNAVAILABLE','VERIFICATION_REQUIRED'));};
    document.head.appendChild(script);
  }).catch(function(e){scriptPromise=null;throw e;});
  return scriptPromise;
}
function askChallenge(settings){
  if(challengePromise)return challengePromise;
  challengePromise=(async function(){
    await loadScript();
    return new Promise(function(resolve,reject){
      var done=false,id=null;
      var overlay=document.createElement('div');
      overlay.id='rbhTurnstileOverlay';
      overlay.style.cssText='position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.54);display:flex;align-items:center;justify-content:center;padding:18px;';
      var card=document.createElement('section');
      card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby','rbhVerifyTitle');
      card.style.cssText='background:#fff;color:#191919;border-radius:12px;padding:22px;max-width:min(400px,100%);width:100%;box-shadow:0 16px 44px #0005;font:14px/1.55 system-ui,-apple-system,sans-serif;';
      var title=document.createElement('h2');title.id='rbhVerifyTitle';title.textContent=localized('Verify to send safety report','Verifique para enviar el reporte');
      title.style.cssText='font-size:19px;line-height:1.3;margin:0 0 8px';
      var description=document.createElement('p');
      description.textContent=localized('This report is still saved on your device. Complete the brief security check to send it to the safety team.','El reporte sigue guardado en este dispositivo. Complete la verificación de seguridad para enviarlo.');
      description.style.cssText='margin:0 0 15px;font-size:13px;';
      var host=document.createElement('div');host.id='rbhTurnstileHost';
      var note=document.createElement('p');note.textContent='';note.style.cssText='font-size:12px;min-height:18px;line-height:1.45;color:#7d2424;margin:9px 0;';
      var actions=document.createElement('div');actions.style.cssText='display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
      var cancel=document.createElement('button');cancel.type='button';cancel.textContent=localized('Not now — keep saved','Ahora no — guardar');
      var retry=document.createElement('button');retry.type='button';retry.textContent=localized('Try verification again','Reintentar verificación');
      for(var btn of [cancel,retry])btn.style.cssText='padding:11px 13px;min-height:44px;border:1px solid #bbb;border-radius:8px;background:#fff;color:#222;font:700 13px system-ui;cursor:pointer';
      retry.style.background='#a1182c';retry.style.color='#fff';retry.hidden=true;
      actions.append(cancel,retry);card.append(title,description,host,note,actions);overlay.appendChild(card);
      document.body.appendChild(overlay);cancel.focus();
      var cleanup=function(){
        if(id!==null&&window.turnstile){try{window.turnstile.remove(id)}catch(e){}}
        overlay.remove();
      };
      var finish=function(err,token){
        if(done)return;done=true;cleanup();
        if(err)reject(err);else resolve(token);
      };
      cancel.addEventListener('click',function(){finish(fail('VERIFICATION_CANCELLED','VERIFICATION_REQUIRED'));});
      overlay.addEventListener('keydown',function(e){
        if(e.key==='Escape'){e.preventDefault();finish(fail('VERIFICATION_CANCELLED','VERIFICATION_REQUIRED'));}
      });
      retry.addEventListener('click',function(){
        retry.hidden=true;note.textContent='';
        try{window.turnstile.reset(id)}catch(e){finish(fail('VERIFICATION_UNAVAILABLE','VERIFICATION_REQUIRED'));}
      });
      try{
        id=window.turnstile.render(host,{
          sitekey:settings.sitekey,action:settings.action||'rbh_public_report',
          theme:'light',appearance:'always',
          callback:function(token){if(typeof token==='string'&&token.length>9)finish(null,token);},
          'expired-callback':function(){note.textContent=localized('Verification expired. Please try again.','Verificación vencida. Intente de nuevo.');retry.hidden=false;},
          'error-callback':function(){note.textContent=localized('Unable to verify right now. Retry or keep this report saved.','No se puede verificar ahora. Reintente o guarde el reporte.');retry.hidden=false;}
        });
      }catch(e){finish(fail('VERIFICATION_UNAVAILABLE','VERIFICATION_REQUIRED'))}
    });
  })().finally(function(){challengePromise=null;});
  return challengePromise;
}
async function protectedSubmit(payload){
  var settings=await getConfig();
  if(settings.mode==='not_ready')throw fail('SECURITY_VERIFICATION_NOT_READY','PROTECTION_NOT_CONFIGURED');
  if(settings.mode!=='protected')return null; // staging only; caller uses legacy RPC.
  if(!settings.sitekey||!settings.action)throw fail('SECURITY_VERIFICATION_NOT_READY','PROTECTION_NOT_CONFIGURED');
  var token=await askChallenge(settings);
  var response;
  try{
    response=await fetch(BASE,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
      body:JSON.stringify({payload:payload,turnstile_token:token})});
  }catch(e){throw fail('NETWORK_NOT_SENT','NETWORK_NOT_SENT')}
  var body={};
  try{body=await response.json()}catch(e){}
  if(!response.ok){
    var code=body.code||'TEMPORARILY_UNAVAILABLE';
    // Never silently fall back to a public RPC after a protected attempt fails.
    throw fail(String(code),String(code));
  }
  if(!body.id||!body.ref_no)throw fail('SERVER_RECEIPT_MISSING','SERVER_RECEIPT_MISSING');
  return {data:body,error:null};
}
async function submit(payload,sb){
  var result=await protectedSubmit(payload);
  if(result)return result;
  if(!STAGING_LEGACY_FALLBACK)throw fail('PROTECTION_NOT_CONFIGURED','PROTECTION_NOT_CONFIGURED');
  return sb.rpc('submit_report',{payload:payload});
}
window.RBHIntake={submit:submit,getConfig:getConfig,
  isStagingLegacy:function(){return STAGING_LEGACY_FALLBACK;},isPreview:function(){return PREVIEW;}};
})();
