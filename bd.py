from flask import Flask, request, jsonify, Response
import pymysql.cursors
from flask_cors import CORS
import os
import paho.mqtt.client as mqtt
import threading
import time
import bcrypt

app = Flask(__name__)
CORS(app)

# ========== MQTT для камеры ==========
MQTT_BROKER = "rover-pgk.duckdns.org"
MQTT_PORT = 1883
MQTT_USER = "rover"
MQTT_PASSWORD = "rover123"
MQTT_CAMERA_TOPIC = "dirtymortyu/rover/camera"

# Глобальные переменные для кадра
latest_frame = None
frame_lock = threading.Lock()
frame_timestamp = 0
frame_event = threading.Event()  # сигнал о новом кадре

# === Настройки подключения к БД ===
db_config = {
    "host": os.environ.get("DB_HOST", "91.222.238.6"),
    "user": os.environ.get("DB_USER", "rover_user"),
    "password": os.environ.get("DB_PASSWORD", "root123"),
    "database": os.environ.get("DB_NAME", "rover_db"),
    "port": 3306,
    "cursorclass": pymysql.cursors.DictCursor
}

def get_db_connection():
    return pymysql.connect(**db_config)

def get_client_ip():
    """Получает реальный IP клиента с учетом прокси"""
    # Проверяем заголовки прокси (Nginx, Cloudflare, etc)
    if request.headers.get('X-Forwarded-For'):
        # X-Forwarded-For может содержать несколько IP через запятую
        # Берем первый (реальный клиент)
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    else:
        return request.remote_addr

# 1. ЛОГИН
@app.route("/api/login", methods=["POST"])
def login():
    try:
        data = request.json or {}
        login_input = data.get("login", "").strip()
        password_input = data.get("password", "")

        # Валидация входных данных
        if not login_input or not password_input:
            return jsonify({"success": False, "message": "Логин и пароль обязательны"}), 400

        if len(login_input) > 50:
            return jsonify({"success": False, "message": "Логин слишком длинный"}), 400

        connection = None
        try:
            connection = get_db_connection()
            with connection.cursor() as cursor:
                sql = """
                    SELECT u.idUsers, u.login, u.Password, r.name as role_name 
                    FROM Users u
                    JOIN role r ON u.role_id = r.idrole
                    WHERE u.login=%s LIMIT 1
                """
                cursor.execute(sql, (login_input,))
                user = cursor.fetchone()

                success = bool(user and bcrypt.checkpw(
                    password_input.encode("utf-8"),
                    user["Password"].encode("utf-8")
                ))
                
                # Запись лога (используем правильное имя user_id и ipadress)
                sql_log = "INSERT INTO history_login (user_id, ipadress, success, user_agent) VALUES (%s, %s, %s, %s)"
                cursor.execute(sql_log, (
                    user["idUsers"] if user else None,
                    get_client_ip(),  # Используем функцию для получения реального IP
                    1 if success else 0,
                    request.headers.get("User-Agent")
                ))
                connection.commit()

                if success:
                    return jsonify({"success": True, "role": user["role_name"], "login": user["login"]})
                return jsonify({"success": False, "message": "Неверный логин или пароль"}), 401
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"success": False, "error": str(e)}), 500
        finally:
            if connection: connection.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
                

# 2. ИСТОРИЯ ВХОДОВ
@app.route("/api/logs", methods=["GET"])
def get_logs():
    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # Используем h.created_at из вашего скриншота
            sql = """
                SELECT h.created_at, h.ipadress as ip, u.login, h.success
                FROM history_login h
                LEFT JOIN Users u ON h.user_id = u.idUsers
                ORDER BY h.created_at DESC LIMIT 50
            """
            cursor.execute(sql)
            logs = cursor.fetchall()
            
            for log in logs:
                log["created_at"] = str(log["created_at"])
                log["success"] = bool(log["success"])
                if not log["login"]: log["login"] = "Неизвестный"
            
            return jsonify(logs)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if connection: connection.close()

# 3. СПИСОК ПОЛЬЗОВАТЕЛЕЙ
@app.route("/api/users", methods=["GET"])
def get_users():
    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # ИСПРАВЛЕНО: Добавлена колонка role_id в JOIN
            sql = """
                SELECT u.idUsers as id, u.login, r.name as role 
                FROM Users u
                JOIN role r ON u.role_id = r.idrole
            """
            cursor.execute(sql)
            return jsonify(cursor.fetchall())
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if connection: connection.close()

