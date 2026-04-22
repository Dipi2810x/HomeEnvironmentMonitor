import argparse
import csv
import sys
import time
from datetime import datetime

SERIAL_PORT = "COM3"
BAUD_RATE = 115200

try:
    import serial
except ImportError:
    print("pyserial is not installed. Install it with: pip install pyserial")
    sys.exit(1)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        # Some sensor streams include bytes that cannot be printed in cp1252 consoles.
        sys.stdout.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(description="Read Arduino serial data and write it to CSV.")
    parser.add_argument("--output", default="arduino_data.csv", help="Output CSV file path")
    args = parser.parse_args()

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    except serial.SerialException as exc:
        print(f"Could not open serial port {SERIAL_PORT}: {exc}")
        return 1

    print(f"Connected to {SERIAL_PORT} @ {BAUD_RATE} baud")
    time.sleep(2)

    try:
        with open(args.output, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["timestamp", "raw"])

            while True:
                line = ser.readline().decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                ts = datetime.now().isoformat(timespec="seconds")
                print(line)
                writer.writerow([ts, line])
                file.flush()
    except KeyboardInterrupt:
        print("\nStopped by user.")
    finally:
        ser.close()
        print("Serial port closed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
