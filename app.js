// ======= HELPERS =======
const $ = sel => document.querySelector(sel);
const logBox = $("#log");

// ======= MQTT ИНИЦИАЛИЗАЦИЯ =======
// Подключаемся к брокеру через защищенный WebSocket (WSS)
// Попробуй этот адрес, если 8084 блокируется
const mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    keepalive: 60,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
});

mqttClient.on('connect', () => {
    console.log("MQTT Connected!");
    log("Связь с облаком установлена", "net");
});

mqttClient.on('error', (err) => {
    log("MQTT: Ошибка соединения с облаком", "net");
    console.error(err);
});

// ======= LOGGING =======
function log(msg, cat = "misc") {
  const ts = new Date().toLocaleTimeString();
  if (cat === "motor" && !$("#logMotor").checked) return;
  if (cat === "net" && !$("#logNet").checked) return;
  if (cat === "telem" && !$("#logTelem").checked) return;
  const line = document.createElement("div");
  line.textContent = `[${ts}] ${msg}`;
  logBox.prepend(line);
}

$("#clearLog").onclick = () => logBox.innerHTML = "";

// ======= AUTH STATE =======
let currentUser = null;
let apiBase = $("#apiBase")?.value.trim();
let demo = false;

// ======= SEND COMMAND (MQTT VERSION) =======
// ======= НОВАЯ ФУНКЦИЯ ОТПРАВКИ (БЕЗ HTTP) =======
async function sendESPCommand(cmd) {
  if (!currentUser) return;
  
  const espCmd = cmdMap[cmd] || "STOP";
  
  if (demo) {
      log(`[DEMO] MQTT: ${espCmd}`, "motor");
      return;
  }

  // Проверяем, подключен ли MQTT клиент
  if (!mqttClient.connected) {
      log("MQTT: Нет связи с облаком!", "net");
      return;
  }

  const topic = 'dirtymortyu/rover/cmd';
  
  // Отправляем команду в облако
  mqttClient.publish(topic, espCmd, { qos: 0 }, (err) => {
      if (err) {
          console.error("MQTT Publish Error:", err);
          log("Ошибка отправки команды", "net");
      } else {
          log(`Облако -> ${espCmd}`, "motor");
      }
  });
}

async function stopESP() { await sendESPCommand("stop"); }

// ======= UI & LOGIN =======
function showLoginModal() {
  $("#loginModal").style.display = "flex";
  $("#loginInput").value = "";
  $("#passwordInput").value = "";
  $("#loginInput").focus();
}

function hideLoginModal() {
  $("#loginModal").style.display = "none";
}

