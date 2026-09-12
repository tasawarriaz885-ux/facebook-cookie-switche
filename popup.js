 const fileInput = document.getElementById("fileInput");
const accountList = document.getElementById("accountList");
const accCount = document.getElementById("accCount");
const toastEl = document.getElementById("toast");
const sessionStatusEl = document.getElementById("sessionStatus");
const sessionStatusText = document.getElementById("sessionStatusText");
const clearSessionBtn = document.getElementById("clearSessionBtn");
const openAllBtn = document.getElementById("openAllBtn");
const openAllInfo = document.getElementById("openAllInfo");

const SESSION_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
];

// ---------- Toast ----------
function showToast(msg, type = "") {
  toastEl.textContent = msg;
  toastEl.className = "toast show " + type;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => {
    toastEl.className = "toast " + type;
  }, 2600);
}

// ---------- File Upload ----------
fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const stored = await chrome.storage.local.get("accounts");
  const accounts = stored.accounts || {};
  let added = 0, failed = 0;

  for (const file of files) {
    const text = await file.text();
    const cookies = parseCookieFile(text);

    if (!cookies || !cookies.c_user) {
      failed++;
      continue;
    }

    const accountName = file.name.replace(/\.(txt|json)$/i, "");
    const existing = accounts[accountName];

    accounts[accountName] = {
      name: accountName,
      cookies: cookies,
      cUserId: cookies.c_user,
      savedAt: Date.now(),
      color: existing?.color || SESSION_COLORS[Object.keys(accounts).length % SESSION_COLORS.length]
    };
    added++;
  }

  await chrome.storage.local.set({ accounts });
  fileInput.value = "";
  await renderAccounts();

  if (added) showToast(`${added} account(s) add ho gaye`, "success");
  if (failed) showToast(`${failed} file(s) mein c_user nahi mila`, "error");
});

// ---------- Cookie parser ----------
function parseCookieFile(text) {
  text = text.trim();

  if (text.includes("# Netscape HTTP Cookie File") || text.startsWith("#")) {
    const n = parseNetscapeCookies(text);
    if (Object.keys(n).length) return n;
  }

  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
      const obj = {};
      json.forEach((c) => { if (c.name) obj[c.name] = c.value; });
      return obj;
    }
    if (typeof json === "object") return json;
  } catch (e) {}

  const obj = {};
  text.split(/[;\n]/).forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (name) obj[name] = value;
  });
  return obj;
}

function parseNetscapeCookies(text) {
  const cookies = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split("\t");
    if (parts.length < 7) continue;
    const name = parts[5].trim();
    const value = parts[6].trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function getInitials(name) {
  const parts = name.trim().split(/[\s_\-.]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ---------- Active session info ----------
async function refreshSessionStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ action: "getActiveTabInfo" });
    if (!res) return;

    if (res.session) {
      sessionStatusEl.classList.remove("no-session");
      sessionStatusText.textContent = `Is tab par: ${res.session.profileName}`;
      clearSessionBtn.style.display = "block";
    } else {
      sessionStatusEl.classList.add("no-session");
      if (res.isFacebook) {
        sessionStatusText.textContent = "Facebook tab — koi session assign nahi";
      } else {
        sessionStatusText.textContent = "Koi active session nahi is tab par";
      }
      clearSessionBtn.style.display = "none";
    }
  } catch (e) {}
}

// ---------- 🆕 Update Open All button state ----------
function updateOpenAllButton(count) {
  if (count > 0) {
    openAllBtn.disabled = false;
    openAllInfo.textContent = `${count} account(s) ek saath kholne ke liye taiyar`;
  } else {
    openAllBtn.disabled = true;
    openAllInfo.textContent = "Upload cookies to enable this";
  }
}

