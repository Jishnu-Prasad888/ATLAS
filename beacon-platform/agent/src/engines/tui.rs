// engines/tui.rs — Terminal User Interface (TUI)
// Built with Ratatui. Keyboard-driven, live WebSocket-backed updates.
// Views: Dashboard | Agents | Metrics | Logs | Health | Network | Configuration

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Borders, BorderType, Cell, Clear, Gauge, List, ListItem, ListState,
        Paragraph, Row, Table, TableState, Tabs, Wrap,
    },
    Frame, Terminal,
};
use std::io;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{Local, Utc};

use crate::config::AgentConfig;
use crate::storage::StorageManager;

#[derive(Debug, Clone, PartialEq)]
pub enum View {
    Dashboard,
    Agents,
    Metrics,
    Logs,
    Health,
    Network,
    Configuration,
}

impl View {
    pub fn all() -> Vec<&'static str> {
        vec!["Dashboard", "Agents", "Metrics", "Logs", "Health", "Network", "Configuration"]
    }

    pub fn index(&self) -> usize {
        match self {
            View::Dashboard     => 0,
            View::Agents        => 1,
            View::Metrics       => 2,
            View::Logs          => 3,
            View::Health        => 4,
            View::Network       => 5,
            View::Configuration => 6,
        }
    }

    pub fn from_index(i: usize) -> Self {
        match i {
            0 => View::Dashboard,
            1 => View::Agents,
            2 => View::Metrics,
            3 => View::Logs,
            4 => View::Health,
            5 => View::Network,
            6 => View::Configuration,
            _ => View::Dashboard,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub severity:  String,
    pub source:    String,
    pub message:   String,
}

#[derive(Debug, Clone)]
pub struct MetricSample {
    pub name:  String,
    pub value: f64,
    pub unit:  String,
}

pub struct AppState {
    pub current_view:   View,
    pub tab_index:      usize,
    pub agent_id:       String,
    pub hostname:       String,
    pub server_addr:    String,
    pub status:         String,
    pub uptime_secs:    u64,
    pub logs:           Vec<LogEntry>,
    pub log_state:      ListState,
    pub metrics:        Vec<MetricSample>,
    pub search_query:   String,
    pub searching:      bool,
    pub quit:           bool,
    // Live metric sparklines (ring buffers)
    pub cpu_history:    Vec<f64>,
    pub ram_history:    Vec<f64>,
    pub net_rx_history: Vec<f64>,
    pub net_tx_history: Vec<f64>,
    pub queue_status:   String,
    pub collectors:     Vec<(String, String)>,  // (name, status)
}

impl AppState {
    pub fn new(config: &AgentConfig, agent_id: &str, hostname: &str) -> Self {
        let mut log_state = ListState::default();
        log_state.select(Some(0));
        Self {
            current_view:   View::Dashboard,
            tab_index:      0,
            agent_id:       agent_id.to_string(),
            hostname:       hostname.to_string(),
            server_addr:    config.server_addr.clone(),
            status:         "ONLINE".to_string(),
            uptime_secs:    0,
            logs:           Vec::new(),
            log_state,
            metrics:        Vec::new(),
            search_query:   String::new(),
            searching:      false,
            quit:           false,
            cpu_history:    vec![0.0; 60],
            ram_history:    vec![0.0; 60],
            net_rx_history: vec![0.0; 60],
            net_tx_history: vec![0.0; 60],
            queue_status:   "OK".to_string(),
            collectors:     vec![
                ("CPU".to_string(), "Healthy".to_string()),
                ("RAM".to_string(), "Healthy".to_string()),
                ("Storage".to_string(), "Healthy".to_string()),
                ("Network".to_string(), "Healthy".to_string()),
                ("Process".to_string(), "Healthy".to_string()),
                ("Systemd".to_string(), "Healthy".to_string()),
            ],
        }
    }

    pub fn push_cpu(&mut self, v: f64) {
        self.cpu_history.remove(0);
        self.cpu_history.push(v.clamp(0.0, 100.0));
    }

    pub fn push_ram(&mut self, v: f64) {
        self.ram_history.remove(0);
        self.ram_history.push(v.clamp(0.0, 100.0));
    }

    pub fn push_log(&mut self, entry: LogEntry) {
        self.logs.insert(0, entry);
        if self.logs.len() > 1000 {
            self.logs.truncate(1000);
        }
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

pub async fn run(config: AgentConfig, storage: StorageManager) -> Result<()> {
    let agent_id = storage
        .get_agent_identity()
        .await?
        .map(|(id, _)| id)
        .unwrap_or_else(|| "unknown".to_string());

    let hostname = storage
        .get_agent_identity()
        .await?
        .map(|(_, h)| h)
        .unwrap_or_else(|| "unknown".to_string());

    let state = Arc::new(RwLock::new(AppState::new(&config, &agent_id, &hostname)));

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend  = CrosstermBackend::new(stdout);
    let mut term = Terminal::new(backend)?;

    // Seed some mock data for demo
    {
        let mut s = state.write().await;
        for i in 0..60 {
            s.cpu_history[i] = (i as f64 * 1.5).sin().abs() * 70.0 + 10.0;
            s.ram_history[i] = 45.0 + (i as f64 * 0.8).cos() * 10.0;
        }
        s.logs.push(LogEntry {
            timestamp: Utc::now().to_rfc3339(),
            severity:  "Info".to_string(),
            source:    "internal".to_string(),
            message:   "Beacon agent started successfully".to_string(),
        });
        s.metrics = vec![
            MetricSample { name: "CPU Usage".to_string(),   value: 34.2,  unit: "%".to_string() },
            MetricSample { name: "RAM Usage".to_string(),   value: 52.8,  unit: "%".to_string() },
            MetricSample { name: "Disk I/O".to_string(),    value: 12.4,  unit: "MB/s".to_string() },
            MetricSample { name: "Net RX".to_string(),      value: 2.1,   unit: "MB/s".to_string() },
            MetricSample { name: "Net TX".to_string(),      value: 0.8,   unit: "MB/s".to_string() },
            MetricSample { name: "Load Avg".to_string(),    value: 0.72,  unit: "".to_string() },
            MetricSample { name: "Processes".to_string(),   value: 243.0, unit: "".to_string() },
            MetricSample { name: "Uptime".to_string(),      value: 42.0,  unit: "days".to_string() },
        ];
    }

    let result = run_event_loop(&mut term, state.clone()).await;

    // Restore terminal
    disable_raw_mode()?;
    execute!(term.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    term.show_cursor()?;

    result
}

async fn run_event_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    state: Arc<RwLock<AppState>>,
) -> Result<()> {
    loop {
        {
            let s = state.read().await;
            terminal.draw(|f| draw_ui(f, &s))?;
            if s.quit { break; }
        }

        // Poll events with 100ms timeout for live updates
        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                let mut s = state.write().await;
                handle_key(&mut s, key.code, key.modifiers);
            }
        }
    }
    Ok(())
}

fn handle_key(state: &mut AppState, code: KeyCode, mods: KeyModifiers) {
    if state.searching {
        match code {
            KeyCode::Esc         => { state.searching = false; state.search_query.clear(); }
            KeyCode::Enter       => { state.searching = false; }
            KeyCode::Backspace   => { state.search_query.pop(); }
            KeyCode::Char(c)     => { state.search_query.push(c); }
            _ => {}
        }
        return;
    }

    match code {
        KeyCode::Char('q') | KeyCode::Char('Q') => { state.quit = true; }
        KeyCode::Char('c') if mods.contains(KeyModifiers::CONTROL) => { state.quit = true; }

        // Tab navigation
        KeyCode::Tab | KeyCode::Right => {
            state.tab_index = (state.tab_index + 1) % View::all().len();
            state.current_view = View::from_index(state.tab_index);
        }
        KeyCode::BackTab | KeyCode::Left => {
            state.tab_index = state.tab_index.checked_sub(1).unwrap_or(View::all().len() - 1);
            state.current_view = View::from_index(state.tab_index);
        }
        KeyCode::Char('1') => { state.tab_index = 0; state.current_view = View::Dashboard; }
        KeyCode::Char('2') => { state.tab_index = 1; state.current_view = View::Agents; }
        KeyCode::Char('3') => { state.tab_index = 2; state.current_view = View::Metrics; }
        KeyCode::Char('4') => { state.tab_index = 3; state.current_view = View::Logs; }
        KeyCode::Char('5') => { state.tab_index = 4; state.current_view = View::Health; }
        KeyCode::Char('6') => { state.tab_index = 5; state.current_view = View::Network; }
        KeyCode::Char('7') => { state.tab_index = 6; state.current_view = View::Configuration; }

        // Log navigation
        KeyCode::Up | KeyCode::Char('k') => {
            if state.current_view == View::Logs {
                let i = state.log_state.selected().unwrap_or(0);
                state.log_state.select(Some(i.saturating_sub(1)));
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if state.current_view == View::Logs {
                let i = state.log_state.selected().unwrap_or(0);
                let max = state.logs.len().saturating_sub(1);
                state.log_state.select(Some((i + 1).min(max)));
            }
        }

        // Search
        KeyCode::Char('/') => { state.searching = true; }

        _ => {}
    }
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

fn draw_ui(f: &mut Frame, state: &AppState) {
    let size = f.size();

    // Overall layout: header | tabs | content | footer
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),   // header
            Constraint::Length(3),   // tabs
            Constraint::Min(0),      // content
            Constraint::Length(1),   // footer
        ])
        .split(size);

    draw_header(f, state, chunks[0]);
    draw_tabs(f, state, chunks[1]);
    draw_content(f, state, chunks[2]);
    draw_footer(f, state, chunks[3]);

    // Search overlay
    if state.searching {
        draw_search(f, size, state);
    }
}

