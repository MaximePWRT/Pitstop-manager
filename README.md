# Pitstop Manager

A real-time pitstop planning and coordination tool for GT3 endurance racing. Designed to be used by a pit wall team across multiple devices simultaneously, with live synchronization via WebSocket.

## Overview

Pitstop Manager helps race engineers and pit crew coordinators plan, schedule, and track pitstops during endurance races. All connected clients share the same state in real time — any change made on one device is instantly reflected on all others.

It also integrates with an ESP32-based hardware penalty timer, allowing the pit wall to arm the exact penalty delay directly from the browser.

## Features

- **Real-time multi-client sync** via Socket.io — multiple devices, one shared view
- **Three operating modes**:
  - **Display** — live schedule table showing all upcoming and completed pitstops
  - **Management** — add, edit, delete pitstops; toggle status between Scheduled / Done
  - **Configuration** — manage cars, crews, rigs, and pitstop types
- **Pitstop fields**: car number, target lap, pitstop type, assigned crew, assigned rig, status, penalty duration (seconds)
- **Penalty / ESP32 integration**: send a penalty delay to an ESP32 hardware timer over HTTP; visual indicator (armed / pending) on each pitstop row
- **Live clock** displayed in the navigation bar
- **Export / Import**: save and restore the full race state (config + pitstops) as a JSON file
- **Lap simulation**: manual lap counter increment for testing

## Tech Stack

| Layer    | Technology                    |
|----------|-------------------------------|
| Backend  | Node.js, Express 5, Socket.io |
| Frontend | Vanilla HTML / CSS / JS       |
| Protocol | WebSocket (Socket.io)         |

## Project Structure

```
Pitstop-manager/
├── server.js          # Express server + Socket.io sync logic
├── package.json
└── public/
    ├── index.html     # Single-page application (all views)
    └── script.js      # All client-side logic
```

## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)

### Installation

```bash
git clone https://github.com/MaximePWRT/Pitstop-manager.git
cd Pitstop-manager
npm install
```

### Run

```bash
node server.js
```

Then open `http://localhost:3000` in a browser. Open the same URL on any other device on the same network to join the shared session.

## Configuration

### Cars

Add cars with a number (1–999) and a color label. Colors are used to visually distinguish cars in the schedule table.

Default cars: #30 (light blue), #31 (yellow), #32 (red), #46 (green), #777 (white).

### Crews

Named mechanic crews. Each pitstop can be assigned to one crew.

### Rigs

Named jack/rig sets. Each pitstop can be assigned to one rig.

### Pitstop Types

Fully configurable types with a display name, a short code, and a color category. Default types:

| Code   | Name        | Category |
|--------|-------------|----------|
| fuel   | Fuel Only   | fuel     |
| tires  | Tires Only  | tires    |
| both   | Fuel + Tires| both     |
| repair | Repair      | repair   |

## ESP32 Penalty Timer Integration

The **Display** view includes a penalty timer panel that communicates with an ESP32 device over HTTP:

- **GET** `http://<ESP32_IP>/get` — reads the current timer value (ms)
- **GET** `http://<ESP32_IP>/set?min=X&sec=Y&tenths=Z` — arms the timer with the selected penalty

The default ESP32 IP is configured directly in `index.html`. Pitstop rows with a matching armed penalty show a lightning bolt icon.

## Export / Import

Use the **Export** button to download a timestamped JSON snapshot of the full race state (config + pitstops + current lap). Use **Import** to restore it — this updates all connected clients simultaneously.

## Raspberry Pi Deployment

The application is designed to run on a Raspberry Pi connected to the WRT race network.

### Network Access

| Connection | URL |
|------------|-----|
| Wi-Fi      | `http://192.168.47.26:3000` |
| Ethernet   | `http://192.168.47.27:3000` |

Open the URL on any device connected to the same network to join the shared session.

### First-Time Setup on Pi

```bash
git clone https://github.com/MaximePWRT/Pitstop-manager.git
cd pitstop-manager
npm install --omit=dev
```

Install PM2 for process management (autorun on boot):

```bash
sudo npm install -g pm2
pm2 start server.js --name pitstop-manager
pm2 save
pm2 startup
# Run the command printed by pm2 startup
```

### Update Deployment

```bash
cd ~/pitstop-manager
git pull origin main
npm install --omit=dev
pm2 restart pitstop-manager
```

### Verify

```bash
curl http://localhost:3000
```

### Troubleshooting: app does not start on boot

If the interface is not available after reboot, PM2 boot registration is usually missing or was saved under a different user.

```bash
# 1) Check whether PM2 has the process
pm2 list

# 2) If missing, start and save it
cd ~/pitstop-manager
pm2 start server.js --name pitstop-manager
pm2 save

# 3) Ensure PM2 is enabled at boot (run as the same user)
pm2 startup
# Run the command printed by PM2 (usually with sudo env ...)

# 4) Reboot and verify
sudo reboot
# then:
pm2 list
curl http://localhost:3000
```

### TV Fullscreen Auto-Launch on Raspberry Pi (Kiosk)

Starting the Node server is not enough if you want the TV to always show the interface.
You also need Chromium to auto-open in fullscreen on the Pi desktop session.

Create (or edit) this file:

```bash
nano ~/.config/lxsession/LXDE-pi/autostart
```

Add these lines:

```bash
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --start-fullscreen --noerrdialogs --disable-infobars --app=http://localhost:3000
```

Then reboot:

```bash
sudo reboot
```

Notes:
- Keep PM2 setup enabled so `server.js` starts at boot.
- `http://localhost:3000` is recommended on the Pi itself (same machine as Node server).
- If Chromium is already running in a normal window, close it first before testing kiosk autostart.

## Related Projects

- [Logistic-Timetable](https://github.com/MaximePWRT/Logistic-Timetable) — race event logistics timetable manager
