import { createRouter, createWebHistory } from "vue-router";
import LoginView from "./views/LoginView.vue";
import HomeView from "./views/HomeView.vue";
import ChatView from "./views/ChatView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/login", component: LoginView },
    { path: "/home", component: HomeView },
    { path: "/chat", component: ChatView, meta: { requiresAuth: true } },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem("hfut-ai-token");
  if (to.meta.requiresAuth && !token) {
    return `/login?redirect=${encodeURIComponent(to.fullPath)}`;
  }
  if (to.path === "/login" && token) {
    const redirect = typeof to.query.redirect === "string" ? to.query.redirect : "/home";
    return redirect;
  }
  return true;
});

export default router;
