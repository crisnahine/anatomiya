/**
 * Twelve components, six per framework, written the way each framework's own
 * docs and its users write them. `test/component-rows.test.mjs` asks every JavaScript
 * row about each one, and the two lists below record what it found.
 */

const vueSetup = `<template>
  <article class="card" @click="selectCard">
    <Avatar ref="avatar" />
    <h2>{{ title }} {{ label }}</h2>
    <p v-if="error">{{ error }}</p>
  </article>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { formatName } from "./format";
import { api } from "../api";
import type { User } from "../types.js";
import Avatar from "./Avatar.vue";

interface Props {
  title: string;
  userId?: number;
}
type Emits = { (event: "select", id: number): void };

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const user = ref<User | null>(null);
const error = ref("");
const label = computed(() => formatName(user.value?.name || "unknown"));
const avatar = ref<InstanceType<typeof Avatar>>();

async function loadUser() {
  try {
    const response = await fetch(\`/users/\${props.userId}\`);
    user.value = await response.json();
  } catch (err) {
    error.value = String(err);
  }
}

const refresh = async () => {
  user.value = await api.get(props.userId ?? 0);
};

function selectCard() {
  for (const tag of user.value?.tags ?? []) {
    console.log(tag);
  }
  if (process.env.NODE_ENV !== "production") console.log(label.value);
  emit("select", user.value!.id);
}

function findUser(id: number) {
  if (!user.value) return null;
  return user.value.id === id ? user.value : avatar.value;
}

onMounted(loadUser);
</script>
`;

const vueOptions = `<template>
  <ul>
    <li v-for="todo in visible" :key="todo.id" @click="remove(todo.id)">{{ todo.title }}</li>
  </ul>
</template>

<script>
import { fetchTodos } from "./todos.js";
import logger from "../logger";

export default {
  name: "TodoList",
  props: { limit: { type: Number, default: 10 } },
  data() {
    return {
      todos: [],
      loading: false,
      error: null,
    };
  },
  computed: {
    visible() {
      return this.todos.slice(0, this.limit || 10);
    },
  },
  async created() {
    this.loading = true;
    try {
      this.todos = await fetchTodos();
    } catch (err) {
      this.error = err;
      logger.warn("todos failed", err);
    } finally {
      this.loading = false;
    }
  },
  methods: {
    remove(id) {
      this.todos.forEach((todo, index) => {
        if (todo.id === id) this.todos.splice(index, 1);
      });
    },
    first() {
      if (this.todos.length === 0) return undefined;
      return this.todos[0];
    },
    async save() {
      await fetch("/todos", { method: "POST", body: JSON.stringify(this.todos) });
    },
    fail() {
      throw new Error("not implemented");
    },
  },
};
</script>
`;

const vueTwo = `<script lang="ts">
export const defaultCurrency = "USD";
export type Money = { amount: number; currency: string };
export interface IFormatOptions { digits?: number }

/** Formats an amount for display. */
export function formatMoney(money: Money, options: IFormatOptions = {}): string {
  const digits = options.digits ?? 2;
  return \`\${money.amount.toFixed(digits)} \${money.currency}\`;
}

export const parseMoney = (text: string) => {
  const [amount, currency] = text.split(" ");
  if (!currency) throw new TypeError("no currency");
  return { amount: Number(amount), currency };
};
</script>

<script setup lang="ts">
import { computed } from "vue";
import config from "../config";

const props = withDefaults(defineProps<{ amount: number; currency?: string }>(), {
  currency: defaultCurrency,
});
const model = defineModel<boolean>("expanded");

const text = computed(() => formatMoney({ amount: props.amount, currency: props.currency }));
const locale = config.locale;

function toggle() {
  model.value = !model.value;
}

const describe_price = () => {
  if (!props.amount) return undefined;
  return text.value;
};
</script>

<template>
  <span :title="describe_price()" @click="toggle">{{ text }} {{ locale }}</span>
</template>
`;

