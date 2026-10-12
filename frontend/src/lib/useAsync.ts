import { onUnmounted, ref, shallowRef, type Ref } from 'vue';
import { ApiError } from '../api';

/** Loads data with loading/error state; optional polling while `keepPolling(data)` is true. */
export function useAsync<T>(fn: () => Promise<T>, opts: { keepPolling?: (d: T) => boolean; intervalMs?: number } = {}) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  const loading = ref(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dead = false;
  async function load() {
    try { data.value = await fn(); error.value = null; }
    catch (e) { error.value = e instanceof ApiError ? e.message : 'Unexpected error'; }
    loading.value = false;
    if (!dead && data.value && opts.keepPolling?.(data.value)) timer = setTimeout(load, opts.intervalMs ?? 1200);
  }
  load();
  onUnmounted(() => { dead = true; clearTimeout(timer); });
  return { data, error, loading, reload: () => { loading.value = true; return load(); } };
}
