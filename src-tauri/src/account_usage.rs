//! Suivi de la consommation de tokens **par compte**.
//!
//! La source principale est `account/usage/read` du Codex app-server : elle
//! couvre l'usage du compte dans toutes les surfaces Codex, pas uniquement le
//! trafic passé par cette application. Les rollouts de chaque `CODEX_HOME`
//! restent un repli local lorsque cette source n'est pas disponible.
//!
//! Plusieurs profils locaux pouvant pointer vers le même compte ChatGPT, leur
//! `account_id` est utilisé pour éviter de compter deux fois les mêmes buckets.
//!
//! Format d'un événement pertinent (JSONL, une ligne = un événement) :
//! ```json
//! {"timestamp":"2026-07-08T19:20:14.673Z","type":"event_msg",
//!  "payload":{"type":"token_count","info":{
//!     "total_token_usage":{"input_tokens":..,"cached_input_tokens":..,
//!         "output_tokens":..,"reasoning_output_tokens":..,"total_tokens":..},
//!     "last_token_usage":{..}}}}
//! ```
//! `total_token_usage` est **cumulatif** sur la session : le dernier événement
//! `token_count` du fichier donne le total final de la session. Le modèle est
//! lu dans les événements `turn_context` (`payload.model`).

use crate::metrics;
use crate::settings::{self, expand_home, AccountProfile, AppSettings, Provider};
use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsageDashboard {
    pub generated_at: i64,
    pub profile_count: u64,
    pub total_tokens: u64,
    pub total_cost_usd: f64,
    pub total_sessions: u64,
    pub accounts: Vec<AccountUsageView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsageView {
    pub id: String,
    pub label: String,
    pub profile_labels: Vec<String>,
    pub codex_home: String,
    pub has_tokens: bool,
    pub usage_source: String,
    pub source_error: Option<String>,
    pub session_count: u64,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub today_tokens: u64,
    pub today_cost_usd: f64,
    pub month_tokens: u64,
    pub month_cost_usd: f64,
    pub first_activity: Option<i64>,
    pub last_activity: Option<i64>,
    pub days: Vec<AccountUsageDay>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsageDay {
    pub date: String,
    pub sessions: u64,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
}

const MAX_DAYS_RETURNED: usize = 60;
const SESSION_STORAGE_DIRS: &[&str] = &["sessions", "sessions-archive", "archived_sessions"];
const ACCOUNT_USAGE_READ_TIMEOUT_SECS: u64 = 20;
const ACCOUNT_USAGE_SERVER_CACHE_SECS: u64 = 60;

#[tauri::command]
pub async fn account_token_usage() -> Result<AccountUsageDashboard, String> {
    let settings = settings::load_settings_for_terminal()?;
    tauri::async_runtime::spawn_blocking(move || build_dashboard(&settings))
        .await
        .map_err(|error| error.to_string())
}

pub fn account_token_usage_dashboard() -> Result<AccountUsageDashboard, String> {
    let settings = settings::load_settings_for_terminal()?;
    Ok(build_dashboard(&settings))
}

fn build_dashboard(settings: &AppSettings) -> AccountUsageDashboard {
    let groups = group_account_profiles(&settings.accounts);

    // Un thread par compte réel : la lecture réseau et le repli disque sont
    // indépendants, tandis que les profils dupliqués restent dans le même
    // groupe pour ne pas additionner plusieurs fois un usage global identique.
    let handles = groups
        .into_iter()
        .map(|profiles| {
            let settings = settings.clone();
            thread::spawn(move || account_group_usage_view(&profiles, &settings))
        })
        .collect::<Vec<_>>();

    let mut accounts = handles
        .into_iter()
        .filter_map(|handle| handle.join().ok())
        .collect::<Vec<_>>();

    accounts.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let total_tokens = accounts.iter().fold(0_u64, |total, account| {
        total.saturating_add(account.total_tokens)
    });
    let total_cost_usd = accounts.iter().map(|a| a.cost_usd).sum();
    let total_sessions = accounts.iter().fold(0_u64, |total, account| {
        total.saturating_add(account.session_count)
    });

    AccountUsageDashboard {
        generated_at: metrics::now_ts(),
        profile_count: settings.accounts.len() as u64,
        total_tokens,
        total_cost_usd,
        total_sessions,
        accounts,
    }
}

fn group_account_profiles(accounts: &[AccountProfile]) -> Vec<Vec<AccountProfile>> {
    let mut groups: Vec<Vec<AccountProfile>> = Vec::new();
    let mut positions = HashMap::<String, usize>::new();

    for account in accounts {
        let key = account_identity(account)
            .map(|identity| format!("{}:account:{identity}", account.provider.as_str()))
            .or_else(|| {
                account_home_identity(account)
                    .map(|home| format!("{}:home:{home}", account.provider.as_str()))
            })
            .unwrap_or_else(|| format!("profile:{}", account.id));
        if let Some(index) = positions.get(&key).copied() {
            groups[index].push(account.clone());
        } else {
            positions.insert(key, groups.len());
            groups.push(vec![account.clone()]);
        }
    }

    groups
}

fn account_home_identity(account: &AccountProfile) -> Option<String> {
    let home = expand_home(&account.codex_home).ok()?;
    let resolved = fs::canonicalize(&home).unwrap_or(home);
    let mut value = resolved.to_string_lossy().replace('\\', "/");
    while value.ends_with('/') {
        value.pop();
    }
    #[cfg(windows)]
    value.make_ascii_lowercase();
    (!value.is_empty()).then_some(value)
}

fn account_identity(account: &AccountProfile) -> Option<String> {
    if account.provider != Provider::Codex {
        return None;
    }

    let home = expand_home(&account.codex_home).ok()?;
    account_identity_for_home(&home)
}

fn account_identity_for_home(home: &Path) -> Option<String> {
    let content = fs::read_to_string(home.join("auth.json")).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    for pointer in ["/tokens/account_id", "/account_id", "/chatgpt_account_id"] {
        if let Some(identity) = value
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|identity| !identity.is_empty())
        {
            return Some(identity.to_string());
        }
    }

    let access_token = value
        .pointer("/tokens/access_token")
        .or_else(|| value.get("access_token"))
        .and_then(Value::as_str)?;
    jwt_account_identity(access_token)
}

fn jwt_account_identity(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    let claims = serde_json::from_slice::<Value>(&decoded).ok()?;
    [
        "/https://api.openai.com/auth/chatgpt_account_id",
        "/chatgpt_account_id",
        "/account_id",
    ]
    .into_iter()
    .find_map(|pointer| {
        claims
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|identity| !identity.is_empty())
            .map(ToString::to_string)
    })
}

#[derive(Default, Clone, Copy)]
struct TokenTotals {
    input: u64,
    cached: u64,
    output: u64,
    reasoning: u64,
    total: u64,
}

