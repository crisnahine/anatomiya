// What the page does once script runs: the theme, the menu, copy buttons, the session steps,
// the reveal on scroll, and the live find demo. Every part of the page reads without it.

const doc = document.documentElement;
doc.classList.add("js");
const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
const live = document.getElementById("announce");
const announce = (text) => {
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = text;
  });
};

// The theme: the system's until the reader picks one, which is kept where the browser allows it.
const THEME_KEY = "anatomiya-theme";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const themeButton = document.querySelector(".theme");
const shownTheme = () => doc.dataset.theme ?? (darkQuery.matches ? "dark" : "light");
const otherTheme = () => (shownTheme() === "dark" ? "light" : "dark");
const labelTheme = () => themeButton.setAttribute("aria-label", `Switch to the ${otherTheme()} theme`);
themeButton.addEventListener("click", () => {
  const next = otherTheme();
  doc.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage refused: the choice lasts this visit.
  }
  labelTheme();
  announce(`The ${next} theme is on.`);
});
darkQuery.addEventListener("change", labelTheme);
labelTheme();

// The menu on narrow screens.
const menu = document.querySelector(".menu");
const navList = document.getElementById("nav-list");
const setMenu = (open) => {
  menu.setAttribute("aria-expanded", String(open));
  navList.toggleAttribute("data-open", open);
};
menu.addEventListener("click", () => setMenu(menu.getAttribute("aria-expanded") !== "true"));
navList.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
    setMenu(false);
    menu.focus();
  }
});

// Copy buttons: a button's own text where it carries one, otherwise the block beside it.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}
for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const text = button.dataset.copy ?? button.parentElement.querySelector("pre").textContent;
    const copied = await copyText(text.trim());
    button.textContent = copied ? "Copied" : "Copy failed";
    button.toggleAttribute("data-done", copied);
    announce(copied ? "Copied to the clipboard." : "The browser did not allow copying. Select the text instead.");
    setTimeout(() => {
      button.textContent = "Copy";
      button.removeAttribute("data-done");
    }, 1800);
  });
}

// The session steps: links to each panel without script, a tab list with it.
const steps = document.querySelector("[data-tabs]");
if (steps !== null) {
  const list = steps.querySelector(".step-list");
  const tabs = [...list.querySelectorAll("[data-tab]")];
  const panels = tabs.map((tab) => document.getElementById(tab.hash.slice(1)));
  list.setAttribute("role", "tablist");
  for (const [i, tab] of tabs.entries()) {
    tab.setAttribute("role", "tab");
    tab.id = `tab-${panels[i].id}`;
    tab.setAttribute("aria-controls", panels[i].id);
    panels[i].setAttribute("role", "tabpanel");
    panels[i].setAttribute("aria-labelledby", tab.id);
    panels[i].tabIndex = 0;
  }
  const select = (chosen, { focus = false, reveal = false } = {}) => {
    for (const [i, tab] of tabs.entries()) {
      const on = i === chosen;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    }
    if (focus) tabs[chosen].focus();
    if (reveal) tabs[chosen].scrollIntoView({ block: "nearest", inline: "nearest", behavior: motion ? "smooth" : "auto" });
  };
  list.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab === null) return;
    event.preventDefault();
    select(tabs.indexOf(tab), { reveal: true });
  });
  list.addEventListener("keydown", (event) => {
    const at = tabs.indexOf(document.activeElement);
    if (at === -1) return;
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1, " ": at }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select((to + tabs.length) % tabs.length, { focus: true, reveal: true });
  });
  select(Math.max(0, tabs.findIndex((tab) => tab.hash === location.hash)));
}

// Sections fade in as they arrive, and the chart's bars grow, where motion is welcome.
const arriving = document.querySelectorAll(".reveal");
if (motion && "IntersectionObserver" in window) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.06 }
  );
  for (const element of arriving) seen.observe(element);
} else {
  for (const element of arriving) element.classList.add("in");
}

// The nav marks the section in view, and none above the first.
const sectionLinks = [...navList.querySelectorAll('a[href^="#"]')];
if ("IntersectionObserver" in window) {
  const inView = new Set();
  const current = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target.id);
        else inView.delete(entry.target.id);
      }
      const shown = sectionLinks.find((link) => inView.has(link.hash.slice(1))) ?? null;
      for (const link of sectionLinks) link.setAttribute("aria-current", String(link === shown));
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  for (const link of sectionLinks) {
    const section = document.getElementById(link.hash.slice(1));
    if (section !== null) current.observe(section);
  }
}

// The live find demo: the plugin's own find.mjs over the index the build scanned, loaded on approach.
const find = document.getElementById("find");
const form = find.querySelector(".find-form");
const input = find.querySelector("#find-q");
const statusLine = find.querySelector(".find-status");
const hitList = find.querySelector(".hits");
const commit = find.dataset.commit;
let loading = null;

function load() {
  loading ??= Promise.all([
    import("./lib/find.mjs"),
    fetch("data/index.json").then((response) => {
      if (!response.ok) throw new Error(`the index answered ${response.status}`);
      return response.json();
    }),
  ]).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

const blobUrl = (rel, line) => `https://github.com/crisnahine/anatomiya/blob/${commit}/${rel.split("/").map(encodeURIComponent).join("/")}#L${line}`;

async function run(words) {
  const asked = words.trim();
  if (asked === "") return;
  statusLine.textContent = "Loading the index.";
  let finder;
  let index;
  try {
    [finder, index] = await load();
  } catch (err) {
    statusLine.textContent = `The index did not load (${err.message}). Reload the page to try again.`;
    return;
  }
  hitList.replaceChildren();
  const count = index.count.toLocaleString("en-US");
  if (finder.queryWords([asked]).length === 0) {
    statusLine.textContent = `"${asked}" holds no word to look up: a letter alone or a word like "the" is in nearly every name.`;
    return;
  }
  const started = performance.now();
  const hits = finder.findSymbols(index, [asked]);
  const took = performance.now() - started;
  if (hits.length === 0) {
    statusLine.textContent = `No definition among the ${count} indexed matches "${asked}". Words nobody used in a name or a doc find nothing.`;
    return;
  }
  statusLine.textContent = `The ${hits.length} of ${count} indexed definitions closest to "${asked}", ranked in ${took < 1 ? "under 1" : Math.round(took)} ms in this tab:`;
  for (const hit of hits) {
    const line = finder.formatHit(hit);
    const head = `${hit.name}${hit.params ?? ""}`;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = blobUrl(hit.rel, hit.line);
    link.textContent = head;
    item.append(link, document.createTextNode(line.slice(head.length)));
    hitList.append(item);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  run(input.value);
});
for (const chip of find.querySelectorAll(".chips button")) {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.q;
    run(chip.dataset.q);
  });
}
input.addEventListener("focus", () => load().catch(() => {}), { once: true });

// Answer the first phrase once the section comes near, so the demo shows a real result before anyone types.
const firstPhrase = find.querySelector(".chips button")?.dataset.q ?? null;
if ("IntersectionObserver" in window && firstPhrase !== null) {
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      if (input.value === "") {
        input.value = firstPhrase;
        run(firstPhrase);
      }
    },
    { rootMargin: "200px 0px" }
  );
  near.observe(find);
}
