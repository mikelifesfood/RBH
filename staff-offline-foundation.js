/* TeamWorkt Safety — staff offline foundation (experimental, NOT activated).
 * Deliberately not imported by dashboard.html or the public report form.
 * Encrypted draft storage only: no automatic submit, sync, or workflow transitions.
 * Key derives from an independently supplied passphrase, never a Supabase JWT.
 */
(function (root) {
  'use strict';
  const DB = 'teamworkt-staff-offline-v1', STORE = 'encrypted_drafts', VERSION = 1;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const ITERATIONS = 310000;
  let unlocked = null; // in-memory passphrase; never persisted
  function assertScope(scope) {
    if (!scope || !['organizationId','userId','reportId','step'].every(k => typeof scope[k] === 'string' && scope[k].length > 0)) throw Error('INVALID_STAFF_DRAFT_SCOPE');
    if (!Number.isInteger(scope.generation) || scope.generation < 0) throw Error('INVALID_WORKFLOW_GENERATION');
    if (scope.actionId != null && typeof scope.actionId !== 'string') throw Error('INVALID_ACTION_SCOPE');
  }
  function id(scope) {
    assertScope(scope);
    return JSON.stringify([scope.organizationId,scope.userId,scope.reportId,scope.actionId || '',scope.generation,scope.step]);
  }
  function b64(bytes) {
    let result=''; for (const x of bytes) result+=String.fromCharCode(x);
    return btoa(result);
  }
  function unb64(value) { return Uint8Array.from(atob(value), ch=>ch.charCodeAt(0)); }
  function open() {
    return new Promise((resolve,reject) => {
      if (!root.indexedDB) return reject(Error('DEVICE_STORAGE_UNAVAILABLE'));
      const request=indexedDB.open(DB, VERSION);
      request.onupgradeneeded=()=>{if (!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
      request.onerror=()=>reject(request.error || Error('DEVICE_STORAGE_ERROR'));
      request.onblocked=()=>reject(Error('DEVICE_STORAGE_BUSY'));
      request.onsuccess=()=>resolve(request.result);
    });
  }
  async function transaction(mode,callback) {
    const db=await open();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,mode);
        let result;
        tx.onerror=()=>reject(tx.error || Error('DEVICE_STORAGE_ERROR'));
        tx.onabort=()=>reject(tx.error || Error('DEVICE_STORAGE_ABORTED'));
        tx.oncomplete=()=>resolve(result);
        try {result=callback(tx.objectStore(STORE));} catch(e) {tx.abort();reject(e);}
      });
    } finally { db.close(); }
  }
  async function fetchRecord(key) {
    const db=await open();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(key);
        req.onsuccess=()=>resolve(req.result || null);
        req.onerror=()=>reject(req.error || Error('DEVICE_STORAGE_ERROR'));
        tx.onabort=()=>reject(tx.error || Error('DEVICE_STORAGE_ABORTED'));
      });
    } finally {db.close();}
  }
  async function derive(passphrase,salt) {
    const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  const api = {
    unlock(passphrase) {
      if (!root.isSecureContext || !root.crypto?.subtle) throw Error('SECURE_CONTEXT_REQUIRED');
      if (typeof passphrase !== 'string' || passphrase.length < 12) throw Error('PASSPHRASE_TOO_SHORT');
      unlocked=passphrase;
    },
    lock(){unlocked=null;},
    isUnlocked(){return unlocked !== null;},
    async saveDraft(scope,data,serverRevision) {
      if (!unlocked) throw Error('OFFLINE_DRAFT_LOCKED');
      if (data === undefined || data === null || typeof data !== 'object') throw Error('INVALID_DRAFT_DATA');
      const key=id(scope),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
      // JSON data only in this first foundation. Images require a separate encrypted binary store.
      const payload=JSON.stringify({data,serverRevision:serverRevision ?? null});
      if (payload.length > 512000) throw Error('DRAFT_TOO_LARGE');
      const cryptKey=await derive(unlocked,salt);
      const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(key)},cryptKey,encoder.encode(payload));
      const record={id:key,scope:{...scope},salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext)),savedAt:new Date().toISOString(),format:1};
      await transaction('readwrite',store=>store.put(record));
      // Read back committed value before indicating that a draft is saved.
      const verified=await fetchRecord(key);
      if (!verified || verified.ciphertext !== record.ciphertext) throw Error('DRAFT_WRITE_NOT_VERIFIED');
      return {status:'saved_on_this_device',savedAt:record.savedAt};
    },
    async readDraft(scope) {
      if (!unlocked) throw Error('OFFLINE_DRAFT_LOCKED');
      const key=id(scope),record=await fetchRecord(key);
      if (!record) return null;
      const cryptKey=await derive(unlocked,unb64(record.salt));
      let plaintext;
      try {
        plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(record.iv),additionalData:encoder.encode(key)},cryptKey,unb64(record.ciphertext));
      } catch (_) {throw Error('OFFLINE_DRAFT_CANNOT_DECRYPT');}
      return {...JSON.parse(decoder.decode(plaintext)),savedAt:record.savedAt};
    },
    async deleteDraft(scope) {
      const key=id(scope); await transaction('readwrite',store=>store.delete(key));
      if (await fetchRecord(key)) throw Error('DRAFT_DELETE_NOT_VERIFIED');
    },
    // Metadata only, scoped to a user+tenant; never exposes plaintext without unlock.
    async listDrafts(organizationId,userId) {
      if (!unlocked) throw Error('OFFLINE_DRAFT_LOCKED');
      const db=await open();
      try {
        return await new Promise((resolve,reject)=>{
          const entries=[],tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).openCursor();
          req.onsuccess=()=>{const cur=req.result;if (!cur)return;const r=cur.value;
            if (r.scope.organizationId===organizationId && r.scope.userId===userId) entries.push({scope:r.scope,savedAt:r.savedAt});
            cur.continue();
          };
          req.onerror=()=>reject(req.error || Error('DEVICE_STORAGE_ERROR'));
          tx.oncomplete=()=>resolve(entries);
          tx.onabort=()=>reject(tx.error || Error('DEVICE_STORAGE_ABORTED'));
        });
      } finally {db.close();}
    }
  };
  root.TeamWorktStaffOfflineFoundation=Object.freeze(api);
})(window);
