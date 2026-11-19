import mysql from "mysql2/promise";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function getPool() {
  return mysql.createPool({
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE || "test",
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 5
  });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  let pool;
  try {
    pool = getPool();

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    if (event.httpMethod === "GET") {
      const [rows] = await pool.query(
        "SELECT id, title, content, created_at FROM notes ORDER BY id DESC"
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ notes: rows })
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const title = (body.title || "").trim();
      const content = (body.content || "").trim();

      if (!title || !content) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Sarlavha va matn bo‘sh bo‘lmasligi kerak." })
        };
      }

      const [result] = await pool.execute(
        "INSERT INTO notes (title, content) VALUES (?, ?)",
        [title, content]
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ id: result.insertId, title, content })
      };
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "ID ko‘rsatilmadi." })
        };
      }

      await pool.execute("DELETE FROM notes WHERE id = ?", [id]);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ deleted: true, id })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Ruxsat etilmagan metod." })
    };
  } catch (err) {
    console.error("API error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Server xatosi yuz berdi." })
    };
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}
