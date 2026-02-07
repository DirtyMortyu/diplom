from flask import Flask, request, jsonify
import pymysql.cursors
from flask_cors import CORS
import os
import datetime

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

# Хелпер для получения соединения (чтобы не дублировать код)
def get_db_connection():
    return pymysql.connect(**db_config)

# ==========================================
# 1. ЛОГИН (Твой старый код + небольшие улучшения)
# ==========================================
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    login_input = data.get("login")
    password_input = data.get("password")

    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # Ищем пользователя и его роль
            sql = """
                SELECT u.idUsers, u.login, u.Password, r.name as role_name 
                FROM Users u
                JOIN role r ON u.role_id = r.idrole
                WHERE u.login=%s LIMIT 1
            """
            cursor.execute(sql, (login_input,))
            user = cursor.fetchone()

            success = False
            role_name = None
            
            # Проверка пароля
            if user and user["Password"] == password_input:
                success = True
                role_name = user["role_name"]

            # Запись логов
            # ВАЖНО: Предполагаем, что в history_login есть колонка timestamp или time_login
            # Если её нет, MySQL сам поставит время, если там стоит DEFAULT CURRENT_TIMESTAMP
            sql_log = """
                INSERT INTO history_login (user_id, ipadress, success, user_agent)
                VALUES (%s, %s, %s, %s)
            """
            cursor.execute(sql_log, (
                user["idUsers"] if user else None,
                request.remote_addr,
                1 if success else 0,
                request.headers.get("User-Agent")
            ))
            connection.commit()

            if success:
                return jsonify({"success": True, "role": role_name, "login": user["login"]})
            else:
                return jsonify({"success": False, "message": "Неверный логин или пароль"}), 401

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if connection:
            connection.close()

# ==========================================
# 2. АДМИНКА: ИСТОРИЯ ВХОДОВ
# ==========================================
@app.route("/api/logs", methods=["GET"])
def get_logs():
    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # Выбираем логи и джойним с таблицей юзеров, чтобы видеть логины
            # Используем COALESCE, чтобы если юзера нет (ошибка входа), писать 'Unknown'
            # ВАЖНО: Проверь, как называется колонка времени в твоей БД. Я использую timestamp.
            sql = """
                SELECT h.created_at, h.ipadress as ip, u.login, h.success
                FROM history_login h
                LEFT JOIN Users u ON h.user_id = u.idUsers
                ORDER BY h.created_at DESC LIMIT 50
            """
            cursor.execute(sql)
            logs = cursor.fetchall()
            
            # Преобразуем данные для JSON (datetime в строку)
            result = []
            for log in logs:
                result.append({
                    "created_at": str(log["created_at"]) if log["created_at"] else "",
                    "ip": log["ip"],
                    "login": log["login"] if log["login"] else "Неизвестный",
                    "success": bool(log["success"])
                })
            
            return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if connection: connection.close()

# ==========================================
# 3. АДМИНКА: СПИСОК ПОЛЬЗОВАТЕЛЕЙ
# ==========================================
@app.route("/api/users", methods=["GET"])
def get_users():
    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            sql = """
                SELECT u.idUsers as id, u.login, r.name as role 
                FROM Users u
                JOIN role r ON u.role_id = r.idrole
            """
            cursor.execute(sql)
            users = cursor.fetchall()
            return jsonify(users)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if connection: connection.close()

# ==========================================
# 4. АДМИНКА: ДОБАВИТЬ/РЕДАКТИРОВАТЬ ЮЗЕРА
# ==========================================
@app.route("/api/users", methods=["POST"])
@app.route("/api/users/<int:user_id>", methods=["PUT"])
def manage_user(user_id=None):
    data = request.json
    login_val = data.get("login")
    password_val = data.get("Password")
    role_name = data.get("role", "user") # 'admin' или 'user'

    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            # 1. Узнаем ID роли по её названию
            cursor.execute("SELECT idrole FROM role WHERE name=%s", (role_name,))
            role_row = cursor.fetchone()
            if not role_row:
                return jsonify({"success": False, "message": "Роль не найдена"}), 400
            role_id = role_row["idrole"]

            # 2. Логика для PUT (Обновление)
            if request.method == "PUT" and user_id:
                if password_val: # Если прислали пароль — меняем всё
                    sql = "UPDATE Users SET login=%s, Password=%s, role_id=%s WHERE idUsers=%s"
                    cursor.execute(sql, (login_val, password_val, role_id, user_id))
                else: # Если пароля нет — меняем только роль и логин
                    sql = "UPDATE Users SET login=%s, role_id=%s WHERE idUsers=%s"
                    cursor.execute(sql, (login_val, role_id, user_id))

            # 3. Логика для POST (Создание)
            else:
                if not password_val:
                    return jsonify({"success": False, "message": "Нужен пароль"}), 400
                sql = "INSERT INTO Users (login, Password, role_id) VALUES (%s, %s, %s)"
                cursor.execute(sql, (login_val, password_val, role_id))
            
            connection.commit()
            return jsonify({"success": True})
            
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if connection: connection.close()

# ==========================================
# 5. АДМИНКА: УДАЛИТЬ ЮЗЕРА
# ==========================================
@app.route("/api/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    connection = None
    try:
        connection = get_db_connection()
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM Users WHERE idUsers=%s", (user_id,))
            connection.commit()
            return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        if connection: connection.close()

# ==========================================
# ЗАПУСК
# ==========================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)