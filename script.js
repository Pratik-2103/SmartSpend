import { SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const LEGACY_STORAGE_KEY = "smartSpendData";
const CACHE_PREFIX = "smartSpendData:";
const PENDING_PREFIX = "smartSpendPending:";
const CURRENCY_LOCALES = {
  INR: "en-IN", USD: "en-US", EUR: "en-IE", GBP: "en-GB",
  CAD: "en-CA", AUD: "en-AU", JPY: "ja-JP"
};
const CURRENCY_SYMBOLS = {
  INR: "₹", USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥"
};
const CATEGORY_ICONS = {
  Food: "🍽️",
  Transport: "🚗",
  Shopping: "🛍️",
  Bills: "🧾",
  Health: "💊",
  Education: "📚",
  Travel: "✈️",
  Housing: "🏠",
  "Personal care": "🧴",
  Subscriptions: "🔁",
  Entertainment: "🎬",
  Gifts: "🎁",
  Other: "💳"
};
const VALID_CURRENCIES = Object.keys(CURRENCY_LOCALES);

let supabase = null;
let clientLoadError = "";
let currentUser = null;
let activeUserId = null;
let data = defaultData();
let syncBusy = false;

const configured = SUPABASE_URL.startsWith("https://")
  && !SUPABASE_URL.includes("YOUR_")
  && Boolean(SUPABASE_ANON_KEY)
  && !SUPABASE_ANON_KEY.includes("YOUR_");

if (configured) {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    });
  } catch (error) {
    clientLoadError = "The sign-in library could not load. Check your internet connection and reload the page.";
  }
}

function defaultData() {
  return { budget: 0, currency: "INR", expenses: [] };
}

function normalizeData(input) {
  const source = input && typeof input === "object" ? input : {};
  const currency = VALID_CURRENCIES.includes(source.currency) ? source.currency : "INR";
  const expenses = Array.isArray(source.expenses) ? source.expenses.map((expense) => {
    const amount = Number(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      id: String(expense.id || createId()),
      name: String(expense.name || "Expense").slice(0, 60),
      amount,
      category: CATEGORY_ICONS[expense.category] ? expense.category : "Other",
      dateISO: String(expense.spent_on || expense.dateISO || localDateISO())
    };
  }).filter(Boolean) : [];
  return {
    budget: Math.max(0, Number(source.budget ?? source.monthly_budget) || 0),
    currency,
    expenses
  };
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    return (char === "x" ? random : (random & 3 | 8)).toString(16);
  });
}