impl TokenTotals {
    fn add(&mut self, other: &TokenTotals) {
        self.input = self.input.saturating_add(other.input);
        self.cached = self.cached.saturating_add(other.cached);
        self.output = self.output.saturating_add(other.output);
        self.reasoning = self.reasoning.saturating_add(other.reasoning);
        self.total = self.total.saturating_add(other.total);
    }

    fn delta_since(&self, previous: &TokenTotals) -> TokenTotals {
        fn counter_delta(current: u64, previous: u64) -> u64 {
            current.checked_sub(previous).unwrap_or(current)
        }

        TokenTotals {
            input: counter_delta(self.input, previous.input),
            cached: counter_delta(self.cached, previous.cached),
            output: counter_delta(self.output, previous.output),
            reasoning: counter_delta(self.reasoning, previous.reasoning),
            total: counter_delta(self.total, previous.total),
        }
    }
}

#[derive(Default, Clone)]
struct DayAgg {
    totals: TokenTotals,
    cost: f64,
    sessions: u64,
}

#[derive(Default, Clone)]
struct SessionDayUsage {
    totals: TokenTotals,
    cost: f64,
}

/// Résultat du scan d'un seul fichier rollout (une session).
#[derive(Clone)]
struct SessionUsage {
    session_id: Option<String>,
    days: BTreeMap<String, SessionDayUsage>,
    totals: TokenTotals,
    cost: f64,
    ts: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerTokenUsage {
    summary: ServerTokenUsageSummary,
    #[serde(default, alias = "daily_usage_buckets")]
    daily_usage_buckets: Option<Vec<ServerDailyUsageBucket>>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerTokenUsageSummary {
    #[serde(default, alias = "lifetime_tokens")]
    lifetime_tokens: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerDailyUsageBucket {
    #[serde(alias = "start_date")]
    start_date: String,
    tokens: u64,
}

#[derive(Clone)]
struct CachedServerTokenUsage {
    fetched_at: Instant,
    result: Result<ServerTokenUsage, String>,
}

#[derive(Clone)]
struct CachedRolloutUsage {
    len: u64,
    modified: Option<SystemTime>,
    default_model: String,
    usage: Option<SessionUsage>,
}

static SERVER_TOKEN_USAGE_CACHE: OnceLock<Mutex<HashMap<String, CachedServerTokenUsage>>> =
    OnceLock::new();
static ROLLOUT_USAGE_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedRolloutUsage>>> = OnceLock::new();

fn account_group_usage_view(
    profiles: &[AccountProfile],
    settings: &AppSettings,
) -> AccountUsageView {
    let mut view = local_account_group_usage_view(profiles, &settings.pool.default_model);

    let mut server_errors = Vec::new();
    let mut server_usage = None;
    for profile in profiles.iter().filter(|profile| {
        profile.provider == Provider::Codex && settings::account_has_auth_tokens(profile)
    }) {
        match read_server_token_usage_cached(profile, settings) {
            Ok(usage) => {
                server_usage = Some(usage);
                break;
            }
            Err(error) => server_errors.push(error),
        }
    }

    if let Some(server) = server_usage {
        apply_server_usage(&mut view, server);
    } else if let Some(error) = server_errors.last() {
        view.source_error = Some(error.clone());
    } else if !view.has_tokens {
        view.source_error = Some("Compte non connecte : historique local uniquement.".to_string());
    }

    view
}

/// Construit l'usage local d'un compte reel a partir de l'union de tous ses
/// profils. Les rollouts sont dedupliques avant d'etre scannes : additionner
/// les vues deja agregees de chaque profil recompterait chaque session copiee
/// lors d'un import ou d'une duplication de profil.
fn local_account_group_usage_view(
    profiles: &[AccountProfile],
    default_model: &str,
) -> AccountUsageView {
    let primary = &profiles[0];
    let mut homes = Vec::new();

    for profile in profiles {
        let Ok(primary_home) = expand_home(&profile.codex_home) else {
            continue;
        };
        for home in account_usage_homes(profile, &primary_home) {
            if !homes.contains(&home) {
                homes.push(home);
            }
        }
    }

    let mut view = if homes.is_empty() {
        account_usage_view(primary, default_model)
    } else {
        account_usage_view_from_homes(primary, &homes, default_model)
    };
    view.profile_labels = profiles.iter().fold(Vec::new(), |mut labels, profile| {
        if !labels.contains(&profile.label) {
            labels.push(profile.label.clone());
        }
        labels
    });
    view.has_tokens = profiles.iter().any(settings::account_has_auth_tokens);
    view.usage_source = if view.session_count > 0 {
        "local-sessions".to_string()
    } else {
        "unavailable".to_string()
    };
    view
}

/// Concilie la vue globale renvoyee par Codex avec les rollouts locaux. La
/// source distante peut etre vide ou en retard (notamment juste apres un tour)
/// et ne doit jamais effacer une consommation deja observee sur disque.
fn apply_server_usage(view: &mut AccountUsageView, server: ServerTokenUsage) {
    let local_total = view.total_tokens;
    let local_days = view.days.clone();
    let lifetime_tokens = server.summary.lifetime_tokens;
    let has_daily_measurement = server.daily_usage_buckets.is_some();
    let buckets = server.daily_usage_buckets.unwrap_or_default();
    let server_days = aggregate_server_days(&buckets);
    let server_daily_total = server_days
        .values()
        .fold(0_u64, |total, tokens| total.saturating_add(*tokens));
    let server_has_usage = lifetime_tokens.unwrap_or(0) > 0 || server_daily_total > 0;

    view.days = merge_server_day_totals(&server_days, &local_days);
    let merged_daily_total = view
        .days
        .iter()
        .fold(0_u64, |total, day| total.saturating_add(day.total_tokens));
    if server_has_usage && !server_days.is_empty() {
        // `lifetimeTokens` est le cumul canonique du compte. Les rollouts ne
        // complètent ce cumul que pour les jours postérieurs au dernier bucket
        // renvoyé par Codex (ou pour le bucket du jour encore en retard).
        // Prendre le maximum jour par jour sur tout l'historique peut compter
        // deux fois une session commencée un jour et poursuivie le lendemain.
        let official_total = lifetime_tokens.unwrap_or(0).max(server_daily_total);
        let pending_local = pending_local_tokens(&local_days, &server_days);
        view.total_tokens = official_total.saturating_add(pending_local);
    } else {
        view.total_tokens = local_total
            .max(lifetime_tokens.unwrap_or(0))
            .max(merged_daily_total);
    }
    refresh_period_totals(view);

    if server_has_usage {
        view.usage_source = "codex-account".to_string();
        view.source_error = None;
        view.error = None;
    } else if local_total > 0 || merged_daily_total > 0 {
        view.usage_source = "local-sessions".to_string();
        view.source_error = Some(
            "Codex remonte temporairement 0 token ; les sessions locales en temps reel sont affichees."
                .to_string(),
        );
    } else if lifetime_tokens.is_some() || has_daily_measurement {
        // Zero confirme pour un compte qui n'a pas encore de consommation.
        view.usage_source = "codex-account".to_string();
        view.source_error = None;
        view.error = None;
    } else {
        view.source_error =
            Some("Le compte Codex ne fournit pas encore de donnees d'usage.".to_string());
    }
}

fn merge_server_days(
    buckets: Vec<ServerDailyUsageBucket>,
    local_days: &[AccountUsageDay],
) -> Vec<AccountUsageDay> {
    let server = aggregate_server_days(&buckets);
    merge_server_day_totals(&server, local_days)
}

fn aggregate_server_days(buckets: &[ServerDailyUsageBucket]) -> BTreeMap<String, u64> {
    let mut server = BTreeMap::<String, u64>::new();
    for bucket in buckets
        .iter()
        .filter(|bucket| valid_date_key(&bucket.start_date))
    {
        let total = server.entry(bucket.start_date.clone()).or_default();
        *total = total.saturating_add(bucket.tokens);
    }
    server
}

fn merge_server_day_totals(
    server: &BTreeMap<String, u64>,
    local_days: &[AccountUsageDay],
) -> Vec<AccountUsageDay> {
    let mut days = local_days
        .iter()
        .cloned()
        .map(|day| (day.date.clone(), day))
        .collect::<BTreeMap<_, _>>();
    let today = Local::now().format("%Y-%m-%d").to_string();

    for (date, total_tokens) in server {
        let day = days.entry(date.clone()).or_insert(AccountUsageDay {
            date: date.clone(),
            sessions: 0,
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 0,
            cost_usd: 0.0,
        });
        // Les jours clos viennent intégralement du compte Codex. Pour le jour
        // courant seulement, le rollout local peut avoir quelques secondes
        // d'avance sur le bucket distant.
        day.total_tokens = if date >= &today {
            day.total_tokens.max(*total_tokens)
        } else {
            *total_tokens
        };
    }

    truncate_usage_days(days.into_values().collect())
}

fn pending_local_tokens(
    local_days: &[AccountUsageDay],
    server_days: &BTreeMap<String, u64>,
) -> u64 {
    let Some(latest_server_day) = server_days.keys().next_back() else {
        return 0;
    };
    let today = Local::now().format("%Y-%m-%d").to_string();

    local_days.iter().fold(0_u64, |pending, local| {
        let extra = match server_days.get(&local.date) {
            Some(server_tokens) if local.date >= today => {
                local.total_tokens.saturating_sub(*server_tokens)
            }
            Some(_) => 0,
            None if &local.date > latest_server_day => local.total_tokens,
            None => 0,
        };
        pending.saturating_add(extra)
    })
}

fn refresh_period_totals(view: &mut AccountUsageView) {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let month = today.get(0..7).unwrap_or("");
    view.today_tokens = view
        .days
        .iter()
        .filter(|day| day.date == today)
        .fold(0_u64, |total, day| total.saturating_add(day.total_tokens));
    view.month_tokens = view
        .days
        .iter()
        .filter(|day| !month.is_empty() && day.date.starts_with(month))
        .fold(0_u64, |total, day| total.saturating_add(day.total_tokens));
}

fn truncate_usage_days(mut days: Vec<AccountUsageDay>) -> Vec<AccountUsageDay> {
    if days.len() > MAX_DAYS_RETURNED {
        days.drain(0..days.len() - MAX_DAYS_RETURNED);
    }
    days
}

fn valid_date_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn account_usage_view(account: &AccountProfile, default_model: &str) -> AccountUsageView {
    let has_tokens = settings::account_has_auth_tokens(account);

    let home = match expand_home(&account.codex_home) {
        Ok(home) => home,
        Err(error) => return error_view(account, has_tokens, error),
    };

    let homes = account_usage_homes(account, &home);
    account_usage_view_from_homes(account, &homes, default_model)
}

fn account_usage_view_from_homes(
    account: &AccountProfile,
    homes: &[PathBuf],
    default_model: &str,
) -> AccountUsageView {
    let has_tokens = settings::account_has_auth_tokens(account);
    let files = collect_account_rollouts_from_homes(homes);
    let sessions = unique_session_usages(&files, default_model);

    let mut all_time = TokenTotals::default();
    let mut total_cost = 0.0_f64;
    let mut session_count = 0_u64;
    let mut first_activity: Option<i64> = None;
    let mut last_activity: Option<i64> = None;
    let mut per_day: BTreeMap<String, DayAgg> = BTreeMap::new();

    for session in &sessions {
        session_count += 1;
        all_time.add(&session.totals);
        total_cost += session.cost;

        if let Some(ts) = session.ts {
            first_activity = Some(first_activity.map_or(ts, |current| current.min(ts)));
            last_activity = Some(last_activity.map_or(ts, |current| current.max(ts)));
        }

        for (day, usage) in &session.days {
            let entry = per_day.entry(day.clone()).or_default();
            entry.totals.add(&usage.totals);
            entry.cost += usage.cost;
            entry.sessions += 1;
        }
    }

    let today = Local::now().format("%Y-%m-%d").to_string();
    let month_prefix = today.get(0..7).unwrap_or("").to_string();

    let mut today_tokens = 0_u64;
    let mut today_cost = 0.0_f64;
    let mut month_tokens = 0_u64;
    let mut month_cost = 0.0_f64;
    for (date, agg) in &per_day {
        if date == &today {
            today_tokens = today_tokens.saturating_add(agg.totals.total);
            today_cost += agg.cost;
        }
        if !month_prefix.is_empty() && date.starts_with(&month_prefix) {
            month_tokens = month_tokens.saturating_add(agg.totals.total);
            month_cost += agg.cost;
        }
    }

    let mut days = per_day
        .into_iter()
        .map(|(date, agg)| AccountUsageDay {
            date,
            sessions: agg.sessions,
            input_tokens: agg.totals.input,
            cached_input_tokens: agg.totals.cached,
            output_tokens: agg.totals.output,
            reasoning_output_tokens: agg.totals.reasoning,
            total_tokens: agg.totals.total,
            cost_usd: agg.cost,
        })
        .collect::<Vec<_>>();
    // Trié par date croissante (BTreeMap) ; on ne renvoie que les plus récents.
    if days.len() > MAX_DAYS_RETURNED {
        days.drain(0..days.len() - MAX_DAYS_RETURNED);
    }

    AccountUsageView {
        id: account.id.clone(),
        label: account.label.clone(),
        profile_labels: vec![account.label.clone()],
        codex_home: account.codex_home.clone(),
        has_tokens,
        usage_source: if session_count > 0 {
            "local-sessions".to_string()
        } else {
            "unavailable".to_string()
        },
        source_error: None,
        session_count,
        input_tokens: all_time.input,
        cached_input_tokens: all_time.cached,
        output_tokens: all_time.output,
        reasoning_output_tokens: all_time.reasoning,
        total_tokens: all_time.total,
        cost_usd: total_cost,
        today_tokens,
        today_cost_usd: today_cost,
        month_tokens,
        month_cost_usd: month_cost,
        first_activity,
        last_activity,
        days,
        error: None,
    }
}

/// Plusieurs sauvegardes d'une même session peuvent porter des noms de fichier
/// différents (par exemple une copie horodatée et le rollout encore actif).
/// L'identifiant `session_meta.payload.id` est alors la vraie clé de dédoublonnage.
/// La copie au cumul le plus avancé est conservée; à égalité, la plus récente.
fn unique_session_usages(files: &[PathBuf], default_model: &str) -> Vec<SessionUsage> {
    let mut sessions = Vec::<SessionUsage>::new();
    let mut positions = HashMap::<String, usize>::new();

    for file in files {
        let Some(session) = scan_rollout_file_cached(file, default_model) else {
            continue;
        };
        let Some(identity) = session.session_id.clone() else {
            sessions.push(session);
            continue;
        };

        if let Some(index) = positions.get(&identity).copied() {
            let current = &sessions[index];
            let candidate_is_newer = session.totals.total > current.totals.total
                || (session.totals.total == current.totals.total
                    && session.ts.unwrap_or(i64::MIN) > current.ts.unwrap_or(i64::MIN));
            if candidate_is_newer {
                sessions[index] = session;
            }
        } else {
            positions.insert(identity, sessions.len());
            sessions.push(session);
        }
    }

    sessions
}

/// Interroge le compte Codex lui-même. Contrairement aux rollouts locaux, cette
/// source inclut les usages réalisés dans les autres surfaces Codex.
fn read_server_token_usage_cached(
    account: &AccountProfile,
    settings: &AppSettings,
) -> Result<ServerTokenUsage, String> {
    let key = format!("{}:{}", account.id, account.codex_home);
    let cache = SERVER_TOKEN_USAGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some(entry) = entries.get(&key) {
            if entry.fetched_at.elapsed() < Duration::from_secs(ACCOUNT_USAGE_SERVER_CACHE_SECS) {
                return entry.result.clone();
            }
        }
    }

    let result = read_server_token_usage(account, settings);
    if let Ok(mut entries) = cache.lock() {
        entries.insert(
            key,
            CachedServerTokenUsage {
                fetched_at: Instant::now(),
                result: result.clone(),
            },
        );
    }
    result
}

fn read_server_token_usage(
    account: &AccountProfile,
    settings: &AppSettings,
) -> Result<ServerTokenUsage, String> {
    let codex_home = expand_home(&account.codex_home)?;
    let mut command = settings::codex_app_server_command(settings);
    command
        .env("CODEX_HOME", codex_home.to_string_lossy().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    if let Some(proxy_url) = settings::proxy_url_for_account(account, settings) {
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env(key, proxy_url.clone());
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("codex app-server impossible: {error}"))?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        return Err("stdin app-server indisponible".to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("stdout app-server indisponible".to_string());
    };

    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    for request in [
        json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "codex_switch_terminal",
                    "title": "Codex Switch Terminal",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
        json!({ "method": "initialized", "params": {} }),
        json!({ "method": "account/usage/read", "id": 2 }),
    ] {
        if let Err(error) = writeln!(stdin, "{request}") {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("ecriture app-server impossible: {error}"));
        }
    }
    let _ = stdin.flush();

    let response = loop {
        match rx.recv_timeout(Duration::from_secs(ACCOUNT_USAGE_READ_TIMEOUT_SECS)) {
            Ok(line) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value.get("id").and_then(Value::as_i64) == Some(2) {
                    break value;
                }
            }
            Err(_) => {
                drop(stdin);
                let _ = child.kill();
                let _ = child.wait();
                return Err("timeout lecture usage du compte".to_string());
            }
        }
    };

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    if let Some(error) = response.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("usage du compte indisponible")
            .to_string());
    }
    let result = response
        .get("result")
        .cloned()
        .ok_or_else(|| "reponse app-server sans result".to_string())?;
    serde_json::from_value(result).map_err(|error| format!("usage Codex illisible: {error}"))
}

