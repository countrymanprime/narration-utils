Unicode true

####
## The Narration Utils installer (docs/adr/0082). `scripts/release/wails-build.mjs --installer` compiles it with makensis on Wails v3
## (docs/adr/0200): it renders wails_tools.nsh for the release version on every build (it is generated and not checked in) with
## `wails3 update build-assets`, and this file includes it, so only what must differ from the Wails default is here:
##
##  - Per user. No administrator prompt; the program goes under %LOCALAPPDATA%\Programs and the uninstall entry under HKCU. The app
##    replaces itself in place when it updates (docs/architecture/in-app-update.md) and needs an install folder it can write to.
##  - The program is narration-utils.exe, the name the REAPER launcher and the updater expect, not "Narration Utils.exe".
##  - The setup file is built as narration-utils-windows-x64-setup.exe (scripts/release/assets.mjs, and a test keeps the two equal);
##    packaging releases it as narration-utils-<version>-windows-x64-setup.exe, like every other release asset (docs/adr/0197).
##  - The Start Menu entries are always made: the app, and "for Audacity" (--daw Audacity, the Audacity launcher). The desktop
##    shortcut is a choice on the components page.
##  - The uninstaller removes only what the installer and the updater put in the install folder, never the folder's other contents
##    (the Wails default removes the whole folder), and leaves the narrator's settings, downloaded assets and project sidecars alone.
##  - No network access of its own. The WebView2 runtime is installed by the bootstrapper embedded here (it comes from the pinned
##    wails3 CLI), and only when it is missing.
##  - Unsigned (owner decision D7): nothing here signs anything.
##
## The build passes -DARG_WAILS_AMD64_BINARY=<the built program>. To try the installer by hand, run makensis in this folder with
## that define after one `wails-build.mjs --installer` has written wails_tools.nsh and the bootstrapper.
####

# Defaults for wails_tools.nsh. A value given with makensis -D (Wails' own Taskfile passes -DWAILS_INSTALL_SCOPE=user and
# -DREQUEST_EXECUTION_LEVEL=user for INSTALL_SCOPE=user) is kept, and is never defined twice.
!ifndef WAILS_INSTALL_SCOPE
  !define WAILS_INSTALL_SCOPE "user"
!endif
!ifndef REQUEST_EXECUTION_LEVEL
  !define REQUEST_EXECUTION_LEVEL "user"
!endif
!if "${WAILS_INSTALL_SCOPE}" != "user"
  !error "Narration Utils installs per user (docs/adr/0082): the updater must be able to replace the program in its folder."
!endif
!define PRODUCT_EXECUTABLE "narration-utils.exe"
!define UNINST_KEY_NAME "NarrationUtils"
!define SETUP_FILE "narration-utils-windows-x64-setup.exe"

!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

!define MUI_WELCOMEPAGE_TEXT "This installs ${INFO_PRODUCTNAME} ${INFO_PRODUCTVERSION} for your user account only. It needs no administrator rights.$\r$\n$\r$\nThis build is not signed, so Windows may have warned you before this window opened.$\r$\n$\r$\nClose ${INFO_PRODUCTNAME} first if it is running. Once installed, it updates itself from Settings, About and updates, after you click."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "This removes ${INFO_PRODUCTNAME} and its shortcuts from this computer.$\r$\n$\r$\nIt leaves your settings (%APPDATA%\narration-utils), the voices and models you downloaded (%LOCALAPPDATA%\narration-utils) and everything in your project folders where they are. Delete those yourself if you want them gone."

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
!insertmacro MUI_PAGE_COMPONENTS # The desktop shortcut is optional.
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page, with an option to start the app.

!insertmacro MUI_UNPAGE_CONFIRM # Says what is removed and what is left.
!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${SETUP_FILE}" # Name of the installer's file.
InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}" # Default installing folder, in the user's profile.
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation" # An update of an existing install goes where it was installed.
ShowInstDetails show # This will always show the installation details.
ShowUninstDetails show

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

Section "${INFO_PRODUCTNAME} (required)"
    SectionIn RO
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    # The Audacity launcher (audacity-integration PRD Phase 10): Audacity cannot start a program, so this entry does it instead,
    # with exactly --daw Audacity. The narrator picks the project in the app.
    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME} for Audacity.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}" "--daw Audacity"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller
    WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
SectionEnd

Section "Desktop shortcut"
    !insertmacro wails.setShellContext
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    # Only what the installer wrote and what the in-app updater leaves beside the program while it swaps it
    # (docs/adr/0074): the program, its .new copy, the .old program kept until the new one has started, and a .failed one.
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}"
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}.new"
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}.old"
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}.failed"

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME} for Audacity.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller

    # Removes the folder only when nothing else is in it: the folder may be one the narrator chose and shares with other files.
    RMDir "$INSTDIR"

    DetailPrint "Left in place: your settings (%APPDATA%\narration-utils), your downloaded voices and models (%LOCALAPPDATA%\narration-utils) and your project folders."
SectionEnd
