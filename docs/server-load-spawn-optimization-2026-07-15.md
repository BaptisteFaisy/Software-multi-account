# Validation des lancements Codex sous charge — 15 juillet 2026

## Tranche validee

Sur Windows, `ChatTurnManager` resout le shim npm officiel `codex.cmd` vers le
binaire `codex.exe` livre dans le meme paquet. Le serveur reproduit les
variables de gestion du lanceur npm, mais ne conserve plus `cmd.exe` et Node
entre le serveur et Codex pendant tout le tour.

Cette optimisation est volontairement conservative : elle ne s'applique qu'au
layout npm officiel, identifie par `codex.cmd` et `bin/codex.js`. Une commande
personnalisee ou un paquet incomplet conserve le chemin historique. Sur la
machine mesuree, le shim et le binaire natif annoncaient tous deux
`codex-cli 0.144.1`.

## Scenario reel

Le serveur principal deja en ecoute sur `127.0.0.1:8080`, construit apres
l'optimisation, a ete mesure en lecture seule avec :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\measure-server-resources.ps1 `
  -RootProcessId <pid-du-serveur> `
  -DurationSeconds 12 `
  -SampleIntervalMilliseconds 1000 `
  -ProcessTreeRefreshMilliseconds 4000 `
  -Label native-codex-live-load-2026-07-15
```

La fenetre a couvert 12,555 secondes et 12 echantillons. Sept processus Codex
etaient presents au debut et cinq a la fin, plusieurs tours s'etant termines
pendant la capture. Le sampler n'a observe ni `node` ni `cmd` dans l'arbre du
serveur. Les PowerShell observes restent ceux des terminaux persistants ou des
commandes d'agents et ne sont pas candidats a une suppression globale.

## Resultats et comparaison

| Mesure | Reference mixte du 14 juillet | Binaire natif du 15 juillet |
| --- | ---: | ---: |
| Processus Codex | 6 | 7 au debut / 5 a la fin |
| Processus totaux au pic | 51 | 31 |
| Working set au pic | 2 283,32 Mio | 864,45 Mio |
| Memoire privee au pic | 1 767,43 Mio | 884,29 Mio |
| Threads au pic | 819 | 491 |
| Handles au pic | 14 188 | 9 056 |
| CPU de l'arbre | 15,531 CPU-s | 0,875 CPU-s |
| Lanceurs Node observes | 7 au debut / 12 au pic | 0 |

La topologie est la preuve comparable la plus robuste : avec au moins autant de
processus Codex qu'a la reference, les lanceurs Node intermediaires ont disparu.
Les ecarts globaux de CPU et de memoire restent directionnels, car le contenu du
travail n'etait pas identique et plusieurs tours se sont termines pendant la
seconde fenetre. Ils ne doivent pas etre interpretes comme un benchmark de
vitesse du modele.

## Garde-fous fonctionnels

Le test Rust
`chat::tests::official_npm_codex_uses_its_native_binary_with_safe_fallbacks`
verifie la selection du binaire officiel, le refus d'optimiser un shim
personnalise et le repli sur `codex.cmd` lorsque le binaire natif manque. Le
binaire execute reste celui du paquet Codex installe : ni le protocole JSONL,
ni les options de modele, outils ou sandbox, ni l'interface ne changent.

## Garde-fou de regression reproductible

Le budget versionne dans `config/server-resource-budget.json` n'accepte une
capture que si elle reproduit le scenario de reference : serveur Windows
`cst-server`, six ou sept processus Codex au premier echantillon, sept au pic
au maximum, au moins un terminal PowerShell persistant directement rattache au
serveur, et aucun processus Node ou `cmd` observe. La fenetre dure 12 secondes,
avec un echantillon par seconde et un rafraichissement de l'arbre toutes les
quatre secondes.

Les plafonds agreges gardent une marge de 16 a 27 % sur la capture native :

| Mesure au pic | Reference | Budget |
| --- | ---: | ---: |
| Processus | 31 | 36 |
| Working set | 864,45 Mio | 1 100 Mio |
| Memoire privee | 884,29 Mio | 1 100 Mio |
| Threads | 491 | 600 |
| Handles | 9 056 | 11 000 |

Le CPU reste mesure mais n'a pas de plafond dur : sans travail d'agent
identique, son delta ne permet pas de distinguer une regression du contenu des
tours. La topologie, elle, interdit les lanceurs Node ou `cmd` directement sous
le serveur et exige que les Codex initiaux soient ses enfants directs.

Depuis une fenetre ou six a sept tours Codex et au moins un terminal persistant
sont deja actifs, le controle complet s'execute avec :

```powershell
npm run verify:resource-regression -- -RootProcessId <pid-du-serveur>
```

Une capture deja produite peut etre rejouee sans refaire la mesure :

```powershell
npm run verify:resource-regression -- -CapturePath <capture.json>
```

Le script refuse d'abord toute capture non comparable, puis execute en serie
les contrats du budget et du sampler, le cycle de vie des enfants, les
invariants de l'interface et des terminaux, ainsi que l'unique test Rust du
lancement natif. Il ne ferme aucun terminal persistant et ne publie aucun
artefact.