function localDateISO(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function currentMonthISO(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function cacheKey(userId) {
  return CACHE_PREFIX + userId;
}

function pendingKey(userId) {
  return PENDING_PREFIX + userId;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function readCache(userId) {
  return normalizeData(readJson(cacheKey(userId), defaultData()));
}

function saveLocal() {
  if (!currentUser) return;
  try {
    localStorage.setItem(cacheKey(currentUser.id), JSON.stringify(data));
  } catch {
    setSyncStatus("This browser could not save a local copy.", "error");
  }
}

function readPending(userId) {
  const queue = readJson(pendingKey(userId), []);
  return Array.isArray(queue) ? queue : [];
}

function writePending(userId, queue) {
  try {
    localStorage.setItem(pendingKey(userId), JSON.stringify(queue));
  } catch {
    setSyncStatus("This browser could not save pending changes.", "error");
  }
}

function appendPendingOperations(userId, operations) {
  const queue = readPending(userId);
  operations.forEach((operation) => queue.push({ ...operation, queueId: createId() }));
  writePending(userId, queue);
}

function setSyncStatus(message, state = "") {
  const status = $("#syncStatus");
  status.textContent = message;
  status.dataset.state = state;
}

function setAuthStatus(message, state = "") {
  const status = $("#authStatus");
  status.textContent = message;
  status.dataset.state = state;
}

function money(value) {
  const currency = VALID_CURRENCIES.includes(data.currency) ? data.currency : "INR";
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2
  }).format(Number(value) || 0);
}

function monthDate(month) {
  const match = /^(d{4})-(d{2})$/.exec(month || "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
}

function monthBounds(month) {
  const start = monthDate(month);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return {
    start: start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-01",
    end: end.getFullYear() + "-" + String(end.getMonth() + 1).padStart(2, "0") + "-01"
  };
}

function monthExpenses() {
  const month = $("#monthPicker").value;
  return data.expenses.filter((expense) => expense.dateISO.startsWith(month));
}

function visibleExpenses() {
  const query = $("#searchInput").value.trim().toLowerCase();
  return monthExpenses().filter((expense) => (expense.name + " " + expense.category).toLowerCase().includes(query));
}

function formatExpenseDate(dateISO) {
  const match = /^(d{4})-(d{2})-(d{2})$/.exec(dateISO || "");
  if (!match) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function render() {
  const allMonth = monthExpenses();
  const visible = visibleExpenses();
  const total = allMonth.reduce((sum, expense) => sum + expense.amount, 0);
  const remaining = data.budget - total;
  const percent = data.budget > 0 ? total / data.budget * 100 : 0;

  $("#budgetDisplay").textContent = money(data.budget);
  $("#totalSpent").textContent = money(total);
  $("#remaining").textContent = money(remaining);
  $("#remaining").style.color = remaining < 0 ? "#ff806d" : "";
  $("#progressLabel").textContent = data.budget
    ? Math.round(percent) + "% used"
    : "Set a budget to start";
  $("#progressFill").style.width = Math.min(percent, 100) + "%";
  $("#progressFill").classList.toggle("over-budget", percent > 100);
  $(".progress-track").setAttribute("aria-valuenow", String(Math.round(Math.min(percent, 100))));

  $("#currencySelect").value = data.currency;
  $("#currencySelect").disabled = data.expenses.length > 0 || data.budget > 0;
  $("#currencyNote").textContent = data.expenses.length || data.budget > 0
    ? "Currency is locked after setting a budget or adding an expense so amounts are not relabeled."
    : "Choose the currency for this account before setting a budget or adding an expense.";
  $("#amountCurrency").textContent = CURRENCY_SYMBOLS[data.currency];
  $("#budgetCurrencyText").textContent = "(" + CURRENCY_SYMBOLS[data.currency] + ")";

  renderExpenses(visible, allMonth.length);
  renderInsights(allMonth, total);
  renderChart();
  renderTip(allMonth, total, remaining);
}

function renderExpenses(expenses, totalCount) {
  const list = $("#expenseList");
  list.replaceChildren();
  $("#emptyState").hidden = expenses.length > 0;
  $("#emptyState").textContent = totalCount
    ? "No expenses match your search."
    : "No expenses this month. Add your first one.";

  [...expenses]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .forEach((expense) => {
      const item = document.createElement("li");
      item.className = "expense-item";

      const icon = document.createElement("span");
      icon.className = "expense-icon";
      icon.textContent = CATEGORY_ICONS[expense.category] || CATEGORY_ICONS.Other;
      icon.setAttribute("aria-hidden", "true");

      const info = document.createElement("div");
      info.className = "expense-info";
      const name = document.createElement("strong");
      name.textContent = expense.name;
      const details = document.createElement("span");
      details.textContent = expense.category + " · " + formatExpenseDate(expense.dateISO);
      info.append(name, details);

      const amount = document.createElement("span");
      amount.className = "expense-amount";
      amount.textContent = "−" + money(expense.amount);

      const remove = document.createElement("button");
      remove.className = "delete-button";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Delete " + expense.name);
      remove.addEventListener("click", () => {
        data.expenses = data.expenses.filter((item) => item.id !== expense.id);
        saveLocal();
        render();
        queueOperation({ type: "delete-expense", id: expense.id });
      });

      item.append(icon, info, amount, remove);
      list.append(item);
    });
}

function renderInsights(expenses, total) {
  const sums = {};
  expenses.forEach((expense) => {
    sums[expense.category] = (sums[expense.category] || 0) + expense.amount;
  });
  const sorted = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  const box = $("#categoryBreakdown");
  box.replaceChildren();

  if (!sorted.length) {
    $("#insightText").textContent = "Add an expense to see your category breakdown.";
    return;
  }

  sorted.forEach(([category, amount]) => {
    const row = document.createElement("div");
    row.className = "category-row";

    const labels = document.createElement("div");
    labels.className = "category-label";

    const title = document.createElement("span");
    title.className = "category-name";
    const icon = document.createElement("span");
    icon.className = "category-mini-icon";
    icon.textContent = CATEGORY_ICONS[category] || CATEGORY_ICONS.Other;
    icon.setAttribute("aria-hidden", "true");
    const categoryName = document.createElement("span");
    categoryName.textContent = category;
    title.append(icon, categoryName);

    const value = document.createElement("strong");
    value.textContent = money(amount);
    labels.append(title, value);

    const track = document.createElement("div");
    track.className = "category-track";
    const fill = document.createElement("div");
    fill.className = "category-fill";
    fill.style.width = (total ? amount / total * 100 : 0) + "%";
    track.append(fill);

    row.append(labels, track);
    box.append(row);
  });

  const [topCategory, topAmount] = sorted[0];
  $("#insightText").textContent = topCategory + " is your biggest category at " + money(topAmount)
    + " (" + Math.round(topAmount / total * 100) + "% of this month's spending).";
}

function renderChart() {
  const svg = $("#spendingChart");
  const namespace = "http://www.w3.org/2000/svg";
  svg.replaceChildren();

  const title = document.createElementNS(namespace, "title");
  title.textContent = "Expense totals by month for six months";
  svg.append(title);

  const selected = monthDate($("#monthPicker").value);
  const buckets = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(selected.getFullYear(), selected.getMonth() - offset, 1);
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
    const total = data.expenses
      .filter((expense) => expense.dateISO.startsWith(key))
      .reduce((sum, expense) => sum + expense.amount, 0);
    buckets.push({
      key,
      total,
      label: new Intl.DateTimeFormat("en", { month: "short" }).format(date)
    });
  }

  const chartTotal = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const left = 66;
  const top = 20;
  const plotWidth = 550;
  const plotHeight = 178;
  const slot = plotWidth / buckets.length;
  const barWidth = Math.min(48, slot * 0.5);

  function svgNode(name, attributes, text) {
    const node = document.createElementNS(namespace, name);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  }

  [0, 0.5, 1].forEach((fraction) => {
    const y = top + plotHeight * (1 - fraction);
    svgNode("line", { x1: left, y1: y, x2: left + plotWidth, y2: y, class: "chart-grid-line" });
    const tickValue = maxValue * fraction;
    const tickText = new Intl.NumberFormat(CURRENCY_LOCALES[data.currency], {
      style: "currency",
      currency: data.currency,
      notation: "compact",
      maximumFractionDigits: 1
    }).format(tickValue);
    svgNode("text", { x: left - 10, y: y + 3, "text-anchor": "end", class: "chart-axis-label" }, tickText);
  });

  buckets.forEach((bucket, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const barHeight = bucket.total ? Math.max(4, bucket.total / maxValue * plotHeight) : 0;
    const y = top + plotHeight - barHeight;

    if (bucket.total) {
      svgNode("rect", {
        x,
        y,
        width: barWidth,
        height: barHeight,
        rx: 8,
        class: "chart-bar"
      });
      const valueLabel = new Intl.NumberFormat(CURRENCY_LOCALES[data.currency], {
        style: "currency",
        currency: data.currency,
        notation: "compact",
        maximumFractionDigits: 1
      }).format(bucket.total);
      svgNode("text", {
        x: x + barWidth / 2,
        y: Math.max(13, y - 7),
        "text-anchor": "middle",
        class: "chart-value-label"
      }, valueLabel);
    }

    svgNode("text", {
      x: x + barWidth / 2,
      y: top + plotHeight + 22,
      "text-anchor": "middle",
      class: "chart-month-label"
    }, bucket.label);
  });

  $("#chartSummary").textContent = chartTotal
    ? "Six months ending " + new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(selected)
      + " · Total " + money(chartTotal)
    : "Add expenses to start your spending trend.";
}

function renderTip(expenses, total, remaining) {
  const tip = $("#smartTip");
  if (!expenses.length) {
    tip.textContent = "Track small and recurring costs too. They often add up faster than expected.";
  } else if (!data.budget) {
    tip.textContent = "Set a monthly budget to see what remains after your spending.";
  } else if (remaining < 0) {
    tip.textContent = "You are " + money(Math.abs(remaining)) + " over this month's budget. Review your categories to spot a place to adjust.";
  } else if (total / data.budget >= 0.8) {
    tip.textContent = "You have used " + Math.round(total / data.budget * 100) + "% of your budget. Check the category chart before your next large purchase.";
  } else {
    tip.textContent = "You have " + money(remaining) + " left in your budget. Keep logging expenses to make the month-end total useful.";
  }
}

function applyPendingLocally(targetData, operations) {
  operations.forEach((operation) => {
    if (operation.type === "upsert-expense" && operation.expense) {
      const expense = normalizeData({ expenses: [operation.expense] }).expenses[0];
      if (!expense) return;
      targetData.expenses = targetData.expenses.filter((item) => item.id !== expense.id);
      targetData.expenses.push(expense);
    } else if (operation.type === "delete-expense") {
      targetData.expenses = targetData.expenses.filter((expense) => expense.id !== operation.id);
    } else if (operation.type === "delete-month") {
      targetData.expenses = targetData.expenses.filter((expense) => !expense.dateISO.startsWith(operation.month));
    } else if (operation.type === "save-settings") {
      targetData.budget = Math.max(0, Number(operation.budget) || 0);
      targetData.currency = VALID_CURRENCIES.includes(operation.currency) ? operation.currency : "INR";
    }
  });
}

async function maybeImportLegacyData(userId, cloudData) {
  const marker = "smartSpendLegacyPrompted:" + userId;
  if (localStorage.getItem(marker)) return;
  const legacyValue = readJson(LEGACY_STORAGE_KEY, null);
  const legacyData = legacyValue ? normalizeData(legacyValue) : defaultData();

  if (!cloudData.expenses.length && (legacyData.expenses.length || legacyData.budget > 0)) {
    const shouldImport = window.confirm(
      "We found a budget or expenses saved on this device. Import them into your new Smart Spend account so they are available on your other devices?"
    );
    if (shouldImport) {
      cloudData.budget = legacyData.budget;
      cloudData.currency = legacyData.currency;
      cloudData.expenses = legacyData.expenses;
      const operations = [{
        type: "save-settings",
        budget: legacyData.budget,
        currency: legacyData.currency
      }, ...legacyData.expenses.map((expense) => ({ type: "upsert-expense", expense }))];
      appendPendingOperations(userId, operations);
    }
  }
  localStorage.setItem(marker, "done");
}

async function loadAccountData() {
  if (!supabase || !currentUser) return;
  const userId = currentUser.id;
  setSyncStatus("Loading your cloud data…", "pending");

  try {
    const [expenseResult, settingsResult] = await Promise.all([
      supabase.from("expenses")
        .select("id,name,amount,category,spent_on")
        .eq("user_id", userId)
        .order("spent_on", { ascending: false }),
      supabase.from("user_settings")
        .select("monthly_budget,currency")
        .eq("user_id", userId)
        .maybeSingle()
    ]);

    if (expenseResult.error) throw expenseResult.error;
    if (settingsResult.error) throw settingsResult.error;

    data = normalizeData({
      budget: settingsResult.data?.monthly_budget || 0,
      currency: settingsResult.data?.currency || "INR",
      expenses: (expenseResult.data || []).map((expense) => ({
        id: expense.id,
        name: expense.name,
        amount: expense.amount,
        category: expense.category,
        spent_on: expense.spent_on
      }))
    });

    await maybeImportLegacyData(userId, data);
    applyPendingLocally(data, readPending(userId));
    saveLocal();
    render();
    await loadOwnerList();
    await flushPending();
    if (!readPending(userId).length) setSyncStatus("All changes synced to your account.");
    else if (!navigator.onLine) setSyncStatus("Changes are saved on this device and will sync when you are online.", "pending");
  } catch (error) {
    data = readCache(userId);
    render();
    setSyncStatus("Cloud data could not load. Check the Supabase setup; showing this device's saved copy.", "error");
  }
}

async function activateUser(user) {
  if (!supabase || !user) return;
  if (activeUserId === user.id && !$("#appShell").hidden) return;

  activeUserId = user.id;
  currentUser = user;
  data = readCache(user.id);
  $("#accountEmail").textContent = user.email || "";
  $("#authScreen").hidden = true;
  $("#appShell").hidden = false;
  $("#monthPicker").value = currentMonthISO();
  render();
  await loadAccountData();
}

function resetSession() {
  activeUserId = null;
  currentUser = null;
  data = defaultData();
  $("#appShell").hidden = true;
  $("#authScreen").hidden = false;
  $("#ownerPanel").hidden = true;
  $("#authPassword").value = "";
  setAuthStatus("");
}

async function loadOwnerList() {
  const panel = $("#ownerPanel");
  const ownerEmail = String(OWNER_EMAIL || "").toLowerCase();
  if (!currentUser || String(currentUser.email || "").toLowerCase() !== ownerEmail) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  $("#ownerMessage").textContent = "Checking owner access…";
  $("#memberList").replaceChildren();

  const adminCheck = await supabase.rpc("is_smart_spend_admin");
  if (adminCheck.error) {
    $("#ownerMessage").textContent = "Finish the owner setup by running owner-admin.sql in Supabase SQL Editor.";
    $("#memberCount").textContent = "Setup needed";
    return;
  }
  if (adminCheck.data !== true) {
    panel.hidden = true;
    return;
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("email,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    $("#ownerMessage").textContent = "The member list could not be loaded. Check the profile-table policy.";
    $("#memberCount").textContent = "Unavailable";
    return;
  }

  $("#memberCount").textContent = (profiles.length || 0) + (profiles.length === 1 ? " member" : " members");
  $("#ownerMessage").textContent = "Email addresses and join dates only. Expense records remain private to each account.";
  profiles.forEach((profile) => {
    const item = document.createElement("li");
    item.className = "member-row";
    const email = document.createElement("span");
    email.textContent = profile.email;
    const joined = document.createElement("span");
    joined.textContent = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(profile.created_at));
    item.append(email, joined);
    $("#memberList").append(item);
  });
}

async function performCloudOperation(userId, operation) {
  if (!supabase || currentUser?.id !== userId) return;

  if (operation.type === "save-settings") {
    const { error } = await supabase.from("user_settings").upsert({
      user_id: userId,
      monthly_budget: Math.max(0, Number(operation.budget) || 0),
      currency: VALID_CURRENCIES.includes(operation.currency) ? operation.currency : "INR",
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if (error) throw error;
    return;
  }

  if (operation.type === "upsert-expense") {
    const expense = operation.expense;
    const { error } = await supabase.from("expenses").upsert({
      id: expense.id,
      user_id: userId,
      name: expense.name,
      amount: expense.amount,
      category: expense.category,
      spent_on: expense.dateISO
    }, { onConflict: "id" });
    if (error) throw error;
    return;
  }

  if (operation.type === "delete-expense") {
    const { error } = await supabase.from("expenses")
      .delete()
      .eq("id", operation.id)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  if (operation.type === "delete-month") {
    const bounds = monthBounds(operation.month);
    const { error } = await supabase.from("expenses")
      .delete()
      .eq("user_id", userId)
      .gte("spent_on", bounds.start)
      .lt("spent_on", bounds.end);
    if (error) throw error;
  }
}

async function flushPending() {
  if (!supabase || !currentUser || syncBusy || !navigator.onLine) return;
  const userId = currentUser.id;
  syncBusy = true;
  try {
    let queue = readPending(userId);
    while (queue.length && currentUser?.id === userId) {
      const operation = queue[0];
      setSyncStatus("Syncing your changes…", "pending");
      try {
        await performCloudOperation(userId, operation);
      } catch (error) {
        setSyncStatus("Saved on this device. Cloud sync will retry when you are online.", "error");
        return;
      }
      queue = readPending(userId);
      const index = queue.findIndex((item) => item.queueId === operation.queueId);
      if (index >= 0) queue.splice(index, 1);
      writePending(userId, queue);
    }
  } finally {
    syncBusy = false;
  }
  if (currentUser?.id === userId && !readPending(userId).length) {
    setSyncStatus("All changes synced to your account.");
  }
}

function queueOperation(operation) {
  if (!currentUser) return;
  appendPendingOperations(currentUser.id, [operation]);
  if (!navigator.onLine) setSyncStatus("Saved on this device. Cloud sync will resume when you are online.", "pending");
  void flushPending();
}

function updateSettings() {
  saveLocal();
  queueOperation({
    type: "save-settings",
    budget: data.budget,
    currency: data.currency
  });
}

function updateAuthMode() {
  const isSignup = $("#authForm").dataset.mode === "signup";
  $("#authHeading").textContent = isSignup ? "Create your account" : "Welcome back";
  $("#authIntro").textContent = isSignup
    ? "Register once to keep your expenses with you on every device."
    : "Sign in to see your spending from any device.";
  $("#authSubmit").textContent = isSignup ? "Create account" : "Sign in";
  $("#authSwitchPrompt").textContent = isSignup ? "Already have an account?" : "New to Smart Spend?";
  $("#authSwitch").textContent = isSignup ? "Sign in" : "Create an account";
  $("#authPassword").autocomplete = isSignup ? "new-password" : "current-password";
  $("#consentRow").hidden = !isSignup;
  $("#privacyConsent").required = isSignup;
  setAuthStatus("");
}

async function startAuth() {
  if (!supabase) {
    const notice = $("#authSetupNotice");
    notice.hidden = false;
    notice.textContent = clientLoadError || "Connect a Supabase project first: run supabase-setup.sql, then add the project URL and publishable or anon key to config.js.";
    $("#authForm").querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
    $("#authSwitch").disabled = true;
    return;
  }

  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error) setAuthStatus("Could not restore your sign-in. Please sign in again.", "error");
  if (sessionData?.session?.user) await activateUser(sessionData.session.user);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      resetSession();
    } else if (session?.user) {
      window.setTimeout(() => { void activateUser(session.user); }, 0);
    }
  });
}

$("#authForm").dataset.mode = "signin";
updateAuthMode();
$("#monthPicker").value = currentMonthISO();

$("#authSwitch").addEventListener("click", () => {
  if (!supabase) return;
  $("#authForm").dataset.mode = $("#authForm").dataset.mode === "signin" ? "signup" : "signin";
  updateAuthMode();
});

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;

  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const isSignup = $("#authForm").dataset.mode === "signup";
  if (isSignup && !$("#privacyConsent").checked) {
    setAuthStatus("Please agree to the cloud-storage notice before creating an account.", "error");
    return;
  }

  $("#authSubmit").disabled = true;
  setAuthStatus(isSignup ? "Creating your account…" : "Signing in…");
  try {
    if (isSignup) {
      const { data: result, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
      if (result.session?.user) {
        await activateUser(result.session.user);
      } else {
        $("#authPassword").value = "";
        setAuthStatus("Check your inbox and confirm your email, then return here to sign in.");
      }
    } else {
      const { data: result, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await activateUser(result.user);
    }
  } catch (error) {
    setAuthStatus(error.message || "Sign-in failed. Please try again.", "error");
  } finally {
    $("#authSubmit").disabled = false;
  }
});

$("#signOutButton").addEventListener("click", async () => {
  if (!supabase) return;
  $("#signOutButton").disabled = true;
  const { error } = await supabase.auth.signOut();
  $("#signOutButton").disabled = false;
  if (error) setSyncStatus("Could not sign out. Please try again.", "error");
});

$("#refreshButton")?.addEventListener("click", () => { void loadAccountData(); });

$("#expenseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const name = String(fields.get("name") || "").trim();
  const amount = Number(fields.get("amount"));
  if (!name || !Number.isFinite(amount) || amount <= 0) {
    $("#expenseAmount").focus();
    return;
  }

  const expense = {
    id: createId(),
    name,
    amount,
    category: String(fields.get("category")),
    dateISO: localDateISO()
  };
  data.expenses.push(expense);
  $("#monthPicker").value = expense.dateISO.slice(0, 7);
  saveLocal();
  render();
  queueOperation({ type: "upsert-expense", expense });
  event.currentTarget.reset();
  $("#expenseName").focus();
});