/// Un même compte peut être ouvert par plusieurs serveurs locaux (par exemple
/// 8080 et 8081). Inclut leurs CODEX_HOME uniquement lorsque l'identité du
/// compte dans auth.json est strictement identique.
fn account_usage_homes(account: &AccountProfile, primary_home: &Path) -> Vec<PathBuf> {
    let mut homes = vec![primary_home.to_path_buf()];
    if account.provider != Provider::Codex {
        return homes;
    }

    let Some(relative_home) = data_dir_relative_path(&account.codex_home) else {
        return homes;
    };
    let Some(current_data_dir) = std::env::var_os("CST_DATA_DIR").map(PathBuf::from) else {
        return homes;
    };
    let Some(identity) = account_identity_for_home(primary_home) else {
        return homes;
    };

    for candidate in discover_matching_instance_homes(&current_data_dir, &relative_home, &identity)
    {
        if !homes.contains(&candidate) {
            homes.push(candidate);
        }
    }
    homes
}

fn data_dir_relative_path(value: &str) -> Option<PathBuf> {
    let relative = ["%CST_DATA_DIR%", "${CST_DATA_DIR}", "$CST_DATA_DIR"]
        .into_iter()
        .find_map(|prefix| value.strip_prefix(prefix))
        .map(|relative| relative.trim_start_matches(['\\', '/']))
        .filter(|relative| !relative.is_empty())
        .map(PathBuf::from)?;
    relative
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
        .then_some(relative)
}

