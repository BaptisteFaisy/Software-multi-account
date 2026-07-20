# ClawSweeper auto-hébergé

L’implémentation autonome est isolée de l’application Tauri dans deux dépôts
locaux frères :

- `clawsweeper/` : moteur et workflows GitHub Actions ;
- `clawsweeper-state/` : renderer du dashboard et initialisation de la branche
  d’état durable.

Les deux dépôts conservent leur remote public sous le nom `upstream` et leur
branche locale de travail s’appelle `self-hosted`. Ils doivent être publiés dans
des dépôts GitHub distincts pour que leurs workflows et leurs branches aient le
comportement attendu.

La configuration actuelle cible
`BaptisteFaisy/Software-multi-account`, reste désactivée et interdit toute
mutation. Les instructions complètes se trouvent dans
[`clawsweeper/docs/self-hosted.md`](clawsweeper/docs/self-hosted.md).

Validation locale :

```powershell
cd clawsweeper
corepack pnpm install --frozen-lockfile
corepack pnpm run build:all
corepack pnpm run self-hosted:doctor

cd ..\clawsweeper-state
corepack pnpm install --frozen-lockfile
corepack pnpm run check
```
