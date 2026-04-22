const statusText = document.getElementById("statusText");
const connectBtn = document.getElementById("connectBtn");
const locationBtn = document.getElementById("locationBtn");
const pm1El = document.getElementById("pm1");
const pm25El = document.getElementById("pm25");
const pm10El = document.getElementById("pm10");
const aqiValueEl = document.getElementById("aqiValue");
const airCategoryEl = document.getElementById("airCategory");
const pollenValueEl = document.getElementById("pollenValue");
const logBody = document.getElementById("logBody");

let port;
let reader;
let keepReading = false;
let latestReading = null;
let pollenSnapshot = null;
let userCoords = null;
const sampleBuffer = [];
const emptyReading = { pm1: Number.NaN, pm25: Number.NaN, pm10: Number.NaN };
let serialPartialReading = { ...emptyReading };
let csvDaySeries = [];

const chart = new Chart(document.getElementById("trendChart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "PM2.5",
        data: [],
        borderColor: "#ffb703",
        backgroundColor: "rgba(255, 183, 3, 0.2)",
        tension: 0.28,
        fill: true
      },
      {
        label: "Grass Pollen",
        data: [],
        borderColor: "#7dd3fc",
        backgroundColor: "rgba(125, 211, 252, 0.12)",
        tension: 0.28,
        fill: true
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    scales: {
      x: {
        ticks: { color: "#9ac2b5" },
        grid: { color: "rgba(154, 194, 181, 0.12)" }
      },
      y: {
        ticks: { color: "#9ac2b5" },
        grid: { color: "rgba(154, 194, 181, 0.12)" }
      }
    },
    plugins: {
      legend: {
        labels: { color: "#e5f7f1" }
      }
    }
  }
});

const stored = localStorage.getItem("pmPollenLog");
const snapshotLog = stored ? JSON.parse(stored) : [];
renderTable();
renderChart();
refreshCsvDayData();

connectBtn.addEventListener("click", connectArduino);
locationBtn.addEventListener("click", requestLocation);

setInterval(captureFiveMinuteSnapshot, 5 * 60 * 1000);
setInterval(updatePollen, 5 * 60 * 1000);
setInterval(refreshCsvDayData, 5 * 60 * 1000);
if (navigator.serial === undefined) {
  setStatus("Web Serial is not available in this browser. Use Chrome or Edge on desktop.", true);
  connectBtn.disabled = true;
}

async function connectArduino() {
  if (!navigator.serial) {
    setStatus("Web Serial unavailable in this browser.", true);
    return;
  }

  try {
    setStatus("Requesting serial port...");
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });

    keepReading = true;
    connectBtn.disabled = true;
    setStatus("Arduino connected. Reading sensor stream...");
    await readSerialLines();
  } catch (err) {
    setStatus(`Connection failed: ${err.message}`, true);
    connectBtn.disabled = false;
  }
}

async function readSerialLines() {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  const inputStream = decoder.readable;
  reader = inputStream.getReader();

  let lineBuffer = "";
  while (keepReading) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    lineBuffer += value;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop();

    for (const rawLine of lines) {
      parseSerialLine(rawLine.trim());
    }
  }

  reader.releaseLock();
}

function parseSerialLine(line) {
  if (!line) {
    return;
  }

  const result = extractReadingFromLine(line, serialPartialReading);
  serialPartialReading = result.partial;

  if (result.complete) {
    updateReading(result.reading);
    serialPartialReading = { ...emptyReading };
  }
}

function extractReadingFromLine(line, partialInput = emptyReading) {
  const partial = { ...partialInput };

  if (line.startsWith("{")) {
    try {
      const data = JSON.parse(line);
      const reading = {
        pm1: Number(data.pm1_0),
        pm25: Number(data.pm2_5),
        pm10: Number(data.pm10)
      };
      if (isCompleteReading(reading)) {
        return { complete: true, reading, partial: { ...emptyReading } };
      }
    } catch {
      // Ignore malformed JSON lines.
    }
  }

  const pm1 = /PM\s*1\.0\s*:\s*([\d.]+)/i.exec(line);
  const pm25 = /PM\s*2\.5\s*:\s*([\d.]+)/i.exec(line);
  const pm10 = /PM\s*10(?:\.0)?\s*:\s*([\d.]+)/i.exec(line);

  if (pm1) partial.pm1 = Number(pm1[1]);
  if (pm25) partial.pm25 = Number(pm25[1]);
  if (pm10) partial.pm10 = Number(pm10[1]);

  if (isCompleteReading(partial)) {
    return { complete: true, reading: { ...partial }, partial: { ...emptyReading } };
  }

  return { complete: false, reading: null, partial };
}

function isCompleteReading(reading) {
  return Number.isFinite(reading.pm1) && Number.isFinite(reading.pm25) && Number.isFinite(reading.pm10);
}