fn discover_matching_instance_homes(
    current_data_dir: &Path,
    relative_home: &Path,
    identity: &str,
) -> Vec<PathBuf> {
    const DATA_DIR_PREFIX: &str = "codex-switch-terminal-server";

    let Some(parent) = current_data_dir.parent() else {
        return Vec::new();
    };
    let mut homes = fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name != DATA_DIR_PREFIX && !name.starts_with(&format!("{DATA_DIR_PREFIX}-")) {
                return None;
            }

            let candidate = entry.path().join(relative_home);
            if !candidate.is_dir()
                || account_identity_for_home(&candidate).as_deref() != Some(identity)
            {
                return None;
            }
            Some(candidate)
        })
        .collect::<Vec<_>>();
    homes.sort();
    homes
}

fn collect_account_rollouts_from_homes(homes: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();

    for home in homes {
        for path in collect_account_rollouts(home) {
            let Some(name) = path.file_name().map(|name| name.to_os_string()) else {
                continue;
            };
            if seen.insert(name) {
                files.push(path);
            }
        }
    }
    files
}

/// Retourne toutes les sessions locales connues d'un profil, actives ou
/// archivées, sans compter deux fois une copie du même rollout.
fn collect_account_rollouts(home: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();

    for directory in SESSION_STORAGE_DIRS {
        let root = home.join(directory);
        if !root.is_dir() {
            continue;
        }

        let mut candidates = Vec::new();
        collect_rollouts(&root, &mut candidates);
        candidates.sort();
        for path in candidates {
            let Some(name) = path.file_name().map(|name| name.to_os_string()) else {
                continue;
            };
            if seen.insert(name) {
                files.push(path);
            }
        }
    }

    files
}

