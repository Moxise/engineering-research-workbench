@echo off
rem ==========================================================
rem kb RAG service launcher (ASCII only on purpose: cmd.exe
rem mis-parses UTF-8 CJK comments under a non-UTF-8 console).
rem Starts rag/service.py with the cuda conda interpreter
rem (needs torch + sentence-transformers).
rem   run_rag_service.bat              foreground, Ctrl+C stops
rem   run_rag_service.bat --no-model   retrieval proxy only
rem                                    (FTS + graph, no model)
rem   set ERW_RAG_PYTHON=<path>        override interpreter
rem ==========================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PY=%ERW_RAG_PYTHON%"
if not defined PY set "PY=%USERPROFILE%\.conda\envs\cuda\python.exe"
if not exist "%PY%" set "PY=python"
echo [rag] interpreter: %PY%
"%PY%" "rag\service.py" %*
pause
