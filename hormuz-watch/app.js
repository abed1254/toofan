'use strict';
/* دیده‌بان هرمز — Hormuz Watch
   منابع داده (رایگان و عمومی):
   - هواپیما: adsb.lol v2 (مستقیم → adsb.fi → پراکسی عمومی codetabs، چون adsb.lol هدر CORS نمی‌فرستد)
   - هوا و موج: Open-Meteo (CORS کامل)
   ذخیره‌سازی محلی: تایم‌لاین رویدادها، تماس‌های دیده‌شده، کلید اختیاری FR24
*/

const CENTER = [26.55, 56.25];
const GOHARDO = { lat: 26.51, lon: 57.10 };
const REFRESH_MS = 30000;
const SEEN_PRUNE_MS = 2 * 60 * 60 * 1000; // تماس بعد از ۲ ساعت غیبت دوباره «تازه» حساب می‌شود

const ADSB_SOURCES = [
  { name: 'adsb.lol', url: 'https://api.adsb.lol/v2/lat/26.55/lon/56.25/dist/130' },
  { name: 'adsb.fi', url: 'https://opendata.adsb.fi/api/v2/lat/26.55/lon/56.25/dist/130' },
  { name: 'adsb.lol (پراکسی)', url: 'https://api.codetabs.com/v1/proxy?quest=https://api.adsb.lol/v2/lat/26.55/lon/56.25/dist/130' },
  { name: 'adsb.fi (پراکسی)', url: 'https://api.codetabs.com/v1/proxy?quest=https://opendata.adsb.fi/api/v2/lat/26.55/lon/56.25/dist/130' },
  { name: 'adsb.lol (پراکسی ۲)', url: 'https://api.allorigins.win/raw?url=https%3A%2F%2Fapi.adsb.lol%2Fv2%2Flat%2F26.55%2Flon%2F56.25%2Fdist%2F130' }
];

const DRONE_TYPES = new Set(['Q9', 'R4', 'Y6', 'UAV', 'RQ4', 'MQ9', 'TB2', 'HERM', 'Y9']);
const faNum = n => (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('fa-IR');
const faInt = n => (n === null || n === undefined || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('fa-IR');

/* ---------- طبقه‌بندی ---------- */
function classify(ac) {
  const cs = (ac.flight || '').trim().toUpperCase();
  const t = (ac.t || '').toUpperCase();
  if (DRONE_TYPES.has(t) || cs.includes('FORTE') || cs.includes('UAV')) return 'drone';
  if (ac.dbFlags && (ac.dbFlags & 1) === 1) return 'mil';
  return 'civil';
}

/* ---------- نقشه ---------- */
const map = L.map('map', { zoomControl: true }).setView(CENTER, 8);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CARTO | داده پرواز: adsb.lol',
  maxZoom: 17, subdomains: 'abcd'
}).addTo(map);

// نشان گهردو و مرکز رصد
L.circleMarker([GOHARDO.lat, GOHARDO.lon], { radius: 6, color: '#4ade80', weight: 2, fillColor: '#4ade80', fillOpacity: .6 })
  .addTo(map).bindTooltip('گهردو', { permanent: true, direction: 'top', className: 'port-label' });
L.circle([GOHARDO.lat, GOHARDO.lon], { radius: 50000, color: '#4ade80', weight: 1, dashArray: '4 6', fill: false }).addTo(map);

// خطوط کشتیرانی TSS (تقریبی، بر اساس طرح جداسازی ترافیک تنگه هرمز)
const lanesGroup = L.layerGroup();
const laneIn = [[26.62, 55.90], [26.60, 56.28], [26.52, 56.62], [26.38, 56.95]];   // ورودی — نوار شمالی، به سمت خلیج فارس (غرب‌رو)
const laneOut = [[26.28, 56.90], [26.38, 56.60], [26.47, 56.30], [26.50, 55.95]];  // خروجی — نوار جنوبی، به سمت دریای عمان (شرق‌رو)
L.polyline(laneIn, { color: '#38bdf8', weight: 5, opacity: .55 }).addTo(lanesGroup)
  .bindTooltip('خط ورودی کشتی‌ها', { permanent: true, direction: 'top', className: 'lane-label' });
L.polyline(laneOut, { color: '#fb923c', weight: 5, opacity: .55 }).addTo(lanesGroup)
  .bindTooltip('خط خروجی کشتی‌ها', { permanent: true, direction: 'bottom', className: 'lane-label' });