$("#currencySelect").addEventListener("change", (event) => {
  if (data.expenses.length || data.budget > 0) {
    event.currentTarget.value = data.currency;
    return;
  }
  data.currency = VALID_CURRENCIES.includes(event.currentTarget.value) ? event.currentTarget.value : "INR";
  updateSettings();
  render();
});

$("#editBudgetButton").addEventListener("click", () => {
  $("#budgetInput").value = data.budget || "";
  $("#budgetDialog").showModal();
});

$("#budgetForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = Number($("#budgetInput").value);
  if (!Number.isFinite(value) || value < 0) return;
  data.budget = value;
  updateSettings();
  render();
  $("#budgetDialog").close();
});

$("#cancelBudget").addEventListener("click", () => $("#budgetDialog").close());

$("#clearButton").addEventListener("click", () => {
  const month = $("#monthPicker").value;
  if (!monthExpenses().length || !window.confirm("Delete all expenses for this month from your account?")) return;
  data.expenses = data.expenses.filter((expense) => !expense.dateISO.startsWith(month));
  saveLocal();
  render();
  queueOperation({ type: "delete-month", month });
});

$("#monthPicker").addEventListener("change", render);
$("#searchInput").addEventListener("input", render);

$("#exportButton").addEventListener("click", () => {
  const rows = [["Date", "Name", "Category", "Amount (" + data.currency + ")"], ...monthExpenses().map((expense) => [
    expense.dateISO,
    expense.name,
    expense.category,
    expense.amount
  ])];
  const csv = rows.map((row) => row.map((cell) => '"' + String(cell).replaceAll('"', '""') + '"').join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
const link = document.createElement("a");
  link.href = url;
  link.download = "smart-spend-" + ($("#monthPicker").value || "expenses") + ".csv";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener("online", () => { void flushPending(); });

startAuth();
