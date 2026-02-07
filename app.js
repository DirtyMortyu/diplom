// ======= ИНИЦИАЛИЗАЦИЯ И ХЕЛПЕРЫ =======
const $ = sel => document.querySelector(sel);
const logBox = $("#log");

// ======= УЛЬТИМАТИВНЫЙ КОННЕКТ MQTT =======
const mqttClient = mqtt.connect('wss://t1c0c0c1.ala.eu-central-1.emqxsl.com:8084/mqtt', {
    clientId: 'web_' + Math.random().toString(16).slice(2, 8),
    username: 'rover',    
    password: 'rover123', 
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
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

    if (!mqttClient.connected) {
        log("Ошибка: Нет связи с MQTT!", "net");
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
    if (!tbody) return;
    tbody.innerHTML = "<tr><td colspan='4'>Загрузка...</td></tr>";

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

function loadUserPanel() {
    if (currentUser?.role === "admin") {
        $(".brand strong").textContent = "Admin Panel";
        $("#historyCard").style.display = "block";
        $("#userManageCard").style.display = "block";
        loadLoginHistory();
        loadUsers();
    } else {
        $(".brand strong").textContent = "RoboPanel";
        if ($("#historyCard")) $("#historyCard").style.display = "none";
        if ($("#userManageCard")) $("#userManageCard").style.display = "none";
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

// ======= УПРАВЛЕНИЕ =======
document.querySelectorAll(".btn").forEach(b => {
    b.addEventListener("mousedown", () => sendESPCommand(b.dataset.cmd));
    b.addEventListener("mouseup", stopESP);
});

// Клавиатура, Джойстик и прочее (оставлено без изменений)
// ... (твой код джойстика и старта окна) ...

window.onload = () => {
    if (typeof drawJoy === "function") drawJoy();
    if ($("#loginSubmitBtn")) $("#loginSubmitBtn").onclick = login;
    const saved = localStorage.getItem("user");
    if (saved) { currentUser = JSON.parse(saved); loadUserPanel(); } 
    else showLoginModal();
};