
#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"

// ========== WiFi настройки (подключение к ESP8266 AP) ==========
const char* ssid = "RoverCam";          // WiFi от ESP8266
const char* password = "rover12345";    // Пароль от ESP8266

// ========== Статический IP для надёжности ==========
IPAddress local_IP(192, 168, 4, 2);     // IP ESP32-CAM
IPAddress gateway(192, 168, 4, 1);      // IP ESP8266 (шлюз)
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);       // Google DNS (опционально)

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
httpd_handle_t camera_httpd = NULL;

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

  // Настройки качества для HTTP стрима (хорошее качество)
  if (psramFound()) {
    config.frame_size = FRAMESIZE_SVGA;  // 800x600 (высокое качество)
    config.jpeg_quality = 10;            // 0-63 (10 = отличное качество)
    config.fb_count = 2;                 // Двойная буферизация
  } else {
    config.frame_size = FRAMESIZE_VGA;   // 640x480
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  // Инициализация камеры
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("❌ Camera init failed: 0x%x\n", err);
    return false;
  }

  // Дополнительные настройки для лучшего качества
  sensor_t * s = esp_camera_sensor_get();
  s->set_brightness(s, 0);     // -2 to 2
  s->set_contrast(s, 0);       // -2 to 2
  s->set_saturation(s, 0);     // -2 to 2
  s->set_special_effect(s, 0); // 0 = No Effect
  s->set_whitebal(s, 1);       // 0 = disable , 1 = enable
  s->set_awb_gain(s, 1);       // 0 = disable , 1 = enable
  s->set_wb_mode(s, 0);        // 0 to 4
  s->set_exposure_ctrl(s, 1);  // 0 = disable , 1 = enable
  s->set_aec2(s, 0);           // 0 = disable , 1 = enable
  s->set_ae_level(s, 0);       // -2 to 2
  s->set_aec_value(s, 300);    // 0 to 1200
  s->set_gain_ctrl(s, 1);      // 0 = disable , 1 = enable
  s->set_agc_gain(s, 0);       // 0 to 30
  s->set_gainceiling(s, (gainceiling_t)0);  // 0 to 6
  s->set_bpc(s, 0);            // 0 = disable , 1 = enable
  s->set_wpc(s, 1);            // 0 = disable , 1 = enable
  s->set_raw_gma(s, 1);        // 0 = disable , 1 = enable
  s->set_lenc(s, 1);           // 0 = disable , 1 = enable
  s->set_hmirror(s, 0);        // 0 = disable , 1 = enable
  s->set_vflip(s, 0);          // 0 = disable , 1 = enable
  s->set_dcw(s, 1);            // 0 = disable , 1 = enable
  s->set_colorbar(s, 0);       // 0 = disable , 1 = enable

  Serial.println("✅ Camera initialized!");
  return true;
}

// ========== MJPEG Stream Handler ==========
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char * part_buf[64];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace; boundary=frame");
  if (res != ESP_OK) {
    return res;
  }

  // CORS для доступа с других доменов
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  Serial.println("[Stream] Client connected");
  int frameCount = 0;

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

    if (res != ESP_OK) {
      break;
    }

    frameCount++;
    if (frameCount % 100 == 0) {
      Serial.printf("[Stream] %d frames sent\n", frameCount);
    }
  }

  Serial.printf("[Stream] Client disconnected. Total frames: %d\n", frameCount);
  return res;
}

// ========== Snapshot Handler ==========
static esp_err_t snapshot_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;

  fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Snapshot failed");
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=snapshot.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);

  Serial.printf("[Snapshot] Sent: %d bytes\n", fb->len);

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
  <title>ESP32-CAM Local Stream</title>
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
    }
    .status { color: #4ad97a; }
    a { color: #00d9ff; }
  </style>
</head>
<body>
  <h1>📹 ESP32-CAM Stream</h1>
  <div class="info">
    <p><strong>Статус:</strong> <span class="status">✅ Камера работает</span></p>
    <p><strong>Режим:</strong> Подключено к ESP8266 AP</p>
    <p><strong>Stream URL:</strong> <a href="/stream">/stream</a></p>
    <p><strong>Snapshot URL:</strong> <a href="/snapshot">/snapshot</a></p>
    <p><strong>Доступ через ESP8266:</strong> http://ESP8266_IP/camera/stream</p>
  </div>
  <img src="/stream" alt="Camera Stream">
  <p style="margin-top: 20px; color: #888;">
    💡 Для доступа из интернета используйте ESP8266 прокси
  </p>
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
  config.ctrl_port = 32768;

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
    Serial.println("✅ HTTP server started on port 80");
  } else {
    Serial.println("❌ HTTP server failed to start");
  }
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  Serial.println("========================================");
  Serial.println("   ESP32-CAM v2.0 (AP Mode)");
  Serial.println("   Connects to ESP8266 Access Point");
  Serial.println("========================================");

  // Инициализация камеры
  if (!initCamera()) {
    Serial.println("❌ CRITICAL: Camera initialization failed!");
    Serial.println("⚠️ Check camera connections and reset ESP32-CAM");
    return;
  }

  // Настройка статического IP (для надёжности)
  if (!WiFi.config(local_IP, gateway, subnet, primaryDNS)) {
    Serial.println("⚠️ Failed to configure static IP");
  }

  // Подключение к WiFi ESP8266
  Serial.println("\n📡 Connecting to ESP8266 Access Point...");
  Serial.print("   SSID: "); Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);  // Отключаем энергосбережение

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
    Serial.print("🌐 Gateway (ESP8266): ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("📶 Signal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    // Запуск веб-сервера
    startCameraServer();

    Serial.println("\n========================================");
    Serial.println("✅ ESP32-CAM готова к работе!");
    Serial.println("========================================");
    Serial.println("🌐 Локальный доступ:");
    Serial.print("   http://");
    Serial.println(WiFi.localIP());
    Serial.println("\n📡 Доступ через ESP8266:");
    Serial.print("   http://ESP8266_IP/camera/stream\n");
    Serial.println("========================================\n");
  } else {
    Serial.println("\n❌ WiFi connection failed!");
    Serial.println("⚠️ Проверьте:");
    Serial.println("   1. ESP8266 раздаёт WiFi 'RoverCam'");
    Serial.println("   2. Пароль: rover12345");
    Serial.println("   3. ESP8266 включен и работает");
  }
}

// ========== LOOP ==========
void loop() {
  // Проверка WiFi соединения
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi disconnected! Reconnecting...");
    WiFi.reconnect();
    delay(5000);
  }
  
  delay(100);
}