const vueJsSetup = `<script setup>
import { computed, ref, watch } from "vue";
import { useCartStore } from "../stores/cart";
import { request } from "../request.js";
import settings from "../settings.js";

const props = defineProps({
  currency: { type: String, default: "EUR" },
  options: { type: Object, default: null },
});
const emit = defineEmits(["checkout"]);

const cart = useCartStore();
const coupon = ref("");
let attempts = 0;
let lastError = null;

const total = computed(() => {
  let sum = 0;
  cart.items.forEach((item) => {
    sum += item.price * (item.quantity || 1);
  });
  return sum;
});

const taxRate = settings.taxRate ?? 0.2;

watch(coupon, async (code) => {
  if (!code) return;
  try {
    await request("/coupons", { code });
  } catch (e) {
    lastError = "coupon rejected";
  }
});

const checkout = async () => {
  attempts++;
  const label = props.options?.label || "Checkout";
  emit("checkout", { label, total: total.value * (1 + taxRate) });
};

const clear_coupon = function () {
  coupon.value = "";
  return undefined;
};
</script>

<template>
  <button :disabled="attempts > 3" @click="checkout">{{ total }} {{ currency }}</button>
  <input v-model="coupon" /><a @click="clear_coupon">clear</a><span>{{ lastError }}</span>
</template>
`;

const vueClass = `<template>
  <section><h3>{{ title }}</h3><slot v-if="open" /></section>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import type { PanelState } from "./state";
import { loadState } from "./state";

type TCloseReason = "user" | "timeout";
interface IPanelEvent { reason: TCloseReason }

/**
 * A collapsible panel.
 */
@Component
export default class LegacyPanel extends Vue {
  @Prop({ default: "" }) readonly heading!: string;
  state: PanelState | null = null;
  open = false;

  async mounted(): Promise<void> {
    this.state = await loadState();
  }

  toggle(): void {
    this.open = !this.open;
    this.$emit("toggle", this.open);
  }

  close(event: IPanelEvent) {
    if (event.reason === "timeout") {
      throw new Error("timed out");
    }
    this.open = false;
  }

  get title(): string | null {
    if (!this.heading) return null;
    return this.heading.toUpperCase();
  }
}
</script>
`;

const vueDefine = `<template>
  <ul><li v-for="row in data" :key="row.id">{{ row.title }}</li></ul>
  <p v-if="error">{{ error }}</p>
</template>

<script>
import { defineComponent, onMounted, ref, watch } from "vue";
import { search } from "./search.js";
import { log } from "../logging.js";

const RETRY_LIMIT = 3;

export default defineComponent({
  name: "ResultList",
  props: { query: { type: String, required: true } },
  setup(props) {
    const data = ref([]);
    const error = ref(null);
    let attempts = 0;

    async function load() {
      try {
        data.value = await search(props.query);
      } catch {
        error.value = "search failed";
        log("search failed");
      }
    }

    const retry = () => {
      if (attempts >= RETRY_LIMIT) return;
      attempts += 1;
      error.value = null;
      load();
    };

    onMounted(load);
    watch(() => props.query, retry);
    return { data, error };
  },
});
</script>
`;

const svelteRunes = `<script lang="ts">
  import { onMount } from "svelte";
  import { formatCount } from "./format";
  import http from "../http.js";
  import type { Snippet } from "svelte";
  import Dialog from "./Dialog.svelte";

  interface Props {
    start?: number;
    children?: Snippet;
    onchange?: (value: number) => void;
  }
  type Step = 1 | 5 | 10;

  let { start = 0, children, onchange }: Props = $props();
  let count = $state(start);
  let step: Step = $state(1);
  let name = $state("");
  let dialog = $state<Dialog>();
  const doubled = $derived(count * 2);
  const label = $derived.by(() => formatCount(doubled) || "none");

  $effect(() => {
    console.log("count is", count);
    onchange?.(count);
  });

  function increment() {
    count += step;
  }

  const resetCount = () => {
    count = start;
  };

  async function saveCount() {
    try {
      await http.post("/count", { count });
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async function loadCount() {
    const response = await fetch("/count");
    for (const item of await response.json()) count += item.count ?? 0;
  }

  onMount(loadCount);
</script>

<button onclick={increment}>{label}</button>
<button onclick={resetCount}>reset</button><button onclick={saveCount}>save</button>
<input bind:value={name} /><select bind:value={step}><option>1</option></select>
<Dialog bind:this={dialog} />
{@render children?.()}
`;