fn error_view(account: &AccountProfile, has_tokens: bool, error: String) -> AccountUsageView {
    AccountUsageView {
        id: account.id.clone(),
        label: account.label.clone(),
        profile_labels: vec![account.label.clone()],
        codex_home: account.codex_home.clone(),
        has_tokens,
        usage_source: "unavailable".to_string(),
        source_error: None,
        session_count: 0,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0.0,
        today_tokens: 0,
        today_cost_usd: 0.0,
        month_tokens: 0,
        month_cost_usd: 0.0,
        first_activity: None,
        last_activity: None,
        days: Vec::new(),
        error: Some(error),
    }
}

pub(crate) fn collect_rollouts(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollouts(&path, out);
        } else if is_rollout_file(&path) {
            out.push(path);
        }
    }
}

pub(crate) fn is_rollout_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
        .unwrap_or(false)
}

/// Lit un rollout et renvoie l'usage final de la session (dernier
/// `total_token_usage`), le modèle (dernier `turn_context`) et l'horodatage du
/// dernier événement `token_count`. Renvoie `None` si aucun `token_count`
/// n'est présent (session avortée / sans échange).
fn scan_rollout_file_cached(path: &Path, default_model: &str) -> Option<SessionUsage> {
    let metadata = fs::metadata(path).ok()?;
    let len = metadata.len();
    let modified = metadata.modified().ok();
    let cache = ROLLOUT_USAGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Ok(entries) = cache.lock() {
        if let Some(entry) = entries.get(path) {
            if entry.len == len
                && entry.modified == modified
                && entry.default_model == default_model
            {
                return entry.usage.clone();
            }
        }
    }

    let usage = scan_rollout_file(path, default_model);
    if let Ok(mut entries) = cache.lock() {
        entries.insert(
            path.to_path_buf(),
            CachedRolloutUsage {
                len,
                modified,
                default_model: default_model.to_string(),
                usage: usage.clone(),
            },
        );
    }
    usage
}

fn scan_rollout_file(path: &Path, default_model: &str) -> Option<SessionUsage> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut model: Option<String> = None;
    let mut session_id: Option<String> = None;
    let mut final_totals: Option<TokenTotals> = None;
    let mut final_ts: Option<i64> = None;
    let mut previous_totals = TokenTotals::default();
    let mut days = BTreeMap::<String, SessionDayUsage>::new();
    let fallback_day = day_from_rollout_name(path);

    let mut buffer = String::new();
    let mut handle = reader;
    loop {
        buffer.clear();
        // Lecture ligne par ligne : les lignes de messages peuvent être très
        // volumineuses, mais on ne parse en JSON que les petites lignes
        // `turn_context` / `token_count` (filtre `contains` peu coûteux).
        match handle.read_line(&mut buffer) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }

        if session_id.is_none() && buffer.contains("\"type\":\"session_meta\"") {
            if let Ok(value) = serde_json::from_str::<Value>(buffer.trim_end()) {
                session_id = value
                    .pointer("/payload/id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string);
            }
        }

        if buffer.contains("\"type\":\"turn_context\"") {
            if let Ok(value) = serde_json::from_str::<Value>(buffer.trim_end()) {
                if let Some(found) = value
                    .pointer("/payload/model")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    model = Some(found.to_string());
                }
            }
            continue;
        }

        if buffer.contains("\"type\":\"token_count\"") {
            if let Ok(value) = serde_json::from_str::<Value>(buffer.trim_end()) {
                if let Some(usage) = value.pointer("/payload/info/total_token_usage") {
                    let totals = parse_totals(usage);
                    let delta = totals.delta_since(&previous_totals);
                    let parsed_ts = value
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .and_then(parse_rfc3339_to_unix);
                    let day = parsed_ts
                        .map(local_day)
                        .or_else(|| fallback_day.clone())
                        .unwrap_or_else(|| "inconnu".to_string());
                    let event_cost = metrics::cost_for_usage(
                        model.as_deref().unwrap_or(default_model),
                        delta.input,
                        delta.cached,
                        delta.output,
                    );
                    let entry = days.entry(day).or_default();
                    entry.totals.add(&delta);
                    entry.cost += event_cost;

                    previous_totals = totals;
                    final_totals = Some(totals);
                    if parsed_ts.is_some() {
                        final_ts = parsed_ts;
                    }
                }
            }
        }
    }

    let totals = final_totals?;
    let day = fallback_day
        .or_else(|| final_ts.map(local_day))
        .unwrap_or_else(|| "inconnu".to_string());
    if days.is_empty() {
        let cost = metrics::cost_for_usage(
            model.as_deref().unwrap_or(default_model),
            totals.input,
            totals.cached,
            totals.output,
        );
        days.insert(day.clone(), SessionDayUsage { totals, cost });
    }
    let cost = days.values().map(|usage| usage.cost).sum();

    Some(SessionUsage {
        session_id,
        days,
        totals,
        cost,
        ts: final_ts,
    })
}

fn parse_totals(value: &Value) -> TokenTotals {
    let input = u64_at(value, "input_tokens");
    let cached = u64_at(value, "cached_input_tokens");
    let output = u64_at(value, "output_tokens");
    let reasoning = u64_at(value, "reasoning_output_tokens");
    let total_raw = u64_at(value, "total_tokens");
    let total = if total_raw == 0 {
        input.saturating_add(output)
    } else {
        total_raw
    };

    TokenTotals {
        input,
        cached,
        output,
        reasoning,
        total,
    }
}

fn u64_at(value: &Value, key: &str) -> u64 {
    value
        .get(key)
        .and_then(|item| {
            item.as_u64()
                .or_else(|| item.as_i64().and_then(|number| u64::try_from(number).ok()))
                .or_else(|| item.as_f64().map(|number| number.max(0.0) as u64))
        })
        .unwrap_or(0)
}

/// Le nom de fichier `rollout-2026-07-08T21-19-10-<uuid>.jsonl` encode l'heure
/// de début **locale**, ce qui donne directement le bon jour pour le
/// regroupement (pas de conversion de fuseau à faire).
fn day_from_rollout_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let rest = name.strip_prefix("rollout-")?;
    let date = rest.get(0..10)?;
    let bytes = date.as_bytes();
    if bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        Some(date.to_string())
    } else {
        None
    }
}

fn parse_rfc3339_to_unix(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|datetime| datetime.timestamp())
}

