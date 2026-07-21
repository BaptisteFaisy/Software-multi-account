use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

pub(crate) const PROJECTS_DIRECTORY: &str = "SwitchProjects";
const MAX_LOG_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGitDockerEnvironmentRequest {
    pub repository_url: String,
    #[serde(default)]
    pub ref_name: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub deploy_target: String,
    #[serde(default)]
    pub ssh_key: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    #[serde(default)]
    pub install_docker: bool,
    #[serde(default)]
    pub accept_new_host_key: bool,
    #[serde(default)]
    pub container_port: Option<u16>,
    #[serde(default)]
    pub host_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDockerEnvironmentResult {
    pub repository_url: String,
    pub workspace_path: String,
    pub bundle_path: Option<String>,
    pub commit: String,
    pub mode: String,
    pub docker_status: String,
    pub message: String,
    pub log: String,
}

fn default_mode() -> String {
    "analyze".to_string()
}

fn default_ssh_port() -> u16 {
    22
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn create_git_docker_environment(
    request: CreateGitDockerEnvironmentRequest,
) -> Result<GitDockerEnvironmentResult, String> {
    let projects_root = desktop_projects_root()?;
    let bundles_root = crate::settings::runtime_data_path("docker-images")?;
    tokio::task::spawn_blocking(move || {
        create_git_docker_environment_in(&projects_root, &bundles_root, request)
    })
    .await
    .map_err(|error| format!("Creation de l'environnement interrompue: {error}"))?
}

#[cfg(feature = "desktop")]
fn desktop_projects_root() -> Result<PathBuf, String> {
    let base = env::var_os("CST_WORKSPACES_ROOT")
        .or_else(|| env::var_os("USERPROFILE"))
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from);
    match base {
        Some(base) => Ok(base.join(PROJECTS_DIRECTORY)),
        None => crate::settings::runtime_data_path(PROJECTS_DIRECTORY),
    }
}

pub fn create_git_docker_environment_in(
    projects_root: &Path,
    bundles_root: &Path,
    request: CreateGitDockerEnvironmentRequest,
) -> Result<GitDockerEnvironmentResult, String> {
    let repository_url = validate_repository_url(&request.repository_url)?;
    let ref_name = validate_ref_name(&request.ref_name)?;
    let mode = validate_mode(&request.mode)?;
    validate_ports(request.container_port, request.host_port)?;
    if mode == "deploy" {
        validate_deploy_target(&request.deploy_target)?;
    }
    if request.ssh_port == 0 {
        return Err("Le port SSH doit etre compris entre 1 et 65535".to_string());
    }
    if request.ssh_key.contains(['\0', '\r', '\n']) {
        return Err("Le chemin de cle SSH est invalide".to_string());
    }

    let script = dockerize_script_path().ok_or_else(|| {
        "Le moteur Docker Git embarque est introuvable. Reinstallez ou reconstruisez Switch."
            .to_string()
    })?;
    let node = node_binary();
    ensure_command(&node, &["--version"], "Node.js")?;
    ensure_command("git", &["--version"], "Git")?;

    fs::create_dir_all(projects_root)
        .map_err(|error| format!("Creation du dossier de projets impossible: {error}"))?;
    fs::create_dir_all(bundles_root)
        .map_err(|error| format!("Creation du dossier d'images impossible: {error}"))?;
    let projects_root = fs::canonicalize(projects_root)
        .map_err(|error| format!("Dossier de projets inaccessible: {error}"))?;
    let bundles_root = fs::canonicalize(bundles_root)
        .map_err(|error| format!("Dossier d'images inaccessible: {error}"))?;

    let project_name = repository_name(&repository_url);
    let workspace = reserve_workspace(&projects_root, &project_name)?;
    if let Err(error) = clone_repository(&repository_url, ref_name.as_deref(), &workspace) {
        let _ = fs::remove_dir_all(&workspace);
        return Err(error);
    }

    let commit = match git_value(&workspace, &["rev-parse", "HEAD"]) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&workspace);
            return Err(error);
        }
    };
    let bundle = bundles_root.join(
        workspace
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new(&project_name)),
    );

    let output = run_dockerizer(&node, &script, &workspace, &bundle, &mode, &request);
    let workspace_path = display_path(&workspace);
    let bundle_path = bundle.is_dir().then(|| display_path(&bundle));

    match output {
        Ok(output) => {
            let log = output_log(&output);
            if output.status.success() {
                let _ = rewrite_manifest_source(
                    &bundle,
                    &repository_url,
                    ref_name.as_deref(),
                    &workspace_path,
                );
                let docker_status = match mode.as_str() {
                    "analyze" => "analyzed",
                    "build" => "built",
                    "deploy" => "deployed",
                    _ => unreachable!(),
                };
                let message = match mode.as_str() {
                    "analyze" => "Environnement clone et analyse Docker terminee",
                    "build" => "Environnement cree et image Docker exportee",
                    "deploy" => "Environnement cree et conteneur lance sur le VPS",
                    _ => unreachable!(),
                };
                Ok(GitDockerEnvironmentResult {
                    repository_url,
                    workspace_path,
                    bundle_path,
                    commit,
                    mode,
                    docker_status: docker_status.to_string(),
                    message: message.to_string(),
                    log,
                })
            } else {
                Ok(GitDockerEnvironmentResult {
                    repository_url,
                    workspace_path,
                    bundle_path,
                    commit,
                    mode,
                    docker_status: "failed".to_string(),
                    message: format!(
                        "Le projet a ete clone, mais l'etape Docker a echoue: {}",
                        last_log_line(&log)
                    ),
                    log,
                })
            }
        }
        Err(error) => Ok(GitDockerEnvironmentResult {
            repository_url,
            workspace_path,
            bundle_path,
            commit,
            mode,
            docker_status: "failed".to_string(),
            message: format!("Le projet a ete clone, mais Docker n'a pas demarre: {error}"),
            log: error,
        }),
    }
}

