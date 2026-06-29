const defaultState = {
  principal: 20000,
  loanDate: "2018-01-09",
  noteStatus: "Needs written repayment plan",
  friendApr: 6,
  marketReturn: 9,
  paymentAmount: 500,
  paymentFrequency: "monthly",
  firstDue: new Date().toISOString().slice(0, 10),
  payments: [],
};

const storeKey = "loan-ledger-state-v1";
let state = { ...defaultState };
let currentRole = "lender";
let storageMode = "local";
let remoteUnsubscribe = null;
let saveRemoteState = null;

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const exactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function loadLocalState() {
  try {
    return { ...defaultState, ...JSON.parse(localStorage.getItem(storeKey)) };
  } catch {
    return { ...defaultState };
  }
}

function saveLocalState() {
  localStorage.setItem(storeKey, JSON.stringify(state));
}

function normalizeState(nextState) {
  return {
    ...defaultState,
    ...nextState,
    principal: Number(nextState.principal || defaultState.principal),
    friendApr: Number(nextState.friendApr ?? defaultState.friendApr),
    marketReturn: Number(nextState.marketReturn ?? defaultState.marketReturn),
    paymentAmount: Number(nextState.paymentAmount ?? defaultState.paymentAmount),
    paymentFrequency: nextState.paymentFrequency || defaultState.paymentFrequency,
    payments: Array.isArray(nextState.payments) ? nextState.payments : [],
  };
}

async function saveState() {
  saveLocalState();
  if (saveRemoteState) {
    await saveRemoteState(state);
  }
  updateStorageStatus();
}

function updateStorageStatus(message) {
  const badge = $("storageBadge");
  const note = $("storageNote");
  if (!badge || !note) return;

  if (storageMode === "firestore") {
    badge.textContent = message || "Shared Firestore";
    note.textContent = "Prototype PIN: 20000. Data is shared through Firebase Firestore.";
    return;
  }

  badge.textContent = message || "Local preview";
  note.textContent = "Prototype PIN: 20000. Data is saved locally until Firebase is configured.";
}

async function initDataStore() {
  state = loadLocalState();
  updateStorageStatus();

  const settings = window.loanLedgerFirebaseConfig;
  if (!settings?.enabled) return;

  try {
    updateStorageStatus("Connecting...");
    const appModule = await import("https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js");
    const firestoreModule = await import("https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js");
    const app = appModule.initializeApp(settings.config);
    const db = firestoreModule.getFirestore(app);
    const collectionName = settings.collectionName || "loanLedgers";
    const documentId = settings.documentId || "friend-loan-2018";
    const ledgerRef = firestoreModule.doc(db, collectionName, documentId);
    const snapshot = await firestoreModule.getDoc(ledgerRef);

    if (snapshot.exists()) {
      state = normalizeState(snapshot.data());
      saveLocalState();
    } else {
      await firestoreModule.setDoc(ledgerRef, normalizeState(state));
    }

    saveRemoteState = (nextState) => firestoreModule.setDoc(ledgerRef, normalizeState(nextState));
    storageMode = "firestore";
    updateStorageStatus();

    if (remoteUnsubscribe) remoteUnsubscribe();
    remoteUnsubscribe = firestoreModule.onSnapshot(ledgerRef, (nextSnapshot) => {
      if (!nextSnapshot.exists()) return;
      state = normalizeState(nextSnapshot.data());
      saveLocalState();
      renderAll();
      updateStorageStatus("Synced");
    });
  } catch (error) {
    console.error("Firebase storage failed; using local preview.", error);
    storageMode = "local";
    saveRemoteState = null;
    updateStorageStatus("Local fallback");
  }
}

function yearsSince(dateText) {
  const start = new Date(`${dateText}T00:00:00`);
  const now = new Date();
  return Math.max(0, (now - start) / (365.25 * 24 * 60 * 60 * 1000));
}

