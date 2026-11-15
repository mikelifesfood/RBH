/* TeamWorkt Safety Build 4: opt-in PWA install and connection guidance.
 * This file does not cache reports, credentials, attachments or submit anything.
 */
(function(){
  'use strict';
  var script=document.currentScript;
  var base=new URL('./',script&&script.src?script.src:location.href);
  var deferredPrompt=null;
  var installButton=null;
  var installCard=null;
  var dismissed=false;
  var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  var isStandalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone===true;
  var isPublicForm=!!document.getElementById('reportForm');

  if('serviceWorker' in navigator && window.isSecureContext){
    window.addEventListener('load',function(){
      navigator.serviceWorker.register(new URL('sw.js',base).href,{scope:base.pathname})
        .catch(function(error){console.warn('RBH PWA service worker unavailable',error);});
    });
  }

  function installCardVisible(){
    return !dismissed&&!isStandalone&&(!!deferredPrompt||isIOS);
  }
  function refreshInstall(){
    if(installCard) installCard.hidden=!installCardVisible();
  }
  function createInstallControls(){
    installCard=document.createElement('aside');
    installCard.id='rbhPwaInstall';
    installCard.setAttribute('aria-label','Install RBH Safety');
    installCard.hidden=true;
    installCard.style.cssText='position:fixed;right:14px;bottom:14px;z-index:900;max-width:min(340px,calc(100vw - 28px));background:#fff;color:#18181b;border:1px solid #d8d8dc;border-radius:12px;box-shadow:0 12px 32px #0003;padding:12px 13px;font:13px/1.45 system-ui,-apple-system,sans-serif';
    var heading=document.createElement('strong');
    heading.textContent='RBH Safety · Add to Home Screen';
    heading.style.cssText='display:block;padding-right:28px;margin-bottom:8px;font-size:13px';
    var dismiss=document.createElement('button');
    dismiss.type='button';
    dismiss.textContent='×';
    dismiss.setAttribute('aria-label','Dismiss install suggestion');
    dismiss.style.cssText='position:absolute;right:8px;top:5px;border:0;background:transparent;color:#666;font-size:23px;cursor:pointer;padding:0 6px';
    dismiss.addEventListener('click',function(){dismissed=true;refreshInstall();});
    installButton=document.createElement('button');
    installButton.type='button';
    installButton.textContent=isIOS?'How to install':'Install RBH Safety';
    installButton.style.cssText='border:0;border-radius:8px;padding:9px 13px;background:#a1182c;color:#fff;font:bold 13px system-ui,-apple-system,sans-serif;cursor:pointer';
    var explanation=document.createElement('div');
    explanation.id='rbhPwaInstructions';
    explanation.hidden=true;
    explanation.style.cssText='margin-top:9px;line-height:1.6';
    installButton.addEventListener('click',async function(){
      if(isIOS){
        explanation.textContent='In Safari, tap the Share icon, choose Add to Home Screen, then tap Add. For the staff dashboard, install while viewing the dashboard page.';
        explanation.hidden=false;
        return;
      }
      if(!deferredPrompt)return;
      var prompt=deferredPrompt;deferredPrompt=null;refreshInstall();
      try{await prompt.prompt();await prompt.userChoice;}catch(e){console.warn('Install prompt did not complete',e);}
    });
    installCard.append(heading,dismiss,installButton,explanation);
    document.body.appendChild(installCard);
    refreshInstall();
  }

  window.addEventListener('beforeinstallprompt',function(event){
    if(isStandalone)return;
    event.preventDefault();
    deferredPrompt=event;
    refreshInstall();
  });
  window.addEventListener('appinstalled',function(){
    deferredPrompt=null;isStandalone=true;refreshInstall();
  });

  function wireOfflineNotice(){
    var form=document.getElementById('reportForm');
    if(!form)return;
    var notice=document.createElement('div');
    notice.id='rbhPwaOfflineNotice';
    notice.setAttribute('role','alert');
    notice.hidden=true;
    notice.style.cssText='max-width:720px;margin:12px auto;padding:13px 16px;border-radius:10px;border:2px solid #ae7020;background:#fff3dc;color:#51330b;font:600 13px/1.55 system-ui,-apple-system,sans-serif';
    form.parentNode.insertBefore(notice,form);
    function status(){
      var offline=navigator.onLine===false;
      notice.hidden=!offline;
      if(offline){
        var spanish=document.documentElement.lang==='es';
        notice.textContent=spanish
          ?'Sin conexión: puede guardar un borrador o poner el reporte y sus fotos en espera en este dispositivo. NO se enviará hasta recuperar la conexión y abrir la aplicación.'
          :'Offline — you can save a draft or queue a report and photos on this device. NOT submitted yet. They will retry when you reconnect and reopen the app.';
      }
    }
    status();
    window.addEventListener('online',status);
    window.addEventListener('offline',status);
    // Build 5: the report form now securely queues submissions in IndexedDB.
    // Do not block the submit event here; the queue module handles offline state.
  }

  function init(){
    createInstallControls();
    if(isPublicForm)wireOfflineNotice();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
