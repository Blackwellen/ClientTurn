import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A confirm dialog opened from a drawer (every connection's "Disconnect")
 * rendered under the portalled drawer and could not be clicked (owner report,
 * 2026-09-28). The dialog is now portalled above drawers, and only the top
 * overlay layer answers Escape and Tab.
 */
const read = (path: string) => readFileSync(path, "utf8");
const zOf = (src: string, marker: RegExp) => {
  const m = src.match(marker);
  assert.ok(m, `no z-index found for ${marker}`);
  return Number(m[1]);
};

test("the modal is portalled to the body, above the drawer", () => {
  const modal = read("src/components/ui/modal.tsx");
  const drawer = read("src/components/ui/drawer.tsx");
  assert.match(modal, /createPortal\(/);
  assert.match(modal, /document\.body/);
  const modalZ = zOf(modal, /fixed inset-0 z-\[?(\d+)\]?/);
  const drawerZ = zOf(drawer, /"fixed inset-0 z-\[?(\d+)\]?/);
  assert.ok(modalZ > drawerZ, `modal z ${modalZ} must be above drawer z ${drawerZ}`);
});

test("toasts stay visible above an open dialog", () => {
  const modalZ = zOf(read("src/components/ui/modal.tsx"), /fixed inset-0 z-\[?(\d+)\]?/);
  const toastZ = zOf(read("src/components/ui/toast.tsx"), /right-4 z-\[(\d+)\]/);
  assert.ok(toastZ > modalZ);
});

test("only the top overlay layer handles Escape and Tab", () => {
  const drawer = read("src/components/ui/drawer.tsx");
  assert.match(drawer, /const layerStack/);
  assert.match(drawer, /e\.key === "Escape" && isTop\(\)/);
  assert.match(drawer, /!isTop\(\)\) return;/);
});

test("every overlay that traps focus shares its layer with its Escape handler", () => {
  const files = [
    "src/components/ui/modal.tsx",
    "src/components/ui/drawer.tsx",
    "src/components/app/command-palette.tsx",
    "src/components/app/app-shell.tsx",
    "src/components/admin/admin-shell.tsx",
    "src/components/support/support-popout.tsx",
    "src/components/copilot/copilot-drawer.tsx",
    "src/components/affiliates/shell/affiliate-search.tsx",
    "src/components/affiliates/shell/affiliate-portal-shell.tsx",
    "src/components/marketing/find-leads/hero/previous-chats-drawer.tsx",
  ];
  for (const file of files) {
    const src = read(file);
    const trap = src.match(/useFocusTrap\((\w+),/);
    assert.ok(trap, `${file}: no useFocusTrap`);
    assert.match(src, new RegExp(`useEscape\\([^;]*,\\s*${trap[1]}\\)`), `${file}: useEscape must pass ${trap[1]}`);
  }
});
