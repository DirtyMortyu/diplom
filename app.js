// ======= HELPERS =======
const $ = sel => document.querySelector(sel);
const logBox = $("#log");

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

let currentUser = null;

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
    const loginInput = document.getElementById("loginInput").value.trim();
    const password = document.getElementById("passwordInput").value;
    
    // ВАЖНО: берем актуальный адрес из поля прямо перед запросом
    apiBase = document.getElementById("apiBase").value.trim();

    log(`Попытка входа на сервер: ${apiBase}`, "net"); // Это появится в твоем логе на сайте

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
        console.error("Детальная ошибка:", err);
        log(`Ошибка входа: ${err.message}`, "net");
        alert("Не удалось связаться с сервером. Проверьте адрес API!");
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
  
  // Скрываем/показываем элементы в зависимости от роли
  if (currentUser?.role === "user") {
    // ПОЛЬЗОВАТЕЛЬ - только управление и видео
    $(".brand strong").textContent = "RoboPanel - Пользователь";
    
    // Показываем только нужные карточки
    $(".controls").style.display = "block";
    $(".video").style.display = "block";
    
    // Скрываем остальные
    $(".status").style.display = "none";
    $(".tasks").style.display = "none";
    $(".logs").style.display = "none";
    
    // Настраиваем grid
    mainContent.style.gridTemplateColumns = "1fr 1fr";
    mainContent.style.gridTemplateRows = "auto";
    
    // Добавляем кнопку выхода
    if (!$("#logoutBtn")) {
      const logoutBtn = document.createElement("button");
      logoutBtn.id = "logoutBtn";
      logoutBtn.textContent = "Выйти";
      logoutBtn.style.marginLeft = "10px";
      logoutBtn.onclick = logout;
      topbar.querySelector(".conn").appendChild(logoutBtn);
    }
    
  } else if (currentUser?.role === "admin") {
    // АДМИНИСТРАТОР - всё
    $(".brand strong").textContent = "RoboPanel - Администратор";
    
    // Показываем все карточки
    $(".controls").style.display = "block";
    $(".video").style.display = "block";
    $(".status").style.display = "block";
    $(".tasks").style.display = "block";
    $(".logs").style.display = "block";
    
    // Восстанавливаем оригинальный grid
    mainContent.style.gridTemplateColumns = "380px 1fr 420px";
    mainContent.style.gridTemplateRows = "auto auto";
    
    // Добавляем кнопку выхода
    if (!$("#logoutBtn")) {
      const logoutBtn = document.createElement("button");
      logoutBtn.id = "logoutBtn";
      logoutBtn.textContent = "Выйти";
      logoutBtn.style.marginLeft = "10px";
      logoutBtn.onclick = logout;
      topbar.querySelector(".conn").appendChild(logoutBtn);
    }
  }
}

// ====== GLOBALS ======
et apiBase = $("#apiBase")?.value.trim(); // Сервер (Render)
let roverIp = $("#roverIp")?.value.trim(); // Ровер (ESP32)
let demo = false;

// Кнопка обновления настроек
$("#connectBtn").onclick = () => { 
    apiBase = $("#apiBase").value.trim();
    roverIp = $("#roverIp").value.trim();
    
    // Проверка: добавил ли пользователь http://
    if (roverIp && !roverIp.startsWith('http')) {
        roverIp = 'http://' + roverIp;
        $("#roverIp").value = roverIp;
    }

    log(`Настроено: Сервер=${apiBase} | Ровер=${roverIp}`, "net");
    
    // Проверяем связь с ровером (тестовый стоп)
    if (currentUser) sendESPCommand("stop"); 
};

// ====== COMMAND MAPPING ======
const cmdMap = {
  forward: "FORWARD",
  backward: "BACKWARD",
  left: "LEFT",
  right: "RIGHT",
  stop: "STOP",
  TURN360: "TURN360"
};