async function login() {
    const loginInput = $("#loginInput").value.trim();
    const password = $("#passwordInput").value;
    apiBase = $("#apiBase").value.trim();

    log(`Вход на сервер: ${apiBase}`, "net");

    if (!loginInput || !password) {
        alert("Введите логин и пароль!");
        return;
    }

    try {
        const response = await fetch(`${apiBase}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ login: loginInput, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = { login: data.login, role: data.role };
            localStorage.setItem("user", JSON.stringify(currentUser));
            loadUserPanel();
            hideLoginModal();
            log(`Успех! Роль: ${data.role}`, "misc");
        } else {
            alert(data.message || "Неверный логин или пароль!");
        }
    } catch (err) {
        log(`Ошибка входа: ${err.message}`, "net");
        alert("Не удалось связаться с сервером!");
    }
}

function logout() {
  currentUser = null;
  localStorage.removeItem("user");
  showLoginModal();
  log("Выход из системы", "misc");
}

function loadUserPanel() {
  const mainContent = $(".grid");
  const topbar = $(".topbar");
  
  if (currentUser?.role === "user") {
    $(".brand strong").textContent = "RoboPanel - Пользователь";
    $(".controls").style.display = "block";
    $(".video").style.display = "block";
    $(".status").style.display = "none";
    $(".tasks").style.display = "none";
    $(".logs").style.display = "none";
    mainContent.style.gridTemplateColumns = "1fr 1fr";
  } else if (currentUser?.role === "admin") {
    $(".brand strong").textContent = "RoboPanel - Администратор";
    $(".controls").style.display = "block";
    $(".video").style.display = "block";
    $(".status").style.display = "block";
    $(".tasks").style.display = "block";
    $(".logs").style.display = "block";
    mainContent.style.gridTemplateColumns = "380px 1fr 420px";
  }

  if (!$("#logoutBtn")) {
    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logoutBtn";
    logoutBtn.textContent = "Выйти";
    logoutBtn.style.marginLeft = "10px";
    logoutBtn.onclick = logout;
    topbar.querySelector(".conn").appendChild(logoutBtn);
  }
}

// ====== COMMAND MAPPING ======
const cmdMap = {
  forward: "FORWARD",
  backward: "BACKWARD",
  left: "LEFT",
  right: "RIGHT",
  stop: "STOP",
  TURN360: "TURN360"
};

// ====== EVENT LISTENERS ======
$("#connectBtn").onclick = () => { 
    apiBase = $("#apiBase").value.trim();
    log(`Настройки обновлены. Сервер: ${apiBase}`, "net");
};

document.querySelectorAll(".btn").forEach(b => {
  b.addEventListener("mousedown", () => sendESPCommand(b.dataset.cmd));
  b.addEventListener("touchstart", e => { e.preventDefault(); sendESPCommand(b.dataset.cmd); }, {passive:false});
});

document.querySelectorAll(".dir").forEach(b => {
  b.addEventListener("mouseup", stopESP);
  b.addEventListener("mouseleave", e => { if(e.buttons===1) stopESP(); });
  b.addEventListener("touchend", stopESP);
});

$("#square")?.addEventListener("click", () => sendESPCommand("TURN360"));

// ====== KEYBOARD CONTROL ======
let keysPressed = new Set();
let currentCmd = "stop";
let kbEnabled = false;

$("#kbBtn").onclick = () => {
    kbEnabled = !kbEnabled;
    $("#kbBtn").innerText = kbEnabled ? "Выключить клаву" : "Включить клаву";
    $("#kbStatus").innerText = "Режим: " + (kbEnabled ? "включён" : "выключен");
};

const keyMap = { 
  "w": "forward", "ArrowUp": "forward", "W": "forward",
  "s": "backward", "ArrowDown": "backward", "S": "backward",
  "a": "left", "ArrowLeft": "left", "A": "left",
  "d": "right", "ArrowRight": "right", "D": "right",
  " ": "stop", "k": "TURN360",
};

document.addEventListener("keydown", e => {
  if (!kbEnabled || !keyMap[e.key]) return;
  keysPressed.add(e.key);
  const newCmd = keyMap[Array.from(keysPressed)[0]] || "stop";
  if (newCmd !== currentCmd) {
    currentCmd = newCmd;
    sendESPCommand(currentCmd);
  }
});

document.addEventListener("keyup", e => {
  if (!kbEnabled) return;
  keysPressed.delete(e.key);
  const newCmd = keyMap[Array.from(keysPressed)[0]] || "stop";
  if (newCmd !== currentCmd) {
    currentCmd = newCmd;
    sendESPCommand(currentCmd);
  }
});

// ====== JOYSTICK ======
const joy = $("#joystick");
const jctx = joy.getContext("2d");
const center = {x: joy.width/2, y: joy.height/2};
const R = 90, knobR = 26;
let dragging = false, knob = {...center};

function drawJoy() {
  jctx.clearRect(0,0,joy.width,joy.height);
  jctx.beginPath(); jctx.arc(center.x, center.y, R, 0, Math.PI*2);
  jctx.strokeStyle = "#2a3140"; jctx.lineWidth = 3; jctx.stroke();
  jctx.beginPath(); jctx.arc(knob.x, knob.y, knobR, 0, Math.PI*2);
  jctx.fillStyle = "#1b2330"; jctx.fill();
  jctx.strokeStyle = "#3ea6ff"; jctx.lineWidth = 2; jctx.stroke();
}

function setKnob(pos){
  const dx = pos.x - center.x, dy = pos.y - center.y;
  const mag = Math.hypot(dx, dy);
  if(mag>R){ const k=R/mag; knob.x=center.x+dx*k; knob.y=center.y+dy*k; }
  else knob={...pos};
  drawJoy();
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  let cmd = "stop";
  if(mag > 20) {
    if(absDx > absDy) cmd = dx > 0 ? "right" : "left";
    else cmd = dy < 0 ? "forward" : "backward";
  }
  if(cmd !== currentCmd) { currentCmd = cmd; sendESPCommand(cmd); }
}

joy.addEventListener("mousedown", e => { dragging=true; setKnob(joyPosFromEvent(e)); });
document.addEventListener("mousemove", e => { if(dragging) setKnob(joyPosFromEvent(e)); });
document.addEventListener("mouseup", () => { dragging=false; knob={...center}; drawJoy(); stopESP(); });

function joyPosFromEvent(e){
  const rect = joy.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX)-rect.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY)-rect.top;
  return {x, y};
}

// ====== INIT ======
window.addEventListener("load", () => {
  drawJoy();
  if ($("#loginSubmitBtn")) $("#loginSubmitBtn").onclick = login;
  const savedUser = localStorage.getItem("user");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    loadUserPanel();
  } else {
    showLoginModal();
  }
});