fn local_day(ts: i64) -> String {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fresh_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("cst-usage-{}-{}", std::process::id(), n));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn account_profile(id: &str, label: &str, home: &Path) -> AccountProfile {
        serde_json::from_value(json!({
            "id": id,
            "label": label,
            "codexHome": home.to_string_lossy()
        }))
        .unwrap()
    }

    fn usage_view(total_tokens: u64, days: Vec<AccountUsageDay>) -> AccountUsageView {
        AccountUsageView {
            id: "account".to_string(),
            label: "Compte".to_string(),
            profile_labels: vec!["Compte".to_string()],
            codex_home: "test".to_string(),
            has_tokens: true,
            usage_source: "local-sessions".to_string(),
            source_error: None,
            session_count: 1,
            input_tokens: total_tokens,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens,
            cost_usd: 0.0,
            today_tokens: total_tokens,
            today_cost_usd: 0.0,
            month_tokens: total_tokens,
            month_cost_usd: 0.0,
            first_activity: None,
            last_activity: None,
            days,
            error: None,
        }
    }

    #[test]
    fn day_from_rollout_name_extracts_local_date() {
        assert_eq!(
            day_from_rollout_name(Path::new("x/rollout-2026-07-08T21-19-10-uuid.jsonl")).as_deref(),
            Some("2026-07-08")
        );
        assert_eq!(day_from_rollout_name(Path::new("rollout-bad.jsonl")), None);
        assert_eq!(day_from_rollout_name(Path::new("notarollout.jsonl")), None);
    }

    #[test]
    fn parse_totals_falls_back_to_input_plus_output() {
        let value: Value =
            serde_json::from_str(r#"{"input_tokens":100,"output_tokens":10}"#).unwrap();
        let totals = parse_totals(&value);
        assert_eq!(totals.input, 100);
        assert_eq!(totals.output, 10);
        assert_eq!(totals.total, 110);
    }

    #[test]
    fn account_rollouts_include_archives_without_duplicates() {
        let home = fresh_dir();
        let current = home.join("sessions/2026/07/13");
        let archive = home.join("sessions-archive/2026/07/12");
        let legacy_archive = home.join("archived_sessions");
        fs::create_dir_all(&current).unwrap();
        fs::create_dir_all(&archive).unwrap();
        fs::create_dir_all(&legacy_archive).unwrap();

        let duplicate = "rollout-2026-07-13T10-00-00-duplicate.jsonl";
        fs::write(current.join(duplicate), "current").unwrap();
        fs::write(archive.join(duplicate), "archived copy").unwrap();
        fs::write(
            archive.join("rollout-2026-07-12T09-00-00-archive.jsonl"),
            "archive",
        )
        .unwrap();
        fs::write(
            legacy_archive.join("rollout-2026-07-11T08-00-00-legacy.jsonl"),
            "legacy",
        )
        .unwrap();

        let files = collect_account_rollouts(&home);
        assert_eq!(files.len(), 3);
        assert!(files.iter().any(|path| path.starts_with(&current)));
        assert_eq!(
            files
                .iter()
                .filter(|path| {
                    path.file_name()
                        .is_some_and(|name| name == std::ffi::OsStr::new(duplicate))
                })
                .count(),
            1
        );

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn sibling_instance_homes_require_the_same_account_identity() {
        let root = fresh_dir();
        let primary_data = root.join("codex-switch-terminal-server");
        let matching_data = root.join("codex-switch-terminal-server-8081");
        let foreign_data = root.join("codex-switch-terminal-server-9090");
        let unrelated_data = root.join("another-application");
        let relative_home = PathBuf::from("codex-homes/account");
        let matching_auth = r#"{"tokens":{"account_id":"same-account"}}"#;
        let foreign_auth = r#"{"tokens":{"account_id":"different-account"}}"#;

        for (data_dir, auth) in [
            (&primary_data, matching_auth),
            (&matching_data, matching_auth),
            (&foreign_data, foreign_auth),
            (&unrelated_data, matching_auth),
        ] {
            let account_home = data_dir.join(&relative_home);
            fs::create_dir_all(&account_home).unwrap();
            fs::write(account_home.join("auth.json"), auth).unwrap();
        }

        let homes = discover_matching_instance_homes(&primary_data, &relative_home, "same-account");
        assert_eq!(homes.len(), 2);
        assert!(homes.contains(&primary_data.join(&relative_home)));
        assert!(homes.contains(&matching_data.join(&relative_home)));
        assert!(!homes.contains(&foreign_data.join(&relative_home)));
        assert!(!homes.contains(&unrelated_data.join(&relative_home)));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn data_dir_relative_path_rejects_escape_paths() {
        assert_eq!(
            data_dir_relative_path("%CST_DATA_DIR%\\codex-homes\\account"),
            Some(PathBuf::from("codex-homes\\account"))
        );
        assert_eq!(
            data_dir_relative_path("${CST_DATA_DIR}/codex-homes/account"),
            Some(PathBuf::from("codex-homes/account"))
        );
        assert_eq!(data_dir_relative_path("%CST_DATA_DIR%\\..\\outside"), None);
        assert_eq!(data_dir_relative_path("C:\\absolute"), None);
    }

    #[test]
    fn rollouts_are_deduplicated_across_matching_instance_homes() {
        let first_home = fresh_dir();
        let second_home = fresh_dir();
        let first_sessions = first_home.join("sessions/2026/07/14");
        let second_sessions = second_home.join("sessions/2026/07/14");
        fs::create_dir_all(&first_sessions).unwrap();
        fs::create_dir_all(&second_sessions).unwrap();

        let duplicate = "rollout-2026-07-14T10-00-00-duplicate.jsonl";
        fs::write(first_sessions.join(duplicate), "first copy").unwrap();
        fs::write(second_sessions.join(duplicate), "second copy").unwrap();
        fs::write(
            first_sessions.join("rollout-2026-07-14T11-00-00-first.jsonl"),
            "first",
        )
        .unwrap();
        fs::write(
            second_sessions.join("rollout-2026-07-14T12-00-00-second.jsonl"),
            "second",
        )
        .unwrap();

        let files = collect_account_rollouts_from_homes(&[first_home.clone(), second_home.clone()]);
        assert_eq!(files.len(), 3);
        assert_eq!(
            files
                .iter()
                .filter(|path| {
                    path.file_name()
                        .is_some_and(|name| name == std::ffi::OsStr::new(duplicate))
                })
                .count(),
            1
        );

        let _ = fs::remove_dir_all(first_home);
        let _ = fs::remove_dir_all(second_home);
    }

    #[test]
    fn differently_named_rollouts_with_same_session_id_count_only_latest_copy() {
        let home = fresh_dir();
        let sessions_dir = home.join("sessions/2026/07/13");
        fs::create_dir_all(&sessions_dir).unwrap();
        let session_id = "019f5bbb-e18a-7aa3-b9cf-3db9b3825de5";
        let older = [
            format!(
                r#"{{"timestamp":"2026-07-13T13:00:00Z","type":"session_meta","payload":{{"id":"{session_id}"}}}}"#
            ),
            r#"{"timestamp":"2026-07-13T13:10:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":90,"output_tokens":10,"total_tokens":100}}}}"#.to_string(),
        ]
        .join("\n");
        let newer = [
            format!(
                r#"{{"timestamp":"2026-07-13T13:00:00Z","type":"session_meta","payload":{{"id":"{session_id}"}}}}"#
            ),
            r#"{"timestamp":"2026-07-13T14:10:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":225,"output_tokens":25,"total_tokens":250}}}}"#.to_string(),
        ]
        .join("\n");
        fs::write(
            sessions_dir.join(format!("rollout-2026-07-13T15-47-47-{session_id}.jsonl")),
            older,
        )
        .unwrap();
        fs::write(
            sessions_dir.join(format!(
                "rollout-2026-07-13T15-47-47-{session_id}-snapshot.jsonl"
            )),
            newer,
        )
        .unwrap();

        let files = collect_account_rollouts(&home);
        let sessions = unique_session_usages(&files, "gpt-5-codex");

        assert_eq!(files.len(), 2);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id.as_deref(), Some(session_id));
        assert_eq!(sessions[0].totals.total, 250);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn linked_profiles_aggregate_their_shared_rollouts_only_once() {
        let first_home = fresh_dir();
        let second_home = fresh_dir();
        let first_sessions = first_home.join("sessions/2026/07/14");
        let second_sessions = second_home.join("sessions/2026/07/14");
        fs::create_dir_all(&first_sessions).unwrap();
        fs::create_dir_all(&second_sessions).unwrap();
        let auth = r#"{"tokens":{"account_id":"same-account"}}"#;
        fs::write(first_home.join("auth.json"), auth).unwrap();
        fs::write(second_home.join("auth.json"), auth).unwrap();

        let shared_name = "rollout-2026-07-14T10-00-00-shared.jsonl";
        let shared_rollout = concat!(
            r#"{"timestamp":"2026-07-14T08:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":90,"output_tokens":10,"total_tokens":100}}}}"#,
            "\n"
        );
        fs::write(first_sessions.join(shared_name), shared_rollout).unwrap();
        fs::write(second_sessions.join(shared_name), shared_rollout).unwrap();
        fs::write(
            second_sessions.join("rollout-2026-07-14T11-00-00-unique.jsonl"),
            concat!(
                r#"{"timestamp":"2026-07-14T09:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":45,"output_tokens":5,"total_tokens":50}}}}"#,
                "\n"
            ),
        )
        .unwrap();

        let profiles = vec![
            account_profile("first", "Principal", &first_home),
            account_profile("second", "Copie importee", &second_home),
        ];
        assert_eq!(group_account_profiles(&profiles).len(), 1);

        let settings: AppSettings = serde_json::from_value(json!({
            "accounts": profiles,
            "proxies": [],
            "defaultAccountId": "first",
            "shell": "sh",
            "codexCommand": "codex",
            "autoRunCodex": false,
            "pool": { "defaultModel": "gpt-5-codex" }
        }))
        .unwrap();
        let dashboard = build_dashboard(&settings);
        assert_eq!(dashboard.profile_count, 2);
        assert_eq!(dashboard.accounts.len(), 1);
        assert_eq!(dashboard.total_sessions, 2);
        assert_eq!(dashboard.total_tokens, 150);

        let view = &dashboard.accounts[0];
        assert_eq!(view.session_count, 2);
        assert_eq!(view.total_tokens, 150);
        assert_eq!(view.days.len(), 1);
        assert_eq!(view.days[0].sessions, 2);
        assert_eq!(view.days[0].total_tokens, 150);
        assert_eq!(view.profile_labels, ["Principal", "Copie importee"]);

        let _ = fs::remove_dir_all(first_home);
        let _ = fs::remove_dir_all(second_home);
    }

    #[test]
    fn scan_rollout_takes_last_cumulative_total_and_model() {
        let dir = fresh_dir();
        let file = dir.join("rollout-2026-07-08T21-19-10-test.jsonl");
        let content = [
            r#"{"timestamp":"2026-07-08T19:19:59.318Z","type":"turn_context","payload":{"model":"gpt-5-codex"}}"#,
            r#"{"timestamp":"2026-07-08T19:20:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":2,"total_tokens":110}}}}"#,
            r#"{"timestamp":"2026-07-08T19:20:14.673Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":50,"output_tokens":40,"reasoning_output_tokens":8,"total_tokens":340}}}}"#,
        ]
        .join("\n");
        fs::write(&file, content).unwrap();

        let session = scan_rollout_file(&file, "gpt-4").expect("session");
        assert_eq!(session.totals.input, 300);
        assert_eq!(session.totals.cached, 50);
        assert_eq!(session.totals.output, 40);
        assert_eq!(session.totals.reasoning, 8);
        assert_eq!(session.totals.total, 340);
        assert_eq!(session.days["2026-07-08"].totals.total, 340);
        assert!(session.ts.is_some());
        // Modèle lu dans turn_context (codex), pas le défaut passé "gpt-4" :
        // (250*1.75 + 50*0.175 + 40*14)/1e6
        assert!((session.cost - 0.00100625).abs() < 1e-9);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_rollout_distributes_cumulative_deltas_across_calendar_days() {
        let dir = fresh_dir();
        let file = dir.join("rollout-2026-07-12T23-50-00-cross-midnight.jsonl");
        let content = [
            r#"{"timestamp":"2026-07-12T21:55:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":90,"output_tokens":10,"total_tokens":100}}}}"#,
            r#"{"timestamp":"2026-07-13T08:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":225,"output_tokens":25,"total_tokens":250}}}}"#,
        ]
        .join("\n");
        fs::write(&file, content).unwrap();

        let session = scan_rollout_file(&file, "gpt-5-codex").expect("session");

        assert_eq!(session.totals.total, 250);
        assert_eq!(session.days["2026-07-12"].totals.total, 100);
        assert_eq!(session.days["2026-07-13"].totals.total, 150);
        assert_eq!(
            session
                .days
                .values()
                .map(|usage| usage.totals.total)
                .sum::<u64>(),
            session.totals.total
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_rollout_is_rescanned_after_new_token_events() {
        let dir = fresh_dir();
        let file = dir.join("rollout-2026-07-14T16-00-00-live.jsonl");
        fs::write(
            &file,
            concat!(
                r#"{"timestamp":"2026-07-14T14:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":9,"output_tokens":1,"total_tokens":10}}}}"#,
                "\n"
            ),
        )
        .unwrap();
        assert_eq!(
            scan_rollout_file_cached(&file, "gpt-5-codex")
                .unwrap()
                .totals
                .total,
            10
        );

        let mut writer = fs::OpenOptions::new().append(true).open(&file).unwrap();
        writeln!(
            writer,
            "{{\"timestamp\":\"2026-07-14T14:00:05Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"input_tokens\":18,\"output_tokens\":2,\"total_tokens\":20}}}}}}}}"
        )
        .unwrap();
        writer.flush().unwrap();

        assert_eq!(
            scan_rollout_file_cached(&file, "gpt-5-codex")
                .unwrap()
                .totals
                .total,
            20
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_rollout_without_token_count_returns_none() {
        let dir = fresh_dir();
        let file = dir.join("rollout-2026-07-08T10-00-00-empty.jsonl");
        // La 2e ligne mentionne "token_count" en texte libre : ne doit PAS
        // être comptée (le filtre cible `"type":"token_count"`).
        let content = r#"{"type":"session_meta","payload":{}}
{"type":"message","payload":{"content":"parler de token_count ici ne compte pas"}}"#;
        fs::write(&file, content).unwrap();

        assert!(scan_rollout_file(&file, "gpt-5-codex").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn profiles_with_the_same_chatgpt_account_are_grouped() {
        let first_home = fresh_dir();
        let second_home = fresh_dir();
        let auth = r#"{"tokens":{"account_id":"workspace-account-1","access_token":"token"}}"#;
        fs::write(first_home.join("auth.json"), auth).unwrap();
        fs::write(second_home.join("auth.json"), auth).unwrap();

        let profiles = vec![
            account_profile("first", "Principal", &first_home),
            account_profile("second", "Alias", &second_home),
        ];
        let groups = group_account_profiles(&profiles);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);

        let _ = fs::remove_dir_all(first_home);
        let _ = fs::remove_dir_all(second_home);
    }

    #[test]
    fn profiles_without_auth_are_grouped_when_they_share_the_same_home() {
        let home = fresh_dir();
        let profiles = vec![
            account_profile("first", "Principal", &home),
            account_profile("second", "Copie", &home),
        ];

        let groups = group_account_profiles(&profiles);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn server_usage_response_keeps_lifetime_and_daily_buckets() {
        let usage: ServerTokenUsage = serde_json::from_value(json!({
            "summary": { "lifetimeTokens": 1_250 },
            "dailyUsageBuckets": [
                { "startDate": "2026-07-12", "tokens": 450 },
                { "startDate": "2026-07-13", "tokens": 800 }
            ]
        }))
        .unwrap();

        assert_eq!(usage.summary.lifetime_tokens, Some(1_250));
        let buckets = usage.daily_usage_buckets.unwrap();
        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[1].tokens, 800);
    }

    #[test]
    fn server_days_replace_local_totals_without_losing_local_details() {
        let local = vec![AccountUsageDay {
            date: "2026-07-13".to_string(),
            sessions: 2,
            input_tokens: 90,
            cached_input_tokens: 20,
            output_tokens: 10,
            reasoning_output_tokens: 3,
            total_tokens: 100,
            cost_usd: 0.01,
        }];
        let days = merge_server_days(
            vec![
                ServerDailyUsageBucket {
                    start_date: "2026-07-13".to_string(),
                    tokens: 700,
                },
                ServerDailyUsageBucket {
                    start_date: "2026-07-13".to_string(),
                    tokens: 50,
                },
                ServerDailyUsageBucket {
                    start_date: "not-a-date".to_string(),
                    tokens: 999,
                },
            ],
            &local,
        );

        assert_eq!(days.len(), 1);
        assert_eq!(days[0].total_tokens, 750);
        assert_eq!(days[0].sessions, 2);
        assert_eq!(days[0].input_tokens, 90);
    }

    #[test]
    fn closed_server_day_is_authoritative_even_when_local_total_is_higher() {
        let yesterday = Local::now()
            .date_naive()
            .pred_opt()
            .unwrap()
            .format("%Y-%m-%d")
            .to_string();
        let local = vec![AccountUsageDay {
            date: yesterday.clone(),
            sessions: 2,
            input_tokens: 140,
            cached_input_tokens: 0,
            output_tokens: 10,
            reasoning_output_tokens: 0,
            total_tokens: 150,
            cost_usd: 0.01,
        }];

        let days = merge_server_days(
            vec![ServerDailyUsageBucket {
                start_date: yesterday,
                tokens: 100,
            }],
            &local,
        );

        assert_eq!(days[0].total_tokens, 100);
        assert_eq!(days[0].sessions, 2);
    }

    #[test]
    fn official_lifetime_only_adds_local_usage_after_latest_server_day() {
        let yesterday = Local::now()
            .date_naive()
            .pred_opt()
            .unwrap()
            .format("%Y-%m-%d")
            .to_string();
        let today = Local::now().format("%Y-%m-%d").to_string();
        let old_local = AccountUsageDay {
            date: yesterday.clone(),
            sessions: 1,
            input_tokens: 140,
            cached_input_tokens: 0,
            output_tokens: 10,
            reasoning_output_tokens: 0,
            total_tokens: 150,
            cost_usd: 0.01,
        };
        let realtime_local = AccountUsageDay {
            date: today.clone(),
            sessions: 1,
            input_tokens: 45,
            cached_input_tokens: 0,
            output_tokens: 5,
            reasoning_output_tokens: 0,
            total_tokens: 50,
            cost_usd: 0.01,
        };
        let mut view = usage_view(200, vec![old_local, realtime_local]);

        apply_server_usage(
            &mut view,
            ServerTokenUsage {
                summary: ServerTokenUsageSummary {
                    lifetime_tokens: Some(100),
                },
                daily_usage_buckets: Some(vec![ServerDailyUsageBucket {
                    start_date: yesterday,
                    tokens: 100,
                }]),
            },
        );

        assert_eq!(view.total_tokens, 150);
        assert_eq!(view.today_tokens, 50);
        assert_eq!(
            view.days
                .iter()
                .find(|day| day.date == today)
                .unwrap()
                .total_tokens,
            50
        );
    }

    #[test]
    fn empty_server_days_do_not_delete_realtime_local_days() {
        let local = vec![AccountUsageDay {
            date: "2026-07-14".to_string(),
            sessions: 1,
            input_tokens: 900,
            cached_input_tokens: 500,
            output_tokens: 100,
            reasoning_output_tokens: 10,
            total_tokens: 1_000,
            cost_usd: 0.01,
        }];

        let days = merge_server_days(Vec::new(), &local);

        assert_eq!(days.len(), 1);
        assert_eq!(days[0].total_tokens, 1_000);
        assert_eq!(days[0].sessions, 1);
    }

    #[test]
    fn zero_server_usage_does_not_erase_real_local_tokens() {
        let day = AccountUsageDay {
            date: Local::now().format("%Y-%m-%d").to_string(),
            sessions: 1,
            input_tokens: 140_000_000,
            cached_input_tokens: 130_000_000,
            output_tokens: 500_000,
            reasoning_output_tokens: 25_000,
            total_tokens: 140_500_000,
            cost_usd: 1.0,
        };
        let mut view = usage_view(day.total_tokens, vec![day]);

        apply_server_usage(
            &mut view,
            ServerTokenUsage {
                summary: ServerTokenUsageSummary {
                    lifetime_tokens: Some(0),
                },
                daily_usage_buckets: Some(Vec::new()),
            },
        );

        assert_eq!(view.total_tokens, 140_500_000);
        assert_eq!(view.today_tokens, 140_500_000);
        assert_eq!(view.usage_source, "local-sessions");
        assert!(view.source_error.as_deref().unwrap().contains("0 token"));
    }
}
