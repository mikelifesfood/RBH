/* RBH staff PWA push controls: opt-in only, never used on anonymous reporting form. */
(function(){
  "use strict";
  var sb=null,busy=false,registeredFor=null;
  var box,info,enable,disable;
  var endpointUrl="https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/push-subscriptions";
  function standalone(){return (window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;}
  function ios(){return /iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);}
  function available(){return window.isSecureContext&&"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;}
  function show(message){if(info)info.textContent=message;}
  function controls(on){if(enable)enable.disabled=busy||!on;if(disable)disable.disabled=busy||!on;}
  function decodeKey(base64){
    var padded=base64.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-base64.length%4)%4);
    return Uint8Array.from(atob(padded),function(c){return c.charCodeAt(0);});
  }
  async function call(action,payload){
    if(!sb)throw Error("Sign in to manage notifications.");
    var session=await sb.auth.getSession();
    var token=session&&session.data&&session.data.session&&session.data.session.access_token;
    if(!token)throw Error("Your session has expired. Please sign in again.");
    var response=await fetch(endpointUrl,{method:"POST",cache:"no-store",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
      body:JSON.stringify(Object.assign({action:action},payload||{}))});
    var data=await response.json();
    if(!response.ok)throw Error(data.error||"Push settings are unavailable.");
    return data;
  }
  async function currentSubscription(){
    var worker=await navigator.serviceWorker.ready;
    return {worker:worker,subscription:await worker.pushManager.getSubscription()};
  }
  async function refresh(){
    if(!box||box.hidden||!sb)return;
    if(!available()){show("This browser does not support PWA push. Email and the notification bell remain available.");controls(false);return;}
    if(ios()&&!standalone()){show("On iPhone or iPad, install the RBH staff dashboard to your Home Screen first, then enable notifications inside the installed app.");controls(false);return;}
    if(Notification.permission==="denied"){show("Notifications are blocked in device or browser settings. Allow them there to enable push.");controls(false);return;}
    try{
      var status=await call("status");
      var state=await currentSubscription();
      if(state.subscription){
        show("This device has a browser push subscription. You may disable it below. Email and in-app alerts remain active.");
        if(enable){enable.hidden=true;}if(disable){disable.hidden=false;}controls(true);
      }else{
        show(status.configured?"Push is off on this device. Enable it to receive RBH Safety alerts even when the app is closed.":"Push setup is not yet available. Email and in-app alerts remain active.");
        if(enable){enable.hidden=false;}if(disable){disable.hidden=true;}controls(!!status.configured);
      }
    }catch(e){show("Could not check push settings. Your existing RBH alerts continue working.");controls(false);}
  }
  async function enablePush(){
    if(busy)return;busy=true;controls(false);
    try{
      if(!available()||(ios()&&!standalone()))throw Error("Install the staff PWA or use a supported browser.");
      var status=await call("status");if(!status.configured||!status.publicKey)throw Error("Push setup is not yet configured.");
      // Permission is requested only from a direct click.
      var permission=await Notification.requestPermission();
      if(permission!=="granted")throw Error("Notifications were not allowed. You can continue using RBH email and in-app alerts.");
      var state=await currentSubscription();
      var subscription=state.subscription||await state.worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(status.publicKey)});
      var keys=subscription.toJSON().keys||{};
      await call("register",{endpoint:subscription.endpoint,subscription:{p256dh:keys.p256dh,auth:keys.auth}});
      registeredFor=subscription.endpoint;show("Push subscription saved for this device.");
    }catch(e){show(e&&e.message?e.message:"Unable to enable notifications.");}
    finally{busy=false;await refresh();}
  }
  async function disablePush(){
    if(busy)return;busy=true;controls(false);
    try{
      var state=await currentSubscription();
      if(state.subscription){
        await call("disable",{endpoint:state.subscription.endpoint});
        await state.subscription.unsubscribe();
      }
      registeredFor=null;
      show("Push notifications disabled on this device.");
    }catch(e){show("Could not disable push. Please try again before signing out.");}
    finally{busy=false;await refresh();}
  }
  async function beforeSignOut(all){
    if(!sb||!available())return;
    try{
      var state=await currentSubscription();
      if(state.subscription){
        await call("disable",{endpoint:state.subscription.endpoint});
        await state.subscription.unsubscribe();
      }
      registeredFor=null;
    }catch(e){throw Error("Could not revoke this device's push subscription. Please retry before signing out.");}
  }
  function init(client){
    sb=client;
    box=document.getElementById("rbhPushSettings");
    if(!box)return;
    box.hidden=false;
    info=document.getElementById("rbhPushStatus");
    enable=document.getElementById("rbhPushEnable");
    disable=document.getElementById("rbhPushDisable");
    if(!box.dataset.wired){
      box.dataset.wired="1";
      enable.addEventListener("click",enablePush);
      disable.addEventListener("click",disablePush);
    }
    refresh();
  }
  window.RBHPush={init:init,beforeSignOut:beforeSignOut,refresh:refresh};
})();