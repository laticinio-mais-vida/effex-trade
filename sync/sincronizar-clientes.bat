@echo off
rem EFFEX Trade: sincroniza os clientes do ERP com o servidor (https://effextrade.maisvida.cloud).
rem Dois cliques: le a copia do banco do ERP, envia os clientes e mostra o resumo.
cd /d "%~dp0"
python sincronizar.py %*
echo.
pause
