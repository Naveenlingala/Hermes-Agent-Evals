import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/OverviewPage.vue') },
    { path: '/experiments', component: () => import('./pages/ExperimentsPage.vue') },
    { path: '/experiments/:id', component: () => import('./pages/ExperimentPage.vue') },
    { path: '/runs/:id', component: () => import('./pages/RunPage.vue') },
    { path: '/tasks', component: () => import('./pages/TasksPage.vue') },
    { path: '/configs', component: () => import('./pages/ConfigsPage.vue') },
    { path: '/evaluators', component: () => import('./pages/EvaluatorsPage.vue') },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFoundPage.vue') },
  ],
  scrollBehavior: (to) => (to.hash ? { el: to.hash, behavior: 'smooth' } : { top: 0 }),
});
router.afterEach(() => { import('./ui').then(({ ui }) => (ui.navOpen = false)); });
