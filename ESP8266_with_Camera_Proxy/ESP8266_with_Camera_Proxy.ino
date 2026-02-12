/*
 * ESP8266 - Управление ровером + HTTP прокси для ESP32-CAM
 * 
 * Режимы работы:
 * 1. STA (Station) - подключён к домашнему WiFi для MQTT
 * 2. AP (Access Point) - раздаёт WiFi "RoverCam" для ESP32-CAM
 * 3. HTTP Proxy - перенаправляет видео с ESP32-CAM на сайт
 * 
 * Автор: Claude + DirtyMortyu
 * Дата: 2026-02-09
 */

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>

// ========== WiFi настройки (подключение к роутеру) ==========
const char* sta_ssid = "Xiaomi_5F6B";
const char* sta_password = "sg5eac2d";

// ========== Access Point настройки (для ESP32-CAM) ==========
const char* ap_ssid = "RoverCam";           // WiFi который раздаёт ESP8266
const char* ap_password = "rover12345";     // Пароль для ESP32-CAM
IPAddress ap_local_ip(192, 168, 4, 1);      // IP ESP8266 в AP сети
IPAddress ap_gateway(192, 168, 4, 1);
IPAddress ap_subnet(255, 255, 255, 0);

// ========== IP адрес ESP32-CAM в AP сети ==========
const char* cam_ip = "192.168.4.2";         // ESP32-CAM получит этот IP

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

// ========== HTTP ПРОКСИ для камеры ==========
// Проксирует видеопоток с ESP32-CAM на сайт
void handleCameraStream() {
  Serial.println("[Camera] Stream request received");
  
  WiFiClient client;
  HTTPClient http;
  
  // Подключаемся к ESP32-CAM
  String streamUrl = String("http://") + cam_ip + "/stream";
  Serial.print("[Camera] Connecting to: "); Serial.println(streamUrl);
  
  http.begin(client, streamUrl);
  http.setTimeout(30000); // 30 секунд таймаут
  
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    Serial.println("[Camera] ✅ Connected to ESP32-CAM stream");
    
    // Устанавливаем заголовки для MJPEG стрима
    server.setContentLength(CONTENT_LENGTH_UNKNOWN);
    server.send(200, "multipart/x-mixed-replace; boundary=frame", "");
    
    // Получаем стрим
    WiFiClient* stream = http.getStreamPtr();
    
    uint8_t buffer[1024];
    unsigned long lastDataTime = millis();
    int bytesTransferred = 0;
    
    // Читаем и перенаправляем данные
    while (http.connected() || stream->available()) {
      size_t size = stream->available();
      
      if (size) {
        int c = stream->readBytes(buffer, min(size, sizeof(buffer)));
        if (c > 0) {
          server.sendContent_P((const char*)buffer, c);
          bytesTransferred += c;
          lastDataTime = millis();
        }
      } else {
        // Если нет данных более 5 секунд - разрыв соединения
        if (millis() - lastDataTime > 5000) {
          Serial.println("[Camera] ⚠️ Stream timeout");
          break;
        }
      }
      
      yield(); // Даём ESP8266 дышать
    }
    
    Serial.printf("[Camera] Stream ended. Transferred: %d bytes\n", bytesTransferred);
    
  } else {
    Serial.printf("[Camera] ❌ Failed to connect: HTTP %d\n", httpCode);
    server.send(503, "text/plain", "Camera unavailable");
  }
  
  http.end();
}

// ========== Snapshot прокси ==========
void handleCameraSnapshot() {
  Serial.println("[Camera] Snapshot request received");
  
  WiFiClient client;
  HTTPClient http;
  
  String snapshotUrl = String("http://") + cam_ip + "/snapshot";
  http.begin(client, snapshotUrl);
  
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    int len = http.getSize();
    WiFiClient* stream = http.getStreamPtr();
    
    server.setContentLength(len);
    server.send(200, "image/jpeg", "");
    
    uint8_t buffer[512];
    while (http.connected() && (len > 0 || len == -1)) {
      size_t size = stream->available();
      if (size) {
        int c = stream->readBytes(buffer, min(size, sizeof(buffer)));
        server.sendContent_P((const char*)buffer, c);
        if (len > 0) len -= c;
      }
      yield();
    }
    
    Serial.println("[Camera] ✅ Snapshot delivered");
  } else {
    Serial.printf("[Camera] ❌ Snapshot failed: HTTP %d\n", httpCode);
    server.send(503, "text/plain", "Camera unavailable");
  }
  
  http.end();
}