function updateReading(reading) {
  latestReading = { ...reading, ts: new Date().toISOString() };
  sampleBuffer.push(latestReading);

  pm1El.textContent = `${reading.pm1.toFixed(1)} ug/m3`;
  pm25El.textContent = `${reading.pm25.toFixed(1)} ug/m3`;
  pm10El.textContent = `${reading.pm10.toFixed(1)} ug/m3`;

  const aqi = pm25ToAqi(reading.pm25);
  aqiValueEl.textContent = aqi.aqi;
  airCategoryEl.textContent = aqi.category;
}

function captureFiveMinuteSnapshot() {
  if (sampleBuffer.length === 0) {
    return;
  }

  const avgPm1 = avg(sampleBuffer.map((s) => s.pm1));
  const avgPm25 = avg(sampleBuffer.map((s) => s.pm25));
  const avgPm10 = avg(sampleBuffer.map((s) => s.pm10));
  const aqi = pm25ToAqi(avgPm25);
  const pollen = pollenSnapshot !== null ? pollenSnapshot : null;

  const insight = buildInsight(aqi.category, pollen);
  const entry = {
    time: new Date().toLocaleString(),
    pm1: avgPm1,
    pm25: avgPm25,
    pm10: avgPm10,
    aqi: aqi.aqi,
    pollen,
    insight
  };

  snapshotLog.unshift(entry);
  if (snapshotLog.length > 288) {
    snapshotLog.length = 288;
  }

  localStorage.setItem("pmPollenLog", JSON.stringify(snapshotLog));
  sampleBuffer.length = 0;

  renderTable();
  renderChart();
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

function renderChart() {
  if (csvDaySeries.length > 0) {
    chart.data.datasets[0].label = "PM2.5 (today)";
    chart.data.datasets[1].label = "Grass Pollen";
    chart.data.labels = csvDaySeries.map((r) => r.timeLabel);
    chart.data.datasets[0].data = csvDaySeries.map((r) => Number(r.pm25.toFixed(1)));
    chart.data.datasets[1].data = csvDaySeries.map(() => null);
    chart.update();
    return;
  }

  const recent = [...snapshotLog].slice(0, 36).reverse();
  chart.data.datasets[0].label = "PM2.5";
  chart.data.datasets[1].label = "Grass Pollen";
  chart.data.labels = recent.map((r) => shortTime(r.time));
  chart.data.datasets[0].data = recent.map((r) => Number(r.pm25.toFixed(1)));
  chart.data.datasets[1].data = recent.map((r) => (r.pollen === null ? null : Number(r.pollen.toFixed(1))));
  chart.update();
}

async function refreshCsvDayData() {
  try {
    const response = await fetch(`arduino_data.csv?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const daySeries = buildTodaySeriesFromCsv(csvText);
    if (daySeries.length === 0) {
      return;
    }

    csvDaySeries = daySeries;
    const latest = daySeries[daySeries.length - 1];
    if (latest) {
      updateReading({ pm1: latest.pm1, pm25: latest.pm25, pm10: latest.pm10 });
    }
    renderChart();
  } catch (err) {
    console.warn(`CSV refresh skipped: ${err.message}`);
  }
}

function buildTodaySeriesFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return [];
  }

  const now = new Date();
  const buckets = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvTimestampRawLine(lines[i]);
    if (!row) {
      continue;
    }

    const ts = new Date(row.timestamp);
    if (Number.isNaN(ts.getTime()) || !isSameLocalDay(ts, now)) {
      continue;
    }

    const parsed = extractReadingFromLine(row.raw, emptyReading);
    if (!parsed.complete) {
      continue;
    }

    const bucketTs = floorToFiveMinutes(ts.getTime());
    const current = buckets.get(bucketTs) || { pm1: 0, pm25: 0, pm10: 0, count: 0 };
    current.pm1 += parsed.reading.pm1;
    current.pm25 += parsed.reading.pm25;
    current.pm10 += parsed.reading.pm10;
    current.count += 1;
    buckets.set(bucketTs, current);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketTs, value]) => ({
      ts: bucketTs,
      timeLabel: new Date(bucketTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      pm1: value.pm1 / value.count,
      pm25: value.pm25 / value.count,
      pm10: value.pm10 / value.count
    }));
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

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function floorToFiveMinutes(tsMs) {
  const fiveMinutesMs = 5 * 60 * 1000;
  return Math.floor(tsMs / fiveMinutesMs) * fiveMinutesMs;
}

function shortTime(text) {
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) {
    return text;
  }
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    setStatus("Pollen data updated.");
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

function avg(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function setStatus(message, isError = false) {
  statusText.textContent = `Status: ${message}`;
  statusText.style.color = isError ? "#ff7b72" : "#9ac2b5";
}
