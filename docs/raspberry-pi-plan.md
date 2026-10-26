# Next stage: hosting Local Radar on a Raspberry Pi

**Goal:** Local Radar runs around the clock on a Raspberry Pi, with the room sensor plugged into the Pi. You can open it on the home network and, securely, from anywhere else. Optionally, the Pi also drives its own screen as a desk console.

**Where it is today:** It runs by hand on a laptop. You type the settings into the command line every time. It only listens on `127.0.0.1`, and it has no login.

---

## Target setup

```text
                      Internet
                         │
            ┌────────────┴─────────────┐
            │ Tailscale (private) or   │  ← secure remote access,
            │ Cloudflare Tunnel+Access │    no router ports opened
            └────────────┬─────────────┘
                         │
┌────────────────────────┴───────────────────────────┐
│ Raspberry Pi (Raspberry Pi OS Lite 64-bit)         │
│                                                    │
│  systemd: local-radar.service                      │
│    └─ uvicorn / FastAPI (src.server) :8000         │
│         ├─ OpenSky poller ──────► opensky-network  │
│         ├─ RainViewer cache ────► rainviewer.com   │
│         └─ serial reader ◄── /dev/serial/by-id/... │
│                                    │ USB            │
│  (optional) Chromium kiosk on HDMI/DSI display     │
└────────────────────────────────────┼───────────────┘
                                     │
                          Arduino Mega + RD-03D
```

---

## Decisions to make first

| Decision | Recommendation | Why |
| --- | --- | --- |
| Pi model | **Pi 4 (2 GB+) or Pi 5.** A Pi Zero 2 W is enough if there's no attached display. | The server is light. Running Chromium for a kiosk screen is the heavy part. |
| OS | **Raspberry Pi OS Lite (64-bit, Bookworm or newer)**, or the Desktop edition for a kiosk. | Ships with Python 3.11+, which the project requires. |
| Remote access | **Tailscale** for just you, **Cloudflare Tunnel + Access** for a shareable link. Avoid router port forwarding. | The app has no login. Both options keep it off the open internet and need no open ports. |
| Sensor connection | **Keep the Arduino Mega on USB** for now. | It already works, needs no new code, and keeps the sensor's timing off the Pi. Wiring the RD-03D straight to the Pi's UART is a later option (Phase 7). |
| Storage | A good A1/A2-rated SD card, or a USB SSD on a Pi 4/5. | It runs constantly, and logs wear out cheap cards. |

---

## Phase 1: Make the app deployable (code changes, done on the laptop)

At the moment every setting is a command-line flag. A service is easier to manage when its settings live in `.env`.

- [ ] **Read server settings from the environment.** Add `LOCAL_RADAR_LAT`, `LOCAL_RADAR_LON`, `LOCAL_RADAR_RADIUS_KM`, `LOCAL_RADAR_INTERVAL`, `LOCAL_RADAR_HOST`, `LOCAL_RADAR_PORT`, `LOCAL_RADAR_ROOM_PORT`, `LOCAL_RADAR_ROOM_BAUD` and `LOCAL_RADAR_ROOM_RANGE_MM`. Use them as defaults in `src/server.py`'s argument parser, so command-line flags still override them. This means `--lat`/`--lon` are no longer strictly required when the environment variables are set.
- [ ] Add the new variables, commented, to `.env.example`.
- [ ] **Bundle Leaflet in the repo** (`web/vendor/leaflet/`) instead of loading it from unpkg. The UI then still draws if the CDN is slow or blocked, and the page has one less outside dependency.
- [ ] **Add a `/api/health` check that reflects real failures**, for example `status: degraded` when OpenSky has failed for several polls in a row, so monitoring can alert on it.
- [ ] **Pin dependency versions** (`pip freeze > requirements.lock`, or exact pins), so the Pi installs the same versions you tested.
- [ ] Add basic **logging to stdout** (the `logging` module, not `print`), so systemd's journal captures it with timestamps.
- [ ] Optional: a small `scripts/run.sh` that activates the virtual environment and runs `python -m src.server`, for people starting it by hand.

**Done when:** `python -m src.server` with no arguments starts correctly from a filled-in `.env`, and the UI works with the laptop offline from unpkg.

