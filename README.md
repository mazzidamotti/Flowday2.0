# Flowday

Task manager personale con integrazione Google Calendar.

## Deploy su Railway

### Variabili d'ambiente da configurare

Vai su Railway → il tuo progetto → Variables, e aggiungi:

| Variabile | Valore |
|-----------|--------|
| `CAL_PERSONALE` | `https://calendar.google.com/calendar/ical/niccolo.mazzidamotti%40gmail.com/public/basic.ics` |
| `CAL_POLITICA` | `https://calendar.google.com/calendar/ical/pll47huqufstfdhtkph8ffh32k%40group.calendar.google.com/public/basic.ics` |
| `CAL_SCUOLA` | `https://calendar.google.com/calendar/ical/m14p9nvtvssrnggt22971id178%40group.calendar.google.com/public/basic.ics` |
| `CAL_SEGRETARIATO` | `https://calendar.google.com/calendar/ical/08e80897867d6b0a30c0dc40346f41cf0e4806d82041cd792a36e357d23e52f6%40group.calendar.google.com/public/basic.ics` |
| `CAL_POLITICAUSI` | `https://calendar.google.com/calendar/ical/ateor2uq88rbtq12449vn4q1u4%40group.calendar.google.com/public/basic.ics` |

### Struttura file

```
flowday/
├── server.js        # Server Node.js (proxy calendario + serve app)
├── package.json     # Configurazione Node
└── public/
    └── index.html   # App React
```

## API

- `GET /api/events?date=2025-04-07` — eventi del giorno
- `GET /api/events/range?from=2025-04-01&to=2025-04-30` — eventi in un periodo
- `GET /` — app web

## Note

- Gli eventi sono cachati 30 minuti in memoria
- Il calendario "Personale" non conta nel calcolo del carico giornaliero
- Gli altri calendari (Politica, Scuola, Segretariato, PoliticaUSI) contano sempre
