#[tokio::main]
async fn main() {
    if let Err(error) = codex_switch_terminal_lib::server::run_from_env().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