---

## Phase 2: Prepare the Pi

- [ ] Flash **Raspberry Pi OS Lite 64-bit** with Raspberry Pi Imager. In the Imager's settings, set the hostname (for example `local-radar`), your user, Wi-Fi and **SSH with key authentication**.
- [ ] Boot the Pi and SSH in: `ssh <user>@local-radar.local`.
- [ ] Update and install the basics:

  ```bash
  sudo apt update && sudo apt full-upgrade -y
  sudo apt install -y git python3-venv python3-pip
  ```

- [ ] Give your user serial access: `sudo usermod -aG dialout $USER`, then log out and back in.
- [ ] Set the timezone (`sudo raspi-config` → Localisation), so logs read sensibly.
- [ ] Reserve a fixed IP for the Pi in your router's DHCP settings, so it's always at the same address on your LAN.

**Done when:** you can SSH in by hostname, and `python3 --version` shows 3.11 or newer.

---

## Phase 3: Install Local Radar on the Pi

- [ ] Create a dedicated, unprivileged user to run the service:

  ```bash
  sudo useradd --system --create-home --home-dir /opt/local-radar --groups dialout local-radar
  sudo -u local-radar git clone https://github.com/fpant1/Multi-Radar-Project.git /opt/local-radar/app
  cd /opt/local-radar/app
  sudo -u local-radar python3 -m venv .venv
  sudo -u local-radar .venv/bin/pip install -r requirements.txt
  sudo -u local-radar cp .env.example .env
  sudo -u local-radar chmod 600 .env
  ```

- [ ] Fill in `.env`: OpenSky credentials, your location, and the room port.
- [ ] Plug in the Arduino and find its **stable** device path. `/dev/ttyACM0` can change between reboots; the by-id path doesn't:

  ```bash
  ls -l /dev/serial/by-id/
  # e.g. /dev/serial/by-id/usb-Arduino__www.arduino.cc__0042_XXXXXXXX-if00
  ```

  Use that path for `LOCAL_RADAR_ROOM_PORT`.
- [ ] Test it by hand: `sudo -u local-radar .venv/bin/python -m src.server`, then open `http://<pi-ip>:8000/combined.html` from the laptop. Bind to `0.0.0.0` for this test.

**Done when:** all three feeds show live data from the Pi in a browser on another device.

---

## Phase 4: Run it as a service

- [ ] Create `/etc/systemd/system/local-radar.service`:

  ```ini
  [Unit]
  Description=Local Radar
  After=network-online.target
  Wants=network-online.target

  [Service]
  User=local-radar
  Group=local-radar
  WorkingDirectory=/opt/local-radar/app
  EnvironmentFile=/opt/local-radar/app/.env
  ExecStart=/opt/local-radar/app/.venv/bin/python -m src.server
  Restart=on-failure
  RestartSec=5

  # Hardening
  NoNewPrivileges=true
  ProtectSystem=strict
  ProtectHome=true
  PrivateTmp=true
  ReadWritePaths=/opt/local-radar

  [Install]
  WantedBy=multi-user.target
  ```

  Commit a copy as `deploy/local-radar.service` in the repo.
- [ ] Enable and start it:

  ```bash
  sudo systemctl daemon-reload
  sudo systemctl enable --now local-radar
  systemctl status local-radar
  journalctl -u local-radar -f
  ```

- [ ] Cap the journal's size so logs can't fill the SD card: set `SystemMaxUse=100M` in `/etc/systemd/journald.conf`.
- [ ] Reboot the Pi and confirm the service comes back by itself.
- [ ] Unplug and replug the Arduino, and confirm the room feed recovers. The service already retries the port every 2 seconds.

**Done when:** after a cold reboot, the radar is reachable on the LAN without logging in to the Pi.

---

## Phase 5: Reach it from outside the house

**Don't** forward port 8000 on your router. The app has no authentication, and an open port would expose it, and the Pi, to the whole internet.

### Option A: Tailscale (recommended for personal use)

A private network between your own devices. Nothing is exposed publicly.