fn validate_repository_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 2048 || value.contains(['\0', '\r', '\n', '\t', ' ']) {
        return Err("Saisissez un lien Git HTTPS ou SSH valide".to_string());
    }
    if value.contains('?') || value.contains('#') {
        return Err("Les parametres et fragments sont interdits dans le lien Git".to_string());
    }
    if let Some(rest) = value.strip_prefix("git@") {
        let (host, path) = rest
            .split_once(':')
            .ok_or_else(|| "Le lien Git SSH doit utiliser git@hote:projet/depot.git".to_string())?;
        if host.is_empty()
            || path.trim_matches('/').is_empty()
            || !host.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '.' | '-')
            })
        {
            return Err("Le lien Git SSH est invalide".to_string());
        }
        return Ok(value.to_string());
    }

    let parsed = url::Url::parse(value)
        .map_err(|_| "Saisissez un lien Git HTTPS ou SSH valide".to_string())?;
    if !matches!(parsed.scheme(), "https" | "ssh")
        || parsed.host_str().is_none()
        || parsed.path().trim_matches('/').is_empty()
    {
        return Err("Seuls les liens Git HTTPS et SSH distants sont acceptes".to_string());
    }
    if parsed.password().is_some() || (parsed.scheme() == "https" && !parsed.username().is_empty())
    {
        return Err(
            "Ne placez aucun identifiant dans le lien Git; utilisez l'agent SSH ou le gestionnaire Git"
                .to_string(),
        );
    }
    Ok(value.to_string())
}

fn validate_ref_name(value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 200
        || value.starts_with('-')
        || value.contains("..")
        || value.contains("@{")
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '/')
        })
    {
        return Err("La branche, le tag ou le commit Git est invalide".to_string());
    }
    Ok(Some(value.to_string()))
}

fn validate_mode(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if matches!(value.as_str(), "analyze" | "build" | "deploy") {
        Ok(value)
    } else {
        Err("Le mode doit etre analyze, build ou deploy".to_string())
    }
}

fn validate_ports(container_port: Option<u16>, host_port: Option<u16>) -> Result<(), String> {
    if container_port == Some(0) || host_port == Some(0) {
        Err("Les ports doivent etre compris entre 1 et 65535".to_string())
    } else {
        Ok(())
    }
}

fn validate_deploy_target(value: &str) -> Result<(), String> {
    let value = value.trim();
    let Some((user, host)) = value.split_once('@') else {
        return Err("La cible VPS doit utiliser le format utilisateur@hote".to_string());
    };
    if user.is_empty()
        || host.is_empty()
        || value.len() > 255
        || value.matches('@').count() != 1
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '_' | '-' | '@' | '[' | ']' | ':')
        })
    {
        return Err("La cible VPS doit utiliser le format utilisateur@hote".to_string());
    }
    Ok(())
}

