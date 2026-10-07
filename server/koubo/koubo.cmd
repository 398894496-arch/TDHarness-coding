@echo off
rem Talking-head rough cut. Models are kept beside the tool so every account shares one copy.
setlocal
set "KOUBO_HOME=%~dp0"
set "MODELSCOPE_CACHE=%KOUBO_HOME%models"
set "REMBG_HOME=%KOUBO_HOME%models\rembg"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
if not defined KOUBO_FFMPEG if exist "%USERPROFILE%\TDH\CompanyDesk\ffmpeg\bin\ffmpeg.exe" set "KOUBO_FFMPEG=%USERPROFILE%\TDH\CompanyDesk\ffmpeg\bin\ffmpeg.exe"
"%KOUBO_HOME%venv\Scripts\python.exe" "%KOUBO_HOME%koubo.py" %*
exit /b %ERRORLEVEL%
