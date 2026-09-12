 // ============================================================================
// FB MULTI-SESSION — Content Script
// ============================================================================

(function () {
  'use strict';

  console.log("[FB Multi-Session] Content script ACTIVE on:", location.hostname);

  async function clearAllPageStorage() {
    const result = {
      localStorage: false,
      sessionStorage: false,
      indexedDB: 0,
      caches: 0,
      serviceWorkers: 0
    };

    try { localStorage.clear(); result.localStorage = true; } catch (e) {}
    try { sessionStorage.clear(); result.sessionStorage = true; } catch (e) {}

    try {
      if (window.indexedDB && indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            try { indexedDB.deleteDatabase(db.name); result.indexedDB++; } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        for (const key of keys) {
          try { await caches.delete(key); result.caches++; } catch (e) {}
        }
      }
    } catch (e) {}

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          try { await reg.unregister(); result.serviceWorkers++; } catch (e) {}
        }
      }
    } catch (e) {}

    return result;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === "clearPageStorage") {
      clearAllPageStorage().then((result) => {
        console.log("[FB Multi-Session] Page storage cleared:", result);
        sendResponse({ ok: true, result });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
  });
})();