require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {
  API_ROUTES,
  getChatHistoryDetailRoute,
} = require("./constants/apiRoutes");

const {
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
} = require("./db");

// 应用基础配置与运行时约束。
//在index里面定义应用的基础配置
//引入express模块，并创建模块的实例对象app，这个实例对象就是后端服务的本体，用来接浏览器和前端请求
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "hfut-ai-chat-secret";
const LLM_API_URL =
  process.env.LLM_API_URL || "https://api.deepseek.com/chat/completions";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepseek-chat";
const MAX_STUDENT_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 128;
const MAX_CHAT_ID_LENGTH = 64;
const MAX_PROMPT_LENGTH = 8000;
const SUMMARY_TRIGGER_CHARS = Number(process.env.SUMMARY_TRIGGER_CHARS || 6000);
const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 12000);
const KEEP_RECENT_MESSAGE_COUNT = Number(
  process.env.KEEP_RECENT_MESSAGE_COUNT || 8
);
const SUMMARY_MAX_CHARS = Number(process.env.SUMMARY_MAX_CHARS || 1200);
const activeChatStreams = new Map();

//允许访问我们的后端的前端地址
//如果有环境变量就用环境变量，否则就用默认的本机前端的5173接口
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: false,
  })
);
//自动解析前端发过来的JSON数据
app.use(express.json({ limit: "1mb" }));

// 统一清洗字符串输入，避免 null/undefined 直接参与后续逻辑。
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 返回给前端和写入 JWT 的用户对象只保留安全字段。
function toSafeUser(student) {
  return {
    id: student.id,
    studentId: student.studentId,
    name: student.name,
  };
}

// 登录成功后为学生签发 7 天有效的访问令牌。
function signStudentToken(student) {
  return jwt.sign(toSafeUser(student), JWT_SECRET, { expiresIn: "7d" });
}

// 解析上游 SSE 返回的单行数据，只提取 delta 文本和结束标记。
function parseSsePayload(payload) {
  if (!payload) {
    return { done: false, delta: "" };
  }

  if (payload === "[DONE]") {
    return { done: true, delta: "" };
  }

  try {
    const json = JSON.parse(payload);
    return {
      done: false,
      delta: json?.choices?.[0]?.delta?.content || "",
    };
  } catch (error) {
    return { done: false, delta: "" };
  }
}

// 从 Authorization 请求头中提取 Bearer Token。
function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

// 需要登录的接口统一经过这里校验 Token 并挂载当前用户。
async function authRequired(req, res, next) {
  try {
    // getTokenFromRequest获取请求体的用户token，并进行验证
    // 如果token不存在，说明用户未登录，返回401错误
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ message: "未登录" });
    }
    //验证token是否有效
    // 如果token无效，说明用户未登录，返回401错误
    //JWT进行验证，如果验证失败，说明token无效，返回401错误
    const payload = jwt.verify(token, JWT_SECRET);
    const student = await findStudentById(payload.id);
    if (!student) {
      return res.status(401).json({ message: "登录态已失效" });
    }

    //解析用户信息并挂载到req.user上
    req.user = toSafeUser(student);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "登录态已失效" });
  }
}

// 用用户首轮提问的前 20 个字符生成会话标题，空内容时回退为默认标题。
function buildChatTitle(prompt) {
  return (prompt || "").trim().slice(0, 20) || "新对话";
}

// 在尚未开始流式输出时安全地返回 JSON 错误。
function writeJsonError(res, status, message) {
  if (!res.headersSent) {
    res.status(status).json({ message });
  }
}

function getStreamKey(userId, chatId) {
  return `${userId}:${chatId}`;
}

// 订阅者列表广播：所有正在监听该 chatId 的 HTTP 响应都会拿到本次 delta。
function broadcastDelta(streamState, delta) {
  if (!delta) {
    return;
  }
  streamState.fullContent += delta;
  for (const subscriber of streamState.subscribers) {
    try {
      if (!subscriber.writableEnded) {
        subscriber.write(delta);
      }
    } catch (writeError) {
      streamState.subscribers.delete(subscriber);
    }
  }
}

