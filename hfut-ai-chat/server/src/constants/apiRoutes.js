const API_ROUTES = Object.freeze({
  STUDENT_LOGIN_URL: "/auth/student/login",
  STUDENT_REGISTER_URL: "/auth/student/register",
  AUTH_ME_URL: "/auth/me",
  CHAT_HISTORY_LIST_URL: "/ai/history/chat",
  AI_CHAT_URL: "/ai/chat",
  AI_CHAT_STOP_URL: "/ai/chat/stop",
  AI_CHAT_RESUME_URL: "/ai/chat/resume",
  HEALTH_URL: "/health",
});

function getChatHistoryDetailRoute(chatId = ":chatId") {
  return `${API_ROUTES.CHAT_HISTORY_LIST_URL}/${chatId}`;
}

module.exports = {
  API_ROUTES,
  getChatHistoryDetailRoute,
};
