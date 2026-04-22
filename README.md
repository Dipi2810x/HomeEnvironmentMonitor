# HomeEnvironmentMonitor


https://dipi2810x.github.io/HomeEnvironmentMonitor/

Run the local logger:

c:/Users/ramju/OneDrive/Documents/HomeEnvironmentMonitor/.venv/Scripts/python.exe reading_serial_data.py

The serial logger is hardcoded to COM3 at 115200 baud.

Daily CSV behavior:

- The logger appends throughout the day.
- At midnight, it automatically resets arduino_data.csv and starts a fresh file for the new day.
- Every 5 minutes, it stages, commits, and pushes arduino_data.csv to GitHub (if there are changes).

