@echo off
REM Force overwrite local changes and match origin/main.
REM WARNING: This discards ALL local modifications and untracked files.

cd /d "%~dp0"

git fetch origin
git checkout main
git reset --hard origin/main
git clean -fd
pause 