<template>
  <div class="chat-page">
    <el-container class="chat-shell">
      <el-aside class="chat-sidebar glass-card" width="300px">
        <div class="sidebar-head">
          <div class="sidebar-title-wrap">
            <el-icon class="sidebar-title-icon">
              <ChatDotRound />
            </el-icon>
            <h2>历史会话</h2>
          </div>
          <el-button class="new-chat-btn" type="danger" round plain :icon="Plus" @click="startNewChat">
          </el-button>
        </div>

        <el-scrollbar class="history-scroll">
          <div class="history-list">
            <button v-for="item in historyList" :key="item.chatId" class="history-item"
              :class="{ active: item.chatId === activeChatId }" @click="openChat(item.chatId)">
              <strong>{{ item.title }}</strong>
            </button>
            <el-empty v-if="historyList.length === 0" class="history-empty" description="暂无历史会话，开始你的第一轮对话吧。" />
            <div class="sidebar-summary glass-card user-detail">
              <strong>{{ authUser?.name || "未登录" }}</strong>
              <small>会话数 {{ historyList.length }}</small>
            </div>

          </div>
        </el-scrollbar>
      </el-aside>

      <el-main class="chat-main glass-card">
        <div class="chat-main-head">
          <div>
            <span class="chat-main-kicker">AI Chat Workspace</span>
            <h2>校园智能聊天</h2>
          </div>
          <div class="chat-main-meta">
            <el-tag round effect="light" type="danger" size="large">
              <span>{{ currentChatState.isStreaming ? "生成中" : "就绪" }}</span>
            </el-tag>
            <el-tag round effect="plain" size="large"> {{ activeChatId ? '正在对话' : '等待创建' }}
            </el-tag>
          </div>
        </div>

        <el-scrollbar ref="messagePanel" class="message-panel">
          <div v-if="currentMessages.length === 0" class="welcome-box">
            <div class="welcome-icon">
              <el-icon>
                <MagicStick />
              </el-icon>
            </div>
            <h2>开始一段新的 AI 对话</h2>
            <p>输入问题后，系统会基于当前 chatId 自动拼接历史上下文并进行流式返回。</p>
            <div class="suggestion-list">
              <el-button v-for="item in suggestionPrompts" :key="item" class="suggestion-btn" round
                @click="applySuggestion(item)">
                {{ item }}
              </el-button>
            </div>
          </div>

          <article v-for="message in currentMessages" :key="message.id" class="message-item" :class="message.role">
            <div class="message-role">{{ message.role === "user" ? "我" : "AI" }}</div>
            <div v-if="message.role === 'assistant'" class="message-content markdown-body"
              v-html="message.renderedContent"></div>
            <div v-else class="message-content">{{ message.content }}</div>
          </article>
        </el-scrollbar>

        <div class="input-panel">
          <el-alert v-if="currentChatState.errorMessage" class="chat-alert" :title="currentChatState.errorMessage"
            type="error" :closable="false" show-icon />
          <div class="composer">
            <el-input v-model="prompt" class="chat-input" type="textarea" :rows="2" resize="none"
              placeholder="请输入你的问题，按 Enter 发送，Shift + Enter 换行" @keydown="handleEnter" />
            <el-button v-if="currentChatState.isStreaming" class="send-btn" plain @click="stopCurrentChat">
              停止
            </el-button>
            <el-button class="send-btn" type="danger" :icon="Promotion" :loading="currentChatState.isStreaming"
              @click="sendMessage">
              {{ currentChatState.isStreaming ? "生成中..." : "发送" }}
            </el-button>
          </div>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
  import { computed, nextTick, onMounted, ref } from "vue";
  import { ElMessage } from "element-plus";
  import { ChatDotRound, Plus, Promotion, MagicStick } from "@element-plus/icons-vue";
  import DOMPurify from "dompurify";
  import hljs from "highlight.js";
  import { marked } from "marked";
  import { authUser, fetchChatDetail, fetchChatList, resumeChat, stopChat, streamChat } from "../api";

  const ACTIVE_CHAT_STORAGE_KEY = "hfut-ai-active-chat";

  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  const historyList = ref([]);
  const prompt = ref("");
  const activeChatId = ref("");
  const messagePanel = ref(null);
  const chatStates = ref({});
  const suggestionPrompts = [
    "请帮我概括合肥工业大学的学校特色。",
    "请为新生写一段校园生活建议。",
    "请介绍一下学校的优势学科。",
  ];

  // 为每次新建对话生成前端侧唯一 chatId，后端据此关联历史消息。
  function createChatId() {

    return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildChatTitle(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      return "新会话";
    }
    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
  }

  function touchHistoryItem(chatId, promptText) {
    const title = buildChatTitle(promptText);
    const existingIndex = historyList.value.findIndex((item) => item.chatId === chatId);
    if (existingIndex === -1) {
      historyList.value.unshift({
        chatId,
        title,
      });
      return;
    }

    const [existingItem] = historyList.value.splice(existingIndex, 1);
    historyList.value.unshift({
      ...existingItem,
      title: existingItem.title || title,
    });
  }

  // 将模型文本渲染为安全的 Markdown HTML，并对代码块做高亮。
  function renderMarkdown(content) {
    const rawHtml = marked.parse(content || "", {
      async: false,
    });
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    const container = document.createElement("div");
    container.innerHTML = cleanHtml;

    container.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightElement(block);
    });

    return container.innerHTML;
  }

  // 统一补齐消息对象的渲染字段，便于模板层直接展示。
  function createMessage(message) {
    return {
      ...message,
      renderedContent: message.role === "assistant" ? renderMarkdown(message.content) : "",
    };
  }

  function createChatState() {
    return {
      messages: [],
      isStreaming: false,
      errorMessage: "",
      loaded: false,
      abortController: null,
    };
  }

  function ensureChatState(chatId) {
    if (!chatId) {
      return createChatState();
    }
    if (!chatStates.value[chatId]) {
      chatStates.value[chatId] = createChatState();
    }
    return chatStates.value[chatId];
  }

  const currentChatState = computed(() => ensureChatState(activeChatId.value));
  const currentMessages = computed(() => currentChatState.value.messages);

  function isAbortError(error) {
    return error?.name === "AbortError" || error?.message === "The operation was aborted.";
  }

  function appendManualStopNotice(content) {
    const notice = "[已手动停止]";
    if (!content) {
      return notice;
    }
    if (content.includes(notice)) {
      return content;
    }
    return `${content}\n\n${notice}`;
  }

  // 新消息写入后自动滚动到底部，保持聊天体验连贯。
  function scrollToBottom() {
    nextTick(() => {
      const wrap = messagePanel.value?.wrapRef;
      if (wrap) {
        wrap.scrollTop = wrap.scrollHeight;
      }
    });
  }

  // 加载当前用户的历史会话列表。
  async function loadHistory() {
    const data = await fetchChatList();
    historyList.value = data.items || [];
  }

  // 打开某个历史会话，并把后端返回的消息转换成前端可渲染结构。
  async function openChat(chatId) {
    activeChatId.value = chatId;
    try {
      localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chatId);
    } catch (storageError) {
      // ignore
    }
    const targetState = ensureChatState(chatId);
    targetState.errorMessage = "";
    if (!targetState.loaded) {
      const data = await fetchChatDetail(chatId);
      targetState.messages = (data.items || []).map((item, index) => ({
        ...createMessage({
          id: `${chatId}_${index}`,
          role: item.role,
          content: item.content,
        }),
      }));
      targetState.loaded = true;
    }
    scrollToBottom();
    // 加载完历史后，尝试续接服务端仍在进行中的流；若有则继续展示流式输出。
    tryResumeStream(chatId);
  }

  // 新建会话只重置前端状态，真正建会话发生在首次发送消息时。
  async function startNewChat() {
    const chatId = createChatId();
    activeChatId.value = chatId;
    try {
      localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chatId);
    } catch (storageError) {
      // ignore
    }
    const state = ensureChatState(chatId);
    state.messages = [];
    state.isStreaming = false;
    state.errorMessage = "";
    state.loaded = true;
    state.abortController = null;
  }

  // 刷新后尝试订阅服务端仍在进行中的流，把已经生成的内容回放并继续接收增量。
  async function tryResumeStream(chatId) {
    const state = ensureChatState(chatId);
    if (state.isStreaming) {
      return;
    }

    const controller = new AbortController();
    const assistantMessage = createMessage({
      id: `${chatId}_assistant_resume_${Date.now()}`,
      role: "assistant",
      content: "",
    });
    let attached = false;

    try {
      const result = await resumeChat({
        chatId,
        signal: controller.signal,
        onDelta(content) {
          const targetState = ensureChatState(chatId);
          if (!attached) {
            attached = true;
            targetState.isStreaming = true;
            targetState.abortController = controller;
            // 续接时历史不会包含 assistant（落库发生在流结束后），所以直接追加占位。
            targetState.messages.push({
              ...assistantMessage,
              content,
              renderedContent: renderMarkdown(content),
            });
          } else {
            const messageIndex = targetState.messages.findIndex((item) => item.id === assistantMessage.id);
            if (messageIndex !== -1) {
              targetState.messages.splice(messageIndex, 1, {
                ...targetState.messages[messageIndex],
                content,
                renderedContent: renderMarkdown(content),
              });
            }
          }
          if (activeChatId.value === chatId) {
            scrollToBottom();
          }
        },
      });

      if (result?.active) {
        // 流式正常结束（含被 [DONE] 收尾、被用户停止），重新拉一次历史以拿到最终落库版本，避免和数据库不一致。
        try {
          const data = await fetchChatDetail(chatId);
          const targetState = ensureChatState(chatId);
          targetState.messages = (data.items || []).map((item, index) => ({
            ...createMessage({
              id: `${chatId}_${index}`,
              role: item.role,
              content: item.content,
            }),
          }));
          targetState.loaded = true;
        } catch (historyError) {
          // ignore
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        // 续接失败时不做强提示，保持页面已有的历史展示即可。
        // eslint-disable-next-line no-console
        console.warn("resume stream error", error);
      }
    } finally {
      const targetState = ensureChatState(chatId);
      if (targetState.abortController === controller) {
        targetState.abortController = null;
      }
      targetState.isStreaming = false;
    }
  }

  async function stopCurrentChat() {
    const chatId = activeChatId.value;
    if (!chatId) {
      return;
    }

    const state = ensureChatState(chatId);
    const controller = state.abortController;
    if (!controller || !state.isStreaming) {
      return;
    }

    state.abortController = null;
    state.isStreaming = false;
    state.errorMessage = "";
    controller.abort();
    const assistantMessageIndex = [...state.messages]
      .reverse()
      .findIndex((item) => item.role === "assistant");
    if (assistantMessageIndex !== -1) {
      const actualIndex = state.messages.length - 1 - assistantMessageIndex;
      const message = state.messages[actualIndex];
      const content = appendManualStopNotice(message.content || "");
      state.messages.splice(actualIndex, 1, {
        ...message,
        content,
        renderedContent: renderMarkdown(content),
      });
    }

    try {
      await stopChat(chatId);
    } catch (error) {
      ElMessage.warning(error.message || "停止请求已发送，服务端确认失败");
    }
  }

  // 发送消息时先写入本地消息列表，再通过流式接口持续刷新 assistant 回复。
  async function sendMessage() {
    const state = currentChatState.value;
    const text = prompt.value.trim();
    if (!text || state.isStreaming) {
      return;
    }

    if (!activeChatId.value) {
      await startNewChat();
    }

    const chatId = activeChatId.value;
    const chatState = ensureChatState(chatId);
    const isFirstMessage = chatState.messages.length === 0;
    const userMessage = {
      id: `${chatId}_user_${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantMessage = createMessage({
      id: `${chatId}_assistant_${Date.now()}`,
      role: "assistant",
      content: "",
    });

    chatState.messages.push(createMessage(userMessage), assistantMessage);
    if (isFirstMessage) {
      touchHistoryItem(chatId, text);
    } else {
      touchHistoryItem(chatId);
    }
    prompt.value = "";
    chatState.isStreaming = true;
    chatState.errorMessage = "";
    const controller = new AbortController();
    chatState.abortController = controller;
    scrollToBottom();

    try {
      // 每收到一次新的完整文本，就替换最后一条 assistant 消息实现流式渲染。
      await streamChat({
        chatId,
        prompt: text,
        signal: controller.signal,
        onDelta(content) {
          const targetState = ensureChatState(chatId);
          assistantMessage.content = content;
          assistantMessage.renderedContent = renderMarkdown(content);
          const messageIndex = targetState.messages.findIndex((item) => item.id === assistantMessage.id);
          if (messageIndex === -1) {
            targetState.messages.push({ ...assistantMessage });
          } else {
            targetState.messages.splice(messageIndex, 1, { ...assistantMessage });
          }
          if (activeChatId.value === chatId) {
            scrollToBottom();
          }
        },
      });
      await loadHistory();
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      // 请求失败时保留已生成内容，并给用户一个明确的失败提示。
      const targetState = ensureChatState(chatId);
      targetState.errorMessage = error.message;
      ElMessage.error(error.message || "发送失败");
      const messageIndex = targetState.messages.findIndex((item) => item.id === assistantMessage.id);
      const fallbackMessage = {
        ...assistantMessage,
        content: assistantMessage.content || "生成失败，请稍后重试。",
        renderedContent: renderMarkdown(assistantMessage.content || "生成失败，请稍后重试。"),
      };
      if (messageIndex === -1) {
        targetState.messages.push(fallbackMessage);
      } else {
        targetState.messages.splice(messageIndex, 1, fallbackMessage);
      }
    } finally {
      const targetState = ensureChatState(chatId);
      targetState.isStreaming = false;
      if (targetState.abortController === controller) {
        targetState.abortController = null;
      }
    }
  }

  // 点击建议词后直接填充输入框。
  function applySuggestion(text) {
    prompt.value = text;
  }

  // Enter 发送，Shift + Enter 换行。
  function handleEnter(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  // 页面初始化时优先打开最近会话，没有历史则创建一个新的本地会话标识。
  onMounted(async () => {
    await loadHistory();
    let preferredChatId = "";
    try {
      preferredChatId = localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) || "";
    } catch (storageError) {
      preferredChatId = "";
    }
    const hasPreferred = preferredChatId && historyList.value.some((item) => item.chatId === preferredChatId);

    if (hasPreferred) {
      await openChat(preferredChatId);
    } else if (historyList.value.length > 0) {
      await openChat(historyList.value[0].chatId);
    } else {
      await startNewChat();
    }
  });
</script>
