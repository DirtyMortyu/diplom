/*
 * ESP32-CAM MQTT Stream для RoboPanel v0.2
 *
 * Функционал:
 * 1. HTTP MJPEG стрим (локальный просмотр)
 * 2. MQTT публикация снапшотов (удаленный доступ через Flask)
 *
 * Автор: Claude + DirtyMortyu
 * Дата: 2026-02-09
 */

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"
#include <PubSubClient.h>
#include "Base64.h"

// ========== WiFi настройки ==========
const char* ssid = "Xiaomi_5F6B";      // ⚠️ ИЗМЕНИТЕ НА СВОЙ WiFi
const char* password = "sg5eac2d";     // ⚠️ ИЗМЕНИТЕ НА СВОЙ ПАРОЛЬ

// ========== MQTT настройки ==========
const char* mqtt_server = "rover-pgk.duckdns.org";
const int mqtt_port = 1883;              // Стандартный MQTT порт (НЕ WebSocket)
const char* mqtt_user = "rover";
const char* mqtt_password = "rover123";
const char* mqtt_topic = "dirtymortyu/rover/camera";

// ========== Настройки стриминга ==========
const int SNAPSHOT_INTERVAL = 400;       // Интервал отправки снапшотов (мс)
unsigned long lastSnapshotTime = 0;
bool mqttEnabled = true;                 // Включить/выключить MQTT стриминг

// ========== Пины камеры AI-Thinker ==========
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ========== Глобальные переменные ==========
httpd_handle_t stream_httpd = NULL;
httpd_handle_t camera_httpd = NULL;
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ========== Настройка камеры ==========
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Настройки качества для MQTT (меньше размер для быстрой передачи)
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA;   // 640x480 (оптимально для MQTT)
    config.jpeg_quality = 15;            // 0-63 (15 = хороший баланс качество/размер)
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_QVGA;  // 320x240
    config.jpeg_quality = 20;
    config.fb_count = 1;
  }

  // Инициализация камеры
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("❌ Camera init failed: 0x%x\n", err);
    return false;
  }

  // Дополнительные настройки
  sensor_t * s = esp_camera_sensor_get();
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 0);
  s->set_gain_ctrl(s, 1);
  s->set_bpc(s, 0);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);
  s->set_hmirror(s, 0);
  s->set_vflip(s, 0);
  s->set_dcw(s, 1);

  Serial.println("✅ Camera initialized!");
  return true;
}

// ========== MQTT подключение ==========
void connectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("📡 Connecting to MQTT... ");

    String clientId = "ESP32CAM_" + String(random(0xffff), HEX);

    if (mqttClient.connect(clientId.c_str(), mqtt_user, mqtt_password)) {
      Serial.println("✅ MQTT Connected!");
      Serial.printf("📤 Publishing to: %s\n", mqtt_topic);
    } else {
      Serial.printf("❌ MQTT failed, rc=%d. Retry in 5s...\n", mqttClient.state());
      delay(5000);
    }
  }
}

// ========== Отправка снапшота через MQTT ==========
void publishSnapshot() {
  if (!mqttClient.connected()) {
    connectMQTT();
  }

  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Camera capture failed");
    return;
  }

  // Кодируем JPEG в Base64
  String encoded = base64::encode(fb->buf, fb->len);

  // MQTT имеет ограничение на размер сообщения (~128KB)
  // Проверяем размер
  if (encoded.length() < 120000) {
    bool success = mqttClient.publish(mqtt_topic, encoded.c_str());
    if (success) {
      Serial.printf("📸 Snapshot sent: %d bytes (encoded: %d)\n", fb->len, encoded.length());
    } else {
      Serial.println("❌ MQTT publish failed");
    }
  } else {
    Serial.printf("⚠️ Snapshot too large: %d bytes. Skipping...\n", encoded.length());
  }

  esp_camera_fb_return(fb);
}

// ========== HTTP MJPEG Stream Handler ==========
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char * part_buf[64];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace; boundary=frame");
  if (res != ESP_OK) return res;

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("❌ Camera capture failed");
      res = ESP_FAIL;
    } else {
      if (fb->format != PIXFORMAT_JPEG) {
        bool jpeg_converted = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
        esp_camera_fb_return(fb);
        fb = NULL;
        if (!jpeg_converted) {
          Serial.println("❌ JPEG compression failed");
          res = ESP_FAIL;
        }
      } else {
        _jpg_buf_len = fb->len;
        _jpg_buf = fb->buf;
      }
    }

    if (res == ESP_OK) {
      size_t hlen = snprintf((char *)part_buf, 64,
        "--frame\r\n"
        "Content-Type: image/jpeg\r\n"
        "Content-Length: %u\r\n\r\n",
        _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, "\r\n", 2);
    }

    if (fb) {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    } else if (_jpg_buf) {
      free(_jpg_buf);
      _jpg_buf = NULL;
    }

    if (res != ESP_OK) break;
  }

  return res;
}

