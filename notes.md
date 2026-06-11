
  The issue: The agent is connecting to wss://localhost:8000 but the WebSocket endpoint is at wss://localhost:8000/ws/ingest/.
  
  Fix: Reconfigure the agent with the correct path:
  
  sudo ./release/beacon-agent init
  
  When prompted for server address, enter: wss://localhost:8000/ws/ingest/
  
  Alternatively, if you want to test without reinitializing, edit the config directly:
  
  sudo nano /etc/beacon/agent.toml
  
  Change the server URL to include /ws/ingest/ at the end.




  ------------------


    cd beacon-platform/server
  source beacon_venv/bin/activate
  daphne -b 0.0.0.0 -p 8000 beacon_server.asgi:application
  
  Or if you want it to run in the background:
  
  daphne -b 0.0.0.0 -p 8000 beacon_server.asgi:application &
  
  Daphne is the ASGI server that supports both HTTP and WebSocket connections, which is what your beacon-agent needs to connect.