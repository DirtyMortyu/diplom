from flask import Flask, request, jsonify
import pymysql.cursors
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

# === Настройки подключения к БД ===
db_config = {
    "host": os.environ.get("DB_HOST", "91.222.238.6"),
    "user": os.environ.get("DB_USER", "rover_user"),
    "password": os.environ.get("DB_PASSWORD", "strong_password123"),
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

            success = user and user["Password"] == password_input
            
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
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if connection: connection.close()

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
                # ИСПРАВЛЕНО: Изменено idrole на role_id (согласно скриншоту)
                if password_val:
                    sql = "UPDATE Users SET login=%s, Password=%s, role_id=%s WHERE idUsers=%s"
                    cursor.execute(sql, (login_val, password_val, role_id, user_id))
                else:
                    sql = "UPDATE Users SET login=%s, role_id=%s WHERE idUsers=%s"
                    cursor.execute(sql, (login_val, role_id, user_id))
            else:
                if not password_val:
                    return jsonify({"success": False, "message": "Нужен пароль"}), 400
                # ИСПРАВЛЕНО: Изменено idrole на role_id
                sql = "INSERT INTO Users (login, Password, role_id) VALUES (%s, %s, %s)"
                cursor.execute(sql, (login_val, password_val, role_id))
            
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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)