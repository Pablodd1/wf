@echo off
cd public
start http://localhost:8000/watch_listings_viewer.html
python -m http.server 8000