const svelteLegacy = `<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import { session, theme } from "./stores.js";
  import { env } from "../env";
  import Badge from "./Badge.svelte";

  export let user_id: number;
  export let userName = "anonymous";
  export let useCache = true;
  export let useCompactLayout = false;
  export let onSelect = (id: number) => {};
  export let formatLabel = (text: string) => text.trim();

  const dispatch = createEventDispatcher<{ select: { id: number } }>();
  let visits = 0;
  let timer: ReturnType<typeof setInterval>;

  $: greeting = \`Hello \${userName || "you"}\`;
  $: isAdmin = $session.user?.role === "admin";
  $: if (visits > 10) {
    console.warn("many visits", user_id);
  }
  $: darkMode = $theme === "dark";
  $: cached = useCache && !useCompactLayout;

  function handleClick() {
    visits += 1;
    onSelect(user_id);
    dispatch("select", { id: user_id });
  }

  function start_timer() {
    timer = setInterval(() => (visits += 1), env.interval);
  }

  export function reset() {
    visits = 0;
    return null;
  }

  onDestroy(() => clearInterval(timer));
</script>

<Badge on:click={handleClick} on:mouseenter={start_timer}>{greeting}</Badge>
{#if isAdmin}<span class:dark={darkMode} class:cached>{formatLabel(userName)}</span>{/if}
`;

const svelteStore = `<script context="module">
  let nextId = 0;
  export const MAX_VISIBLE = 5;
</script>

<script>
  import { onMount } from "svelte";
  import { notifications } from "./stores";
  import { logger } from "../logger.js";
  import api from "../api.js";

  export let limit = MAX_VISIBLE;
  let loading = false;
  let failed;

  $: visible = $notifications.slice(0, limit);
  $: unread = visible.filter((note) => !note.read).length;
  $: document.title = unread ? \`(\${unread}) inbox\` : "inbox";

  const dismiss = (id) => {
    $notifications = $notifications.filter((note) => note.id !== id);
  };

  function dismissAll() {
    visible.forEach((note) => dismiss(note.id));
    logger.info("dismissed", visible.length);
  }

  async function refresh() {
    loading = true;
    try {
      const fresh = await api.get("/notifications");
      for (const note of fresh) note.id = nextId++;
      $notifications = fresh;
    } catch (error) {
    } finally {
      loading = false;
    }
  }

  function titleOf(note) {
    if (!note) return undefined;
    return note.title || "untitled";
  }

  onMount(refresh);
</script>

{#if loading}<p>loading</p>{:else if failed}<p>failed</p>{/if}
<button on:click={dismissAll}>clear</button>
{#each visible as note}<p on:click={() => dismiss(note.id)}>{titleOf(note)}</p>{/each}
`;

