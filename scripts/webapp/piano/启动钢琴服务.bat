@echo off
chcp 65001 >nul
cd /d %~dp0
title 万能音效钢琴 - 局域网服务

set PY=C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe
if not exist "%PY%" set PY=python

"%PY%" serve.py
pause