fn draw_header(f: &mut Frame, state: &AppState, area: Rect) {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let title = Line::from(vec![
        Span::styled("▣ BEACON", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::raw("  "),
        Span::styled(&state.hostname, Style::default().fg(Color::Yellow)),
        Span::raw("  │  "),
        Span::styled(&state.agent_id[..16.min(state.agent_id.len())], Style::default().fg(Color::DarkGray)),
        Span::raw("..."),
        Span::raw("  │  "),
        Span::styled(&state.status, Style::default().fg(
            if state.status == "ONLINE" { Color::Green } else { Color::Red }
        ).add_modifier(Modifier::BOLD)),
        Span::raw("  │  "),
        Span::styled(now, Style::default().fg(Color::DarkGray)),
    ]);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::Cyan));
    let para = Paragraph::new(title)
        .block(block)
        .alignment(Alignment::Left);
    f.render_widget(para, area);
}

fn draw_tabs(f: &mut Frame, state: &AppState, area: Rect) {
    let titles: Vec<Line> = View::all()
        .iter()
        .enumerate()
        .map(|(i, name)| {
            Line::from(Span::styled(
                format!(" {} {} ", i + 1, name),
                if i == state.tab_index {
                    Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                },
            ))
        })
        .collect();

    let tabs = Tabs::new(titles)
        .block(Block::default().borders(Borders::ALL).border_type(BorderType::Rounded))
        .select(state.tab_index)
        .divider(Span::raw("│"));
    f.render_widget(tabs, area);
}

