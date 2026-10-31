const STORAGE_KEY = "smartSpendData";
const icons = { Food: "🍽️", Transport: "🚗", Shopping: "🛍️", Bills: "🧾", Health: "💊", Entertainment: "🎬", Other: "💳" };
const $ = (selector) => document.querySelector(selector);
const expenseForm = $("#expenseForm");
const monthPicker = $("#monthPicker");
let data = loadData();
const today = new Date();
monthPicker.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { budget: Math.max(0, Number(saved.budget) || 0), expenses: Array.isArray(saved.expenses) ? saved.expenses : [] };
  } catch { return { budget: 0, expenses: [] }; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function money(value) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value); }
function monthExpenses() {
  const month = monthPicker.value;
  return data.expenses.filter((e) => (e.dateISO || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`).startsWith(month));
}
function render() {
  const allMonth = monthExpenses();
  const query = $("#searchInput").value.trim().toLowerCase();
  const visible = allMonth.filter((e) => `${e.name} ${e.category}`.toLowerCase().includes(query));
  const total = allMonth.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const remaining = data.budget - total;
  const percent = data.budget > 0 ? total / data.budget * 100 : 0;
  $("#budgetDisplay").textContent = money(data.budget);
  $("#totalSpent").textContent = money(total);
  $("#remaining").textContent = money(remaining);
  $("#remaining").style.color = remaining < 0 ? "#db654f" : "";
  $("#progressLabel").textContent = data.budget ? `${Math.round(percent)}% used` : "Set a budget to track spending";
  $("#progressFill").style.width = `${Math.min(percent, 100)}%`;
  $("#progressFill").classList.toggle("over-budget", percent > 100);
  $(".progress-track").setAttribute("aria-valuenow", String(Math.round(Math.min(percent, 100))));
  $("#expenseList").replaceChildren();
  $("#emptyState").hidden = visible.length > 0;
  $("#emptyState").textContent = allMonth.length ? "No expenses match your search." : "No expenses this month. Add your first one.";
  [...visible].sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || "")).forEach((e) => {
    const item = document.createElement("li"); item.className = "expense-item";
    const icon = document.createElement("span"); icon.className = "expense-icon"; icon.textContent = icons[e.category] || "💳"; icon.setAttribute("aria-hidden", "true");
    const info = document.createElement("div"); info.className = "expense-info";
    const name = document.createElement("strong"); name.textContent = e.name;
    const details = document.createElement("span"); details.textContent = `${e.category} · ${e.date || e.dateISO || "Date unavailable"}`;
    info.append(name, details);
    const amount = document.createElement("span"); amount.className = "expense-amount"; amount.textContent = `−${money(Number(e.amount))}`;
    const remove = document.createElement("button"); remove.className = "delete-button"; remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `Delete ${e.name}`);
    remove.addEventListener("click", () => { data.expenses = data.expenses.filter((x) => x.id !== e.id); saveData(); render(); });
    item.append(icon, info, amount, remove); $("#expenseList").append(item);
  });
  renderInsights(allMonth, total);
}
function renderInsights(expenses, total) {
  const sums = {};
  expenses.forEach((e) => sums[e.category] = (sums[e.category] || 0) + Number(e.amount || 0));
  const sorted = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  const box = $("#categoryBreakdown"); box.replaceChildren();
  if (!sorted.length) { $("#insightText").textContent = "Add expenses to see your spending insights."; return; }
  sorted.forEach(([category, amount]) => {
    const row = document.createElement("div"); row.className = "category-row";
    const labels = document.createElement("div"); labels.className = "category-label";
    const title = document.createElement("span"); title.textContent = `${icons[category] || "💳"} ${category}`;
    const value = document.createElement("strong"); value.textContent = money(amount); labels.append(title, value);
    const track = document.createElement("div"); track.className = "category-track";
    const fill = document.createElement("div"); fill.className = "category-fill"; fill.style.width = `${total ? amount / total * 100 : 0}%`; track.append(fill);
    row.append(labels, track); box.append(row);
  });
  const [top, amount] = sorted[0];
  $("#insightText").textContent = `${top} is your biggest category at ${money(amount)} (${Math.round(amount / total * 100)}% of spending).`;
}
expenseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = new FormData(expenseForm);
  const name = String(fields.get("name")).trim(); const amount = Number(fields.get("amount"));
  if (!name || !Number.isFinite(amount) || amount <= 0) { $("#expenseAmount").focus(); return; }
  const now = new Date(); const dateISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  data.expenses.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, amount, category: String(fields.get("category")), dateISO, date: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(now) });
  monthPicker.value = dateISO.slice(0, 7); saveData(); render(); expenseForm.reset(); $("#expenseName").focus();
});
$("#editBudgetButton").addEventListener("click", () => { $("#budgetInput").value = data.budget || ""; $("#budgetDialog").showModal(); });
$("#budgetForm").addEventListener("submit", (event) => { event.preventDefault(); const value = Number($("#budgetInput").value); if (!Number.isFinite(value) || value <= 0) return; data.budget = value; saveData(); render(); $("#budgetDialog").close(); });
$("#cancelBudget").addEventListener("click", () => $("#budgetDialog").close());
$("#clearButton").addEventListener("click", () => { const ids = new Set(monthExpenses().map((e) => e.id)); if (!ids.size || !confirm("Delete all expenses for this month?")) return; data.expenses = data.expenses.filter((e) => !ids.has(e.id)); saveData(); render(); });
monthPicker.addEventListener("change", render);
$("#searchInput").addEventListener("input", render);
$("#exportButton").addEventListener("click", () => {
  const rows = [["Date", "Name", "Category", "Amount (INR)"], ...monthExpenses().map((e) => {
    const date = e.dateISO || e.date || "";
    return [date, e.name, e.category, e.amount];
  })];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-spend-${monthPicker.value || "expenses"}.csv`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the object URL alive long enough for the browser to start reading it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
