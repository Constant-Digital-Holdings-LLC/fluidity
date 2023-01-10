
/*
C22a24d
*/


String testData[8] = {
  "[80 00 00 00 00]\r\n",
  "{d7 81 00 00 00 ff}\r\n",
  "[80 00 00 00 01]\r\n",
  "{d7 81 00 00 00 ff}\r\n",
  "[90 10 10 00 47]\r\n",
  "[90 00 00 00 01]\r\n",
  "[c0 00 00 00 00]\r\n",
  "[82 02 02 00 55]\r\n",
  };


void setup() {
  
 Serial.begin(9600);
 // while the serial stream is not open, do nothing:
 while (!Serial) ;

 Serial.println("Sending test data:");
 
}

void loop() {

  delay(random(250, 10000));

  Serial.print(testData[random(0, 7)]);
  

}