const svelteForm = `<script>
  import { tick } from "svelte";
  import { validateEmail } from "./validate.js";
  import config from "../config.js";

  let { email = $bindable(""), onsubmit } = $props();
  let password = $state("");
  let errors = $state([]);
  let submitting = $state(false);
  let inputElement;

  const canSubmit = $derived(email.length > 0 && password.length >= (config.minPassword ?? 8));

  $effect(() => {
    if (errors.length) tick().then(() => inputElement?.focus());
  });

  function validate() {
    const found = [];
    if (!validateEmail(email)) found.push("email");
    if (password.length < 8) found.push("password");
    errors = found;
    return found.length === 0 ? null : found;
  }

  const submit = async (event) => {
    event.preventDefault();
    if (validate()) return;
    submitting = true;
    try {
      const response = await fetch(config.endpoint || "/login", { method: "POST" });
      if (!response.ok) throw new Error("login failed");
      onsubmit(result());
    } catch (e) {
      errors = [String(e)];
    } finally {
      submitting = false;
    }
  };

  function result() {
    return { ok: errors.length === 0, error: errors[0] };
  }
</script>

<form onsubmit={submit}>
  <input bind:value={email} bind:this={inputElement} /><input type="password" bind:value={password} />
  <button disabled={!canSubmit || submitting}>log in</button>
</form>
`;

const svelteTwo = `<script lang="ts" module>
  import type { Row } from "./types";

  export type SortDirection = "asc" | "desc";
  export interface TableOptions { pageSize?: number }
  export const defaultPageSize = 25;

  export class TableError extends Error {}

  /** Orders rows by one column. */
  export function sortRows(rows: Row[], column: string, direction: SortDirection): Row[] {
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (a[column] > b[column] ? sign : -sign));
  }
</script>

<script lang="ts">
  interface Props { rows: Row[]; options?: TableOptions }

  let props: Props = $props();
  let column = $state("id");
  let direction: SortDirection = $state("asc");

  const pageSize = $derived(props.options?.pageSize ?? defaultPageSize);
  const sorted = $derived(sortRows(props.rows, column, direction).slice(0, pageSize));

  function toggleDirection() {
    direction = direction === "asc" ? "desc" : "asc";
  }

  function pick(name: string) {
    if (!props.rows.length) throw new TableError("no rows");
    column = name;
  }

  export function firstRow() {
    return sorted[0] ?? null;
  }
</script>

<table>
  <thead><tr><th onclick={() => pick("id")}>id</th><th onclick={toggleDirection}>{direction}</th></tr></thead>
  <tbody>{#each sorted as row}<tr><td>{row.id}</td></tr>{/each}</tbody>
</table>
`;

const svelteTabs = `<script lang="ts" generics="T extends { id: string }">
  import { setContext } from "svelte";
  import { TabRegistry } from "./registry.js";
  import assert from "./assert.js";

  class TabState extends TabRegistry {
    active = $state("");
    select(id: string) {
      this.active = id;
    }
  }

  type TabId = string;
  interface ITabsProps { items: T[]; initial?: TabId }

  const { items, initial }: ITabsProps = $props();
  const tabs = new TabState();
  setContext("tabs", tabs);

  $effect.pre(() => {
    tabs.select(initial ?? items[0]!.id);
  });

  function labelFor(item: T) {
    try {
      return JSON.parse(item.id).label ?? "tab";
    } catch (cause) {
      throw new Error("bad tab id", { cause });
    }
  }

  const is_active = (item: T): boolean => tabs.active === item.id;

  function ids() {
    const out: TabId[] = [];
    for (const item of items) out.push(item.id);
    return out;
  }

  assert(items.length > 0);
</script>

{#each items as item}
  <button class:active={is_active(item)} onclick={() => tabs.select(item.id)}>{labelFor(item)}</button>
{/each}
<small>{ids().join(", ")}</small>
`;

