import mysql from "mysql2/promise";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// Read connection settings from the site's environment variables.
// DB_* is the primary naming; TIDB_* is kept as a fallback for older setups.
function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value.trim();
  }
  return undefined;
}

function getDbConfig() {
  const config = {
    host: env("DB_HOST", "TIDB_HOST"),
    port: env("DB_PORT", "TIDB_PORT"),
    user: env("DB_USER", "TIDB_USER"),
    password: env("DB_PASSWORD", "TIDB_PASSWORD"),
    database: env("DB_NAME", "DB_DATABASE", "TIDB_DATABASE")
  };

  // No hardcoded fallbacks: Netlify's secrets scanning fails the build when
  // an environment variable's value appears literally in the source code.
  const envNames = {
    host: "DB_HOST",
    port: "DB_PORT",
    user: "DB_USER",
    password: "DB_PASSWORD",
    database: "DB_NAME"
  };
  const missing = Object.keys(envNames).filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Ma'lumotlar bazasi sozlanmagan: ${missing
        .map((k) => envNames[k])
        .join(", ")} muhit o'zgaruvchisi topilmadi.`
    );
  }
  config.port = Number(config.port);
  return config;
}

function getPool() {
  return mysql.createPool({
    ...getDbConfig(),
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 5
  });
}

// Columns the app needs. Missing ones are added to an existing table
// (additive only — nothing is dropped or rewritten).
const REQUIRED_COLUMNS = {
  title: "VARCHAR(255) NOT NULL DEFAULT ''",
  content: "TEXT NULL",
  created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
};

let schemaReady = false;

async function ensureSchema(pool) {
  if (schemaReady) return;

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT '',
      content TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notes'`
  );
  const existing = new Set(cols.map((c) => c.COLUMN_NAME.toLowerCase()));

  for (const [name, definition] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existing.has(name)) {
      await pool.execute(`ALTER TABLE notes ADD COLUMN ${name} ${definition}`);
    }
  }

  schemaReady = true;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  let pool;
  try {
    pool = getPool();

    await ensureSchema(pool);

    if (event.httpMethod === "GET") {
      const [rows] = await pool.query(
        "SELECT id, title, COALESCE(content, '') AS content, created_at FROM notes ORDER BY id DESC"
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
