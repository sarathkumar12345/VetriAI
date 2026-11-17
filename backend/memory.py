
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "vetriai_memory.db"


def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(DB_PATH)


def save_memory(key: str, value: str):
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO user_memory (memory_key, memory_value)
            VALUES (?, ?)
            ON CONFLICT(memory_key)
            DO UPDATE SET
                memory_value = excluded.memory_value,
                updated_at = CURRENT_TIMESTAMP
            """,
            (key, value)
        )


def get_all_memories():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT memory_key, memory_value FROM user_memory"
        ).fetchall()
    return dict(rows)


def get_memory(key: str):
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT memory_key, memory_value, created_at, updated_at
            FROM user_memory
            WHERE memory_key = ?
            """,
            (key,)
        ).fetchone()

    if row is None:
        return None

    return {
        "key": row[0],
        "value": row[1],
        "created_at": row[2],
        "updated_at": row[3],
    }


def delete_memory(key: str):
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM user_memory WHERE memory_key = ?",
            (key,)
        )

        return cursor.rowcount > 0


def clear_all_memories():
    with get_connection() as conn:
        conn.execute("DELETE FROM user_memory")




def save_conversation(session_id: str, role: str, content: str):
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO conversation_memory (session_id, role, content)
            VALUES (?, ?, ?)
            """,
            (session_id, role, content)
        )

        if role == "user":
            conn.execute(
                """
                INSERT OR IGNORE INTO chat_metadata (session_id, title)
                VALUES (?, ?)
                """,
                (session_id, content[:35])
            )


def get_recent_conversation(session_id: str, limit: int = 8):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content
            FROM conversation_memory
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit)
        ).fetchall()

    return [
        {"role": role, "content": content}
        for role, content in reversed(rows)
    ]


def get_all_conversations():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                cm.session_id,
                COALESCE(
                    metadata.title,
                    (
                        SELECT content
                        FROM conversation_memory AS first_msg
                        WHERE first_msg.session_id = cm.session_id
                          AND first_msg.role = 'user'
                        ORDER BY first_msg.id ASC
                        LIMIT 1
                    ),
                    'New Chat'
                ) AS title,
                MAX(cm.id) AS last_message_id
            FROM conversation_memory AS cm
            LEFT JOIN chat_metadata AS metadata
                ON metadata.session_id = cm.session_id
            GROUP BY cm.session_id
            ORDER BY last_message_id DESC
            """
        ).fetchall()

    return [
        {
            "session_id": row[0],
            "title": row[1]
        }
        for row in rows
    ]


def get_conversation_messages(session_id: str):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content
            FROM conversation_memory
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,)
        ).fetchall()

    return [
        {"role": role, "content": content}
        for role, content in rows
    ]


def rename_conversation(session_id: str, title: str):
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM conversation_memory WHERE session_id = ? LIMIT 1",
            (session_id,)
        ).fetchone()

        if not exists:
            return False

        conn.execute(
            """
            INSERT INTO chat_metadata (session_id, title)
            VALUES (?, ?)
            ON CONFLICT(session_id)
            DO UPDATE SET title = excluded.title
            """,
            (session_id, title)
        )

    return True


def delete_conversation(session_id: str):
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM conversation_memory WHERE session_id = ?",
            (session_id,)
        )

        conn.execute(
            "DELETE FROM chat_metadata WHERE session_id = ?",
            (session_id,)
        )
