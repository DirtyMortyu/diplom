// ======= ИНИЦИАЛИЗАЦИЯ И ХЕЛПЕРЫ =======
const $ = sel => document.querySelector(sel);
const logBox = $("#log");

// ======= УЛЬТИМАТИВНЫЙ КОННЕКТ MQTT =======
const client = mqtt.connect('wss://rover-pgk.duckdns.org:9001/mqtt', {
    clientId: 'web_' + Math.random().toString(16).substr(2, 8),
    username: 'rover',       // если у тебя пароль нужен
    password: 'rover123',    // если у тебя пароль нужен
    reconnectPeriod: 1000    // авто-переподключение каждые 1с
});

client.on('connect', () => {
    console.log('✅ MQTT подключён по WSS!');
    log('MQTT подключён!', 'net');
    // Подписываемся на топик для диагностики
    client.subscribe('dirtymortyu/rover/cmd', (err) => {
        if (!err) {
            console.log('✅ Подписка на топик успешна');
            log('Подписка на топик OK', 'net');
        }
    });
});

client.on('message', (topic, message) => {
    console.log('📩 Получено из MQTT:', topic, message.toString());
    log(`Echo: ${message.toString()}`, 'net');
});

client.on('error', (err) => {
    console.error('❌ Ошибка MQTT:', err);
    log('Ошибка MQTT: ' + err.message, 'net');
});

client.on('offline', () => {
    console.warn('⚠️ MQTT отключён');
    log('MQTT отключён', 'net');
});

client.on('reconnect', () => {
    console.log('🔄 MQTT переподключение...');
});


function log(msg, cat = "misc") {
    const ts = new Date().toLocaleTimeString();
    if (cat === "motor" && !$("#logMotor")?.checked) return;
    if (cat === "net" && !$("#logNet")?.checked) return;
    const line = document.createElement("div");
    line.textContent = `[${ts}] ${msg}`;
    if (logBox) logBox.prepend(line);
}

if ($("#clearLog")) $("#clearLog").onclick = () => logBox.innerHTML = "";

// ======= ПЕРЕМЕННЫЕ СОСТОЯНИЯ =======
let currentUser = null;
let apiBase = $("#apiBase")?.value.trim() || ""; // Используем apiBase как в твоем коде
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

