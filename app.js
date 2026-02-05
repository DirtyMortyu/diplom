// ======= ИНИЦИАЛИЗАЦИЯ И ХЕЛПЕРЫ =======
const $ = sel => document.querySelector(sel);
const logBox = $("#log");

// Подключаемся к брокеру через защищенный WebSocket (WSS)
// ======= ИСПРАВЛЕННЫЙ MQTT (ПОРТ 443) =======
// Самый живучий вариант подключения
const mqttClient = mqtt.connect('wss://broker.emqx.io:443/mqtt', {
    protocol: 'wss',
    path: '/mqtt',
    clientId: 'web_client_' + Math.random().toString(16).slice(2, 8), // Уникальный ID, чтобы брокер не кикал
    rejectUnauthorized: false, // Игнорировать проблемы с сертификатами если они есть
    reconnectPeriod: 2000,
    connectTimeout: 30 * 1000,
});

mqttClient.on('connect', () => {
    console.log("✅ MQTT ПОДКЛЮЧЕН!");
    log("Связь с облаком установлена", "net");
});

mqttClient.on('error', (err) => {
    console.log("❌ Ошибка MQTT:", err);
    log("Сбой связи", "net");
});

mqttClient.on('close', () => {
    console.log("⚠️ Соединение закрыто брокером");
});

function log(msg, cat = "misc") {
    const ts = new Date().toLocaleTimeString();
    if (cat === "motor" && !$("#logMotor")?.checked) return;
    if (cat === "net" && !$("#logNet")?.checked) return;
    const line = document.createElement("div");
    line.textContent = `[${ts}] ${msg}`;
    logBox.prepend(line);
}

$("#clearLog").onclick = () => logBox.innerHTML = "";

// ======= ПЕРЕМЕННЫЕ СОСТОЯНИЯ =======
let currentUser = null;
let apiBase = $("#apiBase")?.value.trim();
let demo = false;
let currentCmd = "STOP";

const cmdMap = {
    forward: "FORWARD",
    backward: "BACKWARD",
    left: "LEFT",
    right: "RIGHT",
    stop: "STOP",
    TURN360: "TURN360"
};

// ======= ГЛАВНАЯ ФУНКЦИЯ ОТПРАВКИ =======
async function sendESPCommand(cmd) {
    if (!currentUser) return;
    
    const espCmd = cmdMap[cmd] || "STOP";
    
    if (demo) {
        log(`[DEMO] Команда: ${espCmd}`, "motor");
        return;
    }

    if (!mqttClient.connected) {
        log("Ошибка: Нет связи с брокером!", "net");
        return;
    }

    const topic = 'dirtymortyu/rover/cmd';
    mqttClient.publish(topic, espCmd, { qos: 0 });
    log(`Облако -> ${espCmd}`, "motor");
}

const stopESP = () => sendESPCommand("stop");

// ======= АВТОРИЗАЦИЯ =======
function showLoginModal() { $("#loginModal").style.display = "flex"; }
function hideLoginModal() { $("#loginModal").style.display = "none"; }

async function login() {
    const loginInput = $("#loginInput").value.trim();
    const password = $("#passwordInput").value;
    apiBase = $("#apiBase").value.trim();

    if (!loginInput || !password) return alert("Введите данные!");

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
            log(`Вход: ${data.role}`, "misc");
        } else {
            alert(data.message);
        }
    } catch (err) {
        log("Ошибка сервера авторизации", "net");
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem("user");
    location.reload();
}

function loadUserPanel() {
    const mainContent = $(".grid");
    if (currentUser?.role === "user") {
        $(".brand strong").textContent = "RoboPanel - User";
        $(".status").style.display = "none";
        $(".tasks").style.display = "none";
        $(".logs").style.display = "none";
        mainContent.style.gridTemplateColumns = "1fr 1fr";
    }
    if (!$("#logoutBtn")) {
        const btn = document.createElement("button");
        btn.id = "logoutBtn";
        btn.textContent = "Выйти";
        btn.onclick = logout;
        $(".topbar .conn").appendChild(btn);
    }
}

// ======= УПРАВЛЕНИЕ (КНОПКИ И КЛАВИАТУРА) =======
document.querySelectorAll(".btn").forEach(b => {
    b.addEventListener("mousedown", () => sendESPCommand(b.dataset.cmd));
    b.addEventListener("mouseup", stopESP);
});

let kbEnabled = false;
$("#kbBtn").onclick = () => {
    kbEnabled = !kbEnabled;
    $("#kbBtn").textContent = kbEnabled ? "Клава: ВКЛ" : "Клава: ВЫКЛ";
};

const keyMap = { 
    "w": "forward", "ArrowUp": "forward", 
    "s": "backward", "ArrowDown": "backward", 
    "a": "left", "ArrowLeft": "left", 
    "d": "right", "ArrowRight": "right", 
    " ": "stop" 
};

document.addEventListener("keydown", e => {
    if (kbEnabled && keyMap[e.key] && currentCmd !== keyMap[e.key]) {
        currentCmd = keyMap[e.key];
        sendESPCommand(currentCmd);
    }
});

document.addEventListener("keyup", e => {
    if (kbEnabled && keyMap[e.key]) {
        currentCmd = "STOP";
        stopESP();
    }
});

// ======= ДЖОЙСТИК =======
const joy = $("#joystick"), jctx = joy.getContext("2d");
const center = {x: joy.width/2, y: joy.height/2};
let dragging = false, knob = {...center};

function drawJoy() {
    jctx.clearRect(0,0,joy.width,joy.height);
    jctx.beginPath(); jctx.arc(center.x, center.y, 80, 0, Math.PI*2);
    jctx.strokeStyle = "#2a3140"; jctx.stroke();
    jctx.beginPath(); jctx.arc(knob.x, knob.y, 25, 0, Math.PI*2);
    jctx.fillStyle = "#3ea6ff"; jctx.fill();
}

function handleJoy(e) {
    if (!dragging) return;
    const rect = joy.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    const dx = x - center.x, dy = y - center.y;
    const mag = Math.hypot(dx, dy);
    
    knob = mag > 80 ? {x: center.x + dx*80/mag, y: center.y + dy*80/mag} : {x, y};
    drawJoy();

    let newCmd = "stop";
    if (mag > 30) {
        if (Math.abs(dx) > Math.abs(dy)) newCmd = dx > 0 ? "right" : "left";
        else newCmd = dy < 0 ? "forward" : "backward";
    }
    if (newCmd !== currentCmd) {
        currentCmd = newCmd;
        sendESPCommand(currentCmd);
    }
}

joy.addEventListener("mousedown", () => dragging = true);
document.addEventListener("mousemove", handleJoy);
document.addEventListener("mouseup", () => { dragging = false; knob = {...center}; drawJoy(); stopESP(); currentCmd="STOP"; });

// ======= СТАРТ =======
window.onload = () => {
    drawJoy();
    if ($("#loginSubmitBtn")) $("#loginSubmitBtn").onclick = login;
    const saved = localStorage.getItem("user");
    if (saved) { currentUser = JSON.parse(saved); loadUserPanel(); } 
    else showLoginModal();
};
