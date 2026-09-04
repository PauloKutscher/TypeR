param([switch]$Silent)

# Encodage pour les accents dans la console
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding

# Les invites bloquent les installations scriptées (CI, irm | iex, agents) :
# on ne demande une touche que dans une vraie console interactive
$Interactive = -not $Silent
try {
    if ([Console]::IsInputRedirected) { $Interactive = $false }
} catch { $Interactive = $false }

# --- 1. Définition robuste du dossier du script ---
# $PSScriptRoot est une variable native fiable, contrairement à %~dp0
$ScriptDir = $PSScriptRoot
Set-Location -Path $ScriptDir

# --- 2. Vérification du Manifest ---
$ManifestPath = Join-Path $ScriptDir "CSXS\manifest.xml"
if (-not (Test-Path $ManifestPath)) {
    Write-Host "[ERREUR] Fichier introuvable : $ManifestPath" -ForegroundColor Red
    Write-Host "Placez ce script à côté des dossiers 'CSXS', 'app', 'icons', 'locale', 'themes'."
    if ($Interactive) { Read-Host "Appuyez sur Entrée pour quitter..." }
    exit 1
}

# --- 3. Extraction de la version (plus précis que findstr) ---
$Content = Get-Content $ManifestPath -Raw
if ($Content -match 'Extension Id="typer".*?Version="([^"]+)"') {
    $ExtVersion = $matches[1]
} else {
    $ExtVersion = "Inconnue"
}

# --- 4. Langues et messages ---
# Détection de la langue de l'interface utilisateur (ex: fr-FR)
$Lang = $Host.CurrentCulture.TwoLetterISOLanguageName

# Valeurs par défaut (anglais)
$msg_install  = "Photoshop extension TypeR v$ExtVersion will be installed."
$msg_close    = "Close Photoshop (if it is open)."
$msg_complete = "Installation completed."
$msg_open     = "Open Photoshop and in the upper menu click the following: [Window] > [Extensions] > [TypeR]"
$msg_pause    = "Press Enter to continue..."
$msg_credits  = "TypeR developed by Sakushi & SeanR."
$msg_typertools = "typertools, developed by Swirt: https://swirt.github.io/typertools/"
$msg_discord  = "ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"

if ($Lang -eq "fr") {
    $msg_install  = "L'extension Photoshop TypeR v$ExtVersion sera installée."
    $msg_close    = "Fermez Photoshop (s'il est ouvert)."
    $msg_complete = "Installation terminée."
    $msg_open     = "Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
    $msg_pause    = "Appuyez sur Entrée pour continuer..."
    $msg_credits  = "TypeR développé par Sakushi & SeanR."
    $msg_typertools = "typertools, développé par Swirt : https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
}
elseif ($Lang -eq "es") {
    $msg_install  = "La extensión de Photoshop TypeR v$ExtVersion se instalará."
    $msg_close    = "Cierra Photoshop (si está abierto)."
    $msg_complete = "Instalación completada."
    $msg_open     = "Abre Photoshop y en el menú superior haz clic en lo siguiente: [Ventana] > [Extensiones] > [TypeR]"
    $msg_pause    = "Presiona Enter para continuar..."
    $msg_credits  = "TypeR desarrollado por Sakushi & SeanR."
    $msg_typertools = "typertools, desarrollado por Swirt: https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"
}
elseif ($Lang -eq "pt") {
    $msg_install  = "A extensão do Photoshop TypeR v$ExtVersion será instalada."
    $msg_close    = "Feche o Photoshop (se estiver aberto)."
    $msg_complete = "Instalação concluída."
    $msg_open     = "Abra o Photoshop e no menu superior clique em: [Janela] > [Extensões] > [TypeR]"
    $msg_pause    = "Pressione Enter para continuar..."
    $msg_credits  = "TypeR desenvolvido por Sakushi & SeanR."
    $msg_typertools = "typertools, desenvolvido por Swirt: https://swirt.github.io/typertools/"
    $msg_discord  = "Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"
}

Clear-Host
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|                          TypeR Installer                         |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Host $msg_install
Write-Host ""
Write-Host $msg_close -ForegroundColor Yellow
Write-Host ""
if ($Interactive) { Read-Host -Prompt $msg_pause }

# --- 5. Mode Debug (CSXS 6 à 18) ---
# Ne nécessite pas les droits admin car c'est dans HKCU (utilisateur courant)
6..18 | ForEach-Object {
    $RegPath = "HKCU:\Software\Adobe\CSXS.$_"
    if (Test-Path $RegPath) {
        Set-ItemProperty -Path $RegPath -Name "PlayerDebugMode" -Value 1 -Type String -ErrorAction SilentlyContinue
    }
}

# --- 6. Copie des fichiers ---
# On remplace uniquement les dossiers applicatifs : les réglages de
# l'utilisateur (storage*) ne sont jamais touchés, donc plus besoin de
# sauvegarde/restauration (et plus aucun risque de les perdre en cours de route)
$AppData = $env:APPDATA
$TargetDir = Join-Path $AppData "Adobe\CEP\extensions\typertools"
New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null

$FoldersToCopy = @("app", "CSXS", "icons", "locale")

foreach ($folder in $FoldersToCopy) {
    $Source = Join-Path $ScriptDir $folder
    $Dest = Join-Path $TargetDir $folder
    if (Test-Path $Source) {
        if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Item $Source -Destination $Dest -Recurse -Force
    }
}

# Cas particulier : descripteur de débogage distant
# Absent du zip de release (build_release.cmd travaille sur une liste blanche) :
# la copie ne concerne donc que les machines de développement, où elle remplace
# aussi un ancien .debug dont l'Extension Id ne correspondait pas au manifeste.
if (Test-Path "$ScriptDir\.debug") {
    Copy-Item "$ScriptDir\.debug" -Destination (Join-Path $TargetDir ".debug") -Force
}

# Cas particulier : thèmes
if (Test-Path "$ScriptDir\themes") {
    $ThemeDest = "$TargetDir\app\themes"
    if (-not (Test-Path $ThemeDest)) { New-Item $ThemeDest -ItemType Directory -Force | Out-Null }
    Copy-Item "$ScriptDir\themes\*" -Destination $ThemeDest -Recurse -Force
}

# --- 7. Fin ---
Write-Host ""
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host "|                      Installation Completed                      |" -ForegroundColor Green
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host $msg_complete
Write-Host ""
Write-Host $msg_open -ForegroundColor Cyan
Write-Host ""
Write-Host "+------------------------------------------------------------------+"
Write-Host "| Credits:                                                         |"
Write-Host "+------------------------------------------------------------------+"
Write-Host ("  {0}" -f $msg_credits)
Write-Host ("  {0}" -f $msg_typertools)
Write-Host ("  {0}" -f $msg_discord)
Write-Host ""
if ($Interactive) { Read-Host -Prompt $msg_pause }