// ========== Статус камеры ==========
void handleCameraStatus() {
  WiFiClient client;
  HTTPClient http;
  
  String statusUrl = String("http://") + cam_ip + "/";
  http.begin(client, statusUrl);
  http.setTimeout(3000); // 3 секунды
  
  int httpCode = http.GET();
  http.end();
  
  String status;
  if (httpCode == 200) {
    status = "{\"status\":\"connected\",\"camera_ip\":\"" + String(cam_ip) + "\"}";
  } else {
    status = "{\"status\":\"disconnected\",\"error\":\"Camera not responding\"}";
  }
  
  server.send(200, "application/json", status);
}

// ========== Информационная страница ==========
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ESP8266 Rover Control</title>
  <style>
    body { font-family: Arial; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d9ff; }
    .info { background: #16213e; padding: 15px; border-radius: 8px; margin: 10px 0; }
    .status { color: #4ad97a; }
    a { color: #00d9ff; text-decoration: none; }
    button { 
      background: #00d9ff; 
      border: none; 
      padding: 10px 20px; 
      border-radius: 5px; 
      cursor: pointer;
      margin: 5px;
    }
  </style>
</head>
<body>
  <h1>🤖 ESP8266 Rover Control</h1>
  
  <div class="info">
    <h3>📡 WiFi Status</h3>
    <p><strong>Home WiFi (STA):</strong> <span class="status">)rawliteral" + String(sta_ssid) + R"rawliteral(</span></p>
    <p><strong>IP Address:</strong> )rawliteral" + WiFi.localIP().toString() + R"rawliteral(</p>
    <p><strong>Camera WiFi (AP):</strong> <span class="status">)rawliteral" + String(ap_ssid) + R"rawliteral(</span></p>
    <p><strong>AP IP:</strong> )rawliteral" + ap_local_ip.toString() + R"rawliteral(</p>
  </div>
  
  <div class="info">
    <h3>📹 Camera Proxy</h3>
    <p><strong>ESP32-CAM IP:</strong> )rawliteral" + String(cam_ip) + R"rawliteral(</p>
    <p><a href="/camera/stream" target="_blank">📺 View Stream</a></p>
    <p><a href="/camera/snapshot" target="_blank">📸 Take Snapshot</a></p>
    <p><a href="/camera/status">🔍 Camera Status</a></p>
  </div>
  
  <div class="info">
    <h3>🎮 MQTT Control</h3>
    <p><strong>Broker:</strong> )rawliteral" + String(mqtt_server) + R"rawliteral(</p>
    <p><strong>Topic:</strong> )rawliteral" + String(topic_cmd) + R"rawliteral(</p>
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
  Serial.println("  ESP8266 Rover + Camera Proxy v2.0");
  Serial.println("========================================\n");
  
  // ========== Настройка WiFi (AP + STA) ==========
  Serial.println("📡 Starting WiFi...");
  
  // Режим AP+STA (раздаём WiFi И подключаемся к роутеру)
  WiFi.mode(WIFI_AP_STA);
  
  // Access Point для ESP32-CAM
  Serial.print("🌐 Starting Access Point: ");
  Serial.println(ap_ssid);
  WiFi.softAPConfig(ap_local_ip, ap_gateway, ap_subnet);
  WiFi.softAP(ap_ssid, ap_password);
  Serial.print("   AP IP: ");
  Serial.println(WiFi.softAPIP());
  
  // Подключение к домашнему роутеру
  Serial.print("📶 Connecting to WiFi: ");
  Serial.println(sta_ssid);
  WiFi.begin(sta_ssid, sta_password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("   STA IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n⚠️ WiFi connection failed, but AP is running");
  }
  
  // ========== Настройка MQTT ==========
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqtt_callback);
  client.setKeepAlive(60);
  client.setBufferSize(512);
  
  // ========== Настройка HTTP сервера ==========
  server.on("/", handleRoot);
  server.on("/camera/stream", handleCameraStream);
  server.on("/camera/snapshot", handleCameraSnapshot);
  server.on("/camera/status", handleCameraStatus);
  
  server.begin();
  Serial.println("✅ HTTP server started on port 80");
  
  Serial.println("\n========================================");
  Serial.println("✅ ESP8266 готов к работе!");
  Serial.println("========================================");
  Serial.println("\n📋 Endpoints:");
  Serial.println("   / - Info page");
  Serial.println("   /camera/stream - Video stream proxy");
  Serial.println("   /camera/snapshot - Photo proxy");
  Serial.println("   /camera/status - Camera status");
  Serial.println("\n💡 ESP32-CAM должна подключиться к:");
  Serial.print("   SSID: "); Serial.println(ap_ssid);
  Serial.print("   Password: "); Serial.println(ap_password);
  Serial.print("   Expected IP: "); Serial.println(cam_ip);
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