# 4. СОЗДАНИЕ / РЕДАКТИРОВАНИЕ
@app.route("/api/users", methods=["POST"])
@app.route("/api/users/<int:user_id>", methods=["PUT"])
def manage_user(user_id=None):
    data = request.json or {}
    login_val = data.get("login", "").strip()
    # Проверяем и Password и password на случай разного фронтенда
    password_val = data.get("password") or data.get("Password")
    role_name = data.get("role", "user")

    # Валидация
    if not login_val:
        return jsonify({"success": False, "message": "Логин обязателен"}), 400

    if len(login_val) > 50:
        return jsonify({"success": False, "message": "Логин слишком длинный"}), 400

    if role_name not in ["user", "admin"]:
        return jsonify({"success": False, "message": "Недопустимая роль"}), 400

    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # Получаем id роли
            cursor.execute("SELECT idrole FROM role WHERE name=%s", (role_name,))
            role_row = cursor.fetchone()
            if not role_row:
                return jsonify({"success": False, "message": f"Роль {role_name} не найдена"}), 400
            role_id = role_row["idrole"]

            if request.method == "PUT" and user_id:
                if password_val:
                    hashed = bcrypt.hashpw(password_val.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                    sql = "UPDATE Users SET login=%s, Password=%s, role_id=%s WHERE idUsers=%s"
                    cursor.execute(sql, (login_val, hashed, role_id, user_id))
                else:
                    sql = "UPDATE Users SET login=%s, role_id=%s WHERE idUsers=%s"
                    cursor.execute(sql, (login_val, role_id, user_id))
            else:
                if not password_val:
                    return jsonify({"success": False, "message": "Нужен пароль"}), 400
                hashed = bcrypt.hashpw(password_val.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                sql = "INSERT INTO Users (login, Password, role_id) VALUES (%s, %s, %s)"
                cursor.execute(sql, (login_val, hashed, role_id))
            
            connection.commit()
            return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if connection: connection.close()

# 5. УДАЛЕНИЕ
@app.route("/api/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    if not user_id or user_id <= 0:
        return jsonify({"success": False, "message": "Некорректный ID"}), 400

    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # Проверяем что пользователь существует
            cursor.execute("SELECT idUsers FROM Users WHERE idUsers=%s", (user_id,))
            if not cursor.fetchone():
                return jsonify({"success": False, "message": "Пользователь не найден"}), 404

            cursor.execute("DELETE FROM Users WHERE idUsers=%s", (user_id,))
            connection.commit()
            return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if connection: connection.close()

# ========== MQTT обработчики ==========
def on_mqtt_connect(client, userdata, flags, rc):
    """Callback при подключении к MQTT"""
    if rc == 0:
        print(f"✅ MQTT Connected to {MQTT_BROKER}")
        client.subscribe(MQTT_CAMERA_TOPIC)
        print(f"📡 Subscribed to: {MQTT_CAMERA_TOPIC}")
    else:
        print(f"❌ MQTT Connection failed with code {rc}")

def on_mqtt_message(client, userdata, msg):
    """Callback при получении сообщения из MQTT — сырой JPEG без Base64"""
    global latest_frame, frame_timestamp
    try:
        with frame_lock:
            latest_frame = bytes(msg.payload)
            frame_timestamp = time.time()

        frame_event.set()  # будим generate() немедленно
        print(f"📸 Frame received: {len(msg.payload)} bytes")
    except Exception as e:
        print(f"❌ Error storing frame: {e}")

def start_mqtt_client():
    """Запускает MQTT клиент в отдельном потоке"""
    mqtt_client = mqtt.Client(client_id="Flask_Camera_" + str(os.getpid()))
    mqtt_client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    mqtt_client.on_connect = on_mqtt_connect
    mqtt_client.on_message = on_mqtt_message

    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_forever()
    except Exception as e:
        print(f"❌ MQTT Client error: {e}")
        time.sleep(5)
        start_mqtt_client()  # Переподключение при ошибке

# Запускаем MQTT клиент в отдельном потоке
mqtt_thread = threading.Thread(target=start_mqtt_client, daemon=True)
mqtt_thread.start()
print("🚀 MQTT client started in background thread")

# ========== API Endpoint для камеры ==========
@app.route("/api/camera/stream")
def camera_stream():
    """MJPEG стрим — кадр отправляется сразу при получении из MQTT"""
    def generate():
        last_sent_timestamp = 0

        while True:
            # Ждём нового кадра (таймаут 5 сек — чтобы не зависнуть)
            frame_event.wait(timeout=5.0)
            frame_event.clear()

            with frame_lock:
                current_frame = latest_frame
                current_timestamp = frame_timestamp

            if current_frame and current_timestamp > last_sent_timestamp:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + current_frame + b'\r\n')
                last_sent_timestamp = current_timestamp

    return Response(generate(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/camera/status")
def camera_status():
    """Статус камеры"""
    with frame_lock:
        has_frame = latest_frame is not None
        last_update = time.time() - frame_timestamp if frame_timestamp > 0 else None

    return jsonify({
        "connected": has_frame,
        "last_frame_ago": last_update,
        "mqtt_topic": MQTT_CAMERA_TOPIC
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)