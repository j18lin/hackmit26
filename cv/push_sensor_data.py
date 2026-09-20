"""Push simulated timestep sensor readings to the Nudge robot API.

Each tick sends one snapshot of the four boolean labels (doomscrolling,
slouching, sleeping, drinkingWater) plus a TMP117 raw temperature reading
to POST /api/robot/sensors. The server stamps its own timestamp on receipt.

Usage:
    python push_sensor_data.py                # random labels every 3s, forever
    python push_sensor_data.py --interval 1    # every 1s
    python push_sensor_data.py --count 20      # stop after 20 pushes
    python push_sensor_data.py --scenario slouching  # force one label true
"""

import argparse
import os
import random
import sys
import time
from pathlib import Path

import requests

FIELDS = ["doomscrolling", "slouching", "sleeping", "drinkingWater"]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def random_reading(scenario: str | None) -> dict:
    reading = {field: False for field in FIELDS}
    if scenario and scenario != "random":
        reading[scenario] = True
    else:
        active = random.choice(FIELDS + [None, None])  # bias toward all-false
        if active:
            reading[active] = True
    reading["tempRaw"] = random.randint(2500, 2900)  # ~19.5-22.6 C
    return reading


def push(api_base: str, robot_key: str, reading: dict) -> None:
    resp = requests.post(
        f"{api_base}/api/robot/sensors",
        headers={"Authorization": f"Bearer {robot_key}"},
        json=reading,
        timeout=10,
    )
    resp.raise_for_status()
    print(f"[{time.strftime('%H:%M:%S')}] pushed {reading} -> {resp.json()}")


def main() -> int:
    load_env(Path(__file__).resolve().parent / ".env")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=float, default=3.0, help="seconds between pushes")
    parser.add_argument("--count", type=int, default=0, help="number of pushes (0 = forever)")
    parser.add_argument(
        "--scenario",
        choices=["random", *FIELDS],
        default="random",
        help="force a specific label true instead of random",
    )
    parser.add_argument("--api-base", default=os.environ.get("API_BASE", "http://localhost:3001"))
    args = parser.parse_args()

    robot_key = os.environ.get("ROBOT_KEY")
    if not robot_key:
        print(
            "ROBOT_KEY is not set. Generate one from the dashboard "
            "(Devices & robot -> Generate robot key) and put it in .env "
            "as ROBOT_KEY=<key>.",
            file=sys.stderr,
        )
        return 1

    sent = 0
    try:
        while args.count == 0 or sent < args.count:
            reading = random_reading(args.scenario)
            try:
                push(args.api_base, robot_key, reading)
            except requests.RequestException as error:
                print(f"push failed: {error}", file=sys.stderr)
            sent += 1
            if args.count == 0 or sent < args.count:
                time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
