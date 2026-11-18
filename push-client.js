/* RBH staff PWA push controls: opt-in only, never used on anonymous reporting form. */
(function(){
  "use strict";
  var sb=null,busy=false,registeredFor=null;
  var box,info,enable,disable,test;
  function standalone(){return (window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;}
  function ios(){return /iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);}
  function available(){return window.isSecureContext&&"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;}
  function show(message){if(info)info.textContent=message;}
  function controls(on){if(enable)enable.disabled=busy||!on;if(disable)disable.disabled=busy||!on;if(test)test.disabled=busy||!on;}
  function decodeKey(base64){
    var padded=base64.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-base64.length%4)%4);
    return Uint8Array.from(atob(padded),function(c){return c.charCodeAt(0);});
  }
  async function call(action,payload){
    if(!sb)throw Error("Sign in to manage notifications.");
    var session=await sb.auth.getSession();
    var token=session&&session.data&&session.data.session&&session.data.session.access_token;
    if(!token)throw Error("Your session has expired. Please sign in again.");
    // supabase-js includes the project API key and live session JWT.
    var result=await sb.functions.invoke("push-subscriptions",{
      body:Object.assign({action:action},payload||{})
    });
    if(result.error)throw Error("Push settings are currently unavailable. Please try again.");
    return result.data;
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
      var state=await currentSubscription();
      var status=await call("status",{endpoint:state.subscription?state.subscription.endpoint:null});
      if(state.subscription&&status.deviceRegistered){
        show("Push notifications are enabled on this device. Email and in-app alerts remain active.");
        if(enable){enable.hidden=true;}if(disable){disable.hidden=false;}if(test)test.hidden=false;controls(true);
      }else{
        show(status.configured?"Push is off on this device. Enable it to receive RBH Safety alerts even when the app is closed.":"Push setup is not yet available. Email and in-app alerts remain active.");
        if(enable){enable.hidden=false;}if(disable){disable.hidden=true;}if(test)test.hidden=true;controls(!!status.configured);
      }
    }catch(e){show("Could not check push settings. Your existing RBH alerts continue working.");controls(false);}
  }
  async function enablePush(){
    if(busy)return;busy=true;controls(false);
    try{
      if(!available()||(ios()&&!standalone()))throw Error("Install the staff PWA or use a supported browser.");
      // On iOS and Chromium, request permission before any asynchronous network work
      // so the user activation from this exact click is preserved.
      var permission=await Notification.requestPermission();
      if(permission!=="granted")throw Error("Notifications were not allowed. You can continue using RBH email and in-app alerts.");
      var status=await call("status");if(!status.configured||!status.publicKey)throw Error("Push setup is not yet configured.");
      var state=await currentSubscription();
      if(state.subscription){
        var current=await call("status",{endpoint:state.subscription.endpoint});
        if(!current.deviceRegistered){
          // A shared browser or old session must never reuse another account's endpoint.
          await state.subscription.unsubscribe();
          state.subscription=null;
        }
      }
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
  async function sendSelfTest(){
    if(busy)return;busy=true;controls(false);
    try{
      var state=await currentSubscription();
      if(!state.subscription)throw Error("Enable push on this device before sending a test.");
      var session=await sb.auth.getSession();
      if(!session.data||!session.data.session)throw Error("Please sign in again.");
      var result=await sb.functions.invoke("push-test-device",{
        body:{action:"send_test",endpoint:state.subscription.endpoint}
      });
      if(result.error){
        var status=result.context&&result.context.status;
        if(status===429)throw Error("For safety, wait two minutes between test notifications.");
        throw Error("Test notification could not be delivered. Contact the RBH administrator.");
      }
      if(!result.data||result.data.accepted!==true)throw Error("Push provider did not accept the test.");
      show("Test accepted by the push provider. Check this device's system notifications.");
    }catch(e){show(e&&e.message?e.message:"Could not send test notification.");}
    finally{busy=false;controls(true);}
  }
  async function beforeSignOut(all){
    if(!sb)return {revoked:false};
    // Push cleanup is best-effort. Sign-out must remain possible when the
    // function, browser push service, or network is unavailable. The push
    // dispatcher independently rejects subscriptions from revoked sessions.
    var revoked=false;
    try{
      await call(all?"disable_all":"disable_session");
      revoked=true;
    }catch(e){console.warn("RBH push server revocation unavailable during sign-out",e);}
    if(available()){
      try{
        var registration=await Promise.race([
          navigator.serviceWorker.ready,
          new Promise(function(resolve){setTimeout(function(){resolve(null);},1500);})
        ]);
        if(registration){
          var subscription=await registration.pushManager.getSubscription();
          if(subscription)await subscription.unsubscribe();
        }
      }catch(e){console.warn("RBH device push unsubscribe unavailable during sign-out",e);}
    }
    registeredFor=null;
    return {revoked:revoked};
  }
  function init(client){
    sb=client;
    box=document.getElementById("rbhPushSettings");
    if(!box)return;
    box.hidden=false;
    info=document.getElementById("rbhPushStatus");
    enable=document.getElementById("rbhPushEnable");
    disable=document.getElementById("rbhPushDisable");
    test=document.getElementById("rbhPushTest");
    if(!box.dataset.wired){
      box.dataset.wired="1";
      enable.addEventListener("click",enablePush);
      disable.addEventListener("click",disablePush);
      if(test)test.addEventListener("click",sendSelfTest);
    }
    refresh();
  }
  window.RBHPush={init:init,beforeSignOut:beforeSignOut,refresh:refresh};
})();