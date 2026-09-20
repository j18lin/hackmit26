// Minimal I2C scanner for the UNO Q, to find out what (if anything) is
// actually on the bus -- the owlert sketch hardcodes the LCD at 0x27 and
// that has never been verified.
//
// Deliberately does NOT include Arduino_RouterBridge: with that library,
// `Serial` becomes the Linux-side bridge monitor, which needs an App Lab
// app context. Without it, `Serial` is plain USB-CDC, readable straight
// from a host over USB (/dev/cu.usbmodem* on macOS) with no Linux side
// involved at all.
//
// Prints before touching the bus, so if Wire itself wedges we still see
// how far it got.

#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(2000);  // let USB-CDC enumerate before the first print
  Serial.println("i2c_scan: booted");
  Wire.begin();
  Serial.println("i2c_scan: wire ready");
}

void loop() {
  Serial.println("i2c_scan: scanning 0x08-0x77 ...");
  int found = 0;
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      found++;
      Serial.print("i2c_scan: FOUND 0x");
      Serial.println(addr, HEX);
    }
  }
  Serial.print("i2c_scan: total devices = ");
  Serial.println(found);
  delay(3000);
}
