#include <SoftwareSerial.h>

// Определение пинов для управления моторами гусениц
// Левая гусеница - Мотор 1
const int leftMotor1Pin1 = 8;
const int leftMotor1Pin2 = 9;

// Левая гусеница - Мотор 2
const int leftMotor2Pin1 = 11;
const int leftMotor2Pin2 = 10;

// Правая гусеница - Мотор 1
const int rightMotor1Pin1 = 4;
const int rightMotor1Pin2 = 5;

// Правая гусеница - Мотор 2
const int rightMotor2Pin1 = 6;
const int rightMotor2Pin2 = 7;

// Определение пинов для SoftwareSerial (связь с ESP)
// D2 как RX, D3 как TX
SoftwareSerial espSerial(2, 3); 

// --- ФУНКЦИИ УПРАВЛЕНИЯ МОТОРАМИ (Прототипы) ---
void forward();
void backward();
void turnLeft();
void turnRight();
void stop();
void processCommand(String cmd); // Прототип функции обработки

void setup() {
  // Установка пинов всех восьми двигателей как выходы
  pinMode(leftMotor1Pin1, OUTPUT);
  pinMode(leftMotor1Pin2, OUTPUT);
  pinMode(leftMotor2Pin1, OUTPUT);
  pinMode(leftMotor2Pin2, OUTPUT);
  pinMode(rightMotor1Pin1, OUTPUT);
  pinMode(rightMotor1Pin2, OUTPUT);
  pinMode(rightMotor2Pin1, OUTPUT);
  pinMode(rightMotor2Pin2, OUTPUT);

  // Инициализация аппаратного Serial для отладки (связь с компьютером)
  Serial.begin(115200); 
  Serial.println("Arduino: Ровер готов к приему команд.");

  // Инициализация SoftwareSerial для связи с ESP
  // ВАЖНО: Должно совпадать со скоростью на ESP8266 (9600)
  espSerial.begin(9600); 
}

void loop() {
  static String receivedCommand = ""; // Хранит команду
  
  if (espSerial.available()) {
    char c = espSerial.read();
    
    // --- ОТЛАДКА: Печатаем каждый полученный байт ---
    Serial.print("Received byte: 0x");
    Serial.print(c, HEX); // Печатаем в шестнадцатеричном формате
    Serial.print(" (");
    Serial.print(c); // Печатаем как символ
    Serial.println(")");
    // ------------------------------------------------

    // 2. Если это символ новой строки, значит, команда завершена
    if (c == '\n') {
      
      // Выводим собранную команду
      Serial.print("--- FULL COMMAND RECEIVED: [");
      Serial.print(receivedCommand);
      Serial.println("] ---");
      
      // Теперь обрабатываем команду
      receivedCommand.trim(); 
      processCommand(receivedCommand);
      
      receivedCommand = ""; // Сброс
    } 
    // 3. Если это не символ новой строки и не символ возврата каретки, добавляем к команде
    else if (c != '\r') { 
      receivedCommand += c;
    }
  }
}
// Новая функция для обработки команды, чтобы не загромождать loop
void processCommand(String cmd) {
    if (cmd == "FORWARD") {
      forward();
    } else if (cmd == "BACKWARD") {
      backward();
    } else if (cmd == "LEFT") {
      turnLeft();
    } else if (cmd == "RIGHT") {
      turnRight();
    } else if (cmd == "STOP") {
      stop();
    }
}

// =================================================================
// ФУНКЦИИ УПРАВЛЕНИЯ ГУСЕНИЦАМИ
// =================================================================

void forward() {
  Serial.println("Action: FORWARD");
  digitalWrite(leftMotor1Pin1, HIGH); 
  digitalWrite(leftMotor1Pin2, LOW);
  digitalWrite(leftMotor2Pin1, HIGH); 
  digitalWrite(leftMotor2Pin2, LOW);
  digitalWrite(rightMotor1Pin1, HIGH); 
  digitalWrite(rightMotor1Pin2, LOW);
  digitalWrite(rightMotor2Pin1, HIGH); 
  digitalWrite(rightMotor2Pin2, LOW);
}

void backward() {
  Serial.println("Action: BACKWARD");
  digitalWrite(leftMotor1Pin1, LOW);  
  digitalWrite(leftMotor1Pin2, HIGH);
  digitalWrite(leftMotor2Pin1, LOW);  
  digitalWrite(leftMotor2Pin2, HIGH);
  digitalWrite(rightMotor1Pin1, LOW);  
  digitalWrite(rightMotor1Pin2, HIGH);
  digitalWrite(rightMotor2Pin1, LOW);  
  digitalWrite(rightMotor2Pin2, HIGH);
}

void turnLeft() {
  Serial.println("Action: LEFT");
  digitalWrite(leftMotor1Pin1, LOW);  
  digitalWrite(leftMotor1Pin2, HIGH);
  digitalWrite(leftMotor2Pin1, LOW);  
  digitalWrite(leftMotor2Pin2, HIGH);
  digitalWrite(rightMotor1Pin1, HIGH); 
  digitalWrite(rightMotor1Pin2, LOW);
  digitalWrite(rightMotor2Pin1, HIGH); 
  digitalWrite(rightMotor2Pin2, LOW);
}

void turnRight() {
  Serial.println("Action: RIGHT");
  digitalWrite(leftMotor1Pin1, HIGH); 
  digitalWrite(leftMotor1Pin2, LOW);
  digitalWrite(leftMotor2Pin1, HIGH); 
  digitalWrite(leftMotor2Pin2, LOW);
  digitalWrite(rightMotor1Pin1, LOW);  
  digitalWrite(rightMotor1Pin2, HIGH);
  digitalWrite(rightMotor2Pin1, LOW);  
  digitalWrite(rightMotor2Pin2, HIGH);
}

void stop() {
  Serial.println("Action: STOP");
  digitalWrite(leftMotor1Pin1, LOW);
  digitalWrite(leftMotor1Pin2, LOW);
  digitalWrite(leftMotor2Pin1, LOW);
  digitalWrite(leftMotor2Pin2, LOW);
  digitalWrite(rightMotor1Pin1, LOW);
  digitalWrite(rightMotor1Pin2, LOW);
  digitalWrite(rightMotor2Pin1, LOW);
  digitalWrite(rightMotor2Pin2, LOW);
}