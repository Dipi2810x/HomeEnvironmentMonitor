const statusText = document.getElementById("statusText");
const refreshCsvBtn = document.getElementById("refreshCsvBtn");
const locationBtn = document.getElementById("locationBtn");
const pm1El = document.getElementById("pm1");
const pm25El = document.getElementById("pm25");
const pm10El = document.getElementById("pm10");
const aqiValueEl = document.getElementById("aqiValue");
const airCategoryEl = document.getElementById("airCategory");
const pollenValueEl = document.getElementById("pollenValue");
const aqiGaugeLabelEl = document.getElementById("aqiGaugeLabel");
const logBody = document.getElementById("logBody");
const particles03El = document.getElementById("particles03");
const particles05El = document.getElementById("particles05");
const particles10smallEl = document.getElementById("particles10small");
const particles25El = document.getElementById("particles25");
const particles50El = document.getElementById("particles50");
const particles100El = document.getElementById("particles100");

let pollenSnapshot = null;
let userCoords = null;
let latestReading = null;
let snapshotLog = [];

const trendChart = new Chart(document.getElementById("trendChart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "PM2.5",
        data: [],
        borderColor: "#ff9f1c",
        backgroundColor: "rgba(255, 159, 28, 0.24)",
        borderWidth: 2,
        tension: 0.32,
        fill: true
      },
      {
        label: "Grass Pollen",
        data: [],
        borderColor: "#2ec4b6",
        backgroundColor: "rgba(46, 196, 182, 0.16)",
        borderWidth: 2,
        tension: 0.24,
        fill: true
      }
    ]
  },
  options: chartOptions()
});

const pmBreakdownChart = new Chart(document.getElementById("pmBreakdownChart"), {
  type: "bar",
  data: {
    labels: ["PM1.0", "PM2.5", "PM10"],
    datasets: [
      {
        label: "Latest ug/m3",
        data: [0, 0, 0],
        backgroundColor: ["#5fa8ff", "#ff9f1c", "#2ec4b6"],
        borderRadius: 8
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        labels: { color: "#e8f6ff" }
      }
    },
    scales: {
      x: {
        ticks: { color: "#9fc5dd" },
        grid: { color: "rgba(159, 197, 221, 0.12)" }
      },
      y: {
        beginAtZero: true,
        ticks: { color: "#9fc5dd" },
        grid: { color: "rgba(159, 197, 221, 0.12)" }
      }
    }
  }
});

const aqiGaugeChart = new Chart(document.getElementById("aqiGaugeChart"), {
  type: "doughnut",
  data: {
    labels: ["AQI", "Remaining"],
    datasets: [
      {
        data: [0, 500],
        backgroundColor: ["#ff9f1c", "rgba(159, 197, 221, 0.2)"],
        borderWidth: 0,
        cutout: "74%"
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    rotation: -90,
    circumference: 180,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    }
  }
});

refreshCsvBtn.addEventListener("click", () => {
  refreshCsvData(true);
});
locationBtn.addEventListener("click", requestLocation);

setInterval(refreshCsvData, 5 * 60 * 1000);
setInterval(updatePollen, 5 * 60 * 1000);

refreshCsvData();

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: true,
    scales: {
      x: {
        ticks: { color: "#9fc5dd" },
        grid: { color: "rgba(159, 197, 221, 0.12)" }
      },
      y: {
        beginAtZero: true,
        ticks: { color: "#9fc5dd" },
        grid: { color: "rgba(159, 197, 221, 0.12)" }
      }
    },
    plugins: {
      legend: {
        labels: { color: "#e8f6ff" }
      }
    }
  };
}

