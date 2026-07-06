# 🍔 Felix vs Shervin — Food Tracker

Wer gibt weniger für Essen aus? Tägliches Tracking für Juli 2026 (Wochentage).

## Setup

```bash
cd backend
npm install
npm start
```

Dann öffne http://localhost:3001 im Browser.

## Projekt-Struktur

```
├── backend/
│   ├── server.js        # Express API Server
│   ├── package.json
│   └── data/
│       └── expenses.json # Auto-generiert, Daten
└── frontend/
    ├── index.html        # Hauptseite
    ├── style.css         # Dark-Mode Design
    └── app.js            # Frontend-Logik
```

## API Endpoints

| Methode | Route | Beschreibung |
|---------|-------|-------------|
| GET | `/api/expenses` | Alle Ausgaben |
| POST | `/api/expenses` | Neue Ausgabe hinzufügen |
| DELETE | `/api/expenses/:id` | Ausgabe löschen |
| GET | `/api/summary` | Zusammenfassung & Vergleich |

## Deployment

Auf einem Server mit Node.js:

```bash
cd backend
npm install --production
PORT=3001 node server.js
```

Oder mit einem Prozessmanager wie `pm2`:

```bash
npm install -g pm2
pm2 start backend/server.js --name food-tracker
```
