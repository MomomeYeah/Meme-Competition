/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

// Composables
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";

// Pages
import Login from "@/pages/Login.vue";
import Register from "@/pages/Register.vue";
import Dashboard from "@/pages/Dashboard.vue";
import CreateCompetition from "@/pages/CreateCompetition.vue";
import CompetitionDetail from "@/pages/CompetitionDetail.vue";
import Invite from "@/pages/Invite.vue";

const routes: RouteRecordRaw[] = [
    {
        path: "/login",
        name: "Login",
        component: Login,
        meta: { requiresAuth: false },
    },
    {
        path: "/register",
        name: "Register",
        component: Register,
        meta: { requiresAuth: false },
    },
    {
        path: "/dashboard",
        name: "Dashboard",
        component: Dashboard,
        meta: { requiresAuth: true },
    },
    {
        path: "/create-competition",
        name: "CreateCompetition",
        component: CreateCompetition,
        meta: { requiresAuth: true },
    },
    {
        path: "/competitions/:id",
        name: "CompetitionDetail",
        component: CompetitionDetail,
        meta: { requiresAuth: true },
    },
    {
        path: "/invite/:id",
        name: "Invite",
        component: Invite,
        meta: { requiresAuth: true },
    },
    {
        path: "/",
        redirect: "/dashboard",
    },
    {
        path: "/:pathMatch(.*)*",
        redirect: "/dashboard",
    },
];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
});

router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore();

    // Always check auth on initial load (when there's no previous route)
    // or if we haven't verified auth state yet
    if (!from.name) {
        await authStore.checkAuth();
    }

    const requiresAuth = (to.meta.requiresAuth as boolean) ?? true;
    const isAuthenticated = authStore.isAuthenticated;

    if (requiresAuth && !isAuthenticated) {
        // Redirect to login if trying to access protected route, preserve intended destination
        next({ path: "/login", query: { redirect: to.fullPath } });
    } else if (
        !requiresAuth &&
        isAuthenticated &&
        (to.path === "/login" || to.path === "/register")
    ) {
        // Redirect to dashboard if already logged in trying to access login/register
        next("/dashboard");
    } else {
        next();
    }
});

export default router;
