"""
test_pi_client.py — Mock Raspberry Pi Client for UGV Dashboard
================================================================
Simulates a UGV sending telemetry data and receiving commands
from the deployed WebSocket server.

Usage:
    pip install websockets
    python test_pi_client.py
"""

import asyncio
import json
import random
import time

try:
    import websockets
except ImportError:
    print("❌  'websockets' package not found. Install it with:")
    print("    pip install websockets")
    exit(1)

# ══════════════════════════════════════════════════════════════════
# CONFIGURATION — Update this URL to your Coolify deployment
# ══════════════════════════════════════════════════════════════════
WS_URI         = "ws://rs44owcoo04408gk80goks8g.76.13.143.124.sslip.io"
AUTH_USERNAME   = "admin"
AUTH_PASSWORD   = "123456"
SEND_INTERVAL   = 1  # seconds

# ── Persistent telemetry state (drifts over time) ─────────────────
state = {
    "battery_percent":    85.0,
    "battery_voltage":    12.4,
    "speed":              0.0,
    "heading":            0.0,
    "lat":                30.021420,
    "lng":                31.225810,
    "components_temp":    38.0,
    "left_motor_current": 0.0,
    "right_motor_current":0.0,
    "rpi_current":        0.8,
}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def generate_telemetry() -> dict:
    """Generate a realistic telemetry reading with natural drift."""
    s = state

    # Battery slowly drains
    s["battery_percent"] = clamp(s["battery_percent"] + random.uniform(-0.3, 0.05), 0, 100)
    s["battery_voltage"] = clamp(9.0 + (s["battery_percent"] / 100) * 3.6, 9.0, 12.6)

    # Speed fluctuates 0 – 3 m/s
    s["speed"] = clamp(s["speed"] + random.uniform(-0.3, 0.3), 0, 3)

    # Heading drifts
    s["heading"] = (s["heading"] + random.uniform(-2.5, 2.5)) % 360

    # GPS drifts very slightly
    s["lat"] += random.uniform(-0.00002, 0.00002)
    s["lng"] += random.uniform(-0.00002, 0.00002)

    # Temperature
    s["components_temp"] = clamp(s["components_temp"] + random.uniform(-0.5, 0.5), 25, 75)

    # Motor currents proportional to speed
    s["left_motor_current"]  = clamp(s["speed"] * 1.2 + random.uniform(-0.3, 0.3), 0, 5)
    s["right_motor_current"] = clamp(s["speed"] * 1.2 + random.uniform(-0.3, 0.3), 0, 5)

    # RPi current fairly stable
    s["rpi_current"] = clamp(s["rpi_current"] + random.uniform(-0.05, 0.05), 0.4, 1.5)

    # Simulated network latency
    latency = clamp(15 + random.random() * 40, 10, 120)

    return {
        "type": "telemetry",
        "data": {
            "batteryPercent":    round(s["battery_percent"], 1),
            "batteryVoltage":    round(s["battery_voltage"], 2),
            "speed":             round(s["speed"], 2),
            "heading":           round(s["heading"], 1),
            "gps": {
                "lat":           round(s["lat"], 6),
                "lng":           round(s["lng"], 6),
            },
            "componentsTemp":    round(s["components_temp"], 1),
            "leftMotorCurrent":  round(s["left_motor_current"], 2),
            "rightMotorCurrent": round(s["right_motor_current"], 2),
            "rpiCurrent":        round(s["rpi_current"], 2),
            "latency":           round(latency),
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


# ══════════════════════════════════════════════════════════════════
# TASK A — Receiver: listen for incoming commands
# ══════════════════════════════════════════════════════════════════
async def receiver(websocket):
    """Continuously listen for server messages and print them."""
    try:
        async for raw in websocket:
            msg = json.loads(raw)
            msg_type = msg.get("type", "unknown")

            if msg_type == "auth_ok":
                print(f"🔑  AUTH OK: {msg.get('message')}")
            elif msg_type == "auth_fail":
                print(f"🚫  AUTH FAIL: {msg.get('message')}")
            elif msg_type == "manual_cmd":
                direction = msg.get("data", {}).get("direction", "?")
                print(f"🎮  COMMAND RECEIVED: {direction}")
            elif msg_type == "set_waypoint":
                print(f"📍  WAYPOINT RECEIVED: {json.dumps(msg.get('data'), indent=2)}")
            elif msg_type == "cmd_ack":
                print(f"✅  ACK: {msg.get('message')}")
            elif msg_type == "waypoint_ack":
                print(f"✅  WAYPOINT ACK: {msg.get('message')}")
            elif msg_type == "session_kicked":
                print(f"⚠️  KICKED: {msg.get('message')}")
                break
            elif msg_type == "telemetry":
                # Server also sends telemetry from its simulator; just note it
                d = msg.get("data", {})
                print(f"📡  SERVER TELEMETRY: Batt={d.get('batteryPercent')}% | Speed={d.get('speed')} m/s | GPS=({d.get('gps',{}).get('lat')}, {d.get('gps',{}).get('lng')})")
            else:
                print(f"📨  MSG [{msg_type}]: {json.dumps(msg)}")
    except websockets.ConnectionClosed:
        print("🔌  Connection closed by server.")


# ══════════════════════════════════════════════════════════════════
# TASK B — Sender: push telemetry every 1 second
# ══════════════════════════════════════════════════════════════════
async def sender(websocket):
    """Send dummy telemetry data at regular intervals."""
    tick = 0
    try:
        while True:
            telemetry = generate_telemetry()
            await websocket.send(json.dumps(telemetry))
            tick += 1
            d = telemetry["data"]
            print(
                f"📤  TX [{tick:>4}] "
                f"Batt={d['batteryPercent']:5.1f}% | "
                f"Speed={d['speed']:4.2f} m/s | "
                f"Heading={d['heading']:5.1f}° | "
                f"GPS=({d['gps']['lat']:.6f}, {d['gps']['lng']:.6f}) | "
                f"Temp={d['componentsTemp']:.1f}°C | "
                f"Motors=({d['leftMotorCurrent']:.2f}A, {d['rightMotorCurrent']:.2f}A)"
            )
            await asyncio.sleep(SEND_INTERVAL)
    except websockets.ConnectionClosed:
        print("🔌  Connection closed — sender stopped.")


# ══════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════
async def main():
    print("=" * 60)
    print("  🤖  UGV Mock Raspberry Pi Client")
    print(f"  📡  Connecting to: {WS_URI}")
    print("=" * 60)

    try:
        async with websockets.connect(WS_URI) as websocket:
            print("🔌  WebSocket connected!")

            # Send authentication
            auth_payload = {
                "type": "auth",
                "data": {
                    "username": AUTH_USERNAME,
                    "password": AUTH_PASSWORD,
                },
            }
            await websocket.send(json.dumps(auth_payload))
            print(f"🔑  Auth sent (user: {AUTH_USERNAME})")

            # Wait for auth response before starting tasks
            raw = await websocket.recv()
            auth_response = json.loads(raw)
            if auth_response.get("type") == "auth_ok":
                print(f"✅  Authenticated: {auth_response.get('message')}")
            else:
                print(f"❌  Auth failed: {auth_response}")
                return

            print("-" * 60)
            print("  Starting concurrent Receiver + Sender tasks...")
            print("  Press Ctrl+C to stop.")
            print("-" * 60)

            # Run receiver and sender concurrently
            await asyncio.gather(
                receiver(websocket),
                sender(websocket),
            )

    except ConnectionRefusedError:
        print("❌  Connection refused. Is the server running?")
    except websockets.exceptions.InvalidURI:
        print("❌  Invalid WebSocket URI. Update WS_URI in the script.")
    except KeyboardInterrupt:
        print("\n🛑  Client stopped by user.")
    except Exception as e:
        print(f"❌  Error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
