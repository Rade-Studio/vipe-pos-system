; ------------------------------------------
; vipe_pos_installer.iss
; Instalador para Vipe POS - Producción con autoarranque
; ------------------------------------------

#define AppName      "Vipe POS"
#define AppVersion   "1.0"
#define AppPublisher "RADE STUDIO"
#define AppExeName   "Vipe POS"
#define SrcDir       "dist\vipe_pos"

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

[Icons]
; Menú Inicio
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

; Escritorio
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

; Autoarranque en carpeta “Inicio” del usuario
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

; Si prefieres usar el Registro en lugar de la carpeta Startup, descomenta esto y comenta la línea anterior:
;[Registry]
;Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExeName}"""; Flags: uninsdeletevalue

; No necesitas [Code] porque la app se encarga de pedir y guardar las credenciales en AppData
