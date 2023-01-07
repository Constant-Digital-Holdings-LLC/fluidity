
/*
C22a24d
*/

String testData[17] = {
  "Reply: <:ok\r\n{f7 81 00 00 00 ff}>\r\n"
  "Reply: <[81 00 00 00 00]\r\n[81 01 01 00 77]>\r\n",
  "Reply: <[91 01 01 00 77]>\r\n",
  "Reply: <[91 00 01 00 77]\r\n[90 00 01 00 77]\r\n[90 00 00 00 77]>\r\n",
  "Reply: <[80 00 00 00 77]\r\n[90 00 00 00 77]\r\n[80 00 00 00 77]\r\n[90 00 00 00 01]\r\n[80 00 00 00 01]>\r\n",
  "Reply: <[82 00 00 00 01]\r\n[82 02 02 00 75]>\r\n",
  "Reply: <[82 00 00 00 01]\r\n[80 00 00 00 01]>\r\n",
  "Reply: <[80 00 00 00 00]>\r\n",
  "Reply: <{f7 81 00 00 00 ff}>\r\n",  
  "Reply: <[81 00 00 00 00]>\r\n",
  "Reply: <[81 01 01 00 77]>\r\n",
  "Reply: <[80 00 01 00 77]\r\n[80 00 00 00 77]\r\n[90 00 00 00 77]\r\n[92 00 00 00 77]>\r\n",
  "Reply: <[92 02 02 00 77]>\r\n",
  "Reply: <[82 02 02 00 77]\r\n[82 02 02 00 75]>\r\n",
  "Reply: <[82 00 00 00 01]\r\n[80 00 00 00 01]>\r\n",
  "Reply: <[80 00 00 00 00]>\r\n",
  "Reply: <{f7 81 00 00 00 ff}>\r\n",  
  };


void setup() {
  
 Serial.begin(9600);
 // while the serial stream is not open, do nothing:
 while (!Serial) ;

 Serial.println((String)"Set command delay to 0 ms.");
 Serial.println("Set inter-digit delay to 0 ms.");
 Serial.println("-------------------------------------");
 Serial.println("CONFIG.ENV environment file loaded");
 Serial.println("   Serial port: yes");
 Serial.println("      Com port: 1");
 Serial.println("         Speed: 9600 baud.");
 Serial.println(" Command delay: 0 ms.");
 Serial.println("   Digit delay: 0 ms.");
 Serial.println("-------------------------------------");
 Serial.println("Opening serial port -- COM1: baud=9600 data=8 parity=n stop=1 odsr=off octs=off rts=off xon=off");
 Serial.println("Checking connection to controller");
 Serial.println("[C001]  srs0159c ");
 Serial.println("Opening config file default");
 Serial.println("Set command delay to 0 ms.");
 Serial.println("Set inter-digit delay to 0 ms.");
 Serial.println("End of configuration file");
 Serial.println("-------------------------");
 
}

void loop() {

  delay(random(250, 10000));

  Serial.print(testData[random(0, 15)]);
  

}
