
/*

Test Data Generator for Fluidity

*/

String testData[12] = {
  "W6KA-1 / MIRDOR on 145.050 & 223.600 MHz\r\n"
  "OJAI>KE6NYT-7,SOUTH*/1: <<I00>>:\r\n",
  "KE6NYT-7>OJAI,SOUTH*/1: <<I01>>:\r\n",
  "###CONNECTED TO NODE OJAI(K6ERN) CHANNEL A\r\n",
  "KK6BEB>BEACON,VERDGO-3*/1: <UI>:\r\n",
  "Router(config-if)# encapsulation atm-dxi\r\n",
  "is333-1(config-if)#\r\n",
  "RFSwitch>cluster-cli enable\r\n",
  "[ec2-user ~]$ sudo systemctl restart\r\n",  
  "22:06:21.188 UTC Fri Feb 4 2000\r\n",
  "IPPBX login: support\r\n",
  "$GPGGA,181908.00,3404.7041778,N,07044.3966270,W,4,13,1.00,495.144,M,29.200,M,0.10,0000*40\r\n",
  };


void setup() {
  
 Serial.begin(9600);
 // while the serial stream is not open, do nothing:
 while (!Serial) ;

 Serial.println("Generating sample data:");
 
}

void loop() {

  delay(random(250, 10000));

  Serial.print(testData[random(0, 11)]);
  

}