- [ ] `curl -fsSL https://tailscale.com/install.sh | sh` and then `sudo tailscale up`.
- [ ] Install Tailscale on your phone and laptop and sign in to the same account.
- [ ] Open `http://local-radar:8000` (the MagicDNS name) from anywhere.
- [ ] Optional: `sudo tailscale serve --bg 8000` gives you an HTTPS URL on your tailnet. You can then bind the app back to `127.0.0.1` so it's never reachable directly on the LAN.

### Option B: Cloudflare Tunnel + Cloudflare Access (for a shareable link)

A public hostname such as `radar.yourdomain.com`, protected by a login page. Requires a domain on Cloudflare.

- [ ] Install `cloudflared` on the Pi and create a tunnel that points `radar.yourdomain.com` at `http://localhost:8000`.
- [ ] In Cloudflare Zero Trust, add an **Access application** for that hostname. Use an email one-time-PIN policy that allows only the addresses you choose.
- [ ] Run the tunnel as a service: `sudo cloudflared service install <token>`.
- [ ] Bind the app to `127.0.0.1`, so the tunnel is the only way in.

### Either option

- [ ] Check from mobile data, with Wi-Fi off, that it works remotely and that the login (if any) is enforced.
- [ ] Keep OpenSky credentials **server-side only**. They already never reach the browser; keep it that way.

**Done when:** you can open the radar from your phone on mobile data, and someone without access can't.

---

## Phase 6: Desk console display (optional)

To turn the Pi into a dedicated radar screen:

- [ ] Use Raspberry Pi OS **Desktop** (or add a minimal X/Wayland and Chromium to Lite).
- [ ] Turn on auto-login to the desktop with `raspi-config`.
- [ ] Autostart Chromium in kiosk mode pointing at the local server:

  ```bash
  chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito http://127.0.0.1:8000/combined.html
  ```

- [ ] Disable screen blanking (`raspi-config` → Display → Screen Blanking: off).
- [ ] Tune the combined layout for the actual screen, for example a 7" 800×480 DSI display or a small HDMI panel. This may need CSS changes in `web/combined.css`.

**Done when:** powering on the Pi goes straight to the full-screen radar with no keyboard.

---

## Phase 7: Later improvements

| Idea | Value |
| --- | --- |
| Have the firmware print **JSON lines** instead of debug text. | More robust parsing, and multiple targets become possible. Local Radar already accepts JSON. |
| Report **all three RD-03D targets** instead of only the first. | The sensor tracks up to 3 people; currently only target 1 is read. |
| **Wire the RD-03D to the Pi's GPIO UART** and drop the Mega. | One less board. Needs the Pi's serial console disabled, 3.3 V logic (which the sensor uses natively), and the frame parser ported to Python. |
| **Update script / GitHub Action** that SSHes in, runs `git pull`, `pip install` and restarts the service. | One-step deploys. |
| **Uptime monitoring** (Uptime Kuma, or a free external pinger through the tunnel) on `/api/health`. | Know when the radar or a feed is down. |
| **Built-in auth** (an HTTP basic-auth or token middleware). | Defence in depth if the app is ever exposed beyond Tailscale or Access. |
| **Docker image** for x86 and ARM. | An alternative install path for people who don't want a virtual environment. |
| Read-only root filesystem / overlayFS. | Survives power cuts without SD card corruption. |

---

## Running it day to day

| Task | Command |
| --- | --- |
| View live logs | `journalctl -u local-radar -f` |
| Restart | `sudo systemctl restart local-radar` |
| Update to latest code | `cd /opt/local-radar/app && sudo -u local-radar git pull && sudo -u local-radar .venv/bin/pip install -r requirements.txt && sudo systemctl restart local-radar` |
| Check health | `curl http://127.0.0.1:8000/api/health` |
| Update the OS | `sudo apt update && sudo apt full-upgrade -y`, about monthly |
| Change location or ports | Edit `/opt/local-radar/app/.env`, then restart. |

---

## Suggested order

1. Phase 1 (code changes). This is the only phase that needs code, and it unblocks everything else.
2. Phases 2–4 together on a free afternoon, which gets the radar running on the LAN.
3. Phase 5 Option A (Tailscale), which takes about 15 minutes.
4. Phase 6, if you want a dedicated screen.
5. Pick items from Phase 7 as needed.
