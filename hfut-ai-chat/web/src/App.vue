<template>
  <div class="app-shell">
    <header class="site-nav">
      <div class="nav-inner">
        <button class="brand-link" type="button" @click="handleBrandClick">HFUT AI Hub</button>
        <div class="nav-actions">
          <el-button class="auth-pill" round @click="handleAuthAction">
            {{ user ? "退出" : "登录" }}
          </el-button>
          <el-button class="theme-toggle" @click="toggleTheme">
            <el-icon v-if="isDark"><Sunny /></el-icon>
            <el-icon v-else><Moon /></el-icon>
          </el-button>
        </div>
      </div>
    </header>

    <router-view />
  </div>
</template>
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { authUser, clearAuth } from "./api";
import { Moon, Sunny } from "@element-plus/icons-vue";

const THEME_KEY = "hfut-ai-theme";

const route = useRoute();
const router = useRouter();
const user = computed(() => authUser.value);
const isDark = ref(false);

function applyTheme(dark) {
  isDark.value = dark;
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
}

function toggleTheme() {
  applyTheme(!isDark.value);
}

function handleBrandClick() {
  router.push("/home");
}

function handleAuthAction() {
  if (user.value) {
    clearAuth();
    ElMessage.success("已退出登录");
    if (route.meta.requiresAuth) {
      router.push("/home");
    }
    return;
  }

  const redirect = route.fullPath && route.fullPath !== "/login" ? route.fullPath : "/home";
  router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
}

onMounted(() => {
  const storedTheme = localStorage.getItem(THEME_KEY);
  applyTheme(storedTheme === "dark");
});

watch(
  () => route.fullPath,
  () => {
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }
);
</script>

