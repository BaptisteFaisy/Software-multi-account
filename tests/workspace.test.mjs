import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeWorkspaceProfiles,
  normalizeWorkspacePath,
} from "../src/workspace.ts";

test("les variantes d'un meme chemin Windows ont la meme identite", () => {
  assert.equal(
    normalizeWorkspacePath(" C:\\Projects\\Codex-Switch-Terminal\\ "),
    "c:/projects/codex-switch-terminal",
  );
  assert.equal(
    normalizeWorkspacePath("c:/projects/codex-switch-terminal"),
    "c:/projects/codex-switch-terminal",
  );
});

test("les workspaces identiques fusionnent meme si leurs anciens ids different", () => {
  const merged = mergeWorkspaceProfiles([
    {
      id: "ancien-id-local",
      label: "Codex Switch Terminal",
      path: "C:\\Projects\\Codex-Switch-Terminal\\",
    },
    {
      id: "ancien-id-distant",
      label: "Doublon",
      path: "c:/projects/codex-switch-terminal",
    },
  ]);

  assert.equal(merged.changed, true);
  assert.deepEqual(merged.workspaces, [
    {
      id: "c:/projects/codex-switch-terminal",
      label: "Codex Switch Terminal",
      path: "C:\\Projects\\Codex-Switch-Terminal\\",
    },
  ]);
});

test("deux chemins Unix dont seule la casse differe restent distincts", () => {
  const merged = mergeWorkspaceProfiles([
    { id: "x", label: "app", path: "/srv/App" },
    { id: "y", label: "app", path: "/srv/app" },
  ]);

  assert.equal(merged.workspaces.length, 2);
});
