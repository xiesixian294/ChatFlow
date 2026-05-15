<template>
  <div class = "container">
          <div class="portal-page">
    <main class="home-main">
      <section class="home-heading">
        <h1 class="hero-title">HFUT AI 应用门户</h1>
        <p class="hero-desc">
          统一入口，快速访问校园智能聊天、智能客服与文档问答应用。
        </p>
      </section>

      <el-row class="app-grid" :gutter="24">
        <el-col v-for="app in apps" :key="app.title" :xs="24" :sm="12" :lg="8">
          <el-card
            class="app-card glass-card"
            shadow="hover"
            :class="{ disabled: !app.enabled }"
            @click="openApp(app)"
          >
            <div class="app-icon">
              <el-icon :size="28">
                <component :is="app.icon" />
              </el-icon>
            </div>
            <h2>{{ app.title }}</h2>
            <p>{{ app.description }}</p>
          </el-card>
        </el-col>
      </el-row>
    </main>
  </div>
</div>

</template>
<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ChatDotRound, Document, Service } from "@element-plus/icons-vue";
import { authUser } from "../api";

const router = useRouter();
const user = computed(() => authUser.value);

const apps = [
  {
    title: "AI 聊天",
    description: "支持历史会话、多轮上下文与流式生成的校园 AI 聊天助手。",
    route: "/chat",
    enabled: true,
    icon: ChatDotRound,
  },
  {
    title: "肥工智能客服",
    description: "预留模块，可扩展校园业务问答与工单分发能力。",
    route: "/home",
    enabled: false,
    icon: Service,
  },
  {
    title: "ChatPDF",
    description: "预留模块，可扩展文档上传、解析与问答检索能力。",
    route: "/home",
    enabled: false,
    icon: Document,
  },
];

function openApp(app) {
  if (!app.enabled) {
    return;
  }
  router.push(app.route);
}
</script>


