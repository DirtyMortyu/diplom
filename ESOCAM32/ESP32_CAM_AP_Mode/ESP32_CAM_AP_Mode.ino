/*
 * ESP32-CAM — публикация кадров через MQTT (сырой JPEG, без Base64)
 *
 * Подключается к хотспоту ESP8266 (RoverCam-AP),
 * захватывает JPEG-кадры и публикует в MQTT топик
 * dirtymortyu/rover/camera как бинарные данные.
 * Flask-бэкенд (bd.py) раздаёт их как MJPEG по HTTPS.
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <PubSubClient.h>

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

// ========== WiFi — AP от ESP8266 ==========
const char* ap_ssid     = "RoverCam-AP";
const char* ap_password = "rover12345";

// ========== MQTT ==========
const char* mqtt_server = "rover-pgk.duckdns.org";
const int   mqtt_port   = 1883;
const char* mqtt_user   = "rover";
const char* mqtt_pass   = "rover123";
const char* cam_topic   = "dirtymortyu/rover/camera";

// MQTT буфер: 20KB хватает для QVGA-JPEG ~5-15KB (сырой, без Base64)
#define MQTT_BUF_SIZE 20480

WiFiClient   espClient;
PubSubClient mqttClient(espClient);

// ========== Инициализация камеры ==========
bool initCamera() {
  camera_config_t config;
  config.ledc_channel  = LEDC_CHANNEL_0;
  config.ledc_timer    = LEDC_TIMER_0;
  config.pin_d0        = Y2_GPIO_NUM;
  config.pin_d1        = Y3_GPIO_NUM;
  config.pin_d2        = Y4_GPIO_NUM;
  config.pin_d3        = Y5_GPIO_NUM;
  config.pin_d4        = Y6_GPIO_NUM;
  config.pin_d5        = Y7_GPIO_NUM;
  config.pin_d6        = Y8_GPIO_NUM;
  config.pin_d7        = Y9_GPIO_NUM;
  config.pin_xclk      = XCLK_GPIO_NUM;
  config.pin_pclk      = PCLK_GPIO_NUM;
  config.pin_vsync     = VSYNC_GPIO_NUM;
  config.pin_href      = HREF_GPIO_NUM;
  config.pin_sscb_sda  = SIOD_GPIO_NUM;
  config.pin_sscb_scl  = SIOC_GPIO_NUM;
  config.pin_pwdn      = PWDN_GPIO_NUM;
  config.pin_reset     = RESET_GPIO_NUM;
  config.xclk_freq_hz  = 20000000;
  config.pixel_format  = PIXFORMAT_JPEG;

  // QVGA (320×240) — оптимальный размер для MQTT
  config.frame_size   = FRAMESIZE_QVGA;
  config.jpeg_quality = 20;   // 0-63, меньше = лучше
  config.fb_count     = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("❌ Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_hmirror(s, 0);
  s->set_vflip(s, 0);

  Serial.println("✅ Camera initialized!");
  return true;
}

// ========== MQTT переподключение ==========
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("🔄 MQTT connecting...");
    String clientId = "ESP32CAM-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqttClient.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println(" OK");
    } else {
      Serial.printf(" FAIL rc=%d, retry 5s\n", mqttClient.state());
      delay(5000);
    }
  }
}

// ========== Захват и публикация кадра (сырой JPEG) ==========
void publishFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Frame capture failed");
    return;
  }

  uint8_t* jpg_buf = fb->buf;
  size_t   jpg_len = fb->len;
  uint8_t* converted = NULL;

  if (fb->format != PIXFORMAT_JPEG) {
    size_t out_len = 0;
    bool ok = frame2jpg(fb, 20, &converted, &out_len);
    esp_camera_fb_return(fb);
    fb = NULL;
    if (!ok) { free(converted); return; }
    jpg_buf = converted;
    jpg_len = out_len;
  }

  // Публикуем сырой JPEG — без Base64, быстрее и меньше
  bool ok = mqttClient.publish(cam_topic, jpg_buf, jpg_len, false);
  if (!ok) {
    Serial.printf("⚠️ MQTT publish failed (size=%u). Reconnecting...\n", jpg_len);
    mqttClient.disconnect();
  } else {
    Serial.printf("[CAM] Frame sent: %u bytes\n", jpg_len);
  }

  if (fb)             esp_camera_fb_return(fb);
  else if (converted) free(converted);
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("========================================");
  Serial.println("   ESP32-CAM v6.0 (MQTT Stream)");
  Serial.println("========================================");

  if (!initCamera()) {
    Serial.println("❌ CRITICAL: Camera init failed!");
    return;
  }

  // Подключение к ESP8266 AP
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ap_ssid, ap_password);

  Serial.printf("📡 Connecting to AP: %s\n", ap_ssid);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
    if (millis() - t > 30000) {
      Serial.println("\n❌ WiFi timeout! Restarting...");
      ESP.restart();
    }
  }
  Serial.printf("\n✅ Connected! IP: %s\n", WiFi.localIP().toString().c_str());

  // MQTT
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setBufferSize(MQTT_BUF_SIZE);
  mqttClient.setKeepAlive(60);

  Serial.println("\n========================================");
  Serial.println("✅ ESP32-CAM готова! Публикую кадры...");
  Serial.printf("   Topic: %s\n", cam_topic);
  Serial.println("========================================\n");
}

// ========== LOOP ==========
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi lost, reconnecting...");
    WiFi.reconnect();
    delay(5000);
    return;
  }

  if (!mqttClient.connected()) reconnectMQTT();
  mqttClient.loop();

  publishFrame();
  delay(50);  // ~15-20 FPS
}