// ======= ГЛАВНАЯ ФУНКЦИЯ ОТПРАВКИ КОМАНД =======
async function sendESPCommand(cmd) {
    if (!currentUser) return;
    const espCmd = cmdMap[cmd] || "STOP";
    
    if (demo) {
        log(`[DEMO] Команда: ${espCmd}`, "motor");
        return;
    }

    if (!client.connected) {
        log("Ошибка: Нет связи с MQTT!", "net");
        return;
    }

    const topic = 'dirtymortyu/rover/cmd';
    client.publish(topic, espCmd, { qos: 0 });
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

// ======= АДМИНКА: ИСТОРИЯ ВХОДОВ =======
async function loadLoginHistory() {
    const tbody = $("#loginHistoryBody");
    if (!tbody) return;

    try {
        const response = await fetch(`${apiBase}/api/logs`);
        const logs = await response.json();

        tbody.innerHTML = "";
        logs.forEach(logItem => {
            const dateStr = logItem.created_at ? new Date(logItem.created_at).toLocaleString() : "---";
            const row = `
                <tr>
                    <td>${dateStr}</td>
                    <td>${logItem.ip || "Unknown"}</td>
                    <td>${logItem.login}</td>
                    <td style="color:${logItem.success ? '#4caf50' : '#f44336'}">
                        ${logItem.success ? 'Успех' : 'Ошибка'}
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

        // Обновляем время последнего обновления
        const updateTime = document.querySelector("#lastUpdateTime");
        if (updateTime) {
            updateTime.textContent = new Date().toLocaleTimeString();
        }
    } catch (e) {
        tbody.innerHTML = "<tr><td colspan='4'>Ошибка загрузки логов</td></tr>";
    }
}

// ======= АДМИНКА: ПОЛЬЗОВАТЕЛИ =======
async function loadUsers() {
    const list = $("#usersList");
    if (!list) return;
    list.innerHTML = "Загрузка...";
    
    try {
        const res = await fetch(`${apiBase}/api/users`);
        const users = await res.json();
        
        list.innerHTML = "";
        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "user-item";
            // ВАЖНО: u.id берем из бэкенда (убедись что бэкенд шлет id)
            div.innerHTML = `
                <span>
                    <strong>${u.login}</strong> 
                    <small style="color:#888">(${u.role})</small>
                </span>
                <div class="user-actions">
                    <button class="btn-edit" onclick="editUser('${u.id}', '${u.login}', '${u.role}')">✏️</button>
                    <button class="btn-delete" onclick="deleteUser('${u.id}')">🗑️</button>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        list.innerHTML = "Ошибка загрузки пользователей";
    }
}

// ======= МОДАЛЬНОЕ ОКНО ПОЛЬЗОВАТЕЛЯ =======
function showUserModal() {
    $("#userModal").style.display = "flex";
    $("#userModalTitle").innerText = "Новый пользователь";
    $("#editUserId").value = "";
    $("#newLogin").value = "";
    $("#newPass").value = "";
    $("#newRole").value = "user";
}

function editUser(id, login, role) {
    $("#userModal").style.display = "flex";
    $("#userModalTitle").innerText = "Редактирование";
    $("#editUserId").value = id;
    $("#newLogin").value = login;
    $("#newRole").value = role;
    $("#newPass").value = ""; // Пароль пустой, если не меняем
}

function closeUserModal() { $("#userModal").style.display = "none"; }

// ======= ФИНАЛЬНАЯ ФУНКЦИЯ СОХРАНЕНИЯ (БЕЗ ОШИБОК) =======
async function saveUser() {
    const userId = $("#editUserId").value;
    const username = $("#newLogin").value;
    const password = $("#newPass").value;
    const role = $("#newRole").value;

    if (!username) return alert("Введите логин!");

    const url = userId ? `${apiBase}/api/users/${userId}` : `${apiBase}/api/users`;
    const method = userId ? 'PUT' : 'POST';

    const userData = { login: username, password: password, role: role };

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });

        if (response.ok) {
            alert(userId ? "Данные обновлены!" : "Пользователь добавлен!");
            closeUserModal();
            loadUsers();
        } else {
            const errData = await response.json();
            alert("Ошибка: " + (errData.message || "Сервер отклонил запрос"));
        }
    } catch (error) {
        console.error("Ошибка сохранения:", error);
        alert("Не удалось связаться с сервером");
    }
}

async function deleteUser(id) {
    if(!confirm("Удалить пользователя?")) return;
    try {
        await fetch(`${apiBase}/api/users/${id}`, { method: 'DELETE' });
        loadUsers();
    } catch (e) { console.error(e); }
}

// Глобальная переменная для таймера
let historyUpdateTimer = null;

function loadUserPanel() {
    if (currentUser?.role === "admin") {
        $(".brand strong").textContent = "Admin Panel";
        $("#historyCard").style.display = "block";
        $("#userManageCard").style.display = "block";
        loadLoginHistory();
        loadUsers();

        // Автообновление истории входов каждые 10 секунд
        if (historyUpdateTimer) clearInterval(historyUpdateTimer);
        historyUpdateTimer = setInterval(() => {
            if (currentUser?.role === "admin") {
                loadLoginHistory();
            } else {
                clearInterval(historyUpdateTimer);
            }
        }, 10000); // 10 секунд

        log("Автообновление истории: ВКЛ (каждые 10 сек)", "misc");
    } else {
        $(".brand strong").textContent = "RoboPanel";
        if ($("#historyCard")) $("#historyCard").style.display = "none";
        if ($("#userManageCard")) $("#userManageCard").style.display = "none";

        // Останавливаем таймер для обычных пользователей
        if (historyUpdateTimer) {
            clearInterval(historyUpdateTimer);
            historyUpdateTimer = null;
        }
    }

    if (!$("#logoutBtn")) {
        const btn = document.createElement("button");
        btn.id = "logoutBtn";
        btn.className = "btn-logout";
        btn.textContent = "Выйти";
        btn.onclick = logout;
        $(".topbar .conn").appendChild(btn);
    }
}

