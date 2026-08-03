@echo off
setlocal

cd /d "%~dp0"

echo Building TypeR...
call npm run build
if errorlevel 1 (
    echo.
    echo Build failed. Release archive was not created.
    exit /b 1
)

for /f %%I in ('PowerShell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RELEASE_TIMESTAMP=%%I"
set "ARCHIVE_NAME=TypeR_%RELEASE_TIMESTAMP%.zip"

echo.
echo Creating %ARCHIVE_NAME%...
PowerShell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $root = (Get-Location).Path; $items = @('app', 'CSXS', 'icons', 'locale', 'install.ps1', 'install_mac.sh', 'install_win.cmd', 'update_typer_win.cmd', 'update_typer_mac.sh'); $missing = $items | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) }; if ($missing) { throw ('Missing release items: ' + ($missing -join ', ')) }; $sources = $items | ForEach-Object { Join-Path $root $_ }; Compress-Archive -LiteralPath $sources -DestinationPath (Join-Path $root $env:ARCHIVE_NAME) -CompressionLevel Optimal"
if errorlevel 1 (
    echo.
    echo Release archive creation failed.
    exit /b 1
)

echo.
echo Release archive created: %CD%\%ARCHIVE_NAME%
exit /b 0