// 把一个 HTTP 响应加入订阅者列表，可选回放已有的缓冲内容（用于刷新后续接流）。
function attachSubscriber(streamState, res, options = {}) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (options.replayBuffer && streamState.fullContent) {
    try {
      res.write(streamState.fullContent);
    } catch (writeError) {
      // 客户端在回放前就断开：直接收尾。
      try {
        if (!res.writableEnded) res.end();
      } catch (endError) {
        // ignore
      }
      return;
    }
  }
  if (streamState.done) {
    try {
      if (!res.writableEnded) res.end();
    } catch (endError) {
      // ignore
    }
    return;
  }
  streamState.subscribers.add(res);
  const cleanup = () => {
    streamState.subscribers.delete(res);
  };
  res.once("close", cleanup);
  res.once("error", cleanup);
}

// 上游模型流结束（含正常完成、用户停止、错误）后，统一收尾所有订阅者。
function finishSubscribers(streamState) {
  streamState.done = true;
  for (const subscriber of streamState.subscribers) {
    try {
      if (!subscriber.writableEnded) subscriber.end();
    } catch (endError) {
      // ignore
    }
  }
  streamState.subscribers.clear();
}

function estimateContextChars(messages) {
  return messages.reduce((total, item) => total + (item.content || "").length, 0);
}

function buildSummaryMessage(summary) {
  return {
    role: "system",
    content: `以下是当前会话前文的压缩摘要，请在后续回答中延续这些上下文信息：\n${summary}`,
  };
}

function trimMessagesToContextLimit({ summaryText, messages, prompt }) {
  const trimmedMessages = [...messages];
  let trimmedSummary = summaryText;

  while (
    estimateContextChars([
      ...(trimmedSummary ? [buildSummaryMessage(trimmedSummary)] : []),
      ...trimmedMessages,
      { role: "user", content: prompt },
    ]) > MAX_CONTEXT_CHARS &&
    trimmedMessages.length > 0
  ) {
    trimmedMessages.shift();
  }

  if (
    trimmedSummary &&
    estimateContextChars([
      buildSummaryMessage(trimmedSummary),
      ...trimmedMessages,
      { role: "user", content: prompt },
    ]) > MAX_CONTEXT_CHARS
  ) {
    const maxSummaryLength = Math.max(0, MAX_CONTEXT_CHARS - prompt.length - 500);
    trimmedSummary = trimmedSummary.slice(0, maxSummaryLength);
  }

  return {
    summaryText: trimmedSummary,
    messages: trimmedMessages,
  };
}

async function requestModelJson(messages) {
  const upstreamResponse = await fetch(LLM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      stream: false,
      messages,
    }),
  });

  if (!upstreamResponse.ok) {
    const rawErrorText = await upstreamResponse.text();
    throw new Error(`SUMMARY_UPSTREAM_ERROR:${upstreamResponse.status}:${rawErrorText}`);
  }

  const data = await upstreamResponse.json();
  return normalizeString(data?.choices?.[0]?.message?.content);
}

