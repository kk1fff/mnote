import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";
import { api, getApiBase, setUnauthorizedHandler } from "./api";
import { flavor } from "./desktop";
import { live } from "./live";
import { resetCollapsed } from "./folders";
import { currentUser, refreshSession } from "./session";
const router = createRouter({
  history: flavor() ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: "/connect", component: () => import("./views/ConnectView.vue") },
    { path: "/setup", component: () => import("./views/SetupView.vue") },
    { path: "/login", component: () => import("./views/LoginView.vue") },
    { path: "/password", component: () => import("./views/PasswordView.vue") },
    { path: "/search", component: () => import("./views/SearchView.vue") },
    { path: "/images", component: () => import("./views/ImagesView.vue") },
    {
      path: "/recent",
      component: () => import("./views/CollectionView.vue"),
      props: { title: "Recent notes", load: api.recentNotes },
    },
    {
      path: "/favorites",
      component: () => import("./views/CollectionView.vue"),
      props: { title: "Favorites", load: api.favorites },
    },
    { path: "/today", name: "today", component: () => import("./views/TodayView.vue") },
    { path: "/quick", component: () => import("./views/QuickView.vue") },
    { path: "/n/:id", name: "note", component: () => import("./views/NoteView.vue") },
    { path: "/", redirect: "/today" },
  ],
});

router.beforeEach(async (to) => {
  const mode = flavor();
  if (mode === "remote" && !getApiBase() && to.path !== "/connect") {
    return { path: "/connect" };
  }
  if (mode === "full") {
    const { desktopInfo } = await import("./desktop");
    const needed = desktopInfo()?.needsSetup ?? !getApiBase();
    if (needed && to.path !== "/setup") return { path: "/setup" };
  }
  if (to.path === "/connect" || to.path === "/setup") return true;
  await refreshSession();
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

setUnauthorizedHandler(() => {
  currentUser.value = null;
  resetCollapsed();
  live.disconnect();
  if (router.currentRoute.value.path !== "/login") {
    void router.replace({
      path: "/login",
      query: { next: router.currentRoute.value.fullPath },
    });
  }
});

export default router;
