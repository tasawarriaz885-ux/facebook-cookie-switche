 // ============================================================================
// FB MULTI-SESSION — Background Service Worker v3.0
// DNR per-tab cookie isolation + browsingData API for reliable cookie cleanup
// ============================================================================

const tabSessionMap = new Map();

const SESSION_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
];

function getNextColor(index) {
  return SESSION_COLORS[index % SESSION_COLORS.length];
}

// ---------------------------------------------------------------------------
function buildCookieHeader(cookies) {
  if (!cookies) return "";
  if (Array.isArray(cookies)) {
    return cookies
      .filter(c => c && c.name && c.value !== undefined)
      .map(c => `${c.name}=${c.value}`)
      .join("; ");
  }
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
async function applyTabSessionRule(tabId, profile) {
  if (!tabId || !profile || !profile.cookies) return false;

  const cookieHeaderString = buildCookieHeader(profile.cookies);
  if (!cookieHeaderString) return false;

  tabSessionMap.set(tabId, {
    profileName: profile.name || "Account",
    cookies: profile.cookies,
    cookieHeaderString,
    color: profile.color || getNextColor(tabSessionMap.size)
  });

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId],
      addRules: [{
        id: tabId,
        priority: 1000,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{
            header: "Cookie",
            operation: "set",
            value: cookieHeaderString
          }]
        },
        condition: {
          urlFilter: "*://*.facebook.com/*",
          tabIds: [tabId],
          resourceTypes: [
            "main_frame", "sub_frame", "xmlhttprequest",
            "script", "stylesheet", "image", "font",
            "media", "websocket", "other"
          ]
        }
      }]
    });
    console.log(`[FB Multi-Session] ✅ Tab ${tabId} → ${profile.name}`);
    return true;
  } catch (err) {
    console.error(`[FB Multi-Session] ❌ Rule apply fail:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
async function removeTabSessionRule(tabId) {
  tabSessionMap.delete(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId]
    });
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// 🔥 STRONGEST COOKIE CLEAR — 2 methods ek sath
// Method 1: browsingData API (Chrome internal, guaranteed)
// Method 2: cookies.remove() fallback
// ---------------------------------------------------------------------------
async function deleteAllFacebookBrowserCookies() {
  let deleted = 0;

  try {
    console.log("[FB Multi-Session] 🍪 Starting cookie cleanup...");

    // ---- Count cookies pehle ----
    const before = await chrome.cookies.getAll({});
    const fbBefore = before.filter(c => (c.domain || "").toLowerCase().includes("facebook.com"));
    console.log(`[FB Multi-Session] Cookies BEFORE: ${fbBefore.length} FB cookies`);

    // ============================================================
    // METHOD 1: browsingData API — Chrome ki internal API
    // Ye 100% guaranteed delete karti hai (browser ke andar se)
    // ============================================================
    try {
      await chrome.browsingData.remove(
        {
          origins: [
            "https://www.facebook.com",
            "https://facebook.com",
            "https://web.facebook.com",
            "https://m.facebook.com"
          ]
        },
        {
          cookies: true,
          localStorage: true,
          indexedDB: true,
          cacheStorage: true,
          serviceWorkers: true,
          cache: true,
          fileSystems: true,
          webSQL: true
        }
      );
      console.log("[FB Multi-Session] ✅ browsingData.remove() completed (Method 1)");
    } catch (e) {
      console.warn("[FB Multi-Session] Method 1 (browsingData) failed:", e.message);
    }

    // Chhota wait
    await new Promise(r => setTimeout(r, 400));

    // ============================================================
    // METHOD 2: cookies.remove() — manual sweep (fallback + verify)
    // ============================================================
    const afterMethod1 = await chrome.cookies.getAll({});
    const fbAfter1 = afterMethod1.filter(c => (c.domain || "").toLowerCase().includes("facebook.com"));

    console.log(`[FB Multi-Session] After Method 1: ${fbAfter1.length} FB cookies remaining`);

    for (const cookie of fbAfter1) {
      try {
        const host = cookie.domain.replace(/^\./, "");
        const protocol = cookie.secure ? "https" : "http";
        const url = `${protocol}://${host}${cookie.path || "/"}`;

        await chrome.cookies.remove({
          url: url,
          name: cookie.name,
          storeId: cookie.storeId
        });
        deleted++;
      } catch (e) {}
    }

    // ---- Final verify ----
    await new Promise(r => setTimeout(r, 500));

    const final = await chrome.cookies.getAll({});
    const fbFinal = final.filter(c => (c.domain || "").toLowerCase().includes("facebook.com"));

    console.log(`[FB Multi-Session] FINAL: ${fbFinal.length} FB cookies remaining`);

    if (fbFinal.length > 0) {
      console.warn("[FB Multi-Session] ⚠️ Still remaining:", fbFinal.map(c => `${c.name}@${c.domain}`));
      // Ek aur attempt — global browsingData without origin filter (safety)
      try {
        // Ye sirf Facebook ke liye nahi, puri cookie jar ke liye hai — risky
        // Lekin agar yahan tak pahunch gaye to kuch aur hi masla hai
        console.warn("[FB Multi-Session] Cookies still persist — manual removal failed");
      } catch (e) {}
    } else {
      console.log("[FB Multi-Session] ✅✅ ALL FACEBOOK COOKIES DELETED ✅✅");
    }

    return {
      deleted: deleted + fbBefore.length,
      remaining: fbFinal.length,
      beforeCount: fbBefore.length
    };

  } catch (err) {
    console.error("[FB Multi-Session] ❌ Cookie delete fail:", err);
    return { deleted: 0, remaining: -1, error: err.message };
  }
}

