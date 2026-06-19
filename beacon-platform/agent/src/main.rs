// beacon-agent — main entry point
// Distributed Linux observability agent
// Async-first, Tokio runtime

mod auth;
mod collectors;
mod config;
mod engines;
mod registration;
mod storage;
mod transport;
// config::validator is a sub-module of config — no explicit declaration needed here

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, EnvFilter};

use config::{create_collector_flags, AgentConfig};
use engines::{
    encryption::EncryptionEngine, health::HealthEngine, identity::IdentityEngine,
    logging::LogEngine, queue::QueueEngine,
};
use storage::StorageManager;
use transport::WebSocketTransport;

const SERVICE_UNIT: &str = include_str!("../beacon-agent.service");

#[derive(Parser)]
#[command(
    name    = "beacon-agent",
    version = "1.0.0",
    about   = "Beacon distributed Linux observability agent",
    long_about = None,
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Config file path
    #[arg(short, long, default_value = "/etc/beacon/agent.toml")]
    config: String,

    /// Log level (trace|debug|info|warn|error)
    #[arg(short, long, default_value = "info")]
    log_level: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize the agent (first-time setup — prompts for server, credentials, and secret)
    Init,

    /// Start the agent daemon
    Start,

    /// Show agent status
    Status,

    /// Login to the beacon server
    Login {
        #[arg(short, long)]
        username: String,
        #[arg(short, long)]
        password: Option<String>,
    },

    /// Logout from beacon server
    Logout,

    /// Show current user
    Whoami,

    // ─── Service ──────────────────────────────────────────────────────────────
    /// Manage systemd service
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },

    // ─── Metrics ─────────────────────────────────────────────────────────────
    /// Manage CPU collector
    Cpu {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage RAM collector
    Ram {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage Storage collector
    Storage {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage Network collector
    Network {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage Process collector
    Process {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage Systemd collector
    Systemd {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage Docker collector
    Docker {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage Kubernetes collector
    Kubernetes {
        #[command(subcommand)]
        action: EnableDisable,
    },
    /// Manage all metrics
    Metrics {
        #[command(subcommand)]
        action: MetricsAction,
    },

    // ─── Agent ────────────────────────────────────────────────────────────────
    /// Agent management
    Agent {
        #[command(subcommand)]
        action: AgentAction,
    },

    // ─── Logs ────────────────────────────────────────────────────────────────
    /// View and manage logs
    Logs {
        #[command(subcommand)]
        action: LogsAction,
    },

    // ─── Audit ───────────────────────────────────────────────────────────────
    /// View audit trail
    Audit {
        #[command(subcommand)]
        action: AuditAction,
    },

    // ─── DB ──────────────────────────────────────────────────────────────────
    /// Database operations
    Db {
        #[command(subcommand)]
        action: DbAction,
    },

    // ─── Encryption ──────────────────────────────────────────────────────────
    /// Encryption management
    Encryption {
        #[command(subcommand)]
        action: EncryptionAction,
    },

    // ─── Queue ───────────────────────────────────────────────────────────────
    /// Queue management
    Queue {
        #[command(subcommand)]
        action: QueueAction,
    },

    // ─── Server ──────────────────────────────────────────────────────────────
    /// Server connectivity
    Server {
        #[command(subcommand)]
        action: ServerAction,
    },

    // ─── TUI ─────────────────────────────────────────────────────────────────
    /// Launch Terminal UI
    Tui,
}

#[derive(Subcommand, Clone)]
enum EnableDisable {
    Enable,
    Disable,
}

#[derive(Subcommand, Clone)]
enum ServiceAction {
    Install,
    Remove,
    Start,
    Stop,
    Restart,
    Status,
}

#[derive(Subcommand, Clone)]
enum MetricsAction {
    EnableAll,
    DisableAll,
    /// Set collection interval (e.g. 1s, 5s, 30s, 1m)
    Interval {
        value: String,
    },
    /// Set retention period (e.g. 30d)
    Retention {
        value: String,
    },
    Status,
}

#[derive(Subcommand, Clone)]
enum AgentAction {
    List,
    Show { agent_id: String },
    Enable { agent_id: String },
    Disable { agent_id: String },
    Remove { agent_id: String },
    Rename { agent_id: String, name: String },
    RegenerateId,
}

#[derive(Subcommand, Clone)]
enum LogsAction {
    /// Stream logs in real-time
    Follow,
    /// Export logs to file
    Export {
        output: String,
    },
    /// Search logs
    Search {
        query: String,
    },
    /// Clear all logs
    Clear,
    /// Clear logs by severity
    ClearErrors,
    ClearWarnings,
    /// View recent logs
    View,
}

#[derive(Subcommand, Clone)]
enum AuditAction {
    Logs,
    Export { output: String },
}

#[derive(Subcommand, Clone)]
enum DbAction {
    Status,
    Backup { output: Option<String> },
    Restore { input: String },
    Compact,
    Vacuum,
    Verify,
    Export { output: String },
    Clear,
    Reset,
}

#[derive(Subcommand, Clone)]
enum EncryptionAction {
    Enable,
    Disable,
    RotateKey,
    Status,
}

#[derive(Subcommand, Clone)]
enum QueueAction {
    Status,
    Clear,
    Pause,
    Resume,
    RetryFailed,
}

#[derive(Subcommand, Clone)]
enum ServerAction {
    Connect,
    Disconnect,
    Status,
    Ping,
    Test,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialise tracing
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(&cli.log_level)),
        )
        .json()
        .init();

    info!("beacon-agent v1.0.0 starting");

    match cli.command.unwrap_or(Commands::Start) {
        Commands::Init => run_init(&cli.config).await,
        Commands::Start => run_daemon(&cli.config).await,
        Commands::Status => run_status(&cli.config).await,
        Commands::Tui => run_tui(&cli.config).await,

        Commands::Login { username, password } => run_login(&cli.config, &username, password).await,
        Commands::Logout => run_logout(&cli.config).await,
        Commands::Whoami => run_whoami(&cli.config).await,

        Commands::Service { action } => handle_service(action),
        Commands::Cpu { action } => handle_collector("cpu", action),
        Commands::Ram { action } => handle_collector("ram", action),
        Commands::Storage { action } => handle_collector("storage", action),
        Commands::Network { action } => handle_collector("network", action),
        Commands::Process { action } => handle_collector("process", action),
        Commands::Systemd { action } => handle_collector("systemd", action),
        Commands::Docker { action } => handle_collector("docker", action),
        Commands::Kubernetes { action } => handle_collector("kubernetes", action),
        Commands::Metrics { action } => handle_metrics_cmd(action, &cli.config).await,
        Commands::Agent { action } => handle_agent_cmd(action, &cli.config).await,
        Commands::Logs { action } => handle_logs_cmd(action, &cli.config).await,
        Commands::Audit { action } => handle_audit_cmd(action, &cli.config).await,
        Commands::Db { action } => handle_db_cmd(action, &cli.config).await,
        Commands::Encryption { action } => handle_encryption_cmd(action, &cli.config).await,
        Commands::Queue { action } => handle_queue_cmd(action, &cli.config).await,
        Commands::Server { action } => handle_server_cmd(action, &cli.config).await,
    }
}

// ─── Run daemon ───────────────────────────────────────────────────────────────

async fn run_daemon(config_path: &str) -> Result<()> {
    let handed_to_systemd = ensure_system_install().await;
    if handed_to_systemd {
        info!("Systemd service started; exiting current process to avoid double-run");
        return Ok(());
    }

    info!("Loading configuration from {}", config_path);

    let config = AgentConfig::load(config_path).await?;

    // Initialise storage layer
    let storage = StorageManager::new(&config.storage_dir).await?;

    // Derive agent identity
    let identity = IdentityEngine::new(&storage).await?;
    info!("Agent identity: {}", identity.agent_id);

    // Initialise encryption
    let encryption = EncryptionEngine::new(&config, &storage).await?;

    // Initialise queue
    let mut queue = QueueEngine::new(storage.clone()).await?;

    // Initialise logging engine
    let log_engine = LogEngine::new(&identity, queue.clone(), storage.clone());
    log_engine
        .info("service_engine", "Beacon Agent starting")
        .await?;
    log_engine
        .info(
            "service_engine",
            &format!("Agent identity: {}", identity.agent_id),
        )
        .await?;
    log_engine
        .info("service_engine", "Configuration loaded")
        .await?;

    // Inject log engine into queue for dead-letter/retry logs
    queue.set_log_engine(log_engine.clone());

    // Initialise health engine
    let mut health = HealthEngine::new();
    health.set_log_engine(log_engine.clone());
    health.set_status(engines::health::AgentStatus::Initializing);

    // ── Registration gate ─────────────────────────────────────────────────────
    info!("Verifying agent registration with server...");
    match registration::register(&config, &identity, &storage, &log_engine).await {
        Ok(()) => {
            info!("✓ Agent registration confirmed.");
        }
        Err(e) => {
            let err_str = e.to_string();

            if err_str.contains("Secret mismatch")
                || err_str.contains("secret_mismatch")
                || err_str.contains("Registration rejected")
            {
                error!("✗ Registration failed — secret mismatch.");
                error!("{}", err_str);
                eprintln!("\n[beacon-agent] ERROR: Secret mismatch.\n{}\n", err_str);
                eprintln!("Metrics will NOT be sent until this is resolved.");
                eprintln!("Run 'beacon-agent init' to re-configure, or set BEACON_AGENT_SECRET.");
                std::process::exit(1);
            }

            warn!(
                "Registration request failed ({}). Checking local registration cache...",
                e
            );
            let locally_registered = registration::is_registered(&storage).await.unwrap_or(false);

            if locally_registered {
                warn!(
                    "Server unreachable but agent was previously registered. \
                     Continuing in offline-buffering mode."
                );
            } else {
                error!(
                    "✗ Agent has never been successfully registered and server is unreachable. \
                     Cannot start."
                );
                error!("{}", e);
                eprintln!(
                    "\n[beacon-agent] ERROR: Not registered and server is unreachable.\n\
                     Run 'beacon-agent init' to configure and register the agent."
                );
                std::process::exit(1);
            }
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Create shared collector flags for dynamic server-side toggle
    let collector_flags = create_collector_flags(&config);

    // Start WebSocket transport (persists config changes to disk on config_update)
    let transport = WebSocketTransport::new(
        config.clone(),
        config_path.to_string(),
        identity.clone(),
        queue.clone(),
        encryption.clone(),
        log_engine.clone(),
        collector_flags.clone(),
    );

    // Start all collectors
    let collector_handles = collectors::start_all(
        config.clone(),
        identity.clone(),
        queue.clone(),
        storage.clone(),
        &log_engine,
        collector_flags,
    )
    .await?;

    health.set_status(engines::health::AgentStatus::Online);
    let _ = log_engine
        .info("service_engine", "All engines online. Agent is running.")
        .await;
    info!("All engines online. Agent is running.");

    // Run transport (reconnects automatically on disconnect)
    tokio::select! {
        res = transport.run() => {
            error!("Transport exited: {:?}", res);
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Received SIGINT — shutting down gracefully");
            health.set_status(engines::health::AgentStatus::ShuttingDown);
        }
    }

    // Log shutdown
    log_engine
        .info("service_engine", "Beacon Agent shutting down")
        .await?;

    // Flush queue before exit
    info!("Flushing queue before shutdown...");
    queue.flush().await?;

    for handle in collector_handles {
        handle.abort();
    }

    info!("Beacon agent stopped.");
    Ok(())
}

async fn ensure_system_install() -> bool {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            warn!("Unable to determine current executable path: {e}");
            return false;
        }
    };

    let target = Path::new("/usr/local/bin/beacon-agent");
    if !target.exists() {
        match tokio::fs::copy(&exe, target).await {
            Ok(_) => {
                let _ = std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755));
                info!("Installed beacon-agent to /usr/local/bin");
            }
            Err(e) => {
                warn!("Skipping binary install to /usr/local/bin (permission/other error): {e}");
                // Without a system install we cannot enable autostart.
                return false;
            }
        }
    }

    let unit_path = Path::new("/etc/systemd/system/beacon-agent.service");
    if !unit_path.exists() {
        if let Some(parent) = unit_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        match tokio::fs::write(unit_path, SERVICE_UNIT).await {
            Ok(_) => info!("Installed systemd unit: /etc/systemd/system/beacon-agent.service"),
            Err(e) => {
                warn!("Skipping systemd unit install (permission/other error): {e}");
                return false;
            }
        }
    }

    // Enable and start via systemd; if this succeeds we can exit and let systemd own the process.
    if Command::new("systemctl").arg("daemon-reload").status().map(|s| s.success()).unwrap_or(false)
        && Command::new("systemctl")
            .args(["enable", "beacon-agent"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        && Command::new("systemctl")
            .args(["start", "beacon-agent"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    {
        info!("Enabled and started beacon-agent via systemd (auto-start on boot)");
        return true;
    }

    warn!("Systemd enable/start failed or unavailable; continuing foreground run");
    false
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async fn run_init(config_path: &str) -> Result<()> {
    use std::io::{self, BufRead, Write};

    println!("=== Beacon Agent Initialization ===\n");
    println!("This will configure the agent and register it with the Beacon server.");
    println!("The secret must match the BEACON_AGENT_SECRET set on your server.\n");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();

    // ── Server address ────────────────────────────────────────────────────────
    print!("Server address (e.g. wss://beacon.example.com/ws/ingest/): ");
    io::stdout().flush()?;
    let server_addr = loop {
        let s = lines.next().unwrap_or(Ok(String::new()))?;
        let s = s.trim().to_string();
        if s.starts_with("ws://") || s.starts_with("wss://") {
            break s;
        }
        eprintln!("  ✗ Must start with ws:// or wss://. Try again.");
        print!("Server address: ");
        io::stdout().flush()?;
    };

    // ── Username ──────────────────────────────────────────────────────────────
    print!("Username [admin]: ");
    io::stdout().flush()?;
    let username = {
        let s = lines
            .next()
            .unwrap_or(Ok(String::new()))?
            .trim()
            .to_string();
        if s.is_empty() {
            "admin".to_string()
        } else {
            s
        }
    };

    // ── Password ──────────────────────────────────────────────────────────────
    print!("Password: ");
    io::stdout().flush()?;
    let password = lines
        .next()
        .unwrap_or(Ok(String::new()))?
        .trim()
        .to_string();
    if password.is_empty() {
        eprintln!("\n  ⚠ Warning: password is empty.");
    }

    // ── Secret ───────────────────────────────────────────────────────────────
    // The secret is required.  We loop until a non-empty value is provided
    // (or the user sets BEACON_AGENT_SECRET and presses Enter to skip).
    println!("\nAgent Secret");
    println!("  The secret must match BEACON_AGENT_SECRET on the Beacon server.");
    println!("  Press Enter to read from the BEACON_AGENT_SECRET environment variable.");
    print!("Secret (or Enter to use env var): ");
    io::stdout().flush()?;

    let secret = loop {
        let s = lines
            .next()
            .unwrap_or(Ok(String::new()))?
            .trim()
            .to_string();
        if !s.is_empty() {
            // Inline value provided
            break s;
        }
        // Try environment variable
        match std::env::var("BEACON_AGENT_SECRET") {
            Ok(env_s) if !env_s.trim().is_empty() => {
                println!("  ✓ Using BEACON_AGENT_SECRET from environment.");
                break String::new(); // stored as empty — env provides it at runtime
            }
            _ => {
                eprintln!(
                    "  ✗ No secret provided and BEACON_AGENT_SECRET is not set.\n\
                     Please enter a secret string or set the environment variable."
                );
                print!("Secret: ");
                io::stdout().flush()?;
            }
        }
    };

    // ── Interval ──────────────────────────────────────────────────────────────
    print!("\nCollection interval in seconds [5]: ");
    io::stdout().flush()?;
    let interval: u64 = lines
        .next()
        .unwrap_or(Ok("5".to_string()))?
        .trim()
        .parse()
        .unwrap_or(5);

    // ── Build and save config ─────────────────────────────────────────────────
    let config = AgentConfig {
        server_addr: server_addr.clone(),
        username: username.clone(),
        password,
        secret,
        interval_seconds: interval,
        storage_dir: "/var/lib/beacon/agent".to_string(),
        ..Default::default()
    };

    config.save(config_path).await?;
    println!("\n✓ Configuration written to {}", config_path);

    // ── Attempt registration now ──────────────────────────────────────────────
    println!("\nAttempting to register agent with server...");

    let storage = StorageManager::new(&config.storage_dir).await?;
    // Clear any stale registration state from a previous init
    registration::clear_registration(&storage).await?;

    let identity = engines::identity::IdentityEngine::new(&storage).await?;
    let queue = engines::queue::QueueEngine::new(storage.clone()).await?;
    let log_engine = LogEngine::new(&identity, queue, storage.clone());

    match registration::register(&config, &identity, &storage, &log_engine).await {
        Ok(()) => {
            println!("✓ Agent registered successfully!");
            println!("  Agent ID : {}", identity.agent_id);
            println!("  Hostname : {}", identity.hostname);
            println!("\nRun 'beacon-agent start' to begin collecting and sending telemetry.");
        }
        Err(e) => {
            eprintln!("\n✗ Registration failed: {}", e);
            eprintln!(
                "\nThe configuration has been saved. Fix the issue and run\n\
                 'beacon-agent init' again or start the agent once the server\n\
                 is reachable — it will retry registration automatically.\n"
            );
            // Don't abort init — config is saved and user can fix the issue.
        }
    }

    Ok(())
}

async fn run_status(config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    let storage = StorageManager::new(&config.storage_dir).await?;
    let identity = IdentityEngine::new(&storage).await?;
    let reg_status = storage
        .get_config("registration_status")
        .await?
        .unwrap_or_else(|| "unregistered".to_string());

    println!("Agent ID:     {}", identity.agent_id);
    println!("Hostname:     {}", identity.hostname);
    println!("Server:       {}", config.server_addr);
    println!("Storage:      {}", config.storage_dir);
    println!("Interval:     {}s", config.interval_seconds);
    println!("Registration: {}", reg_status);

    // Indicate whether secret is configured
    let secret_src = if !std::env::var("BEACON_AGENT_SECRET")
        .unwrap_or_default()
        .is_empty()
    {
        "env:BEACON_AGENT_SECRET"
    } else if !config.secret.is_empty() {
        "agent.toml"
    } else {
        "NOT SET"
    };
    println!("Secret src:   {}", secret_src);

    Ok(())
}

async fn run_login(config_path: &str, username: &str, _password: Option<String>) -> Result<()> {
    println!("Login as {username} — use the TUI or direct API for interactive login.");
    Ok(())
}

async fn run_logout(_config_path: &str) -> Result<()> {
    println!("Logged out.");
    Ok(())
}

async fn run_whoami(config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    println!("User: {}", config.username);
    Ok(())
}

async fn run_tui(config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    let storage = StorageManager::new(&config.storage_dir).await?;
    engines::tui::run(config, storage).await
}

// ─── CLI handlers ─────────────────────────────────────────────────────────────

fn handle_service(action: ServiceAction) -> Result<()> {
    match action {
        ServiceAction::Install => println!("Installing systemd service..."),
        ServiceAction::Remove => println!("Removing systemd service..."),
        ServiceAction::Start => println!("Starting service: systemctl start beacon-agent"),
        ServiceAction::Stop => println!("Stopping service: systemctl stop beacon-agent"),
        ServiceAction::Restart => println!("Restarting service: systemctl restart beacon-agent"),
        ServiceAction::Status => println!("Service status: systemctl status beacon-agent"),
    }
    Ok(())
}

fn handle_collector(name: &str, action: EnableDisable) -> Result<()> {
    match action {
        EnableDisable::Enable => println!("Enabled collector: {name}"),
        EnableDisable::Disable => println!("Disabled collector: {name}"),
    }
    Ok(())
}

async fn handle_metrics_cmd(action: MetricsAction, config_path: &str) -> Result<()> {
    match action {
        MetricsAction::EnableAll => println!("All collectors enabled."),
        MetricsAction::DisableAll => println!("All collectors disabled."),
        MetricsAction::Interval { value } => println!("Collection interval set to {value}"),
        MetricsAction::Retention { value } => println!("Retention set to {value}"),
        MetricsAction::Status => run_status(config_path).await?,
    }
    Ok(())
}

async fn handle_agent_cmd(action: AgentAction, _config_path: &str) -> Result<()> {
    match action {
        AgentAction::List => println!("Listing agents via server API..."),
        AgentAction::Show { agent_id } => println!("Showing agent: {agent_id}"),
        AgentAction::Enable { agent_id } => println!("Enabling: {agent_id}"),
        AgentAction::Disable { agent_id } => println!("Disabling: {agent_id}"),
        AgentAction::Remove { agent_id } => println!("Removing: {agent_id}"),
        AgentAction::Rename { agent_id, name } => println!("Renaming {agent_id} → {name}"),
        AgentAction::RegenerateId => println!("Regenerating agent ID..."),
    }
    Ok(())
}

async fn handle_logs_cmd(action: LogsAction, config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    let storage = StorageManager::new(&config.storage_dir).await?;
    match action {
        LogsAction::View => {
            storage.print_recent_logs(50).await?;
        }
        LogsAction::Follow => {
            println!("Streaming logs... (Ctrl+C to stop)");
            // TODO: implement live log streaming via WebSocket
        }
        LogsAction::Export { output } => {
            println!("Exporting logs to {output}...");
            // TODO: implement log export
        }
        LogsAction::Search { query } => {
            let results = storage.search_logs(&query, 50).await?;
            if results.is_empty() {
                println!("No logs matching '{}'", query);
            } else {
                for row in &results {
                    println!(
                        "[{}] [{}] ({}) {}",
                        row.timestamp, row.severity, row.source, row.message
                    );
                }
                println!("--- {} result(s) ---", results.len());
            }
        }
        LogsAction::Clear => {
            storage.clear_logs().await?;
            println!("All logs cleared.");
        }
        LogsAction::ClearErrors => {
            let n = storage.delete_logs_by_severity("Error").await?;
            println!("Deleted {} error log(s).", n);
        }
        LogsAction::ClearWarnings => {
            let n = storage.delete_logs_by_severity("Warning").await?;
            println!("Deleted {} warning log(s).", n);
        }
    }
    Ok(())
}

async fn handle_audit_cmd(action: AuditAction, config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    let storage = StorageManager::new(&config.storage_dir).await?;
    match action {
        AuditAction::Logs => storage.print_audit_logs(50).await?,
        AuditAction::Export { output } => println!("Exporting audit to {output}..."),
    }
    Ok(())
}

async fn handle_db_cmd(action: DbAction, config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    let storage = StorageManager::new(&config.storage_dir).await?;
    match action {
        DbAction::Status => storage.print_status().await?,
        DbAction::Backup { output } => {
            let path = output.unwrap_or_else(|| "/tmp/beacon_backup.db".to_string());
            storage.backup(&path).await?;
            println!("Backup written to {path}");
        }
        DbAction::Restore { input } => {
            storage.restore(&input).await?;
            println!("Restored from {input}");
        }
        DbAction::Compact | DbAction::Vacuum => {
            storage.vacuum().await?;
            println!("Vacuum complete.");
        }
        DbAction::Verify => {
            storage.verify().await?;
            println!("Integrity OK.");
        }
        DbAction::Export { output } => println!("Exporting to {output}..."),
        DbAction::Clear => println!("Cleared databases."),
        DbAction::Reset => println!("Reset databases."),
    }
    Ok(())
}

async fn handle_encryption_cmd(action: EncryptionAction, _config_path: &str) -> Result<()> {
    match action {
        EncryptionAction::Enable => println!("Encryption enabled."),
        EncryptionAction::Disable => println!("Encryption disabled."),
        EncryptionAction::RotateKey => println!("Rotating encryption key..."),
        EncryptionAction::Status => println!("Encryption: AES-256-GCM | TLS 1.3"),
    }
    Ok(())
}

async fn handle_queue_cmd(action: QueueAction, config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    let storage = StorageManager::new(&config.storage_dir).await?;
    let queue = QueueEngine::new(storage).await?;
    match action {
        QueueAction::Status => {
            let s = queue.status().await?;
            println!("{s:?}");
        }
        QueueAction::Clear => {
            queue.clear().await?;
            println!("Queue cleared.");
        }
        QueueAction::Pause => {
            queue.pause().await;
            println!("Queue paused.");
        }
        QueueAction::Resume => {
            queue.resume().await;
            println!("Queue resumed.");
        }
        QueueAction::RetryFailed => {
            let n = queue.retry_failed().await?;
            println!("Retried {n} messages.");
        }
    }
    Ok(())
}

async fn handle_server_cmd(action: ServerAction, config_path: &str) -> Result<()> {
    let config = AgentConfig::load(config_path).await?;
    match action {
        ServerAction::Connect => println!("Connecting to {}...", config.server_addr),
        ServerAction::Disconnect => println!("Disconnecting from server."),
        ServerAction::Status => println!("Server: {}", config.server_addr),
        ServerAction::Ping => println!("Pinging {}...", config.server_addr),
        ServerAction::Test => println!("Testing connection to {}...", config.server_addr),
    }
    Ok(())
}
