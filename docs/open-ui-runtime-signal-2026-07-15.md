# Signal runtime d'une interface chat distante — 15 juillet 2026

## Résultat retenu

Le scénario connecté de référence a été rejoué avec le même serveur Windows x64
isolé, une page Chrome headless visible de 1 440 × 900 et quatre chats. Il ne
contient aucun tour actif, agent autonome utilisateur ni terminal. Deux fenêtres
de 30 secondes utilisent le nouveau signal partagé `/ws/runtime`.

Les deux fenêtres ont produit exactement zéro requête vers
`/api/chat/turns/active`, `/api/autonomous-agents`,
`/api/private-messages/users` et `/api/private-messages/conversations`. Seul le
contrôle des limites reste périodique, avec un GET par fenêtre. Les snapshots REST
restent lus au démarrage, sur signal et pendant le repli de reconnexion. Les
notifications privées sont isolées aux deux participants avant leur envoi sur le
WebSocket ; une modification du catalogue public des destinataires reste visible
par tous les utilisateurs connectés.

## Trafic observé

| Route ou flux | Fenêtre 1 | Fenêtre 2 |
| --- | ---: | ---: |
| `GET /api/chat/turns/active` | 0 | 0 |
| `GET /api/autonomous-agents` | 0 | 0 |
| `GET /api/limits` | 1 | 1 |
| `GET /api/private-messages/users` | 0 | 0 |
| `GET /api/private-messages/conversations` | 0 | 0 |
| `/ws/runtime` reçues / envoyées / fermées | 2 / 2 / 0 | 2 / 2 / 0 |

Le canal runtime était ouvert avant chaque fenêtre et n'a subi aucune fermeture.
Les quatre chats et la barre latérale sont restés visibles. Le flux ne transporte
que le sujet modifié et une révision ; les données métier restent protégées par
les routes REST existantes. Si tous les sockets d'un catalogue multi-nœuds ne
sont pas actifs, les intervalles historiques de 1, 2 et 8 secondes reprennent.
Un échec REST alors que le socket reste actif est lui aussi retenté à la cadence
du sujet concerné, sans boucle rapide.

## Ressources et artefacts

Les fenêtres ont duré 30,065 et 30,072 secondes, avec 31 puis 25 échantillons.
Le serveur a consommé 0,031 puis 0,078 CPU-s, soit une médiane de 0,055 CPU-s et
un écart de 0,047 CPU-s. Les répétitions CPU ne sont donc pas stables et ne
permettent pas d'annoncer un gain précis. Le working set au pic a été de 29,61
puis 26,45 Mio, pour une médiane de 28,03 Mio, sans régression grossière visible.

Le binaire copié par le harnais porte le SHA-256
`2DD5E98E887B580B4AC5BF9E60B70C13C14DDB86EE3CD342A2C40CE883513EEE`.
Le frontend copié contient 45 fichiers et 2 177 853 octets, avec le SHA-256
`8F80CCDDE48067F1042209828DCF1089F2DFB4D43B8F9211996BB1D564DB2FE6`.

## Reproduction

```powershell
node scripts\measure-open-ui-baseline.mjs `
  --server-path src-tauri\target\release\cst-server.exe `
  --static-dir dist `
  --duration-seconds 30 `
  --repetitions 2 `
  --chat-count 4 `
  --sync-mode runtime-signal `
  --output .codex-proof\open-ui-private-message-signal-validated-2026-07-15.json
```

Le harnais copie le binaire et le frontend avant mesure, refuse toute réapparition
des quatre polls signalés, toute fermeture de `/ws/runtime`, toute requête externe
et toute variation de l'interface attendue. La capture ne contient ni jeton, ni
port, ni PID, ni compte fixture.