export const COMPONENT_FIXTURES = [
  { id: "vue-setup", lang: "vue", rel: "src/components/UserCard.vue", source: vueSetup },
  { id: "vue-options", lang: "vue", rel: "src/components/TodoList.vue", source: vueOptions },
  { id: "vue-two", lang: "vue", rel: "src/components/PriceTag.vue", source: vueTwo },
  { id: "vue-js-setup", lang: "vue", rel: "src/components/CartSummary.vue", source: vueJsSetup },
  { id: "vue-class", lang: "vue", rel: "src/components/LegacyPanel.vue", source: vueClass },
  { id: "vue-define", lang: "vue", rel: "src/components/ResultList.vue", source: vueDefine },
  { id: "svelte-runes", lang: "svelte", rel: "src/lib/Counter.svelte", source: svelteRunes },
  { id: "svelte-legacy", lang: "svelte", rel: "src/lib/Profile.svelte", source: svelteLegacy },
  { id: "svelte-store", lang: "svelte", rel: "src/lib/Notifications.svelte", source: svelteStore },
  { id: "svelte-form", lang: "svelte", rel: "src/lib/LoginForm.svelte", source: svelteForm },
  { id: "svelte-two", lang: "svelte", rel: "src/lib/DataTable.svelte", source: svelteTwo },
  { id: "svelte-tabs", lang: "svelte", rel: "src/lib/Tabs.svelte", source: svelteTabs },
];

/** The rows that answer a component's script as a person would, per framework. */
export const HOLDS = {
  vue: [
    "swallowed_error", "async_error_handling", "hook_per_module", "function_style", "explicit_return_type",
    "import_extension", "nullish_default", "non_null_assertion", "absent_is_null", "iterate_with_for_of",
    "test_call_style", "assertion_style", "doc_comment_style", "function_naming_case", "exported_symbol_case",
    "exported_class_case", "exported_type_case", "extends_base", "interface_prefix", "type_alias_prefix",
    "route_logging", "route_network", "route_env", "file_naming_case",
  ],
  svelte: [
    "swallowed_error", "error_shape", "async_error_handling", "function_style", "explicit_return_type",
    "import_extension", "nullish_default", "non_null_assertion", "absent_is_null", "iterate_with_for_of",
    "test_call_style", "assertion_style", "doc_comment_style", "function_naming_case", "exported_symbol_case",
    "exported_class_case", "exported_type_case", "extends_base", "interface_prefix", "type_alias_prefix",
    "route_logging", "route_network", "route_env", "file_naming_case",
  ],
};

/**
 * The rows that misread a component, the construct each misreads, and the
 * fixture that shows it. `langs` is where the row stays out.
 */
export const EXCLUDED = [
  {
    key: "module_state_const",
    langs: ["vue", "svelte"],
    decidedBy: { vue: "vue-setup", svelte: "svelte-runes" },
    why: "The top level of `<script setup>` and of a Svelte instance script runs once per component instance, and a `let` there that only the template writes (`bind:value`) reads as one where const was available.",
  },
  {
    key: "optional_chaining",
    langs: ["vue", "svelte"],
    decidedBy: { vue: "vue-setup", svelte: "svelte-two" },
    why: "`props` is what `defineProps()`, `setup(props)` and `$props()` hand a component, which is never absent, and the row reads every `props.x` as an optional value read without `?.`.",
  },
  {
    key: "type_only_import",
    langs: ["vue", "svelte"],
    decidedBy: { vue: "vue-setup", svelte: "svelte-runes" },
    why: "A component the template renders is read as a value there, which the script does not show, so one also named in a type (`InstanceType<typeof Avatar>`, `$state<Dialog>()`) reads as type-only.",
  },
  {
    key: "error_shape",
    langs: ["vue"],
    decidedBy: { vue: "vue-define" },
    why: "A Vue `setup()` or `data()` returns the bindings its template reads, and `return { data, error }` there reads as a returned result. Measured over 1,085 Vue files in two repositories and 170 more in two others: 37 sites, every one a throw, and the row states nothing from throws alone, so listing it buys no claim and risks a false one.",
  },
  {
    key: "hook_per_module",
    langs: ["svelte"],
    decidedBy: { svelte: "svelte-legacy" },
    why: "Svelte 4's `export let` declares a prop, and a prop named `useCache` reads as an exported hook. Measured over 3,132 Svelte files in four repositories: no site at all, so there is nothing a skip would let the row say.",
  },
];