// ========== Snapshot Handler ==========
static esp_err_t snapshot_handler(httpd_req_t *req) {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Camera capture failed");
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=snapshot.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);

  return res;
}

// ========== Index Page Handler ==========
static esp_err_t index_handler(httpd_req_t *req) {
  const char* html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ESP32-CAM MQTT Stream</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #00d9ff; }
    img {
      max-width: 100%;
      border: 2px solid #00d9ff;
      border-radius: 8px;
    }
    .info {
      background: #16213e;
      padding: 15px;
      border-radius: 8px;
      margin: 20px auto;
      max-width: 600px;
      text-align: left;
    }
    .status { color: #4ad97a; }
    a { color: #00d9ff; }
  </style>
</head>
<body>
  <h1>📹 ESP32-CAM MQTT Stream</h1>
  <div class="info">
    <p><strong>Статус:</strong> <span class="status">✅ Камера работает</span></p>
    <p><strong>HTTP Stream:</strong> <a href="/stream">/stream</a> (локальный просмотр)</p>
    <p><strong>MQTT Topic:</strong> dirtymortyu/rover/camera</p>
    <p><strong>Remote Access:</strong> Через Flask API на Render.com</p>
  </div>
  <img src="/stream" alt="Camera Stream">
</body>
</html>
)rawliteral";

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, strlen(html));
}

// ========== Запуск HTTP сервера ==========
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;

  httpd_uri_t index_uri = {
    .uri       = "/",
    .method    = HTTP_GET,
    .handler   = index_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t snapshot_uri = {
    .uri       = "/snapshot",
    .method    = HTTP_GET,
    .handler   = snapshot_handler,
    .user_ctx  = NULL
  };

  Serial.println("🚀 Starting HTTP server...");
  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &index_uri);
    httpd_register_uri_handler(camera_httpd, &stream_uri);
    httpd_register_uri_handler(camera_httpd, &snapshot_uri);
    Serial.println("✅ HTTP server started!");
  }
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  Serial.println("========================================");
  Serial.println("   ESP32-CAM MQTT Stream v2.0");
  Serial.println("   For RoboPanel Remote Access");
  Serial.println("========================================");

  // Инициализация камеры
  if (!initCamera()) {
    Serial.println("❌ CRITICAL: Camera initialization failed!");
    return;
  }

  // Подключение к WiFi
  Serial.println("\n📡 Connecting to WiFi...");
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi connected!");
    Serial.print("📍 IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("📶 Signal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    // Запуск HTTP сервера (для локального просмотра)
    startCameraServer();

    // Настройка MQTT клиента
    mqttClient.setServer(mqtt_server, mqtt_port);
    mqttClient.setBufferSize(131072); // 128KB буфер для больших сообщений

    // Подключение к MQTT
    connectMQTT();

    Serial.println("\n========================================");
    Serial.println("✅ ESP32-CAM готова к работе!");
    Serial.println("========================================");
    Serial.print("🌐 Локальный просмотр: http://");
    Serial.println(WiFi.localIP());
    Serial.printf("📡 MQTT Stream: %s:%d\n", mqtt_server, mqtt_port);
    Serial.printf("📤 Topic: %s\n", mqtt_topic);
    Serial.printf("⏱️ Snapshot interval: %dms\n", SNAPSHOT_INTERVAL);
    Serial.println("========================================\n");
  } else {
    Serial.println("\n❌ WiFi connection failed!");
  }
}

// ========== LOOP ==========
void loop() {
  // Поддержка MQTT соединения
  if (mqttEnabled && WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      connectMQTT();
    }
    mqttClient.loop();

    // Отправка снапшотов с заданным интервалом
    unsigned long currentTime = millis();
    if (currentTime - lastSnapshotTime >= SNAPSHOT_INTERVAL) {
      publishSnapshot();
      lastSnapshotTime = currentTime;
    }
  }

  delay(10);
}
