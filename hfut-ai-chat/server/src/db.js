const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

// 使用连接池管理 MySQL 连接，避免每次请求都重复创建连接。
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root123456",
  database: process.env.DB_NAME || "hfut_ai_chat",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

// 统一执行 SQL 并返回查询结果，供上层业务函数复用。
async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// 为兼容已有数据库，缺失字段时在启动阶段自动补齐。
async function ensureColumn(tableName, columnName, definition) {
  const rows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  if (!rows[0]) {
    await query(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

// 启动时自动补齐业务表结构，方便本地首次运行。
async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS students (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      student_id VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(128) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS chats (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      chat_id VARCHAR(64) NOT NULL UNIQUE,
      user_id BIGINT NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '新对话',
      summary MEDIUMTEXT NULL,
      summary_message_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_chats_user FOREIGN KEY (user_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      chat_id VARCHAR(64) NOT NULL,
      role ENUM('system', 'user', 'assistant') NOT NULL,
      content MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_messages_chat_created (chat_id, created_at),
      CONSTRAINT fk_messages_chat FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE
    )
  `);

  await ensureColumn("chats", "summary", "summary MEDIUMTEXT NULL AFTER title");
  await ensureColumn(
    "chats",
    "summary_message_count",
    "summary_message_count INT NOT NULL DEFAULT 0 AFTER summary"
  );
}

// 按学号查询学生，用于登录和注册时的存在性检查。
async function findStudentByStudentId(studentId) {
  const rows = await query(
    `SELECT id, student_id AS studentId, name, password_hash AS passwordHash
     FROM students WHERE student_id = ? LIMIT 1`,
    [studentId]
  );
  return rows[0] || null;
}

// 按主键查询学生，用于 JWT 校验后的用户回查。
//在mysql数据库当中根据id查询学生信息
async function findStudentById(id) {
  const rows = await query(
    `SELECT id, student_id AS studentId, name, password_hash AS passwordHash
     FROM students WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// 创建新学生账号，密码会先哈希再入库。
async function createStudent({ studentId, name, password }) {
  const passwordHash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO students (student_id, name, password_hash) VALUES (?, ?, ?)`,
    [studentId, name, passwordHash]
  );
  return findStudentByStudentId(studentId);
}

// 登录时对比明文密码和数据库中的哈希值。
async function verifyStudentPassword(student, password) {
  return bcrypt.compare(password, student.passwordHash);
}

// 获取已有会话，不存在则创建；若会话归属不匹配则直接拒绝访问。
async function getOrCreateChat({ chatId, userId, title }) {
  const rows = await query(
    `SELECT chat_id AS chatId, user_id AS userId, title,
            summary, summary_message_count AS summaryMessageCount
     FROM chats WHERE chat_id = ? LIMIT 1`,
    [chatId]
  );
  if (rows[0]) {
    if (rows[0].userId !== userId) {
      throw new Error("FORBIDDEN_CHAT");
    }
    return rows[0];
  }

  await query(
    `INSERT INTO chats (chat_id, user_id, title) VALUES (?, ?, ?)`,
    [chatId, userId, title || "新对话"]
  );
  return {
    chatId,
    userId,
    title: title || "新对话",
    summary: null,
    summaryMessageCount: 0,
  };
}

// 更新会话的最近活跃时间；新标题存在时一并更新标题。
async function touchChat(chatId, title) {
  if (title) {
    await query(
      `UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
      [title, chatId]
    );
    return;
  }
  await query(
    `UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
    [chatId]
  );
}

// 获取当前用户的会话列表，按最近更新时间倒序展示。
async function listChatsByUserId(userId) {
  return query(
    `SELECT chat_id AS chatId, title, summary, summary_message_count AS summaryMessageCount,
            updated_at AS updatedAt, created_at AS createdAt
     FROM chats WHERE user_id = ?
     ORDER BY updated_at DESC, id DESC`,
    [userId]
  );
}

// 读取会话摘要元数据，用于组装压缩后的上下文。
async function getChatContextState(chatId, userId) {
  const rows = await query(
    `SELECT chat_id AS chatId, summary, summary_message_count AS summaryMessageCount
     FROM chats WHERE chat_id = ? AND user_id = ? LIMIT 1`,
    [chatId, userId]
  );
  return rows[0] || null;
}

// 先校验会话归属，再按时间顺序返回完整消息历史。
async function listMessagesByChatId(chatId, userId) {
  const chatRows = await query(
    `SELECT chat_id AS chatId FROM chats WHERE chat_id = ? AND user_id = ? LIMIT 1`,
    [chatId, userId]
  );
  if (!chatRows[0]) {
    return null;
  }

  return query(
    `SELECT role, content, created_at AS createdAt
     FROM messages WHERE chat_id = ?
     ORDER BY created_at ASC, id ASC`,
    [chatId]
  );
}

// 保存一条消息并刷新会话更新时间。
async function saveMessage(chatId, role, content) {
  await query(
    `INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)`,
    [chatId, role, content]
  );
  await touchChat(chatId);
}

// 持久化旧对话摘要，并记录已有多少条消息已被纳入摘要。
async function updateChatSummary(chatId, summary, summaryMessageCount) {
  await query(
    `UPDATE chats
     SET summary = ?, summary_message_count = ?, updated_at = CURRENT_TIMESTAMP
     WHERE chat_id = ?`,
    [summary, summaryMessageCount, chatId]
  );
}

module.exports = {
  pool,
  ensureTables,
  findStudentById,
  findStudentByStudentId,
  createStudent,
  verifyStudentPassword,
  getOrCreateChat,
  listChatsByUserId,
  getChatContextState,
  listMessagesByChatId,
  saveMessage,
  touchChat,
  updateChatSummary,
};