async function refreshCsvData(isManual = false) {
  try {
    setStatus("Loading CSV feed...");
    const response = await fetch(`arduino_data.csv?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csvText = await response.text();
      // Extract particle counts (from sensors like PMS) and update dashboard
      const particleCounts = parseParticleCountsFromCsv(csvText);
      updateParticleCountsDisplay(particleCounts);
    const series = buildSeriesFromCsv(csvText);
    if (series.length === 0) {
      setStatus("CSV loaded, but no PM rows found for today.", true);
      return;
    }

    latestReading = series[series.length - 1];
    updateReading(latestReading);
    renderTrend(series);
    renderBreakdown(latestReading);
    renderGauge(pm25ToAqi(latestReading.pm25));
    rebuildSnapshotLog(series);
    renderTable();

    const statusMsg = isManual ? "CSV refreshed on demand." : "CSV feed synced.";
    setStatus(`${statusMsg} ${series.length} buckets loaded.`);
  } catch (err) {
    setStatus(`CSV refresh failed: ${err.message}`, true);
  }
}

function buildSeriesFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return [];
  }

  const now = new Date();
  const buckets = new Map();

  // The sensor may emit PM readings as separate lines per timestamp (PM 1.0, PM 2.5, PM 10).
  // First, assemble per-timestamp partial readings, averaging duplicates, then bucket them.
  const partial = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvTimestampRawLine(lines[i]);
    if (!row) continue;

    const ts = new Date(row.timestamp);
    if (Number.isNaN(ts.getTime()) || !isSameLocalDay(ts, now)) continue;

    const key = row.timestamp; // use the exact timestamp string as grouping key
    if (!partial.has(key)) {
      partial.set(key, { pm1: [], pm25: [], pm10: [] });
    }

    const p = partial.get(key);

    const m1 = /PM\s*1\.0\s*:\s*([\d.]+)/i.exec(row.raw);
    const m25 = /PM\s*2\.5\s*:\s*([\d.]+)/i.exec(row.raw);
    const m10 = /PM\s*10(?:\.0)?\s*:\s*([\d.]+)/i.exec(row.raw);

    if (m1) p.pm1.push(Number(m1[1]));
    if (m25) p.pm25.push(Number(m25[1]));
    if (m10) p.pm10.push(Number(m10[1]));
  }

  const readings = [];
  for (const [tsStr, vals] of partial.entries()) {
    if (vals.pm1.length === 0 || vals.pm25.length === 0 || vals.pm10.length === 0) continue;
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    readings.push({ timestamp: tsStr, pm1: avg(vals.pm1), pm25: avg(vals.pm25), pm10: avg(vals.pm10) });
  }

  for (const r of readings) {
    const ts = new Date(r.timestamp);
    const bucketTs = floorToFiveMinutes(ts.getTime());
    const current = buckets.get(bucketTs) || { pm1: 0, pm25: 0, pm10: 0, count: 0 };
    current.pm1 += r.pm1;
    current.pm25 += r.pm25;
    current.pm10 += r.pm10;
    current.count += 1;
    buckets.set(bucketTs, current);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketTs, value]) => ({
      ts: bucketTs,
      timeLabel: new Date(bucketTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      timeDisplay: new Date(bucketTs).toLocaleString(),
      pm1: value.pm1 / value.count,
      pm25: value.pm25 / value.count,
      pm10: value.pm10 / value.count
    }));
}

function parsePmReadingLine(line) {
  const pm1 = /PM\s*1\.0\s*:\s*([\d.]+)/i.exec(line);
  const pm25 = /PM\s*2\.5\s*:\s*([\d.]+)/i.exec(line);
  const pm10 = /PM\s*10(?:\.0)?\s*:\s*([\d.]+)/i.exec(line);

  if (!pm1 || !pm25 || !pm10) {
    return null;
  }

  return {
    pm1: Number(pm1[1]),
    pm25: Number(pm25[1]),
    pm10: Number(pm10[1])
  };
}

function parseCsvTimestampRawLine(line) {
  const commaIdx = line.indexOf(",");
  if (commaIdx <= 0) {
    return null;
  }

  const timestamp = line.slice(0, commaIdx).trim();
  let raw = line.slice(commaIdx + 1).trim();

  if (raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1).replace(/""/g, '"');
  }

  return { timestamp, raw };
}

function parseParticleCountsFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const counts = { "0.3": null, "0.5": null, "1.0": null, "2.5": null, "5.0": null, "10.0": null };

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvTimestampRawLine(lines[i]);
    if (!row || !/Particles/i.test(row.raw)) continue;

    // Match patterns like: "Particles > 0.3um / 0.1L air:524" or "Particles > 10.0 um / 0.1L air:0"
    const re = /Particles\s*>\s*([\d.]+)\s*um\b[^\d-]*?(\d+)/ig;
    let m;
    while ((m = re.exec(row.raw)) !== null) {
      const size = Number(m[1]).toFixed(1);
      const val = Number(m[2]);
      if (Object.prototype.hasOwnProperty.call(counts, size)) {
        counts[size] = val;
      }
    }
  }

  return counts;
}

function updateParticleCountsDisplay(counts) {
  particles03El.textContent = counts["0.3"] === null ? "-" : `${counts["0.3"]} / 0.1L`;
  particles05El.textContent = counts["0.5"] === null ? "-" : `${counts["0.5"]} / 0.1L`;
  particles10smallEl.textContent = counts["1.0"] === null ? "-" : `${counts["1.0"]} / 0.1L`;
  particles25El.textContent = counts["2.5"] === null ? "-" : `${counts["2.5"]} / 0.1L`;
  particles50El.textContent = counts["5.0"] === null ? "-" : `${counts["5.0"]} / 0.1L`;
  particles100El.textContent = counts["10.0"] === null ? "-" : `${counts["10.0"]} / 0.1L`;
}

function renderTrend(series) {
  trendChart.data.labels = series.map((row) => row.timeLabel);
  trendChart.data.datasets[0].data = series.map((row) => Number(row.pm25.toFixed(1)));
  trendChart.data.datasets[1].data = series.map(() => (pollenSnapshot === null ? null : Number(pollenSnapshot.toFixed(1))));
  trendChart.update();
}

function renderBreakdown(reading) {
  pmBreakdownChart.data.datasets[0].data = [
    Number(reading.pm1.toFixed(1)),
    Number(reading.pm25.toFixed(1)),
    Number(reading.pm10.toFixed(1))
  ];
  pmBreakdownChart.update();
}

function renderGauge(aqi) {
  const bounded = Math.max(0, Math.min(500, aqi.aqi));
  aqiGaugeChart.data.datasets[0].data = [bounded, 500 - bounded];
  aqiGaugeChart.data.datasets[0].backgroundColor[0] = categoryColor(aqi.category);
  aqiGaugeChart.update();
  aqiGaugeLabelEl.textContent = `AQI: ${aqi.aqi} (${aqi.category})`;
}

function categoryColor(category) {
  if (category === "Good") return "#2ec4b6";
  if (category === "Moderate") return "#ffcf56";
  if (category === "Unhealthy for Sensitive Groups") return "#ff9f1c";
  if (category === "Unhealthy") return "#ff6b6b";
  if (category === "Very Unhealthy") return "#b86bff";
  return "#8b0000";
}

function rebuildSnapshotLog(series) {
  snapshotLog = [...series]
    .reverse()
    .map((item) => {
      const aqi = pm25ToAqi(item.pm25);
      return {
        time: item.timeDisplay,
        pm1: item.pm1,
        pm25: item.pm25,
        pm10: item.pm10,
        aqi: aqi.aqi,
        pollen: pollenSnapshot,
        insight: buildInsight(aqi.category, pollenSnapshot)
      };
    });
}

function renderTable() {
  logBody.innerHTML = "";
  for (const item of snapshotLog) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.time}</td>
      <td>${item.pm1.toFixed(1)}</td>
      <td>${item.pm25.toFixed(1)}</td>
      <td>${item.pm10.toFixed(1)}</td>
      <td>${item.aqi}</td>
      <td>${item.pollen === null ? "-" : item.pollen.toFixed(1)}</td>
      <td>${item.insight}</td>
    `;
    logBody.appendChild(tr);
  }
}

function updateReading(reading) {
  pm1El.textContent = `${reading.pm1.toFixed(1)} ug/m3`;
  pm25El.textContent = `${reading.pm25.toFixed(1)} ug/m3`;
  pm10El.textContent = `${reading.pm10.toFixed(1)} ug/m3`;

  const aqi = pm25ToAqi(reading.pm25);
  aqiValueEl.textContent = aqi.aqi;
  airCategoryEl.textContent = aqi.category;
}

async function requestLocation() {
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported in this browser.", true);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userCoords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      };
      setStatus("Location locked. Fetching pollen data...");
      await updatePollen();
      await refreshCsvData();
    },
    (err) => setStatus(`Location failed: ${err.message}`, true),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function updatePollen() {
  if (!userCoords) {
    return;
  }

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userCoords.latitude}&longitude=${userCoords.longitude}&hourly=grass_pollen&forecast_days=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const { time, grass_pollen: grassPollen } = payload.hourly || {};
    if (!time || !grassPollen || time.length === 0 || grassPollen.length === 0) {
      throw new Error("No pollen values found");
    }

    const now = Date.now();
    let bestIdx = 0;
    let bestGap = Infinity;
    for (let i = 0; i < time.length; i += 1) {
      if (!Number.isFinite(Number(grassPollen[i]))) {
        continue;
      }

      const gap = Math.abs(new Date(time[i]).getTime() - now);
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }

    if (!Number.isFinite(Number(grassPollen[bestIdx]))) {
      throw new Error("Pollen data unavailable for your location right now");
    }

    pollenSnapshot = Number(grassPollen[bestIdx]);
    pollenValueEl.textContent = Number.isFinite(pollenSnapshot) ? pollenSnapshot.toFixed(1) : "-";
  } catch (err) {
    setStatus(`Pollen fetch error: ${err.message}`, true);
  }
}