fn repository_name(repository_url: &str) -> String {
    let raw = if let Some(rest) = repository_url.strip_prefix("git@") {
        rest.split_once(':')
            .map(|(_, path)| path.to_string())
            .unwrap_or_else(|| rest.to_string())
    } else {
        url::Url::parse(repository_url)
            .ok()
            .map(|url| url.path().to_string())
            .unwrap_or_else(|| repository_url.to_string())
    };
    let raw = raw
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("projet-git")
        .trim_end_matches(".git");
    let mut name = raw
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    name.truncate(64);
    if name.is_empty() {
        "projet-git".to_string()
    } else {
        name
    }
}

fn reserve_workspace(root: &Path, name: &str) -> Result<PathBuf, String> {
    for suffix in 1..=9999 {
        let directory_name = if suffix == 1 {
            name.to_string()
        } else {
            format!("{name}-{suffix}")
        };
        let candidate = root.join(directory_name);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("Creation de l'environnement impossible: {error}"));
            }
        }
    }
    Err("Trop d'environnements portent deja le nom de ce depot".to_string())
}

fn clone_repository(repository: &str, ref_name: Option<&str>, target: &Path) -> Result<(), String> {
    let commit_ref = ref_name
        .map(|value| {
            value.len() >= 7 && value.len() <= 40 && value.chars().all(|c| c.is_ascii_hexdigit())
        })
        .unwrap_or(false);
    let mut command = Command::new("git");
    command.args([
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "protocol.file.allow=never",
        "clone",
        "--quiet",
        "--recurse-submodules",
        "--shallow-submodules",
        "--depth",
        "1",
    ]);
    if let Some(ref_name) = ref_name.filter(|_| !commit_ref) {
        command.args(["--branch", ref_name]);
    }
    command
        .arg("--")
        .arg(repository)
        .arg(command_path(target))
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_command_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("git clone impossible: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git clone a echoue: {}",
            last_log_line(&output_log(&output))
        ));
    }

    if commit_ref {
        run_git(
            target,
            &[
                "fetch",
                "--quiet",
                "--depth",
                "1",
                "origin",
                ref_name.unwrap_or_default(),
            ],
        )?;
        run_git(target, &["checkout", "--quiet", "--detach", "FETCH_HEAD"])?;
        run_git(
            target,
            &[
                "submodule",
                "update",
                "--init",
                "--recursive",
                "--depth",
                "1",
            ],
        )?;
    }
    Ok(())
}

fn run_git(root: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(command_path(root))
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_command_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Git est indisponible: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Git a echoue: {}",
            last_log_line(&output_log(&output))
        ))
    }
}

fn git_value(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(command_path(root))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_command_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Git est indisponible: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "Git a echoue: {}",
            last_log_line(&output_log(&output))
        ))
    }
}

fn run_dockerizer(
    node: &str,
    script: &Path,
    workspace: &Path,
    bundle: &Path,
    mode: &str,
    request: &CreateGitDockerEnvironmentRequest,
) -> Result<Output, String> {
    let mut command = Command::new(node);
    command
        .arg(command_path(script))
        .arg(command_path(workspace))
        .arg("--output")
        .arg(command_path(bundle));
    match mode {
        "analyze" => {
            command.arg("--dry-run");
        }
        "build" => {}
        "deploy" => {
            command.arg("--deploy").arg(request.deploy_target.trim());
            if !request.ssh_key.trim().is_empty() {
                command.arg("--ssh-key").arg(request.ssh_key.trim());
            }
            if request.ssh_port != 22 {
                command.arg("--ssh-port").arg(request.ssh_port.to_string());
            }
            if request.install_docker {
                command.arg("--install-docker");
            }
            if request.accept_new_host_key {
                command.arg("--accept-new-host-key");
            }
        }
        _ => unreachable!(),
    }
    if let Some(port) = request.container_port {
        command.arg("--container-port").arg(port.to_string());
    }
    if let Some(port) = request.host_port {
        command.arg("--host-port").arg(port.to_string());
    }
    command
        .current_dir(command_path(workspace))
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_command_window(&mut command);
    command
        .output()
        .map_err(|error| format!("Lancement du moteur Docker Git impossible: {error}"))
}

