import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "highlight.js/styles/github-dark.css";
import App from "./App.vue";
import router from "./router";
import "./styles.css";

createApp(App).use(router).use(ElementPlus).mount("#app");
