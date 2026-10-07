; ------------------------------------------
; vipe_pos_installer.iss
; Instalador para Vipe POS - Producción con autoarranque
; ------------------------------------------

#define AppName      "Vipe POS"
#define AppVersion   "1.0"
#define AppPublisher "RADE STUDIO"
#define AppExeName   "Vipe POS"
#define SrcDir       "dist\vipe_pos"
#define LibWdiDir    "libwdi"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={pf}\{#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=VipePOS_Setup
Compression=lzma
SolidCompression=yes
ChangesEnvironment=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; Copia todos los archivos empaquetados por PyInstaller
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
; libwdi driver installer binaries (WinUSB / libusbK)
Source: "{#LibWdiDir}\*\*.dll"; DestDir: "{app}\libwdi"; Flags: recursesubdirs ignoreversion

[Icons]
; Menú Inicio
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

; Escritorio
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

; Autoarranque en carpeta "Inicio" del usuario
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

[Code]
; Delphi/Pascal Inno Setup code — installs WinUSB or libusbK driver
; for the USB thermal printer via libwdi's WDI driver installer.
;
; Usage: WDI_InstallDriver(VID, PID, DriverType)
;   DriverType = 0 → WinUSB (recommended for Windows 10+)
;   DriverType = 1 → libusbK
;
; Download libwdi pre-built binaries from https://github.com/pbatard/libwdi
; and place them in pos/libwdi/ before building the installer.

type
  WDI_DriverType = (dtWinUSB = 0, dtLibusbK = 1);

function WDI_InstallDriver(VID, PID: Integer; DriverType: WDI_DriverType): Boolean;
var
  ResultCode: Integer;
  DriverPath: String;
  Params: String;
begin
  Result := False;
  DriverPath := ExpandConstant('{app}\libwdi\wdi-install.exe');
  if not FileExists(DriverPath) then
  begin
    MsgBox('libwdi driver installer not found at: ' + DriverPath + #13#10 +
           'Download libwdi from https://github.com/pbatard/libwdi and ' +
           'place wdi-install.exe in the libwdi/ folder.', mbError, MB_OK);
    Exit;
  end;

  // Build VID:PID string and driver type flag.
  Params := Format('-q -d %d:%d', [VID, PID]);
  if DriverType = dtWinUSB then
    Params := Params + ' -w'
  else
    Params := Params + ' -k';

  Result := Exec(DriverPath, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
            and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
var
  InstallDrivers: Integer;
begin
  Result := True;
  // Ask user if they want to install USB printer drivers.
  InstallDrivers := MsgBox(
    'Do you want to install USB drivers for thermal printers now?' + #13#10 +
    'This requires an internet connection to download the driver package.' + #13#10 +
    'You can also run this step later from the app menu.',
    mbConfirmation,
    MB_YESNO
  );
  if InstallDrivers = IDYES then
  begin
    // Common thermal printer VID:PID pairs — WinUSB driver.
    // Users with different printers can use the app''s USB scanner dialog
    // or manually run wdi-install.exe from the libwdi folder.
    if not WDI_InstallDriver($04B8, $0202, dtWinUSB) then  // Epson TM-T88
      MsgBox('WinUSB driver install failed. Configure the printer manually via the app.',
             mbWarning, MB_OK);
  end;
end;

[Run]
; Optional: launch driver installer after main install completes
Filename: "{app}\libwdi\wdi-install.exe"; Parameters: "-q"; Flags: postinstall skipifsilent