function totalPaid() {
  return state.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function owed() {
  return Math.max(0, Number(state.principal || 0) - totalPaid());
}

function compound(amount, annualRate, years) {
  return amount * Math.pow(1 + annualRate / 100, years);
}

function formatDate(dateText) {
  return shortDate.format(new Date(`${dateText}T00:00:00`));
}

const FREQ_MAP = {
  weekly: { label: 'Weeks', short: 'wk', days: 7, months: 0 },
  biweekly: { label: 'Biweeks', short: 'biweekly', days: 14, months: 0 },
  monthly: { label: 'Months', short: 'mo', days: 0, months: 1 },
  every_other_month: { label: 'Periods', short: '2mo', days: 0, months: 2 },
  quarterly: { label: 'Quarters', short: 'qtr', days: 0, months: 3 },
  bi_yearly: { label: 'Half-years', short: 'half-yr', days: 0, months: 6 },
  yearly: { label: 'Years', short: 'yr', days: 0, months: 12 },
};

function renderAll() {
  $("principalInput").value = state.principal;
  $("loanDateInput").value = state.loanDate;
  $("noteStatusInput").value = state.noteStatus;
  $("friendAprInput").value = state.friendApr;
  $("marketReturnInput").value = state.marketReturn;
  $("paymentAmountInput").value = state.paymentAmount;
  $("paymentFrequencyInput").value = state.paymentFrequency;
  $("firstDueInput").value = state.firstDue;

  renderSummary();
  renderLedger();
  renderScenarios();
  renderPayoff();
  drawCostChart();
  drawPaymentChart();
  drawProjectionChart();
}

function renderSummary() {
  const age = yearsSince(state.loanDate);
  const paid = totalPaid();
  const balance = owed();
  const friendTotal = compound(state.principal, state.friendApr, age);

  $("owedMetric").textContent = money.format(balance);
  $("paidMetric").textContent = money.format(paid);
  $("paymentCount").textContent = `${state.payments.length} recorded payment${state.payments.length === 1 ? "" : "s"}`;
  $("ageMetric").textContent = `${age.toFixed(1)} yrs`;
  $("startDateNote").textContent = `Since ${formatDate(state.loanDate)}`;
  $("discountMetric").textContent = money.format(Math.max(0, friendTotal - state.principal));
  $("owedNote").textContent = `${state.noteStatus}`;
}

function renderLedger() {
  const rows = $("ledgerRows");
  const sorted = [...state.payments].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    rows.innerHTML = `
      <tr>
        <td colspan="5">No payments recorded yet.</td>
      </tr>
    `;
    return;
  }

  rows.innerHTML = sorted
    .map(
      (payment) => `
        <tr>
          <td>${formatDate(payment.date)}</td>
          <td>${payment.method}</td>
          <td>${escapeHtml(payment.note || "")}</td>
          <td class="money">${exactMoney.format(payment.amount)}</td>
          <td class="money">
            <button class="delete-row" type="button" data-id="${payment.id}" title="Delete payment">X</button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderScenarios() {
  const age = yearsSince(state.loanDate);
  const principal = Number(state.principal || 0);
  const balance = owed();
  const scenarios = [
    ["No interest deal", principal],
    [`${state.friendApr}% APR friend note`, compound(principal, state.friendApr, age)],
    ["4% savings account", compound(principal, 4, age)],
    [`${state.marketReturn}% market return`, compound(principal, state.marketReturn, age)],
    ["12% personal loan APR", compound(principal, 12, age)],
  ];

  $("scenarioRows").innerHTML = scenarios
    .map(([name, value]) => {
      const difference = Math.max(0, value - balance);
      return `
        <tr>
          <td>${name}</td>
          <td class="money">${money.format(value)}</td>
          <td class="money">${money.format(difference)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPayoff() {
  const amount = Math.max(0, Number(state.paymentAmount || 0));
  const balance = owed();
  const periods = amount > 0 ? Math.ceil(balance / amount) : 0;
  const freq = FREQ_MAP[state.paymentFrequency] || FREQ_MAP.monthly;

  $("monthsToZero").textContent = amount > 0 ? `${periods}` : "--";
  if ($("periodsLabel")) $("periodsLabel").textContent = `${freq.label} to zero`;
  $("agreementAmount").textContent = `${money.format(amount || 500)}/${freq.short}`;
  if ($("agreementSubtext")) $("agreementSubtext").textContent = `Autopay, due every ${freq.label.toLowerCase().replace(/s$/, '')}`;

  if (amount <= 0) {
    $("finalPaymentNote").textContent = "Choose a payment amount";
    return;
  }

  const finalDate = new Date(`${state.firstDue}T00:00:00`);
  if (freq.months > 0) {
    finalDate.setMonth(finalDate.getMonth() + Math.max(0, freq.months * (periods - 1)));
  } else {
    finalDate.setDate(finalDate.getDate() + Math.max(0, freq.days * (periods - 1)));
  }
  
  const finalAmount = periods > 1 ? balance - amount * (periods - 1) : balance;
  $("finalPaymentNote").textContent = `${exactMoney.format(finalAmount)} final payment around ${shortDate.format(finalDate)}`;
}

function drawHeroChart() {
  const canvas = $("heroChart");
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,.08)";
  for (let x = 44; x < width; x += 78) {
    ctx.fillRect(x, 48, 1, height - 96);
  }
  for (let y = 58; y < height; y += 60) {
    ctx.fillRect(44, y, width - 88, 1);
  }

  const series = [
    { color: "#f0bf68", values: [70, 84, 99, 119, 142, 170] },
    { color: "#ffffff", values: [70, 75, 79, 84, 89, 95] },
    { color: "#e98770", values: [70, 70, 70, 70, 70, 70] },
  ];
  series.forEach((line) => {
    ctx.beginPath();
    line.values.forEach((value, i) => {
      const x = 72 + i * 110;
      const y = height - 70 - value * 1.55;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 5;
    ctx.strokeStyle = line.color;
    ctx.stroke();
  });

  ctx.fillStyle = "#fff";
  ctx.font = "700 26px Inter, sans-serif";
  ctx.fillText("$20,000", 70, 86);
  ctx.font = "500 16px Inter, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.76)";
  ctx.fillText("principal, interest paths, and opportunity cost", 70, 114);
}

function drawCostChart() {
  const canvas = $("costChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const pad = 58;
  const age = Math.max(1, yearsSince(state.loanDate));
  const principal = Number(state.principal || 0);
  const lines = [
    { label: "No interest", color: "#a64b3c", valueAt: (year) => compound(principal, 0, year) },
    { label: `${state.friendApr}% APR`, color: "#bd7f25", valueAt: (year) => compound(principal, state.friendApr, year) },
    { label: `${state.marketReturn}% return`, color: "#276c54", valueAt: (year) => compound(principal, state.marketReturn, year) },
    { label: "12% APR", color: "#446c8a", valueAt: (year) => compound(principal, 12, year) },
  ];
  const maxValue = Math.max(...lines.map((line) => line.valueAt(age))) * 1.08;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d8d2c8";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#66706d";
  ctx.font = "14px Inter, sans-serif";

  for (let i = 0; i <= 4; i++) {
    const y = pad + ((height - pad * 2) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
    const value = maxValue * (1 - i / 4);
    ctx.fillText(money.format(value), 8, y + 4);
  }

  lines.forEach((line, index) => {
    ctx.beginPath();
    for (let step = 0; step <= 48; step++) {
      const t = (age * step) / 48;
      const value = line.valueAt(t);
      const x = pad + ((width - pad * 2) * step) / 48;
      const y = height - pad - (value / maxValue) * (height - pad * 2);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = line.color;
    ctx.fillRect(width - 210, 26 + index * 26, 14, 14);
    ctx.fillStyle = "#202323";
    ctx.fillText(line.label, width - 188, 39 + index * 26);
  });

  ctx.fillStyle = "#66706d";
  ctx.fillText("Loan date", pad, height - 22);
  ctx.fillText("Today", width - pad - 40, height - 22);
}

let paymentChartInstance = null;

function drawPaymentChart() {
  const canvas = $("paymentChart");
  if (!canvas) return;

  if (paymentChartInstance) {
    paymentChartInstance.destroy();
  }

  const sorted = [...state.payments].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#66706d";
    ctx.font = "14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No payments recorded yet.", canvas.width / 2, canvas.height / 2);
    return;
  }

  const startDate = new Date(`${state.loanDate}T00:00:00`);
  const endDate = new Date(); // Today

  const dataPoints = sorted.map(p => ({
    x: new Date(`${p.date}T00:00:00`).getTime(),
    y: Number(p.amount),
    note: p.note || "No note attached",
    method: p.method || "Unknown"
  }));

  paymentChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      datasets: [{
        label: 'Payment Amount',
        data: dataPoints,
        backgroundColor: '#276c54',
        borderRadius: 4,
        maxBarThickness: 16
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      },
      layout: {
        padding: {
          bottom: 30
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#202323',
          padding: 12,
          titleFont: { size: 14, family: 'Inter, sans-serif' },
          bodyFont: { size: 13, family: 'Inter, sans-serif' },
          callbacks: {
            title: function(context) {
              return shortDate.format(new Date(context[0].raw.x));
            },
            label: function(context) {
              const amount = exactMoney.format(context.raw.y);
              return `Amount: ${amount} via ${context.raw.method}`;
            },
            afterBody: function(context) {
              return `Note: ${context[0].raw.note}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: startDate.getTime(),
          max: endDate.getTime(),
          grid: { display: false },
          ticks: { 
            font: { family: 'Inter, sans-serif', size: 11 }, 
            color: '#66706d',
            maxRotation: 90,
            minRotation: 90,
            autoSkip: true,
            autoSkipPadding: 8,
            callback: function(value) {
              if (value === startDate.getTime()) {
                return "Initial Loan";
              }
              if (value === endDate.getTime()) {
                return "Today";
              }
              return shortDate.format(new Date(value));
            }
          },
          afterBuildTicks: function(axis) {
            const customTicks = [
              startDate.getTime(),
              ...dataPoints.map(p => p.x),
              endDate.getTime()
            ];
            const uniqueTicks = Array.from(new Set(customTicks)).sort((a, b) => a - b);
            axis.ticks = uniqueTicks.map(v => ({ value: v }));
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#d8d2c8' },
          ticks: {
            font: { family: 'Inter, sans-serif' },
            color: '#66706d',
            callback: function(value) {
              return '$' + value;
            }
          }
        }
      }
    }
  });
}


let projectionChartInstance = null;

function drawProjectionChart() {
  const canvas = $("projectionChart");
  if (!canvas) return;

  if (projectionChartInstance) {
    projectionChartInstance.destroy();
  }

  const principal = Number(state.principal || 0);
  const loanDateObj = new Date(`${state.loanDate}T00:00:00`);
  const todayObj = new Date();

  const sorted = [...state.payments].sort((a, b) => a.date.localeCompare(b.date));
  
  let currentBalance = principal;
  const historyData = [
    { x: loanDateObj.getTime(), y: currentBalance }
  ];

  sorted.forEach(p => {
    const pDate = new Date(`${p.date}T00:00:00`);
    historyData.push({ x: pDate.getTime(), y: currentBalance });
    currentBalance = Math.max(0, currentBalance - Number(p.amount));
    historyData.push({ x: pDate.getTime(), y: currentBalance });
  });
  
  historyData.push({ x: todayObj.getTime(), y: currentBalance });

  // 1. Historical Projection
  const monthsSinceLoan = Math.max(1, (todayObj - loanDateObj) / (1000 * 60 * 60 * 24 * 30.44));
  const totalPaidAmount = principal - currentBalance;
  const averageMonthlyPayment = totalPaidAmount / monthsSinceLoan;
  
  const historicalProjectionData = [
    { x: todayObj.getTime(), y: currentBalance }
  ];

  if (averageMonthlyPayment > 0 && currentBalance > 0) {
    const monthsToZeroHistorical = currentBalance / averageMonthlyPayment;
    const historicalZeroDate = new Date();
    historicalZeroDate.setMonth(historicalZeroDate.getMonth() + monthsToZeroHistorical);
    historicalProjectionData.push({ x: historicalZeroDate.getTime(), y: 0 });
  }

  // 2. Planned Projection
  const plannedAmount = Number(state.paymentAmount || 0);
  const plannedProjectionData = [
    { x: todayObj.getTime(), y: currentBalance }
  ];

  if (plannedAmount > 0 && currentBalance > 0) {
    const freq = FREQ_MAP[state.paymentFrequency] || FREQ_MAP.monthly;
    
    let loopBalance = currentBalance;
    let loopDate = new Date(`${state.firstDue}T00:00:00`);
    
    // If first due is in the past, push it to next cycle relative to today
    if (loopDate.getTime() <= todayObj.getTime()) {
      loopDate = new Date();
      if (freq.months > 0) loopDate.setMonth(loopDate.getMonth() + freq.months);
      else loopDate.setDate(loopDate.getDate() + freq.days);
    }
    
    let safetyCounter = 0;
    while (loopBalance > 0 && safetyCounter < 1000) {
      loopBalance = Math.max(0, loopBalance - plannedAmount);
      plannedProjectionData.push({ x: loopDate.getTime(), y: loopBalance });
      
      if (loopBalance <= 0) break;

      const nextDate = new Date(loopDate);
      if (freq.months > 0) nextDate.setMonth(nextDate.getMonth() + freq.months);
      else nextDate.setDate(nextDate.getDate() + freq.days);
      loopDate = nextDate;
      
      safetyCounter++;
    }
  }

  projectionChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Historical Balance',
          data: historyData,
          borderColor: '#276c54',
          backgroundColor: 'rgba(39, 108, 84, 0.1)',
          fill: true,
          tension: 0,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 10
        },
        {
          label: 'Historical Trend Projection',
          data: historicalProjectionData.length > 1 ? historicalProjectionData : [],
          borderColor: '#a39b8b',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#a39b8b'
        },
        {
          label: 'Planned Projection',
          data: plannedProjectionData.length > 1 ? plannedProjectionData : [],
          borderColor: '#276c54',
          borderDash: [2, 2],
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#276c54'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { family: 'Inter, sans-serif' }, color: '#66706d', boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: '#202323',
          padding: 12,
          titleFont: { size: 14, family: 'Inter, sans-serif' },
          bodyFont: { size: 13, family: 'Inter, sans-serif' },
          callbacks: {
            title: function(context) {
              return shortDate.format(new Date(context[0].raw.x));
            },
            label: function(context) {
              const val = exactMoney.format(context.raw.y);
              const label = context.dataset.label;
              if (label === 'Historical Trend Projection') {
                return [
                  `Projected Balance: ${val}`,
                  `Based on your historical payment frequency,`,
                  `this is your projected timeline.`
                ];
              } else if (label === 'Planned Projection') {
                return [
                  `Projected Balance: ${val}`,
                  `Based on your planned payment schedule.`
                ];
              }
              return `${label}: ${val}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          grid: { display: false },
          ticks: { 
            font: { family: 'Inter, sans-serif' }, 
            color: '#66706d', 
            maxRotation: 45,
            callback: function(value) {
              return new Date(value).getFullYear().toString();
            }
          },
          afterBuildTicks: function(axis) {
            const minYear = new Date(axis.min).getFullYear();
            const maxYear = new Date(axis.max).getFullYear();
            const ticks = [];
            const step = Math.max(1, Math.ceil((maxYear - minYear) / 8));
            for (let y = minYear; y <= maxYear; y += step) {
              ticks.push(new Date(`${y}-01-01T00:00:00`).getTime());
            }
            if (!ticks.includes(axis.max)) {
               ticks.push(axis.max);
            }
            axis.ticks = ticks.map(v => ({ value: v }));
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#d8d2c8' },
          ticks: {
            font: { family: 'Inter, sans-serif' }, color: '#66706d',
            callback: function(value) {
              return '$' + value;
            }
          }
        }
      }
    }
  });
}


function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function exportCsv() {
  const header = ["date", "method", "note", "amount"];
  const lines = state.payments.map((payment) =>
    [payment.date, payment.method, payment.note || "", payment.amount]
      .map((item) => `"${String(item).replaceAll('"', '""')}"`)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "loan-ledger-payments.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("pinInput").value !== "20000") {
      $("pinInput").focus();
      return;
    }
    currentRole = $("roleSelect").value;
    $("roleBadge").textContent = currentRole === "lender" ? "Lender view" : "Borrower view";
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    renderAll();
  });

  $("logoutButton").addEventListener("click", () => {
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    drawHeroChart();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      $(`${tab.dataset.tab}Panel`).classList.add("active");
      if (tab.dataset.tab === "costs") drawCostChart();
    });
  });

  $("settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.principal = Number($("principalInput").value || 0);
    state.loanDate = $("loanDateInput").value;
    state.noteStatus = $("noteStatusInput").value;
    await saveState();
    renderAll();
  });

  $("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.payments.push({
      id: crypto.randomUUID(),
      amount: Number($("paymentAmountInput").value || 0),
      date: $("paymentDateInput").value,
      method: $("paymentMethodInput").value,
      note: $("paymentNoteInput").value.trim(),
    });
    $("paymentAmountInput").value = "";
    $("paymentNoteInput").value = "";
    await saveState();
    renderAll();
  });

  $("ledgerRows").addEventListener("click", async (event) => {
    if (!event.target.matches(".delete-row")) return;
    state.payments = state.payments.filter((payment) => payment.id !== event.target.dataset.id);
    await saveState();
    renderAll();
  });

  ["friendAprInput", "marketReturnInput"].forEach((id) => {
    $(id).addEventListener("input", async () => {
      state.friendApr = Number($("friendAprInput").value || 0);
      state.marketReturn = Number($("marketReturnInput").value || 0);
      await saveState();
      renderAll();
    });
  });

  $("payoffForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.paymentAmount = Number($("paymentAmountInput").value || 0);
    state.paymentFrequency = $("paymentFrequencyInput").value || "monthly";
    state.firstDue = $("firstDueInput").value;
    await saveState();
    renderAll();
  });

  $("exportButton").addEventListener("click", exportCsv);
}

$("paymentDateInput").value = new Date().toISOString().slice(0, 10);
initDataStore();
bindEvents();
renderAll();
drawHeroChart();
