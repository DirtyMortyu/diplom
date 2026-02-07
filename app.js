// ======= ИНИЦИАЛИЗАЦИЯ И ХЕЛПЕРЫ =======
const $ = sel => document.querySelector(sel);
const logBox = $("#log");


// Полностью замени блок создания mqttClient на этот:
// ======= УЛЬТИМАТИВНЫЙ КОННЕКТ =======
const mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    clientId: 'web_user_' + Math.random().toString(16).slice(2, 8),
    keepalive: 60,
    clean: true,
    connectTimeout: 20 * 1000,
    reconnectPeriod: 5000, // Увеличил интервал, чтобы брокер не считал нас спамом
    protocolVersion: 4 // Принудительно MQTT 3.1.1
});

mqttClient.on('connect', () => {
    console.log("✅ MQTT ПОДКЛЮЧЕН!");
    log("Связь с облаком установлена", "net");
    mqttClient.subscribe('dirtymortyu/rover/status');
});

mqttClient.on('reconnect', () => {
    console.log("🔄 Переподключение к MQTT...");
});

mqttClient.on('error', (err) => {
    console.error("❌ Ошибка MQTT:", err);
    log("Ошибка связи", "net");
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
// ======= АДМИНКА: ИСТОРИЯ ВХОДОВ =======
async function loadLoginHistory() {
    const tbody = $("#loginHistoryBody");
    tbody.innerHTML = "<tr><td colspan='4'>Загрузка...</td></tr>";

    try {
        // Здесь должен быть запрос к твоему серверу
        const response = await fetch(`${apiBase}/api/logs`);
        const logs = await response.json();

        tbody.innerHTML = "";
        logs.forEach(log => {
            const row = `
                <tr>
                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                    <td>${log.ip || "Unknown"}</td>
                    <td>${log.login}</td>
                    <td style="color:${log.success ? '#4caf50' : '#f44336'}">
                        ${log.success ? 'Успех' : 'Ошибка'}
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    } catch (e) {
        tbody.innerHTML = "<tr><td colspan='4'>Ошибка загрузки логов</td></tr>";
        console.error(e);
    }
}

// ======= АДМИНКА: ПОЛЬЗОВАТЕЛИ =======
async function loadUsers() {
    const list = $("#usersList");
    list.innerHTML = "Загрузка...";
    
    try {
        const res = await fetch(`${apiBase}/api/users`);
        const users = await res.json();
        
        list.innerHTML = "";
        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "user-item";
            div.innerHTML = `
                <span>
                    <strong>${u.login}</strong> 
                    <small style="color:#888">(${u.role})</small>
                </span>
                <div class="user-actions">
                    <button class="btn-edit" onclick="editUser('${u.idUsers}', '${u.login}', '${u.role}')">✏️</button>
                    <button class="btn-delete" onclick="deleteUser('${u.idUsers}')">🗑️</button>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        list.innerHTML = "Ошибка загрузки пользователей";
    }
}

// Удаление
async function deleteUser(idUsers) {
    if(!confirm("Удалить пользователя?")) return;
    await fetch(`${apiBase}/api/users/${idUsers}`, { method: 'DELETE' });
    loadUsers();
}

// Модальное окно и сохранение
function showUserModal() {
    $("#userModal").style.display = "flex";
    $("#userModalTitle").innerText = "Новый пользователь";
    $("#editUserId").value = "";
    $("#newLogin").value = "";
    $("#newPass").value = "";
}

function editUser(idUsers, login, role) {
    $("#userModal").style.display = "flex";
    $("#userModalTitle").innerText = "Редактирование";
    $("#editUserId").value = idUsers;
    $("#newLogin").value = login;
    $("#newRole").value = role;
    $("#newPass").value = ""; // Пароль не показываем, заполнять если менять
}

function closeUserModal() { $("#userModal").style.display = "none"; }

async function saveUser() {
    const idUsers = $("#editUserId").value;
    const login = $("#newLogin").value;
    const Password = $("#newPass").value;
    const role = $("#newRole").value;

    const url = id ? `${apiBase}/api/users/${idUsers}` : `${apiBase}/api/users`;
    const method = id ? 'PUT' : 'POST';

    await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, Password, role })
    });

    closeUserModal();
    loadUsers();
}

function loadUserPanel() {
    // Скрываем/показываем блоки в зависимости от роли
    if (currentUser?.role === "admin") {
        $(".brand strong").textContent = "Admin Panel";
        
        // Показываем админские блоки
        $("#historyCard").style.display = "block";
        $("#userManageCard").style.display = "block";
        
        // Загружаем данные
        loadLoginHistory();
        loadUsers();
    } else {
        // Обычный юзер
        $(".brand strong").textContent = "RoboPanel";
        $("#historyCard").style.display = "none";
        $("#userManageCard").style.display = "none";
    }

    // Кнопка выхода (как было)
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
