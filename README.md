# Milepost

Trip planner for property-carrying truck drivers. Enter the current location, pickup, drop-off and hours already used in the 70-hour cycle. Milepost returns a route map with every required stop and a filled-out FMCSA daily log sheet for each day of the trip.

Django REST API + React (Vite, TypeScript, Tailwind v4). Free, key-less map services: OpenFreeMap tiles, OSRM routing, Photon (OpenStreetMap) place search.

## Run locally

Requirements: Python 3.12+, Node 20+.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to Django. Click **Load Sample Trip** for a three-day example.

### Single service (production)

```bash
cd frontend && npm run build
cd ../backend && DJANGO_DEBUG=0 DJANGO_SECRET_KEY=change-me DJANGO_ALLOWED_HOSTS=your.host .venv/bin/gunicorn config.wsgi -b 0.0.0.0:8000
```

Django serves the built React app (WhiteNoise) and the API from one process.

The root `Dockerfile` does both steps and is what Railway builds. Variables: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and `DJANGO_DB_PATH` pointing at a mounted volume (e.g. `/data/db.sqlite3`) so saved trips survive redeploys.

### Tests

```bash
cd backend && .venv/bin/python manage.py test trips
```

## How the plan is built

`backend/trips/services/hos.py` simulates the trip on the 15-minute grid used by paper logs. Before every driving chunk it re-checks each limit and inserts whatever the rules require:

| Rule | Source | Planner behavior |
|---|---|---|
| 11 hours driving after 10 hours off | 49 CFR 395.3(a)(3) | 10-hour break in the sleeper berth |
| No driving after the 14th hour on duty | 395.3(a)(2) | 10-hour break in the sleeper berth |
| 30 minutes off driving after 8 hours of driving | 395.3(a)(3)(ii) | 30-minute off-duty break. Fuel, pickup and drop-off stops of 30+ minutes count |
| 70 hours on duty in 8 days | 395.3(b)(2) | 34-hour restart (395.3(c)) |
| Fuel at least every 1,000 miles | Trip assumption | 30 minutes on duty. Merged with a due 30-minute break after 650 miles |
| 1 hour for pickup and drop-off | Trip assumption | 1 hour on duty, not driving |

Other assumptions: the driver starts rested, does a 15-minute pre-trip inspection each duty day and a post-trip inspection at delivery, and drives at the OSRM road estimate capped at a 60 mph average. Hours already used in the cycle stay in the 8-day window for the whole trip (their exact days are unknown), until a 34-hour restart clears them.

`logs.py` splits the timeline into midnight-to-midnight sheets (each totals 24:00), records the city and state at every change of duty status, fills the 70-hour / 8-day recap, and independently re-checks the plan. The result is shown as the "Hours of service check" on the route page.

## Editing a daily log

On the logs page, **Edit Log** opens the sheet for changes:

- Drag across a row of the grid to put that period on that duty status, the way a driver draws on paper.
- Drag a piece of the line up or down (or focus it and press the up and down arrows) to move it to another duty status.
- Drag a round handle sideways (or use the left and right arrows) to move a change of duty status. Dropping it on the next change removes the piece in between. Times snap to 15 minutes.
- Neighbors on the same duty status join automatically, so the line only has a point where it changes rows.
- The entry list below the sheet edits the same data with plain form fields: status, start time, location and note, plus remove.
- The header and shipping fields are typed straight onto the sheet: From, To, total miles driving, total mileage, truck and trailer numbers, carrier, office and terminal addresses, driver, co-driver, shipping document and commodity. From, To and mileage are per day; the rest apply to every sheet.
- Undo and redo (Ctrl+Z, Shift+Ctrl+Z) for the duty status line.

While editing, the server recomputes totals, remarks, the 70-hour recap and hours-of-service violations, and the sheet marks any driving that breaks a limit in red. Saving requires a reason, which is stored and printed on the sheet, as ELD rules require for edits (395.30). Later days are rechecked too, since a short rest carries over. **Restore Planned Log** brings back the original plan for that day.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/places/search?q=` | US place autocomplete |
| GET | `/api/places/reverse?lat=&lon=` | "City, ST" for a coordinate |
| POST | `/api/trips` | Plan and save a trip |
| GET | `/api/trips/<id>` | Fetch a saved trip |
| PUT | `/api/trips/<id>/logs/<day>` | Save a driver's edit of one daily log (entries, miles, total mileage, from, to, reason, driver details) |
| POST | `/api/trips/<id>/logs/<day>/preview` | Recompute totals, recap and violations for an unsaved edit |
| DELETE | `/api/trips/<id>/logs/<day>` | Restore the planned log for that day |

`POST /api/trips` body:

```json
{
  "current": { "label": "Joliet, IL", "lat": 41.526, "lon": -88.084 },
  "pickup": { "label": "Indianapolis, IN" },
  "dropoff": { "label": "Salt Lake City, UT" },
  "cycle_used_hours": 21.5,
  "departure": "2026-10-03T06:00",
  "driver": { "name": "", "carrier": "", "vehicle_numbers": "" }
}
```

Places without coordinates are geocoded. `departure` is wall-clock time at the home terminal.

## Design

UI follows the Uber DESIGN.md from [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (black-and-white transportation language, pill controls, ride-request style form), adjusted with the [taste skill](https://github.com/Leonxlnx/taste-skill) and audited against Vercel's [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines). Light and dark themes, keyboard accessible, printable logs (one sheet per page).