L.polyline([[26.45, 55.92], [26.50, 56.28], [26.45, 56.63], [26.33, 56.92]],
  { color: '#64748b', weight: 2, dashArray: '3 7', opacity: .8 }).addTo(lanesGroup);
const ports = [
  ['بندرعباس', 27.18, 56.27], ['جاسک', 25.65, 57.77], ['فجیره', 25.12, 56.34],
  ['خصب', 26.18, 56.25], ['جزیره لارک', 26.85, 56.36], ['جزیره قشم', 26.95, 56.27]
];
ports.forEach(([name, la, lo]) => {
  L.circleMarker([la, lo], { radius: 4, color: '#fde68a', weight: 1.5, fillColor: '#fde68a', fillOpacity: .8 })
    .addTo(lanesGroup).bindTooltip(name, { permanent: true, direction: 'top', className: 'port-label' });
});
lanesGroup.addTo(map);

const layers = {
  civil: L.layerGroup().addTo(map),
  mil: L.layerGroup().addTo(map),
  drone: L.layerGroup().addTo(map)
};

/* ---------- ذخیره محلی ---------- */
const store = {
  get events() { try { return JSON.parse(localStorage.getItem('hw_events') || '[]'); } catch { return []; } },
  set events(v) { localStorage.setItem('hw_events', JSON.stringify(v.slice(0, 200))); },
  get seen() { try { return JSON.parse(localStorage.getItem('hw_seen') || '{}'); } catch { return {}; } },
  set seen(v) { localStorage.setItem('hw_seen', JSON.stringify(v)); }
};
let newEventCount = 0;

/* ---------- رندر رویدادها ---------- */
function renderEvents() {
  const box = document.getElementById('eventList');
  const evs = store.events;
  if (!evs.length) {
    box.innerHTML = '<p class="event-empty">هنوز تماسی ثبت نشده است. وقتی تماس نظامی یا پهپاد تازه‌ای دیده شود، اینجا می‌آید.</p>';
    return;
  }
  box.innerHTML = evs.map(e => `
    <div class="event-item ${e.kind === 'drone' ? 'drone' : ''} ${e.fresh ? 'new' : ''}">
      ${e.kind === 'drone' ? '🛸 پهپاد' : '🪖 نظامی'} — <span class="cs">${e.callsign || 'بدون کال‌ساین'}</span>
      ${e.type ? `(<span dir="ltr">${e.type}</span>)` : ''}<br>
      <time>${e.timeText}</time>
    </div>`).join('');
}

function logEvent(ac, kind) {
  const now = new Date();
  const evs = store.events;
  evs.unshift({
    hex: ac.hex, kind,
    callsign: (ac.flight || '').trim(),
    type: ac.t || '',
    ts: now.getTime(),
    timeText: now.toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }),
    fresh: true
  });
  // پرچم fresh فقط برای آخرین دسته می‌ماند
  evs.forEach((e, i) => { if (i > 4) e.fresh = false; });
  store.events = evs;
  newEventCount++;
  const badge = document.getElementById('evtBadge');
  badge.textContent = faNum(newEventCount);
  badge.classList.remove('hidden');
  renderEvents();
  if (navigator.vibrate) navigator.vibrate(120);
}

