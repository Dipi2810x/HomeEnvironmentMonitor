#include "SoftwareSerial.h"
#include "PMS.h"
 
SoftwareSerial Serial1(2, 3); // RX, TX
 
PMS pms(Serial1);
PMS::DATA data;
 
void setup()
{
  Serial.begin(9600);
  Serial1.begin(9600);
  delay(4000);
}
 
void loop()
{
  if (pms.read(data))
  {
    String pm1 = String(data.PM_AE_UG_1_0);
    String pm25 = String(data.PM_AE_UG_2_5);
    String pm10 = String(data.PM_AE_UG_10_0);

    // JSON line for website parsing via Web Serial.
    Serial.println("{\"pm1_0\":" + pm1 + ",\"pm2_5\":" + pm25 + ",\"pm10\":" + pm10 + "}");

    // Human-readable output for Arduino Serial Monitor.
    Serial.println("PM1.0: " + pm1 + " (ug/m3)");
    Serial.println("PM2.5: " + pm25 + " (ug/m3)");
    Serial.println("PM10: " + pm10 + " (ug/m3)");
    Serial.println("--------------------------------------------");
    delay(1000);
  }
}