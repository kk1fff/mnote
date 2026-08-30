import { createApp } from "vue";
import App from "./App.vue";
import { initDesktop } from "./desktop";
import router from "./router";
import { initTheme } from "./theme";
import "./style.css";

initTheme();
void initDesktop().then(() => {
  createApp(App).use(router).mount("#app");
});
