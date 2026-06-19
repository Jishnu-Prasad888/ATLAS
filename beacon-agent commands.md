run with 

`sudo beacon-agent <command>`

- init — Interactive first-time setup (server, credentials, secret).
- start — Start the agent daemon.
- status — Show agent status summary.
- tui — Launch the terminal UI.
Auth:
- login --username <u> [--password <p>] — Log in to the server.
- logout — Log out.
- whoami — Show current user.
Service (systemd helpers):
- service install|remove|start|stop|restart|status — Manage the systemd service.
Collectors / Metrics:
- <collector> enable|disable for: cpu, ram, storage, network, process, systemd, docker, kubernetes.
- metrics enable-all|disable-all — Toggle all collectors.
- metrics interval <value> — Set collection interval (e.g., 1s, 5s, 30s, 1m).
- metrics retention <value> — Set retention period (string value).
- metrics status — Show current metrics/collector status.
Agent management:
- agent list|show <agent_id>|enable <agent_id>|disable <agent_id>|remove <agent_id>|rename <agent_id> <name>|regenerate-id.
Logs:
- logs view — Show recent logs.
- logs follow — Stream logs (placeholder).
- logs export <output> — Export logs (placeholder).
- logs search <query> — Search logs.
- logs clear — Clear all logs.
- logs clear-errors — Delete error logs.
- logs clear-warnings — Delete warning logs.
Audit:
- audit logs — Show recent audit entries.
- audit export <output> — Export audit (placeholder).
Database:
- db status — Show DB record counts.
- db backup [<output>] — Backup (metrics DB) to file.
- db restore <input> — Restore guidance.
- db compact or db vacuum — Vacuum all DBs.
- db verify — Integrity check.
- db export <output> — Export (placeholder).
- db clear — Clear databases (placeholder).
- db reset — Reset databases (placeholder).
Encryption:
- encryption enable|disable|rotate-key|status — Manage local encryption.
Queue:
- queue status — Show queue counts.
- queue clear — Clear queue.
- queue pause|resume — Control queue processing.
- queue retry-failed — Requeue failed messages.
Server:
- server connect|disconnect|status|ping|test — Connectivity helpers.