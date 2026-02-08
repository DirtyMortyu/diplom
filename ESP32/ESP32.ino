#include <ESP8266WiFi.h>
// #include <WiFiClientSecure.h> // БОЛЬШЕ НЕ НУЖНО
#include <PubSubClient.h>
#include <ESP8266WebServer.h>

const char* ssid = "Xiaomi_5F6B";
const char* password = "sg5eac2d";

const char* mqtt_server = "rover-pgk.duckdns.org"; // ТЕПЕРЬ КАК НА САЙТЕ
const int mqtt_port = 1883; // ОБЫЧНЫЙ ПОРТ (БЕЗ SSL)
const char* mqtt_user = "rover";
const char* mqtt_pass = "rover123";
const char* topic_cmd = "dirtymortyu/rover/cmd";

WiFiClient espClient; // ОБЫЧНЫЙ КЛИЕНТ
PubSubClient client(espClient);
ESP8266WebServer server(80);

const char* lastSentCommand = "STOP";
unsigned long lastMqttReconnectAttempt = 0;

void sendCommand(const char* command) {
  if (strcmp(command, lastSentCommand) != 0) {
    Serial1.println(command); 
    Serial1.flush(); 
    lastSentCommand = command;
    Serial.print("[Motors] -> "); Serial.println(command);
  }
}

void mqtt_callback(char* topic, byte* payload, unsigned int length) {
  char msgBuffer[20];
  if (length > 19) length = 19;
  memcpy(msgBuffer, payload, length);
  msgBuffer[length] = '\0';

  if (strcmp(msgBuffer, "FORWARD") == 0)       sendCommand("FORWARD");
  else if (strcmp(msgBuffer, "BACKWARD") == 0) sendCommand("BACKWARD");
  else if (strcmp(msgBuffer, "LEFT") == 0)     sendCommand("LEFT");
  else if (strcmp(msgBuffer, "RIGHT") == 0)    sendCommand("RIGHT");
  else if (strcmp(msgBuffer, "STOP") == 0)     sendCommand("STOP");
  else if (strcmp(msgBuffer, "TURN360") == 0)  sendCommand("TURN360");
  
  Serial.print("[MQTT] In: "); Serial.println(msgBuffer);
  Serial.print("[Mem] Free: "); Serial.println(ESP.getFreeHeap());
}

boolean reconnect() {
  String clientId = "Rover-" + String(ESP.getChipId());
  Serial.print("Attempting MQTT connection to ");
  Serial.print(mqtt_server);
  Serial.print("... ");
  
  if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
    Serial.println("SUCCESS! Connected (TCP 1883)");
    client.subscribe(topic_cmd, 0); 
    return true;
  } else {
    Serial.print("FAILED, rc=");
    Serial.println(client.state()); // Это покажет код ошибки
    return false;
  }
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi OK");

  // НАСТРОЙКИ SSL УДАЛЕНЫ - ТЕПЕРЬ ВСЁ ЛЕТАЕТ
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqtt_callback);
  client.setKeepAlive(60);
  client.setBufferSize(512);

  server.begin();
}

void loop() {
  if (!client.connected()) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > 5000) {
      lastMqttReconnectAttempt = now;
      if (reconnect()) lastMqttReconnectAttempt = 0;
    }
  } else {
    client.loop();
  }
  server.handleClient();
  yield();
}