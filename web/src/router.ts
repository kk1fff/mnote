import { createRouter, createWebHistory } from "vue-router";
import { api, setUnauthorizedHandler } from "./api";
import { live } from "./live";
import { currentUser, refreshSession } from "./session";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("./views/LoginView.vue") },
    { path: "/password", component: () => import("./views/PasswordView.vue") },
    { path: "/search", component: () => import("./views/SearchView.vue") },
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
  live.disconnect();
  if (router.currentRoute.value.path !== "/login") {
    void router.replace({
      path: "/login",
      query: { next: router.currentRoute.value.fullPath },
    });
  }
});

export default router;
