import { createRouter, createWebHistory } from "vue-router";
import { currentUser, refreshSession, sessionReady } from "./session";
import { todayPath } from "./lib/paths";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("./views/LoginView.vue") },
    { path: "/password", component: () => import("./views/PasswordView.vue") },
    { path: "/search", component: () => import("./views/SearchView.vue") },
    { path: "/n/:path(.*)", component: () => import("./views/NoteView.vue") },
    { path: "/", redirect: () => `/n/${todayPath()}` },
  ],
});

router.beforeEach(async (to) => {
  if (!sessionReady.value) {
    await refreshSession();
  }
  const user = currentUser.value;
  if (!user && to.path !== "/login") {
    return { path: "/login", query: { next: to.fullPath } };
  }
  if (user?.must_change_password && to.path !== "/password") {
    return { path: "/password" };
  }
  if (user && !user.must_change_password && to.path === "/login") {
    return { path: "/" };
  }
  return true;
});

export default router;
