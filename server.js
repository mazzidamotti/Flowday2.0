const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Calendari configurati via variabili d'ambiente
// Formato: CAL_NOME=URL_ICS (es. CAL_SCUOLA=https://calendar.google.com/...)
const CALENDARS = {
  Personale:     process.env.CAL_PERSONALE,
  Politica:      process.env.CAL_POLITICA,
  Scuola:        process.env.CAL_SCUOLA,
  Segretariato:  process.env.CAL_SEGRETARIATO,
  PoliticaUSI:   process.env.CAL_POLITICAUSI,
};

// Calendario personale → non conta nel carico
const PERSONAL_CALENDARS = new Set(['Personale']);

// Cache in memoria: rinnova ogni 30 minuti
let cache = { events: [], lastFetch: 0 };
const CACHE_TTL = 30 * 60 * 1000;

function fetchUrl(icsUrl) {
  return new Promise((resolve, reject) => {
    https.get(icsUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Parser ICS minimale: estrae VEVENT con SUMMARY, DTSTART, DTEND/DURATION
function parseICS(icsText, calendarName) {
  const events = [];
  const lines = icsText.replace(/\r\n /g, '').split(/\r\n|\n/);
  let inEvent = false;
  let current = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current.summary && current.dtstart) {
        const ev = buildEvent(current, calendarName);
        if (ev) events.push(ev);
      }
      inEvent = false; continue;
    }
    if (!inEvent) continue;

    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.substring(0, sep).split(';')[0].toUpperCase();
    const val = line.substring(sep + 1);

    if (key === 'SUMMARY') current.summary = val;
    else if (key === 'DTSTART') current.dtstart = val;
    else if (key === 'DTEND') current.dtend = val;
    else if (key === 'DURATION') current.duration = val;
    else if (key === 'UID') current.uid = val;
  }
  return events;
}

function parseICSDate(s) {
  // FORMAT: 20250407T143000Z or 20250407T143000 or 20250407
  if (!s) return null;
  const clean = s.replace(/[TZ]/g, '');
  if (s.includes('T')) {
    return new Date(
      +clean.slice(0,4), +clean.slice(4,6)-1, +clean.slice(6,8),
      +clean.slice(8,10)||0, +clean.slice(10,12)||0
    );
  }
  return new Date(+clean.slice(0,4), +clean.slice(4,6)-1, +clean.slice(6,8));
}

function parseDuration(s) {
  // PT1H30M, P1D, PT45M etc.
  if (!s) return 60;
  let mins = 0;
  const days = s.match(/(\d+)D/); if (days) mins += +days[1] * 24 * 60;
  const hours = s.match(/(\d+)H/); if (hours) mins += +hours[1] * 60;
  const m = s.match(/(\d+)M/); if (m) mins += +m[1];
  return mins || 60;
}

function buildEvent(ev, calendarName) {
  const start = parseICSDate(ev.dtstart);
  if (!start) return null;

  let durMin = 60;
  if (ev.dtend) {
    const end = parseICSDate(ev.dtend);
    if (end) durMin = Math.round((end - start) / 60000);
  } else if (ev.duration) {
    durMin = parseDuration(ev.duration);
  }

  // Salta eventi di tutto il giorno lunghissimi (vacanze multi-giorno)
  if (durMin > 24 * 60 && PERSONAL_CALENDARS.has(calendarName)) return null;

  const hh = String(start.getHours()).padStart(2,'0');
  const mm = String(start.getMinutes()).padStart(2,'0');

  return {
    id: `${calendarName}_${ev.uid || Math.random()}`,
    name: ev.summary,
    time: `${hh}:${mm}`,
    dur: durMin,
    calendarName,
    personal: PERSONAL_CALENDARS.has(calendarName),
    date: start.toISOString().slice(0,10),
    source: 'gcal',
  };
}

async function refreshCalendars() {
  const now = Date.now();
  if (now - cache.lastFetch < CACHE_TTL && cache.events.length > 0) return cache.events;

  const allEvents = [];
  for (const [name, icsUrl] of Object.entries(CALENDARS)) {
    if (!icsUrl) continue;
    try {
      const text = await fetchUrl(icsUrl);
      const events = parseICS(text, name);
      allEvents.push(...events);
    } catch (e) {
      console.error(`Error fetching ${name}:`, e.message);
    }
  }

  cache = { events: allEvents, lastFetch: now };
  return allEvents;
}

// Filtra eventi per la data odierna (ISO string YYYY-MM-DD)
function eventsForDate(events, dateStr) {
  return events.filter(e => e.date === dateStr).sort((a,b) => a.time.localeCompare(b.time));
}

// Server HTTP
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS per sviluppo locale
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // API: GET /api/events?date=2025-04-07
  if (pathname === '/api/events') {
    try {
      const events = await refreshCalendars();
      const date = parsed.query.date || new Date().toISOString().slice(0,10);
      const filtered = eventsForDate(events, date);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events: filtered, cachedAt: new Date(cache.lastFetch).toISOString() }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API: GET /api/events/range?from=2025-04-01&to=2025-04-30
  if (pathname === '/api/events/range') {
    try {
      const events = await refreshCalendars();
      const from = parsed.query.from || new Date().toISOString().slice(0,10);
      const to = parsed.query.to || from;
      const filtered = events.filter(e => e.date >= from && e.date <= to)
        .sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events: filtered }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Serve app HTML
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end('App not found');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Flowday server running on port ${PORT}`);
  console.log('Calendars configured:', Object.entries(CALENDARS).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none');
});
