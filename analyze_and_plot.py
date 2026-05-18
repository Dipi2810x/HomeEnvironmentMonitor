import pandas as pd
import matplotlib.pyplot as plt
import re

def parse_data(file_path):
    data = []
    with open(file_path, 'r') as f:
        # Skip header
        next(f)
        for line in f:
            parts = line.strip().split(',', 1)
            if len(parts) < 2:
                continue
            ts, raw = parts
            # Extract PM 2.5: value
            pm25_match = re.search(r'PM 2.5:\s*(\d+)', raw)
            if pm25_match:
                data.append({'timestamp': ts, 'pm25': int(pm25_match.group(1))})
    return pd.DataFrame(data)

def main():
    df = parse_data('arduino_data.csv')
    if df.empty:
        print("No PM 2.5 data found.")
        return
    
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df.set_index('timestamp', inplace=True)
    
    # Resample to 1-minute averages to smooth for plotting
    df_resampled = df.resample('1min').mean()
    
    plt.figure(figsize=(10, 6))
    plt.plot(df_resampled.index, df_resampled['pm25'], label='PM 2.5')
    plt.title('PM 2.5 Concentration Over Time')
    plt.xlabel('Time')
    plt.ylabel('Concentration (ug/m3)')
    plt.grid(True)
    plt.legend()
    plt.savefig('pm25_plot.png')
    print("Plot saved as pm25_plot.png")

if __name__ == '__main__':
    main()
