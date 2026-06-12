#!/bin/zsh
cd "$(dirname "$0")"
python3 -m http.server 8765 --bind 127.0.0.1 &
SERVER_PID=$!
sleep 1
open "http://127.0.0.1:8765"
wait $SERVER_PID
