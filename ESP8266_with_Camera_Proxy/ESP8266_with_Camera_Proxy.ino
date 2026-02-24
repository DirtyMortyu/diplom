/*
 * ESP8266 - Управление ровером (MQTT)
 * WiFi настраивается через WiFiManager (портал "Rover-Setup")
 *
 * Автор: Claude + DirtyMortyu
 * Дата: 2026-02-12
 */

#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ESP8266WebServer.h>

// ========== MQTT настройки ==========
const char* mqtt_server = "rover-pgk.duckdns.org";
const int mqtt_port = 1883;
const char* mqtt_user = "rover";
const char* mqtt_pass = "rover123";
const char* topic_cmd = "dirtymortyu/rover/cmd";

WiFiClient espClient;
PubSubClient client(espClient);
ESP8266WebServer server(80);

const char* lastSentCommand = "STOP";
unsigned long lastMqttReconnectAttempt = 0;

// ========== Команды моторам ==========
void sendCommand(const char* command) {
  if (strcmp(command, lastSentCommand) != 0) {
    Serial1.println(command); 
    Serial1.flush(); 
    lastSentCommand = command;
    Serial.print("[Motors] -> "); Serial.println(command);
  }
}

// ========== MQTT callback ==========
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
}

// ========== MQTT переподключение ==========
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
    Serial.println(client.state());
    return false;
  }
}

// ========== Информационная страница ==========
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ESP8266 Rover</title>
  <style>
    body { font-family: Arial; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d9ff; }
    .info { background: #16213e; padding: 15px; border-radius: 8px; margin: 10px 0; }
    .status { color: #4ad97a; }
    button { background: #00d9ff; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 5px; }
  </style>
</head>
<body>
  <h1>🤖 ESP8266 Rover</h1>
  <div class="info">
    <h3>📡 WiFi</h3>
    <p><strong>IP:</strong> )rawliteral" + WiFi.localIP().toString() + R"rawliteral(</p>
    <p><strong>SSID:</strong> )rawliteral" + WiFi.SSID() + R"rawliteral(</p>
  </div>
  <div class="info">
    <h3>🎮 MQTT</h3>
    <p><strong>Broker:</strong> )rawliteral" + String(mqtt_server) + R"rawliteral(</p>
    <p><strong>Status:</strong> <span class="status">)rawliteral" +
      (client.connected() ? "✅ Connected" : "❌ Disconnected") + R"rawliteral(</span></p>
  </div>
  <div class="info">
    <h3>💾 Memory</h3>
    <p><strong>Free Heap:</strong> )rawliteral" + String(ESP.getFreeHeap()) + R"rawliteral( bytes</p>
  </div>
  <button onclick="location.reload()">🔄 Refresh</button>
</body>
</html>
)rawliteral";

  server.send(200, "text/html", html);
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);

  Serial.println("\n\n========================================");
  Serial.println("  ESP8266 Rover v3.0 (WiFiManager)");
  Serial.println("========================================\n");

  // WiFiManager — автоматическое подключение или портал настройки
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);  // 3 мин на настройку

  Serial.println("📡 Подключение к WiFi...");
  Serial.println("Если сеть не найдена — подключитесь к WiFi 'Rover-Setup'");

  if (!wm.autoConnect("Rover-Setup")) {
    Serial.println("❌ Не удалось подключиться. Перезагрузка...");
    ESP.restart();
  }

  Serial.println("\n✅ WiFi Connected!");
  Serial.print("   STA IP: ");
  Serial.println(WiFi.localIP());

  // ========== Настройка MQTT ==========
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqtt_callback);
  client.setKeepAlive(60);
  client.setBufferSize(512);

  // ========== Настройка HTTP сервера ==========
  server.on("/", handleRoot);
  server.begin();
  Serial.println("✅ HTTP server started on port 80");

  Serial.println("\n========================================");
  Serial.println("✅ ESP8266 готов к работе!");
  Serial.println("========================================\n");
}

// ========== LOOP ==========
void loop() {
  // MQTT обработка
  if (!client.connected()) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > 5000) {
      lastMqttReconnectAttempt = now;
      if (reconnect()) lastMqttReconnectAttempt = 0;
    }
  } else {
    client.loop();
  }
  
  // HTTP сервер
  server.handleClient();
  
  yield();
}


   