// ======= УПРАВЛЕНИЕ КНОПКАМИ =======
document.querySelectorAll(".btn[data-cmd]").forEach(b => {
    if (b.dataset.cmd === "TURN360") {
        b.addEventListener("click", () => {
            sendESPCommand("TURN360");
            log("Поворот 360°", "motor");
        });
        return;
    }
    b.addEventListener("mousedown", () => sendESPCommand(b.dataset.cmd));
    b.addEventListener("mouseup", stopESP);
    b.addEventListener("mouseleave", stopESP); // Останавливаем если увели курсор
});



let kbEnabled = false;

$("#kbBtn").onclick = () => {
    kbEnabled = !kbEnabled;
    $("#kbBtn").textContent = kbEnabled ? "Клава: ВКЛ" : "Клава: ВЫКЛ";
    $("#kbStatus").textContent = kbEnabled ? "Режим: включен ✅" : "Режим: выключен";
    log(kbEnabled ? "Клавиатура ВКЛ" : "Клавиатура ВЫКЛ", "misc");
};



const keyMap = {

    "w": "forward", "ArrowUp": "forward",

    "s": "backward", "ArrowDown": "backward",

    "a": "left", "ArrowLeft": "left",

    "d": "right", "ArrowRight": "right",

    " ": "stop"

};



document.addEventListener("keydown", e => {

    if (!kbEnabled) return;

    if ((e.key === "r" || e.key === "R") && !e.repeat) {
        sendESPCommand("TURN360");
        log("Поворот 360° (клавиша R)", "motor");
        return;
    }

    if (keyMap[e.key] && currentCmd !== keyMap[e.key]) {

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



// Поддержка мыши
joy.addEventListener("mousedown", () => dragging = true);
document.addEventListener("mousemove", handleJoy);
document.addEventListener("mouseup", () => {
    dragging = false;
    knob = {...center};
    drawJoy();
    stopESP();
    currentCmd="STOP";
});

// Поддержка сенсорных экранов
joy.addEventListener("touchstart", (e) => {
    e.preventDefault();
    dragging = true;
    handleJoy(e);
});
document.addEventListener("touchmove", (e) => {
    e.preventDefault();
    handleJoy(e);
});
document.addEventListener("touchend", () => {
    dragging = false;
    knob = {...center};
    drawJoy();
    stopESP();
    currentCmd = "STOP";
});

window.onload = () => {
    if (typeof drawJoy === "function") drawJoy();
    if ($("#loginSubmitBtn")) $("#loginSubmitBtn").onclick = login;

    // Обработчик Demo Mode
    if ($("#demoToggle")) {
        $("#demoToggle").onchange = (e) => {
            demo = e.target.checked;
            log(demo ? "Demo Mode ВКЛ" : "Demo Mode ВЫКЛ", "misc");
        };
    }

    const streamImg = $("#stream");
    const streamOverlay = $("#streamOverlay");

    if ($("#streamStart")) {
        $("#streamStart").onclick = () => {
            // Стрим через Flask-бэкенд (HTTPS) — без Mixed Content
            const streamUrl = `${apiBase}/api/camera/stream`;
            streamImg.src = streamUrl;
            if (streamOverlay) streamOverlay.style.display = "none";
            log(`Видео: ${streamUrl}`, "net");

            streamImg.onerror = () => {
                if (streamOverlay) {
                    streamOverlay.style.display = "flex";
                    streamOverlay.textContent = "Нет сигнала";
                }
                log("Камера недоступна. Проверьте ESP32-CAM и сервер", "net");
            };
            streamImg.onload = () => {
                log("Видео подключено!", "net");
            };
        };
    }
    if ($("#streamStop")) {
        $("#streamStop").onclick = () => {
            streamImg.src = "";
            streamImg.onerror = null;
            if (streamOverlay) {
                streamOverlay.style.display = "flex";
                streamOverlay.textContent = "Нет сигнала";
            }
            log("Видео остановлено", "misc");
        };
    }

    // Миссии
    document.querySelectorAll("[data-mission]").forEach(btn => {
        btn.onclick = () => {
            const mission = btn.dataset.mission;
            if (mission === "square") {
                sendESPCommand("TURN360");
                log("Миссия: поворот 360°", "motor");
            }
        };
    });

    const saved = localStorage.getItem("user");
    if (saved) { currentUser = JSON.parse(saved); loadUserPanel(); }
    else showLoginModal();
};