fn dockerize_script_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("CST_DOCKERIZE_GIT_SCRIPT") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(static_dir) = env::var_os("CST_STATIC_DIR") {
        candidates.push(
            PathBuf::from(static_dir)
                .join("skills")
                .join("dockerize-git")
                .join("scripts")
                .join("dockerize-git.mjs"),
        );
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("skills")
            .join("dockerize-git")
            .join("scripts")
            .join("dockerize-git.mjs"),
    );
    if let Ok(current) = env::current_dir() {
        candidates.push(
            current
                .join("public")
                .join("skills")
                .join("dockerize-git")
                .join("scripts")
                .join("dockerize-git.mjs"),
        );
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn node_binary() -> String {
    env::var("CST_NODE_BINARY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "node".to_string())
}

fn ensure_command(program: &str, args: &[&str], label: &str) -> Result<(), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_command_window(&mut command);
    match command.status() {
        Ok(status) if status.success() => Ok(()),
        _ => Err(format!(
            "{label} est requis pour creer un environnement depuis Git"
        )),
    }
}

fn rewrite_manifest_source(
    bundle: &Path,
    repository_url: &str,
    ref_name: Option<&str>,
    workspace_path: &str,
) -> Result<(), String> {
    let path = bundle.join("manifest.json");
    let content = fs::read(&path).map_err(|error| error.to_string())?;
    let mut manifest: Value =
        serde_json::from_slice(&content).map_err(|error| error.to_string())?;
    let source = manifest
        .get_mut("source")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Manifest Docker sans source".to_string())?;
    source.insert(
        "repository".to_string(),
        Value::String(repository_url.to_string()),
    );
    source.insert(
        "requestedRef".to_string(),
        ref_name
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
    );
    source.insert(
        "workspacePath".to_string(),
        Value::String(workspace_path.to_string()),
    );
    let updated = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    crate::fs_util::atomic_write(&path, updated).map_err(|error| error.to_string())
}

fn output_log(output: &Output) -> String {
    let mut bytes = Vec::with_capacity(output.stdout.len() + output.stderr.len() + 1);
    bytes.extend_from_slice(&output.stdout);
    if !output.stdout.is_empty() && !output.stderr.is_empty() {
        bytes.push(b'\n');
    }
    bytes.extend_from_slice(&output.stderr);
    if bytes.len() > MAX_LOG_BYTES {
        bytes.drain(..bytes.len() - MAX_LOG_BYTES);
    }
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn last_log_line(log: &str) -> String {
    log.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or("erreur inconnue")
        .chars()
        .take(500)
        .collect()
}

fn display_path(path: &Path) -> String {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return format!(r"\\{unc}");
            }
            return rest.to_string();
        }
    }
    path.to_string_lossy().to_string()
}

fn command_path(path: &Path) -> PathBuf {
    PathBuf::from(display_path(path))
}

#[cfg(windows)]
fn hide_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_command_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_remote_git_links_without_inline_credentials() {
        assert!(validate_repository_url("https://github.com/acme/app.git").is_ok());
        assert!(validate_repository_url("git@github.com:acme/app.git").is_ok());
        assert!(validate_repository_url("ssh://git@git.example.com/acme/app.git").is_ok());
        assert!(validate_repository_url("https://token@github.com/acme/app.git").is_err());
        assert!(validate_repository_url("file:///tmp/app").is_err());
        assert!(validate_repository_url("https://github.com/acme/app.git?token=x").is_err());
    }

    #[test]
    fn creates_safe_project_names() {
        assert_eq!(
            repository_name("https://github.com/acme/My.App.git"),
            "My-App"
        );
        assert_eq!(
            repository_name("https://github.com/BaptisteFaisy/Software-multi-account.git"),
            "Software-multi-account"
        );
        assert_eq!(repository_name("git@git.example.com:acme/api.git"), "api");
    }

    #[test]
    fn reserves_another_directory_for_each_import_of_the_same_repository() {
        let root = std::env::temp_dir().join(format!("cst-git-env-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let first = reserve_workspace(&root, "Software-multi-account").unwrap();
        let second = reserve_workspace(&root, "Software-multi-account").unwrap();

        assert_eq!(first.file_name().unwrap(), "Software-multi-account");
        assert_eq!(second.file_name().unwrap(), "Software-multi-account-2");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_modes_refs_and_targets() {
        assert_eq!(validate_mode("deploy").unwrap(), "deploy");
        assert!(validate_mode("execute").is_err());
        assert!(validate_ref_name("release/v2.0").is_ok());
        assert!(validate_ref_name("../../secret").is_err());
        assert!(validate_deploy_target("ubuntu@203.0.113.10").is_ok());
        assert!(validate_deploy_target("203.0.113.10").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn strips_windows_extended_prefix_before_spawning_git_or_node() {
        assert_eq!(
            command_path(Path::new(r"\\?\C:\Users\demo\SwitchProjects\app")),
            PathBuf::from(r"C:\Users\demo\SwitchProjects\app")
        );
    }
}
