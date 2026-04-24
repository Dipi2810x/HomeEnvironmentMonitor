#include <SoftwareSerial.h>

// RX pin: 2, TX pin: 3
SoftwareSerial pms(2, 3);

/* Struct containing all the sensor outputs */
struct pms5003 {
  uint16_t framelen;
  uint16_t pm10, pm25, pm100;
  uint16_t pm10_env, pm25_env, pm100_env;
  uint16_t p_03um, p_05um, p_10um, p_25um, p_50um, p_100um;
  uint16_t unused;
  uint16_t checksum;
};
struct pms5003 data;

/* Reading in the data from the pms serial */
boolean readPMS(Stream *s) {
  if (! s->available()) { return false; }
  
  // Waiting for the '0x42' start byte
  while(s->peek() != 0x42) { s->read(); }
 
  // Reading all 32 bytes
  if (s->available() < 32) { return false; }
    
  uint8_t buffer[32];    
  uint16_t sum = 0;
  s->readBytes(buffer, 32);
 
  // Setting up the checksum
  for (uint8_t i=0; i<30; i++) { sum += buffer[i]; }
  
  // Configuring the buffer so that it works across all platforms
  // as the data comes in endian'd
  uint16_t buffer_u16[15];
  for (uint8_t i=0; i<15; i++) {
    buffer_u16[i] = buffer[2 + i*2 + 1];
    buffer_u16[i] += (buffer[2 + i*2] << 8);
  }
 
  // Copying the data into the struct
  memcpy((void *)&data, (void *)buffer_u16, 30);
 
  // Checking if the data was successfully read
  if (sum != data.checksum) {
    Serial.println("Checksum failure");
    return false;
  }
  return true;
}

/* Initialising the serial & pms serial with a 115 200 baud rate */
void setup() {
  Serial.begin(9600);
  pms.begin(9600);
}
  
/* Gathering & displaying the sensor data */
void loop() {
  unsigned long seconds = 1000L; //Notice the L
  unsigned long minutes = seconds * 60;
  // Checking if the data was successfully read
  if (readPMS(&pms)) {
    Serial.println("-----------------------------------------");
    Serial.println("CONCENTRATION UNITS (STANDARD)");
    Serial.println("PM 1.0: "+ data.pm10);
    Serial.println("PM 2.5: "+ data.pm25);
    Serial.println("PM  10: "+ data.pm100);
    Serial.println("CONCENTRATION UNITS (ENVIRONMENTAL)");
    Serial.println("PM 1.0: "+ data.pm10_env);
    Serial.println("PM 2.5: "+ data.pm25_env);
    Serial.println("PM  10: "+ data.pm100_env);
    Serial.println("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
    Serial.print("Particles > 0.3um / 0.1L air:"); 
    Serial.println(data.p_03um);
    Serial.print("Particles > 0.5um / 0.1L air:"); 
    Serial.println(data.p_05um);
    Serial.print("Particles > 1.0um / 0.1L air:"); 
    Serial.println(data.p_10um);
    Serial.print("Particles > 2.5um / 0.1L air:"); 
    Serial.println(data.p_25um);
    Serial.print("Particles > 5.0um / 0.1L air:"); 
    Serial.println(data.p_50um);
    Serial.print("Particles > 10.0 um:"); 
    Serial.println(data.p_100um);
    
    delay(minutes); //for 60,000 milliseconds
  }
  
}