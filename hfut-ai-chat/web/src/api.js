import { ref } from "vue";

// 本地登录态存储键名。
const TOKEN_KEY = "hfut-ai-token";
const USER_KEY = "hfut-ai-user";

// 前后端统一维护的接口路径常量。
export const API_ROUTES = Object.freeze({
  // 学生登录接口
  STUDENT_LOGIN_URL: "/auth/student/login",
  // 学生注册接口
  STUDENT_REGISTER_URL: "/auth/student/register",
  // 获取当前学生信息接口
  AUTH_ME_URL: "/auth/me",
  // 获取历史会话列表接口
  CHAT_HISTORY_LIST_URL: "/ai/history/chat",
  // 发送聊天消息接口
  AI_CHAT_URL: "/ai/chat",
  // 停止正在生成的聊天接口
  AI_CHAT_STOP_URL: "/ai/chat/stop",
  // 续接正在生成的聊天接口（刷新后用）
  AI_CHAT_RESUME_URL: "/ai/chat/resume",
});

export function getChatHistoryDetailRoute(chatId) {
  return `${API_ROUTES.CHAT_HISTORY_LIST_URL}/${chatId}`;
}

// 使用 ref 持有当前登录态，便于页面响应式更新。
export const authToken = ref(localStorage.getItem(TOKEN_KEY) || "");
//解析用户信息并存储在响应式对象authUser当中
export const authUser = ref(readStoredUser());

// 从 localStorage 中恢复用户信息。
function readStoredUser() {
  //读取在登录的时候调用saveAuth函数保存的用户信息
  const raw = localStorage.getItem(USER_KEY);
  //如果用户信息存在，则解析为对象，否则返回null
  return raw ? JSON.parse(raw) : null;
}

// 统一读取当前 Token。
export function getToken() {
  return authToken.value;
}

// 统一读取当前用户信息。
export function getStoredUser() {
  return authUser.value;
}

// 登录成功后同步更新本地存储与响应式状态。
export function saveAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  authToken.value = token;
  authUser.value = user;
}

// 退出登录时清空本地登录态。
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  authToken.value = "";
  authUser.value = null;
}

// 通用请求封装：自动补 Authorization，并统一处理错误响应。
//二次封装请求方法，方便后续扩展
//path:请求路径
//options:请求选项
async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    //完善请求体
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  if (token) {
    //有token就完善请求头，在Autherization字段当中添加token，Bearer是JWT的认证方式
    headers.Authorization = `Bearer ${token}`;
  }

  //用fetch真正发送请求，并返回响应体
  //携带完整的请求体
  const response = await fetch(path, {
    ...options,
    headers,
  });
  //对请求的失败做出处理
  if (!response.ok) {
    let message = "请求失败";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch (error) {
      // Ignore invalid JSON response bodies.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// 登录接口调用。
export function login(payload) {
  return request(API_ROUTES.STUDENT_LOGIN_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// 注册接口调用。
export function registerStudent(payload) {
  return request(API_ROUTES.STUDENT_REGISTER_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// 拉取当前登录用户信息。
export function fetchMe() {
  return request(API_ROUTES.AUTH_ME_URL);
}

// 拉取历史会话列表。
export function fetchChatList() {
  return request(API_ROUTES.CHAT_HISTORY_LIST_URL);
}

// 拉取指定会话的完整消息历史。
export function fetchChatDetail(chatId) {
  return request(getChatHistoryDetailRoute(chatId));
}

// 发送流式聊天请求，并在每次收到新文本时通过 onDelta 回调刷新界面。
export async function streamChat({ chatId, prompt, onDelta, signal }) {
  const token = getToken();
  const response = await fetch(API_ROUTES.AI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal,
    body: JSON.stringify({ chatId, prompt }),
  });

  if (!response.ok || !response.body) {
    let message = "流式请求失败";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch (error) {
      // Ignore invalid JSON response bodies.
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let accumulated = "";

  // 后端返回的是纯文本流，这里不断累积并把最新内容交给页面渲染。
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    accumulated += decoder.decode(value, { stream: true });
    onDelta(accumulated);
  }

  accumulated += decoder.decode();
  onDelta(accumulated);
  return accumulated;
}

export function stopChat(chatId) {
  return request(API_ROUTES.AI_CHAT_STOP_URL, {
    method: "POST",
    body: JSON.stringify({ chatId }),
  });
}

// 尝试续接某个会话仍在进行中的流式输出，刷新后用以恢复显示。
// 返回 { active: false } 表示当前没有进行中的流；返回 { active: true, content } 时表示成功消费完整流。
export async function resumeChat({ chatId, onDelta, signal }) {
  const token = getToken();
  const url = `${API_ROUTES.AI_CHAT_RESUME_URL}?chatId=${encodeURIComponent(chatId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  });

  if (response.status === 204) {
    return { active: false, content: "" };
  }

  if (!response.ok || !response.body) {
    return { active: false, content: "" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let accumulated = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    accumulated += decoder.decode(value, { stream: true });
    onDelta(accumulated);
  }

  accumulated += decoder.decode();
  if (accumulated) {
    onDelta(accumulated);
  }
  return { active: true, content: accumulated };
}