// ---------------------------------------------------------------------------
async function clearTabPageStorage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "clearPageStorage"
    });
    return response || { ok: true };
  } catch (e) {
    console.warn("[FB Multi-Session] Content script not found on tab", tabId);
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabSessionMap.has(tabId)) {
    removeTabSessionRule(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.includes("facebook.com")) {
    if (tabSessionMap.has(tabId)) {
      removeTabSessionRule(tabId);
    }
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ========================================================================
  // 🆕 OPEN ALL ACCOUNTS — jitni cookies hain utni tabs kholo
  // ========================================================================
  if (msg.action === "openAllAccounts") {
    (async () => {
      try {
        const storage = await chrome.storage.local.get("accounts");
        const accounts = storage.accounts || {};
        const names = Object.keys(accounts);

        if (!names.length) {
          sendResponse({ ok: false, error: "Koi account save nahi hai" });
          return;
        }

        console.log(`[FB Multi-Session] 🚀 Opening ${names.length} accounts in separate tabs...`);

        let opened = 0;
        const openedTabs = [];

        for (const name of names) {
          const profile = accounts[name];
          if (!profile || !profile.cookies) continue;

          try {
            // 1. Blank tab kholo
            const tab = await chrome.tabs.create({
              url: "about:blank",
              active: false
            });

            // 2. DNR rule apply karo PEHLE
            await applyTabSessionRule(tab.id, {
              name: name,
              cookies: profile.cookies,
              color: profile.color
            });

            // 3. Ab Facebook navigate karo
            await chrome.tabs.update(tab.id, {
              url: "https://www.facebook.com/"
            });

            openedTabs.push({ tabId: tab.id, name });
            opened++;

            // Chhota delay taake Chrome overwhelm na ho
            await new Promise(r => setTimeout(r, 300));

          } catch (e) {
            console.error(`[FB Multi-Session] Failed to open "${name}":`, e);
          }
        }

        console.log(`[FB Multi-Session] ✅ Opened ${opened}/${names.length} accounts`);
        sendResponse({
          ok: true,
          opened: opened,
          total: names.length,
          tabs: openedTabs
        });

      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // ------------------------------------------------------------------------
  if (msg.action === "openProfileInNewTab") {
    (async () => {
      try {
        const storage = await chrome.storage.local.get("accounts");
        const accounts = storage.accounts || {};
        const profile = accounts[msg.profileName];

        if (!profile || !profile.cookies) {
          sendResponse({ ok: false, error: "Profile not found" });
          return;
        }

        const tab = await chrome.tabs.create({
          url: "about:blank",
          active: true
        });

        await applyTabSessionRule(tab.id, {
          name: msg.profileName,
          cookies: profile.cookies,
          color: profile.color
        });

        await chrome.tabs.update(tab.id, {
          url: "https://www.facebook.com/"
        });

        sendResponse({ ok: true, tabId: tab.id });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // ------------------------------------------------------------------------
  if (msg.action === "applyToCurrentTab") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }

        const storage = await chrome.storage.local.get("accounts");
        const accounts = storage.accounts || {};
        const profile = accounts[msg.profileName];

        if (!profile || !profile.cookies) {
          sendResponse({ ok: false, error: "Profile not found" });
          return;
        }

        if (tab.url && tab.url.includes("facebook.com")) {
          await clearTabPageStorage(tab.id);
        }

        await applyTabSessionRule(tab.id, {
          name: msg.profileName,
          cookies: profile.cookies,
          color: profile.color
        });

        if (tab.url && tab.url.includes("facebook.com")) {
          await chrome.tabs.reload(tab.id);
        } else {
          await chrome.tabs.update(tab.id, { url: "https://www.facebook.com/" });
        }

        sendResponse({ ok: true, tabId: tab.id });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // ------------------------------------------------------------------------
  if (msg.action === "getCurrentTabSession") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ session: null });
          return;
        }
        sendResponse({ session: tabSessionMap.get(tab.id) || null });
      } catch (err) {
        sendResponse({ session: null });
      }
    })();
    return true;
  }

  // ------------------------------------------------------------------------
  if (msg.action === "clearCurrentTabSession") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }

        // STEP 1: Page storage clear
        if (tab.url && tab.url.includes("facebook.com")) {
          await clearTabPageStorage(tab.id);
        }

        // STEP 2: DNR rule hatao
        await removeTabSessionRule(tab.id);

        // STEP 3: Browser cookies + storage delete (STRONGEST METHOD)
        const result = await deleteAllFacebookBrowserCookies();

        // STEP 4: Tab reload
        if (tab.url && tab.url.includes("facebook.com")) {
          await chrome.tabs.reload(tab.id);
        }

        sendResponse({
          ok: true,
          deletedCookies: result.deleted,
          remainingCookies: result.remaining,
          beforeCount: result.beforeCount
        });
      } catch (err) {
        console.error("[FB Multi-Session] clearCurrentTabSession error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // ------------------------------------------------------------------------
  if (msg.action === "listAllSessions") {
    const sessions = [];
    for (const [tabId, session] of tabSessionMap.entries()) {
      sessions.push({ tabId, ...session });
    }
    sendResponse({ sessions });
    return true;
  }

  // ------------------------------------------------------------------------
  if (msg.action === "getActiveTabInfo") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const session = tab && tab.id ? tabSessionMap.get(tab.id) : null;
        sendResponse({
          tabId: tab?.id || null,
          url: tab?.url || "",
          isFacebook: tab?.url?.includes("facebook.com") || false,
          session
        });
      } catch (err) {
        sendResponse({ tabId: null, url: "", isFacebook: false, session: null });
      }
    })();
    return true;
  }
});

// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    if (existing.length) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existing.map(r => r.id)
      });
    }
  } catch (e) {}
  console.log("[FB Multi-Session] Extension ready.");
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    if (existing.length) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existing.map(r => r.id)
      });
    }
  } catch (e) {}
});