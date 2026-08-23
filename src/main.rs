use clap::{Parser, Subcommand};
use mnote::{api, db, ensure_data_layout, logs_dir, AppState};
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[derive(Parser)]
#[command(name = "mnote", about = "Personal markdown notes")]
struct Cli {
    #[arg(long, env = "MNOTE_DATA", default_value = "data")]
    data: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(long, env = "MNOTE_BIND", default_value = "0.0.0.0:3000")]
        bind: String,
    },
    User {
        #[command(subcommand)]
        command: UserCommand,
    },
}

#[derive(Subcommand)]
enum UserCommand {
    Add {
        username: String,
        #[arg(long)]
        password: Option<String>,
    },
    List,
    #[command(name = "reset-password")]
    ResetPassword {
        username: String,
    },
}

fn resolve_data_dir(data: PathBuf) -> anyhow::Result<PathBuf> {
    let path = if data.is_absolute() {
        data
    } else {
        std::env::current_dir()?.join(data)
    };
    Ok(path.canonicalize().unwrap_or(path))
}

fn warn_if_likely_wrong_data_dir(data_dir: &std::path::Path) {
    let this_db = mnote::db_path(data_dir);
    let Some(alt) = data_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("data"))
    else {
        return;
    };
    let alt_db = mnote::db_path(&alt);
    if alt_db == this_db || !alt_db.is_file() {
        return;
    }
    if data_dir.ends_with("web/data") {
        eprintln!(
            "warning: using {} (cwd-relative). Notes DB is probably {}",
            data_dir.display(),
            alt.display()
        );
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let data = resolve_data_dir(cli.data)?;
    ensure_data_layout(&data)?;
    let _guard = init_logging(&data)?;
    match cli.command {
        Command::Serve { bind } => serve(data, bind).await,
        Command::User { command } => {
            warn_if_likely_wrong_data_dir(&data);
            let state = AppState::open(&data)?;
            match command {
                UserCommand::Add { username, password } => {
                    let password = db::create_user(&state, &username, password.as_deref())?;
                    print_account_invite(&username, &password, &data);
                }
                UserCommand::List => {
                    for user in db::list_users(&state)? {
                        let flag = if user.must_change_password {
                            " (set password on next login)"
                        } else {
                            ""
                        };
                        println!("{}{flag}", user.username);
                    }
                }
                UserCommand::ResetPassword { username } => {
                    let password = db::reset_password(&state, &username)?;
                    print_account_invite(&username, &password, &data);
                }
            }
            Ok(())
        }
    }
}

fn public_url() -> String {
    std::env::var("MNOTE_PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".into())
}

fn print_account_invite(username: &str, password: &str, data: &std::path::Path) {
    let url = public_url();
    println!("Created account '{username}'.");
    println!();
    println!("Send them this:");
    println!("  Open:                 {url}");
    println!("  Username:             {username}");
    println!("  Temporary password:   {password}");
    println!();
    println!("They must choose a new password on first login.");
    eprintln!("data {}", data.display());
}

fn init_logging(
    data: &std::path::Path,
) -> anyhow::Result<tracing_appender::non_blocking::WorkerGuard> {
    let file_appender = tracing_appender::rolling::daily(logs_dir(data), "mnote.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "mnote=info,tower_http=info".into());
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(file_writer),
        )
        .init();
    Ok(guard)
}

async fn serve(data: PathBuf, bind: String) -> anyhow::Result<()> {
    warn_if_likely_wrong_data_dir(&data);
    let state = AppState::open(&data)?;
    let app = api::router(state);
    let addr: SocketAddr = bind.parse()?;
    tracing::info!(data = %data.display(), "listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
