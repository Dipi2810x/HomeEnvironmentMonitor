# HomeEnvironmentMonitor

<<<<<<< Updated upstream
https://dipi2810x.github.io/HomeEnvironmentMonitor/
=======
This project is a browser-based dashboard that reads real PM sensor data over Web Serial from a connected Arduino.

Open the page in Chrome or Edge on desktop, connect the board, and click Connect Arduino to start streaming live readings.

## Auto-push arduino_data.csv every 5 minutes (local)

1. Start this script in PowerShell from the repo root:

powershell -ExecutionPolicy Bypass -File .\auto_push_csv.ps1

2. Test one cycle without committing:

powershell -ExecutionPolicy Bypass -File .\auto_push_csv.ps1 -RunOnce -DryRun

3. Optional: run with a different interval (seconds):

powershell -ExecutionPolicy Bypass -File .\auto_push_csv.ps1 -IntervalSeconds 300

The script only stages, commits, and pushes arduino_data.csv.

## Optional: Task Scheduler setup

Create a task that runs every 5 minutes:

schtasks /Create /TN "HomeEnvAutoPushCsv" /SC MINUTE /MO 5 /TR "powershell -ExecutionPolicy Bypass -File \"C:\Users\ramju\OneDrive\Documents\HomeEnvironmentMonitor\auto_push_csv.ps1\" -RunOnce" /F

This task runs one cycle each trigger and exits. Task Scheduler invokes it every 5 minutes.

## One command: start serial logger + auto-push together

Run both the serial logger and CSV auto-push loop together:

powershell -ExecutionPolicy Bypass -File .\start_data_pipeline.ps1

The serial logger is hardcoded to COM3 at 115200 baud.

Optional arguments:

-CsvPath arduino_data.csv -PushIntervalSeconds 300

Press Ctrl+C to stop both background jobs.

>>>>>>> Stashed changes
