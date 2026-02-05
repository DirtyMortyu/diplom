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

# === API для логина ===
@app.route("/api/login", methods=["POST"])
def login():
    print(request.json)
    data = request.json
    login_input = data.get("login")
    password_input = data.get("password")

    try:
        connection = pymysql.connect(**db_config)
    except Exception as e:
        return jsonify({"success": False, "error": f"Ошибка подключения к БД: {e}"}), 500

    try:
        with connection.cursor() as cursor:
            sql = """
                SELECT u.idUsers, u.login, u.Password, r.name as role_name 
                FROM Users u
                JOIN role r ON u.role_id = r.idrole
                WHERE u.login=%s LIMIT 1
            """
            cursor.execute(sql, (login_input,))
            user = cursor.fetchone()

            if user and user["Password"] == password_input:
                sql_log = """
                    INSERT INTO history_login (user_id, ipadress, success, user_agent)
                    VALUES (%s, %s, %s, %s)
                """
                cursor.execute(sql_log, (
                    user["idUsers"],
                    request.remote_addr,
                    1,
                    request.headers.get("User-Agent")
                ))
                connection.commit()
                return jsonify({"success": True, "role": user["role_name"], "login": user["login"]})
            else:
                sql_log = """
                    INSERT INTO history_login (user_id, ipadress, success, user_agent)
                    VALUES (%s, %s, %s, %s)
                """
                cursor.execute(sql_log, (
                    user["idUsers"] if user else None,
                    request.remote_addr,
                    0,
                    request.headers.get("User-Agent")
                ))
                connection.commit()
                return jsonify({"success": False, "message": "Неверный логин или пароль"}), 401
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        connection.close()

# === Заглушка для /api/move ===
@app.route("/api/move", methods=["POST"])
def move():
    try:
        data = request.get_json(force=True)  # Принудительно пытаемся получить JSON
    except:
        return jsonify({"success": False, "error": "Неверный формат данных"}), 400
    return jsonify({"success": True, "received": data})


if __name__ == "__main__":
    # Render передает порт через переменную окружения PORT
    port = int(os.environ.get("PORT", 5000))
    # host="0.0.0.0" обязателен, чтобы сервер был доступен извне
    app.run(host="0.0.0.0", port=port)