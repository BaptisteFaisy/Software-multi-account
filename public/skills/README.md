# Skills (bibliothèque intégrée)

Ces fichiers **sont** la source des skills de l'app codex (vue « Skills » de la
barre d'outils). Ils sont embarqués dans l'app : Vite copie `public/skills/` dans
`dist/`, servi à `/skills/…`. Le front les lit par `fetch` — identique en desktop
(webview Tauri), web et mobile, sans backend supplémentaire.

## Format
- `index.json` : le manifeste.
  ```json
  {
    "skills": [
      { "id": "mon-skill", "file": "mon-skill.md", "name": "Mon skill",
        "description": "Use when … (déclencheur)", "tags": ["a", "b"] }
    ]
  }
  ```
- `<id>.md` : le **contenu** du skill (markdown brut), injecté tel quel dans la
  session Codex active (bouton « Injecter dans Codex », collage sans validation).

## Ajouter / modifier un skill
1. Déposer/éditer `public/skills/<id>.md`.
2. Ajouter/mettre à jour l'entrée correspondante dans `index.json`.
3. Rebâtir le front (`npm run build:frontend`) pour recopier dans `dist/`.
   En dev (`npm run dev`), Vite sert `public/` directement.

Ces fichiers sont autonomes et versionnés.
