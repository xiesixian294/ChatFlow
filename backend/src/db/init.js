import mysql from 'mysql2/promise'
import 'dotenv/config'

const DB_NAME = process.env.DB_NAME

async function ensureColumn(conn, table, column, definition) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  )
  if (Number(rows[0].c) === 0) {
    console.log(`Adding column ${table}.${column}...`)
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`)
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  })

  console.log(`Creating database \`${DB_NAME}\` if not exists...`)
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  )
  await conn.query(`USE \`${DB_NAME}\`;`)

  console.log('Creating tables...')
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '新对话',
      summary MEDIUMTEXT NULL COMMENT '历史对话 LLM 摘要',
      summary_up_to_message_id INT NOT NULL DEFAULT 0 COMMENT '已纳入摘要的最后一条消息 id',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await ensureColumn(
    conn,
    'conversations',
    'summary',
    'summary MEDIUMTEXT NULL COMMENT \'历史对话 LLM 摘要\''
  )
  await ensureColumn(
    conn,
    'conversations',
    'summary_up_to_message_id',
    'summary_up_to_message_id INT NOT NULL DEFAULT 0 COMMENT \'已纳入摘要的最后一条消息 id\''
  )

  await conn.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      role ENUM('user','assistant','system') NOT NULL,
      content MEDIUMTEXT NOT NULL,
      tool_calls JSON NULL COMMENT 'assistant 触发的工具调用记录（数组）',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_conversation (conversation_id),
      CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await ensureColumn(
    conn,
    'messages',
    'tool_calls',
    'tool_calls JSON NULL COMMENT \'assistant 触发的工具调用记录（数组）\''
  )

  await conn.query(`
    CREATE TABLE IF NOT EXISTS files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      conversation_id INT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(64) NOT NULL,
      ext VARCHAR(16) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      size_bytes INT NOT NULL,
      storage_path VARCHAR(512) NOT NULL,
      extracted_text MEDIUMTEXT NULL,
      char_count INT NOT NULL DEFAULT 0,
      token_estimate INT NOT NULL DEFAULT 0,
      status ENUM('pending','processing','ready','failed') NOT NULL DEFAULT 'pending',
      error_message VARCHAR(512) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_conv (conversation_id),
      CONSTRAINT fk_files_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_files_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS message_files (
      message_id INT NOT NULL,
      file_id INT NOT NULL,
      PRIMARY KEY (message_id, file_id),
      CONSTRAINT fk_mf_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_mf_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id VARCHAR(36) PRIMARY KEY,
      user_id INT NOT NULL,
      conversation_id INT NULL,
      original_name VARCHAR(255) NOT NULL,
      ext VARCHAR(16) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      size_bytes BIGINT NOT NULL,
      chunk_size INT NOT NULL,
      total_chunks INT NOT NULL,
      received_chunks JSON NOT NULL,
      status ENUM('uploading','merging','completed','expired','aborted') NOT NULL DEFAULT 'uploading',
      file_id INT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_status (user_id, status),
      INDEX idx_expires (expires_at),
      CONSTRAINT fk_upload_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_upload_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
      CONSTRAINT fk_upload_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `)

  console.log('Database initialized successfully.')
  await conn.end()
}

main().catch((err) => {
  console.error('DB init failed:', err)
  process.exit(1)
})
