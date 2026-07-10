fn main() {
    // Build Tauri standard : regenere les manifestes ACL (gen/schemas), embarque
    // l'icône et (sur Windows) le manifeste Common-Controls v6 via resource.lib.
    // Indispensable : sans lui, event.listen est refuse ("Plugin not found") et
    // l'exe peut planter au lancement (TaskDialogIndirect v6 non resolu -> 0xC0000139).
    tauri_build::build();
}