/* ---------- دریافت پروازها ---------- */
const statusEl = document.getElementById('statusBar');
function setStatus(txt, cls) {
  statusEl.textContent = txt;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

let lastSource = '';
async function fetchAircraft() {
  for (const src of ADSB_SOURCES) {
    try {
      const r = await fetch(src.url, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      const list = j.ac || j.aircraft || j.acList;
      if (Array.isArray(list)) { lastSource = src.name; return list; }
    } catch (e) { /* منبع بعدی */ }
  }
  throw new Error('همه منابع پرواز ناموفق بودند');
}

const newHexes = new Set();
function planeIcon(ac, kind) {
  const track = (typeof ac.track === 'number') ? ac.track : (ac.true_heading || 0);
  const glyph = kind === 'drone' ? '✛' : '✈';
  const pulse = newHexes.has(ac.hex) ? '<span class="pulse-ring"></span>' : '';
  return L.divIcon({
    className: 'plane-icon',
    html: `<div class="plane-wrap">${pulse}<span class="plane-glyph ${kind}" style="transform:rotate(${track - 45}deg)">${glyph}</span></div>`,
    iconSize: [30, 30], iconAnchor: [15, 15]
  });
}

function popupHtml(ac, kind) {
  const cs = (ac.flight || '').trim() || '—';
  const kindTxt = kind === 'mil' ? '<span class="kind-mil">نظامی</span>'
    : kind === 'drone' ? '<span class="kind-drone">پهپاد</span>' : 'مسافری/باری';
  const alt = ac.alt_baro === 'ground' ? 'روی زمین'
    : (typeof ac.alt_baro === 'number' ? faInt(ac.alt_baro) + ' پا' : '—');
  const spd = typeof ac.gs === 'number' ? faInt(ac.gs * 1.852) + ' km/h' : '—';
  const hdg = typeof ac.track === 'number' ? faInt(ac.track) + '°' : '—';
  return `<div class="pop">
    <span class="cs">${cs}</span> — ${kindTxt}<br>
    نوع: <span dir="ltr">${ac.t || '—'}</span><br>
    رجیستر: <span dir="ltr">${ac.r || '—'}</span><br>
    ارتفاع: ${alt}<br>
    سرعت زمینی: ${spd}<br>
    جهت حرکت: ${hdg}
  </div>`;
}

async function refreshFlights(manual) {
  try {
    const list = await fetchAircraft();
    const seen = store.seen;
    const now = Date.now();
    Object.keys(seen).forEach(h => { if (now - seen[h] > SEEN_PRUNE_MS) delete seen[h]; });

    newHexes.clear();
    const counts = { civil: 0, mil: 0, drone: 0 };
    const freshAlerts = [];

    for (const lyr of Object.values(layers)) lyr.clearLayers();

    for (const ac of list) {
      if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;
      const kind = classify(ac);
      counts[kind]++;
      const isWatched = kind !== 'civil';
      if (isWatched && !seen[ac.hex]) {
        newHexes.add(ac.hex);
        freshAlerts.push(ac);
        logEvent(ac, kind);
      }
      if (isWatched) seen[ac.hex] = now;
      L.marker([ac.lat, ac.lon], { icon: planeIcon(ac, kind) })
        .addTo(layers[kind])
        .bindPopup(popupHtml(ac, kind));
    }
    store.seen = seen;

    document.getElementById('cntCivil').textContent = faNum(counts.civil);
    document.getElementById('cntMil').textContent = faNum(counts.mil);
    document.getElementById('cntDrone').textContent = faNum(counts.drone);

    const t = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setStatus(`زنده — ${faNum(list.length)} پرواز | منبع: ${lastSource} | ${t}`, 'ok');

    const watch = document.getElementById('watchMode').checked;
    const banner = document.getElementById('alertBanner');
    if (freshAlerts.length && (watch || manual === false)) {
      banner.innerHTML = '🔔 <b>' + faNum(freshAlerts.length) + ' تماس تازه:</b> ' +
        freshAlerts.map(a => `<span dir="ltr">${(a.flight || '').trim() || a.hex}</span> (${a.t || '؟'})`).join('، ');
      banner.classList.remove('hidden');
    }
  } catch (e) {
    setStatus('خطا در دریافت داده پرواز — تلاش دوباره تا ۳۰ ثانیه دیگر', 'err');
  }
}

/* ---------- ساحل من ---------- */
const COMPASS = ['شمال', 'شمال‌شرق', 'شرق', 'جنوب‌شرق', 'جنوب', 'جنوب‌غرب', 'غرب', 'شمال‌غرب'];
const compass = deg => (typeof deg === 'number') ? COMPASS[Math.round(deg / 45) % 8] : '—';
const WMO = {
  0: 'صاف ☀️', 1: 'غالباً صاف 🌤', 2: 'نیمه‌ابری ⛅', 3: 'ابری ☁️',
  45: 'مه 🌫', 48: 'مه یخبندان 🌫', 51: 'نم‌نم باران 🌦', 53: 'نم‌نم باران 🌦', 55: 'نم‌نم باران 🌦',
  61: 'باران 🌧', 63: 'باران 🌧', 65: 'باران شدید 🌧', 71: 'برف 🌨', 73: 'برف 🌨', 75: 'برف شدید 🌨',
  80: 'رگبار 🌦', 81: 'رگبار 🌦', 82: 'رگبار شدید ⛈', 95: 'رعدوبرق ⛈', 96: 'توفان تگرگ ⛈', 99: 'توفان تگرگ ⛈'
};

async function refreshCoast() {
  const dateEl = document.getElementById('coastDate');
  dateEl.textContent = new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' — گهردو';
  try {
    const fUrl = `https://api.open-meteo.com/v1/forecast?latitude=${GOHARDO.lat}&longitude=${GOHARDO.lon}` +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
      '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code&forecast_days=1&timezone=Asia%2FTehran';
    const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${GOHARDO.lat}&longitude=${GOHARDO.lon}` +
      '&current=wave_height,wave_period,wave_direction&hourly=wave_height&forecast_days=1&timezone=Asia%2FTehran';
    const [f, m] = await Promise.all([fetch(fUrl).then(r => r.json()), fetch(mUrl).then(r => r.json())]);
    const c = f.current;
    document.getElementById('cTemp').textContent = faNum(c.temperature_2m) + ' °C';
    document.getElementById('cCond').textContent = WMO[c.weather_code] || '—';
    document.getElementById('cWind').textContent = faNum(c.wind_speed_10m) + ' km/h';
    document.getElementById('cGust').textContent = faNum(c.wind_gusts_10m) + ' km/h';
    document.getElementById('cWindDir').textContent = compass(c.wind_direction_10m);
    document.getElementById('cHum').textContent = faNum(c.relative_humidity_2m) + '٪';
    if (m.current) {
      document.getElementById('cWave').textContent = faNum(m.current.wave_height) + ' m';
      document.getElementById('cWavePer').textContent = faNum(m.current.wave_period) + ' s';
    }
    if (m.hourly && m.hourly.wave_height) {
      document.getElementById('cWaveMax').textContent = faNum(Math.max(...m.hourly.wave_height.filter(v => v !== null))) + ' m';
    }
    const rainMax = Math.max(...(f.hourly.precipitation_probability || []).map(v => v || 0));
    document.getElementById('cRain').textContent = faNum(rainMax) + '٪';

    const nowHour = new Date().getHours();
    const hh = document.getElementById('hourly');
    hh.innerHTML = f.hourly.time.map((t, i) => {
      const hr = new Date(t).getHours();
      return `<div class="hour-cell ${hr === nowHour ? 'now' : ''}">
        <div>${faInt(hr)}:۰۰</div>
        <div>${WMO[f.hourly.weather_code[i]] ? WMO[f.hourly.weather_code[i]].split(' ').pop() : ''}</div>
        <div class="h-temp">${faNum(f.hourly.temperature_2m[i])}°</div>
        <div>🌬 ${faNum(f.hourly.wind_speed_10m[i])}</div>
        <div>💧 ${faNum(f.hourly.precipitation_probability[i] || 0)}٪</div>
      </div>`;
    }).join('');
  } catch (e) {
    dateEl.textContent = 'خطا در دریافت هوای گهردو — اتصال اینترنت را چک کن و دوباره تلاش کن.';
  }
}

/* ---------- زبانه‌ها و کنترل‌ها ---------- */
document.querySelectorAll('.tabbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + btn.dataset.tab));
    if (btn.dataset.tab === 'map') setTimeout(() => map.invalidateSize(), 60);
    if (btn.dataset.tab === 'coast') refreshCoast();
    if (btn.dataset.tab === 'events') {
      newEventCount = 0;
      document.getElementById('evtBadge').classList.add('hidden');
    }
  });
});
document.getElementById('fltCivil').addEventListener('change', e => e.target.checked ? layers.civil.addTo(map) : map.removeLayer(layers.civil));
document.getElementById('fltMil').addEventListener('change', e => e.target.checked ? layers.mil.addTo(map) : map.removeLayer(layers.mil));
document.getElementById('fltDrone').addEventListener('change', e => e.target.checked ? layers.drone.addTo(map) : map.removeLayer(layers.drone));
document.getElementById('fltLanes').addEventListener('change', e => e.target.checked ? lanesGroup.addTo(map) : map.removeLayer(lanesGroup));
document.getElementById('btnRefresh').addEventListener('click', () => refreshFlights(true));
document.getElementById('btnCoastRefresh').addEventListener('click', refreshCoast);
document.getElementById('btnClearEvents').addEventListener('click', () => {
  store.events = []; store.seen = {}; renderEvents();
});
document.getElementById('alertBanner').addEventListener('click', () => {
  document.getElementById('alertBanner').classList.add('hidden');
});

// کلید اختیاری FR24 (فقط ذخیره محلی برای آینده)
const keyInput = document.getElementById('fr24Key');
keyInput.value = localStorage.getItem('hw_fr24_key') || '';
document.getElementById('btnSaveKey').addEventListener('click', () => {
  localStorage.setItem('hw_fr24_key', keyInput.value.trim());
  document.getElementById('btnSaveKey').textContent = 'ذخیره شد ✓';
  setTimeout(() => document.getElementById('btnSaveKey').textContent = 'ذخیره کلید', 1500);
});

/* ---------- شروع ---------- */
renderEvents();
refreshFlights(false);
refreshCoast();
setInterval(refreshFlights, REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