async function summarizeConversation({ existingSummary, messagesToSummarize }) {
  const transcript = messagesToSummarize
    .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`)
    .join("\n");

  const summaryMessages = [
    {
      role: "system",
      content:
        `你是对话压缩助手。请把旧对话压缩成后续续聊可用的中文摘要。` +
        `只保留目标、约束、已知事实、关键结论、待办问题，不要编造内容。` +
        `输出纯文本，不超过 ${SUMMARY_MAX_CHARS} 个中文字符。`,
    },
    {
      role: "user",
      content: [
        existingSummary ? `已有摘要：\n${existingSummary}` : "已有摘要：无",
        "请继续吸收以下旧对话内容并输出新的合并摘要：",
        transcript,
      ].join("\n\n"),
    },
  ];

  return requestModelJson(summaryMessages);
}

async function buildConversationContext({ chatId, userId, historyMessages, prompt }) {
  const chatContextState = await getChatContextState(chatId, userId);
  let summaryText = normalizeString(chatContextState?.summary);
  let summaryMessageCount = Math.max(
    0,
    Math.min(Number(chatContextState?.summaryMessageCount || 0), historyMessages.length)
  );
  let contextMessages = historyMessages
    .slice(summaryMessageCount)
    .map((item) => ({ role: item.role, content: item.content }));

  if (
    contextMessages.length > KEEP_RECENT_MESSAGE_COUNT &&
    estimateContextChars(contextMessages) > SUMMARY_TRIGGER_CHARS
  ) {
    const splitIndex = contextMessages.length - KEEP_RECENT_MESSAGE_COUNT;
    const messagesToSummarize = contextMessages.slice(0, splitIndex);
    const recentMessages = contextMessages.slice(splitIndex);

    try {
      const nextSummary = await summarizeConversation({
        existingSummary: summaryText,
        messagesToSummarize,
      });

      if (nextSummary) {
        summaryText = nextSummary;
        summaryMessageCount += messagesToSummarize.length;
        await updateChatSummary(chatId, summaryText, summaryMessageCount);
        contextMessages = recentMessages;
      }
    } catch (error) {
      console.error("summary error", error);
    }
  }

  const trimmedContext = trimMessagesToContextLimit({
    summaryText,
    messages: contextMessages,
    prompt,
  });

  return {
    summaryText: trimmedContext.summaryText,
    modelMessages: [
      ...(trimmedContext.summaryText
        ? [buildSummaryMessage(trimmedContext.summaryText)]
        : []),
      ...trimmedContext.messages,
      { role: "user", content: prompt },
    ],
  };
}

// 学生登录：验证学号与密码，成功后返回 JWT 与用户信息。
//在后端上挂在一个post接口，用来处理学生登录请求
//API_ROUTES.STUDENT_LOGIN_URL是我们提前存储好的接口地址
//req请求体，服务端在接收前端传过来的请求的时候创建并传给这个函数
//res响应体，用来让后端创建并返回给前端
app.post(API_ROUTES.STUDENT_LOGIN_URL, async (req, res) => {
  try {
    //清洗数据，防止req.body为空导致的错误
    const studentId = normalizeString(req.body?.studentId);
    //如果password为空，说明用户没有输入密码，返回400错误
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!studentId || !password) {
      return res.status(400).json({ message: "studentId 和 password 必填" });
    }
    if (studentId.length > MAX_STUDENT_ID_LENGTH) {
      return res.status(400).json({ message: "学号长度不能超过 64 个字符" });
    }

    //findStudentByStudentId在数据库当中根据用户id进行查找
    const student = await findStudentByStudentId(studentId);
    if (!student) {
      return res.status(404).json({ message: "用户不存在，请先注册" });
    }

    //验证学生密码
    const matched = await verifyStudentPassword(student, password);
    if (!matched) {
      return res.status(401).json({ message: "账号或密码错误" });
    }

    //给学生签发七天有效令牌
    const token = signStudentToken(student);
    //最终返回学生的token和user并返回给前端
    return res.json({
      token,
      user: toSafeUser(student),
    });
  } catch (error) {
    //如果有错误，返回500错误，提示登录失败，
    console.error("login error", error);
    return res.status(500).json({ message: "登录失败" });
  }
});

//给app创建一个为post的请求接口，地址是API_ROUTES.STUDENT_REGISTER_URL，并执行处理以下函数
// 学生注册：创建账号并返回基础用户信息。
app.post(API_ROUTES.STUDENT_REGISTER_URL, async (req, res) => {
  try {
    //清洗数据，防止req.body为空导致的错误
    const studentId = normalizeString(req.body?.studentId);
    //如果password为空，说明用户没有输入密码，返回400错误
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const name = normalizeString(req.body?.name);

    if (!studentId || !password || !name) {
      return res.status(400).json({ message: "studentId、name 和 password 必填" });
    }
    if (studentId.length > MAX_STUDENT_ID_LENGTH) {
      return res.status(400).json({ message: "学号长度不能超过 64 个字符" });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ message: "姓名长度不能超过 128 个字符" });
    }
    //在数据库当中根据id查找学生，如果就返回错误并告知用户学号已注册
    const existing = await findStudentByStudentId(studentId);
    if (existing) {
      return res.status(409).json({ message: "该学号已注册，请直接登录" });
    }
    //createStudent在数据库当中创建一个学生记录
    const student = await createStudent({
      studentId,
      password,
      name,
    });
    //最终把学生记录返回给前端
    return res.status(201).json({
      user: toSafeUser(student),
      message: "注册成功，请登录",
    });
  } catch (error) {
    console.error("register error", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "该学号已注册，请直接登录" });
    }
    return res.status(500).json({ message: "注册失败" });
  }
});

// 获取当前登录用户信息，用于前端页面初始化和登录态恢复。
app.get(API_ROUTES.AUTH_ME_URL, authRequired, async (req, res) => {
  return res.json({
    user: toSafeUser(req.user),
  });
});

// 历史会话列表接口：返回当前用户所有会话。
app.get(API_ROUTES.CHAT_HISTORY_LIST_URL, authRequired, async (req, res) => {
  try {
    const chats = await listChatsByUserId(req.user.id);
    return res.json({
      items: chats,
    });
  } catch (error) {
    console.error("history list error", error);
    return res.status(500).json({ message: "获取历史列表失败" });
  }
});

// 历史会话详情接口：返回指定 chatId 下的全部消息。
app.get(getChatHistoryDetailRoute(), authRequired, async (req, res) => {
  try {
    const items = await listMessagesByChatId(req.params.chatId, req.user.id);
    if (!items) {
      return res.status(404).json({ message: "会话不存在" });
    }
    return res.json({
      chatId: req.params.chatId,
      items,
    });
  } catch (error) {
    console.error("history detail error", error);
    return res.status(500).json({ message: "获取会话详情失败" });
  }
});

app.post(API_ROUTES.AI_CHAT_STOP_URL, authRequired, async (req, res) => {
  const chatId = normalizeString(req.body?.chatId);
  if (!chatId) {
    return res.status(400).json({ message: "chatId 必填" });
  }

  const streamKey = getStreamKey(req.user.id, chatId);
  const activeStream = activeChatStreams.get(streamKey);
  if (!activeStream) {
    return res.json({
      stopped: false,
      message: "当前会话没有进行中的生成任务",
    });
  }

  activeStream.stoppedByClient = true;
  activeStream.abortController.abort();
  return res.json({
    stopped: true,
    message: "已停止当前会话生成",
  });
});

// 聊天接口：拼接历史上下文，调用上游大模型，并将回复流式转发给前端。
app.post(API_ROUTES.AI_CHAT_URL, authRequired, async (req, res) => {
  // 从请求体读取当前用户提问与会话标识。
  const prompt = normalizeString(req.body?.prompt);
  const chatId = normalizeString(req.body?.chatId);

  // 校验基础参数，避免非法输入进入数据库和上游模型请求。
  if (!prompt || !chatId) {
    return res.status(400).json({ message: "prompt 和 chatId 必填" });
  }
  if (chatId.length > MAX_CHAT_ID_LENGTH) {
    return res.status(400).json({ message: "chatId 长度不能超过 64 个字符" });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({ message: "prompt 长度不能超过 8000 个字符" });
  }

  // 模型密钥只保存在服务端，前端不会直接接触。
  if (!LLM_API_KEY) {
    return res.status(500).json({ message: "服务端未配置大模型 API Key" });
  }

  const streamKey = getStreamKey(req.user.id, chatId);
  const existedStream = activeChatStreams.get(streamKey);
  if (existedStream) {
    existedStream.stoppedByClient = true;
    existedStream.abortController.abort();
    finishSubscribers(existedStream);
    activeChatStreams.delete(streamKey);
  }
  const abortController = new AbortController();
  const streamState = {
    abortController,
    stoppedByClient: false,
    fullContent: "",
    subscribers: new Set(),
    done: false,
  };
  activeChatStreams.set(streamKey, streamState);

  let assistantSaved = false;
  async function flushAssistantMessage() {
    if (!assistantSaved && streamState.fullContent) {
      await saveMessage(chatId, "assistant", streamState.fullContent);
      assistantSaved = true;
    }
  }

  try {
    // 确保会话存在，并校验 chatId 必须属于当前用户。
    await getOrCreateChat({
      chatId,
      userId: req.user.id,
      //从prompt中提取会话标题
      title: buildChatTitle(prompt),
    });

    // 从数据库读取历史消息，必要时先压缩旧上下文，再组装模型输入。
    const historyMessages =
      (await listMessagesByChatId(chatId, req.user.id)) || [];
    const { modelMessages } = await buildConversationContext({
      chatId,
      userId: req.user.id,
      historyMessages,
      prompt,
    });

    // 先记录当前用户消息，再调用上游模型，保证对话链路可回放。
    await saveMessage(chatId, "user", prompt);
    if (historyMessages.length === 0) {
      await touchChat(chatId, buildChatTitle(prompt));
    }

    // 以流式方式请求外部大模型服务。
    const upstreamResponse = await fetch(LLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      signal: abortController.signal,
      body: JSON.stringify({
        model: LLM_MODEL,
        stream: true,
        messages: modelMessages,
      }),
    });

    // 上游无响应体或状态码异常时，直接向前端返回网关错误（此时还未进入流式响应，可以发 JSON）。
    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const rawErrorText = await upstreamResponse.text();
      console.error("upstream error", upstreamResponse.status, rawErrorText);
      return res.status(502).json({
        message: "大模型服务调用失败",
        detail: rawErrorText,
      });
    }

    // 上游已就绪：把当前发起者作为第一个订阅者；之后刷新来的 GET /resume 也会加入同一个 subscribers。
    attachSubscriber(streamState, res, { replayBuffer: false });

    // 读取上游流时需要维护缓冲区和完整回答，前者用于分行，后者用于最终入库。
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let stopped = false;

    // 逐块读取并按 SSE 规则拆分，每拿到一个 delta 就立刻广播给所有订阅者。
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        if (!rawLine.startsWith("data:")) {
          continue;
        }

        const payload = rawLine.slice(5).trim();
        const { done, delta } = parseSsePayload(payload);
        if (done) {
          // 收到 [DONE] 后保存完整消息并结束循环。
          stopped = true;
          await flushAssistantMessage();
          break;
        }
        if (!delta) {
          continue;
        }
        broadcastDelta(streamState, delta);
      }
    }

    // 处理可能残留在缓冲区中的最后一段文本，确保流尾部不丢失。
    if (!assistantSaved) {
      const trailing = decoder.decode();
      if (trailing) {
        buffer += trailing;
      }

      if (buffer.trim()) {
        const maybeLines = buffer.split(/\r?\n/);
        for (const rawLine of maybeLines) {
          if (!rawLine.startsWith("data:")) {
            continue;
          }
          const payload = rawLine.slice(5).trim();
          const { done, delta } = parseSsePayload(payload);
          if (done || !delta) {
            continue;
          }
          broadcastDelta(streamState, delta);
        }
      }

      await flushAssistantMessage();
    }

    // 上游流自然结束，统一收尾所有订阅者（包含已刷新后重新连上的客户端）。
    finishSubscribers(streamState);
    return;
  } catch (error) {
    if (error?.name === "AbortError") {
      // 仅在用户主动停止或被同会话新请求顶替时进入这里。保存已生成片段并收尾订阅者。
      try {
        if (!assistantSaved) {
          await flushAssistantMessage();
        }
      } catch (flushError) {
        console.error("flush assistant after abort", flushError);
      }
      finishSubscribers(streamState);
      if (!res.headersSent) {
        return res.status(499).json({ message: "对话已停止" });
      }
      return;
    }
    console.error("chat error", error);
    if (error?.message === "FORBIDDEN_CHAT") {
      finishSubscribers(streamState);
      return writeJsonError(res, 403, "无权访问该会话");
    }
    if (!res.headersSent) {
      finishSubscribers(streamState);
      return res.status(500).json({ message: "聊天请求失败" });
    }
    finishSubscribers(streamState);
    return;
  } finally {
    // 任意路径退出时兜底落库一次，避免只写了一半就丢 assistant。
    try {
      if (!assistantSaved && streamState.fullContent) {
        await flushAssistantMessage();
      }
    } catch (finallyFlushError) {
      console.error("finally assistant flush", finallyFlushError);
    }
    const activeStream = activeChatStreams.get(streamKey);
    if (activeStream === streamState) {
      activeChatStreams.delete(streamKey);
    }
  }
});

// 续接流：刷新或换设备后，前端通过此接口订阅当前会话仍在进行的流，先回放已生成内容，再继续推增量。
app.get(API_ROUTES.AI_CHAT_RESUME_URL, authRequired, (req, res) => {
  const chatId = normalizeString(req.query?.chatId);
  if (!chatId) {
    return res.status(400).json({ message: "chatId 必填" });
  }
  if (chatId.length > MAX_CHAT_ID_LENGTH) {
    return res.status(400).json({ message: "chatId 长度不能超过 64 个字符" });
  }
  const streamKey = getStreamKey(req.user.id, chatId);
  const streamState = activeChatStreams.get(streamKey);
  if (!streamState) {
    return res.status(204).end();
  }
  attachSubscriber(streamState, res, { replayBuffer: true });
});

// 健康检查接口，便于判断服务是否正常启动。
app.get(API_ROUTES.HEALTH_URL, (req, res) => {
  res.json({
    ok: true,
    requestId: uuidv4(),
  });
});

// 启动时先确保表结构存在，再监听端口提供服务。
ensureTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`server listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("database init error", error);
    process.exit(1);
  });
