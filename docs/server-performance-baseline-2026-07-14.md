# Référence de ressources du serveur — 14 juillet 2026

## Scénario observé

Mesure en lecture seule de l'arbre du processus `cst-server` (PID 110420) avec
`scripts/measure-server-resources.ps1`. La fenêtre demandée était de 12 secondes,
avec un échantillon par seconde et un rafraîchissement de l'arbre toutes les
4 secondes.

Cette capture n'est **pas** une mesure au repos : six processus `codex` étaient
actifs dans l'arbre, avec plusieurs commandes Node et PowerShell concurrentes.
Elle constitue donc la référence initiale de **charge mixte multi-agent**. Une
future comparaison doit reproduire ce scénario ou utiliser une référence au
repos distinctement étiquetée.

## Résultats

| Mesure | Résultat |
| --- | ---: |
| Durée réellement observée | 15,524 s |
| Échantillons exploitables | 6 |
| CPU de l'arbre | 15,531 CPU-s |
| CPU moyen | 100,05 % d'un cœur / 8,34 % de la machine |
| Processus | 38 au début / 51 au pic |
| Working set | 1 554,04 Mio au début / 2 283,32 Mio au pic |
| Mémoire privée | 1 211,15 Mio au début / 1 767,43 Mio au pic |
| Threads | 670 au début / 819 au pic |
| Handles | 10 260 au début / 14 188 au pic |

Répartition CPU sur la fenêtre :

| Nom de processus | Nombre observé | CPU-s | % d'un cœur |
| --- | ---: | ---: | ---: |
| `node` | 7 au début / 12 au pic | 7,328 | 47,21 % |
| `powershell` | 7 au début / 11 au pic | 3,453 | 22,24 % |
| `codex` | 6 | 3,062 | 19,73 % |
| `cst-server` | 1 | 1,469 | 9,46 % |
| `codex-code-mode-host` | 5 au début / 6 au pic | 0,078 | 0,50 % |

## Interprétation et prochaine mesure

Le coût dominant vient des processus enfants lancés pour les agents, pas de la
boucle principale du serveur. La prochaine tranche doit donc inventorier le
cycle de vie des descendants (création, maintien après un tour, terminaison et
relance) et vérifier si des processus restent vivants sans travail utile.

Le sampler exclut son propre arbre. Sa collecte a néanmoins été lente sur cette
machine chargée (1,98 s en moyenne par échantillon), ce qui explique que 6
échantillons seulement couvrent 15,524 secondes. Les comparaisons avant/après
devront conserver les mêmes paramètres et signaler toute activité concurrente.
