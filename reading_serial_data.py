import argparse
import csv
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path

SERIAL_PORT = "COM3"
BAUD_RATE = 9600
GIT_SYNC_INTERVAL_SECONDS = 300

try:
    import serial
except ImportError:
    print("pyserial is not installed. Install it with: pip install pyserial")
    sys.exit(1)


def should_keep_line(line: str) -> bool:
    if not line:
        return False

    if "\ufffd" in line:
        return False

    # Keep only recognizable sensor/status lines to avoid startup serial noise.
    return (
        "PM" in line
        or "Particles" in line
        or "Concentration" in line
        or "-" in line
    )


def is_csv_for_today(csv_path: Path) -> bool:
    if not csv_path.exists() or csv_path.stat().st_size == 0:
        return False

    try:
        with csv_path.open("r", encoding="utf-8", newline="") as csv_file:
            reader = csv.reader(csv_file)
            next(reader, None)
            first_row = next(reader, None)
            if not first_row:
                return False
            ts = datetime.fromisoformat(first_row[0])
            return ts.date() == date.today()
    except Exception:
        return False


def open_writer(csv_path: Path, reset_file: bool):
    mode = "w" if reset_file else "a"
    file = csv_path.open(mode, newline="", encoding="utf-8")
    writer = csv.writer(file)
    if reset_file:
        writer.writerow(["timestamp", "raw"])
    return file, writer


def run_git(args: list[str], repo_path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=repo_path,
        check=False,
        capture_output=True,
        text=True,
    )


def sync_csv_to_git(repo_path: Path, csv_path: Path) -> None:
    inside_repo = run_git(["rev-parse", "--is-inside-work-tree"], repo_path)
    if inside_repo.returncode != 0:
        return

    try:
        csv_rel = str(csv_path.resolve().relative_to(repo_path.resolve()))
    except ValueError:
        csv_rel = str(csv_path)

    add_result = run_git(["add", "--", csv_rel], repo_path)
    if add_result.returncode != 0:
        if add_result.stderr:
            print(f"git add failed: {add_result.stderr.strip()}")
        return

    diff_result = run_git(["diff", "--cached", "--quiet", "--", csv_rel], repo_path)
    has_changes = diff_result.returncode == 1
    if not has_changes:
        return

    commit_message = f"data: update arduino_data.csv {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    commit_result = run_git(["commit", "-m", commit_message, "--", csv_rel], repo_path)
    if commit_result.returncode != 0:
        if commit_result.stderr:
            print(f"git commit failed: {commit_result.stderr.strip()}")
        return

    push_result = run_git(["push"], repo_path)
    if push_result.returncode == 0:
        print("Pushed arduino_data.csv to GitHub.")
        return

    print("git push failed; attempting pull --rebase and retry.")
    rebase_result = run_git(["pull", "--rebase"], repo_path)
    if rebase_result.returncode != 0:
        if rebase_result.stderr:
            print(f"git pull --rebase failed: {rebase_result.stderr.strip()}")
        return

    retry_push = run_git(["push"], repo_path)
    if retry_push.returncode != 0 and retry_push.stderr:
        print(f"retry git push failed: {retry_push.stderr.strip()}")
    elif retry_push.returncode == 0:
        print("Push succeeded after rebase.")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        # Some sensor streams include bytes that cannot be printed in cp1252 consoles.
        sys.stdout.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(description="Read Arduino serial data and write it to CSV.")
    parser.add_argument("--output", default="arduino_data.csv", help="Output CSV file path")
    args = parser.parse_args()
    csv_path = Path(args.output)
    repo_path = Path(__file__).resolve().parent

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    except serial.SerialException as exc:
        print(f"Could not open serial port {SERIAL_PORT}: {exc}")
        return 1

    print(f"Connected to {SERIAL_PORT} @ {BAUD_RATE} baud")
    time.sleep(2)

    active_day = date.today()
    reset_file = not is_csv_for_today(csv_path)

    if reset_file:
        print("Starting fresh CSV for today.")
    else:
        print("Appending to existing CSV for today.")

    file = None
    writer = None
    next_git_sync = time.time() + GIT_SYNC_INTERVAL_SECONDS

    try:
        file, writer = open_writer(csv_path, reset_file)

        while True:
            now = datetime.now()
            if now.date() != active_day:
                file.close()
                file, writer = open_writer(csv_path, True)
                active_day = now.date()
                print("New day detected. CSV reset for fresh daily capture.")

            line = ser.readline().decode("utf-8", errors="replace").strip()
            if should_keep_line(line):
                ts = now.isoformat(timespec="seconds")
                print(line)
                writer.writerow([ts, line])
                file.flush()

            if time.time() >= next_git_sync:
                sync_csv_to_git(repo_path, csv_path)
                next_git_sync = time.time() + GIT_SYNC_INTERVAL_SECONDS
    except KeyboardInterrupt:
        print("\nStopped by user.")
    finally:
        if file and not file.closed:
            file.close()
        ser.close()
        print("Serial port closed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
