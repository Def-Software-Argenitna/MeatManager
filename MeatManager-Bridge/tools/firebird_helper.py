import datetime
import decimal
import json
import os
import sys

import fdb


def serialize(value):
    if value is None:
        return None
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat(sep=" ")
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("latin1")
    return value


def normalize_param(value):
    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            try:
                return datetime.datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            except ValueError:
                return value
    return value


def connect(config):
    db_file = config["dbFile"]
    db_dir = os.path.dirname(db_file)
    if db_dir:
        os.environ["PATH"] = f"{db_dir};{os.environ.get('PATH', '')}"
    qendra_dir = r"C:\Qendra"
    if os.path.isdir(qendra_dir):
        os.environ["PATH"] = f"{qendra_dir};{os.environ.get('PATH', '')}"

    return fdb.connect(
        dsn=db_file,
        user=config.get("user", "SYSDBA"),
        password=config.get("password", "masterkey"),
        charset=config.get("charset", "NONE"),
    )


def run_query(connection, sql, params):
    cursor = connection.cursor()
    try:
        cursor.execute(sql, [normalize_param(param) for param in (params or [])])
        if cursor.description:
            columns = [column[0] for column in cursor.description]
            rows = []
            for raw_row in cursor.fetchall():
                rows.append({columns[index]: serialize(value) for index, value in enumerate(raw_row)})
            return {"rows": rows}

        connection.commit()
        return {"rows": [], "affectedRows": cursor.rowcount}
    finally:
        try:
            cursor.close()
        except Exception:
            pass


def main():
    try:
        payload = json.load(sys.stdin)
        config = payload["config"]
        sql = payload.get("sql")
        params = payload.get("params", [])

        connection = connect(config)
        try:
            if payload.get("action") == "ping":
                result = run_query(connection, "SELECT CURRENT_TIMESTAMP AS NOW_TS FROM RDB$DATABASE", [])
            else:
                result = run_query(connection, sql, params)
        finally:
            connection.close()

        sys.stdout.write(json.dumps({"ok": True, **result}, ensure_ascii=False))
    except Exception as error:
        sys.stdout.write(
            json.dumps(
                {
                    "ok": False,
                    "error": str(error),
                    "errorType": error.__class__.__name__,
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