// ====== SEND COMMAND ======
async function sendESPCommand(cmd) {
  if (!currentUser) {
    log("Ошибка: Сначала нужно авторизоваться!", "net");
    showLoginModal();
    return;
  }

  const espCmd = cmdMap[cmd] || "STOP";
  
  if (demo) {
      log(`[DEMO] Команда: ${espCmd}`, "motor");
      return;
  }

  // Обновляем IP из поля перед отправкой
  roverIp = $("#roverIp").value.trim();

  try {
    // ВАЖНО: режим 'no-cors' иногда помогает с ESP32, 
    // но лучше оставить обычный fetch для отладки ошибок
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // Таймаут 2 сек

    const response = await fetch(`${roverIp}/api/move`, {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: `cmd=${encodeURIComponent(espCmd)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    log(`Отправлено: ${espCmd}`, "motor");
  } catch(e) {
    console.error("Rover error:", e);
    log(`Ровер недоступен (${roverIp})`, "net");
  }
}

async function stopESP() { await sendESPCommand("stop"); }

// ====== BUTTON CONTROL ======
document.querySelectorAll(".btn").forEach(b => {
  b.addEventListener("mousedown", () => sendESPCommand(b.dataset.cmd));
  b.addEventListener("touchstart", e => { e.preventDefault(); sendESPCommand(b.dataset.cmd); }, {passive:false});
});
document.querySelectorAll(".dir").forEach(b => {
  b.addEventListener("mouseup", stopESP);
  b.addEventListener("mouseleave", e => { if(e.buttons===1) stopESP(); });
  b.addEventListener("touchend", stopESP);
});

// ====== TURN360 BUTTON ======
document.addEventListener("DOMContentLoaded", () => {
    const turnBtn = document.getElementById("square");
    if(turnBtn) {
        turnBtn.addEventListener("click", () => {
            sendESPCommand("TURN360");
            log("Команда отправлена: TURN360", "motor");
        });
    }
});

// ====== KEYBOARD CONTROL ======
let keysPressed = new Set();
let currentCmd = "stop"; // текущая команда
let kbEnabled = false; // глобально: включена ли клавиатура

// кнопка переключения клавиатуры
$("#kbBtn").onclick = () => {
    kbEnabled = !kbEnabled;
    $("#kbBtn").innerText = kbEnabled ? "Выключить управление клавой" : "Включить управление клавой";
    $("#kbStatus").innerText = "Режим: " + (kbEnabled ? "включён" : "выключен");
};

// маппинг клавиш
const keyMap = { 
  "w": "forward", "ArrowUp": "forward", "W": "forward",
  "s": "backward", "ArrowDown": "backward", "S": "backward",
  "a": "left", "ArrowLeft": "left", "A": "left",
  "d": "right", "ArrowRight": "right", "D": "right",
  " ": "stop",
  "k": "TURN360",
};

// обработчик нажатия
document.addEventListener("keydown", e => {
  if (!kbEnabled) return;
  const cmd = keyMap[e.key];
  if (!cmd) return;

  if (!keysPressed.has(e.key)) keysPressed.add(e.key);

  const newCmd = Array.from(keysPressed).map(k => keyMap[k])[0] || "stop";
  if (newCmd !== currentCmd) {
    currentCmd = newCmd;
    sendESPCommand(currentCmd);
  }
});

// обработчик отпускания
document.addEventListener("keyup", e => {
  if (!kbEnabled) return;
  if (keysPressed.has(e.key)) keysPressed.delete(e.key);

  const newCmd = Array.from(keysPressed).map(k => keyMap[k])[0] || "stop";
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

  jctx.beginPath();
  jctx.moveTo(center.x-R, center.y); jctx.lineTo(center.x+R, center.y);
  jctx.moveTo(center.x, center.y-R); jctx.lineTo(center.x, center.y+R);
  jctx.strokeStyle = "#243042"; jctx.lineWidth = 1; jctx.stroke();

  jctx.beginPath();
  jctx.arc(knob.x, knob.y, knobR, 0, Math.PI*2);
  jctx.fillStyle = "#1b2330";
  jctx.fill();
  jctx.strokeStyle = "#3ea6ff";
  jctx.lineWidth = 2;
  jctx.stroke();
}

function joyCmdFromVec(dx, dy){
 const absDx = Math.abs(dx);
const absDy = Math.abs(dy);
if(absDx > absDy) return dx > 0 ? "right" : "left";
else return dy > 0 ? "forward" : "backward";

}

function setKnob(pos){
  const dx = pos.x - center.x, dy = pos.y - center.y;
  const mag = Math.hypot(dx, dy);
  if(mag>R){ const k=R/mag; knob.x=center.x+dx*k; knob.y=center.y+dy*k; }
  else knob={...pos};
  drawJoy();
  const cmd = joyCmdFromVec(dx, dy);
  if(cmd==="stop") stopESP(); else sendESPCommand(cmd);
}

function joyRelease(){ dragging=false; knob={...center}; drawJoy(); stopESP(); }
function joyPosFromEvent(e){
  const rect = joy.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX)-rect.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY)-rect.top;
  return {x, y};
}

joy.addEventListener("mousedown", e => { dragging=true; setKnob(joyPosFromEvent(e)); });
joy.addEventListener("mousemove", e => { if(dragging) setKnob(joyPosFromEvent(e)); });
document.addEventListener("mouseup", joyRelease);
joy.addEventListener("touchstart", e => { e.preventDefault(); dragging=true; setKnob(joyPosFromEvent(e)); }, {passive:false});
joy.addEventListener("touchmove", e => { e.preventDefault(); if(dragging) setKnob(joyPosFromEvent(e)); }, {passive:false});
joy.addEventListener("touchend", e => { e.preventDefault(); joyRelease(); }, {passive:false});

// ====== DEMO MODE ======
$("#demoToggle").onchange = () => { demo=$("#demoToggle").checked; log(`Demo: ${demo}`, "net"); };

// ====== INIT ======
window.addEventListener("load", () => {
  apiBase = $("#apiBase").value.trim(); 
  drawJoy();
  
  // Инициализация системы входа
  $("#loginSubmitBtn").onclick = login;
  
  // Ввод по Enter в полях ввода
  $("#loginInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") login();
  });
  
  $("#passwordInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") login();
  });
  
  // Проверяем сохранённую сессию
  const savedUser = localStorage.getItem("user");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    loadUserPanel();
  } else {
    showLoginModal();
  }
});
