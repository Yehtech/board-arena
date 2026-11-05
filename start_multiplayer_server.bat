@echo off
title World Classic Board Games Arena - Authoritative C# Multiplayer Server
cd /d "%~dp0"
if not exist "%~dp0BoardArenaServer.exe" (
    echo Compiling BoardArenaServer.exe via .NET Framework 64-bit csc.exe...
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize+ /r:System.Web.Extensions.dll /out:"%~dp0BoardArenaServer.exe" "%~dp0server\BoardArenaServer.cs"
)
echo Starting Authoritative Multiplayer & Glicko-2 Server on http://127.0.0.1:8890/ ...
start "" "http://127.0.0.1:8890/index.html"
"%~dp0BoardArenaServer.exe" --port=8890