function buildInsight(airCategory, pollen) {
  if (pollen === null) {
    return `${airCategory}; location off, pollen unknown`;
  }

  if ((airCategory === "Unhealthy" || airCategory === "Very Unhealthy" || airCategory === "Hazardous") && pollen >= 4) {
    return "Dual-trigger risk: poor air and high pollen";
  }

  if (airCategory === "Good" && pollen >= 4) {
    return "Air particulate low; symptoms may be pollen-driven";
  }

  if (airCategory !== "Good" && pollen <= 2) {
    return "Particulates likely the main irritant right now";
  }

  return "Mixed exposure: monitor PM and pollen together";
}

function pm25ToAqi(pm25) {
  const bands = [
    { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50, category: "Good" },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100, category: "Moderate" },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, category: "Unhealthy for Sensitive Groups" },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200, category: "Unhealthy" },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300, category: "Very Unhealthy" },
    { cLow: 250.5, cHigh: 500.4, iLow: 301, iHigh: 500, category: "Hazardous" }
  ];

  const band = bands.find((b) => pm25 >= b.cLow && pm25 <= b.cHigh) || bands[bands.length - 1];
  const aqi = Math.round(((band.iHigh - band.iLow) / (band.cHigh - band.cLow)) * (pm25 - band.cLow) + band.iLow);
  return { aqi, category: band.category };
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function floorToFiveMinutes(tsMs) {
  const fiveMinutesMs = 5 * 60 * 1000;
  return Math.floor(tsMs / fiveMinutesMs) * fiveMinutesMs;
}

function setStatus(message, isError = false) {
  statusText.textContent = `Status: ${message}`;
  statusText.style.color = isError ? "#ff6b6b" : "#9fc5dd";
}