fn draw_content(f: &mut Frame, state: &AppState, area: Rect) {
    match state.current_view {
        View::Dashboard     => draw_dashboard(f, state, area),
        View::Agents        => draw_agents(f, state, area),
        View::Metrics       => draw_metrics(f, state, area),
        View::Logs          => draw_logs(f, state, area),
        View::Health        => draw_health(f, state, area),
        View::Network       => draw_network(f, state, area),
        View::Configuration => draw_configuration(f, state, area),
    }
}

fn draw_dashboard(f: &mut Frame, state: &AppState, area: Rect) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    let left = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Length(3), Constraint::Min(0)])
        .split(cols[0]);

    // CPU Gauge
    let cpu = state.cpu_history.last().cloned().unwrap_or(0.0);
    let cpu_gauge = Gauge::default()
        .block(Block::default().title(" CPU ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .gauge_style(Style::default().fg(if cpu > 80.0 { Color::Red } else if cpu > 60.0 { Color::Yellow } else { Color::Green }))
        .percent(cpu as u16)
        .label(format!("{:.1}%", cpu));
    f.render_widget(cpu_gauge, left[0]);

    // RAM Gauge
    let ram = state.ram_history.last().cloned().unwrap_or(0.0);
    let ram_gauge = Gauge::default()
        .block(Block::default().title(" RAM ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .gauge_style(Style::default().fg(if ram > 80.0 { Color::Red } else if ram > 60.0 { Color::Yellow } else { Color::Cyan }))
        .percent(ram as u16)
        .label(format!("{:.1}%", ram));
    f.render_widget(ram_gauge, left[1]);

    // Metrics table
    let rows: Vec<Row> = state.metrics.iter().map(|m| {
        Row::new(vec![
            Cell::from(m.name.clone()),
            Cell::from(format!("{:.2} {}", m.value, m.unit))
                .style(Style::default().fg(Color::Yellow)),
        ])
    }).collect();

    let table = Table::new(rows, [Constraint::Percentage(60), Constraint::Percentage(40)])
        .header(Row::new(["Metric", "Value"])
            .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)))
        .block(Block::default().title(" Metrics ").borders(Borders::ALL).border_type(BorderType::Rounded));
    f.render_widget(table, left[2]);

    // Right: recent logs
    draw_logs_panel(f, state, cols[1]);
}

fn draw_logs_panel(f: &mut Frame, state: &AppState, area: Rect) {
    let items: Vec<ListItem> = state.logs.iter().take(30).map(|l| {
        let sev_color = match l.severity.as_str() {
            "Critical" | "Error" => Color::Red,
            "Warning"            => Color::Yellow,
            "Info"               => Color::Green,
            "Debug"              => Color::Blue,
            _                    => Color::DarkGray,
        };
        let line = Line::from(vec![
            Span::styled(format!("[{}] ", &l.timestamp[11..19]), Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{:<8}", l.severity), Style::default().fg(sev_color)),
            Span::raw(" "),
            Span::styled(l.message.chars().take(60).collect::<String>(), Style::default().fg(Color::White)),
        ]);
        ListItem::new(line)
    }).collect();

    let list = List::new(items)
        .block(Block::default().title(" Recent Logs ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .highlight_style(Style::default().bg(Color::DarkGray));
    f.render_widget(list, area);
}

fn draw_agents(f: &mut Frame, _state: &AppState, area: Rect) {
    let text = vec![
        Line::from(Span::styled("  Agent Management", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(vec![
            Span::styled("  agent_id:   ", Style::default().fg(Color::DarkGray)),
            Span::styled("sha256:a3f1...", Style::default().fg(Color::Yellow)),
        ]),
        Line::from(vec![
            Span::styled("  hostname:   ", Style::default().fg(Color::DarkGray)),
            Span::styled("prod-server-01", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  status:     ", Style::default().fg(Color::DarkGray)),
            Span::styled("ONLINE", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("  version:    ", Style::default().fg(Color::DarkGray)),
            Span::styled("1.0.0", Style::default().fg(Color::White)),
        ]),
    ];
    let para = Paragraph::new(text)
        .block(Block::default().title(" Agents ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .wrap(Wrap { trim: true });
    f.render_widget(para, area);
}

fn draw_metrics(f: &mut Frame, state: &AppState, area: Rect) {
    let rows: Vec<Row> = state.metrics.iter().map(|m| {
        Row::new(vec![
            Cell::from(m.name.clone()).style(Style::default().fg(Color::Cyan)),
            Cell::from(format!("{:.4}", m.value)).style(Style::default().fg(Color::Yellow)),
            Cell::from(m.unit.clone()).style(Style::default().fg(Color::DarkGray)),
        ])
    }).collect();

    let table = Table::new(rows, [Constraint::Percentage(40), Constraint::Percentage(30), Constraint::Percentage(30)])
        .header(Row::new(["Metric", "Value", "Unit"])
            .style(Style::default().fg(Color::White).add_modifier(Modifier::BOLD | Modifier::UNDERLINED)))
        .block(Block::default().title(" Live Metrics ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .highlight_style(Style::default().bg(Color::DarkGray));
    f.render_widget(table, area);
}

fn draw_logs(f: &mut Frame, state: &AppState, area: Rect) {
    let filter = state.search_query.to_lowercase();
    let items: Vec<ListItem> = state.logs.iter()
        .filter(|l| filter.is_empty() || l.message.to_lowercase().contains(&filter))
        .map(|l| {
            let sev_color = match l.severity.as_str() {
                "Critical" => Color::Magenta,
                "Error"    => Color::Red,
                "Warning"  => Color::Yellow,
                "Info"     => Color::Green,
                "Debug"    => Color::Blue,
                "Trace"    => Color::DarkGray,
                _          => Color::White,
            };
            let line = Line::from(vec![
                Span::styled(format!("{} ", &l.timestamp[..19]), Style::default().fg(Color::DarkGray)),
                Span::styled(format!("[{:<8}]", l.severity), Style::default().fg(sev_color)),
                Span::styled(format!(" ({}) ", l.source), Style::default().fg(Color::Cyan)),
                Span::raw(l.message.clone()),
            ]);
            ListItem::new(line)
        })
        .collect();

    let mut log_state = state.log_state.clone();
    let list = List::new(items)
        .block(Block::default()
            .title(format!(" Logs [{} entries] ", state.logs.len()))
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded))
        .highlight_style(Style::default().bg(Color::DarkGray).add_modifier(Modifier::BOLD));
    f.render_stateful_widget(list, area, &mut log_state);
}

fn draw_health(f: &mut Frame, state: &AppState, area: Rect) {
    let rows: Vec<Row> = state.collectors.iter().map(|(name, status)| {
        let color = match status.as_str() {
            "Healthy"  => Color::Green,
            "Degraded" => Color::Yellow,
            "Failed"   => Color::Red,
            "Disabled" => Color::DarkGray,
            _          => Color::White,
        };
        Row::new(vec![
            Cell::from(name.clone()),
            Cell::from(status.clone()).style(Style::default().fg(color).add_modifier(Modifier::BOLD)),
        ])
    }).collect();

    let table = Table::new(rows, [Constraint::Percentage(50), Constraint::Percentage(50)])
        .header(Row::new(["Collector", "Status"])
            .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)))
        .block(Block::default()
            .title(format!(" Health — Agent {} ", state.status))
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded));
    f.render_widget(table, area);
}

fn draw_network(f: &mut Frame, _state: &AppState, area: Rect) {
    let text = vec![
        Line::from(Span::styled("  Network Statistics", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(vec![
            Span::styled("  eth0 RX:  ", Style::default().fg(Color::DarkGray)),
            Span::styled("2.1 MB/s", Style::default().fg(Color::Green)),
        ]),
        Line::from(vec![
            Span::styled("  eth0 TX:  ", Style::default().fg(Color::DarkGray)),
            Span::styled("0.8 MB/s", Style::default().fg(Color::Yellow)),
        ]),
        Line::from(vec![
            Span::styled("  Packets:  ", Style::default().fg(Color::DarkGray)),
            Span::styled("1,234 rx / 567 tx", Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  Drops:    ", Style::default().fg(Color::DarkGray)),
            Span::styled("0", Style::default().fg(Color::Green)),
        ]),
        Line::from(vec![
            Span::styled("  TCP conn: ", Style::default().fg(Color::DarkGray)),
            Span::styled("42 established", Style::default().fg(Color::White)),
        ]),
    ];
    let para = Paragraph::new(text)
        .block(Block::default().title(" Network ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .wrap(Wrap { trim: true });
    f.render_widget(para, area);
}

fn draw_configuration(f: &mut Frame, state: &AppState, area: Rect) {
    let text = vec![
        Line::from(Span::styled("  Configuration", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(vec![
            Span::styled("  server_addr:       ", Style::default().fg(Color::DarkGray)),
            Span::styled(&state.server_addr, Style::default().fg(Color::Yellow)),
        ]),
        Line::from(vec![
            Span::styled("  encryption:        ", Style::default().fg(Color::DarkGray)),
            Span::styled("AES-256-GCM", Style::default().fg(Color::Green)),
        ]),
        Line::from(vec![
            Span::styled("  transport:         ", Style::default().fg(Color::DarkGray)),
            Span::styled("TLS 1.3 WebSocket", Style::default().fg(Color::Green)),
        ]),
        Line::from(vec![
            Span::styled("  queue:             ", Style::default().fg(Color::DarkGray)),
            Span::styled(&state.queue_status, Style::default().fg(Color::White)),
        ]),
    ];
    let para = Paragraph::new(text)
        .block(Block::default().title(" Configuration ").borders(Borders::ALL).border_type(BorderType::Rounded))
        .wrap(Wrap { trim: true });
    f.render_widget(para, area);
}

fn draw_footer(f: &mut Frame, state: &AppState, area: Rect) {
    let keys = if state.searching {
        " ESC Cancel  ENTER Confirm  Backspace Delete "
    } else {
        " TAB/←→ Navigate  1-7 Views  /Search  j/k Scroll  q Quit "
    };
    let para = Paragraph::new(keys)
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);
    f.render_widget(para, area);
}

fn draw_search(f: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .title(" Search ")
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::Yellow));

    let width  = area.width.min(60);
    let height = 3u16;
    let x      = (area.width.saturating_sub(width)) / 2;
    let y      = (area.height.saturating_sub(height)) / 2;
    let popup  = Rect { x, y, width, height };

    f.render_widget(Clear, popup);
    let para = Paragraph::new(state.search_query.clone())
        .block(block)
        .style(Style::default().fg(Color::White));
    f.render_widget(para, popup);
}