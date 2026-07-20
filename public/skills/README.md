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
        "buttonLabel": "Mon skill", "icon": "sparkles",
        "description": "Use when … (déclencheur)", "tags": ["a", "b"] }
    ]
  }
  ```
- `<id>.md` ou `<id>/SKILL.md` : le **contenu** du skill. Le second format
  permet d'embarquer un skill standard avec ses dossiers `scripts/`,
  `references/` ou `assets/`; tout le paquet est copié dans `dist/skills/`.
  Un bouton épinglé et
  activé le transmet au moteur hors du message utilisateur ; « Ajouter au
  message » permet aussi de le placer directement dans le brouillon.
- `buttonLabel` et `icon` sont optionnels. Ils personnalisent le bouton que
  l'utilisateur peut épingler dans toutes ses fenêtres de chat depuis la vue
  Skills. Sans ces champs, le nom du skill et l'icône `sparkles` sont utilisés.

## Ajouter un skill depuis l'application

Dans la vue **Skills**, cliquer sur **Ajouter un skill**. Il est possible :

- d'importer un fichier `SKILL.md`, `.md` ou `.txt` (le frontmatter standard
  `name`, `description` et `tags` est repris automatiquement) ;
- ou de saisir directement le nom, la description, les tags et les
  instructions.

Les skills ainsi créés sont enregistrés localement sur l'appareil. Ils peuvent
être modifiés ou supprimés depuis leur carte et sont ajoutés immédiatement aux
boutons disponibles dans les chats.

## Ajouter un skill intégré à l'application

1. Déposer/éditer `public/skills/<id>.md`, ou un paquet standard
   `public/skills/<id>/SKILL.md` avec ses ressources.
2. Ajouter/mettre à jour l'entrée correspondante dans `index.json`.
3. Rebâtir le front (`npm run build:frontend`) pour recopier dans `dist/`.
   En dev (`npm run dev`), Vite sert `public/` directement.

Ces fichiers sont autonomes et versionnés.
