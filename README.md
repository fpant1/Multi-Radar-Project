# Local Radar

A desk radar console that runs in your browser. It shows three live feeds:

- **Air Radar**: aircraft near you, using [OpenSky Network](https://opensky-network.org) data.
- **Weather Radar**: rain radar for your area, using [RainViewer](https://www.rainviewer.com/api.html).
- **Room Radar** (optional): a person or object moving in your room, using an RD-03D mmWave sensor on an Arduino.

All three can run on their own screens or side by side in a combined console. There's also a terminal-only aircraft feed.

The project runs on Windows, macOS and Linux. Running it on a Raspberry Pi is planned; see [docs/raspberry-pi-plan.md](docs/raspberry-pi-plan.md).

---

## Contents

- [What you need](#what-you-need)
- [Quick start](#quick-start)
- [OpenSky credentials (optional)](#opensky-credentials-optional)
- [Running it](#running-it)
- [Room radar hardware (optional)](#room-radar-hardware-optional)
- [Command-line options](#command-line-options)
- [Using the browser UI](#using-the-browser-ui)
- [API endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Roadmap](#roadmap)

---

## What you need

| Requirement | Notes |
| --- | --- |
| Python 3.11 or newer | `python --version` (or `py --version` on Windows) to check. |
| Git | To clone the repo. |
| Internet connection | Aircraft and weather data, and the map library, are loaded live. |
| Your latitude and longitude | In decimal degrees, for example `51.5072, -0.1276` for central London. Right-click a spot in Google Maps to copy them. |
| OpenSky account | Optional. Raises the rate limit; see below. |
| Arduino + RD-03D sensor | Optional. Only needed for Room Radar. |

---

## Quick start

### 1. Clone the repo

```bash
git clone https://github.com/fpant1/Local-Radar.git
cd Local-Radar
```

### 2. Create a virtual environment and install dependencies

**Windows (PowerShell)**

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If PowerShell refuses to run `Activate.ps1`, run this once and try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**macOS / Linux / Raspberry Pi**

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Create your `.env` file

```bash
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env`. You can leave the values blank for now.

### 4. Start the server

Replace the coordinates with your own:

```bash
python -m src.server --lat 51.5072 --lon -0.1276 --radius-km 50
```

### 5. Open the radar

- Air and Weather Radar: <http://127.0.0.1:8000>
- Combined console (air + weather + room): <http://127.0.0.1:8000/combined.html>

Stop the server with `Ctrl+C`.

---

## OpenSky credentials (optional)

Without credentials the app runs in **anonymous mode**. That works, but OpenSky's rate limits are much lower, so aircraft may update less often or briefly fail.

To use an account:

1. Create a free account at <https://opensky-network.org>.
2. In your account settings, create an **API client**. You'll get a client ID and a client secret.
3. Put them in `.env`:

   ```text
   OPENSKY_CLIENT_ID=your_client_id
   OPENSKY_CLIENT_SECRET=your_client_secret
   ```

`.env` is ignored by Git, so your credentials stay on your machine. Only `.env.example` is committed.

RainViewer weather data doesn't need a key.

---

## Running it

Activate the virtual environment first (`.\.venv\Scripts\Activate.ps1` on Windows, `source .venv/bin/activate` elsewhere).

### Browser UI

```bash
python -m src.server --lat <your-lat> --lon <your-lon> --radius-km 50 --interval 30
```

The server polls OpenSky every `--interval` seconds (minimum 10) and caches the result. The browser asks the local server for updates every 5 seconds, so opening several tabs doesn't use more OpenSky quota.

To open the UI from another device on your network (a phone or tablet, for example), bind to all interfaces:

```bash
python -m src.server --lat <your-lat> --lon <your-lon> --host 0.0.0.0
```

Then browse to `http://<this-computer's-IP>:8000`. The app has no login, so only do this on a network you trust.

### Browser UI with Room Radar

Plug in the Arduino (see [Room radar hardware](#room-radar-hardware-optional)) and pass its serial port:

```bash
# Windows
python -m src.server --lat <your-lat> --lon <your-lon> --room-port COM5

# macOS / Linux / Raspberry Pi
python -m src.server --lat <your-lat> --lon <your-lon> --room-port /dev/ttyACM0
```

Then open <http://127.0.0.1:8000/combined.html>. Without `--room-port`, the combined console still shows aircraft and weather, and the room panel says serial is disabled.

### Terminal aircraft feed

A text-only table of nearby aircraft, with no browser needed:

```bash
python -m src.main --lat <your-lat> --lon <your-lon> --radius-km 50 --interval 30
```

Add `--once` to fetch a single snapshot and exit, which is a quick way to check your setup and credentials.

---

## Room radar hardware (optional)

Room Radar reads target data from an **Ai-Thinker RD-03D** 24 GHz mmWave sensor, through an Arduino connected to the computer by USB.

The firmware lives in a separate repo: [fpant1/Radar-Project](https://github.com/fpant1/Radar-Project). It's a PlatformIO project for an **Arduino Mega 2560**.

### Wiring (Arduino Mega)

| RD-03D | Arduino Mega |
| --- | --- |
| 5V | 5V |
| GND | GND |
| TX | RX1 (pin 19) |
| RX | TX1 (pin 18) |

The RD-03D's serial pins use 3.3 V logic, and the Mega's use 5 V. The firmware only reads from the sensor, so the sensor RX ↔ TX1 wire is optional. If you do connect it, put a level shifter or voltage divider in that line.

The sensor talks to the Mega at 256000 baud. The Mega talks to the computer over USB at **115200** baud, which is the `--room-baud` default.

### Flashing the firmware

1. Install [VS Code](https://code.visualstudio.com/) and the [PlatformIO extension](https://platformio.org/install/ide?install=vscode).
2. Clone and open [fpant1/Radar-Project](https://github.com/fpant1/Radar-Project).
3. Connect the Mega and click **Upload** in PlatformIO.
4. Open the PlatformIO serial monitor at 115200 to check that readings are coming through. Close the monitor before starting Local Radar, because only one program can use the port at a time.

### Finding the serial port

- **Windows**: Device Manager → Ports (COM & LPT), for example `COM5`.
- **macOS**: `ls /dev/tty.usbmodem*`
- **Linux / Pi**: `ls /dev/ttyACM* /dev/ttyUSB*`, usually `/dev/ttyACM0`. If you get a permission error, add yourself to the `dialout` group with `sudo usermod -aG dialout $USER`, then log out and back in.

### Serial formats Local Radar accepts

The current firmware prints labelled debug blocks, which Local Radar parses directly:

```text
X (mm): -320
Y (mm): 1850
Distance (mm): 1877.47
Angle (degrees): 9.81
Speed (cm/s): -16.00
-------------------------
```

Local Radar also accepts one target per line in either of these more compact formats, in case you change the firmware:

```text
angle_deg,distance_mm,speed_cm_s[,x_mm,y_mm]
```

```json
{"angle_deg":12.4,"distance_mm":1850,"speed_cm_s":-8.2,"x_mm":390,"y_mm":1810}
```

A target is shown as **stale** if no reading has arrived for 3 seconds. If the port disconnects, the server keeps retrying every 2 seconds.

---

## Command-line options

### `python -m src.server`

| Option | Default | Description |
| --- | --- | --- |
| `--lat` | required | Home latitude, `-90` to `90`. |
| `--lon` | required | Home longitude, `-180` to `180`. |
| `--radius-km` | `50` | Radar range in km. The radar circle always represents this distance. |
| `--interval` | `30` | OpenSky polling interval in seconds. Minimum `10`. |
| `--host` | `127.0.0.1` | Address to bind. Use `0.0.0.0` to allow other devices on your network. |
| `--port` | `8000` | Port to serve on. |
| `--room-port` | none | Arduino serial port, for example `COM5` or `/dev/ttyACM0`. Room Radar is off without it. |
| `--room-baud` | `115200` | Arduino serial baud rate. |
| `--room-range-mm` | `8000` | Room radar display range in millimetres. |

### `python -m src.main`

| Option | Default | Description |
| --- | --- | --- |
| `--lat`, `--lon` | required | As above. |
| `--radius-km` | `50` | Search radius in km. |
| `--radius-nm` | none | Older alternative to `--radius-km`, in nautical miles. |
| `--interval` | `30` | Polling interval in seconds. Minimum `10`. |
| `--once` | off | Fetch one snapshot and exit. |

---

## Using the browser UI

### Pages

| URL | What it shows |
| --- | --- |
| `/` | Air Radar, with Weather Radar one keypress away. |
| `/combined.html` | Air, weather and room radar together. |
| `/weather-options.html` | Side-by-side weather map zoom levels, for picking a scale. |

### Keyboard shortcuts (main page)

| Key | Action |
| --- | --- |
| `M` | Switch between Air Radar and Weather Radar. |
| `T` | Toggle the CRT-green and modern colour themes. |
| `L` | Toggle the label on the highlighted aircraft. |
| `R` | Reset the view. |

### How aircraft are chosen

On a busy sky (London, for example) the display would be unreadable if every aircraft were drawn, so the server filters and ranks them first:

- It keeps at most 40 contacts, preferring airborne aircraft and sorting nearest first.
- The radar draws up to 30, labels up to 10, and cycles the highlight through the nearest 5.
- Aircraft on the ground are marked clearly when they're included.
- The counter reads like `30 / 84`, meaning 30 shown out of 84 that OpenSky reported in range.

### Weather

The server fetches RainViewer's latest radar frame list about once a minute and centres the image on your home location. If RainViewer is unavailable, the last good frame is kept and flagged as stale.

---

## API endpoints

The browser UI uses these, and you can use them too, for example to feed another display:

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | Server status and the state of each feed. |
| `GET /api/aircraft/latest` | Filtered aircraft list with distance, bearing, altitude and speed. |
| `GET /api/weather/rainviewer/latest` | Latest RainViewer frame and image URL for your location. |
| `GET /api/room-radar/latest` | Latest room radar target: angle, distance, speed and x/y. |
| `GET /api/combined/latest` | All three of the above in one response. |

FastAPI also serves interactive API docs at <http://127.0.0.1:8000/docs>.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `python` not found on Windows | Use `py` instead, or reinstall Python with **Add python.exe to PATH** ticked. |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then activate again. |
| `ModuleNotFoundError` | The virtual environment isn't active, or you skipped `pip install -r requirements.txt`. |
| Warning about anonymous mode | Expected without credentials. Add them to `.env` for higher limits. |
| OpenSky rate limit errors | Increase `--interval`, or add credentials. |
| No aircraft shown | Check your coordinates (latitude first) and try a bigger `--radius-km`. Quiet areas at night can genuinely be empty. |
| Map or weather tiles blank | The browser needs internet access to load the map library and RainViewer images. |
| Room panel says `disabled` | Start the server with `--room-port`. |
| Room panel shows a serial error | Wrong port, or another program (such as a serial monitor) has the port open. On Linux, check `dialout` group membership. |
| Room panel says `stale` | The Arduino is connected but not sending readings. Check the sensor wiring and that the firmware is flashed. |
| Port 8000 already in use | Pass `--port 8080` (or any free port). |

---

## Project layout

```text
Local-Radar/
├── src/
│   ├── server.py              # FastAPI app and browser server entry point
│   ├── main.py                # Terminal aircraft feed entry point
│   ├── config.py              # Defaults and .env loading
│   ├── aircraft_service.py    # Background OpenSky polling, filtering, caching
│   ├── opensky_client.py      # OpenSky REST client with OAuth2 token handling
│   ├── weather_service.py     # RainViewer frame selection and caching
│   ├── rainviewer_client.py   # RainViewer metadata client
│   ├── room_radar_service.py  # Arduino serial reader and parser
│   ├── geo.py                 # Distance, bearing and bounding-box maths
│   └── models.py              # Data models
├── web/                       # Static browser UI (HTML, CSS, JS)
├── docs/
│   └── raspberry-pi-plan.md   # Next stage: hosting on a Raspberry Pi
├── .env.example               # Template for your .env
└── requirements.txt
```

---

## Roadmap

The next stage is running Local Radar full-time on a Raspberry Pi with the room sensor attached, and reaching it securely from outside your home network. The plan is in [docs/raspberry-pi-plan.md](docs/raspberry-pi-plan.md).

---

## License

[MIT](LICENSE)
