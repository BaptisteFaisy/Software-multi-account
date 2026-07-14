# Référence frontend contrôlée — 15 juillet 2026

## Périmètre et reproductibilité

Commande :

```powershell
node scripts/measure-frontend-baseline.mjs --verify --label frontend-stable-2026-07-15
```

La commande copie les entrées utiles dans un instantané temporaire, vérifie que
la copie et la source ont les mêmes fingerprints SHA-256, puis exécute les tests
et le build dans cet instantané. `node_modules` est réutilisé par une jonction,
mais reste exclu du fingerprint. Le build reçoit un identifiant PWA dérivé du
fingerprint afin d'éliminer l'aléa de production sans changer les builds usuels.

Les dates de fichiers, PID, caches, `dist` et autres sorties de build sont
volontairement exclus. Une mesure est refusée si l'instantané change pendant la
validation ou si les entrées frontend réelles ont évolué avant la fin.

| Périmètre | SHA-256 | Fichiers | Octets source |
| --- | --- | ---: | ---: |
| Build frontend | `73a229e17b06cb5a1d025fb251a2121aa4c1a891c65f80dce80465617a7e3d2b` | 50 | 1 933 613 |
| Validation | `443694bcd74352ad84acd24b6ccaee0b8889fb84ef61b01be352d35cddac1db6` | 198 | 4 020 298 |

L'instantané a été obtenu dès la première tentative. À la fin, les entrées du
build réel correspondaient toujours au fingerprint. Le périmètre de validation
avait avancé en parallèle ; les 278 tests ci-dessous restent donc rattachés à
l'instantané exact, et non présentés comme une validation de changements backend
ultérieurs.

## Validation

- `npm run test:frontend` : **278/278 tests réussis**, 0 échec.
- `npm run build:frontend` : TypeScript et build Vite de production réussis.
- Identifiant déterministe : `perf-73a229e17b06cb5a`.
- Les cinq nouvelles icônes de la vue autonome sont enregistrées et le test
  d'utilisabilité correspondant réussit.
- Le test Windows de terminaison d'arbre vérifie toujours réellement
  `taskkill /T /F`; seule sa fenêtre de préparation factice accepte désormais
  une machine petite ou fortement chargée.

Les durées observées ne sont pas une référence produit : la machine exécutait
une charge mixte multi-agent. Elles ne doivent pas être comparées à une mesure
sur dépôt contrôlé ou à une cible matérielle minimale.

## Taille du chemin initial

Les tailles gzip utilisent le niveau 9 et Brotli la qualité 11.

| Type | Brut | gzip | Brotli |
| --- | ---: | ---: | ---: |
| JavaScript initial | 532 578 | 146 607 | 118 723 |
| CSS initial | 409 395 | 67 992 | 53 721 |
| **Total initial JS + CSS** | **941 973** | **214 599** | **172 444** |

Assets initiaux :

- `assets/index-BY3Jd6zh.js`
- `assets/index-CIMRQC-_.css`

## Code déjà différé

| Asset | Brut | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Runtime terminal JS | 288 976 | 67 590 | 56 468 |
| Runtime terminal CSS | 2 853 | 770 | 588 |
| Updater JS | 1 456 | 735 | 622 |

Les imports dynamiques restent classés comme différés ; ils ne sont pas ajoutés
au chemin initial.

## Premier goulot confirmé

Le JavaScript initial est le premier goulot : il représente **68,3 %** des
214 599 octets gzip initiaux, doit être analysé/exécuté, et Vite signale son
unique chunk de plus de 500 kB. Le CSS initial de 67 992 octets gzip est le
second goulot bloquant.

La prochaine tranche doit charger dynamiquement les vues absentes du premier
écran et déplacer leurs styles hors de la feuille initiale. Elle devra conserver
la grille de chats, les interfaces et tous les chemins de navigation, réussir la
suite, puis comparer les tailles avec les fingerprints avant/après.
