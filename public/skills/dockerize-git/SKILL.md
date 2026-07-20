---
name: dockerize-git
description: Package a Git repository as a portable Docker image, reusing its Dockerfile or safely generating one after stack analysis, and optionally deploy it over SSH to a Linux VPS. Use when a user provides a Git URL and asks to dockerize, export, move, self-host, or rapidly launch the project on a VPS.
---

# Dockerize Git

Turn one Git URL into a portable, traceable image bundle. Use the bundled deterministic script for cloning, detection, generation, build, export, and SSH deployment.

## Run the tool

Locate `scripts/dockerize-git.mjs` beside this skill and run it with Node. If `CST_DOCKERIZE_GIT_SCRIPT` is set, pass that exact path to Node; desktop builds expose the bundled script through this variable. In the Codex Switch Terminal source repository, prefer:

```text
npm run dockerize:git -- <git-url> [options]
```

In a packaged CST server, the same script is normally available at:

```text
node "$CST_STATIC_DIR/skills/dockerize-git/scripts/dockerize-git.mjs" <git-url> [options]
```

Use `--help` for the complete option list.

Common flows:

```text
# Analyze, build, and export image.tar.gz locally
npm run dockerize:git -- https://github.com/acme/project.git

# Analyze only; do not claim that an image was built
npm run dockerize:git -- https://github.com/acme/project.git --dry-run

# Build natively on a VPS, export the image, and start the container
npm run dockerize:git -- https://github.com/acme/project.git --deploy ubuntu@203.0.113.10 --ssh-key /path/to/key --install-docker

# Select one app from a monorepo
npm run dockerize:git -- https://github.com/acme/mono.git --context apps/api
```

## Workflow

1. Treat the repository as untrusted. Clone it into the isolated temporary directory created by the tool. Never run its install, build, test, or start commands directly on the host.
2. Reuse an existing Dockerfile verbatim. Otherwise let the tool detect Node.js, Python, Go, Rust, Maven/Gradle, or a static site and generate a production-oriented Dockerfile.
3. Read every detection warning. For ambiguous monorepos, select `--context`; for an unknown stack, inspect the repository and provide explicit `--base-image`, `--start-command`, and optional build commands.
4. Keep credentials outside the image. Never place Git credentials in the URL. Pass runtime secrets with `--env-file`; the safety ignore file excludes common secret files from the Docker build context.
5. Infer the container port when evidence is strong. Use `--container-port` and `--host-port` when the application or desired public port differs.
6. Prefer the native remote build when `--deploy` is given. It detects amd64 versus arm64, avoids cross-compilation surprises, verifies that the deployed container remains running, and removes temporary remote source files.
7. Verify the result before reporting success:
   - local build: Docker build and image inspection must pass, and `image.tar.gz` must exist unless `--no-export` was requested;
   - remote deployment: the tool must report the container as running;
   - dry run: report only that analysis and generated files succeeded.

## Deliverable

Return the detected stack, whether the Dockerfile was reused or generated, image reference, architecture, port mapping, bundle path, and deployment URL/status. Mention any required environment variables or unresolved application-specific health issue. Never claim portability across CPU architectures other than the architecture shown in `manifest.json`; build a second platform-specific bundle when needed.