// ---------- Render ----------
async function renderAccounts() {
  const stored = await chrome.storage.local.get("accounts");
  const accounts = stored.accounts || {};

  let activeSession = null;
  try {
    const res = await chrome.runtime.sendMessage({ action: "getActiveTabInfo" });
    activeSession = res?.session;
  } catch (e) {}

  const activeProfileName = activeSession?.profileName || null;

  const names = Object.keys(accounts).sort((a, b) => {
    if (a === activeProfileName) return -1;
    if (b === activeProfileName) return 1;
    return (accounts[b].savedAt || 0) - (accounts[a].savedAt || 0);
  });

  accCount.textContent = names.length;
  updateOpenAllButton(names.length);

  if (!names.length) {
    accountList.innerHTML = `<div class="empty"><p>Koi account save nahi hai.<br>Upar se cookie file upload karein.</p></div>`;
    await refreshSessionStatus();
    return;
  }

  accountList.innerHTML = "";

  names.forEach((name) => {
    const acc = accounts[name];
    const isActive = name === activeProfileName;

    const card = document.createElement("div");
    card.className = "account-card" + (isActive ? " active" : "");

    const colorStyle = acc.color
      ? `background: linear-gradient(135deg, ${acc.color}, ${shade(acc.color, -20)});`
      : "";

    card.innerHTML = `
      <div class="avatar ${isActive ? "active-avatar" : ""}" style="${colorStyle}">${getInitials(name)}</div>
      <div class="acc-info">
        <div class="acc-name" title="${name}">${name}</div>
        <div class="acc-meta">
          ${isActive
            ? `<span class="active-badge">Is Tab Par</span>`
            : `ID: ${acc.cUserId ? acc.cUserId.slice(0, 10) + "…" : "N/A"}`}
        </div>
      </div>
      <div class="btn-group">
        <button class="btn-action btn-open" data-open="${name}" title="Nayi tab mein kholo">🌐 Open</button>
        <button class="btn-action btn-apply" data-apply="${name}" title="Is tab par apply karo">⚡ Apply</button>
        <button class="btn-delete" data-del="${name}" title="Delete">✕</button>
      </div>
    `;

    accountList.appendChild(card);
  });

  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.open;
      btn.disabled = true;
      btn.textContent = "…";
      const res = await chrome.runtime.sendMessage({
        action: "openProfileInNewTab",
        profileName: name
      });
      if (res?.ok) {
        showToast(`"${name}" nayi tab mein khul gaya`, "success");
        setTimeout(() => window.close(), 800);
      } else {
        showToast(res?.error || "Fail ho gaya", "error");
        btn.disabled = false;
        btn.textContent = "🌐 Open";
      }
    });
  });

  document.querySelectorAll("[data-apply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.apply;
      btn.disabled = true;
      btn.textContent = "…";
      const res = await chrome.runtime.sendMessage({
        action: "applyToCurrentTab",
        profileName: name
      });
      if (res?.ok) {
        showToast(`"${name}" is tab par apply ho gaya`, "success");
        await renderAccounts();
      } else {
        showToast(res?.error || "Fail ho gaya", "error");
        btn.disabled = false;
        btn.textContent = "⚡ Apply";
      }
    });
  });

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.del;
      if (!confirm(`"${name}" delete karein?`)) return;

      const s = await chrome.storage.local.get("accounts");
      const acc = s.accounts || {};
      delete acc[name];
      await chrome.storage.local.set({ accounts: acc });
      showToast("Account delete ho gaya", "success");
      await renderAccounts();
    });
  });

  await refreshSessionStatus();
}

// ---------- 🆕 OPEN ALL ACCOUNTS ----------
openAllBtn.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get("accounts");
  const accounts = stored.accounts || {};
  const count = Object.keys(accounts).length;

  if (!count) {
    showToast("Koi account save nahi hai", "error");
    return;
  }

  if (!confirm(`${count} accounts ke liye ${count} nayi tabs kholi jayengi. Continue?`)) {
    return;
  }

  openAllBtn.disabled = true;
  const originalText = openAllBtn.innerHTML;
  openAllBtn.innerHTML = `⏳ Opening ${count} tabs…`;

  try {
    const res = await chrome.runtime.sendMessage({ action: "openAllAccounts" });

    if (res?.ok) {
      showToast(`✅ ${res.opened}/${res.total} accounts khul gaye`, "success");
      setTimeout(() => window.close(), 1500);
    } else {
      showToast(res?.error || "Fail ho gaya", "error");
      openAllBtn.disabled = false;
      openAllBtn.innerHTML = originalText;
    }
  } catch (e) {
    showToast("Error: " + e.message, "error");
    openAllBtn.disabled = false;
    openAllBtn.innerHTML = originalText;
  }
});

// ---------- Clear session + browser cookies delete ----------
clearSessionBtn.addEventListener("click", async () => {
  if (!confirm("Is account ki TAMAM Facebook cookies browser se delete ho jayengi aur account logout ho jayega. Continue?")) {
    return;
  }

  clearSessionBtn.disabled = true;
  clearSessionBtn.textContent = "⏳ Clearing…";

  const res = await chrome.runtime.sendMessage({ action: "clearCurrentTabSession" });

  if (res?.ok) {
    const count = res.deletedCookies || 0;
    const remaining = res.remainingCookies;
    if (remaining === 0) {
      showToast(`✅ ${count} cookies delete — account logout ho gaya`, "success");
    } else {
      showToast(`⚠️ ${count} delete, ${remaining} bachi hain`, "error");
    }
    await renderAccounts();
  } else {
    showToast(res?.error || "Fail ho gaya", "error");
  }

  clearSessionBtn.disabled = false;
  clearSessionBtn.textContent = "🧹 Is tab ka session hatao";
});

// ---------- Color helper ----------
function shade(hex, percent) {
  try {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
    return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  } catch (e) {
    return hex;
  }
}

// ---------- Init ----------
renderAccounts();